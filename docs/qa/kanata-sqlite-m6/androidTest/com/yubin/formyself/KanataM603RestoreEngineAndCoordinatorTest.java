package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * M6-03 Native Primitive-Level Verification Suite (retained per M6-03-R F02):
 * - Work Package A: KPB1 streaming decode via File & real SAF DocumentsProvider + 12-case negative rejection matrix
 * - Work Package B: Isolated SQLCipher 4.17.0 batched atomic staging engine + 12-point verification + batch rollback
 * - Native crash/lock/UNCONFIRMED primitives (worker-level test journal & manual check)
 * - Work Package E: Native WebViewCompat runtime capability inspection
 *
 * NOTE (M6-03-R F02): Authoritative G-04 durable transaction control, real Capacitor Bridge wiring,
 * and autonomous cold-start SIGKILL recovery (without any test-only journal or test-chosen direction)
 * are verified by:
 * - KanataM603N05DurableTxControlTest (N-05 across API 24 / 25 / 34)
 * - KanataM603EndToEndRemediationTest (F02 / F03 / F06 / N-06 / F03-01~10)
 */
@RunWith(AndroidJUnit4.class)
public class KanataM603RestoreEngineAndCoordinatorTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM603";
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final String BACKUP_PW = "m603-backup-pw-\ufeff🔐";
    private static final String MASTER_PW = "m603-master-pw-synthetic";

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    private static byte[] randomKek() {
        byte[] kek = new byte[32];
        new SecureRandom().nextBytes(kek);
        return kek;
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream fis = new FileInputStream(f);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) baos.write(buf, 0, n);
            return baos.toByteArray();
        }
    }

    private static String readSmallText(File f) throws IOException {
        return new String(readAll(f), StandardCharsets.UTF_8);
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        f.delete();
    }

    private static void waitProcessDead(Context ctx, int workerPid) throws InterruptedException {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        long deadline = SystemClock.elapsedRealtime() + 10_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            boolean alive = false;
            List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
            if (procs != null) {
                for (ActivityManager.RunningAppProcessInfo p : procs) {
                    if (p.pid == workerPid) {
                        alive = true;
                        break;
                    }
                }
            }
            if (!alive) return;
            Thread.sleep(50);
        }
        fail("Worker process " + workerPid + " did not terminate after SIGKILL");
    }

    private static JSONObject openEncryptedWorkerJournal(File journalFile, String masterPw) throws Exception {
        JSONObject env = new JSONObject(readSmallText(journalFile));
        byte[] salt = KanataM6PortableCrypto.hexToBytes(env.getString("saltHex"));
        byte[] iv = KanataM6PortableCrypto.hexToBytes(env.getString("ivHex"));
        byte[] cipher = KanataM6PortableCrypto.hexToBytes(env.getString("cipherHex"));
        byte[] key = new byte[32];
        KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAllocInto(
                masterPw.getBytes(StandardCharsets.UTF_8), salt, 50_000, 32, new AtomicBoolean(false), key);
        byte[] plain = KanataM6PortableCrypto.aesGcmDecrypt(key, iv, cipher, cipher.length, new byte[0], "worker-journal");
        try {
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } finally {
            KanataM6PortableCrypto.zeroize(key, plain);
        }
    }

    @Test
    public void m603_01_normalRestoreViaFileAndSafWithFull50TableVerification() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m603_01_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File stagingDir = new File(workDir, "staging");
        File rollbackDir = new File(workDir, "rollback");
        assertTrue(workDir.mkdirs() && spoolDir.mkdirs() && stagingDir.mkdirs() && rollbackDir.mkdirs());

        File srcDb = new File(workDir, "src.db");
        File activeDb = new File(workDir, "active.db");
        File kpb1File = new File(workDir, "export_m603_01.kpb1");
        byte[] srcKey = randomRawKey();
        byte[] activeKey = randomRawKey();
        byte[] localKek = randomKek();

        try {
            // Seed source (target) with 120 messages and previous active with 25 messages
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 120);
            KanataM6SyntheticDataset.populateUniformDataset(activeDb, activeKey, catalog, 25);
            String prevActiveSha = KanataM6SchemeCExporter.computeFileSha256Hex(activeDb);

            String expectedProjectedDigest;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedProjectedDigest = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // Export KPB1 via M6-02 Scheme C Exporter
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, kpb1File,
                    null, null, new AtomicBoolean(false), null, "m603-01-exp");

            // Phase 1a: Stage from local File with batched transactions (batchSize = 30) and M6-00 KanataKeyEnvelope!
            KanataM6StagingRestoreEngine.PreparedStagingArtifact stagedEnvelope =
                    KanataM6StagingRestoreEngine.prepareStagingFromFile(
                            kpb1File, BACKUP_PW, catalog, workDir, stagingDir,
                            null, localKek, 30, new AtomicBoolean(false), null, "m603-01-env");
            assertNotNull("Envelope file must be generated when KEK provided", stagedEnvelope.envelopeFile);
            assertTrue(stagedEnvelope.envelopeFile.isFile());
            assertTrue(stagedEnvelope.stagingDbFile.isFile());
            assertEquals(50, stagedEnvelope.footerVerifiers.size());
            assertTrue("Expected batched transactions >= 4", stagedEnvelope.metrics.batchCount >= 4);
            assertTrue("Max batch rows bounded <= 30", stagedEnvelope.metrics.maxBatchRows <= 30);
            // Active DB must be 100% untouched after Phase 1 staging!
            assertEquals(prevActiveSha, KanataM6SchemeCExporter.computeFileSha256Hex(activeDb));
            stagedEnvelope.destroyStaging();

            // Phase 1b: Stage from real SAF DocumentsProvider Uri!
            String safDocName = "m603_saf_" + UUID.randomUUID() + ".kpb1";
            Uri safUri = DocumentsContract.createDocument(
                    targetCtx.getContentResolver(),
                    KanataM6SyntheticSafProvider.rootUri(),
                    "application/octet-stream",
                    safDocName);
            assertNotNull("Expected real SAF document Uri", safUri);
            try (FileInputStream fis = new FileInputStream(kpb1File);
                 java.io.OutputStream os = targetCtx.getContentResolver().openOutputStream(safUri)) {
                assertNotNull(os);
                byte[] buf = new byte[65536];
                int n;
                while ((n = fis.read(buf)) != -1) os.write(buf, 0, n);
                os.flush();
            }
            KanataM6StagingRestoreEngine.PreparedStagingArtifact stagedSaf =
                    KanataM6StagingRestoreEngine.prepareStagingFromSafUri(
                            targetCtx, safUri, BACKUP_PW, catalog, workDir, stagingDir,
                            activeKey, null, 40, new AtomicBoolean(false), null, "m603-01-saf");
            assertEquals(50, stagedSaf.footerVerifiers.size());
            assertEquals(120L, stagedSaf.messageCount);
            assertEquals(1L, stagedSaf.worldCount);
            assertEquals(prevActiveSha, KanataM6SchemeCExporter.computeFileSha256Hex(activeDb));

            // Phase 2: Capture previous & apply verified staging atomically!
            String prevProjectedDigest;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(activeDb.getPath(), activeKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                prevProjectedDigest = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }
            KanataM6StagingRestoreEngine.CapturedPreviousGeneration prevCap =
                    KanataM6StagingRestoreEngine.capturePreviousGeneration(
                            activeDb, activeKey, rollbackDir, "m603-01-saf", new KanataM6SnapshotOwner.WriteGate());
            assertFalse(prevCap.absent);
            assertEquals(KanataM6SchemeCExporter.computeFileSha256Hex(activeDb), prevCap.rollbackSha256Hex);
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(prevCap.rollbackDbFile.getPath(), activeKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(prevProjectedDigest,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex);
            }

            KanataM6StagingRestoreEngine.applyVerifiedGeneration(
                    stagedSaf.stagingDbFile, stagedSaf.stagingSha256Hex, false,
                    activeDb, activeKey, "m603-01-saf", new AtomicBoolean(false), null);

            // Verify active DB now matches target projected fingerprint byte-for-byte
            assertEquals(stagedSaf.stagingSha256Hex, KanataM6SchemeCExporter.computeFileSha256Hex(activeDb));
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(activeDb.getPath(), activeKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(expectedProjectedDigest,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex);
            }

            // Cleanup after commit confirmed
            stagedSaf.destroyStaging();
            prevCap.cleanupAfterFinalized();
            DocumentsContract.deleteDocument(targetCtx.getContentResolver(), safUri);

            JSONObject report = new JSONObject()
                    .put("fileAndSafRestoreOk", true)
                    .put("batchCount", stagedSaf.metrics.batchCount)
                    .put("maxBatchRows", stagedSaf.metrics.maxBatchRows)
                    .put("totalRestoreMs", stagedSaf.metrics.totalRestoreMs)
                    .put("datasetIdentity", stagedSaf.datasetIdentity);
            Log.i(TAG, "M603_01_NORMAL_RESTORE=" + report);
        } finally {
            KanataM6PortableCrypto.zeroize(srcKey, activeKey, localKek);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void m603_02_negativeKpb1ContainerAndLogicalRejectionMatrix() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m603_02_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File stagingDir = new File(workDir, "staging");
        assertTrue(workDir.mkdirs() && spoolDir.mkdirs() && stagingDir.mkdirs());

        File srcDb = new File(workDir, "src.db");
        File activeDb = new File(workDir, "active.db");
        File kpb1File = new File(workDir, "valid.kpb1");
        byte[] srcKey = randomRawKey();
        byte[] activeKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 30);
            KanataM6SyntheticDataset.populateUniformDataset(activeDb, activeKey, catalog, 25);
            String activeShaBefore = KanataM6SchemeCExporter.computeFileSha256Hex(activeDb);

            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, kpb1File,
                    null, null, new AtomicBoolean(false), null, "m603-02-exp");
            byte[] validBytes = readAll(kpb1File);

            // 1. Wrong password -> AUTH_FAILED
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(validBytes), "wrong-pw", catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-pw"),
                    KanataM6PortableCrypto.ERR_AUTH_FAILED);

            // 2. Unknown format version -> UNSUPPORTED_FORMAT
            byte[] badVer = validBytes.clone();
            badVer[9] = 9;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(badVer), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-ver"),
                    KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT);

            // 3. Corrupted DATA -> AUTH_FAILED
            byte[] badData = validBytes.clone();
            badData[230] ^= (byte) 0xff;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(badData), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-data"),
                    KanataM6PortableCrypto.ERR_AUTH_FAILED);

            // 4. Footer tampered -> AUTH_FAILED
            byte[] badFooter = validBytes.clone();
            badFooter[badFooter.length - 10] ^= (byte) 0x33;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(badFooter), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-footer"),
                    KanataM6PortableCrypto.ERR_AUTH_FAILED);

            // 5. Manifest tampered -> AUTH_FAILED
            byte[] badManifest = validBytes.clone();
            badManifest[150] ^= (byte) 0x77;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(badManifest), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-manifest"),
                    KanataM6PortableCrypto.ERR_AUTH_FAILED);

            // 6. Truncated file -> INVALID_CONTAINER
            byte[] trunc = Arrays.copyOf(validBytes, validBytes.length - 64);
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(trunc), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-trunc"),
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER);

            // 7. Trailing byte -> INVALID_CONTAINER
            byte[] trailing = Arrays.copyOf(validBytes, validBytes.length + 1);
            trailing[trailing.length - 1] = 0x55;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(trailing), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-trail"),
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER);

            // 8. Oversized frame resource limit -> RESOURCE_LIMIT
            byte[] oversized = validBytes.clone();
            oversized[212] = 0x00;
            oversized[213] = 0x01;
            oversized[214] = 0x00;
            oversized[215] = 0x01;
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(oversized), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false), null, "neg-limit"),
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT);

            // 9. Active cancel -> CANCELLED
            AtomicBoolean cancelled = new AtomicBoolean(true);
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(validBytes), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, cancelled, null, "neg-cancel"),
                    KanataM6PortableCrypto.ERR_CANCELLED);

            // 10. Post-install verification rejects schema mismatch, FK corruption, and incomplete ordinal!
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(validBytes), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {
                        @Override
                        public void afterStagingInstallBeforeVerify(SQLiteDatabase stagingDb) {
                            stagingDb.execSQL("PRAGMA user_version = 4");
                        }
                    }, "neg-schema"),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL);

            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(validBytes), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {
                        @Override
                        public void afterStagingInstallBeforeVerify(SQLiteDatabase stagingDb) {
                            stagingDb.execSQL("DROP TRIGGER memories_immutable_scope");
                            stagingDb.execSQL("PRAGMA foreign_keys = OFF");
                            stagingDb.execSQL("UPDATE memories SET world_id = 'ghost-world' WHERE id = 'mem-1'");
                            stagingDb.execSQL("PRAGMA foreign_keys = ON");
                        }
                    }, "neg-fk"),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL);

            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromKpb1(
                    new ByteArrayInputStream(validBytes), BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 25, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {
                        @Override
                        public void afterStagingInstallBeforeVerify(SQLiteDatabase stagingDb) {
                            stagingDb.execSQL("DROP TRIGGER event_array_order_no_delete");
                            stagingDb.execSQL("DELETE FROM event_array_order WHERE ordinal = 0");
                        }
                    }, "neg-ordinal"),
                    KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE);

            // Active DB untouched and zero leaked staging files!
            assertEquals(activeShaBefore, KanataM6SchemeCExporter.computeFileSha256Hex(activeDb));
            File[] leftover = stagingDir.listFiles();
            assertTrue("Staging dir must be clean after rejected imports", leftover == null || leftover.length == 0);

            Log.i(TAG, "M603_02_NEGATIVE_MATRIX={\"passed\":12,\"activeDbPreserved\":true}");
        } finally {
            KanataM6PortableCrypto.zeroize(srcKey, activeKey);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void m603_03_batchedAtomicRollbackEnospcAndFsyncUnconfirmed() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m603_03_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File stagingDir = new File(workDir, "staging");
        assertTrue(workDir.mkdirs() && spoolDir.mkdirs() && stagingDir.mkdirs());

        File srcDb = new File(workDir, "src.db");
        File activeDb = new File(workDir, "active.db");
        File kpb1File = new File(workDir, "batch.kpb1");
        byte[] srcKey = randomRawKey();
        byte[] activeKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 80);
            KanataM6SyntheticDataset.populateUniformDataset(activeDb, activeKey, catalog, 25);
            String activeShaBefore = KanataM6SchemeCExporter.computeFileSha256Hex(activeDb);

            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, kpb1File,
                    null, null, new AtomicBoolean(false), null, "m603-03-exp");

            // 1. Mid-batch ENOSPC failure on batch 2 of messages -> batch rolls back cleanly, staging destroyed!
            AtomicInteger msgBatches = new AtomicInteger(0);
            assertPortableError(() -> KanataM6StagingRestoreEngine.prepareStagingFromFile(
                    kpb1File, BACKUP_PW, catalog, workDir, stagingDir,
                    activeKey, null, 20, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {
                        @Override
                        public void beforeBatchCommit(String tableName, int batchIndex, int rowsInBatch, SQLiteDatabase stagingDb) throws Exception {
                            if ("messages".equals(tableName) && msgBatches.incrementAndGet() == 2) {
                                throw new IOException("ENOSPC: simulated disk full mid-batch");
                            }
                        }
                    }, "m603-03-enospc"),
                    KanataM6PortableCrypto.ERR_IO_FAILED);
            assertEquals(activeShaBefore, KanataM6SchemeCExporter.computeFileSha256Hex(activeDb));
            File[] leftover = stagingDir.listFiles();
            assertTrue("Staging dir must have 0 residual files after batch rollback", leftover == null || leftover.length == 0);

            // 2. Post-rename dir fsync failure -> DURABILITY_UNCONFIRMED preserved!
            KanataM6StagingRestoreEngine.PreparedStagingArtifact staged =
                    KanataM6StagingRestoreEngine.prepareStagingFromFile(
                            kpb1File, BACKUP_PW, catalog, workDir, stagingDir,
                            activeKey, null, 20, new AtomicBoolean(false), null, "m603-03-fsync");
            assertPortableError(() -> KanataM6StagingRestoreEngine.applyVerifiedGeneration(
                    staged.stagingDbFile, staged.stagingSha256Hex, false,
                    activeDb, activeKey, "m603-03-fsync", new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.ApplyHooks() {
                        @Override
                        public void performTargetDirFsync(File parentDir) throws IOException {
                            throw new IOException("EIO: simulated parent dir fsync failure");
                        }
                    }),
                    KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED);

            // UNCONFIRMED journal must remain on disk!
            List<KanataM6StagingRestoreEngine.UnconfirmedEntry> unconfirmed =
                    KanataM6StagingRestoreEngine.inspectUnconfirmedTasks(activeDb.getParentFile());
            assertEquals(1, unconfirmed.size());
            assertEquals("m603-03-fsync", unconfirmed.get(0).taskId);
            assertTrue(unconfirmed.get(0).shaMatches);

            // Manual cleanup refuses without confirmation or when coordinator is blocked
            KanataM6StagingRestoreEngine.ManualActionResult refNoConf =
                    KanataM6StagingRestoreEngine.manualSafeCleanupUnconfirmedTask(
                            "m603-03-fsync", false, false, activeDb.getParentFile());
            assertFalse(refNoConf.resolved);
            KanataM6StagingRestoreEngine.ManualActionResult refBlocked =
                    KanataM6StagingRestoreEngine.manualSafeCleanupUnconfirmedTask(
                            "m603-03-fsync", true, true, activeDb.getParentFile());
            assertFalse(refBlocked.resolved);

            // Holding FIX-04 stable target lock must cause re-verify/cleanup to refuse cleanly!
            try (KanataM6SchemeCImporter.TargetCommitLockHandle lock =
                         KanataM6SchemeCImporter.acquireTargetCommitLock(activeDb, new AtomicBoolean(false))) {
                KanataM6StagingRestoreEngine.ManualActionResult refLocked =
                        KanataM6StagingRestoreEngine.reverifyUnconfirmedTask("m603-03-fsync", activeDb.getParentFile());
                assertFalse(refLocked.resolved);
                assertEquals("ACTIVE_LOCK_HELD", refLocked.reason);
            }

            // After lock released, re-verify proves SHA-256 + dir fsync and resolves cleanly!
            KanataM6StagingRestoreEngine.ManualActionResult ok =
                    KanataM6StagingRestoreEngine.reverifyUnconfirmedTask("m603-03-fsync", activeDb.getParentFile());
            assertTrue(ok.resolved);
            assertEquals("CONFIRMED_COMMIT", ok.outcome);
            assertTrue(KanataM6StagingRestoreEngine.inspectUnconfirmedTasks(activeDb.getParentFile()).isEmpty());

            staged.destroyStaging();
            Log.i(TAG, "M603_03_BATCH_AND_UNCONFIRMED={\"batchRollbackOk\":true,\"unconfirmedPreservedAndResolved\":true}");
        } finally {
            KanataM6PortableCrypto.zeroize(srcKey, activeKey);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void m603_04_realMultiProcessSigkillCrashRecoveryMatrix() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m603_04_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs() && spoolDir.mkdirs());

        File srcDb = new File(workDir, "src_target.db");
        File kpb1File = new File(workDir, "target.kpb1");
        byte[] rawKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, rawKey, catalog, 60);
            String targetProjectedDigest;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                targetProjectedDigest = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), rawKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, kpb1File,
                    null, null, new AtomicBoolean(false), null, "m603-04-exp");

            String[] crashStages = new String[] {
                    KanataM6KillableWorkerService.STAGE_M603_DURING_STAGING,
                    KanataM6KillableWorkerService.STAGE_M603_AFTER_STAGING_BEFORE_JOURNAL,
                    KanataM6KillableWorkerService.STAGE_M603_AFTER_JOURNAL_BEFORE_APPLY,
                    KanataM6KillableWorkerService.STAGE_M603_DURING_APPLY_BEFORE_RENAME,
                    KanataM6KillableWorkerService.STAGE_M603_BEFORE_COMMIT_MARKER,
                    KanataM6KillableWorkerService.STAGE_M603_AFTER_COMMIT_MARKER,
                    KanataM6KillableWorkerService.STAGE_M603_DURING_JOURNAL_CLEAR,
            };

            for (String stage : crashStages) {
                File caseDir = new File(workDir, "case_" + stage);
                File killWork = new File(caseDir, "kill");
                File journalDir = new File(caseDir, "journal");
                assertTrue(caseDir.mkdirs() && killWork.mkdirs() && journalDir.mkdirs());

                File activeDb = new File(caseDir, "active.db");
                KanataM6SyntheticDataset.populateUniformDataset(activeDb, rawKey, catalog, 25);
                String prevProjectedDigest;
                try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(activeDb.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    prevProjectedDigest = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
                }

                String tid = "m603-kill-" + stage.toLowerCase();
                File readyFile = new File(killWork, "worker_ready.json");
                File errFile = new File(killWork, "worker_error.txt");

                targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_START_M603_RESTORE_PAUSE)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWork.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_PACKAGE_PATH, kpb1File.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(rawKey))
                        .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, BACKUP_PW)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_MASTER_PASSWORD, MASTER_PW)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, activeDb.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_JOURNAL_DIR, journalDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, tid)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, stage));

                long deadline = SystemClock.elapsedRealtime() + 25_000L;
                while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                    Thread.sleep(50);
                }
                assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
                assertTrue("Worker did not reach pause stage " + stage, readyFile.exists());

                JSONObject ready = new JSONObject(readSmallText(readyFile));
                int workerPid = ready.getInt("pid");
                assertNotEquals("Worker must run in separate OS process", Process.myPid(), workerPid);

                // REAL OS SIGKILL!
                Process.killProcess(workerPid);
                waitProcessDead(targetCtx, workerPid);

                // Cold restart recovery strictly following RestoreCoordinator protocol:
                File journalFile = new File(journalDir, "restore-v1.enc");
                File commitFile = new File(journalDir, "restore-v1.commit");
                boolean expectTarget = KanataM6KillableWorkerService.STAGE_M603_AFTER_COMMIT_MARKER.equals(stage)
                        || KanataM6KillableWorkerService.STAGE_M603_DURING_JOURNAL_CLEAR.equals(stage);

                if (journalFile.exists()) {
                    boolean committed = commitFile.exists();
                    if (committed) {
                        String expectedDigest = new JSONObject(readSmallText(commitFile)).getString("digest");
                        assertEquals(KanataM6SchemeCExporter.computeFileSha256Hex(journalFile), expectedDigest);
                    }
                    JSONObject rec = openEncryptedWorkerJournal(journalFile, MASTER_PW);
                    JSONObject chosen = rec.getJSONObject(committed ? "target" : "previous");
                    KanataM6StagingRestoreEngine.applyVerifiedGeneration(
                            new File(chosen.getString("dbPath")),
                            chosen.getString("dbSha256Hex"),
                            chosen.getBoolean("absent"),
                            activeDb, rawKey, tid + "-rec", new AtomicBoolean(false), null);
                    journalFile.delete();
                    commitFile.delete();
                } else if (commitFile.exists()) {
                    // Crash during journal clear: primary record already removed -> idempotent cleanup
                    commitFile.delete();
                }

                // Verify exact converged active database logical fingerprint!
                try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(activeDb.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    String actualDigest = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
                    assertEquals("Mismatch after SIGKILL at stage " + stage,
                            expectTarget ? targetProjectedDigest : prevProjectedDigest,
                            actualDigest);
                }
            }

            Log.i(TAG, "M603_04_SIGKILL_MATRIX={\"stagesTested\":7,\"allConvergedCleanly\":true}");
        } finally {
            KanataM6PortableCrypto.zeroize(rawKey);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void m603_05_nativeRuntimeCapabilityAndWebViewInspection() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        com.getcapacitor.JSObject caps = KanataRuntimeCapabilityInspector.inspect(targetCtx, null);
        int api = caps.getInt("androidApi");
        int wvMajor = caps.getInt("webviewMajorVersion");
        String wvVersion = caps.getString("webviewVersion");
        boolean supported = caps.getBoolean("webviewSupportedForBridge");
        boolean hardFloor = caps.getBoolean("webviewMeetsHardFloor");
        boolean sqliteActivated = caps.getBoolean("sqlitePluginActivated");

        assertTrue("API level must be >= 24", api >= 24);
        assertTrue("Synthetic QA APK must report sqlitePluginActivated=true", sqliteActivated);
        if (wvMajor > 0 && wvMajor < KanataRuntimeCapabilityInspector.CAPACITOR_HARD_MIN_WEBVIEW) {
            // API 24/25 stock WebView 52 MUST NEVER be marked supported!
            assertFalse("WebView < 55 must not pass hard floor", hardFloor);
            assertFalse("WebView < 60 must not pass bridge support", supported);
        } else if (wvMajor >= KanataRuntimeCapabilityInspector.CAPACITOR_DEFAULT_MIN_WEBVIEW) {
            assertTrue(hardFloor);
            assertTrue(supported);
        }

        Log.i(TAG, "M603_05_NATIVE_CAPABILITY=" + caps.toString());
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static void assertPortableError(ThrowingRunnable r, String expectedCode) {
        try {
            r.run();
            fail("Expected PortableException(" + expectedCode + ") but succeeded");
        } catch (KanataM6PortableCrypto.PortableException pe) {
            assertEquals("Unexpected error code (stage=" + pe.stage + ")", expectedCode, pe.code);
        } catch (Exception other) {
            fail("Expected PortableException(" + expectedCode + ") but threw " + other);
        }
    }
}
