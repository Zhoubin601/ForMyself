package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.os.Process;
import android.os.SystemClock;
import android.system.Os;
import android.system.StructStat;
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
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * M6-02-FIX-03 dedicated fault-injection and concurrency verification suite:
 * - R01: Final commit & durable recovery window (Os.rename -> Journal update SIGKILL window,
 *        atomic non-truncating Journal writes, VERIFIED_READY_TO_COMMIT rename recognition,
 *        UNCONFIRMED preservation, idempotent recovery, Importer post-rename recovery).
 * - R02: Cross-process task lock separation from deletable Journal, inode safety,
 *        strict cleanup-under-lock ordering, concurrent recovery / exit-cleanup races,
 *        and Importer post-lock pre-commit cancellation check.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM6Fix03CommitAndLockTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM6Fix03";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final String PW = "fix03-commit-lock-pw-\ufeff🔐";

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    private static String sha256File(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[65536];
        try (FileInputStream fis = new FileInputStream(f)) {
            int n;
            while ((n = fis.read(buf)) != -1) md.update(buf, 0, n);
        }
        return KanataM6PortableCrypto.bytesToHex(md.digest());
    }

    private static byte[] readAllBytes(File f) throws Exception {
        try (FileInputStream fis = new FileInputStream(f);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) baos.write(buf, 0, n);
            return baos.toByteArray();
        }
    }

    private static String readSmallText(File f) throws IOException {
        try (FileInputStream fis = new FileInputStream(f);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int r;
            while ((r = fis.read(buf)) != -1) baos.write(buf, 0, r);
            return new String(baos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void writeRaw(File f, String content) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(f, false)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.getFD().sync();
        }
    }

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            assertTrue(c.moveToFirst());
            return c.getString(0);
        }
    }

    private static void verifyBackupDecrypts(
            File pkgFile,
            String pw,
            KanataM6PortableCatalog catalog,
            File workDir,
            String expectedProjectedDigest) throws Exception {
        byte[] key = randomRawKey();
        File verifyDb = new File(workDir, "verify_fix03_" + UUID.randomUUID() + ".db");
        try {
            try (FileInputStream fis = new FileInputStream(pkgFile)) {
                KanataM6SchemeCImporter.ImportResult res = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, pw, catalog, workDir, verifyDb, key, new AtomicBoolean(false));
                assertEquals(50, res.footerVerifiers.size());
            }
            if (expectedProjectedDigest != null) {
                try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(
                        verifyDb.getAbsolutePath(), key, null, FLAGS_RO, (d, e) -> {}, null)) {
                    KanataM6SyntheticDataset.LogicalSummary sum =
                            KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true);
                    assertEquals(expectedProjectedDigest, sum.overallDigestHex);
                }
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            SQLiteDatabase.deleteDatabase(verifyDb);
        }
    }

    private static void waitProcessDead(Context ctx, int workerPid) throws InterruptedException {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        long killDeadline = SystemClock.elapsedRealtime() + 10_000L;
        while (SystemClock.elapsedRealtime() < killDeadline) {
            boolean found = false;
            List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
            if (procs != null) {
                for (ActivityManager.RunningAppProcessInfo p : procs) {
                    if (p.pid == workerPid) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found) return;
            Thread.sleep(50);
        }
        fail("Process " + workerPid + " did not die after SIGKILL");
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

    @Test
    public void r01_01_realSigkillAfterRenameBeforeJournalUpdateAndIdempotentRecovery() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_r01_01_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File killWorkDir = new File(workDir, "kill");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(killWorkDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File targetBackup = new File(workDir, "r01_target.kpb1");
        byte[] srcKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 25);
            // Baseline Backup A
            KanataM6SchemeCExporter.ExportMetrics emA = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                    null, null, new AtomicBoolean(false), null, "r01-base-a");
            String shaA = sha256File(targetBackup);
            assertEquals(emA.packageSha256Hex, shaA);

            // Mutate source for distinct Backup B
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-r01-b', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'R01_KILL_AFTER_RENAME_B', 1700009991111, 1, 'complete', 'tb', 'bb', NULL, NULL, NULL, '{}')");
            }
            String expectedBProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedBProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // Part A: Real OS SIGKILL strictly AFTER Os.rename completes and BEFORE RENAMED_PENDING_DIR_SYNC journal update!
            String taskIdB = "r01-sigkill-after-rename-b";
            File readyFile = new File(killWorkDir, "worker_ready.json");
            File recoveredFile = new File(killWorkDir, "worker_recovered.json");
            File errFile = new File(killWorkDir, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_EXPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_DB_PATH, srcDb.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(srcKey))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, targetBackup.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskIdB)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE,
                            KanataM6KillableWorkerService.STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE));

            long deadline = SystemClock.elapsedRealtime() + 20_000L;
            while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(50);
            }
            assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
            assertTrue("Worker did not pause after rename before journal update", readyFile.exists());

            JSONObject readyJson = new JSONObject(readSmallText(readyFile));
            int workerPidB = readyJson.getInt("pid");
            assertNotEquals(Process.myPid(), workerPidB);
            assertEquals("VERIFIED_READY_TO_COMMIT", readyJson.getString("journalStateAtPause"));
            assertFalse("Staged temp MUST already be gone (Os.rename completed!)", readyJson.getBoolean("stagedExistsAtPause"));
            assertTrue("Target MUST exist on disk", readyJson.getBoolean("targetExistsAtPause"));

            File pendingB = new File(spoolDir, ".task-" + taskIdB + ".pending");
            File lockB = new File(spoolDir, ".task-" + taskIdB + ".lock");
            assertTrue("Journal must exist on disk", pendingB.exists());
            assertTrue("Dedicated lock file must exist separately from journal", lockB.exists());
            JSONObject journalBeforeKill = new JSONObject(readSmallText(pendingB));
            assertEquals("VERIFIED_READY_TO_COMMIT", journalBeforeKill.getString("state"));
            String expectedShaB = journalBeforeKill.getString("expectedSha256Hex");
            assertEquals("Target on disk must already equal expectedSha256Hex of B", expectedShaB, sha256File(targetBackup));
            assertNotEquals("Target must reflect new Backup B, not A", shaA, expectedShaB);

            // Real OS SIGKILL inside the exact post-rename / pre-journal-update window!
            Process.killProcess(workerPidB);
            waitProcessDead(targetCtx, workerPidB);

            // First recovery attempt with injected dir fsync failure -> MUST stay UNCONFIRMED and NOT clean!
            KanataM6SchemeCExporter.RecoveryReport unconfRep = KanataM6SchemeCExporter.recoverIncompleteTasks(
                    new KanataM6SchemeCExporter.RecoveryHooks() {
                        @Override
                        public void performTargetDirFsync(File targetParentDir) throws IOException {
                            throw new IOException("EIO: injected recovery dir fsync failure");
                        }
                    }, spoolDir, workDir);
            assertEquals(1, unconfRep.unconfirmedCommitTasks);
            assertEquals(0, unconfRep.confirmedCommitTasks);
            assertEquals(0, unconfRep.cleanedTasks);
            assertTrue(unconfRep.unconfirmedCommitTaskIds.contains(taskIdB));
            assertTrue("Journal MUST remain while UNCONFIRMED", pendingB.exists());
            assertEquals(expectedShaB, sha256File(targetBackup));

            // Real cross-process recovery via fresh :m6worker -> MUST recognize completed rename & confirm!
            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_CHECK_RECOVERY)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_DIR, workDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskIdB));
            long recDeadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < recDeadline) {
                Thread.sleep(50);
            }
            assertTrue(recoveredFile.exists());
            JSONObject recJsonB = new JSONObject(readSmallText(recoveredFile));
            assertEquals(1, recJsonB.getInt("confirmedCommitTasks"));
            assertEquals(0, recJsonB.getInt("cleanedTasks"));
            assertEquals(0, recJsonB.getInt("unconfirmedCommitTasks"));
            assertFalse("Journal must be removed after confirmed commit", pendingB.exists());
            assertFalse("Dedicated lock file must be removed after recovery", lockB.exists());
            assertEquals(expectedShaB, sha256File(targetBackup));
            verifyBackupDecrypts(targetBackup, PW, catalog, workDir, expectedBProjected);

            // Idempotency check: repeated recovery invocations are pure no-ops and preserve target B
            KanataM6SchemeCExporter.RecoveryReport idem1 = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            KanataM6SchemeCExporter.RecoveryReport idem2 = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(0, idem1.scannedJournals);
            assertEquals(0, idem1.cleanedTasks);
            assertEquals(0, idem1.confirmedCommitTasks);
            assertEquals(0, idem1.unconfirmedCommitTasks);
            assertEquals(0, idem2.scannedJournals);
            assertEquals(expectedShaB, sha256File(targetBackup));

            // Part B: Real OS SIGKILL mid-journal-update (AFTER .pending.next written/fsynced, BEFORE Os.rename(.next, .pending))
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-r01-c', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'R01_KILL_MID_JOURNAL_C', 1700009992222, 1, 'complete', 'tc', 'bc', NULL, NULL, NULL, '{}')");
            }
            String expectedCProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedCProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            String taskIdC = "r01-sigkill-mid-journal-c";
            readyFile.delete();
            recoveredFile.delete();
            errFile.delete();

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_EXPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_DB_PATH, srcDb.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(srcKey))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, targetBackup.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskIdC)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE,
                            KanataM6KillableWorkerService.STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME));

            long deadlineC = SystemClock.elapsedRealtime() + 20_000L;
            while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadlineC) {
                Thread.sleep(50);
            }
            assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
            assertTrue(readyFile.exists());
            JSONObject readyC = new JSONObject(readSmallText(readyFile));
            int workerPidC = readyC.getInt("pid");
            assertEquals("VERIFIED_READY_TO_COMMIT", readyC.getString("journalStateAtPause"));
            assertTrue(readyC.getBoolean("tmpNextExistsAtPause"));

            Process.killProcess(workerPidC);
            waitProcessDead(targetCtx, workerPidC);

            File pendingC = new File(spoolDir, ".task-" + taskIdC + ".pending");
            File pendingCNext = new File(spoolDir, ".task-" + taskIdC + ".pending.next");
            assertTrue("Old journal must remain intact and non-truncated", pendingC.exists());
            assertTrue(".pending.next existed before SIGKILL", pendingCNext.exists());
            assertEquals("VERIFIED_READY_TO_COMMIT", new JSONObject(readSmallText(pendingC)).getString("state"));

            KanataM6SchemeCExporter.RecoveryReport recC = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(1, recC.confirmedCommitTasks);
            assertEquals(0, recC.cleanedTasks);
            assertFalse(pendingC.exists());
            assertFalse(".pending.next must be cleaned up on recovery", pendingCNext.exists());
            assertEquals(0, spoolDir.listFiles() == null ? 0 : spoolDir.listFiles().length);
            verifyBackupDecrypts(targetBackup, PW, catalog, workDir, expectedCProjected);

            Log.i(TAG, "R01_01=" + new JSONObject()
                    .put("sigkillAfterRenameBeforeJournalUpdateConfirmed", true)
                    .put("sigkillMidJournalUpdateNonTruncatingConfirmed", true)
                    .put("dirSyncFailKeptUnconfirmed", true)
                    .put("recoveryIdempotent", true)
                    .put("workerPidB", workerPidB)
                    .put("workerPidC", workerPidC));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void r01_02_journalAtomicNonTruncatingAndUnconfirmedStateMatrix() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_r01_02_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File targetBackup = new File(workDir, "r01_matrix.kpb1");
        byte[] srcKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 20);
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                    null, null, new AtomicBoolean(false), null, "r01-m-base");
            String shaA = sha256File(targetBackup);

            // Mutate source for B
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-r01-m', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'R01_MATRIX_B', 1700009993333, 1, 'complete', 'tm', 'bm', NULL, NULL, NULL, '{}')");
            }
            String expectedBProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedBProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // Part A: In-process injected failure during post-rename journal update -> old journal stays intact,
            // classified as ERR_DURABILITY_UNCONFIRMED, recovery confirms!
            String interruptedTid = "r01-journal-update-fail";
            KanataM6PortableCrypto.PortableException ex = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                            null, null, new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeJournalRename(String nextState, File tmpJournalFile, File journalFile) throws IOException {
                                    if ("RENAMED_PENDING_DIR_SYNC".equals(nextState)) {
                                        throw new IOException("EIO: injected journal atomic rename failure");
                                    }
                                }
                            }, interruptedTid));
            assertEquals(KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, ex.code);
            File interruptedJournal = new File(spoolDir, ".task-" + interruptedTid + ".pending");
            assertTrue("Intact VERIFIED_READY_TO_COMMIT journal must remain", interruptedJournal.exists());
            assertEquals("VERIFIED_READY_TO_COMMIT", new JSONObject(readSmallText(interruptedJournal)).getString("state"));
            String shaB = sha256File(targetBackup);
            assertNotEquals(shaA, shaB);

            // Part A.2: Crash during recovery right before journal delete -> still recoverable & idempotent!
            KanataM6SchemeCExporter.RecoveryReport interruptedRec = KanataM6SchemeCExporter.recoverIncompleteTasks(
                    new KanataM6SchemeCExporter.RecoveryHooks() {
                        @Override
                        public void beforeJournalDelete(String taskId, File journal) throws IOException {
                            throw new IOException("EIO: crash before journal delete");
                        }
                    }, spoolDir, workDir);
            assertEquals(1, interruptedRec.unconfirmedCommitTasks);
            assertTrue(interruptedJournal.exists());

            // Retry recovery cleanly -> confirms commit!
            KanataM6SchemeCExporter.RecoveryReport okRec = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(1, okRec.confirmedCommitTasks);
            assertFalse(interruptedJournal.exists());
            verifyBackupDecrypts(targetBackup, PW, catalog, workDir, expectedBProjected);

            // Part B: UNCONFIRMED state matrix (must NEVER blindly clean ambiguous / unverifiable commits)
            // Case 1: staged missing + target missing -> UNCONFIRMED
            File t1 = new File(workDir, "missing_target_1.kpb1");
            File j1 = new File(spoolDir, ".task-unconf-missing-target.pending");
            writeRaw(j1, new JSONObject()
                    .put("taskId", "unconf-missing-target")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", new File(spoolDir, ".missing_target_1.kpb1.unconf-missing-target.spool.tmp").getCanonicalPath())
                    .put("targetPath", t1.getCanonicalPath())
                    .put("expectedSha256Hex", shaB)
                    .toString());

            // Case 2: staged missing + target exists with WRONG sha -> UNCONFIRMED
            File t2 = new File(workDir, "wrong_sha_target_2.kpb1");
            writeRaw(t2, "OLD_DIFFERENT_TARGET_CONTENT");
            String t2Sha = sha256File(t2);
            File j2 = new File(spoolDir, ".task-unconf-wrong-sha.pending");
            writeRaw(j2, new JSONObject()
                    .put("taskId", "unconf-wrong-sha")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", new File(spoolDir, ".wrong_sha_target_2.kpb1.unconf-wrong-sha.spool.tmp").getCanonicalPath())
                    .put("targetPath", t2.getCanonicalPath())
                    .put("expectedSha256Hex", shaB)
                    .toString());

            // Case 3: staged missing + target matches shaB, BUT targetDir not in allowed dirs -> UNCONFIRMED
            File j3 = new File(spoolDir, ".task-unconf-dir-omitted.pending");
            writeRaw(j3, new JSONObject()
                    .put("taskId", "unconf-dir-omitted")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", new File(spoolDir, ".r01_matrix.kpb1.unconf-dir-omitted.spool.tmp").getCanonicalPath())
                    .put("targetPath", targetBackup.getCanonicalPath())
                    .put("expectedSha256Hex", shaB)
                    .toString());

            // Case 4: staged exists, BUT staged SHA mismatches expectedSha -> UNCONFIRMED
            File s4 = new File(spoolDir, ".t4.kpb1.unconf-corrupt-stage.spool.tmp");
            writeRaw(s4, "CORRUPTED_STAGE_BYTES");
            File j4 = new File(spoolDir, ".task-unconf-corrupt-stage.pending");
            writeRaw(j4, new JSONObject()
                    .put("taskId", "unconf-corrupt-stage")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", s4.getCanonicalPath())
                    .put("targetPath", new File(workDir, "t4.kpb1").getCanonicalPath())
                    .put("expectedSha256Hex", shaB)
                    .toString());

            // Check j1..j4 when targetDir omitted -> ALL 4 MUST stay UNCONFIRMED (j3 cannot verify target without workDir)
            KanataM6SchemeCExporter.RecoveryReport onlySpoolRep = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(4, onlySpoolRep.unconfirmedCommitTasks);
            assertEquals(0, onlySpoolRep.cleanedTasks);
            assertEquals(0, onlySpoolRep.confirmedCommitTasks);
            assertTrue(j1.exists() && j2.exists() && j3.exists() && j4.exists());
            assertTrue(s4.exists());
            assertEquals(t2Sha, sha256File(t2));

            // Case 5: BOTH staged AND target match expectedSha (ambiguous duplicate) -> UNCONFIRMED when targetDir is inspectable!
            File t5 = new File(workDir, "ambiguous_dup_5.kpb1");
            File s5 = new File(spoolDir, ".ambiguous_dup_5.kpb1.unconf-both-match.spool.tmp");
            writeRaw(t5, "IDENTICAL_DUPLICATE_PAYLOAD");
            writeRaw(s5, "IDENTICAL_DUPLICATE_PAYLOAD");
            String dupSha = sha256File(t5);
            File j5 = new File(spoolDir, ".task-unconf-both-match.pending");
            writeRaw(j5, new JSONObject()
                    .put("taskId", "unconf-both-match")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", s5.getCanonicalPath())
                    .put("targetPath", t5.getCanonicalPath())
                    .put("expectedSha256Hex", dupSha)
                    .toString());

            // Now include workDir: j3 confirms (staged missing + target matches shaB), while j1/j2/j4/j5 MUST remain UNCONFIRMED!
            KanataM6SchemeCExporter.RecoveryReport withTargetRep = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(1, withTargetRep.confirmedCommitTasks);
            assertTrue(withTargetRep.confirmedCommitTaskIds.contains("unconf-dir-omitted"));
            assertEquals(4, withTargetRep.unconfirmedCommitTasks);
            assertEquals(0, withTargetRep.cleanedTasks);
            assertFalse(j3.exists());
            assertTrue(j1.exists() && j2.exists() && j4.exists() && j5.exists());
            assertTrue(s4.exists() && s5.exists());
            assertEquals(t2Sha, sha256File(t2));

            // Case 6: staged exists with matching SHA while target holds different prior Backup A -> CLEANED (prior A untouched!)
            File s6 = new File(spoolDir, ".wrong_sha_target_2.kpb1.clean-verified-unrenamed.spool.tmp");
            writeRaw(s6, "NEW_STAGED_NOT_YET_RENAMED");
            String s6Sha = sha256File(s6);
            File j6 = new File(spoolDir, ".task-clean-verified-unrenamed.pending");
            writeRaw(j6, new JSONObject()
                    .put("taskId", "clean-verified-unrenamed")
                    .put("state", "VERIFIED_READY_TO_COMMIT")
                    .put("tmpSpoolPath", s6.getCanonicalPath())
                    .put("targetPath", t2.getCanonicalPath())
                    .put("expectedSha256Hex", s6Sha)
                    .toString());
            KanataM6SchemeCExporter.RecoveryReport cleanRep = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(1, cleanRep.cleanedTasks);
            assertTrue(cleanRep.cleanedTaskIds.contains("clean-verified-unrenamed"));
            assertEquals(4, cleanRep.unconfirmedCommitTasks);
            assertFalse(s6.exists());
            assertFalse(j6.exists());
            assertEquals("Prior target must remain untouched when cleaning unrenamed VERIFIED_READY_TO_COMMIT",
                    t2Sha, sha256File(t2));

            Log.i(TAG, "R01_02=" + new JSONObject()
                    .put("interruptedJournalUpdatePreservedOldRecord", true)
                    .put("recoveryCrashBeforeDeleteIdempotent", true)
                    .put("all5UnconfirmedCasesPreserved", true)
                    .put("unrenamedVerifiedCleanPreservedPriorTarget", true));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void r01_03_importerDirFsyncFailureRecoveryAndRealSigkill() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_r01_03_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File killWorkDir = new File(workDir, "kill");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(killWorkDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File pkgFile = new File(workDir, "pkg.kpb1");
        File targetDb1 = new File(workDir, "imp_dir_fail_rec.db");
        File targetDb2 = new File(workDir, "imp_sigkill_rec.db");
        byte[] srcKey = randomRawKey();
        byte[] impKey1 = randomRawKey();
        byte[] impKey2 = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 22);
            String expectedProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, pkgFile,
                    null, null, new AtomicBoolean(false), null, "r01-imp-src");
            byte[] pkgBytes = readAllBytes(pkgFile);

            // Part A: Importer post-rename dir fsync failure -> ERR_DURABILITY_UNCONFIRMED + durable journal + recoverable!
            String impTid1 = "r01-imp-dirsync-fail";
            KanataM6PortableCrypto.PortableException durEx = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkgBytes), PW, catalog, workDir,
                            targetDb1, impKey1, new AtomicBoolean(false), false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void performTargetDirFsync(File targetParentDir) throws Exception {
                                    throw new IOException("EIO: injected importer dir fsync failure");
                                }
                            }, impTid1));
            assertEquals(KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, durEx.code);
            assertTrue("Committed DB must not be deleted", targetDb1.exists());
            File impJournal1 = new File(workDir, ".import-" + impTid1 + ".pending");
            assertTrue("Import durability journal must be persisted for recovery", impJournal1.exists());
            JSONObject jObj1 = new JSONObject(readSmallText(impJournal1));
            assertEquals("RENAMED_PENDING_DIR_SYNC", jObj1.getString("state"));
            assertEquals(sha256File(targetDb1), jObj1.getString("expectedSha256Hex"));

            // Recovery with failing dir fsync stays UNCONFIRMED
            KanataM6SchemeCImporter.ImportRecoveryReport unconfRep = KanataM6SchemeCImporter.recoverIncompleteImports(
                    new KanataM6SchemeCImporter.ImportRecoveryHooks() {
                        @Override
                        public void performTargetDirFsync(File targetParentDir) throws IOException {
                            throw new IOException("EIO: still failing");
                        }
                    }, workDir);
            assertEquals(1, unconfRep.unconfirmedCommitTasks);
            assertEquals(0, unconfRep.confirmedCommitTasks);
            assertTrue(impJournal1.exists());

            // Recovery with real fsync confirms durability & cleans journal
            KanataM6SchemeCImporter.ImportRecoveryReport confRep = KanataM6SchemeCImporter.recoverIncompleteImports(workDir);
            assertEquals(1, confRep.confirmedCommitTasks);
            assertTrue(confRep.confirmedCommitTaskIds.contains(impTid1));
            assertFalse(impJournal1.exists());
            assertFalse(KanataM6SchemeCImporter.hasActiveCommitLock(targetDb1));
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(targetDb1.getPath(), impKey1, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("ok", scalar(ro, "PRAGMA integrity_check"));
                assertEquals(expectedProjected,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex);
            }
            // Idempotency
            KanataM6SchemeCImporter.ImportRecoveryReport idemRep = KanataM6SchemeCImporter.recoverIncompleteImports(workDir);
            assertEquals(0, idemRep.scannedJournals);
            assertEquals(0, idemRep.confirmedCommitTasks);

            // Part B: Real OS SIGKILL on :m6worker Importer AFTER Os.rename, BEFORE RENAMED_PENDING_DIR_SYNC journal update!
            String impTid2 = "r01-imp-sigkill-after-rename";
            File readyFile = new File(killWorkDir, "worker_ready.json");
            File recoveredFile = new File(killWorkDir, "worker_import_recovered.json");
            File errFile = new File(killWorkDir, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_IMPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PACKAGE_PATH, pkgFile.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(impKey2))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, targetDb2.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, impTid2)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE,
                            KanataM6KillableWorkerService.STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE));

            long deadline = SystemClock.elapsedRealtime() + 20_000L;
            while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(50);
            }
            assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
            assertTrue("Import worker did not reach post-rename pause", readyFile.exists());
            JSONObject readyJson = new JSONObject(readSmallText(readyFile));
            int workerPid = readyJson.getInt("pid");
            assertEquals("VERIFIED_READY_TO_COMMIT", readyJson.getString("journalStateAtPause"));
            assertTrue(readyJson.getBoolean("targetExistsAtPause"));

            Process.killProcess(workerPid);
            waitProcessDead(targetCtx, workerPid);

            File impJournal2 = new File(workDir, ".import-" + impTid2 + ".pending");
            assertTrue(impJournal2.exists());
            assertEquals("VERIFIED_READY_TO_COMMIT", new JSONObject(readSmallText(impJournal2)).getString("state"));

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_CHECK_IMPORT_RECOVERY)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_DIR, workDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, impTid2));
            long recDeadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < recDeadline) {
                Thread.sleep(50);
            }
            assertTrue(recoveredFile.exists());
            JSONObject recJson = new JSONObject(readSmallText(recoveredFile));
            assertEquals(1, recJson.getInt("confirmedCommitTasks"));
            assertEquals(0, recJson.getInt("cleanedTasks"));
            assertFalse(impJournal2.exists());
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(targetDb2.getPath(), impKey2, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("ok", scalar(ro, "PRAGMA integrity_check"));
                assertEquals(expectedProjected,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex);
            }
            assertEquals(0, KanataM6SchemeCImporter.recoverIncompleteImports(workDir).scannedJournals);

            Log.i(TAG, "R01_03=" + new JSONObject()
                    .put("importerDirFsyncFailureRecovered", true)
                    .put("importerSigkillAfterRenameBeforeJournalUpdateRecovered", true)
                    .put("importerRecoveryIdempotent", true)
                    .put("workerPid", workerPid));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(impKey1, (byte) 0);
            Arrays.fill(impKey2, (byte) 0);
            SQLiteDatabase.deleteDatabase(targetDb1);
            SQLiteDatabase.deleteDatabase(targetDb2);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void r02_01_lockJournalSeparationInodeSafetyAndConcurrentRecoveryRaces() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_r02_01_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        byte[] srcKey = randomRawKey();
        ExecutorService exec = Executors.newFixedThreadPool(3);

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 20);
            String expectedProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // Part A: Dedicated lock file separated from mutable Journal + atomic Journal inode swap preserves lock inode!
            String tidA = "r02-lock-sep-a";
            File targetA = new File(workDir, "r02_a.kpb1");
            AtomicLong lockInoStarted = new AtomicLong(-1L);
            AtomicLong journalInoStarted = new AtomicLong(-1L);
            AtomicLong lockInoVerified = new AtomicLong(-1L);
            AtomicLong journalInoVerified = new AtomicLong(-1L);

            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetA,
                    null, null, new AtomicBoolean(false),
                    new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void onTaskTempFileCreated(String taskId, File tmpSpool) {
                            try {
                                StructStat ls = Os.lstat(new File(spoolDir, ".task-" + taskId + ".lock").getPath());
                                StructStat js = Os.lstat(new File(spoolDir, ".task-" + taskId + ".pending").getPath());
                                lockInoStarted.set(ls.st_ino);
                                journalInoStarted.set(js.st_ino);
                            } catch (Throwable t) {
                                throw new RuntimeException(t);
                            }
                        }

                        @Override
                        public void beforeAtomicCommit(File stagedFile, File finalTargetFile) throws IOException {
                            try {
                                StructStat ls = Os.lstat(new File(spoolDir, ".task-" + tidA + ".lock").getPath());
                                StructStat js = Os.lstat(new File(spoolDir, ".task-" + tidA + ".pending").getPath());
                                lockInoVerified.set(ls.st_ino);
                                journalInoVerified.set(js.st_ino);
                            } catch (Throwable t) {
                                throw new IOException(t);
                            }
                        }
                    }, tidA);
            assertTrue(lockInoStarted.get() > 0L);
            assertNotEquals("Lock file MUST be a separate inode from Journal file",
                    lockInoStarted.get(), journalInoStarted.get());
            assertEquals("Lock file inode MUST stay stable across Journal atomic updates",
                    lockInoStarted.get(), lockInoVerified.get());
            assertNotEquals("Journal MUST update via atomic rename (new inode), never truncate in-place",
                    journalInoStarted.get(), journalInoVerified.get());
            assertFalse("Task lock must be cleaned after completion",
                    KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tidA));

            // Part B: Task exit cleanup race — cleanup executes STRICTLY under lock; neither recovery nor duplicate Task ID can interleave!
            String tidB = "r02-exit-cleanup-race";
            File targetB1 = new File(workDir, "r02_b1.kpb1");
            File targetB2 = new File(workDir, "r02_b2.kpb1");
            CountDownLatch inCleanupUnderLock = new CountDownLatch(1);
            CountDownLatch releaseCleanup = new CountDownLatch(1);

            Future<String> t1ExitFuture = exec.submit(() -> {
                try {
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetB1,
                            null, null, new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                    if (totalWrittenSoFar > 64L) {
                                        throw new IOException("EIO: force task exit into cleanup");
                                    }
                                }

                                @Override
                                public void beforeTaskCleanupUnderLock(String taskId, File tmpSpool, File journalFile) {
                                    inCleanupUnderLock.countDown();
                                    try {
                                        releaseCleanup.await(15, TimeUnit.SECONDS);
                                    } catch (InterruptedException ignored) {}
                                }
                            }, tidB);
                    return "UNEXPECTED_OK";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return pe.code;
                }
            });

            assertTrue("Task 1 did not enter cleanup critical section", inCleanupUnderLock.await(10, TimeUnit.SECONDS));
            assertTrue("Task lock must still be held during cleanup!",
                    KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tidB));
            // Recovery while Task 1 is in cleanup MUST skip Task 1
            KanataM6SchemeCExporter.RecoveryReport recDuringCleanup = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(0, recDuringCleanup.cleanedTasks);
            assertTrue(recDuringCleanup.skippedActiveTaskIds.contains(tidB));
            // Duplicate Task ID while Task 1 is in cleanup MUST be rejected
            KanataM6PortableCrypto.PortableException dupDuringCleanup = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetB2,
                            null, null, new AtomicBoolean(false), null, tidB));
            assertEquals("task-id-already-active", dupDuringCleanup.stage);

            // Release Task 1 cleanup -> completes cleanup cleanly, then Task 2 with SAME tidB succeeds!
            releaseCleanup.countDown();
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, t1ExitFuture.get(15, TimeUnit.SECONDS));
            assertFalse(KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tidB));

            KanataM6SchemeCExporter.ExportMetrics emB2 = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetB2,
                    null, null, new AtomicBoolean(false), null, tidB);
            assertEquals(emB2.packageSha256Hex, sha256File(targetB2));
            verifyBackupDecrypts(targetB2, PW, catalog, workDir, expectedProjected);

            // Part C: Concurrent recovery race (2 recovery threads + new Exporter with same tid racing on crashed task)
            String tidC = "r02-concurrent-recovery";
            File crashedTmp = new File(spoolDir, ".crashed.kpb1." + tidC + ".spool.tmp");
            File crashedJournal = new File(spoolDir, ".task-" + tidC + ".pending");
            writeRaw(crashedTmp, "STALE_CRASHED_SPOOL");
            writeRaw(crashedJournal, new JSONObject()
                    .put("taskId", tidC)
                    .put("state", "STARTED")
                    .put("tmpSpoolPath", crashedTmp.getCanonicalPath())
                    .put("targetPath", new File(workDir, "crashed.kpb1").getCanonicalPath())
                    .toString());

            CountDownLatch rec1HoldingLock = new CountDownLatch(1);
            CountDownLatch releaseRec1 = new CountDownLatch(1);
            Future<KanataM6SchemeCExporter.RecoveryReport> rec1Future = exec.submit(() ->
                    KanataM6SchemeCExporter.recoverIncompleteTasks(new KanataM6SchemeCExporter.RecoveryHooks() {
                        @Override
                        public void afterTaskLockAcquired(String taskId) throws IOException {
                            if (tidC.equals(taskId)) {
                                rec1HoldingLock.countDown();
                                try {
                                    assertTrue(releaseRec1.await(15, TimeUnit.SECONDS));
                                } catch (InterruptedException ie) {
                                    throw new IOException(ie);
                                }
                            }
                        }
                    }, spoolDir));
            assertTrue(rec1HoldingLock.await(10, TimeUnit.SECONDS));

            // Second concurrent recovery MUST skip tidC cleanly without touching files
            KanataM6SchemeCExporter.RecoveryReport rec2 = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(0, rec2.cleanedTasks);
            assertTrue(rec2.skippedActiveTaskIds.contains(tidC));
            assertTrue(crashedTmp.exists());
            assertTrue(crashedJournal.exists());

            // New Exporter with SAME tidC while recovery holds lock MUST be rejected at lock!
            File targetC = new File(workDir, "r02_c.kpb1");
            KanataM6PortableCrypto.PortableException exDuringRec = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetC,
                            null, null, new AtomicBoolean(false), null, tidC));
            assertEquals("task-id-locked", exDuringRec.stage);

            releaseRec1.countDown();
            KanataM6SchemeCExporter.RecoveryReport rec1 = rec1Future.get(15, TimeUnit.SECONDS);
            assertEquals(1, rec1.cleanedTasks);
            assertFalse(crashedTmp.exists());
            assertFalse(crashedJournal.exists());
            assertFalse(KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tidC));

            // After recovery finishes, Exporter with SAME tidC succeeds cleanly!
            KanataM6SchemeCExporter.ExportMetrics emC = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetC,
                    null, null, new AtomicBoolean(false), null, tidC);
            assertEquals(emC.packageSha256Hex, sha256File(targetC));

            // Part D: Inode-replacement defense-in-depth — even if external actor replaces .lock/.tmp/.pending inodes,
            // exiting old task MUST NOT delete newer-inode files created for a new task!
            String tidD = "r02-inode-defense";
            File targetD = new File(workDir, "r02_d.kpb1");
            File lockD = new File(spoolDir, ".task-" + tidD + ".lock");
            File pendingD = new File(spoolDir, ".task-" + tidD + ".pending");
            AtomicReference<File> tmpDRef = new AtomicReference<>();

            KanataM6PortableCrypto.PortableException exD = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetD,
                            null, null, new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void onTaskTempFileCreated(String taskId, File tmpSpool) {
                                    tmpDRef.set(tmpSpool);
                                }

                                @Override
                                public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                    if (totalWrittenSoFar > 64L) {
                                        // Simulate rogue external unlink + fresh-inode replacement at all 3 paths!
                                        File tmpD = tmpDRef.get();
                                        assertTrue(lockD.delete());
                                        assertTrue(pendingD.delete());
                                        assertTrue(tmpD.delete());
                                        writeRaw(lockD, "NEW_LOCK_INODE_SENTINEL");
                                        writeRaw(pendingD, "NEW_JOURNAL_INODE_SENTINEL");
                                        writeRaw(tmpD, "NEW_TMP_INODE_SENTINEL");
                                        throw new IOException("EIO: abort old task after inode replacement");
                                    }
                                }
                            }, tidD));
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, exD.code);
            // Old task MUST NOT have deleted ANY of the newer-inode sentinel files!
            assertTrue("New-inode lock sentinel was deleted by old task!", lockD.exists());
            assertTrue("New-inode journal sentinel was deleted by old task!", pendingD.exists());
            assertTrue("New-inode tmp sentinel was deleted by old task!", tmpDRef.get().exists());
            assertEquals("NEW_LOCK_INODE_SENTINEL", readSmallText(lockD));
            assertEquals("NEW_JOURNAL_INODE_SENTINEL", readSmallText(pendingD));
            assertEquals("NEW_TMP_INODE_SENTINEL", readSmallText(tmpDRef.get()));

            Log.i(TAG, "R02_01=" + new JSONObject()
                    .put("lockAndJournalSeparatedInodes", true)
                    .put("journalAtomicInodeSwapVerified", true)
                    .put("exitCleanupStrictlyUnderLock", true)
                    .put("concurrentRecoverySerialized", true)
                    .put("recoveryBlocksDuplicateExporter", true)
                    .put("inodeReplacementPreservedNewFiles", true));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void r02_02_importerCancelledWaiterMustNotCommitAfterAcquiringTargetLock() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_r02_02_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File src1 = new File(workDir, "src1.db");
        File src2 = new File(workDir, "src2.db");
        File pkg1 = new File(workDir, "pkg1.kpb1");
        File pkg2 = new File(workDir, "pkg2.kpb1");
        File targetDb = new File(workDir, "cancel_waiter_target.db");
        File targetAfterLockCancel = new File(workDir, "cancel_after_lock_target.db");
        File targetBeforeRenameCancel = new File(workDir, "cancel_before_rename_target.db");

        byte[] k1 = randomRawKey();
        byte[] k2 = randomRawKey();
        byte[] impKey = randomRawKey();
        ExecutorService exec = Executors.newFixedThreadPool(2);

        try {
            KanataM6SyntheticDataset.populateUniformDataset(src1, k1, catalog, 18);
            KanataM6SyntheticDataset.populateUniformDataset(src2, k2, catalog, 37);
            KanataM6SchemeCExporter.exportToSpool(src1.getPath(), k1, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, pkg1, null, null, new AtomicBoolean(false), null);
            KanataM6SchemeCExporter.exportToSpool(src2.getPath(), k2, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, pkg2, null, null, new AtomicBoolean(false), null);
            byte[] pkg1Bytes = readAllBytes(pkg1);
            byte[] pkg2Bytes = readAllBytes(pkg2);

            // Part A: Task 1 holds TargetCommitLockHandle; Task 2 reaches lock wait, gets CANCELLED while waiting;
            // after Task 1 releases lock, Task 2 MUST abort with ERR_CANCELLED and NEVER overwrite Task 1!
            CountDownLatch t1HoldingLock = new CountDownLatch(1);
            CountDownLatch t2ReadyToWaitForLock = new CountDownLatch(1);
            CountDownLatch releaseT1 = new CountDownLatch(1);
            AtomicBoolean t2Cancelled = new AtomicBoolean(false);
            AtomicInteger t2CommitAttempts = new AtomicInteger(0);

            Future<String> f1 = exec.submit(() -> {
                KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        new ByteArrayInputStream(pkg1Bytes), PW, catalog, workDir,
                        targetDb, impKey, new AtomicBoolean(false), true,
                        new KanataM6SchemeCImporter.ImportHooks() {
                            @Override
                            public void beforeTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                                t1HoldingLock.countDown();
                                assertTrue(releaseT1.await(15, TimeUnit.SECONDS));
                            }
                        }, "r02-imp-t1");
                return "T1_COMMITTED";
            });

            assertTrue("Task 1 did not acquire commit lock", t1HoldingLock.await(15, TimeUnit.SECONDS));

            Future<String> f2 = exec.submit(() -> {
                try {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg2Bytes), PW, catalog, workDir,
                            targetDb, impKey, t2Cancelled, true,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void afterStagingVerified(File targetStageFile) {
                                    t2ReadyToWaitForLock.countDown();
                                }

                                @Override
                                public void performAtomicTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                                    t2CommitAttempts.incrementAndGet();
                                    KanataM6SchemeCImporter.defaultAtomicRenameOnly(targetStageFile, targetDbFile);
                                }
                            }, "r02-imp-t2-waiter");
                    return "UNEXPECTED_COMMIT";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return pe.code;
                }
            });

            assertTrue("Task 2 did not finish staging", t2ReadyToWaitForLock.await(15, TimeUnit.SECONDS));
            // Give Task 2 time to enter acquireTargetCommitLock and block waiting behind Task 1
            Thread.sleep(120);
            t2Cancelled.set(true);
            releaseT1.countDown();

            assertEquals("T1_COMMITTED", f1.get(15, TimeUnit.SECONDS));
            assertEquals(KanataM6PortableCrypto.ERR_CANCELLED, f2.get(15, TimeUnit.SECONDS));
            assertEquals("Cancelled waiting Task 2 MUST NEVER attempt Os.rename!", 0, t2CommitAttempts.get());
            assertFalse(KanataM6SchemeCImporter.hasActiveCommitLock(targetDb));

            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(targetDb.getPath(), impKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("ok", scalar(ro, "PRAGMA integrity_check"));
                assertEquals("Target DB MUST contain Task 1's 18 messages, NOT cancelled Task 2's 37!",
                        "18", scalar(ro, "SELECT count(*) FROM messages"));
            }

            // Part B: Cancel immediately AFTER acquiring TargetCommitLockHandle (before journal/commit)
            AtomicBoolean cancelAfterLock = new AtomicBoolean(false);
            AtomicInteger commitAttemptsB = new AtomicInteger(0);
            KanataM6PortableCrypto.PortableException exB = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg2Bytes), PW, catalog, workDir,
                            targetAfterLockCancel, impKey, cancelAfterLock, false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void afterTargetLockAcquiredBeforeCommit(File targetStageFile, File targetDbFile) {
                                    cancelAfterLock.set(true);
                                }

                                @Override
                                public void performAtomicTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                                    commitAttemptsB.incrementAndGet();
                                    KanataM6SchemeCImporter.defaultAtomicRenameOnly(targetStageFile, targetDbFile);
                                }
                            }, "r02-imp-cancel-after-lock"));
            assertEquals(KanataM6PortableCrypto.ERR_CANCELLED, exB.code);
            assertEquals(0, commitAttemptsB.get());
            assertFalse(targetAfterLockCancel.exists());
            assertFalse(KanataM6SchemeCImporter.hasActiveCommitLock(targetAfterLockCancel));

            // Part C: Cancel inside beforeTargetCommit (after journal written, immediately before Os.rename)
            AtomicBoolean cancelBeforeRename = new AtomicBoolean(false);
            AtomicInteger commitAttemptsC = new AtomicInteger(0);
            KanataM6PortableCrypto.PortableException exC = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg2Bytes), PW, catalog, workDir,
                            targetBeforeRenameCancel, impKey, cancelBeforeRename, false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void beforeTargetCommit(File targetStageFile, File targetDbFile) {
                                    cancelBeforeRename.set(true);
                                }

                                @Override
                                public void performAtomicTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                                    commitAttemptsC.incrementAndGet();
                                    KanataM6SchemeCImporter.defaultAtomicRenameOnly(targetStageFile, targetDbFile);
                                }
                            }, "r02-imp-cancel-before-rename"));
            assertEquals(KanataM6PortableCrypto.ERR_CANCELLED, exC.code);
            assertEquals(0, commitAttemptsC.get());
            assertFalse(targetBeforeRenameCancel.exists());
            assertFalse(KanataM6SchemeCImporter.hasActiveCommitLock(targetBeforeRenameCancel));
            for (File f : workDir.listFiles()) {
                assertFalse("No leftover stage file allowed: " + f.getName(), f.getName().startsWith(".stage-"));
                assertFalse("No leftover import journal allowed: " + f.getName(), f.getName().startsWith(".import-"));
            }

            Log.i(TAG, "R02_02=" + new JSONObject()
                    .put("cancelledWaiterBlockedBeforeCommit", true)
                    .put("cancelAfterLockBlockedBeforeCommit", true)
                    .put("cancelBeforeRenameBlockedAndCleaned", true)
                    .put("winnerMessagesPreserved", 18));
        } finally {
            Arrays.fill(k1, (byte) 0);
            Arrays.fill(k2, (byte) 0);
            Arrays.fill(impKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            SQLiteDatabase.deleteDatabase(targetDb);
            deleteRecursive(workDir);
        }
    }
}
