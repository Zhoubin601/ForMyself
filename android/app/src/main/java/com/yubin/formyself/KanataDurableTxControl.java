package com.yubin.formyself;

import android.content.Context;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * M6-03-R / G-04 / N-05 Native Durable Transaction Control Layer.
 *
 * Authoritative app-private no-backup transaction control root providing:
 * - Cross-process stable exclusive lock (FIX-04 invariant: control.lock is NEVER unlinked on close)
 * - Installation identity registry bound to protocol version bounds & AndroidKeyStore aliases
 * - Independent AndroidKeyStore 256-bit HMAC-SHA256 authentication for head, records, and registrations
 * - Independent AndroidKeyStore 256-bit AES-256-GCM encryption for sensitive recovery payloads
 * - Immutable content-addressed control records (records/<sha256>.json) + authoritative head.json
 * - Strictly serialized in-lock CAS state machine: GATE -> PREPARED -> DECISION(previous|target) -> FINALIZED
 * - Unified H-05 legacy restore artifact inventory across all 5 legacy paths
 * - Cross-process persistent writer fence shared by Todo/Widget, KanataSqlite, ArchiveFileBatch, and workers
 * - Unforgeable short-lived recovery capability tokens bound to (txnId, participant, operation, generation, owner, epoch)
 * - Immutable generation directories (generations/<generationId>/{kanata.db, envelope.json, generation-manifest.json})
 */
public final class KanataDurableTxControl {
    public static final int PROTOCOL_VERSION = 1;
    public static final int MIN_SUPPORTED_VERSION = 1;
    public static final int MAX_SUPPORTED_VERSION = 1;

    public static final String STATE_GATE = "GATE";
    public static final String STATE_PREPARED = "PREPARED";
    public static final String STATE_DECISION = "DECISION";
    public static final String STATE_FINALIZED = "FINALIZED";

    public static final String DIR_NONE = "";
    public static final String DIR_PREVIOUS = "previous";
    public static final String DIR_TARGET = "target";

    public static final String OP_APPLY_GENERATION = "APPLY_GENERATION";
    public static final String OP_COMPENSATE_PARTICIPANT = "COMPENSATE_PARTICIPANT";
    public static final String OP_COMMIT_DECISION = "COMMIT_DECISION";
    public static final String OP_FINALIZE = "FINALIZE";
    public static final String OP_RECOVERY_TODO_CAS = "RECOVERY_TODO_CAS";

    public static final long DEFAULT_CAPABILITY_TTL_MS = 120_000L;

    public static final String[] LEGACY_RESTORE_FILES = new String[] {
            "restore-v1.enc",
            "restore-v1.commit",
            "restore-v1.tmp",
            "restore-v1.enc.commit",
            "restore-v1.enc.tmp"
    };

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String CONTROL_ROOT_NAME = "kanata-tx-control-v1";
    private static final String LOCK_FILE_NAME = "control.lock";
    private static final String INSTALLATION_FILE_NAME = "installation.json";
    private static final String HEAD_FILE_NAME = "head.json";
    private static final String RECORDS_DIR_NAME = "records";
    private static final String PAYLOADS_DIR_NAME = "payloads";
    private static final String GENERATIONS_DIR_NAME = "generations";
    private static final String STAGING_REG_DIR_NAME = "staging-reg";

    private static final int MAX_CONTROL_FILE_BYTES = 512 * 1024;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ConcurrentHashMap<String, ReentrantLock> PROCESS_LOCKS = new ConcurrentHashMap<>();
    private static final byte[] PROCESS_CAPABILITY_SECRET = randomBytes(32);

    private KanataDurableTxControl() {}

    public static final class TxControlException extends Exception {
        public final String code;

        public TxControlException(String code, String message) {
            super(code + ": " + message);
            this.code = code;
        }

        public TxControlException(String code, String message, Throwable cause) {
            super(code + ": " + message, cause);
            this.code = code;
        }
    }

    /** Optional deterministic fault hooks for N-05 and F03-04/07 verification; NONE in production. */
    public interface FaultInjector {
        FaultInjector NONE = new FaultInjector() {};

        default void beforeFileWrite(String targetLabel) throws IOException {}
        default void beforeFileFsync(String targetLabel) throws IOException {}
        default void beforeRename(String targetLabel) throws IOException {}
        default void beforeParentDirFsync(String targetLabel) throws IOException {}
        default void afterRenameBeforeReadback(String targetLabel) throws IOException {}
        default void beforeKeystoreAccess(String purpose) throws TxControlException {}
    }

    /** Keystore abstraction; default uses real AndroidKeyStore. */
    public interface KeyBackend {
        void ensureKeysExist(String hmacAlias, String aeadAlias) throws TxControlException;
        boolean keysExist(String hmacAlias, String aeadAlias) throws TxControlException;
        byte[] hmacSha256(String hmacAlias, byte[] input) throws TxControlException;
        EncryptedPayload aeadEncrypt(String aeadAlias, byte[] plaintext, byte[] aad) throws TxControlException;
        byte[] aeadDecrypt(String aeadAlias, byte[] iv, byte[] ciphertext, byte[] aad) throws TxControlException;
    }

    public static final class EncryptedPayload {
        public final byte[] iv;
        public final byte[] ciphertext;

        public EncryptedPayload(byte[] iv, byte[] ciphertext) {
            this.iv = iv;
            this.ciphertext = ciphertext;
        }
    }

    /** Real AndroidKeyStore implementation compatible with API 24, 25, 33, 34+. */
    public static final class AndroidKeyStoreBackend implements KeyBackend {
        public static final AndroidKeyStoreBackend INSTANCE = new AndroidKeyStoreBackend();

        private AndroidKeyStoreBackend() {}

        private static KeyStore loadStore() throws TxControlException {
            try {
                KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
                ks.load(null);
                return ks;
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AndroidKeyStore load failed", e);
            }
        }

        @Override
        public void ensureKeysExist(String hmacAlias, String aeadAlias) throws TxControlException {
            KeyStore ks = loadStore();
            try {
                if (!ks.containsAlias(hmacAlias)) {
                    KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, ANDROID_KEYSTORE);
                    KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                            hmacAlias,
                            KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                            .setKeySize(256)
                            .setDigests(KeyProperties.DIGEST_SHA256)
                            .build();
                    kg.init(spec);
                    kg.generateKey();
                }
                if (!ks.containsAlias(aeadAlias)) {
                    KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
                    KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                            aeadAlias,
                            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                            .setKeySize(256)
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setRandomizedEncryptionRequired(true)
                            .build();
                    kg.init(spec);
                    kg.generateKey();
                }
                // Verify both keys are actually usable right away.
                hmacSha256(hmacAlias, "ForMyself/TxControl/KeySelfTest".getBytes(StandardCharsets.UTF_8));
                EncryptedPayload probe = aeadEncrypt(
                        aeadAlias,
                        "probe".getBytes(StandardCharsets.UTF_8),
                        "ForMyself/TxControl/AeadSelfTest".getBytes(StandardCharsets.UTF_8));
                byte[] dec = aeadDecrypt(
                        aeadAlias,
                        probe.iv,
                        probe.ciphertext,
                        "ForMyself/TxControl/AeadSelfTest".getBytes(StandardCharsets.UTF_8));
                if (!Arrays.equals("probe".getBytes(StandardCharsets.UTF_8), dec)) {
                    throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AEAD key self-test mismatch");
                }
            } catch (TxControlException e) {
                throw e;
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AndroidKeyStore key generation failed", e);
            }
        }

        @Override
        public boolean keysExist(String hmacAlias, String aeadAlias) throws TxControlException {
            KeyStore ks = loadStore();
            try {
                return ks.containsAlias(hmacAlias) && ks.containsAlias(aeadAlias);
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AndroidKeyStore containsAlias failed", e);
            }
        }

        @Override
        public byte[] hmacSha256(String hmacAlias, byte[] input) throws TxControlException {
            KeyStore ks = loadStore();
            try {
                KeyStore.Entry entry = ks.getEntry(hmacAlias, null);
                if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                    throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "HMAC key missing: " + hmacAlias);
                }
                SecretKey key = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(key);
                return mac.doFinal(input);
            } catch (TxControlException e) {
                throw e;
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "HMAC-SHA256 compute failed", e);
            }
        }

        @Override
        public EncryptedPayload aeadEncrypt(String aeadAlias, byte[] plaintext, byte[] aad) throws TxControlException {
            KeyStore ks = loadStore();
            try {
                KeyStore.Entry entry = ks.getEntry(aeadAlias, null);
                if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                    throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AEAD key missing: " + aeadAlias);
                }
                SecretKey key = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key);
                if (aad != null && aad.length > 0) {
                    cipher.updateAAD(aad);
                }
                byte[] ct = cipher.doFinal(plaintext);
                byte[] iv = cipher.getIV();
                if (iv == null || iv.length != 12) {
                    throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "Unexpected GCM IV length");
                }
                return new EncryptedPayload(iv, ct);
            } catch (TxControlException e) {
                throw e;
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AEAD encrypt failed", e);
            }
        }

        @Override
        public byte[] aeadDecrypt(String aeadAlias, byte[] iv, byte[] ciphertext, byte[] aad) throws TxControlException {
            KeyStore ks = loadStore();
            try {
                KeyStore.Entry entry = ks.getEntry(aeadAlias, null);
                if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                    throw new TxControlException("TX_CONTROL_KEY_UNAVAILABLE", "AEAD key missing: " + aeadAlias);
                }
                SecretKey key = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
                if (aad != null && aad.length > 0) {
                    cipher.updateAAD(aad);
                }
                return cipher.doFinal(ciphertext);
            } catch (TxControlException e) {
                throw e;
            } catch (Exception e) {
                throw new TxControlException("TX_CONTROL_AUTH_FAILED", "AEAD decrypt/auth failed", e);
            }
        }
    }

    /** Stable cross-process + in-process exclusive lock handle. NEVER unlinks control.lock on close. */
    public static final class StableControlLock implements AutoCloseable {
        public final File lockFile;
        public final long dev;
        public final long ino;
        private final ReentrantLock processLock;
        private final RandomAccessFile raf;
        private final FileChannel channel;
        private final FileLock fileLock;
        private boolean closed = false;

        private StableControlLock(
                File lockFile,
                long dev,
                long ino,
                ReentrantLock processLock,
                RandomAccessFile raf,
                FileChannel channel,
                FileLock fileLock) {
            this.lockFile = lockFile;
            this.dev = dev;
            this.ino = ino;
            this.processLock = processLock;
            this.raf = raf;
            this.channel = channel;
            this.fileLock = fileLock;
        }

        @Override
        public void close() {
            if (closed) return;
            closed = true;
            try {
                if (fileLock != null && fileLock.isValid()) {
                    fileLock.release();
                }
            } catch (Exception ignored) {
            }
            try {
                channel.close();
            } catch (Exception ignored) {
            }
            try {
                raf.close();
            } catch (Exception ignored) {
            }
            // FIX-04 invariant: NEVER unlink lockFile on close.
            processLock.unlock();
        }
    }

    public static final class LegacyInventory {
        public final boolean clean;
        public final boolean hasMainEnc;
        public final boolean hasCommitMarker;
        public final boolean hasTmp;
        public final boolean hasNativeEncCommit;
        public final boolean hasNativeEncTmp;
        public final boolean orphanOrConflict;
        public final String status;
        public final List<String> presentFiles;

        LegacyInventory(
                boolean clean,
                boolean hasMainEnc,
                boolean hasCommitMarker,
                boolean hasTmp,
                boolean hasNativeEncCommit,
                boolean hasNativeEncTmp,
                boolean orphanOrConflict,
                String status,
                List<String> presentFiles) {
            this.clean = clean;
            this.hasMainEnc = hasMainEnc;
            this.hasCommitMarker = hasCommitMarker;
            this.hasTmp = hasTmp;
            this.hasNativeEncCommit = hasNativeEncCommit;
            this.hasNativeEncTmp = hasNativeEncTmp;
            this.orphanOrConflict = orphanOrConflict;
            this.status = status;
            this.presentFiles = Collections.unmodifiableList(presentFiles);
        }

        public JSONObject toJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (String f : presentFiles) arr.put(f);
            return new JSONObject()
                    .put("clean", clean)
                    .put("hasMainEnc", hasMainEnc)
                    .put("hasCommitMarker", hasCommitMarker)
                    .put("hasTmp", hasTmp)
                    .put("hasNativeEncCommit", hasNativeEncCommit)
                    .put("hasNativeEncTmp", hasNativeEncTmp)
                    .put("orphanOrConflict", orphanOrConflict)
                    .put("status", status)
                    .put("presentFiles", arr);
        }
    }

    public static final class GenerationRegistration {
        public final String generationId;
        public final boolean absent;
        public final String relativeDir;
        public final String dbSha256Hex;
        public final String envelopeSha256Hex;
        public final String schemaFingerprint;
        public final String cipherProfile;
        public final String kekBindingDomain;
        public final String datasetIdentity;
        public final long totalBusinessRows;
        public final int tableCount;

        public GenerationRegistration(
                String generationId,
                boolean absent,
                String relativeDir,
                String dbSha256Hex,
                String envelopeSha256Hex,
                String schemaFingerprint,
                String cipherProfile,
                String kekBindingDomain,
                String datasetIdentity,
                long totalBusinessRows,
                int tableCount) {
            this.generationId = generationId;
            this.absent = absent;
            this.relativeDir = relativeDir == null ? "" : relativeDir;
            this.dbSha256Hex = dbSha256Hex == null ? "" : dbSha256Hex;
            this.envelopeSha256Hex = envelopeSha256Hex == null ? "" : envelopeSha256Hex;
            this.schemaFingerprint = schemaFingerprint == null ? "" : schemaFingerprint;
            this.cipherProfile = cipherProfile == null ? "" : cipherProfile;
            this.kekBindingDomain = kekBindingDomain == null ? "" : kekBindingDomain;
            this.datasetIdentity = datasetIdentity == null ? "" : datasetIdentity;
            this.totalBusinessRows = totalBusinessRows;
            this.tableCount = tableCount;
        }

        public JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("generationId", generationId)
                    .put("absent", absent)
                    .put("relativeDir", relativeDir)
                    .put("dbSha256Hex", dbSha256Hex)
                    .put("envelopeSha256Hex", envelopeSha256Hex)
                    .put("schemaFingerprint", schemaFingerprint)
                    .put("cipherProfile", cipherProfile)
                    .put("kekBindingDomain", kekBindingDomain)
                    .put("datasetIdentity", datasetIdentity)
                    .put("totalBusinessRows", totalBusinessRows)
                    .put("tableCount", tableCount);
        }

        public static GenerationRegistration fromJson(JSONObject j) throws Exception {
            if (j == null) return null;
            return new GenerationRegistration(
                    j.getString("generationId"),
                    j.getBoolean("absent"),
                    j.optString("relativeDir", ""),
                    j.optString("dbSha256Hex", ""),
                    j.optString("envelopeSha256Hex", ""),
                    j.optString("schemaFingerprint", ""),
                    j.optString("cipherProfile", ""),
                    j.optString("kekBindingDomain", ""),
                    j.optString("datasetIdentity", ""),
                    j.optLong("totalBusinessRows", 0L),
                    j.optInt("tableCount", 0));
        }

        public static GenerationRegistration absentGeneration(String id) {
            return new GenerationRegistration(id, true, "", "", "", "", "", "", "absent", 0L, 0);
        }
    }

    public static final class ControlRecord {
        public final int protocolVersion;
        public final String installationId;
        public final long sequence;
        public final String txnId;
        public final String kind;
        public final String scope;
        public final List<String> participants;
        public final String ownerId;
        public final long epoch;
        public final String state;
        public final String decisionDirection;
        public final boolean abortOnly;
        public final String preparedDigest;
        public final GenerationRegistration previousGeneration;
        public final GenerationRegistration targetGeneration;
        public final String activeGenerationId;
        public final String inputDigest;
        public final String payloadId;
        public final String progress;
        public final long updatedAtMs;
        public final String recordDigest;

        public ControlRecord(
                int protocolVersion,
                String installationId,
                long sequence,
                String txnId,
                String kind,
                String scope,
                List<String> participants,
                String ownerId,
                long epoch,
                String state,
                String decisionDirection,
                boolean abortOnly,
                String preparedDigest,
                GenerationRegistration previousGeneration,
                GenerationRegistration targetGeneration,
                String activeGenerationId,
                String inputDigest,
                String payloadId,
                String progress,
                long updatedAtMs,
                String recordDigest) {
            this.protocolVersion = protocolVersion;
            this.installationId = installationId;
            this.sequence = sequence;
            this.txnId = txnId;
            this.kind = kind;
            this.scope = scope;
            this.participants = Collections.unmodifiableList(new ArrayList<>(participants));
            this.ownerId = ownerId;
            this.epoch = epoch;
            this.state = state;
            this.decisionDirection = decisionDirection == null ? "" : decisionDirection;
            this.abortOnly = abortOnly;
            this.preparedDigest = preparedDigest == null ? "" : preparedDigest;
            this.previousGeneration = previousGeneration;
            this.targetGeneration = targetGeneration;
            this.activeGenerationId = activeGenerationId == null ? "" : activeGenerationId;
            this.inputDigest = inputDigest == null ? "" : inputDigest;
            this.payloadId = payloadId == null ? "" : payloadId;
            this.progress = progress == null ? "" : progress;
            this.updatedAtMs = updatedAtMs;
            this.recordDigest = recordDigest == null ? "" : recordDigest;
        }

        public JSONObject toCanonicalJson() throws Exception {
            JSONArray pArr = new JSONArray();
            for (String p : participants) pArr.put(p);
            JSONObject obj = new JSONObject();
            obj.put("abortOnly", abortOnly);
            obj.put("activeGenerationId", activeGenerationId);
            obj.put("decisionDirection", decisionDirection);
            obj.put("epoch", epoch);
            obj.put("inputDigest", inputDigest);
            obj.put("installationId", installationId);
            obj.put("kind", kind);
            obj.put("ownerId", ownerId);
            obj.put("participants", pArr);
            obj.put("payloadId", payloadId);
            obj.put("preparedDigest", preparedDigest);
            obj.put("previousGeneration", previousGeneration != null ? previousGeneration.toJson() : JSONObject.NULL);
            obj.put("progress", progress);
            obj.put("protocolVersion", protocolVersion);
            obj.put("scope", scope);
            obj.put("sequence", sequence);
            obj.put("state", state);
            obj.put("targetGeneration", targetGeneration != null ? targetGeneration.toJson() : JSONObject.NULL);
            obj.put("txnId", txnId);
            obj.put("updatedAtMs", updatedAtMs);
            return obj;
        }

        public JSONObject toSummaryJson() throws Exception {
            return toCanonicalJson().put("recordDigest", recordDigest);
        }

        static ControlRecord fromCanonicalJson(JSONObject obj, String recordDigest) throws Exception {
            JSONArray pArr = obj.getJSONArray("participants");
            List<String> parts = new ArrayList<>();
            for (int i = 0; i < pArr.length(); i++) {
                parts.add(pArr.getString(i));
            }
            JSONObject prevObj = obj.isNull("previousGeneration") ? null : obj.getJSONObject("previousGeneration");
            JSONObject targObj = obj.isNull("targetGeneration") ? null : obj.getJSONObject("targetGeneration");
            return new ControlRecord(
                    obj.getInt("protocolVersion"),
                    obj.getString("installationId"),
                    obj.getLong("sequence"),
                    obj.getString("txnId"),
                    obj.getString("kind"),
                    obj.getString("scope"),
                    parts,
                    obj.getString("ownerId"),
                    obj.getLong("epoch"),
                    obj.getString("state"),
                    obj.optString("decisionDirection", ""),
                    obj.optBoolean("abortOnly", false),
                    obj.optString("preparedDigest", ""),
                    GenerationRegistration.fromJson(prevObj),
                    GenerationRegistration.fromJson(targObj),
                    obj.optString("activeGenerationId", ""),
                    obj.optString("inputDigest", ""),
                    obj.optString("payloadId", ""),
                    obj.optString("progress", ""),
                    obj.optLong("updatedAtMs", 0L),
                    recordDigest);
        }
    }

    public static final class InstallationRegistry {
        public final int protocolVersion;
        public final int minSupportedVersion;
        public final int maxSupportedVersion;
        public final String installationId;
        public final String packageName;
        public final String hmacKeyAlias;
        public final String aeadKeyAlias;
        public final long createdAtMs;

        InstallationRegistry(
                int protocolVersion,
                int minSupportedVersion,
                int maxSupportedVersion,
                String installationId,
                String packageName,
                String hmacKeyAlias,
                String aeadKeyAlias,
                long createdAtMs) {
            this.protocolVersion = protocolVersion;
            this.minSupportedVersion = minSupportedVersion;
            this.maxSupportedVersion = maxSupportedVersion;
            this.installationId = installationId;
            this.packageName = packageName;
            this.hmacKeyAlias = hmacKeyAlias;
            this.aeadKeyAlias = aeadKeyAlias;
            this.createdAtMs = createdAtMs;
        }
    }

    public static final class AuthoritativeState {
        public final boolean initialized;
        public final boolean blocked;
        public final String recoveryAction;
        public final String reasonCode;
        public final InstallationRegistry installation;
        public final ControlRecord headRecord;
        public final LegacyInventory legacyInventory;

        AuthoritativeState(
                boolean initialized,
                boolean blocked,
                String recoveryAction,
                String reasonCode,
                InstallationRegistry installation,
                ControlRecord headRecord,
                LegacyInventory legacyInventory) {
            this.initialized = initialized;
            this.blocked = blocked;
            this.recoveryAction = recoveryAction;
            this.reasonCode = reasonCode;
            this.installation = installation;
            this.headRecord = headRecord;
            this.legacyInventory = legacyInventory;
        }

        public JSONObject toJson() throws Exception {
            JSONObject out = new JSONObject();
            out.put("initialized", initialized);
            out.put("blocked", blocked);
            out.put("recoveryAction", recoveryAction);
            out.put("reasonCode", reasonCode);
            out.put("legacyInventory", legacyInventory.toJson());
            if (installation != null) {
                out.put("installationId", installation.installationId);
                out.put("protocolVersion", installation.protocolVersion);
            }
            if (headRecord != null) {
                out.put("headRecord", headRecord.toSummaryJson());
                out.put("activeGenerationId", headRecord.activeGenerationId);
                out.put("sequence", headRecord.sequence);
                out.put("state", headRecord.state);
                out.put("txnId", headRecord.txnId);
                out.put("decisionDirection", headRecord.decisionDirection);
                out.put("recordDigest", headRecord.recordDigest);
                out.put("preparedDigest", headRecord.preparedDigest);
                out.put("ownerId", headRecord.ownerId);
                out.put("epoch", headRecord.epoch);
            }
            return out;
        }
    }

    /** Short-lived unforgeable Native recovery capability token. */
    public static final class RecoveryCapability {
        public final String tokenId;
        public final String txnId;
        public final String participantId;
        public final String operation;
        public final String generationId;
        public final String ownerId;
        public final long epoch;
        public final long issuedAtElapsedMs;
        public final long expiresAtElapsedMs;
        public final String macHex;

        RecoveryCapability(
                String tokenId,
                String txnId,
                String participantId,
                String operation,
                String generationId,
                String ownerId,
                long epoch,
                long issuedAtElapsedMs,
                long expiresAtElapsedMs,
                String macHex) {
            this.tokenId = tokenId;
            this.txnId = txnId;
            this.participantId = participantId;
            this.operation = operation;
            this.generationId = generationId;
            this.ownerId = ownerId;
            this.epoch = epoch;
            this.issuedAtElapsedMs = issuedAtElapsedMs;
            this.expiresAtElapsedMs = expiresAtElapsedMs;
            this.macHex = macHex;
        }

        public JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("tokenId", tokenId)
                    .put("txnId", txnId)
                    .put("participantId", participantId)
                    .put("operation", operation)
                    .put("generationId", generationId)
                    .put("ownerId", ownerId)
                    .put("epoch", epoch)
                    .put("issuedAtElapsedMs", issuedAtElapsedMs)
                    .put("expiresAtElapsedMs", expiresAtElapsedMs)
                    .put("macHex", macHex);
        }

        public static RecoveryCapability fromJson(JSONObject obj) throws TxControlException {
            if (obj == null) {
                throw new TxControlException("RECOVERY_CAPABILITY_INVALID", "Capability JSON is null");
            }
            try {
                return new RecoveryCapability(
                        obj.getString("tokenId"),
                        obj.getString("txnId"),
                        obj.getString("participantId"),
                        obj.getString("operation"),
                        obj.optString("generationId", ""),
                        obj.getString("ownerId"),
                        obj.getLong("epoch"),
                        obj.getLong("issuedAtElapsedMs"),
                        obj.getLong("expiresAtElapsedMs"),
                        obj.getString("macHex"));
            } catch (Exception e) {
                throw new TxControlException("RECOVERY_CAPABILITY_INVALID", "Malformed capability JSON", e);
            }
        }
    }

    public static File defaultControlRoot(Context context) {
        return new File(context.getNoBackupFilesDir(), CONTROL_ROOT_NAME);
    }

    public static String defaultHmacAlias(Context context) {
        return "com.yubin.formyself.txcontrol.hmac.v1." + context.getPackageName();
    }

    public static String defaultAeadAlias(Context context) {
        return "com.yubin.formyself.txcontrol.aead.v1." + context.getPackageName();
    }

    public static File generationDir(File controlRoot, String generationId) throws TxControlException {
        validateSafeId(generationId, "INVALID_GENERATION_ID");
        File genRoot = new File(controlRoot, GENERATIONS_DIR_NAME);
        File target = new File(genRoot, generationId);
        try {
            String rootCanonical = genRoot.getCanonicalPath();
            String targetCanonical = target.getCanonicalPath();
            if (!targetCanonical.equals(rootCanonical + File.separator + generationId)) {
                throw new TxControlException("INVALID_GENERATION_PATH", "Generation path escapes root");
            }
        } catch (IOException e) {
            throw new TxControlException("IO_FAILED", "Canonical path check failed", e);
        }
        return target;
    }

    public static File generationDbFile(File controlRoot, String generationId) throws TxControlException {
        return new File(generationDir(controlRoot, generationId), "kanata.db");
    }

    public static File generationEnvelopeFile(File controlRoot, String generationId) throws TxControlException {
        return new File(generationDir(controlRoot, generationId), "envelope.json");
    }

    public static File generationManifestFile(File controlRoot, String generationId) throws TxControlException {
        return new File(generationDir(controlRoot, generationId), "generation-manifest.json");
    }

    /**
     * Unified H-05 inventory across all 5 legacy restore files.
     * Never deletes any file on inspection and never upgrades an unauthenticated legacy commit marker.
     */
    public static LegacyInventory inspectLegacyRestoreArtifacts(Context context) {
        File formyselfDir = new File(context.getFilesDir(), "formyself");
        List<String> present = new ArrayList<>();
        boolean hasMainEnc = false;
        boolean hasCommit = false;
        boolean hasTmp = false;
        boolean hasEncCommit = false;
        boolean hasEncTmp = false;
        boolean ioError = false;

        try {
            int dirMode = lstatMode(formyselfDir);
            if (dirMode != 0 && !OsConstants.S_ISDIR(dirMode)) {
                return new LegacyInventory(false, false, false, false, false, false, true,
                        "LEGACY_DIR_CORRUPT", Collections.singletonList("formyself"));
            }
            if (dirMode != 0) {
                for (String name : LEGACY_RESTORE_FILES) {
                    File f = new File(formyselfDir, name);
                    int mode = lstatMode(f);
                    if (mode != 0) {
                        present.add(name);
                        if (!OsConstants.S_ISREG(mode)) {
                            ioError = true;
                        }
                        if ("restore-v1.enc".equals(name)) hasMainEnc = true;
                        else if ("restore-v1.commit".equals(name)) hasCommit = true;
                        else if ("restore-v1.tmp".equals(name)) hasTmp = true;
                        else if ("restore-v1.enc.commit".equals(name)) hasEncCommit = true;
                        else if ("restore-v1.enc.tmp".equals(name)) hasEncTmp = true;
                    }
                }
            }
        } catch (ErrnoException e) {
            ioError = true;
        }

        if (ioError) {
            return new LegacyInventory(false, hasMainEnc, hasCommit, hasTmp, hasEncCommit, hasEncTmp, true,
                    "LEGACY_IO_OR_TYPE_ERROR", present);
        }
        if (present.isEmpty()) {
            return new LegacyInventory(true, false, false, false, false, false, false, "CLEAN", present);
        }
        // Orphan markers or native-suffix conflicts must always block!
        boolean orphanOrConflict = hasEncCommit || hasEncTmp || (!hasMainEnc && (hasCommit || hasTmp));
        String status = orphanOrConflict ? "LEGACY_ORPHAN_OR_CONFLICT" : "LEGACY_PENDING";
        return new LegacyInventory(false, hasMainEnc, hasCommit, hasTmp, hasEncCommit, hasEncTmp,
                orphanOrConflict, status, present);
    }

    /**
     * Acquire the cross-process + in-process stable exclusive lock for the control root.
     * Note: Creates controlRoot directory ONLY when createDir=true; read-only callers on
     * uninitialized production APKs can check existence without creating directories.
     */
    public static StableControlLock acquireControlLock(File controlRoot) throws TxControlException {
        try {
            ensureDirectoryWithParentSync(controlRoot, FaultInjector.NONE);
            File lockFile = new File(controlRoot, LOCK_FILE_NAME);
            String key = lockFile.getCanonicalPath();
            ReentrantLock procLock = PROCESS_LOCKS.computeIfAbsent(key, k -> new ReentrantLock(true));
            procLock.lock();
            RandomAccessFile raf = null;
            FileChannel ch = null;
            FileLock fl = null;
            try {
                raf = new RandomAccessFile(lockFile, "rw");
                ch = raf.getChannel();
                fl = ch.lock();
                StructStat st = Os.lstat(lockFile.getPath());
                return new StableControlLock(lockFile, st.st_dev, st.st_ino, procLock, raf, ch, fl);
            } catch (Exception e) {
                try { if (fl != null && fl.isValid()) fl.release(); } catch (Exception ignored) {}
                try { if (ch != null) ch.close(); } catch (Exception ignored) {}
                try { if (raf != null) raf.close(); } catch (Exception ignored) {}
                procLock.unlock();
                throw new TxControlException("TX_LOCK_FAILED", "Failed to acquire control.lock", e);
            }
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_LOCK_FAILED", "Failed to prepare control lock dir", e);
        }
    }

    /** Functional interface for work executed inside the shared cross-process control lock. */
    @FunctionalInterface
    public interface LockedWork<T> {
        T run() throws Exception;
    }

    /**
     * Execute an ordinary write operation atomically under the shared cross-process control.lock
     * after proving the durable transaction fence is clear (state == FINALIZED and legacy clean).
     * When the durable control root has NOT been initialized (standard unactivated legacy APK),
     * runs legacyCheckOnly without creating directories or Keystore keys.
     */
    public static <T> T executeOrdinaryWriteUnderFence(
            Context context,
            File controlRoot,
            boolean blockOnLegacyPending,
            LockedWork<T> work) throws Exception {
        LegacyInventory legacy = inspectLegacyRestoreArtifacts(context);
        if (legacy.orphanOrConflict) {
            throw new TxControlException("RESTORE_RECOVERY_REQUIRED",
                    "Legacy restore artifact conflict/orphan: " + legacy.status);
        }
        int rootMode;
        try {
            rootMode = lstatMode(controlRoot);
        } catch (ErrnoException e) {
            throw new TxControlException("TX_CONTROL_BLOCKED", "Unable to inspect control root", e);
        }
        if (rootMode == 0) {
            if (blockOnLegacyPending && !legacy.clean) {
                throw new TxControlException("RESTORE_RECOVERY_REQUIRED",
                        "Legacy restore pending: " + legacy.status);
            }
            return work.run();
        }
        if (!OsConstants.S_ISDIR(rootMode)) {
            throw new TxControlException("TX_CONTROL_CORRUPT", "Control root is not a directory");
        }
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState state = probeLocked(context, controlRoot, AndroidKeyStoreBackend.INSTANCE, FaultInjector.NONE);
            if (state.blocked) {
                throw new TxControlException("RESTORE_RECOVERY_REQUIRED",
                        "Durable tx control fence active: " + state.reasonCode + " (" + state.recoveryAction + ")");
            }
            return work.run();
        }
    }

    /**
     * Execute a recovery-scoped write operation atomically under control.lock after verifying an
     * unforgeable Native RecoveryCapability bound to (txnId, participant, operation, generation, owner, epoch).
     */
    public static <T> T executeRecoveryWriteWithCapability(
            Context context,
            File controlRoot,
            RecoveryCapability capability,
            String requiredParticipant,
            String requiredOperation,
            KeyBackend keyBackend,
            LockedWork<T> work) throws Exception {
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            verifyRecoveryCapabilityLocked(
                    context, controlRoot, capability, requiredParticipant, requiredOperation, keyBackend);
            return work.run();
        }
    }

    /**
     * Production-safe cross-process ordinary write fence check.
     *
     * Rules:
     * 1. Always runs unified H-05 5-path legacy restore artifact inventory.
     *    Any legacy pending journal or orphan/conflict marker immediately blocks ordinary writes.
     * 2. If the new durable control root does NOT exist (standard unactivated legacy APK),
     *    returns without creating directories or Keystore keys.
     * 3. If the new durable control root EXISTS, acquires control.lock, authenticates installation,
     *    head, and current control record via AndroidKeyStore HMAC-SHA256, and requires
     *    state == FINALIZED with zero conflicts. Any active GATE/PREPARED/DECISION or corruption
     *    immediately rejects ordinary writes.
     */
    public static void assertOrdinaryWriteAllowed(Context context) throws TxControlException {
        assertOrdinaryWriteAllowed(context, defaultControlRoot(context), AndroidKeyStoreBackend.INSTANCE, FaultInjector.NONE);
    }

    public static void assertOrdinaryWriteAllowed(
            Context context,
            File controlRoot,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        LegacyInventory legacy = inspectLegacyRestoreArtifacts(context);
        if (!legacy.clean) {
            throw new TxControlException("RESTORE_RECOVERY_REQUIRED",
                    "Legacy restore artifact gate active: " + legacy.status);
        }
        int rootMode;
        try {
            rootMode = lstatMode(controlRoot);
        } catch (ErrnoException e) {
            throw new TxControlException("TX_CONTROL_BLOCKED", "Unable to inspect control root", e);
        }
        if (rootMode == 0) {
            return; // Uninitialized standard legacy APK: zero side effects.
        }
        if (!OsConstants.S_ISDIR(rootMode)) {
            throw new TxControlException("TX_CONTROL_CORRUPT", "Control root is not a directory");
        }
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState state = probeLocked(context, controlRoot, keyBackend, faults);
            if (state.blocked) {
                throw new TxControlException("RESTORE_RECOVERY_REQUIRED",
                        "Durable tx control fence active: " + state.reasonCode + " (" + state.recoveryAction + ")");
            }
        }
    }

    /**
     * Explicitly initialize a brand-new durable transaction control root.
     *
     * G-04 strict rule: NEVER silently re-initialize an already registered or partially damaged root!
     * Only allowed when neither installation.json nor head.json nor records/ entries exist.
     */
    public static AuthoritativeState initializeControlRoot(
            Context context,
            File controlRoot,
            String hmacAlias,
            String aeadAlias,
            String initialActiveGenerationId,
            GenerationRegistration initialActiveGen,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            File installFile = new File(controlRoot, INSTALLATION_FILE_NAME);
            File headFile = new File(controlRoot, HEAD_FILE_NAME);
            File recordsDir = new File(controlRoot, RECORDS_DIR_NAME);
            File payloadsDir = new File(controlRoot, PAYLOADS_DIR_NAME);
            File gensDir = new File(controlRoot, GENERATIONS_DIR_NAME);
            File stagingRegDir = new File(controlRoot, STAGING_REG_DIR_NAME);

            boolean anyExisting = fileExists(installFile)
                    || fileExists(headFile)
                    || dirHasEntries(recordsDir)
                    || dirHasEntries(payloadsDir);
            if (anyExisting) {
                throw new TxControlException("TX_CONTROL_ALREADY_INITIALIZED_OR_CORRUPT",
                        "Refusing to overwrite or blank existing control root materials");
            }

            fi.beforeKeystoreAccess("ensureKeysExist");
            kb.ensureKeysExist(hmacAlias, aeadAlias);

            ensureDirectoryWithParentSync(recordsDir, fi);
            ensureDirectoryWithParentSync(payloadsDir, fi);
            ensureDirectoryWithParentSync(gensDir, fi);
            ensureDirectoryWithParentSync(stagingRegDir, fi);

            String installationId = "inst-" + randomHex16();
            long nowMs = System.currentTimeMillis();

            JSONObject installCanonical = new JSONObject();
            installCanonical.put("aeadKeyAlias", aeadAlias);
            installCanonical.put("createdAtMs", nowMs);
            installCanonical.put("hmacKeyAlias", hmacAlias);
            installCanonical.put("installationId", installationId);
            installCanonical.put("maxSupportedVersion", MAX_SUPPORTED_VERSION);
            installCanonical.put("minSupportedVersion", MIN_SUPPORTED_VERSION);
            installCanonical.put("packageName", context.getPackageName());
            installCanonical.put("protocolVersion", PROTOCOL_VERSION);

            byte[] installEnvelope = buildAuthenticatedEnvelope(
                    kb, fi, hmacAlias, installationId, "installation", installCanonical);
            writeAtomicDurableVerified(installFile, installEnvelope, "installation", fi);

            String activeGenId = initialActiveGenerationId == null ? "" : initialActiveGenerationId;
            ControlRecord genesis = new ControlRecord(
                    PROTOCOL_VERSION,
                    installationId,
                    0L,
                    "genesis-" + randomHex16(),
                    "genesis",
                    "kanata-portable-v1",
                    Arrays.asList("kanata", "todo", "settings", "vault"),
                    "system-init",
                    0L,
                    STATE_FINALIZED,
                    DIR_NONE,
                    false,
                    "",
                    initialActiveGen,
                    null,
                    activeGenId,
                    "",
                    "",
                    "initialized",
                    nowMs,
                    "");

            String genesisDigest = persistImmutableRecordLocked(controlRoot, kb, fi, hmacAlias, installationId, genesis);
            persistAuthoritativeHeadLocked(controlRoot, kb, fi, hmacAlias, installationId,
                    0L, genesisDigest, activeGenId, nowMs);

            return probeLocked(context, controlRoot, kb, fi);
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_CONTROL_INIT_FAILED", "Control root initialization failed", e);
        }
    }

    /**
     * Probe authoritative durable state under cross-process control.lock.
     * Never scans records/ to guess state if head.json is absent or corrupted.
     */
    public static AuthoritativeState probe(
            Context context,
            File controlRoot,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        LegacyInventory legacy = inspectLegacyRestoreArtifacts(context);

        int rootMode;
        try {
            rootMode = lstatMode(controlRoot);
        } catch (ErrnoException e) {
            return new AuthoritativeState(false, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                    "TX_CONTROL_IO_ERROR", null, null, legacy);
        }
        if (rootMode == 0) {
            boolean blocked = !legacy.clean;
            String action = blocked ? (legacy.orphanOrConflict ? "BLOCKED_LEGACY_CONFLICT" : "BLOCKED_LEGACY_PENDING") : "UNINITIALIZED";
            String reason = blocked ? legacy.status : "NOT_INITIALIZED";
            return new AuthoritativeState(false, blocked, action, reason, null, null, legacy);
        }
        if (!OsConstants.S_ISDIR(rootMode)) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                    "TX_CONTROL_CORRUPT", null, null, legacy);
        }
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            return probeLocked(context, controlRoot, kb, fi);
        }
    }

    /**
     * Strictly serialized in-lock CAS state transition.
     * Re-reads and authenticates head + current record under control.lock before validating:
     * - installation identity & protocol version
     * - expectedSeq == head.sequence
     * - expectedDigest == head.recordDigest == SHA256(current authenticated record bytes)
     * - legal state edge & irreversible decision direction
     * - preparedDigest binding on DECISION / progress updates
     * - owner / epoch match (unless explicit takeoverEpoch > current.epoch)
     */
    public static ControlRecord compareAndSetTransition(
            Context context,
            File controlRoot,
            String expectedTxnId,
            String ownerId,
            long expectedEpoch,
            long expectedSeq,
            String expectedDigest,
            String nextState,
            String nextDirection,
            boolean abortOnly,
            String expectedPreparedDigest,
            GenerationRegistration previousGen,
            GenerationRegistration targetGen,
            String activeGenerationId,
            String inputDigest,
            String payloadId,
            String progress,
            String kind,
            String scope,
            List<String> participants,
            boolean allowOwnerTakeover,
            long takeoverNewEpoch,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;

        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState current = probeLocked(context, controlRoot, kb, fi);
            if (!current.initialized || current.installation == null || current.headRecord == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT",
                        "Cannot CAS on uninitialized or corrupt control root: " + current.reasonCode);
            }
            if (!current.legacyInventory.clean) {
                throw new TxControlException("LEGACY_NEW_CONFLICT",
                        "Cannot advance new durable tx while legacy restore artifacts exist: " + current.legacyInventory.status);
            }

            ControlRecord cur = current.headRecord;
            if (cur.sequence != expectedSeq) {
                throw new TxControlException("CAS_SEQUENCE_MISMATCH",
                        "Expected seq " + expectedSeq + " but head is " + cur.sequence);
            }
            if (expectedDigest == null || !MessageDigest.isEqual(
                    expectedDigest.getBytes(StandardCharsets.UTF_8),
                    cur.recordDigest.getBytes(StandardCharsets.UTF_8))) {
                throw new TxControlException("CAS_DIGEST_MISMATCH", "Expected head recordDigest mismatch");
            }

            validateLegalEdge(cur, nextState, nextDirection, abortOnly, expectedPreparedDigest, previousGen, targetGen);

            boolean startingNewTxn = STATE_FINALIZED.equals(cur.state) && STATE_GATE.equals(nextState);
            if (!startingNewTxn) {
                if (!cur.txnId.equals(expectedTxnId)) {
                    throw new TxControlException("CAS_TXN_MISMATCH", "Transaction ID mismatch");
                }
                if (allowOwnerTakeover) {
                    if (takeoverNewEpoch <= cur.epoch) {
                        throw new TxControlException("CAS_EPOCH_STALE",
                                "Takeover epoch must strictly exceed current epoch " + cur.epoch);
                    }
                } else {
                    if (!cur.ownerId.equals(ownerId) || cur.epoch != expectedEpoch) {
                        throw new TxControlException("CAS_OWNER_OR_EPOCH_MISMATCH",
                                "Owner/epoch mismatch: expected " + ownerId + "@" + expectedEpoch
                                        + " vs current " + cur.ownerId + "@" + cur.epoch);
                    }
                }
            }

            String nextTxnId = startingNewTxn
                    ? (expectedTxnId != null && !expectedTxnId.isEmpty() ? expectedTxnId : "txn-" + randomHex16())
                    : cur.txnId;
            long nextEpoch = startingNewTxn
                    ? Math.max(cur.epoch + 1L, expectedEpoch)
                    : (allowOwnerTakeover ? takeoverNewEpoch : cur.epoch);
            String nextOwner = ownerId != null && !ownerId.isEmpty() ? ownerId : cur.ownerId;
            long nextSeq = cur.sequence + 1L;
            long nowMs = System.currentTimeMillis();

            GenerationRegistration resolvedPrev = previousGen != null ? previousGen : cur.previousGeneration;
            GenerationRegistration resolvedTarget = abortOnly ? null : (targetGen != null ? targetGen : cur.targetGeneration);
            String resolvedActiveGen = activeGenerationId != null ? activeGenerationId : cur.activeGenerationId;
            String resolvedKind = (kind != null && !kind.isEmpty()) ? kind : cur.kind;
            String resolvedScope = (scope != null && !scope.isEmpty()) ? scope : cur.scope;
            List<String> resolvedParticipants = (participants != null && !participants.isEmpty())
                    ? participants : cur.participants;
            String resolvedInputDigest = (inputDigest != null && !inputDigest.isEmpty()) ? inputDigest : cur.inputDigest;
            String resolvedPayloadId = (payloadId != null && !payloadId.isEmpty()) ? payloadId : cur.payloadId;

            // Compute/carry preparedDigest cleanly.
            String resolvedPreparedDigest = cur.preparedDigest;
            if (STATE_GATE.equals(nextState)) {
                resolvedPreparedDigest = "";
            } else if (STATE_PREPARED.equals(nextState)) {
                // Prepared digest binds txnId, participants, abortOnly, previousGen, targetGen, and inputDigest.
                JSONObject binding = new JSONObject();
                binding.put("abortOnly", abortOnly);
                binding.put("inputDigest", resolvedInputDigest);
                binding.put("installationId", current.installation.installationId);
                JSONArray pArr = new JSONArray();
                for (String p : resolvedParticipants) pArr.put(p);
                binding.put("participants", pArr);
                binding.put("previousGeneration", resolvedPrev != null ? resolvedPrev.toJson() : JSONObject.NULL);
                binding.put("scope", resolvedScope);
                binding.put("targetGeneration", resolvedTarget != null ? resolvedTarget.toJson() : JSONObject.NULL);
                binding.put("txnId", nextTxnId);
                resolvedPreparedDigest = sha256Hex(binding.toString().getBytes(StandardCharsets.UTF_8));
            } else if (STATE_DECISION.equals(nextState) || STATE_FINALIZED.equals(nextState)) {
                if (expectedPreparedDigest == null || !expectedPreparedDigest.equals(cur.preparedDigest)) {
                    throw new TxControlException("CAS_PREPARED_DIGEST_MISMATCH",
                            "DECISION/FINALIZED requires exact preparedDigest binding");
                }
                resolvedPreparedDigest = cur.preparedDigest;
            }

            // On DECISION(dir), verify selected generation directory materials exist on disk before head switch.
            if (STATE_DECISION.equals(nextState)) {
                GenerationRegistration chosen = DIR_TARGET.equals(nextDirection) ? resolvedTarget : resolvedPrev;
                if (chosen == null) {
                    throw new TxControlException("GENERATION_MATERIAL_MISSING",
                            "Chosen generation registration missing for direction=" + nextDirection);
                }
                if (!chosen.absent) {
                    verifyGenerationMaterialsOnDisk(controlRoot, chosen);
                    resolvedActiveGen = chosen.generationId;
                } else {
                    resolvedActiveGen = "";
                }
            } else if (STATE_FINALIZED.equals(nextState)) {
                GenerationRegistration chosen = DIR_TARGET.equals(cur.decisionDirection)
                        ? resolvedTarget : resolvedPrev;
                if (chosen != null && !chosen.absent) {
                    verifyGenerationMaterialsOnDisk(controlRoot, chosen);
                    resolvedActiveGen = chosen.generationId;
                }
            }

            ControlRecord nextRecord = new ControlRecord(
                    PROTOCOL_VERSION,
                    current.installation.installationId,
                    nextSeq,
                    nextTxnId,
                    resolvedKind,
                    resolvedScope,
                    resolvedParticipants,
                    nextOwner,
                    nextEpoch,
                    nextState,
                    STATE_DECISION.equals(nextState) ? nextDirection : (STATE_FINALIZED.equals(nextState) ? cur.decisionDirection : DIR_NONE),
                    STATE_PREPARED.equals(nextState) ? abortOnly : cur.abortOnly,
                    resolvedPreparedDigest,
                    resolvedPrev,
                    resolvedTarget,
                    resolvedActiveGen,
                    resolvedInputDigest,
                    resolvedPayloadId,
                    progress == null ? "" : progress,
                    nowMs,
                    "");

            // Order strictly per G-04:
            // 1) Generation materials already synced on disk.
            // 2) Publish immutable authenticated control record + fsync + rename + dir fsync + readback.
            String nextDigest = persistImmutableRecordLocked(
                    controlRoot, kb, fi, current.installation.hmacKeyAlias, current.installation.installationId, nextRecord);

            // 3) Atomically install authoritative head (sole linearization point) + fsync + rename + dir fsync + readback.
            persistAuthoritativeHeadLocked(
                    controlRoot, kb, fi, current.installation.hmacKeyAlias, current.installation.installationId,
                    nextSeq, nextDigest, resolvedActiveGen, nowMs);

            return new ControlRecord(
                    nextRecord.protocolVersion,
                    nextRecord.installationId,
                    nextRecord.sequence,
                    nextRecord.txnId,
                    nextRecord.kind,
                    nextRecord.scope,
                    nextRecord.participants,
                    nextRecord.ownerId,
                    nextRecord.epoch,
                    nextRecord.state,
                    nextRecord.decisionDirection,
                    nextRecord.abortOnly,
                    nextRecord.preparedDigest,
                    nextRecord.previousGeneration,
                    nextRecord.targetGeneration,
                    nextRecord.activeGenerationId,
                    nextRecord.inputDigest,
                    nextRecord.payloadId,
                    nextRecord.progress,
                    nextRecord.updatedAtMs,
                    nextDigest);
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_CAS_FAILED", "Durable CAS transition failed", e);
        }
    }

    /**
     * Persist an AEAD-encrypted sensitive recovery payload under controlRoot/payloads/
     * using the independent AndroidKeyStore AES-256-GCM key with domain-separated AAD.
     */
    public static String writeEncryptedPayload(
            Context context,
            File controlRoot,
            String txnId,
            String role,
            String generationId,
            byte[] plaintext,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, fi);
            if (!st.initialized || st.installation == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Control root not initialized for payload write");
            }
            validateSafeId(txnId, "INVALID_TXN_ID");
            validateSafeId(role, "INVALID_PAYLOAD_ROLE");
            String safeGen = generationId == null ? "" : generationId;
            byte[] aad = ("ForMyself/TxPayload/v1\0" + st.installation.installationId
                    + "\0" + txnId + "\0" + role + "\0" + safeGen).getBytes(StandardCharsets.UTF_8);
            fi.beforeKeystoreAccess("aeadEncrypt");
            EncryptedPayload enc = kb.aeadEncrypt(st.installation.aeadKeyAlias, plaintext, aad);
            String payloadId = "pl-" + randomHex16();
            JSONObject obj = new JSONObject();
            obj.put("ciphertextBase64", Base64.encodeToString(enc.ciphertext, Base64.NO_WRAP));
            obj.put("generationId", safeGen);
            obj.put("ivBase64", Base64.encodeToString(enc.iv, Base64.NO_WRAP));
            obj.put("payloadId", payloadId);
            obj.put("role", role);
            obj.put("txnId", txnId);
            obj.put("version", 1);
            byte[] raw = obj.toString().getBytes(StandardCharsets.UTF_8);
            File payloadsDir = new File(controlRoot, PAYLOADS_DIR_NAME);
            ensureDirectoryWithParentSync(payloadsDir, fi);
            File target = new File(payloadsDir, payloadId + ".aead.json");
            writeAtomicDurableVerified(target, raw, "payload", fi);
            return payloadId;
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_PAYLOAD_WRITE_FAILED", "Failed to write encrypted payload", e);
        }
    }

    /** Read and authenticate an AEAD-encrypted sensitive recovery payload. */
    public static byte[] readEncryptedPayload(
            Context context,
            File controlRoot,
            String payloadId,
            String expectedTxnId,
            String expectedRole,
            String expectedGenerationId,
            KeyBackend keyBackend,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, fi);
            if (!st.initialized || st.installation == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Control root not initialized for payload read");
            }
            validateSafeId(payloadId, "INVALID_PAYLOAD_ID");
            File target = new File(new File(controlRoot, PAYLOADS_DIR_NAME), payloadId + ".aead.json");
            byte[] raw = readBoundedFile(target, MAX_CONTROL_FILE_BYTES);
            JSONObject obj = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            if (obj.optInt("version", -1) != 1
                    || !expectedTxnId.equals(obj.optString("txnId", ""))
                    || !expectedRole.equals(obj.optString("role", ""))
                    || !(expectedGenerationId == null ? "" : expectedGenerationId).equals(obj.optString("generationId", ""))) {
                throw new TxControlException("TX_PAYLOAD_BINDING_MISMATCH", "Payload metadata binding mismatch");
            }
            byte[] iv = Base64.decode(obj.getString("ivBase64"), Base64.NO_WRAP);
            byte[] ct = Base64.decode(obj.getString("ciphertextBase64"), Base64.NO_WRAP);
            byte[] aad = ("ForMyself/TxPayload/v1\0" + st.installation.installationId
                    + "\0" + expectedTxnId + "\0" + expectedRole + "\0"
                    + (expectedGenerationId == null ? "" : expectedGenerationId)).getBytes(StandardCharsets.UTF_8);
            fi.beforeKeystoreAccess("aeadDecrypt");
            return kb.aeadDecrypt(st.installation.aeadKeyAlias, iv, ct, aad);
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_PAYLOAD_READ_FAILED", "Failed to open encrypted payload", e);
        }
    }

    /**
     * Issue a short-lived unforgeable Native recovery capability token bound to
     * (txnId, participantId, operation, generationId, ownerId, epoch).
     * Plain JS callers passing recovering=true can NEVER mint this token.
     */
    public static RecoveryCapability issueRecoveryCapability(
            Context context,
            File controlRoot,
            String txnId,
            String participantId,
            String operation,
            String generationId,
            String ownerId,
            long epoch,
            long ttlMs,
            KeyBackend keyBackend) throws TxControlException {
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, FaultInjector.NONE);
            if (!st.initialized || st.installation == null || st.headRecord == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Cannot issue capability on corrupt control root");
            }
            ControlRecord cur = st.headRecord;
            if (!cur.txnId.equals(txnId) || !cur.ownerId.equals(ownerId) || cur.epoch != epoch) {
                throw new TxControlException("RECOVERY_CAPABILITY_BINDING_FAILED",
                        "Requested capability does not match current authoritative txn/owner/epoch");
            }
            if (STATE_FINALIZED.equals(cur.state)) {
                throw new TxControlException("RECOVERY_CAPABILITY_NO_ACTIVE_TX",
                        "Cannot issue recovery capability when transaction is already FINALIZED");
            }
            String tokenId = "cap-" + randomHex16();
            long nowElapsed = SystemClock.elapsedRealtime();
            long boundedTtl = Math.max(1000L, Math.min(ttlMs > 0 ? ttlMs : DEFAULT_CAPABILITY_TTL_MS, 300_000L));
            long expElapsed = nowElapsed + boundedTtl;
            String safeGen = generationId == null ? "" : generationId;
            String macHex = computeCapabilityMac(
                    kb, st.installation.hmacKeyAlias, st.installation.installationId,
                    tokenId, txnId, participantId, operation, safeGen, ownerId, epoch, nowElapsed, expElapsed);
            return new RecoveryCapability(
                    tokenId, txnId, participantId, operation, safeGen, ownerId, epoch, nowElapsed, expElapsed, macHex);
        }
    }

    /**
     * Verify a Native recovery capability token under control.lock against the authoritative head.
     */
    public static ControlRecord verifyRecoveryCapabilityLocked(
            Context context,
            File controlRoot,
            RecoveryCapability cap,
            String requiredParticipant,
            String requiredOperation,
            KeyBackend keyBackend) throws TxControlException {
        if (cap == null) {
            throw new TxControlException("RECOVERY_CAPABILITY_REQUIRED", "Missing recovery capability token");
        }
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        AuthoritativeState st = probeLocked(context, controlRoot, kb, FaultInjector.NONE);
        if (!st.initialized || st.installation == null || st.headRecord == null) {
            throw new TxControlException("TX_CONTROL_CORRUPT", "Control root unreadable during capability check");
        }
        ControlRecord cur = st.headRecord;
        long nowElapsed = SystemClock.elapsedRealtime();
        if (nowElapsed > cap.expiresAtElapsedMs || cap.expiresAtElapsedMs < cap.issuedAtElapsedMs) {
            throw new TxControlException("RECOVERY_CAPABILITY_EXPIRED", "Recovery capability expired");
        }
        if (!requiredParticipant.equals(cap.participantId) || !requiredOperation.equals(cap.operation)) {
            throw new TxControlException("RECOVERY_CAPABILITY_SCOPE_MISMATCH",
                    "Capability scope mismatch: expected " + requiredParticipant + "/" + requiredOperation);
        }
        if (!cur.txnId.equals(cap.txnId) || !cur.ownerId.equals(cap.ownerId) || cur.epoch != cap.epoch) {
            throw new TxControlException("RECOVERY_CAPABILITY_TXN_MISMATCH",
                    "Capability does not match current authoritative txn/owner/epoch");
        }
        if (STATE_FINALIZED.equals(cur.state)) {
            throw new TxControlException("RECOVERY_CAPABILITY_TX_FINALIZED",
                    "Transaction already finalized");
        }
        if (STATE_DECISION.equals(cur.state) && !cap.generationId.isEmpty()) {
            GenerationRegistration expected = DIR_TARGET.equals(cur.decisionDirection)
                    ? cur.targetGeneration : cur.previousGeneration;
            if (expected != null && !expected.absent && !expected.generationId.equals(cap.generationId)) {
                throw new TxControlException("RECOVERY_CAPABILITY_GENERATION_MISMATCH",
                        "Capability generation does not match decided direction");
            }
        }
        String expectedMac = computeCapabilityMac(
                kb, st.installation.hmacKeyAlias, st.installation.installationId,
                cap.tokenId, cap.txnId, cap.participantId, cap.operation,
                cap.generationId, cap.ownerId, cap.epoch, cap.issuedAtElapsedMs, cap.expiresAtElapsedMs);
        if (!MessageDigest.isEqual(
                expectedMac.getBytes(StandardCharsets.UTF_8),
                cap.macHex.getBytes(StandardCharsets.UTF_8))) {
            throw new TxControlException("RECOVERY_CAPABILITY_FORGED", "Capability MAC verification failed");
        }
        return cur;
    }

    /**
     * Register a verified staging generation in controlRoot/staging-reg/ with Keystore HMAC authentication,
     * binding it to (ownerId, sessionRevision, epoch, generationId, dbSha256Hex, envelopeSha256Hex).
     * Rejects external forged descriptors that were never registered by Native staging.
     */
    public static String registerVerifiedStaging(
            Context context,
            File controlRoot,
            GenerationRegistration gen,
            String ownerId,
            long sessionRevision,
            long epoch,
            String inputDigest,
            KeyBackend keyBackend) throws TxControlException {
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, FaultInjector.NONE);
            if (!st.initialized || st.installation == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Control root not initialized");
            }
            verifyGenerationMaterialsOnDisk(controlRoot, gen);
            String handle = "stg-" + randomHex16();
            JSONObject canonical = new JSONObject();
            canonical.put("createdAtMs", System.currentTimeMillis());
            canonical.put("epoch", epoch);
            canonical.put("generation", gen.toJson());
            canonical.put("handle", handle);
            canonical.put("inputDigest", inputDigest == null ? "" : inputDigest);
            canonical.put("installationId", st.installation.installationId);
            canonical.put("ownerId", ownerId);
            canonical.put("sessionRevision", sessionRevision);
            byte[] env = buildAuthenticatedEnvelope(
                    kb, FaultInjector.NONE, st.installation.hmacKeyAlias, st.installation.installationId,
                    "staging-reg", canonical);
            File dir = new File(controlRoot, STAGING_REG_DIR_NAME);
            ensureDirectoryWithParentSync(dir, FaultInjector.NONE);
            writeAtomicDurableVerified(new File(dir, handle + ".json"), env, "staging-reg", FaultInjector.NONE);
            return handle;
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("STAGING_REGISTER_FAILED", "Failed to register verified staging", e);
        }
    }

    /** Verify and load an authenticated staging registration handle. */
    public static JSONObject verifyStagingRegistration(
            Context context,
            File controlRoot,
            String handle,
            String expectedOwnerId,
            long expectedSessionRevision,
            long expectedEpoch,
            KeyBackend keyBackend) throws TxControlException {
        validateSafeId(handle, "INVALID_STAGING_HANDLE");
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, FaultInjector.NONE);
            if (!st.initialized || st.installation == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Control root not initialized");
            }
            File regFile = new File(new File(controlRoot, STAGING_REG_DIR_NAME), handle + ".json");
            if (!fileExists(regFile)) {
                throw new TxControlException("STAGING_REGISTRATION_MISSING", "Unregistered staging handle: " + handle);
            }
            JSONObject canonical = readAndVerifyAuthenticatedEnvelope(
                    regFile, kb, FaultInjector.NONE, st.installation.hmacKeyAlias,
                    st.installation.installationId, "staging-reg");
            if (!handle.equals(canonical.optString("handle", ""))
                    || !expectedOwnerId.equals(canonical.optString("ownerId", ""))
                    || canonical.optLong("sessionRevision", -1L) != expectedSessionRevision
                    || canonical.optLong("epoch", -1L) != expectedEpoch) {
                throw new TxControlException("STAGING_BINDING_MISMATCH",
                        "Staging handle owner/session/epoch mismatch");
            }
            GenerationRegistration gen = GenerationRegistration.fromJson(canonical.getJSONObject("generation"));
            verifyGenerationMaterialsOnDisk(controlRoot, gen);
            return canonical;
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("STAGING_REGISTRATION_INVALID", "Staging registration check failed", e);
        }
    }

    /**
     * Garbage-collect an unregistered staging generation or unreferenced retired generation.
     * STRICT F04 RULE: Refuses to delete any generation referenced by the active headRecord
     * (activeGenerationId, previousGeneration, or targetGeneration when not FINALIZED).
     */
    public static boolean destroyUnreferencedGeneration(
            Context context,
            File controlRoot,
            String generationId,
            String stagingHandleToRemove,
            KeyBackend keyBackend) throws TxControlException {
        validateSafeId(generationId, "INVALID_GENERATION_ID");
        KeyBackend kb = keyBackend != null ? keyBackend : AndroidKeyStoreBackend.INSTANCE;
        try (StableControlLock ignored = acquireControlLock(controlRoot)) {
            AuthoritativeState st = probeLocked(context, controlRoot, kb, FaultInjector.NONE);
            if (!st.initialized || st.headRecord == null) {
                throw new TxControlException("TX_CONTROL_CORRUPT", "Cannot GC while control root is corrupt");
            }
            ControlRecord cur = st.headRecord;
            if (generationId.equals(cur.activeGenerationId)) {
                throw new TxControlException("MATERIAL_REFERENCED_BY_TX",
                        "Refusing to delete active generation: " + generationId);
            }
            boolean inFlight = !STATE_FINALIZED.equals(cur.state);
            if (inFlight) {
                if (cur.previousGeneration != null && generationId.equals(cur.previousGeneration.generationId)) {
                    throw new TxControlException("MATERIAL_REFERENCED_BY_TX",
                            "Refusing to delete previous generation referenced by in-flight tx: " + generationId);
                }
                if (cur.targetGeneration != null && generationId.equals(cur.targetGeneration.generationId)) {
                    throw new TxControlException("MATERIAL_REFERENCED_BY_TX",
                            "Refusing to delete target generation referenced by in-flight tx: " + generationId);
                }
            }
            File dir = generationDir(controlRoot, generationId);
            boolean removed = deleteDirectoryContentsStrict(dir);
            if (stagingHandleToRemove != null && !stagingHandleToRemove.isEmpty()) {
                validateSafeId(stagingHandleToRemove, "INVALID_STAGING_HANDLE");
                File regFile = new File(new File(controlRoot, STAGING_REG_DIR_NAME), stagingHandleToRemove + ".json");
                if (regFile.exists()) {
                    regFile.delete();
                }
            }
            fsyncDirectoryStrict(new File(controlRoot, GENERATIONS_DIR_NAME));
            return removed;
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("TX_GC_FAILED", "Generation GC failed", e);
        }
    }

    /**
     * Persist generation-manifest.json and verify both kanata.db and envelope.json exist with exact SHA-256.
     */
    public static void sealGenerationDirectory(
            File controlRoot,
            GenerationRegistration gen,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        if (gen == null || gen.absent) return;
        File dir = generationDir(controlRoot, gen.generationId);
        File db = new File(dir, "kanata.db");
        File env = new File(dir, "envelope.json");
        try {
            if (!fileExists(db) || !fileExists(env)) {
                throw new TxControlException("GENERATION_MATERIAL_MISSING",
                        "Both kanata.db and envelope.json are required in generation " + gen.generationId);
            }
            String actualDbSha = sha256FileHex(db);
            String actualEnvSha = sha256FileHex(env);
            if (!actualDbSha.equals(gen.dbSha256Hex) || !actualEnvSha.equals(gen.envelopeSha256Hex)) {
                throw new TxControlException("GENERATION_DIGEST_MISMATCH",
                        "Generation file digests do not match registration");
            }
            // Fsync db and envelope files before sealing manifest.
            fsyncExistingFile(db, "generation-db", fi);
            fsyncExistingFile(env, "generation-envelope", fi);
            byte[] manifestBytes = gen.toJson().toString().getBytes(StandardCharsets.UTF_8);
            writeAtomicDurableVerified(new File(dir, "generation-manifest.json"), manifestBytes, "generation-manifest", fi);
            fi.beforeParentDirFsync("generations-root");
            fsyncDirectoryStrict(new File(controlRoot, GENERATIONS_DIR_NAME));
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("GENERATION_SEAL_FAILED", "Failed to seal generation directory", e);
        }
    }

    /** Verify a registered generation's kanata.db + envelope.json + manifest exist and match digests. */
    public static void verifyGenerationMaterialsOnDisk(File controlRoot, GenerationRegistration gen) throws TxControlException {
        if (gen == null || gen.absent) return;
        File dir = generationDir(controlRoot, gen.generationId);
        File db = new File(dir, "kanata.db");
        File env = new File(dir, "envelope.json");
        File manifest = new File(dir, "generation-manifest.json");
        try {
            if (!fileExists(db) || !fileExists(env) || !fileExists(manifest)) {
                throw new TxControlException("GENERATION_MATERIAL_MISSING",
                        "Missing db/envelope/manifest for generation " + gen.generationId);
            }
            // Note: For an already FINALIZED generation that may subsequently receive normal business writes,
            // only check immutable dbSha256Hex during an in-flight restore/decision, whereas envelope must always parse.
            String actualEnvSha = sha256FileHex(env);
            if (!gen.envelopeSha256Hex.isEmpty() && !actualEnvSha.equals(gen.envelopeSha256Hex)) {
                throw new TxControlException("GENERATION_ENVELOPE_MISMATCH",
                        "Envelope SHA-256 mismatch for generation " + gen.generationId);
            }
            if (!gen.dbSha256Hex.isEmpty()) {
                String actualDbSha = sha256FileHex(db);
                if (!actualDbSha.equals(gen.dbSha256Hex)) {
                    throw new TxControlException("GENERATION_DB_MISMATCH",
                            "Database SHA-256 mismatch for generation " + gen.generationId);
                }
            }
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("GENERATION_VERIFY_FAILED", "Generation verification failed", e);
        }
    }

    // ---- Internal locked implementation ----

    private static AuthoritativeState probeLocked(
            Context context,
            File controlRoot,
            KeyBackend kb,
            FaultInjector fi) {
        LegacyInventory legacy = inspectLegacyRestoreArtifacts(context);
        File installFile = new File(controlRoot, INSTALLATION_FILE_NAME);
        File headFile = new File(controlRoot, HEAD_FILE_NAME);
        File recordsDir = new File(controlRoot, RECORDS_DIR_NAME);

        if (!fileExistsQuiet(installFile)) {
            boolean hasAnyArtifacts = fileExistsQuiet(headFile) || dirHasEntriesQuiet(recordsDir);
            if (hasAnyArtifacts) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_INSTALLATION_MISSING", null, null, legacy);
            }
            boolean blocked = !legacy.clean;
            return new AuthoritativeState(false, blocked,
                    blocked ? "BLOCKED_LEGACY_PENDING" : "UNINITIALIZED",
                    blocked ? legacy.status : "NOT_INITIALIZED",
                    null, null, legacy);
        }

        InstallationRegistry installation;
        try {
            // Read outer installation envelope to extract key aliases and installationId, then authenticate with HMAC!
            byte[] rawInstall = readBoundedFile(installFile, MAX_CONTROL_FILE_BYTES);
            JSONObject env = new JSONObject(new String(rawInstall, StandardCharsets.UTF_8));
            byte[] canonicalBytes = Base64.decode(env.getString("canonical"), Base64.NO_WRAP);
            String macHex = env.getString("macHex");
            JSONObject instJson = new JSONObject(new String(canonicalBytes, StandardCharsets.UTF_8));

            int ver = instJson.getInt("protocolVersion");
            int minV = instJson.getInt("minSupportedVersion");
            int maxV = instJson.getInt("maxSupportedVersion");
            if (ver < MIN_SUPPORTED_VERSION || ver > MAX_SUPPORTED_VERSION || minV > PROTOCOL_VERSION || maxV < PROTOCOL_VERSION) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_UNSUPPORTED_VERSION", null, null, legacy);
            }
            String instId = instJson.getString("installationId");
            String pkg = instJson.getString("packageName");
            String hmacAlias = instJson.getString("hmacKeyAlias");
            String aeadAlias = instJson.getString("aeadKeyAlias");
            if (!context.getPackageName().equals(pkg)) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_PACKAGE_MISMATCH", null, null, legacy);
            }
            fi.beforeKeystoreAccess("probeKeys");
            if (!kb.keysExist(hmacAlias, aeadAlias)) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_KEY_UNAVAILABLE", null, null, legacy);
            }
            verifyMac(kb, hmacAlias, instId, "installation", canonicalBytes, macHex);
            installation = new InstallationRegistry(
                    ver, minV, maxV, instId, pkg, hmacAlias, aeadAlias, instJson.optLong("createdAtMs", 0L));
        } catch (TxControlException e) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN", e.code, null, null, legacy);
        } catch (Exception e) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                    "TX_CONTROL_INSTALLATION_CORRUPT", null, null, legacy);
        }

        // G-04: Never scan records/ when head.json is missing or corrupt!
        if (!fileExistsQuiet(headFile)) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                    "TX_CONTROL_HEAD_MISSING", installation, null, legacy);
        }

        ControlRecord headRecord;
        try {
            JSONObject headJson = readAndVerifyAuthenticatedEnvelope(
                    headFile, kb, fi, installation.hmacKeyAlias, installation.installationId, "head");
            int headVer = headJson.getInt("protocolVersion");
            if (headVer < MIN_SUPPORTED_VERSION || headVer > MAX_SUPPORTED_VERSION) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_UNSUPPORTED_VERSION", installation, null, legacy);
            }
            if (!installation.installationId.equals(headJson.getString("installationId"))) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_INSTALLATION_MISMATCH", installation, null, legacy);
            }
            long headSeq = headJson.getLong("sequence");
            String recordDigest = headJson.getString("recordDigest");
            String headActiveGen = headJson.optString("activeGenerationId", "");
            if (!recordDigest.matches("[a-f0-9]{64}")) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_HEAD_CORRUPT", installation, null, legacy);
            }

            File recordFile = new File(recordsDir, recordDigest + ".json");
            if (!fileExistsQuiet(recordFile)) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_RECORD_MISSING", installation, null, legacy);
            }
            byte[] fullRecordBytes = readBoundedFile(recordFile, MAX_CONTROL_FILE_BYTES);
            String actualDigest = sha256Hex(fullRecordBytes);
            if (!MessageDigest.isEqual(
                    recordDigest.getBytes(StandardCharsets.UTF_8),
                    actualDigest.getBytes(StandardCharsets.UTF_8))) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_RECORD_DIGEST_MISMATCH", installation, null, legacy);
            }
            JSONObject recJson = verifyAuthenticatedEnvelopeBytes(
                    fullRecordBytes, kb, fi, installation.hmacKeyAlias, installation.installationId, "record");
            int recVer = recJson.getInt("protocolVersion");
            if (recVer < MIN_SUPPORTED_VERSION || recVer > MAX_SUPPORTED_VERSION) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_UNSUPPORTED_VERSION", installation, null, legacy);
            }
            headRecord = ControlRecord.fromCanonicalJson(recJson, actualDigest);
            if (!installation.installationId.equals(headRecord.installationId)
                    || headRecord.sequence != headSeq
                    || !headActiveGen.equals(headRecord.activeGenerationId)) {
                return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                        "TX_CONTROL_HEAD_RECORD_MISMATCH", installation, null, legacy);
            }
        } catch (TxControlException e) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN", e.code, installation, null, legacy);
        } catch (Exception e) {
            return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                    "TX_CONTROL_RECORD_CORRUPT", installation, null, legacy);
        }

        // Check legacy conflict vs new control state (H-05 / G-04).
        if (!legacy.clean) {
            String code = STATE_FINALIZED.equals(headRecord.state)
                    ? legacy.status : "LEGACY_NEW_CONFLICT";
            return new AuthoritativeState(true, true, "BLOCKED_LEGACY_CONFLICT", code, installation, headRecord, legacy);
        }

        // Evaluate G-04 cold-start decision table.
        if (STATE_FINALIZED.equals(headRecord.state)) {
            // Verify active generation directory (db + envelope) exists when an active generation is registered.
            if (!headRecord.activeGenerationId.isEmpty()) {
                try {
                    File db = generationDbFile(controlRoot, headRecord.activeGenerationId);
                    File env = generationEnvelopeFile(controlRoot, headRecord.activeGenerationId);
                    if (!fileExistsQuiet(db) || !fileExistsQuiet(env)) {
                        return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                                "ACTIVE_GENERATION_MATERIAL_MISSING", installation, headRecord, legacy);
                    }
                } catch (TxControlException e) {
                    return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                            e.code, installation, headRecord, legacy);
                }
            }
            return new AuthoritativeState(true, false, "READY", "FINALIZED", installation, headRecord, legacy);
        }
        if (STATE_GATE.equals(headRecord.state)) {
            return new AuthoritativeState(true, true, "BLOCKED_ABORT_GATE", "TX_IN_GATE", installation, headRecord, legacy);
        }
        if (STATE_PREPARED.equals(headRecord.state)) {
            return new AuthoritativeState(true, true, "BLOCKED_ROLLBACK_PREPARED",
                    "TX_PREPARED_UNDECIDED", installation, headRecord, legacy);
        }
        if (STATE_DECISION.equals(headRecord.state)) {
            if (DIR_PREVIOUS.equals(headRecord.decisionDirection)) {
                return new AuthoritativeState(true, true, "BLOCKED_REPLAY_PREVIOUS",
                        "TX_DECIDED_PREVIOUS", installation, headRecord, legacy);
            }
            if (DIR_TARGET.equals(headRecord.decisionDirection)) {
                return new AuthoritativeState(true, true, "BLOCKED_REPLAY_TARGET",
                        "TX_DECIDED_TARGET", installation, headRecord, legacy);
            }
        }
        return new AuthoritativeState(true, true, "BLOCKED_CORRUPT_OR_UNKNOWN",
                "TX_CONTROL_UNKNOWN_STATE", installation, headRecord, legacy);
    }

    private static void validateLegalEdge(
            ControlRecord cur,
            String nextState,
            String nextDirection,
            boolean abortOnly,
            String expectedPreparedDigest,
            GenerationRegistration previousGen,
            GenerationRegistration targetGen) throws TxControlException {
        if (STATE_FINALIZED.equals(cur.state)) {
            if (!STATE_GATE.equals(nextState)) {
                throw new TxControlException("CAS_ILLEGAL_EDGE", "FINALIZED may only transition to GATE");
            }
            return;
        }
        if (STATE_GATE.equals(cur.state)) {
            if (!STATE_PREPARED.equals(nextState)) {
                throw new TxControlException("CAS_ILLEGAL_EDGE", "GATE may only transition to PREPARED");
            }
            if (previousGen == null) {
                throw new TxControlException("CAS_PREVIOUS_REQUIRED", "PREPARED requires previousGeneration");
            }
            if (!abortOnly && targetGen == null) {
                throw new TxControlException("CAS_TARGET_REQUIRED", "Non-abort PREPARED requires targetGeneration");
            }
            return;
        }
        if (STATE_PREPARED.equals(cur.state)) {
            if (!STATE_DECISION.equals(nextState)) {
                throw new TxControlException("CAS_ILLEGAL_EDGE", "PREPARED may only transition to DECISION");
            }
            if (!DIR_PREVIOUS.equals(nextDirection) && !DIR_TARGET.equals(nextDirection)) {
                throw new TxControlException("CAS_INVALID_DIRECTION", "DECISION requires previous or target");
            }
            if (cur.abortOnly && DIR_TARGET.equals(nextDirection)) {
                throw new TxControlException("CAS_ABORT_ONLY_VIOLATION",
                        "abort-only PREPARED record forbids DECISION(target)");
            }
            if (expectedPreparedDigest == null || expectedPreparedDigest.isEmpty()) {
                throw new TxControlException("CAS_PREPARED_DIGEST_REQUIRED", "DECISION requires preparedDigest");
            }
            return;
        }
        if (STATE_DECISION.equals(cur.state)) {
            if (STATE_DECISION.equals(nextState)) {
                // Progress update along the SAME irreversible direction only!
                if (!cur.decisionDirection.equals(nextDirection)) {
                    throw new TxControlException("CAS_DIRECTION_IRREVERSIBLE",
                            "Cannot change decided direction from " + cur.decisionDirection + " to " + nextDirection);
                }
                return;
            }
            if (STATE_FINALIZED.equals(nextState)) {
                return;
            }
            throw new TxControlException("CAS_ILLEGAL_EDGE",
                    "DECISION may only update progress in same direction or transition to FINALIZED");
        }
        throw new TxControlException("CAS_ILLEGAL_EDGE", "Unknown state: " + cur.state);
    }

    private static String persistImmutableRecordLocked(
            File controlRoot,
            KeyBackend kb,
            FaultInjector fi,
            String hmacAlias,
            String installationId,
            ControlRecord record) throws Exception {
        byte[] fullBytes = buildAuthenticatedEnvelope(
                kb, fi, hmacAlias, installationId, "record", record.toCanonicalJson());
        String digest = sha256Hex(fullBytes);
        File recordsDir = new File(controlRoot, RECORDS_DIR_NAME);
        ensureDirectoryWithParentSync(recordsDir, fi);
        File dest = new File(recordsDir, digest + ".json");
        writeAtomicDurableVerified(dest, fullBytes, "record", fi);
        return digest;
    }

    private static void persistAuthoritativeHeadLocked(
            File controlRoot,
            KeyBackend kb,
            FaultInjector fi,
            String hmacAlias,
            String installationId,
            long sequence,
            String recordDigest,
            String activeGenerationId,
            long updatedAtMs) throws Exception {
        JSONObject headCanonical = new JSONObject();
        headCanonical.put("activeGenerationId", activeGenerationId == null ? "" : activeGenerationId);
        headCanonical.put("installationId", installationId);
        headCanonical.put("protocolVersion", PROTOCOL_VERSION);
        headCanonical.put("recordDigest", recordDigest);
        headCanonical.put("sequence", sequence);
        headCanonical.put("updatedAtMs", updatedAtMs);
        byte[] headBytes = buildAuthenticatedEnvelope(
                kb, fi, hmacAlias, installationId, "head", headCanonical);
        File headFile = new File(controlRoot, HEAD_FILE_NAME);
        writeAtomicDurableVerified(headFile, headBytes, "head", fi);
    }

    private static byte[] buildAuthenticatedEnvelope(
            KeyBackend kb,
            FaultInjector fi,
            String hmacAlias,
            String installationId,
            String purpose,
            JSONObject canonicalJson) throws Exception {
        byte[] canonicalBytes = canonicalJson.toString().getBytes(StandardCharsets.UTF_8);
        byte[] macInput = buildMacDomainInput(installationId, purpose, canonicalBytes);
        fi.beforeKeystoreAccess("hmac:" + purpose);
        byte[] mac = kb.hmacSha256(hmacAlias, macInput);
        JSONObject env = new JSONObject();
        env.put("canonical", Base64.encodeToString(canonicalBytes, Base64.NO_WRAP));
        env.put("macHex", toHex(mac));
        return env.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static JSONObject readAndVerifyAuthenticatedEnvelope(
            File file,
            KeyBackend kb,
            FaultInjector fi,
            String hmacAlias,
            String installationId,
            String purpose) throws Exception {
        byte[] raw = readBoundedFile(file, MAX_CONTROL_FILE_BYTES);
        return verifyAuthenticatedEnvelopeBytes(raw, kb, fi, hmacAlias, installationId, purpose);
    }

    private static JSONObject verifyAuthenticatedEnvelopeBytes(
            byte[] raw,
            KeyBackend kb,
            FaultInjector fi,
            String hmacAlias,
            String installationId,
            String purpose) throws Exception {
        JSONObject env = new JSONObject(new String(raw, StandardCharsets.UTF_8));
        byte[] canonicalBytes = Base64.decode(env.getString("canonical"), Base64.NO_WRAP);
        String macHex = env.getString("macHex");
        fi.beforeKeystoreAccess("verify:" + purpose);
        verifyMac(kb, hmacAlias, installationId, purpose, canonicalBytes, macHex);
        return new JSONObject(new String(canonicalBytes, StandardCharsets.UTF_8));
    }

    private static void verifyMac(
            KeyBackend kb,
            String hmacAlias,
            String installationId,
            String purpose,
            byte[] canonicalBytes,
            String macHex) throws TxControlException {
        if (macHex == null || !macHex.matches("[a-f0-9]{64}")) {
            throw new TxControlException("TX_CONTROL_AUTH_FAILED", "Malformed MAC hex for " + purpose);
        }
        byte[] expected = kb.hmacSha256(hmacAlias, buildMacDomainInput(installationId, purpose, canonicalBytes));
        String expectedHex = toHex(expected);
        if (!MessageDigest.isEqual(
                expectedHex.getBytes(StandardCharsets.UTF_8),
                macHex.getBytes(StandardCharsets.UTF_8))) {
            throw new TxControlException("TX_CONTROL_AUTH_FAILED", "HMAC verification failed for " + purpose);
        }
    }

    private static byte[] buildMacDomainInput(String installationId, String purpose, byte[] payload) {
        byte[] prefix = ("ForMyself/TxControl/v1\0" + installationId + "\0" + purpose + "\0")
                .getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[prefix.length + payload.length];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        System.arraycopy(payload, 0, out, prefix.length, payload.length);
        return out;
    }

    private static String computeCapabilityMac(
            KeyBackend kb,
            String hmacAlias,
            String installationId,
            String tokenId,
            String txnId,
            String participantId,
            String operation,
            String generationId,
            String ownerId,
            long epoch,
            long issuedAtElapsedMs,
            long expiresAtElapsedMs) throws TxControlException {
        try {
            String canonical = "ForMyself/RecoveryCap/v1|" + installationId + "|" + tokenId + "|"
                    + txnId + "|" + participantId + "|" + operation + "|" + generationId + "|"
                    + ownerId + "|" + epoch + "|" + issuedAtElapsedMs + "|" + expiresAtElapsedMs;
            byte[] ksMac = kb.hmacSha256(hmacAlias, canonical.getBytes(StandardCharsets.UTF_8));
            Mac localMac = Mac.getInstance("HmacSHA256");
            localMac.init(new SecretKeySpec(PROCESS_CAPABILITY_SECRET, "HmacSHA256"));
            localMac.update(ksMac);
            localMac.update(canonical.getBytes(StandardCharsets.UTF_8));
            return toHex(localMac.doFinal());
        } catch (TxControlException e) {
            throw e;
        } catch (Exception e) {
            throw new TxControlException("RECOVERY_CAPABILITY_SIGN_FAILED", "Capability MAC compute failed", e);
        }
    }

    // ---- Strict durability file primitives ----

    public static void writeAtomicDurableVerified(
            File target,
            byte[] content,
            String label,
            FaultInjector faults) throws TxControlException {
        FaultInjector fi = faults != null ? faults : FaultInjector.NONE;
        File parent = target.getParentFile();
        if (parent == null) {
            throw new TxControlException("IO_FAILED", "Missing parent directory for " + label);
        }
        File tmp = new File(parent, target.getName() + "." + UUID.randomUUID() + ".tmp");
        try {
            fi.beforeFileWrite(label);
            try (FileOutputStream fos = new FileOutputStream(tmp, false)) {
                fos.write(content);
                fos.flush();
                fi.beforeFileFsync(label);
                fos.getFD().sync();
            }
            fi.beforeRename(label);
            Os.rename(tmp.getPath(), target.getPath());
            try {
                fi.beforeParentDirFsync(label);
                fsyncDirectoryStrict(parent);
            } catch (IOException dirSyncErr) {
                throw new TxControlException("DURABILITY_UNCONFIRMED",
                        "Parent directory fsync failed after rename for " + label, dirSyncErr);
            }
            fi.afterRenameBeforeReadback(label);
            byte[] readBack = readBoundedFile(target, Math.max(MAX_CONTROL_FILE_BYTES, content.length + 1024));
            if (!MessageDigest.isEqual(content, readBack)) {
                throw new TxControlException("TX_READBACK_VERIFY_FAILED",
                        "Readback mismatch after atomic rename for " + label);
            }
        } catch (TxControlException e) {
            throw e;
        } catch (ErrnoException e) {
            tmp.delete();
            throw new TxControlException("IO_FAILED", "Atomic rename failed for " + label + " errno=" + e.errno, e);
        } catch (IOException e) {
            tmp.delete();
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("ENOSPC") || msg.toLowerCase(Locale.US).contains("no space")) {
                throw new TxControlException("ENOSPC", "Disk full writing " + label, e);
            }
            throw new TxControlException("IO_FAILED", "Durable write failed for " + label, e);
        }
    }

    private static void fsyncExistingFile(File file, String label, FaultInjector fi) throws IOException {
        fi.beforeFileFsync(label);
        try (FileOutputStream fos = new FileOutputStream(file, true)) {
            fos.getFD().sync();
        }
    }

    public static void fsyncDirectoryStrict(File dir) throws IOException {
        FileDescriptor fd = null;
        try {
            fd = Os.open(dir.getPath(), OsConstants.O_RDONLY, 0);
            Os.fsync(fd);
        } catch (ErrnoException e) {
            throw new IOException("fsyncDirectoryStrict failed on " + dir.getPath() + " errno=" + e.errno, e);
        } finally {
            if (fd != null) {
                try { Os.close(fd); } catch (ErrnoException ignored) {}
            }
        }
    }

    private static void ensureDirectoryWithParentSync(File dir, FaultInjector fi) throws IOException {
        if (dir.isDirectory()) return;
        File parent = dir.getParentFile();
        if (parent != null && !parent.exists()) {
            ensureDirectoryWithParentSync(parent, fi);
        }
        if (!dir.mkdir() && !dir.isDirectory()) {
            throw new IOException("Unable to create directory: " + dir.getPath());
        }
        if (parent != null && parent.isDirectory()) {
            fi.beforeParentDirFsync("mkdir:" + dir.getName());
            fsyncDirectoryStrict(parent);
        }
    }

    private static boolean deleteDirectoryContentsStrict(File dir) throws IOException {
        if (!dir.exists()) return false;
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) {
                    deleteDirectoryContentsStrict(child);
                } else if (!child.delete()) {
                    throw new IOException("Failed to delete " + child.getName());
                }
            }
        }
        return dir.delete();
    }

    private static byte[] readBoundedFile(File file, int maxBytes) throws IOException {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                if (baos.size() + n > maxBytes) {
                    throw new IOException("File exceeds control ceiling: " + file.getName());
                }
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        }
    }

    public static String sha256FileHex(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = fis.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
        }
        return toHex(md.digest());
    }

    public static String sha256Hex(byte[] bytes) throws Exception {
        return toHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static int lstatMode(File file) throws ErrnoException {
        try {
            return Os.lstat(file.getPath()).st_mode;
        } catch (ErrnoException e) {
            if (e.errno == OsConstants.ENOENT) return 0;
            throw e;
        }
    }

    private static boolean fileExists(File file) throws ErrnoException {
        return lstatMode(file) != 0;
    }

    private static boolean fileExistsQuiet(File file) {
        try {
            return lstatMode(file) != 0;
        } catch (ErrnoException e) {
            return false;
        }
    }

    private static boolean dirHasEntries(File dir) {
        File[] list = dir.listFiles();
        return list != null && list.length > 0;
    }

    private static boolean dirHasEntriesQuiet(File dir) {
        try {
            return dirHasEntries(dir);
        } catch (Exception e) {
            return true;
        }
    }

    private static void validateSafeId(String id, String code) throws TxControlException {
        if (id == null || !id.matches("[A-Za-z0-9._-]{1,128}")) {
            throw new TxControlException(code, "Unsafe identifier: " + id);
        }
    }

    private static byte[] randomBytes(int len) {
        byte[] out = new byte[len];
        RANDOM.nextBytes(out);
        return out;
    }

    private static String randomHex16() {
        return toHex(randomBytes(16));
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            int v = b & 0xff;
            sb.append(Character.forDigit(v >>> 4, 16));
            sb.append(Character.forDigit(v & 15, 16));
        }
        return sb.toString();
    }
}
