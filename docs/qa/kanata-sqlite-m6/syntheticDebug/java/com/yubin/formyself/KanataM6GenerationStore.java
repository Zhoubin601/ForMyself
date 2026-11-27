package com.yubin.formyself;

import android.content.Context;
import android.net.Uri;
import android.util.AtomicFile;
import android.util.Base64;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * M6-03-R / F06 / N-06 Generation-Isolated Database + Key Envelope Store & Recovery Auth.
 *
 * Enforces:
 * - Every generation lives in its own immutable directory:
 *   controlRoot/generations/<generationId>/{kanata.db, envelope.json, generation-manifest.json}.
 * - Each restored generation receives a fresh independent 32-byte random DEK wrapped via
 *   M6-00 KanataKeyEnvelope v1 with local master-password KEK ("ForMyself/Kanata/KEK/v1\0" || salt16).
 * - Never copies WAL/SHM sidecars across generations and never switches DB without its paired envelope.
 * - Cold-start open resolves the authoritative activeGenerationId from KanataDurableTxControl head,
 *   unwraps that generation's envelope with the local master password, and verifies SQLCipher + Schema 005.
 * - Recovery-dedicated local master password verification bypasses damaged Vault, legacy Kanata, and Settings.
 */
public final class KanataM6GenerationStore {
    private static final String KEK_DOMAIN = "ForMyself/Kanata/KEK/v1\0";
    private static final String RECOVERY_VERIFIER_FILE = "recovery-verifier.json";
    private static final int KEK_ITERATIONS = 600000;
    private static final int RECOVERY_VERIFIER_ITERATIONS = 210000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private KanataM6GenerationStore() {}

    public static final class StagedGenerationResult {
        public final KanataDurableTxControl.GenerationRegistration registration;
        public final KanataM6StagingRestoreEngine.PreparedStagingArtifact artifact;
        public final String stagingHandle;
        public final String dekFingerprintHex;

        StagedGenerationResult(
                KanataDurableTxControl.GenerationRegistration registration,
                KanataM6StagingRestoreEngine.PreparedStagingArtifact artifact,
                String stagingHandle,
                String dekFingerprintHex) {
            this.registration = registration;
            this.artifact = artifact;
            this.stagingHandle = stagingHandle;
            this.dekFingerprintHex = dekFingerprintHex;
        }
    }

    public static final class ActiveGenerationHealth {
        public final String activeGenerationId;
        public final String datasetIdentity;
        public final long worldCount;
        public final long messageCount;
        public final long totalBusinessRows;
        public final String dbSha256Hex;
        public final String envelopeSha256Hex;
        public final String dekFingerprintHex;
        public final boolean integrityOk;
        public final boolean cipherIntegrityOk;
        public final boolean foreignKeysOk;

        ActiveGenerationHealth(
                String activeGenerationId,
                String datasetIdentity,
                long worldCount,
                long messageCount,
                long totalBusinessRows,
                String dbSha256Hex,
                String envelopeSha256Hex,
                String dekFingerprintHex,
                boolean integrityOk,
                boolean cipherIntegrityOk,
                boolean foreignKeysOk) {
            this.activeGenerationId = activeGenerationId;
            this.datasetIdentity = datasetIdentity;
            this.worldCount = worldCount;
            this.messageCount = messageCount;
            this.totalBusinessRows = totalBusinessRows;
            this.dbSha256Hex = dbSha256Hex;
            this.envelopeSha256Hex = envelopeSha256Hex;
            this.dekFingerprintHex = dekFingerprintHex;
            this.integrityOk = integrityOk;
            this.cipherIntegrityOk = cipherIntegrityOk;
            this.foreignKeysOk = foreignKeysOk;
        }

        public JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("activeGenerationId", activeGenerationId)
                    .put("datasetIdentity", datasetIdentity)
                    .put("worldCount", worldCount)
                    .put("messageCount", messageCount)
                    .put("totalBusinessRows", totalBusinessRows)
                    .put("dbSha256Hex", dbSha256Hex)
                    .put("envelopeSha256Hex", envelopeSha256Hex)
                    .put("dekFingerprintHex", dekFingerprintHex)
                    .put("integrityOk", integrityOk)
                    .put("cipherIntegrityOk", cipherIntegrityOk)
                    .put("foreignKeysOk", foreignKeysOk);
        }
    }

    /** Exact byte-for-byte match with src/platform/security/kanataSqliteKek.js. */
    public static byte[] deriveLocalKek(String localMasterPassword, String base64Salt16) throws Exception {
        if (localMasterPassword == null || localMasterPassword.isEmpty()) {
            throw new KanataM6PortableCrypto.PortableException("INVALID_PASSWORD_INPUT", "Local master password empty");
        }
        byte[] salt16 = Base64.decode(base64Salt16, Base64.NO_WRAP);
        if (salt16.length != 16) {
            throw new KanataM6PortableCrypto.PortableException("UNLOCK_FAILED", "Invalid KEK salt length");
        }
        byte[] domain = KEK_DOMAIN.getBytes(StandardCharsets.UTF_8);
        byte[] domainSalt = new byte[domain.length + salt16.length];
        System.arraycopy(domain, 0, domainSalt, 0, domain.length);
        System.arraycopy(salt16, 0, domainSalt, domain.length, salt16.length);
        byte[] pwdBytes = localMasterPassword.getBytes(StandardCharsets.UTF_8);
        try {
            return KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAlloc(pwdBytes, domainSalt, KEK_ITERATIONS, 32, null);
        } finally {
            Arrays.fill(pwdBytes, (byte) 0);
        }
    }

    /**
     * Install or update the recovery-dedicated local master-password verifier inside controlRoot.
     * Recovery authentication uses this verifier (independent of Vault, legacy Kanata, and Settings).
     */
    public static void installRecoveryVerifier(
            File controlRoot,
            String localMasterPassword) throws Exception {
        if (localMasterPassword == null || localMasterPassword.length() < 4) {
            throw new KanataDurableTxControl.TxControlException("INVALID_PASSWORD_INPUT", "Master password too short");
        }
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        byte[] pwdBytes = localMasterPassword.getBytes(StandardCharsets.UTF_8);
        byte[] hash;
        try {
            byte[] domain = "ForMyself/RecoveryVerifier/v1\0".getBytes(StandardCharsets.UTF_8);
            byte[] domainSalt = new byte[domain.length + salt.length];
            System.arraycopy(domain, 0, domainSalt, 0, domain.length);
            System.arraycopy(salt, 0, domainSalt, domain.length, salt.length);
            hash = KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAlloc(pwdBytes, domainSalt, RECOVERY_VERIFIER_ITERATIONS, 32, null);
        } finally {
            Arrays.fill(pwdBytes, (byte) 0);
        }
        JSONObject obj = new JSONObject()
                .put("version", 1)
                .put("iterations", RECOVERY_VERIFIER_ITERATIONS)
                .put("saltBase64", Base64.encodeToString(salt, Base64.NO_WRAP))
                .put("hashHex", KanataM6PortableCrypto.bytesToHex(hash));
        Arrays.fill(hash, (byte) 0);
        KanataDurableTxControl.writeAtomicDurableVerified(
                new File(controlRoot, RECOVERY_VERIFIER_FILE),
                obj.toString().getBytes(StandardCharsets.UTF_8),
                "recovery-verifier",
                KanataDurableTxControl.FaultInjector.NONE);
    }

    /**
     * Verify local master password directly against controlRoot/recovery-verifier.json
     * WITHOUT loading Vault, legacy Kanata, or Settings (B-01 / G-04).
     */
    public static boolean verifyRecoveryPassword(File controlRoot, String localMasterPassword) {
        if (localMasterPassword == null || localMasterPassword.isEmpty()) return false;
        File vf = new File(controlRoot, RECOVERY_VERIFIER_FILE);
        if (!vf.isFile()) return false;
        byte[] pwdBytes = localMasterPassword.getBytes(StandardCharsets.UTF_8);
        byte[] computed = null;
        try {
            byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(vf, 4096);
            JSONObject obj = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            if (obj.optInt("version", -1) != 1) return false;
            int iter = obj.optInt("iterations", 0);
            if (iter < 100000) return false;
            byte[] salt = Base64.decode(obj.getString("saltBase64"), Base64.NO_WRAP);
            String expectedHex = obj.getString("hashHex");
            byte[] domain = "ForMyself/RecoveryVerifier/v1\0".getBytes(StandardCharsets.UTF_8);
            byte[] domainSalt = new byte[domain.length + salt.length];
            System.arraycopy(domain, 0, domainSalt, 0, domain.length);
            System.arraycopy(salt, 0, domainSalt, domain.length, salt.length);
            computed = KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAlloc(pwdBytes, domainSalt, iter, 32, null);
            String actualHex = KanataM6PortableCrypto.bytesToHex(computed);
            return MessageDigest.isEqual(
                    expectedHex.getBytes(StandardCharsets.UTF_8),
                    actualHex.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        } finally {
            Arrays.fill(pwdBytes, (byte) 0);
            if (computed != null) Arrays.fill(computed, (byte) 0);
        }
    }

    @FunctionalInterface
    public interface DatabasePopulator {
        void populate(File dbFile, byte[] rawSqlCipherKey) throws Exception;
    }

    /**
     * Seed an initial generation inside controlRoot/generations/<genId>/ with a real
     * SQLCipher 4.17.0 Schema 005 DB + real M6-00 KanataKeyEnvelope v1 wrapped by localMasterPassword.
     */
    public static KanataDurableTxControl.GenerationRegistration createInitialGenerationWithPopulator(
            File controlRoot,
            String generationId,
            String localMasterPassword,
            DatabasePopulator populator) throws Exception {
        System.loadLibrary("sqlcipher");
        File genDir = KanataDurableTxControl.generationDir(controlRoot, generationId);
        if (!genDir.exists() && !genDir.mkdirs()) {
            throw new IOException("Unable to create generation dir: " + genDir);
        }
        File dbFile = new File(genDir, "kanata.db");
        File envFile = new File(genDir, "envelope.json");

        JSONObject header = KanataKeyEnvelope.newHeader();
        byte[] kek = deriveLocalKek(localMasterPassword, header.getString("salt"));
        byte[] dek = null;
        byte[] rawKey = null;
        try {
            dek = KanataKeyEnvelope.create(new AtomicFile(envFile), header, kek);
            rawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);
            populator.populate(dbFile, rawKey);
            // Checkpoint TRUNCATE so kanata.db is completely self-contained and immutable before sealing.
            SQLiteDatabase db = SQLiteDatabase.openDatabase(
                    dbFile.getPath(), rawKey, null, SQLiteDatabase.OPEN_READWRITE, null, null);
            String datasetId;
            long totalRows;
            try {
                try (android.database.Cursor c = db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) {
                    c.moveToFirst();
                }
                try (android.database.Cursor c = db.rawQuery("SELECT user_id FROM dataset_metadata WHERE singleton = 1", null)) {
                    datasetId = c.moveToFirst() ? c.getString(0) : "unknown";
                }
                try (android.database.Cursor c = db.rawQuery("SELECT COUNT(*) FROM messages", null)) {
                    totalRows = c.moveToFirst() ? c.getLong(0) : 0L;
                }
            } finally {
                db.close();
            }
            // Remove empty WAL/SHM after clean TRUNCATE checkpoint inside this newly seeded generation
            new File(dbFile.getPath() + "-wal").delete();
            new File(dbFile.getPath() + "-shm").delete();

            KanataDurableTxControl.GenerationRegistration reg = new KanataDurableTxControl.GenerationRegistration(
                    generationId,
                    false,
                    "generations/" + generationId,
                    KanataDurableTxControl.sha256FileHex(dbFile),
                    KanataDurableTxControl.sha256FileHex(envFile),
                    "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a",
                    "sqlcipher-4.17.0",
                    "ForMyself/Kanata/KEK/v1",
                    datasetId,
                    totalRows,
                    50);
            KanataDurableTxControl.sealGenerationDirectory(controlRoot, reg, KanataDurableTxControl.FaultInjector.NONE);
            return reg;
        } finally {
            Arrays.fill(kek, (byte) 0);
            if (dek != null) Arrays.fill(dek, (byte) 0);
            if (rawKey != null) Arrays.fill(rawKey, (byte) 0);
        }
    }

    /**
     * Stage a KPB1 backup (from SAF Uri or File) into a brand-new isolated generation directory
     * with a freshly generated independent 32-byte DEK + M6-00 KanataKeyEnvelope v1, run full
     * 12-point + 50-table verification, seal generation-manifest.json, and register the handle
     * with Keystore HMAC authentication inside KanataDurableTxControl.
     */
    public static StagedGenerationResult stageKpb1IntoGeneration(
            Context context,
            File controlRoot,
            Uri safUri,
            File kpb1File,
            String backupPassword,
            String localMasterPassword,
            String taskId,
            String ownerId,
            long sessionRevision,
            long epoch,
            KanataM6PortableCatalog catalog,
            int batchSize,
            AtomicBoolean cancelled,
            KanataM6StagingRestoreEngine.StagingHooks hooks,
            KanataDurableTxControl.KeyBackend keyBackend) throws Exception {
        System.loadLibrary("sqlcipher");
        String genId = "gen-" + taskId;
        File genDir = KanataDurableTxControl.generationDir(controlRoot, genId);
        if (!genDir.exists() && !genDir.mkdirs()) {
            throw new IOException("Unable to create target generation directory");
        }
        File stagingWorkDir = new File(genDir, "_stage_work");
        if (!stagingWorkDir.exists() && !stagingWorkDir.mkdirs()) {
            throw new IOException("Unable to create staging work directory");
        }

        // Derive fresh local KEK for a brand-new random DEK (KanataKeyEnvelope.create inside engine).
        JSONObject envHeader = KanataKeyEnvelope.newHeader();
        byte[] kek = deriveLocalKek(localMasterPassword, envHeader.getString("salt"));
        byte[] dek = null;
        byte[] rawKey = null;
        try {
            File envFile = new File(genDir, "envelope.json");
            dek = KanataKeyEnvelope.create(new AtomicFile(envFile), envHeader, kek);
            String dekFingerprintHex = KanataDurableTxControl.sha256Hex(
                    concat("ForMyself/DekFp/v1\0".getBytes(StandardCharsets.UTF_8), dek));
            rawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);

            KanataM6StagingRestoreEngine.PreparedStagingArtifact artifact;
            if (safUri != null) {
                artifact = KanataM6StagingRestoreEngine.prepareStagingFromSafUri(
                        context, safUri, backupPassword, catalog, stagingWorkDir, stagingWorkDir,
                        rawKey, null, batchSize, cancelled, hooks, taskId);
            } else if (kpb1File != null) {
                artifact = KanataM6StagingRestoreEngine.prepareStagingFromFile(
                        kpb1File, backupPassword, catalog, stagingWorkDir, stagingWorkDir,
                        rawKey, null, batchSize, cancelled, hooks, taskId);
            } else {
                throw new KanataM6PortableCrypto.PortableException("IO_FAILED", "Missing KPB1 source");
            }

            // Move verified staging DB atomically into generations/<genId>/kanata.db and remove temporary work dir.
            File finalDb = new File(genDir, "kanata.db");
            android.system.Os.rename(artifact.stagingDbFile.getPath(), finalDb.getPath());
            new File(artifact.stagingDbFile.getPath() + "-wal").delete();
            new File(artifact.stagingDbFile.getPath() + "-shm").delete();
            stagingWorkDir.delete();

            String dbSha = KanataDurableTxControl.sha256FileHex(finalDb);
            String envSha = KanataDurableTxControl.sha256FileHex(envFile);
            if (!dbSha.equals(artifact.stagingSha256Hex)) {
                throw new KanataDurableTxControl.TxControlException("STAGING_DIGEST_MISMATCH",
                        "Post-move staging DB digest mismatch");
            }

            KanataDurableTxControl.GenerationRegistration reg = new KanataDurableTxControl.GenerationRegistration(
                    genId,
                    false,
                    "generations/" + genId,
                    dbSha,
                    envSha,
                    artifact.schemaFingerprintHex,
                    "sqlcipher-4.17.0",
                    "ForMyself/Kanata/KEK/v1",
                    artifact.datasetIdentity,
                    artifact.metrics.totalBusinessRows,
                    artifact.footerVerifiers.size());

            KanataDurableTxControl.sealGenerationDirectory(
                    controlRoot, reg, KanataDurableTxControl.FaultInjector.NONE);

            String handle = KanataDurableTxControl.registerVerifiedStaging(
                    context, controlRoot, reg, ownerId, sessionRevision, epoch,
                    artifact.transcriptHex, keyBackend);

            return new StagedGenerationResult(reg, artifact, handle, dekFingerprintHex);
        } catch (Exception e) {
            // Clean up failed unregistered generation dir
            deleteRecursiveQuiet(genDir);
            throw e;
        } finally {
            Arrays.fill(kek, (byte) 0);
            if (dek != null) Arrays.fill(dek, (byte) 0);
            if (rawKey != null) Arrays.fill(rawKey, (byte) 0);
        }
    }

    /**
     * Cold-start open & verify a generation using the local master password to unwrap its paired envelope.json.
     * Rejects wrong password, wrong generation, missing envelope, tampered DB, or failed SQLCipher checks.
     */
    public static ActiveGenerationHealth openAndVerifyGeneration(
            File controlRoot,
            String generationId,
            String localMasterPassword) throws Exception {
        System.loadLibrary("sqlcipher");
        File dbFile = KanataDurableTxControl.generationDbFile(controlRoot, generationId);
        File envFile = KanataDurableTxControl.generationEnvelopeFile(controlRoot, generationId);
        if (!dbFile.isFile() || !envFile.isFile()) {
            throw new KanataDurableTxControl.TxControlException("GENERATION_MATERIAL_MISSING",
                    "Missing db or envelope for " + generationId);
        }
        JSONObject header = KanataKeyEnvelope.readHeader(new AtomicFile(envFile));
        byte[] kek = deriveLocalKek(localMasterPassword, header.getString("salt"));
        byte[] dek = null;
        byte[] rawKey = null;
        try {
            try {
                dek = KanataKeyEnvelope.unwrap(kek, header);
            } catch (Exception unwrapErr) {
                throw new KanataDurableTxControl.TxControlException("UNLOCK_FAILED",
                        "Envelope unwrap failed (wrong local password or corrupt envelope)", unwrapErr);
            }
            String dekFp = KanataDurableTxControl.sha256Hex(
                    concat("ForMyself/DekFp/v1\0".getBytes(StandardCharsets.UTF_8), dek));
            rawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);

            SQLiteDatabase db = SQLiteDatabase.openDatabase(
                    dbFile.getPath(), rawKey, null, SQLiteDatabase.OPEN_READONLY, null, null);
            try {
                int userVer = (int) scalarLong(db, "PRAGMA user_version");
                int appId = (int) scalarLong(db, "PRAGMA application_id");
                if (userVer != 5 || appId != 0x4b4e5441) {
                    throw new KanataDurableTxControl.TxControlException("SCHEMA_INVALID",
                            "Unexpected user_version=" + userVer + " appId=" + appId);
                }
                boolean cipherOk;
                try (android.database.Cursor c = db.rawQuery("PRAGMA cipher_integrity_check", null)) {
                    cipherOk = !c.moveToFirst();
                }
                String integrity = scalarString(db, "PRAGMA integrity_check(1)");
                boolean integrityOk = "ok".equalsIgnoreCase(integrity);
                boolean fkOk;
                try (android.database.Cursor c = db.rawQuery("SELECT * FROM pragma_foreign_key_check LIMIT 1", null)) {
                    fkOk = !c.moveToFirst();
                }
                if (!cipherOk || !integrityOk || !fkOk) {
                    throw new KanataDurableTxControl.TxControlException("INTEGRITY_FAILED",
                            "cipherOk=" + cipherOk + " integrityOk=" + integrityOk + " fkOk=" + fkOk);
                }
                String datasetId = scalarString(db, "SELECT user_id FROM dataset_metadata WHERE singleton = 1");
                long worlds = scalarLong(db, "SELECT COUNT(*) FROM worlds");
                long messages = scalarLong(db, "SELECT COUNT(*) FROM messages");
                return new ActiveGenerationHealth(
                        generationId,
                        datasetId,
                        worlds,
                        messages,
                        messages,
                        KanataDurableTxControl.sha256FileHex(dbFile),
                        KanataDurableTxControl.sha256FileHex(envFile),
                        dekFp,
                        integrityOk,
                        cipherOk,
                        fkOk);
            } finally {
                db.close();
            }
        } finally {
            Arrays.fill(kek, (byte) 0);
            if (dek != null) Arrays.fill(dek, (byte) 0);
            if (rawKey != null) Arrays.fill(rawKey, (byte) 0);
        }
    }

    /**
     * Authoritative cold-start open following head.activeGenerationId.
     */
    public static ActiveGenerationHealth openAuthoritativeActiveGeneration(
            Context context,
            File controlRoot,
            String localMasterPassword,
            KanataDurableTxControl.KeyBackend keyBackend) throws Exception {
        KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                context, controlRoot, keyBackend, KanataDurableTxControl.FaultInjector.NONE);
        if (!st.initialized || st.headRecord == null || st.blocked) {
            throw new KanataDurableTxControl.TxControlException("RESTORE_RECOVERY_REQUIRED",
                    "Control root is blocked or uninitialized: " + st.reasonCode);
        }
        if (st.headRecord.activeGenerationId.isEmpty()) {
            throw new KanataDurableTxControl.TxControlException("ACTIVE_GENERATION_ABSENT",
                    "No active generation registered in head");
        }
        return openAndVerifyGeneration(controlRoot, st.headRecord.activeGenerationId, localMasterPassword);
    }

    private static long scalarLong(SQLiteDatabase db, String sql) {
        try (android.database.Cursor c = db.rawQuery(sql, null)) {
            return c.moveToFirst() ? c.getLong(0) : -1L;
        }
    }

    private static String scalarString(SQLiteDatabase db, String sql) {
        try (android.database.Cursor c = db.rawQuery(sql, null)) {
            return c.moveToFirst() ? c.getString(0) : "";
        }
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static void deleteRecursiveQuiet(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) deleteRecursiveQuiet(c);
        }
        f.delete();
    }
}
