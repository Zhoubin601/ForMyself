package com.yubin.formyself;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Debug;
import android.os.Process;
import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.StructStat;
import android.util.AtomicFile;

import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * M6-03 Isolated SQLCipher Temporary Staging Restore Engine & Coordinator Switch Primitives.
 *
 * Architecture:
 * - Phase 1 (prepareStagingFromKpb1 / prepareStagingFromSafUri):
 *   Streams KPB1 in bounded 64 KiB frames, validates header/KDF/BEK/Manifest/DATA/Footer/EOF,
 *   creates an isolated SQLCipher 4.17.0 temporary staging DB with fixed Schema 005 catalog
 *   (never accepting DDL/SQL from the package), installs rows in atomic batches (default 500 rows/tx)
 *   with staging-DB-backed deferred reference backfill so Java Heap stays O(batchSize) at 100k messages,
 *   runs full 12-point verification (53 tables, 50 verifiers, FK, integrity_check, cipher_integrity_check,
 *   005 ordinals, pause-sending-v1, 3 runtime tables empty, dataset_metadata), checkpoints TRUNCATE,
 *   fsyncs, and returns an immutable PreparedStagingArtifact. Active DB is 100% untouched.
 *
 * - Phase 2 (capturePreviousGeneration / applyVerifiedGeneration / unconfirmed manual verification):
 *   Controlled by RestoreCoordinator; reuses M6-02 FIX-04 stable target .lock files (NEVER unlinked
 *   on close), maintains idempotent crash-safe apply/rollback by preserving source artifacts until
 *   finalization, detects and preserves DURABILITY_UNCONFIRMED, and enforces strict lock/inode/
 *   containment/SHA-256 verification before any manual cleanup.
 */
public final class KanataM6StagingRestoreEngine {
    public static final int DEFAULT_BATCH_SIZE = 500;
    public static final int MIN_BATCH_SIZE = 1;
    public static final int MAX_BATCH_SIZE = 2000;

    private KanataM6StagingRestoreEngine() {}

    public interface StagingHooks {
        default void onPhase(String phase, int percent) {}
        default void beforeBatchCommit(String tableName, int batchIndex, int rowsInBatch, SQLiteDatabase stagingDb) throws Exception {}
        default void afterBatchCommit(String tableName, int batchIndex, int rowsInBatch, long batchMs) {}
        default void afterStagingInstallBeforeVerify(SQLiteDatabase stagingDb) throws Exception {}
        default void afterStagingVerified(File stagingDbFile, String stagingSha256Hex) throws Exception {}
    }

    public interface ApplyHooks {
        default void afterLockAcquired(File activeDbFile) throws Exception {}
        default void beforeApplyRename(File applyTmpFile, File activeDbFile) throws Exception {}
        default void afterApplyRenameBeforeJournalUpdate(File activeDbFile, File importJournalFile) throws Exception {}
        default void performTargetDirFsync(File parentDir) throws IOException {
            KanataM6SchemeCExporter.fsyncDirectoryStrict(parentDir);
        }
        default void beforeLockRelease(File lockFile, long dev, long ino) {}
    }

    public static final class RestoreMetrics {
        public final long totalRestoreMs;
        public final long decodeMs;
        public final long stagingInstallMs;
        public final long verifyMs;
        public final int batchSize;
        public final int batchCount;
        public final int maxBatchRows;
        public final long maxBatchMs;
        public final long medianBatchMs;
        public final long stagingDbBytes;
        public final long peakRssKiB;
        public final long peakJavaHeapBytes;
        public final long peakNativeHeapBytes;
        public final long webViewRssKiB;
        public final int dataFrameCount;
        public final long totalPlaintextBytes;
        public final long totalCiphertextBytes;
        public final long totalBusinessRows;

        RestoreMetrics(
                long totalRestoreMs,
                long decodeMs,
                long stagingInstallMs,
                long verifyMs,
                int batchSize,
                int batchCount,
                int maxBatchRows,
                long maxBatchMs,
                long medianBatchMs,
                long stagingDbBytes,
                long peakRssKiB,
                long peakJavaHeapBytes,
                long peakNativeHeapBytes,
                long webViewRssKiB,
                int dataFrameCount,
                long totalPlaintextBytes,
                long totalCiphertextBytes,
                long totalBusinessRows) {
            this.totalRestoreMs = totalRestoreMs;
            this.decodeMs = decodeMs;
            this.stagingInstallMs = stagingInstallMs;
            this.verifyMs = verifyMs;
            this.batchSize = batchSize;
            this.batchCount = batchCount;
            this.maxBatchRows = maxBatchRows;
            this.maxBatchMs = maxBatchMs;
            this.medianBatchMs = medianBatchMs;
            this.stagingDbBytes = stagingDbBytes;
            this.peakRssKiB = peakRssKiB;
            this.peakJavaHeapBytes = peakJavaHeapBytes;
            this.peakNativeHeapBytes = peakNativeHeapBytes;
            this.webViewRssKiB = webViewRssKiB;
            this.dataFrameCount = dataFrameCount;
            this.totalPlaintextBytes = totalPlaintextBytes;
            this.totalCiphertextBytes = totalCiphertextBytes;
            this.totalBusinessRows = totalBusinessRows;
        }

        public JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("totalRestoreMs", totalRestoreMs)
                    .put("decodeMs", decodeMs)
                    .put("stagingInstallMs", stagingInstallMs)
                    .put("verifyMs", verifyMs)
                    .put("batchSize", batchSize)
                    .put("batchCount", batchCount)
                    .put("maxBatchRows", maxBatchRows)
                    .put("maxBatchMs", maxBatchMs)
                    .put("medianBatchMs", medianBatchMs)
                    .put("stagingDbBytes", stagingDbBytes)
                    .put("peakRssKiB", peakRssKiB)
                    .put("peakJavaHeapBytes", peakJavaHeapBytes)
                    .put("peakNativeHeapBytes", peakNativeHeapBytes)
                    .put("webViewRssKiB", webViewRssKiB)
                    .put("dataFrameCount", dataFrameCount)
                    .put("totalPlaintextBytes", totalPlaintextBytes)
                    .put("totalCiphertextBytes", totalCiphertextBytes)
                    .put("totalBusinessRows", totalBusinessRows);
        }
    }

    public static final class PreparedStagingArtifact {
        public final String taskId;
        public final File stagingDbFile;
        public final String stagingSha256Hex;
        public final File envelopeFile;
        public final String schemaFingerprintHex;
        public final String datasetIdentity;
        public final long worldCount;
        public final long messageCount;
        public final String transcriptHex;
        public final List<KanataM6SchemeCExporter.Verifier> footerVerifiers;
        public final RestoreMetrics metrics;

        PreparedStagingArtifact(
                String taskId,
                File stagingDbFile,
                String stagingSha256Hex,
                File envelopeFile,
                String schemaFingerprintHex,
                String datasetIdentity,
                long worldCount,
                long messageCount,
                String transcriptHex,
                List<KanataM6SchemeCExporter.Verifier> footerVerifiers,
                RestoreMetrics metrics) {
            this.taskId = taskId;
            this.stagingDbFile = stagingDbFile;
            this.stagingSha256Hex = stagingSha256Hex;
            this.envelopeFile = envelopeFile;
            this.schemaFingerprintHex = schemaFingerprintHex;
            this.datasetIdentity = datasetIdentity;
            this.worldCount = worldCount;
            this.messageCount = messageCount;
            this.transcriptHex = transcriptHex;
            this.footerVerifiers = footerVerifiers;
            this.metrics = metrics;
        }

        public void destroyStaging() {
            SQLiteDatabase.deleteDatabase(stagingDbFile);
            if (envelopeFile != null && envelopeFile.exists()) {
                envelopeFile.delete();
            }
        }
    }

    public static final class CapturedPreviousGeneration {
        public final String taskId;
        public final boolean absent;
        public final File rollbackDbFile;
        public final String rollbackSha256Hex;

        CapturedPreviousGeneration(String taskId, boolean absent, File rollbackDbFile, String rollbackSha256Hex) {
            this.taskId = taskId;
            this.absent = absent;
            this.rollbackDbFile = rollbackDbFile;
            this.rollbackSha256Hex = rollbackSha256Hex;
        }

        public void cleanupAfterFinalized() {
            if (rollbackDbFile != null && rollbackDbFile.exists()) {
                SQLiteDatabase.deleteDatabase(rollbackDbFile);
            }
        }
    }

    public static final class UnconfirmedEntry {
        public final String taskId;
        public final String kind;
        public final String state;
        public final String journalPath;
        public final String targetPath;
        public final String expectedSha256Hex;
        public final String actualTargetSha256Hex;
        public final boolean targetExists;
        public final boolean lockActive;
        public final boolean shaMatches;
        public final String reason;

        UnconfirmedEntry(
                String taskId,
                String kind,
                String state,
                String journalPath,
                String targetPath,
                String expectedSha256Hex,
                String actualTargetSha256Hex,
                boolean targetExists,
                boolean lockActive,
                boolean shaMatches,
                String reason) {
            this.taskId = taskId;
            this.kind = kind;
            this.state = state;
            this.journalPath = journalPath;
            this.targetPath = targetPath;
            this.expectedSha256Hex = expectedSha256Hex;
            this.actualTargetSha256Hex = actualTargetSha256Hex;
            this.targetExists = targetExists;
            this.lockActive = lockActive;
            this.shaMatches = shaMatches;
            this.reason = reason;
        }
    }

    public static final class ManualActionResult {
        public final String taskId;
        public final boolean resolved;
        public final String outcome;
        public final String reason;

        ManualActionResult(String taskId, boolean resolved, String outcome, String reason) {
            this.taskId = taskId;
            this.resolved = resolved;
            this.outcome = outcome;
            this.reason = reason;
        }
    }

    private static final class ResourceTracker {
        long peakRssKiB = -1L;
        long peakJavaHeapBytes = -1L;
        long peakNativeHeapBytes = -1L;
        long webViewRssKiB = -1L;

        void sample() {
            long rss = readVmRssKiB();
            if (rss > peakRssKiB) peakRssKiB = rss;
            long nat = Debug.getNativeHeapAllocatedSize();
            if (nat > peakNativeHeapBytes) peakNativeHeapBytes = nat;
            Runtime rt = Runtime.getRuntime();
            long java = rt.totalMemory() - rt.freeMemory();
            if (java > peakJavaHeapBytes) peakJavaHeapBytes = java;
            long wv = readWebViewOrProcessRssKiB();
            if (wv > webViewRssKiB) webViewRssKiB = wv;
        }

        private static long readVmRssKiB() {
            try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/status"))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (line.startsWith("VmRSS:")) {
                        return Long.parseLong(line.trim().split("\\s+")[1]);
                    }
                }
            } catch (Exception ignored) {}
            return -1L;
        }

        private static long readWebViewOrProcessRssKiB() {
            // In single-process WebView / instrumentation, report process RSS or -1 if unavailable.
            return readVmRssKiB();
        }
    }

    private static final class BoundedStreamReader {
        private final InputStream in;
        private final AtomicBoolean cancelled;

        BoundedStreamReader(InputStream in, AtomicBoolean cancelled) {
            this.in = in;
            this.cancelled = cancelled;
        }

        byte[] readExact(int len) {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            byte[] out = new byte[len];
            int filled = 0;
            int zeroReads = 0;
            try {
                while (filled < len) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    int r = in.read(out, filled, len - filled);
                    if (r == -1) {
                        Arrays.fill(out, (byte) 0);
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "unexpected-eof");
                    }
                    if (r == 0) {
                        zeroReads++;
                        KanataM6PortableCrypto.requirePortable(
                                zeroReads < KanataM6PortableCrypto.MAX_ZERO_PROGRESS_READS,
                                KanataM6PortableCrypto.ERR_IO_FAILED, "reader-zero-progress");
                    } else {
                        zeroReads = 0;
                        filled += r;
                    }
                }
                return out;
            } catch (KanataM6PortableCrypto.PortableException pe) {
                Arrays.fill(out, (byte) 0);
                throw pe;
            } catch (IOException ioe) {
                Arrays.fill(out, (byte) 0);
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "reader-io", ioe);
            }
        }

        void assertEof() {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            byte[] probe = new byte[1];
            int zeroReads = 0;
            try {
                while (true) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    int r = in.read(probe, 0, 1);
                    if (r == -1) return;
                    if (r == 0) {
                        zeroReads++;
                        KanataM6PortableCrypto.requirePortable(
                                zeroReads < KanataM6PortableCrypto.MAX_ZERO_PROGRESS_READS,
                                KanataM6PortableCrypto.ERR_IO_FAILED, "reader-zero-progress");
                    } else {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "trailing-data");
                    }
                }
            } catch (KanataM6PortableCrypto.PortableException pe) {
                throw pe;
            } catch (IOException ioe) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "reader-eof-io", ioe);
            }
        }
    }

    private static final class FrameHeader {
        final int streamId;
        final int type;
        final int flags;
        final long index;
        final int plainLen;
        final int cipherLen;

        FrameHeader(byte[] b) {
            this.streamId = KanataM6PortableCrypto.readU16BE(b, 0);
            this.type = b[2] & 0xff;
            this.flags = b[3] & 0xff;
            this.index = KanataM6PortableCrypto.readU64BE(b, 4);
            long pl = KanataM6PortableCrypto.readU32BE(b, 12);
            long cl = KanataM6PortableCrypto.readU32BE(b, 16);
            KanataM6PortableCrypto.requirePortable(
                    pl <= KanataM6PortableCrypto.FRAME_LIMIT
                            && cl <= KanataM6PortableCrypto.FRAME_LIMIT + KanataM6PortableCrypto.TAG_SIZE,
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "frame-limit");
            KanataM6PortableCrypto.requirePortable(
                    cl == pl + KanataM6PortableCrypto.TAG_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "frame-cipher-len");
            this.plainLen = (int) pl;
            this.cipherLen = (int) cl;
        }
    }

    private static byte[] buildFrameNonce(int streamId, int type, long index) {
        byte[] n = new byte[KanataM6PortableCrypto.FRAME_NONCE_SIZE];
        KanataM6PortableCrypto.writeU16BE(n, 0, streamId);
        n[2] = (byte) type;
        n[3] = 0;
        KanataM6PortableCrypto.writeU64BE(n, 4, index);
        return n;
    }

    private static byte[] buildFrameKeyInfo(int streamId, int type) {
        byte[] prefix = "KPB1/frame\0".getBytes(StandardCharsets.US_ASCII);
        byte[] out = new byte[prefix.length + 3];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        KanataM6PortableCrypto.writeU16BE(out, prefix.length, streamId);
        out[prefix.length + 2] = (byte) type;
        return out;
    }

    private static String sanitizeTaskId(String explicitTaskId) {
        if (explicitTaskId == null || explicitTaskId.isEmpty()) {
            return "rst-" + UUID.randomUUID();
        }
        if (explicitTaskId.contains("..") || !explicitTaskId.matches("[A-Za-z0-9._-]+")) {
            throw new KanataM6PortableCrypto.PortableException(
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "invalid-restore-task-id");
        }
        return explicitTaskId;
    }

    /**
     * Phase 1 via Android SAF Uri: opens ContentResolver stream and delegates to bounded staging engine.
     */
    public static PreparedStagingArtifact prepareStagingFromSafUri(
            Context context,
            Uri safUri,
            String backupPassword,
            KanataM6PortableCatalog catalog,
            File workDir,
            File stagingDir,
            byte[] targetRawKey,
            byte[] optionalLocalKekForEnvelope,
            int batchSize,
            AtomicBoolean cancelled,
            StagingHooks hooks,
            String explicitTaskId) throws Exception {
        KanataM6PortableCrypto.requirePortable(safUri != null, KanataM6PortableCrypto.ERR_IO_FAILED, "saf-uri-null");
        ContentResolver resolver = context.getContentResolver();
        try (InputStream is = resolver.openInputStream(safUri)) {
            KanataM6PortableCrypto.requirePortable(is != null, KanataM6PortableCrypto.ERR_IO_FAILED, "saf-stream-null");
            return prepareStagingFromKpb1(
                    is, backupPassword, catalog, workDir, stagingDir, targetRawKey,
                    optionalLocalKekForEnvelope, batchSize, cancelled, hooks, explicitTaskId);
        }
    }

    /**
     * Phase 1 via local isolated File.
     */
    public static PreparedStagingArtifact prepareStagingFromFile(
            File kpb1File,
            String backupPassword,
            KanataM6PortableCatalog catalog,
            File workDir,
            File stagingDir,
            byte[] targetRawKey,
            byte[] optionalLocalKekForEnvelope,
            int batchSize,
            AtomicBoolean cancelled,
            StagingHooks hooks,
            String explicitTaskId) throws Exception {
        KanataM6PortableCrypto.requirePortable(
                kpb1File != null && kpb1File.isFile(),
                KanataM6PortableCrypto.ERR_IO_FAILED, "kpb1-file-missing");
        try (FileInputStream fis = new FileInputStream(kpb1File)) {
            return prepareStagingFromKpb1(
                    fis, backupPassword, catalog, workDir, stagingDir, targetRawKey,
                    optionalLocalKekForEnvelope, batchSize, cancelled, hooks, explicitTaskId);
        }
    }

    /**
     * Phase 1 core: Decode KPB1 -> isolated batched SQLCipher 4.17.0 staging DB -> full 12-point verification.
     * NEVER touches any active/production database.
     */
    public static PreparedStagingArtifact prepareStagingFromKpb1(
            InputStream source,
            String backupPassword,
            KanataM6PortableCatalog catalog,
            File workDir,
            File stagingDir,
            byte[] targetRawKey,
            byte[] optionalLocalKekForEnvelope,
            int requestedBatchSize,
            AtomicBoolean cancelled,
            StagingHooks hooks,
            String explicitTaskId) throws Exception {
        long startTotal = SystemClock.elapsedRealtime();
        int batchSize = requestedBatchSize <= 0 ? DEFAULT_BATCH_SIZE : requestedBatchSize;
        KanataM6PortableCrypto.requirePortable(
                batchSize >= MIN_BATCH_SIZE && batchSize <= MAX_BATCH_SIZE,
                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "batch-size-bounds");
        String taskId = sanitizeTaskId(explicitTaskId);
        if (!workDir.exists() && !workDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "work-dir-mkdir");
        }
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "staging-dir-mkdir");
        }

        ResourceTracker res = new ResourceTracker();
        res.sample();
        if (hooks != null) hooks.onPhase("reading_kpb1", 2);

        byte[] pwBytes = KanataM6PortableCrypto.encodeStrictPasswordUtf8(backupPassword);
        byte[] baseKek = new byte[KanataM6PortableCrypto.KEY_SIZE];
        byte[] wrapKey = null;
        byte[] bek = null;
        byte[] manifestKey = null;
        byte[] dataKey = null;
        byte[] footerKey = null;
        byte[] stageRowsKey = null;
        byte[] derivedTargetKey = null;
        byte[] effectiveTargetKey = targetRawKey;

        File stageRowsFile = new File(workDir, ".stage-rows-" + taskId + "-" + UUID.randomUUID().toString().substring(0, 8) + ".db");
        String stageNonce = UUID.randomUUID().toString().substring(0, 8);
        File targetStageFile = new File(stagingDir, ".stage-restore-" + taskId + "-" + stageNonce + ".db");
        File envelopeFile = null;
        SQLiteDatabase stageRowsDb = null;
        SQLiteDatabase targetStageDb = null;
        LogicalStreamDecoder logicalDecoder = null;
        boolean succeeded = false;

        try {
            long startDecode = SystemClock.elapsedRealtime();
            BoundedStreamReader reader = new BoundedStreamReader(source, cancelled);

            // 1. Validate 124-byte prefix BEFORE KDF
            byte[] prefix = reader.readExact(KanataM6PortableCrypto.PREFIX_SIZE);
            byte[] header = Arrays.copyOfRange(prefix, 0, KanataM6PortableCrypto.HEADER_SIZE);
            byte[] wrapNonce = Arrays.copyOfRange(prefix, 64, 76);
            byte[] wrappedBek = Arrays.copyOfRange(prefix, 76, 124);

            for (int i = 0; i < 8; i++) {
                KanataM6PortableCrypto.requirePortable(header[i] == KanataM6PortableCrypto.MAGIC[i],
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "header-magic");
            }
            int format = KanataM6PortableCrypto.readU16BE(header, 8);
            int suite = KanataM6PortableCrypto.readU16BE(header, 10);
            int profile = KanataM6PortableCrypto.readU16BE(header, 12);
            int hdrFlags = KanataM6PortableCrypto.readU16BE(header, 14);
            long iter = KanataM6PortableCrypto.readU32BE(header, 16);
            byte[] salt = Arrays.copyOfRange(header, 20, 36);
            byte[] backupId = Arrays.copyOfRange(header, 36, 52);
            int scope = header[52] & 0xff;
            int payload = header[53] & 0xff;
            long frameLimit = KanataM6PortableCrypto.readU32BE(header, 54);
            boolean reservedZero = true;
            for (int i = 58; i < 64; i++) if (header[i] != 0) reservedZero = false;

            KanataM6PortableCrypto.requirePortable(
                    format == KanataM6PortableCrypto.FORMAT_VERSION
                            && suite == KanataM6PortableCrypto.CIPHER_SUITE
                            && profile == KanataM6PortableCrypto.SYNTHETIC_PROFILE
                            && hdrFlags == 0
                            && iter == KanataM6PortableCrypto.SYNTHETIC_ITERATIONS
                            && scope == KanataM6PortableCrypto.SCOPE_KANATA_SINGLE
                            && payload == KanataM6PortableCrypto.PAYLOAD_LOGICAL_V1
                            && frameLimit == KanataM6PortableCrypto.FRAME_LIMIT
                            && reservedZero,
                    KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "header");

            if (hooks != null) hooks.onPhase("authenticating", 8);
            byte[] kekSalt = KanataM6PortableCrypto.concat(
                    "KPB1/KEK\0".getBytes(StandardCharsets.US_ASCII), salt, backupId);
            KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAllocInto(
                    pwBytes, kekSalt, (int) iter, KanataM6PortableCrypto.KEY_SIZE, cancelled, baseKek);
            KanataM6PortableCrypto.zeroize(pwBytes);

            wrapKey = KanataM6PortableCrypto.hkdfSha256(
                    baseKek, backupId,
                    KanataM6PortableCrypto.concat("KPB1/wrap\0".getBytes(StandardCharsets.US_ASCII), header),
                    KanataM6PortableCrypto.KEY_SIZE);
            KanataM6PortableCrypto.zeroize(baseKek);

            bek = KanataM6PortableCrypto.aesGcmDecrypt(
                    wrapKey, wrapNonce, wrappedBek, wrappedBek.length, header, "envelope");
            KanataM6PortableCrypto.requirePortable(bek.length == KanataM6PortableCrypto.KEY_SIZE,
                    KanataM6PortableCrypto.ERR_AUTH_FAILED, "bek-len");
            KanataM6PortableCrypto.zeroize(wrapKey);
            wrapKey = null;

            byte[] envelopeDigest = MessageDigest.getInstance("SHA-256").digest(prefix);
            MessageDigest transcriptSha = MessageDigest.getInstance("SHA-256");
            transcriptSha.update("KPB1/transcript\0".getBytes(StandardCharsets.US_ASCII));
            transcriptSha.update(envelopeDigest);

            manifestKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_MANIFEST),
                    KanataM6PortableCrypto.KEY_SIZE);
            dataKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_DATA, KanataM6PortableCrypto.FRAME_DATA),
                    KanataM6PortableCrypto.KEY_SIZE);
            footerKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_FOOTER),
                    KanataM6PortableCrypto.KEY_SIZE);

            // 2. Authenticate MANIFEST
            byte[] mfHdrBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
            FrameHeader mf = new FrameHeader(mfHdrBytes);
            KanataM6PortableCrypto.requirePortable(
                    mf.streamId == KanataM6PortableCrypto.STREAM_CONTROL
                            && mf.type == KanataM6PortableCrypto.FRAME_MANIFEST
                            && mf.flags == KanataM6PortableCrypto.FLAG_CONTINUE
                            && mf.index == 0L
                            && mf.plainLen == KanataM6PortableCrypto.MANIFEST_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "manifest-header");
            byte[] mfCipher = reader.readExact(mf.cipherLen);
            byte[] mfPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                    manifestKey,
                    buildFrameNonce(mf.streamId, mf.type, mf.index),
                    mfCipher, mfCipher.length,
                    KanataM6PortableCrypto.concat(envelopeDigest, mfHdrBytes),
                    "manifest-decrypt");
            try {
                KanataM6PortableCrypto.requirePortable(mfPlain.length == KanataM6PortableCrypto.MANIFEST_SIZE,
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "manifest-plain-len");
                transcriptSha.update(mfHdrBytes);
                transcriptSha.update(mfCipher);

                long appId = KanataM6PortableCrypto.readU32BE(mfPlain, 0);
                int schemaVer = KanataM6PortableCrypto.readU16BE(mfPlain, 4);
                byte[] mfFp = Arrays.copyOfRange(mfPlain, 6, 38);
                int taskPolicy = mfPlain[38] & 0xff;
                int profReserved = mfPlain[39] & 0xff;
                KanataM6PortableCrypto.requirePortable(
                        appId == KanataM6PortableCatalog.APPLICATION_ID
                                && schemaVer == KanataM6PortableCatalog.SCHEMA_VERSION
                                && taskPolicy == 1
                                && profReserved == 0,
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "manifest-format");
                KanataM6PortableCrypto.requirePortable(
                        KanataM6PortableCrypto.constantTimeEquals(mfFp, catalog.schemaFingerprintBytes),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "manifest-fp");
            } finally {
                KanataM6PortableCrypto.zeroize(mfPlain);
            }

            // 3. Open isolated temporary encrypted staging row buffer DB
            byte[] stageDek = KanataM6PortableCrypto.randomBytes(32);
            try {
                stageRowsKey = KanataKeyEnvelope.rawSqlCipherKey(stageDek);
            } finally {
                KanataM6PortableCrypto.zeroize(stageDek);
            }
            stageRowsDb = SQLiteDatabase.openDatabase(
                    stageRowsFile.getPath(), stageRowsKey, null,
                    SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    (d, e) -> {}, null);
            stageRowsDb.rawExecSQL("PRAGMA temp_store=MEMORY");
            stageRowsDb.rawExecSQL("PRAGMA cache_size=-2048");
            stageRowsDb.execSQL("CREATE TABLE staged_rows(table_id INTEGER NOT NULL, seq INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(table_id, seq))");
            stageRowsDb.execSQL("CREATE TABLE staged_deferred_replies(seq INTEGER PRIMARY KEY AUTOINCREMENT, reply_to_id BLOB NOT NULL, reply_to_rev INTEGER, msg_id BLOB NOT NULL)");
            stageRowsDb.execSQL("CREATE TABLE staged_deferred_tasks(seq INTEGER PRIMARY KEY AUTOINCREMENT, window_task_id BLOB NOT NULL, task_id BLOB NOT NULL)");
            stageRowsDb.execSQL("CREATE TABLE staged_deferred_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, replaces_event_id BLOB NOT NULL, event_id BLOB NOT NULL)");
            stageRowsDb.beginTransactionNonExclusive();

            // 4. Stream-decrypt DATA frames with bounded 1-frame buffer
            logicalDecoder = new LogicalStreamDecoder(catalog, stageRowsDb);
            int dataFrameCount = 0;
            long totalPlaintextBytes = 0L;
            long totalCiphertextBytes = 0L;
            long totalPackageBytes = KanataM6PortableCrypto.PREFIX_SIZE
                    + KanataM6PortableCrypto.FRAME_HEADER_SIZE + mf.cipherLen;
            boolean seenFinal = false;

            while (!seenFinal) {
                KanataM6PortableCrypto.checkCancelled(cancelled);
                byte[] dhBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
                FrameHeader df = new FrameHeader(dhBytes);
                KanataM6PortableCrypto.requirePortable(
                        df.streamId == KanataM6PortableCrypto.STREAM_DATA
                                && df.type == KanataM6PortableCrypto.FRAME_DATA
                                && df.index == dataFrameCount
                                && (df.flags == KanataM6PortableCrypto.FLAG_CONTINUE || df.flags == KanataM6PortableCrypto.FLAG_FINAL),
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-header");
                if (df.flags == KanataM6PortableCrypto.FLAG_CONTINUE) {
                    KanataM6PortableCrypto.requirePortable(df.plainLen == KanataM6PortableCrypto.FRAME_LIMIT,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-full-len");
                } else {
                    KanataM6PortableCrypto.requirePortable(df.plainLen >= 1,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-empty-final");
                }
                KanataM6PortableCrypto.requirePortable(
                        dataFrameCount < KanataM6PortableCrypto.MAX_DATA_FRAMES,
                        KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "data-frame-count");
                totalPlaintextBytes += df.plainLen;
                totalCiphertextBytes += df.cipherLen;
                totalPackageBytes += KanataM6PortableCrypto.FRAME_HEADER_SIZE + df.cipherLen;
                KanataM6PortableCrypto.requirePortable(
                        totalPlaintextBytes <= KanataM6PortableCrypto.MAX_DATA_PLAINTEXT_BYTES
                                && totalPackageBytes <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                        KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");

                byte[] dfCipher = reader.readExact(df.cipherLen);
                byte[] dfPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                        dataKey,
                        buildFrameNonce(df.streamId, df.type, df.index),
                        dfCipher, dfCipher.length,
                        KanataM6PortableCrypto.concat(envelopeDigest, dhBytes),
                        "data-decrypt:" + df.index);
                try {
                    KanataM6PortableCrypto.requirePortable(dfPlain.length == df.plainLen,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-plain-len");
                    transcriptSha.update(dhBytes);
                    transcriptSha.update(dfCipher);
                    dataFrameCount++;
                    logicalDecoder.push(dfPlain);
                } finally {
                    KanataM6PortableCrypto.zeroize(dfPlain);
                }
                if ((dataFrameCount & 31) == 0) {
                    res.sample();
                }
                if (df.flags == KanataM6PortableCrypto.FLAG_FINAL) seenFinal = true;
            }
            stageRowsDb.setTransactionSuccessful();
            stageRowsDb.endTransaction();

            // 5. Authenticate FOOTER and exact EOF
            byte[] fhBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
            FrameHeader ff = new FrameHeader(fhBytes);
            KanataM6PortableCrypto.requirePortable(
                    ff.streamId == KanataM6PortableCrypto.STREAM_CONTROL
                            && ff.type == KanataM6PortableCrypto.FRAME_FOOTER
                            && ff.flags == KanataM6PortableCrypto.FLAG_CONTINUE
                            && ff.index == 0L
                            && ff.plainLen == KanataM6PortableCrypto.FOOTER_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-frame-header");
            totalPackageBytes += KanataM6PortableCrypto.FRAME_HEADER_SIZE + ff.cipherLen;
            KanataM6PortableCrypto.requirePortable(totalPackageBytes <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");
            byte[] ffCipher = reader.readExact(ff.cipherLen);
            byte[] ffPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                    footerKey,
                    buildFrameNonce(ff.streamId, ff.type, ff.index),
                    ffCipher, ffCipher.length,
                    KanataM6PortableCrypto.concat(envelopeDigest, fhBytes),
                    "footer-decrypt");
            List<KanataM6SchemeCExporter.Verifier> footerVerifiers = new ArrayList<>(50);
            Map<Integer, KanataM6SchemeCExporter.Verifier> footerById = new HashMap<>();
            byte[] actualTranscript;
            try {
                KanataM6PortableCrypto.requirePortable(ffPlain.length == KanataM6PortableCrypto.FOOTER_SIZE,
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-plain-len");
                reader.assertEof();
                KanataM6PortableCrypto.checkCancelled(cancelled);

                actualTranscript = transcriptSha.digest();
                long fFrames = KanataM6PortableCrypto.readU32BE(ffPlain, 0);
                long fPlain = KanataM6PortableCrypto.readU64BE(ffPlain, 4);
                long fCipher = KanataM6PortableCrypto.readU64BE(ffPlain, 12);
                byte[] fTranscript = Arrays.copyOfRange(ffPlain, 20, 52);
                KanataM6PortableCrypto.requirePortable(
                        fFrames == dataFrameCount
                                && fPlain == totalPlaintextBytes
                                && fCipher == totalCiphertextBytes
                                && KanataM6PortableCrypto.constantTimeEquals(fTranscript, actualTranscript),
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-transcript-mismatch");

                int off = 52;
                for (int i = 0; i < 50; i++) {
                    int tid = KanataM6PortableCrypto.readU16BE(ffPlain, off);
                    long rc = KanataM6PortableCrypto.readU64BE(ffPlain, off + 2);
                    byte[] dg = Arrays.copyOfRange(ffPlain, off + 10, off + 42);
                    KanataM6PortableCrypto.requirePortable(
                            tid == catalog.footerTables.get(i).tableId,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "footer-table-order");
                    KanataM6SchemeCExporter.Verifier v = new KanataM6SchemeCExporter.Verifier(tid, rc, dg);
                    footerVerifiers.add(v);
                    footerById.put(tid, v);
                    off += KanataM6PortableCrypto.FOOTER_VERIFIER_SIZE;
                }
            } finally {
                KanataM6PortableCrypto.zeroize(ffPlain);
            }

            List<KanataM6SchemeCExporter.Verifier> bizVerifiers = logicalDecoder.finish();
            for (KanataM6SchemeCExporter.Verifier actual : bizVerifiers) {
                KanataM6SchemeCExporter.Verifier expected = footerById.get(actual.tableId);
                KanataM6PortableCrypto.requirePortable(
                        expected != null
                                && expected.rowCount == actual.rowCount
                                && KanataM6PortableCrypto.constantTimeEquals(expected.digest, actual.digest),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "table-verifier:" + actual.tableId);
            }
            long decodeMs = SystemClock.elapsedRealtime() - startDecode;
            res.sample();

            // 6. Optional M6-00 KanataKeyEnvelope generation if caller supplied KEK instead of raw key
            if (effectiveTargetKey == null) {
                KanataM6PortableCrypto.requirePortable(
                        optionalLocalKekForEnvelope != null && optionalLocalKekForEnvelope.length == 32,
                        KanataM6PortableCrypto.ERR_AUTH_FAILED, "missing-target-key");
                envelopeFile = new File(stagingDir, ".stage-envelope-" + taskId + "-" + stageNonce + ".json");
                byte[] freshDek = KanataKeyEnvelope.create(
                        new AtomicFile(envelopeFile), KanataKeyEnvelope.newHeader(), optionalLocalKekForEnvelope);
                try {
                    derivedTargetKey = KanataKeyEnvelope.rawSqlCipherKey(freshDek);
                    effectiveTargetKey = derivedTargetKey;
                } finally {
                    KanataM6PortableCrypto.zeroize(freshDek);
                }
            }

            // 7. Create isolated SQLCipher staging DB with fixed Schema 005 and install in atomic batches
            if (hooks != null) hooks.onPhase("staging_import", 35);
            long startInstall = SystemClock.elapsedRealtime();
            targetStageDb = SQLiteDatabase.openDatabase(
                    targetStageFile.getPath(), effectiveTargetKey, null,
                    SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    (d, e) -> {}, null);
            catalog.initSchema(targetStageDb, 5, false);
            targetStageDb.rawExecSQL("PRAGMA cache_size=-2048");

            BatchStats batchStats = installStagedRowsInBatches(
                    catalog, stageRowsDb, targetStageDb, batchSize, cancelled, hooks, res);
            long stagingInstallMs = SystemClock.elapsedRealtime() - startInstall;
            res.sample();

            if (hooks != null) {
                hooks.afterStagingInstallBeforeVerify(targetStageDb);
                hooks.onPhase("verifying_staging", 85);
            }

            // 8. Full 12-point verification on isolated staging DB BEFORE returning to coordinator
            long startVerify = SystemClock.elapsedRealtime();
            DatasetSummary summary = verifyStagingDatabase(catalog, targetStageDb, footerById, cancelled, res);

            // Checkpoint TRUNCATE and close cleanly so staging DB is self-contained without sidecars
            try (Cursor ck = targetStageDb.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                KanataM6PortableCrypto.requirePortable(ck.moveToFirst() && ck.getInt(0) == 0,
                        KanataM6PortableCrypto.ERR_IO_FAILED, "staging-checkpoint-busy");
            }
            targetStageDb.close();
            targetStageDb = null;

            File stageWal = new File(targetStageFile.getPath() + "-wal");
            File stageShm = new File(targetStageFile.getPath() + "-shm");
            if ((stageWal.exists() && stageWal.length() > 0L) || (stageShm.exists() && stageShm.length() > 0L)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "staging-sidecars-left");
            }
            if (stageWal.exists()) stageWal.delete();
            if (stageShm.exists()) stageShm.delete();

            KanataM6SchemeCExporter.fsyncFileStrict(targetStageFile);
            String stageSha256Hex = KanataM6SchemeCExporter.computeFileSha256Hex(targetStageFile);
            long verifyMs = SystemClock.elapsedRealtime() - startVerify;
            long totalRestoreMs = SystemClock.elapsedRealtime() - startTotal;
            res.sample();

            if (hooks != null) {
                hooks.afterStagingVerified(targetStageFile, stageSha256Hex);
                hooks.onPhase("awaiting_confirmation", 100);
            }
            KanataM6PortableCrypto.checkCancelled(cancelled);

            RestoreMetrics metrics = new RestoreMetrics(
                    totalRestoreMs,
                    decodeMs,
                    stagingInstallMs,
                    verifyMs,
                    batchSize,
                    batchStats.batchCount,
                    batchStats.maxBatchRows,
                    batchStats.maxBatchMs,
                    batchStats.medianBatchMs(),
                    targetStageFile.length(),
                    res.peakRssKiB,
                    res.peakJavaHeapBytes,
                    res.peakNativeHeapBytes,
                    res.webViewRssKiB,
                    dataFrameCount,
                    totalPlaintextBytes,
                    totalCiphertextBytes,
                    logicalDecoder.totalBusinessRows);

            succeeded = true;
            return new PreparedStagingArtifact(
                    taskId,
                    targetStageFile,
                    stageSha256Hex,
                    envelopeFile,
                    catalog.schemaFingerprintHex,
                    summary.datasetIdentity,
                    summary.worldCount,
                    summary.messageCount,
                    KanataM6PortableCrypto.bytesToHex(actualTranscript),
                    Collections.unmodifiableList(footerVerifiers),
                    metrics);
        } catch (KanataM6PortableCrypto.PortableException pe) {
            throw pe;
        } catch (IOException ioe) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "staging-io", ioe);
        } finally {
            if (targetStageDb != null) {
                try {
                    if (targetStageDb.inTransaction()) targetStageDb.endTransaction();
                } catch (Throwable ignored) {}
                try {
                    targetStageDb.close();
                } catch (Throwable ignored) {}
            }
            if (!succeeded) {
                SQLiteDatabase.deleteDatabase(targetStageFile);
                if (envelopeFile != null && envelopeFile.exists()) {
                    envelopeFile.delete();
                }
            }
            if (logicalDecoder != null) {
                logicalDecoder.close();
            }
            if (stageRowsDb != null) {
                try {
                    if (stageRowsDb.inTransaction()) stageRowsDb.endTransaction();
                } catch (Throwable ignored) {}
                try {
                    stageRowsDb.close();
                } catch (Throwable ignored) {}
            }
            SQLiteDatabase.deleteDatabase(stageRowsFile);
            KanataM6PortableCrypto.zeroize(
                    pwBytes, baseKek, wrapKey, bek, manifestKey, dataKey, footerKey, stageRowsKey, derivedTargetKey);
        }
    }

    private static final class BatchStats {
        int batchCount = 0;
        int maxBatchRows = 0;
        long maxBatchMs = 0L;
        final List<Long> batchDurations = new ArrayList<>();

        void record(int rows, long durationMs) {
            batchCount++;
            if (rows > maxBatchRows) maxBatchRows = rows;
            if (durationMs > maxBatchMs) maxBatchMs = durationMs;
            batchDurations.add(durationMs);
        }

        long medianBatchMs() {
            if (batchDurations.isEmpty()) return 0L;
            List<Long> sorted = new ArrayList<>(batchDurations);
            Collections.sort(sorted);
            return sorted.get(sorted.size() / 2);
        }
    }

    private static BatchStats installStagedRowsInBatches(
            KanataM6PortableCatalog catalog,
            SQLiteDatabase stageRowsDb,
            SQLiteDatabase targetStageDb,
            int batchSize,
            AtomicBoolean cancelled,
            StagingHooks hooks,
            ResourceTracker res) throws Exception {
        BatchStats stats = new BatchStats();
        int batchIndex = 0;
        List<String> order = catalog.installOrder;

        SQLiteStatement insertDefReply = stageRowsDb.compileStatement(
                "INSERT INTO staged_deferred_replies(reply_to_id, reply_to_rev, msg_id) VALUES(?, ?, ?)");
        SQLiteStatement insertDefTask = stageRowsDb.compileStatement(
                "INSERT INTO staged_deferred_tasks(window_task_id, task_id) VALUES(?, ?)");
        SQLiteStatement insertDefEvent = stageRowsDb.compileStatement(
                "INSERT INTO staged_deferred_events(replaces_event_id, event_id) VALUES(?, ?)");

        try {
            int idx = 0;
            while (idx < order.size()) {
                KanataM6PortableCrypto.checkCancelled(cancelled);
                String tableName = order.get(idx);

                // Coupled mutual-FK pairs must commit in a single atomic transaction:
                // (worlds + world_identities) and (character_cards + card_versions).
                if ("worlds".equals(tableName) && idx + 1 < order.size() && "world_identities".equals(order.get(idx + 1))) {
                    long t0 = SystemClock.elapsedRealtime();
                    int coupledRows = installCoupledPairAtomic(
                            catalog, stageRowsDb, targetStageDb, "worlds", "world_identities",
                            batchIndex, cancelled, hooks);
                    long elapsed = SystemClock.elapsedRealtime() - t0;
                    if (coupledRows > 0) {
                        stats.record(coupledRows, elapsed);
                        if (hooks != null) hooks.afterBatchCommit("worlds+world_identities", batchIndex, coupledRows, elapsed);
                        batchIndex++;
                    }
                    idx += 2;
                    continue;
                }
                if ("character_cards".equals(tableName) && idx + 1 < order.size() && "card_versions".equals(order.get(idx + 1))) {
                    long t0 = SystemClock.elapsedRealtime();
                    int coupledRows = installCoupledPairAtomic(
                            catalog, stageRowsDb, targetStageDb, "character_cards", "card_versions",
                            batchIndex, cancelled, hooks);
                    long elapsed = SystemClock.elapsedRealtime() - t0;
                    if (coupledRows > 0) {
                        stats.record(coupledRows, elapsed);
                        if (hooks != null) hooks.afterBatchCommit("character_cards+card_versions", batchIndex, coupledRows, elapsed);
                        batchIndex++;
                    }
                    idx += 2;
                    continue;
                }

                KanataM6PortableCatalog.TableDef tableDef = catalog.byName.get(tableName);
                String insertSql = buildInsertSql(tableDef);
                long offsetSeq = 0L;

                try (SQLiteStatement stmt = targetStageDb.compileStatement(insertSql)) {
                    while (true) {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        List<Long> seqs = new ArrayList<>(batchSize);
                        try (Cursor c = stageRowsDb.rawQuery(
                                "SELECT seq FROM staged_rows WHERE table_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?",
                                new Object[] { tableDef.tableId, offsetSeq, batchSize })) {
                            while (c.moveToNext()) {
                                seqs.add(c.getLong(0));
                            }
                        }
                        if (seqs.isEmpty()) break;

                        long t0 = SystemClock.elapsedRealtime();
                        int rowsInBatch = 0;
                        stageRowsDb.beginTransactionNonExclusive();
                        targetStageDb.beginTransactionNonExclusive();
                        try {
                            for (long seq : seqs) {
                                KanataM6PortableCrypto.checkCancelled(cancelled);
                                byte[] body = readStagedRowBodyBounded(stageRowsDb, tableDef.tableId, seq);
                                Object[] decoded = null;
                                try {
                                    decoded = decodeBodyValues(tableDef, body);
                                    stmt.clearBindings();
                                    for (int i = 0; i < tableDef.columns.size(); i++) {
                                        String cname = tableDef.columns.get(i).name;
                                        Object val = decoded[i];
                                        if ("messages".equals(tableName)
                                                && ("reply_to_message_id".equals(cname) || "reply_to_revision".equals(cname))) {
                                            val = null;
                                        } else if ("background_tasks".equals(tableName) && "window_task_id".equals(cname)) {
                                            val = null;
                                        } else if ("world_events".equals(tableName) && "replaces_event_id".equals(cname)) {
                                            val = null;
                                        }
                                        bindValue(stmt, i + 1, val);
                                    }
                                    stmt.executeInsert();
                                    rowsInBatch++;

                                    if ("messages".equals(tableName)) {
                                        int rIdCid = tableDef.columnsByName.get("reply_to_message_id").cid;
                                        int rRevCid = tableDef.columnsByName.get("reply_to_revision").cid;
                                        int idCid = tableDef.columnsByName.get("id").cid;
                                        if (decoded[rIdCid] != null) {
                                            insertDefReply.clearBindings();
                                            bindValue(insertDefReply, 1, decoded[rIdCid]);
                                            bindValue(insertDefReply, 2, decoded[rRevCid]);
                                            bindValue(insertDefReply, 3, decoded[idCid]);
                                            insertDefReply.executeInsert();
                                        }
                                    } else if ("background_tasks".equals(tableName)) {
                                        int wtCid = tableDef.columnsByName.get("window_task_id").cid;
                                        int idCid = tableDef.columnsByName.get("id").cid;
                                        if (decoded[wtCid] != null) {
                                            insertDefTask.clearBindings();
                                            bindValue(insertDefTask, 1, decoded[wtCid]);
                                            bindValue(insertDefTask, 2, decoded[idCid]);
                                            insertDefTask.executeInsert();
                                        }
                                    } else if ("world_events".equals(tableName)) {
                                        int repCid = tableDef.columnsByName.get("replaces_event_id").cid;
                                        int idCid = tableDef.columnsByName.get("id").cid;
                                        if (decoded[repCid] != null) {
                                            insertDefEvent.clearBindings();
                                            bindValue(insertDefEvent, 1, decoded[repCid]);
                                            bindValue(insertDefEvent, 2, decoded[idCid]);
                                            insertDefEvent.executeInsert();
                                        }
                                    }
                                } finally {
                                    KanataM6PortableCrypto.zeroize(body);
                                    zeroizeObjectArray(decoded);
                                }
                            }
                            if (hooks != null) {
                                hooks.beforeBatchCommit(tableName, batchIndex, rowsInBatch, targetStageDb);
                            }
                            targetStageDb.setTransactionSuccessful();
                            stageRowsDb.setTransactionSuccessful();
                        } finally {
                            targetStageDb.endTransaction();
                            stageRowsDb.endTransaction();
                        }
                        long elapsed = SystemClock.elapsedRealtime() - t0;
                        stats.record(rowsInBatch, elapsed);
                        if (hooks != null) hooks.afterBatchCommit(tableName, batchIndex, rowsInBatch, elapsed);
                        batchIndex++;
                        offsetSeq = seqs.get(seqs.size() - 1) + 1L;
                        if ((batchIndex & 7) == 0) res.sample();
                    }
                }
                idx++;
            }

            // Pass 2: Batched atomic backfills from encrypted stageRowsDb (O(batchSize) heap!)
            batchIndex = applyDeferredBackfillBatches(
                    stageRowsDb, targetStageDb, "staged_deferred_replies",
                    "SELECT seq, reply_to_id, reply_to_rev, msg_id FROM staged_deferred_replies WHERE seq >= ? ORDER BY seq ASC LIMIT ?",
                    "UPDATE messages SET reply_to_message_id = CAST(? AS TEXT), reply_to_revision = ? WHERE id = CAST(? AS TEXT)",
                    3, batchSize, batchIndex, stats, cancelled, hooks, res);
            batchIndex = applyDeferredBackfillBatches(
                    stageRowsDb, targetStageDb, "staged_deferred_tasks",
                    "SELECT seq, window_task_id, task_id FROM staged_deferred_tasks WHERE seq >= ? ORDER BY seq ASC LIMIT ?",
                    "UPDATE background_tasks SET window_task_id = CAST(? AS TEXT) WHERE id = CAST(? AS TEXT)",
                    2, batchSize, batchIndex, stats, cancelled, hooks, res);
            applyDeferredBackfillBatches(
                    stageRowsDb, targetStageDb, "staged_deferred_events",
                    "SELECT seq, replaces_event_id, event_id FROM staged_deferred_events WHERE seq >= ? ORDER BY seq ASC LIMIT ?",
                    "UPDATE world_events SET replaces_event_id = CAST(? AS TEXT) WHERE id = CAST(? AS TEXT)",
                    2, batchSize, batchIndex, stats, cancelled, hooks, res);
        } finally {
            insertDefReply.close();
            insertDefTask.close();
            insertDefEvent.close();
        }
        return stats;
    }

    private static int applyDeferredBackfillBatches(
            SQLiteDatabase stageRowsDb,
            SQLiteDatabase targetStageDb,
            String label,
            String selectSql,
            String updateSql,
            int paramCount,
            int batchSize,
            int batchIndex,
            BatchStats stats,
            AtomicBoolean cancelled,
            StagingHooks hooks,
            ResourceTracker res) throws Exception {
        long nextSeq = 1L;
        try (SQLiteStatement updateStmt = targetStageDb.compileStatement(updateSql)) {
            while (true) {
                KanataM6PortableCrypto.checkCancelled(cancelled);
                List<Object[]> batch = new ArrayList<>(batchSize);
                long lastSeq = nextSeq - 1L;
                try (Cursor c = stageRowsDb.rawQuery(selectSql, new Object[] { nextSeq, batchSize })) {
                    while (c.moveToNext()) {
                        lastSeq = c.getLong(0);
                        Object[] row = new Object[paramCount];
                        for (int i = 0; i < paramCount; i++) {
                            int colIdx = i + 1;
                            int t = c.getType(colIdx);
                            if (t == Cursor.FIELD_TYPE_NULL) row[i] = null;
                            else if (t == Cursor.FIELD_TYPE_INTEGER) row[i] = c.getLong(colIdx);
                            else if (t == Cursor.FIELD_TYPE_BLOB) row[i] = c.getBlob(colIdx);
                            else row[i] = c.getString(colIdx);
                        }
                        batch.add(row);
                    }
                }
                if (batch.isEmpty()) break;

                long t0 = SystemClock.elapsedRealtime();
                targetStageDb.beginTransactionNonExclusive();
                try {
                    for (Object[] row : batch) {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        updateStmt.clearBindings();
                        for (int i = 0; i < paramCount; i++) {
                            bindValue(updateStmt, i + 1, row[i]);
                        }
                        updateStmt.executeUpdateDelete();
                    }
                    if (hooks != null) {
                        hooks.beforeBatchCommit(label, batchIndex, batch.size(), targetStageDb);
                    }
                    targetStageDb.setTransactionSuccessful();
                } finally {
                    for (Object[] row : batch) zeroizeObjectArray(row);
                    targetStageDb.endTransaction();
                }
                long elapsed = SystemClock.elapsedRealtime() - t0;
                stats.record(batch.size(), elapsed);
                if (hooks != null) hooks.afterBatchCommit(label, batchIndex, batch.size(), elapsed);
                batchIndex++;
                nextSeq = lastSeq + 1L;
                if ((batchIndex & 7) == 0) res.sample();
            }
        }
        return batchIndex;
    }

    private static int installCoupledPairAtomic(
            KanataM6PortableCatalog catalog,
            SQLiteDatabase stageRowsDb,
            SQLiteDatabase targetStageDb,
            String tableA,
            String tableB,
            int batchIndex,
            AtomicBoolean cancelled,
            StagingHooks hooks) throws Exception {
        int totalRows = 0;
        targetStageDb.beginTransactionNonExclusive();
        try {
            for (String tn : new String[] { tableA, tableB }) {
                KanataM6PortableCatalog.TableDef td = catalog.byName.get(tn);
                try (SQLiteStatement stmt = targetStageDb.compileStatement(buildInsertSql(td));
                     Cursor c = stageRowsDb.rawQuery(
                             "SELECT seq FROM staged_rows WHERE table_id = ? ORDER BY seq ASC",
                             new Object[] { td.tableId })) {
                    while (c.moveToNext()) {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        long seq = c.getLong(0);
                        byte[] body = readStagedRowBodyBounded(stageRowsDb, td.tableId, seq);
                        Object[] decoded = null;
                        try {
                            decoded = decodeBodyValues(td, body);
                            stmt.clearBindings();
                            for (int i = 0; i < td.columns.size(); i++) {
                                bindValue(stmt, i + 1, decoded[i]);
                            }
                            stmt.executeInsert();
                            totalRows++;
                        } finally {
                            KanataM6PortableCrypto.zeroize(body);
                            zeroizeObjectArray(decoded);
                        }
                    }
                }
            }
            if (totalRows > 0 && hooks != null) {
                hooks.beforeBatchCommit(tableA + "+" + tableB, batchIndex, totalRows, targetStageDb);
            }
            targetStageDb.setTransactionSuccessful();
            return totalRows;
        } finally {
            targetStageDb.endTransaction();
        }
    }

    private static String buildInsertSql(KanataM6PortableCatalog.TableDef tableDef) {
        StringBuilder colNames = new StringBuilder();
        StringBuilder placeholders = new StringBuilder();
        for (int i = 0; i < tableDef.columns.size(); i++) {
            if (i > 0) {
                colNames.append(", ");
                placeholders.append(", ");
            }
            colNames.append(tableDef.columns.get(i).name);
            if (tableDef.columns.get(i).type == KanataM6PortableCatalog.ColType.TEXT) {
                placeholders.append("CAST(? AS TEXT)");
            } else {
                placeholders.append('?');
            }
        }
        return "INSERT INTO " + tableDef.name + "(" + colNames + ") VALUES(" + placeholders + ")";
    }

    private static byte[] readStagedRowBodyBounded(SQLiteDatabase stageRowsDb, int tableId, long seq) {
        int bodyLen;
        byte[] direct = null;
        try (Cursor c = stageRowsDb.rawQuery(
                "SELECT length(body), CASE WHEN length(body) <= 262144 THEN body ELSE NULL END FROM staged_rows WHERE table_id = ? AND seq = ?",
                new Object[] { tableId, seq })) {
            KanataM6PortableCrypto.requirePortable(c.moveToFirst(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "stage-row-missing");
            bodyLen = (int) c.getLong(0);
            if (bodyLen <= 262_144) {
                direct = c.getBlob(1);
            }
        }
        if (direct != null) return direct;
        byte[] body = new byte[bodyLen];
        int copied = 0;
        while (copied < bodyLen) {
            int take = Math.min(262_144, bodyLen - copied);
            try (Cursor cc = stageRowsDb.rawQuery(
                    "SELECT substr(body, ?, ?) FROM staged_rows WHERE table_id = ? AND seq = ?",
                    new Object[] { copied + 1, take, tableId, seq })) {
                KanataM6PortableCrypto.requirePortable(cc.moveToFirst(),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "stage-chunk-missing");
                byte[] piece = cc.getBlob(0);
                try {
                    KanataM6PortableCrypto.requirePortable(piece != null && piece.length == take,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "stage-chunk-len");
                    System.arraycopy(piece, 0, body, copied, take);
                } finally {
                    KanataM6PortableCrypto.zeroize(piece);
                }
            }
            copied += take;
        }
        return body;
    }

    private static final class DatasetSummary {
        final String datasetIdentity;
        final long worldCount;
        final long messageCount;

        DatasetSummary(String datasetIdentity, long worldCount, long messageCount) {
            this.datasetIdentity = datasetIdentity;
            this.worldCount = worldCount;
            this.messageCount = messageCount;
        }
    }

    private static DatasetSummary verifyStagingDatabase(
            KanataM6PortableCatalog catalog,
            SQLiteDatabase targetDb,
            Map<Integer, KanataM6SchemeCExporter.Verifier> footerById,
            AtomicBoolean cancelled,
            ResourceTracker res) throws Exception {
        KanataM6PortableCrypto.checkCancelled(cancelled);

        // 1. Metadata & schema contract checks
        String userVersion = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA user_version");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(KanataM6PortableCatalog.SCHEMA_VERSION).equals(userVersion),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-user-version:" + userVersion);
        String appId = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA application_id");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(KanataM6PortableCatalog.APPLICATION_ID).equals(appId),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-app-id:" + appId);
        KanataM6PortableCrypto.requirePortable(
                KanataM6PortableCatalog.EXPECTED_SCHEMA_005_FP.equals(catalog.schemaFingerprintHex),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-schema-fp");
        String tableCount = KanataM6SnapshotOwner.scalar(targetDb,
                "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(catalog.allTables.size()).equals(tableCount),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-table-count:" + tableCount);

        for (KanataM6PortableCatalog.TableDef td : catalog.allTables) {
            int colIdx = 0;
            try (Cursor ti = targetDb.rawQuery("PRAGMA table_info(" + td.name + ")", new Object[0])) {
                while (ti.moveToNext()) {
                    KanataM6PortableCrypto.requirePortable(colIdx < td.columns.size(),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-col-extra:" + td.name);
                    KanataM6PortableCatalog.ColumnDef expectedCol = td.columns.get(colIdx);
                    String actualName = ti.getString(1);
                    String actualType = ti.getString(2);
                    boolean actualNotNull = ti.getInt(3) != 0;
                    int actualPk = ti.getInt(5);
                    KanataM6PortableCrypto.requirePortable(
                            expectedCol.name.equals(actualName)
                                    && expectedCol.type.name().equalsIgnoreCase(actualType)
                                    && expectedCol.notnull == actualNotNull
                                    && expectedCol.pk == actualPk,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL,
                            "staging-col-mismatch:" + td.name + "." + expectedCol.name);
                    colIdx++;
                }
            }
            KanataM6PortableCrypto.requirePortable(colIdx == td.columns.size(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-col-missing:" + td.name);
        }

        // 2. Runtime tables excluded (must be empty)
        for (KanataM6PortableCatalog.TableDef rt : catalog.runtimeTables) {
            String rtCount = KanataM6SnapshotOwner.scalar(targetDb, "SELECT count(*) FROM " + rt.name);
            KanataM6PortableCrypto.requirePortable("0".equals(rtCount),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-runtime-nonempty:" + rt.name);
        }

        // 3. SQLite integrity, SQLCipher integrity, FK, and Schema 005 ordinal completeness
        String integrity = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA integrity_check");
        KanataM6PortableCrypto.requirePortable("ok".equals(integrity),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-integrity");
        try (Cursor c = targetDb.rawQuery("PRAGMA cipher_integrity_check", new Object[0])) {
            KanataM6PortableCrypto.requirePortable(!c.moveToNext(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-cipher-integrity");
        }
        try (Cursor c = targetDb.rawQuery("SELECT * FROM pragma_foreign_key_check", new Object[0])) {
            KanataM6PortableCrypto.requirePortable(!c.moveToNext(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-fk");
        }
        KanataM6SnapshotOwner.verifySchema005Ordinals(targetDb);

        // 4. Verify pause-sending-v1 on background_tasks
        try (Cursor bt = targetDb.rawQuery("SELECT kind, state, lease_until FROM background_tasks", new Object[0])) {
            while (bt.moveToNext()) {
                String kind = bt.getString(0);
                String state = bt.getString(1);
                long leaseUntil = bt.getLong(2);
                KanataM6PortableCrypto.requirePortable(leaseUntil == 0L,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-task-lease");
                if ("reply".equals(kind) || "proactive".equals(kind) || "followup".equals(kind)) {
                    KanataM6PortableCrypto.requirePortable(
                            !"pending".equals(state) && !"running".equals(state) && !"failed".equals(state),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-task-state:" + kind + ":" + state);
                } else {
                    KanataM6PortableCrypto.requirePortable(!"running".equals(state),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-task-state:" + kind + ":" + state);
                }
            }
        }

        // 5. Verify dataset_metadata identity & extract safe metadata summary
        String datasetIdentity = "empty";
        try (Cursor dm = targetDb.rawQuery("SELECT user_id, data_version FROM dataset_metadata WHERE singleton = 1", new Object[0])) {
            if (dm.moveToFirst()) {
                String uid = dm.getString(0);
                int dv = dm.getInt(1);
                KanataM6PortableCrypto.requirePortable(uid != null && !uid.isEmpty() && (dv == 1 || dv == 2),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-dataset-metadata");
                MessageDigest idSha = MessageDigest.getInstance("SHA-256");
                idSha.update(("kanata-dataset-v" + dv + ":" + uid).getBytes(StandardCharsets.UTF_8));
                datasetIdentity = "kds-" + KanataM6PortableCrypto.bytesToHex(idSha.digest()).substring(0, 16);
            }
        }
        long worldCount = Long.parseLong(KanataM6SnapshotOwner.scalar(targetDb, "SELECT count(*) FROM worlds"));
        long messageCount = Long.parseLong(KanataM6SnapshotOwner.scalar(targetDb, "SELECT count(*) FROM messages"));

        // 6. Verify ALL 50 Footer verifiers (45 business + 5 derived tables)
        KanataM6PortableCrypto.requirePortable(
                footerById.size() == KanataM6PortableCrypto.FOOTER_TABLE_COUNT,
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-footer-size");
        byte[] tableDomainPrefix = "KPB1/table\0".getBytes(StandardCharsets.US_ASCII);
        byte[] lenBuf = new byte[4];
        Set<Integer> verifiedIds = new HashSet<>(50);

        for (KanataM6PortableCatalog.TableDef td : catalog.footerTables) {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            MessageDigest tblSha = MessageDigest.getInstance("SHA-256");
            tblSha.update(tableDomainPrefix);
            byte[] tidBytes = new byte[2];
            KanataM6PortableCrypto.writeU16BE(tidBytes, 0, td.tableId);
            tblSha.update(tidBytes);
            long rowCount = 0L;
            String sql = KanataM6BoundedRowReader.buildSelectSql(td);
            try (Cursor c = targetDb.rawQuery(sql, new Object[0])) {
                while (c.moveToNext()) {
                    if ((rowCount & 511L) == 0L) {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                    }
                    KanataM6BoundedRowReader.EncodedRow row = KanataM6BoundedRowReader.readAndEncodeCurrentRow(
                            targetDb, c, td, false, true);
                    try {
                        KanataM6PortableCrypto.writeU32BE(lenBuf, 0, row.bodyLen);
                        tblSha.update(lenBuf);
                        tblSha.update(row.body, 0, row.bodyLen);
                        rowCount++;
                    } finally {
                        KanataM6PortableCrypto.zeroize(row.body);
                        if (row.pkTextBytes != null) {
                            for (byte[] pb : row.pkTextBytes) KanataM6PortableCrypto.zeroize(pb);
                        }
                        KanataM6PortableCrypto.zeroize(row.ordinalWorldIdBytes);
                    }
                }
            }
            byte[] actualDigest = tblSha.digest();
            KanataM6SchemeCExporter.Verifier expected = footerById.get(td.tableId);
            KanataM6PortableCrypto.requirePortable(
                    expected != null
                            && expected.rowCount == rowCount
                            && KanataM6PortableCrypto.constantTimeEquals(expected.digest, actualDigest),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-table-mismatch:" + td.name);
            verifiedIds.add(td.tableId);
            res.sample();
        }
        KanataM6PortableCrypto.requirePortable(
                verifiedIds.size() == KanataM6PortableCrypto.FOOTER_TABLE_COUNT,
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "staging-verified-count");

        return new DatasetSummary(datasetIdentity, worldCount, messageCount);
    }

    /**
     * Phase 2a: Capture reliable previous generation snapshot under WriteGate drain before journal prepare.
     */
    public static CapturedPreviousGeneration capturePreviousGeneration(
            File activeDbFile,
            byte[] activeRawKey,
            File rollbackDir,
            String explicitTaskId,
            KanataM6SnapshotOwner.WriteGate writeGate) throws Exception {
        String taskId = sanitizeTaskId(explicitTaskId);
        if (!rollbackDir.exists() && !rollbackDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "rollback-dir-mkdir");
        }
        if (writeGate != null) {
            writeGate.beginSnapshotFreezeAndDrain(10_000L);
        }
        try {
            File activeAbs = activeDbFile.getAbsoluteFile();
            if (!activeAbs.exists()) {
                return new CapturedPreviousGeneration(taskId, true, null, "");
            }
            // Checkpoint active DB cleanly before copying rollback snapshot
            if (activeRawKey != null) {
                try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(
                        activeAbs.getPath(), activeRawKey, null,
                        SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                        (d, e) -> {}, null)) {
                    try (Cursor ck = rw.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                        KanataM6PortableCrypto.requirePortable(ck.moveToFirst() && ck.getInt(0) == 0,
                                KanataM6PortableCrypto.ERR_IO_FAILED, "previous-checkpoint-busy");
                    }
                }
            }
            File rollbackFile = new File(rollbackDir, ".rollback-" + taskId + ".db");
            copyFileWithFsync(activeAbs, rollbackFile);
            String sha = KanataM6SchemeCExporter.computeFileSha256Hex(rollbackFile);
            return new CapturedPreviousGeneration(taskId, false, rollbackFile, sha);
        } finally {
            if (writeGate != null) {
                writeGate.endSnapshotFreeze();
            }
        }
    }

    /**
     * Phase 2b: Coordinator-controlled idempotent atomic apply of a verified generation (target or previous).
     * Preserves sourceDbFile on disk so repeated crash-recovery replays remain idempotent!
     * Uses FIX-04 stable target .lock file (never unlinked on close).
     */
    public static void applyVerifiedGeneration(
            File sourceDbFile,
            String expectedSha256Hex,
            boolean targetAbsent,
            File activeDbFile,
            byte[] verifyRawKey,
            String explicitTaskId,
            AtomicBoolean cancelled,
            ApplyHooks hooks) throws Exception {
        String taskId = sanitizeTaskId(explicitTaskId);
        File activeAbs = activeDbFile.getAbsoluteFile();
        File parentDir = activeAbs.getParentFile();
        KanataM6PortableCrypto.requirePortable(parentDir != null, KanataM6PortableCrypto.ERR_IO_FAILED, "active-parent-null");
        if (!parentDir.exists() && !parentDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "active-parent-mkdir");
        }

        try (KanataM6SchemeCImporter.TargetCommitLockHandle commitLock =
                     KanataM6SchemeCImporter.acquireTargetCommitLock(activeAbs, cancelled)) {
            if (hooks != null) {
                commitLock.beforeOsReleaseHook = () ->
                        hooks.beforeLockRelease(commitLock.lockFile, commitLock.lockDev, commitLock.lockIno);
                hooks.afterLockAcquired(activeAbs);
            }
            KanataM6PortableCrypto.checkCancelled(cancelled);

            // Handle rollback to absent previous DB
            if (targetAbsent) {
                SQLiteDatabase.deleteDatabase(activeAbs);
                if (hooks != null) {
                    hooks.performTargetDirFsync(parentDir);
                } else {
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(parentDir);
                }
                return;
            }

            KanataM6PortableCrypto.requirePortable(
                    expectedSha256Hex != null && expectedSha256Hex.length() == 64,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "apply-expected-sha-invalid");

            // Idempotency check: if activeDbFile ALREADY matches expectedSha256Hex cleanly, confirm dir fsync!
            if (activeAbs.exists() && !hasDirtySidecars(activeAbs)) {
                String currentSha = KanataM6SchemeCExporter.computeFileSha256Hex(activeAbs);
                if (expectedSha256Hex.equals(currentSha)) {
                    verifyActiveQuickIntegrity(activeAbs, verifyRawKey);
                    try {
                        if (hooks != null) hooks.performTargetDirFsync(parentDir);
                        else KanataM6SchemeCExporter.fsyncDirectoryStrict(parentDir);
                    } catch (IOException dirErr) {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, "apply-idempotent-dir-fsync", dirErr);
                    }
                    return;
                }
            }

            // Otherwise verify sourceDbFile matches expectedSha256Hex before writing
            KanataM6PortableCrypto.requirePortable(
                    sourceDbFile != null && sourceDbFile.isFile(),
                    KanataM6PortableCrypto.ERR_IO_FAILED, "apply-source-missing");
            String sourceSha = KanataM6SchemeCExporter.computeFileSha256Hex(sourceDbFile);
            KanataM6PortableCrypto.requirePortable(
                    expectedSha256Hex.equals(sourceSha),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "apply-source-sha-mismatch");

            // Copy source to same-filesystem atomic tmp file (preserves sourceDbFile for idempotent crash replay!)
            String nonce = UUID.randomUUID().toString().substring(0, 8);
            File applyTmp = new File(parentDir, ".stage-target-" + taskId + "-" + nonce + ".db");
            File importJournal = new File(parentDir, ".import-" + taskId + ".pending");
            boolean renamed = false;
            boolean durabilityConfirmed = false;
            try {
                copyFileWithFsync(sourceDbFile, applyTmp);
                String tmpSha = KanataM6SchemeCExporter.computeFileSha256Hex(applyTmp);
                KanataM6PortableCrypto.requirePortable(
                        expectedSha256Hex.equals(tmpSha),
                        KanataM6PortableCrypto.ERR_IO_FAILED, "apply-tmp-readback-mismatch");

                // Under FIX-04 stable target lock (WriteGate drained / post-crash recovery),
                // remove stale sidecars from the replaced generation so Os.rename installs a clean,
                // self-contained checkpointed SQLCipher database without inheriting old WAL pages.
                File wal = new File(activeAbs.getPath() + "-wal");
                File shm = new File(activeAbs.getPath() + "-shm");
                File jrn = new File(activeAbs.getPath() + "-journal");
                if (wal.exists()) wal.delete();
                if (shm.exists()) shm.delete();
                if (jrn.exists()) jrn.delete();

                writeSimpleImportJournal(importJournal, parentDir, taskId, "VERIFIED_READY_TO_COMMIT",
                        applyTmp, activeAbs, expectedSha256Hex, true);

                if (hooks != null) hooks.beforeApplyRename(applyTmp, activeAbs);
                KanataM6PortableCrypto.checkCancelled(cancelled);

                KanataM6SchemeCImporter.defaultAtomicRenameOnly(applyTmp, activeAbs);
                renamed = true;

                try {
                    if (hooks != null) hooks.afterApplyRenameBeforeJournalUpdate(activeAbs, importJournal);
                    writeSimpleImportJournal(importJournal, parentDir, taskId, "RENAMED_PENDING_DIR_SYNC",
                            applyTmp, activeAbs, expectedSha256Hex, false);
                    if (hooks != null) hooks.performTargetDirFsync(parentDir);
                    else KanataM6SchemeCExporter.fsyncDirectoryStrict(parentDir);
                } catch (IOException postRenameErr) {
                    throw new KanataM6PortableCrypto.PortableException(
                            KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, "apply-dir-fsync-unconfirmed", postRenameErr);
                }
                durabilityConfirmed = true;
                verifyActiveQuickIntegrity(activeAbs, verifyRawKey);
                try {
                    writeSimpleImportJournal(importJournal, parentDir, taskId, "COMMITTED",
                            applyTmp, activeAbs, expectedSha256Hex, false);
                } catch (IOException ignoredAfterCommit) {}
            } finally {
                if (!renamed && applyTmp.exists()) {
                    SQLiteDatabase.deleteDatabase(applyTmp);
                }
                boolean keepForUnconfirmed = renamed && !durabilityConfirmed;
                if (!keepForUnconfirmed && importJournal.exists()) {
                    importJournal.delete();
                }
            }
        }
    }

    /**
     * Inspect UNCONFIRMED journals across spool/target directories without mutating any files.
     */
    public static List<UnconfirmedEntry> inspectUnconfirmedTasks(File... dirs) {
        List<UnconfirmedEntry> out = new ArrayList<>();
        if (dirs == null) return out;
        for (File dir : dirs) {
            if (dir == null || !dir.isDirectory()) continue;
            File[] journals = dir.listFiles((d, name) ->
                    (name.startsWith(".task-") || name.startsWith(".import-")) && name.endsWith(".pending"));
            if (journals == null) continue;
            for (File journal : journals) {
                try {
                    byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(journal, 65536);
                    JSONObject obj = new JSONObject(new String(raw, StandardCharsets.UTF_8));
                    String tid = obj.optString("taskId", "");
                    String kind = obj.optString("kind", journal.getName().startsWith(".import-") ? "IMPORT" : "EXPORT");
                    String state = obj.optString("state", "");
                    String targetPath = obj.optString("targetPath", "");
                    String expectedSha = obj.optString("expectedSha256Hex", "");
                    File targetFile = targetPath.isEmpty() ? null : new File(targetPath);
                    boolean targetExists = targetFile != null && targetFile.isFile();
                    String actualSha = "";
                    boolean shaMatches = false;
                    if (targetExists && !expectedSha.isEmpty()) {
                        try {
                            actualSha = KanataM6SchemeCExporter.computeFileSha256Hex(targetFile);
                            shaMatches = expectedSha.equals(actualSha);
                        } catch (Throwable ignored) {}
                    }
                    boolean lockActive = false;
                    try {
                        if ("IMPORT".equals(kind) && targetFile != null) {
                            lockActive = KanataM6SchemeCImporter.hasActiveCommitLock(targetFile);
                        } else if (!tid.isEmpty()) {
                            lockActive = KanataM6SchemeCExporter.hasActiveTaskLock(dir, tid);
                        }
                    } catch (Throwable ignored) {
                        lockActive = true;
                    }
                    String reason = lockActive
                            ? "LOCK_ACTIVE"
                            : ("RENAMED_PENDING_DIR_SYNC".equals(state)
                                ? (shaMatches ? "PENDING_DIR_FSYNC" : "TARGET_SHA_MISMATCH")
                                : (targetExists && shaMatches ? "UNCONFIRMED_COMMIT" : "STATE_REQUIRES_VERIFICATION"));
                    out.add(new UnconfirmedEntry(
                            tid, kind, state, journal.getAbsolutePath(), targetPath,
                            expectedSha, actualSha, targetExists, lockActive, shaMatches, reason));
                } catch (Throwable parseErr) {
                    out.add(new UnconfirmedEntry(
                            journal.getName(), "UNKNOWN", "CORRUPT_JOURNAL", journal.getAbsolutePath(),
                            "", "", "", false, false, false, "UNTRUSTED_OR_CORRUPT_JOURNAL"));
                }
            }
        }
        return out;
    }

    /**
     * Re-verify an UNCONFIRMED task under FIX-04 stable lock (never blindly deleting material).
     * Only clears journal if SHA-256 + directory fsync durability are cryptographically proven!
     */
    public static ManualActionResult reverifyUnconfirmedTask(String taskId, File... dirs) {
        if (taskId == null || taskId.isEmpty() || taskId.contains("..")) {
            return new ManualActionResult(String.valueOf(taskId), false, "REJECTED", "INVALID_TASK_ID");
        }
        KanataM6SchemeCImporter.ImportRecoveryReport imp = KanataM6SchemeCImporter.recoverIncompleteImports(dirs);
        if (imp.confirmedCommitTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, true, "CONFIRMED_COMMIT", "DURABILITY_VERIFIED");
        }
        if (imp.cleanedTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, true, "CLEANED_UNCOMMITTED", "NO_COMMIT_OCCURRED");
        }
        if (imp.skippedActiveTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, false, "PROTECTED_LOCK_ACTIVE", "ACTIVE_LOCK_HELD");
        }
        if (imp.unconfirmedCommitTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, false, "STILL_UNCONFIRMED", "CANNOT_PROVE_DURABILITY");
        }
        // Also check Exporter recovery
        KanataM6SchemeCExporter.RecoveryReport exp = KanataM6SchemeCExporter.recoverIncompleteTasks(dirs);
        if (exp.confirmedCommitTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, true, "CONFIRMED_COMMIT", "DURABILITY_VERIFIED");
        }
        if (exp.cleanedTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, true, "CLEANED_UNCOMMITTED", "NO_COMMIT_OCCURRED");
        }
        if (exp.skippedActiveTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, false, "PROTECTED_LOCK_ACTIVE", "ACTIVE_LOCK_HELD");
        }
        if (exp.unconfirmedCommitTaskIds.contains(taskId)) {
            return new ManualActionResult(taskId, false, "STILL_UNCONFIRMED", "CANNOT_PROVE_DURABILITY");
        }
        return new ManualActionResult(taskId, false, "PROTECTED_UNKNOWN", "TASK_NOT_PROVEN_SAFE");
    }

    /**
     * Manual safe cleanup entry: enforces explicit user confirmation, FIX-04 stable lock acquisition,
     * canonical directory containment, inode stability, and refuses cleanup whenever safety cannot be proven.
     */
    public static ManualActionResult manualSafeCleanupUnconfirmedTask(
            String taskId,
            boolean userExplicitlyConfirmed,
            boolean restoreCoordinatorBlocked,
            File... allowedDirs) {
        if (!userExplicitlyConfirmed) {
            return new ManualActionResult(String.valueOf(taskId), false, "REFUSED", "USER_CONFIRMATION_REQUIRED");
        }
        if (restoreCoordinatorBlocked) {
            return new ManualActionResult(String.valueOf(taskId), false, "REFUSED_BLOCKED", "RESTORE_COORDINATOR_BLOCKED");
        }
        if (taskId == null || taskId.isEmpty() || taskId.contains("..") || !taskId.matches("[A-Za-z0-9._-]+")) {
            return new ManualActionResult(String.valueOf(taskId), false, "REFUSED", "INVALID_TASK_ID");
        }
        // First attempt cryptographic re-verification; if that proves durability or clean rollback, done!
        ManualActionResult verified = reverifyUnconfirmedTask(taskId, allowedDirs);
        if (verified.resolved) {
            return verified;
        }
        // Cannot prove safety -> refuse auto/manual deletion and keep protected state!
        return new ManualActionResult(taskId, false, "REFUSED_UNPROVEN_SAFETY", verified.reason);
    }

    private static boolean hasDirtySidecars(File dbFile) {
        File wal = new File(dbFile.getPath() + "-wal");
        File shm = new File(dbFile.getPath() + "-shm");
        return (wal.exists() && wal.length() > 0L) || (shm.exists() && shm.length() > 0L);
    }

    private static void verifyActiveQuickIntegrity(File activeDb, byte[] verifyRawKey) {
        if (verifyRawKey == null) return;
        try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(
                activeDb.getPath(), verifyRawKey, null,
                SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                (d, e) -> {}, null)) {
            String ok = KanataM6SnapshotOwner.scalar(ro, "PRAGMA integrity_check(1)");
            KanataM6PortableCrypto.requirePortable("ok".equals(ok),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "active-post-apply-integrity");
            try (Cursor cic = ro.rawQuery("PRAGMA cipher_integrity_check", new Object[0])) {
                KanataM6PortableCrypto.requirePortable(!cic.moveToNext(),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "active-post-apply-cipher");
            }
        }
    }

    private static void copyFileWithFsync(File src, File dst) throws IOException {
        byte[] buf = new byte[65536];
        try (FileInputStream fis = new FileInputStream(src);
             FileOutputStream fos = new FileOutputStream(dst, false)) {
            int n;
            while ((n = fis.read(buf)) != -1) {
                fos.write(buf, 0, n);
            }
            fos.flush();
            fos.getFD().sync();
        } finally {
            Arrays.fill(buf, (byte) 0);
        }
    }

    private static void writeSimpleImportJournal(
            File journal,
            File dir,
            String taskId,
            String state,
            File stageFile,
            File targetFile,
            String expectedSha256Hex,
            boolean syncDir) throws IOException {
        try {
            JSONObject obj = new JSONObject()
                    .put("taskId", taskId)
                    .put("kind", "IMPORT")
                    .put("pid", Process.myPid())
                    .put("state", state)
                    .put("stagePath", stageFile.getCanonicalPath())
                    .put("targetPath", targetFile.getCanonicalPath())
                    .put("expectedSha256Hex", expectedSha256Hex);
            File tmp = new File(dir, journal.getName() + ".next");
            try (FileOutputStream fos = new FileOutputStream(tmp, false)) {
                fos.write(obj.toString().getBytes(StandardCharsets.UTF_8));
                fos.flush();
                fos.getFD().sync();
            }
            try {
                Os.rename(tmp.getAbsolutePath(), journal.getAbsolutePath());
            } catch (ErrnoException e) {
                tmp.delete();
                throw new IOException("import-journal-rename:" + e.errno, e);
            }
            if (syncDir) {
                KanataM6SchemeCExporter.fsyncDirectoryStrict(dir);
            }
        } catch (IOException ioe) {
            throw ioe;
        } catch (Exception e) {
            throw new IOException("import-journal-write", e);
        }
    }

    private static void bindValue(SQLiteStatement stmt, int idx, Object val) {
        if (val == null) stmt.bindNull(idx);
        else if (val instanceof Long l) stmt.bindLong(idx, l);
        else if (val instanceof Double d) stmt.bindDouble(idx, d);
        else if (val instanceof byte[] b) stmt.bindBlob(idx, b);
        else stmt.bindString(idx, (String) val);
    }

    private static void zeroizeObjectArray(Object[] arr) {
        if (arr == null) return;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] instanceof byte[] b) {
                Arrays.fill(b, (byte) 0);
            }
            arr[i] = null;
        }
    }

    private static Object[] decodeBodyValues(KanataM6PortableCatalog.TableDef tableDef, byte[] body) {
        int off = tableDef.hasOrdinal ? 8 : 0;
        Object[] out = new Object[tableDef.columns.size()];
        boolean success = false;
        try {
            for (int i = 0; i < tableDef.columns.size(); i++) {
                KanataM6PortableCatalog.ColumnDef col = tableDef.columns.get(i);
                KanataM6PortableCrypto.requirePortable(off < body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-flag-trunc");
                int flag = body[off++] & 0xff;
                if (flag == 0) {
                    KanataM6PortableCrypto.requirePortable(!col.notnull,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + col.name);
                    out[i] = null;
                    continue;
                }
                KanataM6PortableCrypto.requirePortable(flag == 1,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-null-flag");
                if (col.type == KanataM6PortableCatalog.ColType.INTEGER) {
                    KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-int-trunc");
                    out[i] = KanataM6PortableCrypto.readU64BE(body, off);
                    off += 8;
                } else if (col.type == KanataM6PortableCatalog.ColType.REAL) {
                    KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-trunc");
                    long bits = KanataM6PortableCrypto.readU64BE(body, off);
                    off += 8;
                    double d = Double.longBitsToDouble(bits);
                    KanataM6PortableCrypto.requirePortable(
                            !Double.isNaN(d) && !Double.isInfinite(d) && bits != Double.doubleToRawLongBits(-0.0d),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-invalid");
                    out[i] = d;
                } else {
                    KanataM6PortableCrypto.requirePortable(off + 4 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-len-trunc");
                    long len = KanataM6PortableCrypto.readU32BE(body, off);
                    off += 4;
                    KanataM6PortableCrypto.requirePortable(len <= KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES,
                            KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "col-text-limit");
                    KanataM6PortableCrypto.requirePortable(off + len <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-trunc");
                    KanataM6PortableCrypto.decodeStrictUtf8(body, off, (int) len, "col-text");
                    out[i] = Arrays.copyOfRange(body, off, off + (int) len);
                    off += (int) len;
                }
            }
            KanataM6PortableCrypto.requirePortable(off == body.length,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-trailing-bytes");
            success = true;
            return out;
        } finally {
            if (!success) {
                zeroizeObjectArray(out);
            }
        }
    }

    /** Bounded O(1)-row streaming logical decoder. */
    private static final class LogicalStreamDecoder {
        private static final int ST_TABLE_HEADER = 0;
        private static final int ST_ROW_LENGTH = 1;
        private static final int ST_ROW_BODY = 2;
        private static final int ST_DONE = 3;

        private final KanataM6PortableCatalog catalog;
        private final SQLiteStatement insertStageStmt;
        private final byte[] smallBuf = new byte[10];
        private final byte[] rowLenBytes = new byte[4];
        private final List<KanataM6SchemeCExporter.Verifier> businessVerifiers = new ArrayList<>(45);

        private int tableIndex = 0;
        private int state = ST_TABLE_HEADER;
        private int smallLen = 0;
        private int smallTarget = 10;

        private KanataM6PortableCatalog.TableDef currentTable;
        private long currentTableRowCount = 0L;
        private long currentTableRowsRead = 0L;
        long totalBusinessRows = 0L;
        private MessageDigest currentTableSha;
        private byte[] rowBodyBuf;
        private int rowBodyOff = 0;

        private byte[] prevOrdWorldId;
        private long prevOrd = -1;
        private byte[][] prevPkText;
        private long[] prevPkNum;

        LogicalStreamDecoder(KanataM6PortableCatalog catalog, SQLiteDatabase stageDb) {
            this.catalog = catalog;
            this.insertStageStmt = stageDb.compileStatement(
                    "INSERT INTO staged_rows(table_id, seq, body) VALUES(?, ?, ?)");
        }

        void push(byte[] chunk) throws Exception {
            int pos = 0;
            while (pos < chunk.length) {
                if (state == ST_DONE) {
                    throw new KanataM6PortableCrypto.PortableException(
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "logical-trailing-bytes");
                }
                if (state == ST_TABLE_HEADER || state == ST_ROW_LENGTH) {
                    int take = Math.min(smallTarget - smallLen, chunk.length - pos);
                    System.arraycopy(chunk, pos, smallBuf, smallLen, take);
                    smallLen += take;
                    pos += take;
                    if (smallLen < smallTarget) continue;

                    if (state == ST_TABLE_HEADER) {
                        int tableId = KanataM6PortableCrypto.readU16BE(smallBuf, 0);
                        long rowCount = KanataM6PortableCrypto.readU64BE(smallBuf, 2);
                        KanataM6PortableCatalog.TableDef expected = catalog.businessTables.get(tableIndex);
                        KanataM6PortableCatalog.TableDef known = catalog.byId.get(tableId);
                        KanataM6PortableCrypto.requirePortable(known != null,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "unknown-table");
                        KanataM6PortableCrypto.requirePortable(known.category == KanataM6PortableCatalog.Category.BUSINESS,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "non-business-table");
                        KanataM6PortableCrypto.requirePortable(tableId == expected.tableId,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "table-order");
                        KanataM6PortableCrypto.requirePortable(
                                rowCount >= 0 && rowCount <= KanataM6PortableCrypto.MAX_BUSINESS_ROWS
                                        && totalBusinessRows + rowCount <= KanataM6PortableCrypto.MAX_BUSINESS_ROWS,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "business-row-count");
                        totalBusinessRows += rowCount;
                        currentTable = expected;
                        currentTableRowCount = rowCount;
                        currentTableRowsRead = 0L;
                        prevOrdWorldId = null;
                        prevOrd = -1;
                        prevPkText = null;
                        prevPkNum = null;

                        currentTableSha = MessageDigest.getInstance("SHA-256");
                        currentTableSha.update("KPB1/table\0".getBytes(StandardCharsets.US_ASCII));
                        byte[] tidBytes = new byte[2];
                        KanataM6PortableCrypto.writeU16BE(tidBytes, 0, tableId);
                        currentTableSha.update(tidBytes);

                        if (rowCount == 0L) {
                            finishCurrentTable();
                        } else {
                            state = ST_ROW_LENGTH;
                            smallLen = 0;
                            smallTarget = 4;
                        }
                    } else {
                        long bodyLen = KanataM6PortableCrypto.readU32BE(smallBuf, 0);
                        KanataM6PortableCrypto.requirePortable(bodyLen <= KanataM6PortableCrypto.MAX_ROW_BODY_BYTES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "row-body-size");
                        KanataM6PortableCrypto.requirePortable(bodyLen >= 1,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-body-empty");
                        System.arraycopy(smallBuf, 0, rowLenBytes, 0, 4);
                        rowBodyBuf = new byte[(int) bodyLen];
                        rowBodyOff = 0;
                        state = ST_ROW_BODY;
                    }
                } else if (state == ST_ROW_BODY) {
                    int take = Math.min(rowBodyBuf.length - rowBodyOff, chunk.length - pos);
                    System.arraycopy(chunk, pos, rowBodyBuf, rowBodyOff, take);
                    rowBodyOff += take;
                    pos += take;
                    if (rowBodyOff < rowBodyBuf.length) continue;

                    byte[] completedBody = rowBodyBuf;
                    rowBodyBuf = null;
                    rowBodyOff = 0;
                    try {
                        currentTableSha.update(rowLenBytes);
                        currentTableSha.update(completedBody);
                        validateRowBodyAndOrder(currentTable, completedBody);

                        insertStageStmt.clearBindings();
                        insertStageStmt.bindLong(1, currentTable.tableId);
                        insertStageStmt.bindLong(2, currentTableRowsRead);
                        insertStageStmt.bindBlob(3, completedBody);
                        insertStageStmt.executeInsert();
                    } finally {
                        KanataM6PortableCrypto.zeroize(completedBody);
                    }

                    currentTableRowsRead++;
                    if (currentTableRowsRead == currentTableRowCount) {
                        finishCurrentTable();
                    } else {
                        state = ST_ROW_LENGTH;
                        smallLen = 0;
                        smallTarget = 4;
                    }
                }
            }
        }

        private void validateRowBodyAndOrder(KanataM6PortableCatalog.TableDef tableDef, byte[] body) {
            int off = 0;
            long ordinal = -1;
            if (tableDef.hasOrdinal) {
                KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-ordinal-trunc");
                ordinal = KanataM6PortableCrypto.readU64BE(body, off);
                KanataM6PortableCrypto.requirePortable(
                        ordinal >= 0 && ordinal <= KanataM6PortableCrypto.MAX_ORDINAL,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-ordinal-range");
                off += 8;
            }

            int colCount = tableDef.columns.size();
            byte[][] rawTextCols = new byte[colCount][];
            long[] intCols = new long[colCount];
            String taskKind = null;
            String taskState = null;

            try {
                for (int i = 0; i < colCount; i++) {
                    KanataM6PortableCatalog.ColumnDef col = tableDef.columns.get(i);
                    KanataM6PortableCrypto.requirePortable(off < body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-flag-trunc");
                    int flag = body[off++] & 0xff;
                    if (flag == 0) {
                        KanataM6PortableCrypto.requirePortable(!col.notnull,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + col.name);
                        continue;
                    }
                    KanataM6PortableCrypto.requirePortable(flag == 1,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-null-flag");
                    if (col.type == KanataM6PortableCatalog.ColType.INTEGER) {
                        KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-int-trunc");
                        intCols[i] = KanataM6PortableCrypto.readU64BE(body, off);
                        off += 8;
                    } else if (col.type == KanataM6PortableCatalog.ColType.REAL) {
                        KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-trunc");
                        long bits = KanataM6PortableCrypto.readU64BE(body, off);
                        off += 8;
                        double d = Double.longBitsToDouble(bits);
                        KanataM6PortableCrypto.requirePortable(
                                !Double.isNaN(d) && !Double.isInfinite(d) && bits != Double.doubleToRawLongBits(-0.0d),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-invalid");
                    } else {
                        KanataM6PortableCrypto.requirePortable(off + 4 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-len-trunc");
                        long len = KanataM6PortableCrypto.readU32BE(body, off);
                        off += 4;
                        KanataM6PortableCrypto.requirePortable(len <= KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "col-text-limit");
                        KanataM6PortableCrypto.requirePortable(off + len <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-trunc");
                        String decoded = KanataM6PortableCrypto.decodeStrictUtf8(body, off, (int) len, "col:" + col.name);
                        KanataM6BoundedRowReader.validateJsonColumn(col.name, decoded);
                        if (col.pk > 0 || (tableDef.hasOrdinal && "world_id".equals(col.name))) {
                            rawTextCols[i] = Arrays.copyOfRange(body, off, off + (int) len);
                        }
                        if ("background_tasks".equals(tableDef.name)) {
                            if ("kind".equals(col.name)) taskKind = decoded;
                            else if ("state".equals(col.name)) taskState = decoded;
                        }
                        off += (int) len;
                    }
                }
                KanataM6PortableCrypto.requirePortable(off == body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-trailing-bytes");

                if ("background_tasks".equals(tableDef.name)) {
                    int leaseCid = tableDef.columnsByName.get("lease_until").cid;
                    KanataM6PortableCrypto.requirePortable(intCols[leaseCid] == 0L,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-lease");
                    if ("reply".equals(taskKind) || "proactive".equals(taskKind) || "followup".equals(taskKind)) {
                        KanataM6PortableCrypto.requirePortable(
                                !"pending".equals(taskState) && !"running".equals(taskState) && !"failed".equals(taskState),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-state");
                    } else {
                        KanataM6PortableCrypto.requirePortable(!"running".equals(taskState),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-state");
                    }
                }

                if (tableDef.hasOrdinal) {
                    int widCid = tableDef.columnsByName.get("world_id").cid;
                    byte[] wid = rawTextCols[widCid];
                    if (prevOrdWorldId == null) {
                        KanataM6PortableCrypto.requirePortable(ordinal == 0L,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                    } else {
                        int cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevOrdWorldId, wid);
                        KanataM6PortableCrypto.requirePortable(cmp <= 0,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-world-order");
                        if (cmp == 0) {
                            KanataM6PortableCrypto.requirePortable(ordinal == prevOrd + 1L,
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-sequence");
                        } else {
                            KanataM6PortableCrypto.requirePortable(ordinal == 0L,
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                        }
                    }
                    KanataM6PortableCrypto.zeroize(prevOrdWorldId);
                    prevOrdWorldId = wid;
                    rawTextCols[widCid] = null;
                    prevOrd = ordinal;
                    return;
                }

                List<KanataM6PortableCatalog.ColumnDef> pks = tableDef.pkColumns;
                byte[][] curText = new byte[pks.size()][];
                long[] curNum = new long[pks.size()];
                for (int p = 0; p < pks.size(); p++) {
                    KanataM6PortableCatalog.ColumnDef pk = pks.get(p);
                    if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                        curText[p] = rawTextCols[pk.cid];
                        rawTextCols[pk.cid] = null;
                    } else {
                        curNum[p] = intCols[pk.cid];
                    }
                }
                if (prevPkText != null) {
                    int cmp = 0;
                    for (int p = 0; p < pks.size(); p++) {
                        KanataM6PortableCatalog.ColumnDef pk = pks.get(p);
                        if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                            cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevPkText[p], curText[p]);
                        } else {
                            cmp = Long.compare(prevPkNum[p], curNum[p]);
                        }
                        if (cmp != 0) break;
                    }
                    if (cmp >= 0) {
                        for (byte[] b : curText) KanataM6PortableCrypto.zeroize(b);
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "pk-order:" + tableDef.name);
                    }
                }
                if (prevPkText != null) {
                    for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                }
                prevPkText = curText;
                prevPkNum = curNum;
            } finally {
                for (byte[] b : rawTextCols) KanataM6PortableCrypto.zeroize(b);
            }
        }

        private void finishCurrentTable() {
            businessVerifiers.add(new KanataM6SchemeCExporter.Verifier(
                    currentTable.tableId, currentTableRowCount, currentTableSha.digest()));
            KanataM6PortableCrypto.zeroize(prevOrdWorldId);
            prevOrdWorldId = null;
            if (prevPkText != null) {
                for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                prevPkText = null;
            }
            prevPkNum = null;
            currentTable = null;
            currentTableSha = null;
            tableIndex++;
            if (tableIndex == catalog.businessTables.size()) {
                state = ST_DONE;
                smallLen = 0;
            } else {
                state = ST_TABLE_HEADER;
                smallLen = 0;
                smallTarget = 10;
            }
        }

        List<KanataM6SchemeCExporter.Verifier> finish() {
            insertStageStmt.close();
            KanataM6PortableCrypto.requirePortable(
                    state == ST_DONE && smallLen == 0 && rowBodyBuf == null && businessVerifiers.size() == 45,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "logical-incomplete");
            return businessVerifiers;
        }

        void close() {
            try { insertStageStmt.close(); } catch (Throwable ignored) {}
            KanataM6PortableCrypto.zeroize(rowBodyBuf);
            rowBodyBuf = null;
            KanataM6PortableCrypto.zeroize(prevOrdWorldId);
            prevOrdWorldId = null;
            if (prevPkText != null) {
                for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                prevPkText = null;
            }
            KanataM6PortableCrypto.zeroize(smallBuf);
            KanataM6PortableCrypto.zeroize(rowLenBytes);
        }
    }
}
