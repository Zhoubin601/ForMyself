package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.os.Process;
import android.os.SystemClock;
import android.system.Os;
import android.system.StructStatVfs;
import android.util.Log;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONArray;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * M6-02-FIX-02 dedicated fault-injection and P1/P2 verification suite:
 * - P1-01: Exporter Task ID atomic ownership & cross-thread / cross-process conflict isolation.
 * - P1-02: Importer target-path commit mutex across concurrent commits & existing target protection.
 * - P1-03: Unified Bridge control request size (<= 4096 B UTF-8), field allowlist & response cap (<= 512 B).
 * - P1-04: Sensitive buffer lifecycle & verified zeroization across all 8 injection points + normal exit.
 * - P1-05: Strict directory fsync failure classification (ERR_DURABILITY_UNCONFIRMED), recovery & Android FS probe.
 * - P2-01: Journal canonical path & Task ID validation rejecting forged / traversal / corrupted journals.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM6Fix02FaultInjectionTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM6Fix02";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final String PW = "fix02-secret-pw-\ufeff📦";

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

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            assertTrue(c.moveToFirst());
            return c.getString(0);
        }
    }

    private static void verifyBackupDecrypts(File pkgFile, String pw, KanataM6PortableCatalog catalog, File workDir, String expectedProjectedDigest) throws Exception {
        byte[] key = randomRawKey();
        File verifyDb = new File(workDir, "verify_fix02_" + UUID.randomUUID() + ".db");
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

    @Test
    public void p1_01_duplicateTaskIdConcurrencyAndCrossProcessProtection() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_p101_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File killWorkDir = new File(workDir, "kill");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(killWorkDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File target1 = new File(workDir, "dup_same_proc.kpb1");
        File target2 = new File(workDir, "dup_second.kpb1");
        byte[] srcKey = randomRawKey();
        ExecutorService exec = Executors.newSingleThreadExecutor();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 25);
            String expectedProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // Part A: Same-JVM concurrent threads sharing exact explicitTaskId
            final String sameProcTaskId = "dup-same-proc-01";
            CountDownLatch t1InSpoolWrite = new CountDownLatch(1);
            CountDownLatch releaseT1 = new CountDownLatch(1);
            AtomicReference<File> t1TmpRef = new AtomicReference<>();

            Future<KanataM6SchemeCExporter.ExportMetrics> t1Future = exec.submit(() ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, target1,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void onTaskTempFileCreated(String tid, File tmpSpool) {
                                    t1TmpRef.set(tmpSpool);
                                }
                                @Override
                                public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                    if (totalWrittenSoFar > 128 && t1InSpoolWrite.getCount() > 0) {
                                        t1InSpoolWrite.countDown();
                                        try {
                                            assertTrue(releaseT1.await(15, TimeUnit.SECONDS));
                                        } catch (InterruptedException ie) {
                                            throw new IOException(ie);
                                        }
                                    }
                                }
                            }, sameProcTaskId));

            assertTrue("Task 1 did not reach spool write stage", t1InSpoolWrite.await(10, TimeUnit.SECONDS));
            File t1Pending = new File(spoolDir, ".task-" + sameProcTaskId + ".pending");
            assertNotNull(t1TmpRef.get());
            assertTrue("Task 1 spool temp must exist", t1TmpRef.get().exists());
            assertTrue("Task 1 pending journal must exist", t1Pending.exists());
            assertTrue(KanataM6SchemeCExporter.isTaskActiveInProcess(sameProcTaskId));

            // While Task 1 is paused, recovery MUST skip Task 1
            KanataM6SchemeCExporter.RecoveryReport midRec = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(0, midRec.cleanedTasks);
            assertTrue(midRec.skippedActiveTaskIds.contains(sameProcTaskId));

            // Task 2 attempts the SAME explicitTaskId -> MUST be rejected without touching Task 1 files!
            KanataM6PortableCrypto.PortableException dupEx = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, target2,
                            null, null, new AtomicBoolean(false), null, sameProcTaskId));
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, dupEx.code);
            assertEquals("task-id-already-active", dupEx.stage);

            // Verify Task 1 resources are STILL intact while paused
            assertTrue("Task 1 tmpSpool was deleted by rejected duplicate!", t1TmpRef.get().exists());
            assertTrue("Task 1 journal was deleted by rejected duplicate!", t1Pending.exists());
            assertTrue("ACTIVE_TASKS lost ownership of Task 1!", KanataM6SchemeCExporter.isTaskActiveInProcess(sameProcTaskId));
            assertFalse(target2.exists());

            // Release Task 1 -> must finish cleanly and pass SHA-256 + decrypt verification
            releaseT1.countDown();
            KanataM6SchemeCExporter.ExportMetrics em1 = t1Future.get(15, TimeUnit.SECONDS);
            assertEquals(em1.packageSha256Hex, sha256File(target1));
            verifyBackupDecrypts(target1, PW, catalog, workDir, expectedProjected);
            assertFalse("ACTIVE_TASKS must release Task ID on completion", KanataM6SchemeCExporter.isTaskActiveInProcess(sameProcTaskId));

            // After completion, reusing the same Task ID succeeds cleanly
            File targetReuse = new File(workDir, "dup_reused.kpb1");
            KanataM6SchemeCExporter.ExportMetrics emReuse = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetReuse,
                    null, null, new AtomicBoolean(false), null, sameProcTaskId);
            assertEquals(emReuse.packageSha256Hex, sha256File(targetReuse));

            // Part B: Cross-process duplicate Task ID (:m6worker holds OS FileLock in SPOOL_WRITE)
            String xprocTaskId = "dup-xproc-02";
            File xprocTarget = new File(workDir, "xproc_target.kpb1");
            File readyFile = new File(killWorkDir, "worker_ready.json");
            File recoveredFile = new File(killWorkDir, "worker_recovered.json");
            File errFile = new File(killWorkDir, "worker_error.txt");

            Intent startWorker = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_EXPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_DB_PATH, srcDb.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(srcKey))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, xprocTarget.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, xprocTaskId)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, KanataM6KillableWorkerService.STAGE_SPOOL_WRITE);
            targetCtx.startService(startWorker);

            long deadline = SystemClock.elapsedRealtime() + 20_000L;
            while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(50);
            }
            assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
            assertTrue("Worker did not pause in SPOOL_WRITE", readyFile.exists());
            JSONObject readyJson = new JSONObject(readSmallText(readyFile));
            int workerPid = readyJson.getInt("pid");
            File workerTmpSpool = new File(readyJson.getString("tmpSpoolPath"));
            File workerPending = new File(spoolDir, ".task-" + xprocTaskId + ".pending");
            assertNotEquals(Process.myPid(), workerPid);
            assertTrue(workerTmpSpool.exists());
            assertTrue(workerPending.exists());

            // Test process (distinct JVM) tries SAME xprocTaskId -> rejected at OS FileLock!
            assertFalse(KanataM6SchemeCExporter.isTaskActiveInProcess(xprocTaskId));
            KanataM6PortableCrypto.PortableException xprocEx = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, target2,
                            null, null, new AtomicBoolean(false), null, xprocTaskId));
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, xprocEx.code);
            assertEquals("task-id-locked", xprocEx.stage);

            // Recovery in test process MUST also skip active :m6worker task!
            KanataM6SchemeCExporter.RecoveryReport xprocRecWhileAlive =
                    KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(0, xprocRecWhileAlive.cleanedTasks);
            assertTrue(xprocRecWhileAlive.skippedActiveTaskIds.contains(xprocTaskId));
            assertTrue(workerTmpSpool.exists());
            assertTrue(workerPending.exists());

            // Kill worker cleanly and verify startup recovery cleans it up
            Process.killProcess(workerPid);
            waitProcessDead(targetCtx, workerPid);
            Intent recIntent = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_CHECK_RECOVERY)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, xprocTaskId);
            targetCtx.startService(recIntent);
            long recDeadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < recDeadline) {
                Thread.sleep(50);
            }
            assertTrue(recoveredFile.exists());
            JSONObject recJson = new JSONObject(readSmallText(recoveredFile));
            assertEquals(1, recJson.getInt("cleanedTasks"));
            assertFalse(workerTmpSpool.exists());
            assertFalse(workerPending.exists());

            Log.i(TAG, "P1_01=" + new JSONObject()
                    .put("sameProcDupRejected", true)
                    .put("sameProcTask1CompletedSha256", em1.packageSha256Hex)
                    .put("crossProcDupRejected", true)
                    .put("activeRecoverySkipped", true)
                    .put("activeTasksReleased", true));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void p1_02_importerTargetMutexConcurrencyAndSidecarSafety() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_p102_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File src1 = new File(workDir, "src1.db");
        File src2 = new File(workDir, "src2.db");
        File pkg1 = new File(workDir, "pkg1.kpb1");
        File pkg2 = new File(workDir, "pkg2.kpb1");
        File raceTarget = new File(workDir, "concurrent_target.db");
        File existingDbA = new File(workDir, "existing_a.db");

        byte[] k1 = randomRawKey();
        byte[] k2 = randomRawKey();
        byte[] kA = randomRawKey();
        byte[] importKey = randomRawKey();
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

            // Part A: Race two concurrent Importers to the exact same uncreated targetDbFile using CyclicBarrier(2)
            CyclicBarrier commitRaceBarrier = new CyclicBarrier(2);
            CountDownLatch firstEnteredCommit = new CountDownLatch(1);
            AtomicInteger concurrentInCommitCriticalSection = new AtomicInteger(0);
            AtomicInteger maxConcurrentInCommit = new AtomicInteger(0);

            KanataM6SchemeCImporter.ImportHooks barrierHooks = new KanataM6SchemeCImporter.ImportHooks() {
                @Override
                public void afterStagingVerified(File targetStageFile) throws Exception {
                    commitRaceBarrier.await(15, TimeUnit.SECONDS);
                }

                @Override
                public void beforeTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                    int now = concurrentInCommitCriticalSection.incrementAndGet();
                    int prev;
                    do {
                        prev = maxConcurrentInCommit.get();
                        if (now <= prev) break;
                    } while (!maxConcurrentInCommit.compareAndSet(prev, now));
                    firstEnteredCommit.countDown();
                    Thread.sleep(80); // Hold commit lock briefly to prove serialized blocking
                    concurrentInCommitCriticalSection.decrementAndGet();
                }
            };

            Future<String> impF1 = exec.submit(() -> {
                try {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg1Bytes), PW, catalog, workDir,
                            raceTarget, importKey, new AtomicBoolean(false), false, barrierHooks);
                    return "WINNER:18";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return "ERR:" + pe.code + ":" + pe.stage;
                }
            });
            Future<String> impF2 = exec.submit(() -> {
                try {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg2Bytes), PW, catalog, workDir,
                            raceTarget, importKey, new AtomicBoolean(false), false, barrierHooks);
                    return "WINNER:37";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return "ERR:" + pe.code + ":" + pe.stage;
                }
            });

            String r1 = impF1.get(25, TimeUnit.SECONDS);
            String r2 = impF2.get(25, TimeUnit.SECONDS);
            assertEquals("Only 1 Importer may ever enter commit critical section at a time",
                    1, maxConcurrentInCommit.get());

            boolean oneWonTwoLost = (r1.startsWith("WINNER:") && r2.equals("ERR:IO_FAILED:target-already-exists"))
                    || (r2.startsWith("WINNER:") && r1.equals("ERR:IO_FAILED:target-already-exists"));
            assertTrue("Expected exactly 1 winner and 1 target conflict, got r1=" + r1 + ", r2=" + r2, oneWonTwoLost);
            String expectedMsgs = r1.startsWith("WINNER:") ? r1.substring("WINNER:".length()) : r2.substring("WINNER:".length());

            // Verify winner's target DB is completely intact, loser never overwrote it, sidecars & lock released
            assertTrue(raceTarget.exists());
            assertFalse("Target WAL must not exist after atomic commit", new File(raceTarget.getPath() + "-wal").exists());
            assertFalse("Target SHM must not exist after atomic commit", new File(raceTarget.getPath() + "-shm").exists());
            assertFalse("Commit mutex lock must be released", KanataM6SchemeCImporter.hasActiveCommitLock(raceTarget));
            for (File f : workDir.listFiles()) {
                assertFalse("No leftover stage file allowed: " + f.getName(), f.getName().startsWith(".stage-"));
            }
            String raceShaAfterRace = sha256File(raceTarget);
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(raceTarget.getPath(), importKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("ok", scalar(ro, "PRAGMA integrity_check"));
                assertEquals(expectedMsgs, scalar(ro, "SELECT count(*) FROM messages"));
            }

            // Part B: Two concurrent Importers racing into commit against EXISTING Database A
            // with allowOverwriteExistingTarget=false (both must fail) & allowOverwriteExistingTarget=true with commit fail:
            KanataM6SyntheticDataset.populateUniformDataset(existingDbA, kA, catalog, 12);
            try (SQLiteDatabase ck = SQLiteDatabase.openDatabase(existingDbA.getPath(), kA, null, FLAGS_RW, (d, e) -> {}, null)) {
                scalar(ck, "PRAGMA wal_checkpoint(TRUNCATE)");
            }
            String existingAShaBefore = sha256File(existingDbA);

            // Second attempt with target ALREADY existing must still fail even when two race at target check
            KanataM6PortableCrypto.PortableException exRaceExisting = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg1Bytes), PW, catalog, workDir,
                            raceTarget, importKey, new AtomicBoolean(false), false, null));
            assertEquals("target-already-exists", exRaceExisting.stage);
            assertEquals("Existing committed target SHA-256 must stay unchanged", raceShaAfterRace, sha256File(raceTarget));

            // Allow overwrite true with commit failure concurrency barrier
            CyclicBarrier overwriteBarrier = new CyclicBarrier(2);
            KanataM6SchemeCImporter.ImportHooks failCommitHooks = new KanataM6SchemeCImporter.ImportHooks() {
                @Override
                public void afterStagingVerified(File targetStageFile) throws Exception {
                    overwriteBarrier.await(15, TimeUnit.SECONDS);
                }

                @Override
                public void performAtomicTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
                    throw new IOException("EIO: concurrent commit aborted");
                }
            };
            Future<String> ow1 = exec.submit(() -> {
                try {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg1Bytes), PW, catalog, workDir,
                            existingDbA, importKey, new AtomicBoolean(false), true, failCommitHooks);
                    return "UNEXPECTED_OK";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return pe.code;
                }
            });
            Future<String> ow2 = exec.submit(() -> {
                try {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkg2Bytes), PW, catalog, workDir,
                            existingDbA, importKey, new AtomicBoolean(false), true, failCommitHooks);
                    return "UNEXPECTED_OK";
                } catch (KanataM6PortableCrypto.PortableException pe) {
                    return pe.code;
                }
            });
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, ow1.get(25, TimeUnit.SECONDS));
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, ow2.get(25, TimeUnit.SECONDS));
            assertEquals("Existing DB A must stay byte-for-byte unchanged", existingAShaBefore, sha256File(existingDbA));
            assertFalse("Existing DB A mutex must be released", KanataM6SchemeCImporter.hasActiveCommitLock(existingDbA));

            Log.i(TAG, "P1_02=" + new JSONObject()
                    .put("maxConcurrentCommitThreads", maxConcurrentInCommit.get())
                    .put("winnerResult", r1.startsWith("WINNER:") ? r1 : r2)
                    .put("loserResult", r1.startsWith("WINNER:") ? r2 : r1)
                    .put("existingTargetProtected", true)
                    .put("commitMutexReleased", true));
        } finally {
            Arrays.fill(k1, (byte) 0);
            Arrays.fill(k2, (byte) 0);
            Arrays.fill(kA, (byte) 0);
            Arrays.fill(importKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void p1_03_bridgeUnifiedSizeAllowlistAndResponseGuard() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getCacheDir(), "m6_p103_" + UUID.randomUUID());
        File spoolDir = new File(targetCtx.getNoBackupFilesDir(), "m6_p103_spool_" + UUID.randomUUID());
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        byte[] rawKey = randomRawKey();

        KanataM6SyntheticPortablePlugin.resetMetricsAndJobs();
        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, rawKey, catalog, 15);
            KanataM6SyntheticPortablePlugin.registerSyntheticSource(
                    "src-p103", srcDb.getAbsolutePath(), rawKey, PW, spoolDir, workDir);

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                CountDownLatch jsDone = new CountDownLatch(1);
                AtomicReference<String> jsOut = new AtomicReference<>();

                scenario.onActivity(activity -> {
                    WebView webView = activity.getBridge().getWebView();
                    String script =
                            "(function() {" +
                            "  var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanataM6SyntheticPortable;" +
                            "  if (!p) return Promise.resolve(JSON.stringify({ error: 'PLUGIN_MISSING' }));" +
                            "  var s = {};" +
                            "  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };" +
                            "  function expectReject(fn) {" +
                            "    return fn().then(function() { return false; }, function() { return true; });" +
                            "  }" +
                            "  function rep(ch, n) { var out = ''; for (var i = 0; i < n; i++) out += ch; return out; }" +
                            "  return p.controlStartExport({ sourceId: 'src-p103', targetName: 'ok.kpb1', clientRequestId: 'p103-ok-1' }).then(function(sr) {" +
                            "    s.startNormalOk = !!(sr && sr.handle);" +
                            "    s.okHandle = sr.handle;" +
                            "    return p.controlPollStatus({ handle: s.okHandle });" +
                            "  }).then(function(pr) {" +
                            "    s.pollNormalOk = !!(pr && pr.handle === s.okHandle);" +
                            "    return p.controlStartExport({ sourceId: 'src-p103', targetName: 'cancel.kpb1', clientRequestId: 'p103-cancel-1', tableDelayMs: 10 });" +
                            "  }).then(function(s2) {" +
                            "    s.cancelHandle = s2.handle;" +
                            "    return p.controlCancelExport({ handle: s.cancelHandle });" +
                            "  }).then(function(cr) {" +
                            "    s.cancelNormalOk = !!(cr && cr.cancelAccepted);" +
                            "    return expectReject(function(){ return p.controlStartExport({ sourceId: rep('A', 4100) }); });" +
                            "  }).then(function(v) { s.startOver4096Rejected = v;" +
                            "    return expectReject(function(){ return p.controlStartExport({ sourceId: rep('\\u4e2d', 1500) }); });" + // 4500 UTF-8 bytes < 4096 chars
                            "  }).then(function(v) { s.startUtf8BytesOver4096Rejected = v;" +
                            "    return expectReject(function(){ return p.controlPollStatus({ handle: rep('B', 4100) }); });" +
                            "  }).then(function(v) { s.pollOver4096Rejected = v;" +
                            "    return expectReject(function(){ return p.controlCancelExport({ handle: rep('C', 4100) }); });" +
                            "  }).then(function(v) { s.cancelOver4096Rejected = v;" +
                            "    return expectReject(function(){ return p.controlStartExport({ sourceId: 'src-p103', extraField: 'bad' }); });" +
                            "  }).then(function(v) { s.startDisallowedFieldRejected = v;" +
                            "    return expectReject(function(){ return p.controlPollStatus({ handle: s.okHandle, extraField: 'bad' }); });" +
                            "  }).then(function(v) { s.pollDisallowedFieldRejected = v;" +
                            "    return expectReject(function(){ return p.controlCancelExport({ handle: s.okHandle, extraField: 'bad' }); });" +
                            "  }).then(function(v) { s.cancelDisallowedFieldRejected = v;" +
                            "    return expectReject(function(){ return p.controlStartExport({ sourceId: 'src-p103', bulkRows: '[]' }); });" +
                            "  }).then(function(v) { s.startBulkRowsRejected = v;" +
                            "    return expectReject(function(){ return p.controlPollStatus({ handle: s.okHandle, bulkRows: '[]' }); });" +
                            "  }).then(function(v) { s.pollBulkRowsRejected = v;" +
                            "    return expectReject(function(){ return p.controlCancelExport({ handle: s.okHandle, bulkRows: '[]' }); });" +
                            "  }).then(function(v) { s.cancelBulkRowsRejected = v;" +
                            "    return expectReject(function(){ return p.controlStartExport({ sourceId: 'src-p103', base64Db: 'AAA=' }); });" +
                            "  }).then(function(v) { s.startBase64DbRejected = v;" +
                            "    return expectReject(function(){ return p.controlPollStatus({ handle: s.okHandle, base64Db: 'AAA=' }); });" +
                            "  }).then(function(v) { s.pollBase64DbRejected = v;" +
                            "    return expectReject(function(){ return p.controlCancelExport({ handle: s.okHandle, base64Db: 'AAA=' }); });" +
                            "  }).then(function(v) { s.cancelBase64DbRejected = v;" +
                            "    return delay(800);" +
                            "  }).then(function() {" +
                            "    return JSON.stringify(s);" +
                            "  });" +
                            "})()";
                    webView.postDelayed(() -> webView.evaluateJavascript(
                            "(function(){ var r = " + script + "; r.then(function(v){ window.__p103Out = v; }).catch(function(e){ window.__p103Out = JSON.stringify({err:String(e)}); }); return 'PENDING'; })()",
                            ignored -> {}), 1200);
                });

                long deadline = SystemClock.elapsedRealtime() + 25_000L;
                while (SystemClock.elapsedRealtime() < deadline) {
                    CountDownLatch step = new CountDownLatch(1);
                    scenario.onActivity(act -> act.getBridge().getWebView().evaluateJavascript(
                            "window.__p103Out || null",
                            val -> {
                                if (val != null && !"null".equals(val)) {
                                    jsOut.set(val);
                                    jsDone.countDown();
                                }
                                step.countDown();
                            }));
                    step.await(2, TimeUnit.SECONDS);
                    if (jsDone.getCount() == 0) break;
                    Thread.sleep(150);
                }
                assertEquals("WebView P1-03 script did not finish", 0, jsDone.getCount());
                String unquoted = new org.json.JSONTokener(jsOut.get()).nextValue().toString();
                JSONObject res = new JSONObject(unquoted);
                assertFalse("WebView plugin blocked/errored: " + unquoted, res.has("error") || res.has("err"));

                assertTrue(res.getBoolean("startNormalOk"));
                assertTrue(res.getBoolean("pollNormalOk"));
                assertTrue(res.getBoolean("cancelNormalOk"));
                assertTrue(res.getBoolean("startOver4096Rejected"));
                assertTrue(res.getBoolean("startUtf8BytesOver4096Rejected"));
                assertTrue(res.getBoolean("pollOver4096Rejected"));
                assertTrue(res.getBoolean("cancelOver4096Rejected"));
                assertTrue(res.getBoolean("startDisallowedFieldRejected"));
                assertTrue(res.getBoolean("pollDisallowedFieldRejected"));
                assertTrue(res.getBoolean("cancelDisallowedFieldRejected"));
                assertTrue(res.getBoolean("startBulkRowsRejected"));
                assertTrue(res.getBoolean("pollBulkRowsRejected"));
                assertTrue(res.getBoolean("cancelBulkRowsRejected"));
                assertTrue(res.getBoolean("startBase64DbRejected"));
                assertTrue(res.getBoolean("pollBase64DbRejected"));
                assertTrue(res.getBoolean("cancelBase64DbRejected"));

                // Test > 512 B response block through actual WebView JS controlPollStatus call
                String okHandle = res.getString("okHandle");
                char[] bigErr = new char[600];
                Arrays.fill(bigErr, 'E');
                KanataM6SyntheticPortablePlugin.injectSyntheticJobErrorCodeForTest(okHandle, new String(bigErr));
                CountDownLatch respLatch = new CountDownLatch(1);
                AtomicReference<String> respOut = new AtomicReference<>();
                scenario.onActivity(act -> act.getBridge().getWebView().evaluateJavascript(
                        "(function(){ window.__p103Resp = null; window.Capacitor.Plugins.KanataM6SyntheticPortable.controlPollStatus({handle:'"
                                + okHandle + "'}).then(function(){ window.__p103Resp='UNEXPECTED_RESOLVE'; }, function(){ window.__p103Resp='REJECTED_OVERSIZE_RESPONSE'; }); })()",
                        ignored -> {}));
                long rDeadline = SystemClock.elapsedRealtime() + 5_000L;
                while (SystemClock.elapsedRealtime() < rDeadline && respLatch.getCount() > 0) {
                    CountDownLatch s = new CountDownLatch(1);
                    scenario.onActivity(act -> act.getBridge().getWebView().evaluateJavascript(
                            "window.__p103Resp || null",
                            v -> {
                                if (v != null && !"null".equals(v)) {
                                    respOut.set(v);
                                    respLatch.countDown();
                                }
                                s.countDown();
                            }));
                    s.await(1, TimeUnit.SECONDS);
                    if (respLatch.getCount() == 0) break;
                    Thread.sleep(100);
                }
                assertEquals("\"REJECTED_OVERSIZE_RESPONSE\"", respOut.get());
                assertEquals(1, KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_RESPONSE_CALLS.get());
                assertEquals(4, KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_BRIDGE_CALLS.get());
                assertEquals(9, KanataM6SyntheticPortablePlugin.REJECTED_DISALLOWED_FIELD_CALLS.get());
                assertTrue("MAX_OBSERVED_BRIDGE_BYTES must reflect ONLY accepted messages <= 512/4096 B, got "
                                + KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get(),
                        KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get()
                                <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_RESPONSE_BYTES);
                for (int sz : KanataM6SyntheticPortablePlugin.OBSERVED_REQUEST_BYTES) {
                    assertTrue(sz <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_CONTROL_BYTES);
                }
                for (int sz : KanataM6SyntheticPortablePlugin.OBSERVED_RESPONSE_BYTES) {
                    assertTrue(sz <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_RESPONSE_BYTES);
                }

                Log.i(TAG, "P1_03=" + new JSONObject()
                        .put("all10TableCasesPassed", true)
                        .put("maxAcceptedBridgeBytes", KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get())
                        .put("rejectedOversizeRequests", KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_BRIDGE_CALLS.get())
                        .put("rejectedDisallowedFieldRequests", KanataM6SyntheticPortablePlugin.REJECTED_DISALLOWED_FIELD_CALLS.get())
                        .put("rejectedOversizeResponses", KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_RESPONSE_CALLS.get()));
            }
        } finally {
            KanataM6SyntheticPortablePlugin.resetMetricsAndJobs();
            Arrays.fill(rawKey, (byte) 0);
            deleteRecursive(workDir);
            deleteRecursive(spoolDir);
        }
    }

    private static final class BufferTracker {
        final List<String> labels = Collections.synchronizedList(new ArrayList<>());
        final List<byte[]> buffers = Collections.synchronizedList(new ArrayList<>());

        void record(String label, byte[] buf) {
            if (buf != null && buf.length > 0) {
                labels.add(label);
                buffers.add(buf);
            }
        }

        void assertAllZeroized(String caseName) {
            assertFalse("No buffers recorded for " + caseName, buffers.isEmpty());
            for (int i = 0; i < buffers.size(); i++) {
                byte[] b = buffers.get(i);
                for (int j = 0; j < b.length; j++) {
                    if (b[j] != 0) {
                        fail("Non-zero byte remained after " + caseName + " in buffer[" + i + "] ("
                                + labels.get(i) + ") at offset " + j + " (len=" + b.length + ")");
                    }
                }
            }
        }
    }

    @Test
    public void p1_04_sensitiveBufferLifecycleAndZeroizationAcrossAll8FaultPoints() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_p104_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        byte[] srcKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 12);
            // Add a > 256 KiB chunked TEXT message row so chunk read zeroization is also covered
            char[] bigText = new char[300_000];
            Arrays.fill(bigText, 'Q');
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-p104-big', 'w1', 'c1', 'user', 'user', 'id-1', 'u', CAST(? AS TEXT), 1700009999999, 1, 'complete', 't-big', 'b-big', NULL, NULL, NULL, '{}')",
                        new Object[] { new String(bigText).getBytes(StandardCharsets.UTF_8) });
            }

            // 1. Normal completion + verify caller-supplied explicitMaterial is NOT zeroized by Exporter
            byte[] callerBek = KanataM6PortableCrypto.randomBytes(32);
            byte[] callerBekCopy = callerBek.clone();
            KanataM6SchemeCExporter.ExportMaterial callerMaterial = new KanataM6SchemeCExporter.ExportMaterial(
                    KanataM6PortableCrypto.randomBytes(16),
                    KanataM6PortableCrypto.randomBytes(16),
                    KanataM6PortableCrypto.randomBytes(12),
                    callerBek);
            assertFalse(callerMaterial.ownedByTask);
            BufferTracker normalTracker = new BufferTracker();
            File normalOut = new File(workDir, "normal.kpb1");
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, normalOut,
                    callerMaterial, null, new AtomicBoolean(false),
                    new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void onSensitiveBufferAllocated(String label, byte[] buffer) {
                            normalTracker.record(label, buffer);
                        }
                    });
            normalTracker.assertAllZeroized("normal-completion");
            assertArrayEquals("Caller-owned ExportMaterial must not be wiped by Exporter", callerBekCopy, callerBek);
            KanataM6PortableCrypto.zeroize(callerBek, callerBekCopy);

            // 2. Early pre-open path/mkdir failure (pwBytes MUST NOT even allocate before path validation, and if invalid target dir, zero buffers leak!)
            File badTargetAsDir = new File(workDir, "existing_dir");
            assertTrue(badTargetAsDir.mkdirs());
            BufferTracker earlyTracker = new BufferTracker();
            assertThrows(KanataM6PortableCrypto.PortableException.class, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, badTargetAsDir,
                            null, null, new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void onSensitiveBufferAllocated(String label, byte[] buffer) {
                                    earlyTracker.record(label, buffer);
                                }
                            }));
            earlyTracker.assertAllZeroized("early-target-collision");

            // 3. All 8 required fault injection points
            String[] injectionPoints = new String[] {
                    "afterDbRead",
                    "afterRowEncoded",
                    "afterOrderTrackerValidated",
                    "beforeChunkerAppend",
                    "beforeSpoolWrite",
                    "beforeFsync",
                    "beforeReadback",
                    "performAtomicReplace"
            };
            Set<String> observedCategories = new LinkedHashSet<>();
            for (String point : injectionPoints) {
                BufferTracker tracker = new BufferTracker();
                File out = new File(workDir, "fault_" + point + ".kpb1");
                KanataM6PortableCrypto.PortableException thrown = assertThrows(
                        KanataM6PortableCrypto.PortableException.class,
                        () -> KanataM6SchemeCExporter.exportToSpool(
                                srcDb.getPath(), srcKey, PW, catalog,
                                new KanataM6SnapshotOwner.WriteGate(), spoolDir, out,
                                null, null, new AtomicBoolean(false),
                                new KanataM6SchemeCExporter.SpoolHooks() {
                                    @Override
                                    public void onSensitiveBufferAllocated(String label, byte[] buffer) {
                                        tracker.record(label, buffer);
                                        observedCategories.add(label.split("\\.")[0]);
                                    }
                                    @Override
                                    public void afterDbRead(int tableId, long rowIndex) throws IOException {
                                        if ("afterDbRead".equals(point) && tableId == 34 && rowIndex == 2) {
                                            throw new IOException("inject-afterDbRead");
                                        }
                                    }
                                    @Override
                                    public void afterRowEncoded(int tableId, KanataM6BoundedRowReader.EncodedRow row) throws IOException {
                                        if ("afterRowEncoded".equals(point) && tableId == 34) {
                                            throw new IOException("inject-afterRowEncoded");
                                        }
                                    }
                                    @Override
                                    public void afterOrderTrackerValidated(int tableId, long rowIndex) throws IOException {
                                        if ("afterOrderTrackerValidated".equals(point) && tableId == 34) {
                                            throw new IOException("inject-afterOrderTrackerValidated");
                                        }
                                    }
                                    @Override
                                    public void beforeChunkerAppend(int tableId, int bytesLen) throws IOException {
                                        if ("beforeChunkerAppend".equals(point) && tableId == 34) {
                                            throw new IOException("inject-beforeChunkerAppend");
                                        }
                                    }
                                    @Override
                                    public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                        if ("beforeSpoolWrite".equals(point) && totalWrittenSoFar > 4096L) {
                                            throw new IOException("inject-beforeSpoolWrite");
                                        }
                                    }
                                    @Override
                                    public void beforeFsync() throws IOException {
                                        if ("beforeFsync".equals(point)) throw new IOException("inject-beforeFsync");
                                    }
                                    @Override
                                    public void beforeReadback() throws IOException {
                                        if ("beforeReadback".equals(point)) throw new IOException("inject-beforeReadback");
                                    }
                                    @Override
                                    public void performAtomicReplace(File stagedFile, File finalTargetFile) throws IOException {
                                        if ("performAtomicReplace".equals(point)) throw new IOException("inject-performAtomicReplace");
                                        KanataM6SchemeCExporter.defaultAtomicRenameOnly(stagedFile, finalTargetFile);
                                    }
                                }));
                assertFalse("Exception leaked password!", String.valueOf(thrown.getMessage()).contains(PW));
                tracker.assertAllZeroized(point);
                assertFalse("Failed target must not exist for " + point, out.exists());
            }

            assertTrue("Expected tracked buffer categories (pwBytes/mat/outPlain/row/order)",
                    observedCategories.contains("pwBytes")
                            && observedCategories.contains("mat")
                            && observedCategories.contains("outPlain")
                            && observedCategories.contains("row")
                            && observedCategories.contains("order"));

            Log.i(TAG, "P1_04=" + new JSONObject()
                    .put("faultPointsVerified", new JSONArray(Arrays.asList(injectionPoints)))
                    .put("observedBufferCategories", new JSONArray(observedCategories))
                    .put("allTrackedBuffersZeroized", true));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void p1_05_durabilityDirFsyncFailureCommitWindowKillAndFsProbe() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_p105_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File killWorkDir = new File(workDir, "kill");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(killWorkDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File targetBackup = new File(workDir, "durability_target.kpb1");
        byte[] srcKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 30);
            // Export baseline A
            KanataM6SchemeCExporter.ExportMetrics emA = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                    null, null, new AtomicBoolean(false), null, "p105-base-a");
            assertEquals("COMMITTED", emA.commitState);
            String shaA = sha256File(targetBackup);

            // Mutate source for distinct backup B
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-p105-b', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'DURABILITY_B', 1700009999999, 1, 'complete', 'tb', 'bb', NULL, NULL, NULL, '{}')");
            }
            String expectedBProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedBProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }

            // 1. Spool fsync failure -> fails cleanly with ERR_IO_FAILED, preserves A
            assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override public void beforeFsync() throws IOException { throw new IOException("EIO: spool fsync"); }
                            }, "p105-spool-fsync-fail"));
            assertEquals(shaA, sha256File(targetBackup));

            // 2. Rename failure -> fails cleanly with ERR_IO_FAILED, preserves A
            assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override public void performAtomicReplace(File s, File t) throws IOException {
                                    throw new IOException("EIO: rename failed");
                                }
                            }, "p105-rename-fail"));
            assertEquals(shaA, sha256File(targetBackup));

            // 3. Rename SUCCEEDED, target parent dir fsync FAILED -> MUST NOT silently ignore AND MUST NOT delete renamed target B!
            String dirFailTaskId = "p105-dir-fsync-fail";
            KanataM6PortableCrypto.PortableException durEx = assertThrows(
                    KanataM6PortableCrypto.PortableException.class,
                    () -> KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void performTargetDirFsync(File targetParentDir) throws IOException {
                                    throw new IOException("EIO: injected post-rename dir fsync failure");
                                }
                            }, dirFailTaskId));
            assertEquals(KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, durEx.code);
            assertTrue("Already-renamed backup B must NOT be deleted when dir fsync fails!", targetBackup.exists());
            String shaB = sha256File(targetBackup);
            assertNotEquals("Target file on disk should reflect atomic rename to B", shaA, shaB);
            verifyBackupDecrypts(targetBackup, PW, catalog, workDir, expectedBProjected);

            // Recovery journal RENAMED_PENDING_DIR_SYNC must remain and confirm durability on startup recovery
            File pendingDirFail = new File(spoolDir, ".task-" + dirFailTaskId + ".pending");
            assertTrue("RENAMED_PENDING_DIR_SYNC journal must be preserved for recovery", pendingDirFail.exists());
            KanataM6SchemeCExporter.RecoveryReport dirRec = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(1, dirRec.confirmedCommitTasks);
            assertTrue(dirRec.confirmedCommitTaskIds.contains(dirFailTaskId));
            assertFalse(pendingDirFail.exists());
            assertEquals("Confirmed target B SHA-256 must stay unchanged", shaB, sha256File(targetBackup));

            // 4. Importer post-rename dir fsync failure -> ERR_DURABILITY_UNCONFIRMED, committed target DB NOT deleted!
            File impTarget = new File(workDir, "imp_dir_fail.db");
            byte[] impKey = randomRawKey();
            try {
                byte[] pkgBBytes = readAllBytes(targetBackup);
                KanataM6PortableCrypto.PortableException impDurEx = assertThrows(
                        KanataM6PortableCrypto.PortableException.class,
                        () -> KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                                new ByteArrayInputStream(pkgBBytes), PW, catalog, workDir,
                                impTarget, impKey, new AtomicBoolean(false), false,
                                new KanataM6SchemeCImporter.ImportHooks() {
                                    @Override
                                    public void performTargetDirFsync(File targetParentDir) throws Exception {
                                        throw new IOException("EIO: importer post-rename dir fsync failed");
                                    }
                                }));
                assertEquals(KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, impDurEx.code);
                assertTrue("Committed DB must NOT be deleted on dir fsync failure", impTarget.exists());
                try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(impTarget.getPath(), impKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    assertEquals("ok", scalar(ro, "PRAGMA integrity_check"));
                }
            } finally {
                Arrays.fill(impKey, (byte) 0);
                SQLiteDatabase.deleteDatabase(impTarget);
            }

            // 5. Real :m6worker OS SIGKILL inside AFTER_RENAME_BEFORE_DIR_SYNC commit window
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-p105-c', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'DURABILITY_C_KILL', 1700009999999, 1, 'complete', 'tc', 'bc', NULL, NULL, NULL, '{}')");
            }
            String expectedCProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedCProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }
            String killCommitId = "p105-kill-after-rename";
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
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, killCommitId)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, KanataM6KillableWorkerService.STAGE_AFTER_RENAME_BEFORE_DIR_SYNC));

            long kDeadline = SystemClock.elapsedRealtime() + 20_000L;
            while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < kDeadline) {
                Thread.sleep(50);
            }
            assertFalse(errFile.exists() ? readSmallText(errFile) : "", errFile.exists());
            assertTrue(readyFile.exists());
            int workerPid = new JSONObject(readSmallText(readyFile)).getInt("pid");
            Process.killProcess(workerPid);
            waitProcessDead(targetCtx, workerPid);

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_CHECK_RECOVERY)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_DIR, workDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, killCommitId));
            long rDeadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < rDeadline) {
                Thread.sleep(50);
            }
            assertTrue(recoveredFile.exists());
            JSONObject recJson = new JSONObject(readSmallText(recoveredFile));
            assertEquals(1, recJson.getInt("confirmedCommitTasks"));
            assertTrue(targetBackup.exists());
            verifyBackupDecrypts(targetBackup, PW, catalog, workDir, expectedCProjected);

            // 6. Probe real Android directory fsync support across storage roots
            JSONObject fsProbe = new JSONObject();
            File[] roots = new File[] {
                    targetCtx.getFilesDir(),
                    targetCtx.getCacheDir(),
                    targetCtx.getNoBackupFilesDir(),
                    targetCtx.getExternalFilesDir(null)
            };
            String[] names = new String[] { "filesDir", "cacheDir", "noBackupFilesDir", "externalFilesDir" };
            for (int i = 0; i < roots.length; i++) {
                File d = roots[i];
                if (d == null) continue;
                JSONObject item = new JSONObject();
                try {
                    StructStatVfs vfs = Os.statvfs(d.getAbsolutePath());
                    item.put("fsid", vfs.f_fsid).put("bsize", vfs.f_bsize);
                } catch (Throwable t) {
                    item.put("statvfsErr", t.getMessage());
                }
                try {
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(d);
                    item.put("dirFsyncSupported", true);
                } catch (IOException ioe) {
                    item.put("dirFsyncSupported", false).put("error", ioe.getMessage());
                }
                fsProbe.put(names[i], item);
            }
            // Internal storage roots MUST support strict directory fsync
            assertTrue(fsProbe.getJSONObject("filesDir").getBoolean("dirFsyncSupported"));
            assertTrue(fsProbe.getJSONObject("noBackupFilesDir").getBoolean("dirFsyncSupported"));

            Log.i(TAG, "P1_05=" + new JSONObject()
                    .put("dirFsyncFailureClassifiedAsDurabilityUnconfirmed", true)
                    .put("renamedBackupPreservedAndRecovered", true)
                    .put("importerDirFsyncFailurePreservedTargetDb", true)
                    .put("afterRenameKillRecoveryConfirmed", true)
                    .put("dirFsyncProbe", fsProbe));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void p2_01_journalPathValidationAndUntrustedRejection() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File workDir = new File(targetCtx.getFilesDir(), "m6_p201_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File otherDir = new File(workDir, "other");
        assertTrue(spoolDir.mkdirs());
        assertTrue(otherDir.mkdirs());

        try {
            // Victim files that MUST NEVER be deleted by forged/corrupt journals
            File victimOutside = new File(otherDir, "victim-outside.spool.tmp");
            File victimParent = new File(workDir, "victim-parent.spool.tmp");
            File victimOtherTask = new File(spoolDir, ".backup.other-legit-task.spool.tmp");
            File victimPlain = new File(spoolDir, "unrelated-data.txt");
            try (FileOutputStream f1 = new FileOutputStream(victimOutside);
                 FileOutputStream f2 = new FileOutputStream(victimParent);
                 FileOutputStream f3 = new FileOutputStream(victimOtherTask);
                 FileOutputStream f4 = new FileOutputStream(victimPlain)) {
                f1.write("KEEP-OUTSIDE".getBytes(StandardCharsets.UTF_8));
                f2.write("KEEP-PARENT".getBytes(StandardCharsets.UTF_8));
                f3.write("KEEP-OTHER-TASK".getBytes(StandardCharsets.UTF_8));
                f4.write("KEEP-PLAIN".getBytes(StandardCharsets.UTF_8));
            }
            String shaOutside = sha256File(victimOutside);
            String shaParent = sha256File(victimParent);
            String shaOther = sha256File(victimOtherTask);
            String shaPlain = sha256File(victimPlain);

            // 1. Directory traversal tmpSpoolPath (`..`)
            writeRaw(new File(spoolDir, ".task-forged-trav.pending"), new JSONObject()
                    .put("taskId", "forged-trav")
                    .put("state", "STARTED")
                    .put("tmpSpoolPath", spoolDir.getAbsolutePath() + "/../victim-parent.spool.tmp")
                    .toString());

            // 2. Cross-directory absolute path outside spoolDir
            writeRaw(new File(spoolDir, ".task-forged-crossdir.pending"), new JSONObject()
                    .put("taskId", "forged-crossdir")
                    .put("state", "STARTED")
                    .put("tmpSpoolPath", victimOutside.getAbsolutePath())
                    .toString());

            // 3. Same-directory file owned by a DIFFERENT taskId
            writeRaw(new File(spoolDir, ".task-forged-wrongtid.pending"), new JSONObject()
                    .put("taskId", "forged-wrongtid")
                    .put("state", "STARTED")
                    .put("tmpSpoolPath", victimOtherTask.getAbsolutePath())
                    .toString());

            // 4. JSON taskId mismatches journal filename
            writeRaw(new File(spoolDir, ".task-forged-mismatch.pending"), new JSONObject()
                    .put("taskId", "other-legit-task")
                    .put("state", "STARTED")
                    .put("tmpSpoolPath", victimOtherTask.getAbsolutePath())
                    .toString());

            // 5. Corrupted non-JSON journal
            writeRaw(new File(spoolDir, ".task-corrupt-json.pending"), "{broken-json-truncated");

            // 6. Unknown unrecognized state
            writeRaw(new File(spoolDir, ".task-unknown-state.pending"), new JSONObject()
                    .put("taskId", "unknown-state")
                    .put("state", "DELETE_EVERYTHING")
                    .put("tmpSpoolPath", new File(spoolDir, ".x.unknown-state.spool.tmp").getAbsolutePath())
                    .toString());

            KanataM6SchemeCExporter.RecoveryReport rep = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
            assertEquals(6, rep.scannedJournals);
            assertEquals(0, rep.cleanedTasks);
            assertEquals(0, rep.confirmedCommitTasks);
            assertEquals(6, rep.rejectedUntrustedJournals);

            // All victim files MUST remain intact!
            assertTrue(victimOutside.exists());
            assertTrue(victimParent.exists());
            assertTrue(victimOtherTask.exists());
            assertTrue(victimPlain.exists());
            assertEquals(shaOutside, sha256File(victimOutside));
            assertEquals(shaParent, sha256File(victimParent));
            assertEquals(shaOther, sha256File(victimOtherTask));
            assertEquals(shaPlain, sha256File(victimPlain));

            Log.i(TAG, "P2_01=" + new JSONObject()
                    .put("scannedJournals", rep.scannedJournals)
                    .put("cleanedTasks", rep.cleanedTasks)
                    .put("rejectedUntrustedJournals", rep.rejectedUntrustedJournals)
                    .put("allVictimsPreserved", true));
        } finally {
            deleteRecursive(workDir);
        }
    }

    private static void writeRaw(File f, String content) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
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

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static void assertThrowsCode(String expectedCode, ThrowingRunnable action) throws Exception {
        try {
            action.run();
            fail("Expected PortableException(" + expectedCode + ") but succeeded");
        } catch (KanataM6PortableCrypto.PortableException pe) {
            assertEquals("Expected " + expectedCode + " but got " + pe.code + " (" + pe.stage + ")",
                    expectedCode, pe.code);
        }
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
}
