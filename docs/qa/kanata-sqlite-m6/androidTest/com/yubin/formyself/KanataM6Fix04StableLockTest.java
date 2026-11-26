package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
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
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
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
import java.util.concurrent.atomic.AtomicLong;

/**
 * M6-02-FIX-04 dedicated cross-process stable lock lifecycle verification suite:
 * - Exporter (.task-<tid>.lock) and Importer (.kanata-import-<hash>.lock) are stable lock files
 *   that are never unlinked on normal close() or recovery.
 * - Cross-process :m6worker competition while Process A pauses in close() before FileLock.release():
 *   B waits until A releases and acquires the exact same (st_dev, st_ino).
 * - OS SIGKILL of Process A while holding lock -> kernel auto-releases FileLock -> Process B
 *   re-acquires the exact same (st_dev, st_ino).
 * - Deterministic regression test proving the cross-process harness catches the old
 *   unlink-before-release split-brain defect (inoB != inoA) vs fixed mutual exclusion (blocked -> same ino).
 */
@RunWith(AndroidJUnit4.class)
public class KanataM6Fix04StableLockTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM6Fix04";
    private static final String PW = "fix04-stable-lock-pw-\ufeff🔒";

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
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

    private static void waitForFile(File f, File errFile, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (!f.exists() && SystemClock.elapsedRealtime() < deadline) {
            if (errFile != null && errFile.exists()) {
                fail("Worker failed unexpectedly: " + readSmallText(errFile));
            }
            Thread.sleep(25);
        }
        if (errFile != null && errFile.exists()) {
            fail("Worker failed unexpectedly: " + readSmallText(errFile));
        }
        assertTrue("Timed out waiting for file: " + f.getName(), f.exists());
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
            Thread.sleep(40);
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
    public void fix04_01_exporterCrossProcessCloseWindowInodeConsistencyAndStability() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_fix04_01_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File workerWork = new File(workDir, "worker");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(workerWork.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File target1 = new File(workDir, "exp1.kpb1");
        File target2 = new File(workDir, "exp2.kpb1");
        byte[] srcKey = randomRawKey();
        ExecutorService exec = Executors.newSingleThreadExecutor();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 20);
            String tid = "fix04-exp-stable";
            File lockFile = new File(spoolDir, ".task-" + tid + ".lock");

            CountDownLatch inCloseBeforeRelease = new CountDownLatch(1);
            CountDownLatch allowARelease = new CountDownLatch(1);
            AtomicLong devA = new AtomicLong(-1L);
            AtomicLong inoA = new AtomicLong(-1L);

            Future<KanataM6SchemeCExporter.ExportMetrics> fA = exec.submit(() ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getPath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, target1,
                            null, null, new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeTaskLockRelease(String taskId, File lf, long dev, long ino) {
                                    devA.set(dev);
                                    inoA.set(ino);
                                    inCloseBeforeRelease.countDown();
                                    try {
                                        assertTrue(allowARelease.await(20, TimeUnit.SECONDS));
                                    } catch (InterruptedException ie) {
                                        throw new RuntimeException(ie);
                                    }
                                }
                            }, tid));

            assertTrue("Process A did not pause inside TaskLockHandle.close()",
                    inCloseBeforeRelease.await(15, TimeUnit.SECONDS));
            assertTrue("hasActiveTaskLock must be true while A pauses in close()",
                    KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tid));
            assertTrue("Stable lock file must exist while A pauses in close()", lockFile.exists());
            StructStat stWhilePaused = Os.lstat(lockFile.getPath());
            assertEquals(devA.get(), stWhilePaused.st_dev);
            assertEquals(inoA.get(), stWhilePaused.st_ino);

            // Launch independent :m6worker Process B competing for the exact same taskId lock
            File blockedFile = new File(workerWork, "worker_probe_blocked.json");
            File acquiredFile = new File(workerWork, "worker_acquired.json");
            File errFile = new File(workerWork, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_EXPORTER_LOCK)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, workerWork.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, tid)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "wait_and_acquire"));

            // B MUST be blocked while A is paused before FileLock.release()
            waitForFile(blockedFile, errFile, 15_000L);
            JSONObject blk = new JSONObject(readSmallText(blockedFile));
            assertNotEquals(Process.myPid(), blk.getInt("pid"));
            assertTrue(blk.getBoolean("blocked"));
            assertTrue(blk.getBoolean("lockExists"));
            assertEquals(devA.get(), blk.getLong("diskDev"));
            assertEquals(inoA.get(), blk.getLong("diskIno"));
            Thread.sleep(250);
            assertFalse("Process B MUST NOT acquire lock before Process A executes FileLock.release()!",
                    acquiredFile.exists());

            // Allow A to finish FileLock.release() -> B acquires same inode!
            long releasedAtNanos = SystemClock.elapsedRealtimeNanos();
            allowARelease.countDown();
            KanataM6SchemeCExporter.ExportMetrics emA = fA.get(15, TimeUnit.SECONDS);
            assertEquals("COMMITTED", emA.commitState);

            waitForFile(acquiredFile, errFile, 15_000L);
            JSONObject acq = new JSONObject(readSmallText(acquiredFile));
            assertTrue(acq.getBoolean("acquired"));
            assertTrue(acq.getInt("blockedCount") >= 1);
            assertEquals("Cross-process lock must share identical st_dev", devA.get(), acq.getLong("lockDev"));
            assertEquals("Cross-process lock must share identical st_ino", inoA.get(), acq.getLong("lockIno"));
            assertTrue("Process B must acquire strictly AFTER Process A released",
                    acq.getLong("acquiredAtNanos") >= releasedAtNanos);

            // Stable lock file stays on disk, dormant, and survives recovery + taskId reuse with same inode!
            assertFalse("hasActiveTaskLock must be false when dormant",
                    KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tid));
            assertTrue("Stable lock file must NOT be unlinked on normal close", lockFile.exists());
            StructStat stAfterRelease = Os.lstat(lockFile.getPath());
            assertEquals(devA.get(), stAfterRelease.st_dev);
            assertEquals(inoA.get(), stAfterRelease.st_ino);

            KanataM6SchemeCExporter.RecoveryReport rec = KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, workDir);
            assertEquals(0, rec.scannedJournals);
            assertTrue("Recovery must NOT unlink stable lock file", lockFile.exists());
            assertEquals(inoA.get(), Os.lstat(lockFile.getPath()).st_ino);

            // Reusing same taskId re-uses same stable inode
            AtomicLong inoReuse = new AtomicLong(-1L);
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, target2,
                    null, null, new AtomicBoolean(false),
                    new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void beforeTaskLockRelease(String taskId, File lf, long dev, long ino) {
                            inoReuse.set(ino);
                        }
                    }, tid);
            assertEquals(inoA.get(), inoReuse.get());
            assertTrue(lockFile.exists());
            assertFalse(KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, tid));

            Log.i(TAG, "FIX04_01=" + new JSONObject()
                    .put("exporterCloseWindowBlockedB", true)
                    .put("sameInodeAcrossProcesses", true)
                    .put("stableLockSurvivedRecoveryAndReuse", true)
                    .put("dev", devA.get())
                    .put("ino", inoA.get())
                    .put("workerPidB", acq.getInt("pid")));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void fix04_02_importerCrossProcessCloseWindowInodeConsistencyAndStability() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_fix04_02_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File workerWork = new File(workDir, "worker");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(workerWork.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File pkgFile = new File(workDir, "pkg.kpb1");
        File targetDb = new File(workDir, "imp_target.db");
        byte[] srcKey = randomRawKey();
        byte[] impKey = randomRawKey();
        ExecutorService exec = Executors.newSingleThreadExecutor();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 16);
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, pkgFile,
                    null, null, new AtomicBoolean(false), null, "fix04-imp-src");
            byte[] pkgBytes = readAllBytes(pkgFile);

            CountDownLatch inCloseBeforeRelease = new CountDownLatch(1);
            CountDownLatch allowARelease = new CountDownLatch(1);
            AtomicLong devA = new AtomicLong(-1L);
            AtomicLong inoA = new AtomicLong(-1L);
            AtomicBoolean sawLockExistsInClose = new AtomicBoolean(false);
            File lockFile = KanataM6SchemeCImporter.lockFileForTarget(targetDb.getCanonicalFile());

            Future<KanataM6SchemeCImporter.ImportResult> fA = exec.submit(() ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(pkgBytes), PW, catalog, workDir,
                            targetDb, impKey, new AtomicBoolean(false), false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void beforeTargetLockRelease(File lf, long dev, long ino) {
                                    devA.set(dev);
                                    inoA.set(ino);
                                    sawLockExistsInClose.set(lf.exists());
                                    inCloseBeforeRelease.countDown();
                                    try {
                                        assertTrue(allowARelease.await(20, TimeUnit.SECONDS));
                                    } catch (InterruptedException ie) {
                                        throw new RuntimeException(ie);
                                    }
                                }
                            }, "fix04-imp-a"));

            assertTrue("Process A did not pause inside TargetCommitLockHandle.close()",
                    inCloseBeforeRelease.await(20, TimeUnit.SECONDS));
            assertTrue(sawLockExistsInClose.get());
            assertTrue("hasActiveCommitLock must be true while A pauses in close()",
                    KanataM6SchemeCImporter.hasActiveCommitLock(targetDb));

            // Launch independent :m6worker Process B blocking on acquireTargetCommitLock
            File attemptingFile = new File(workerWork, "worker_attempting.json");
            File acquiredFile = new File(workerWork, "worker_acquired.json");
            File errFile = new File(workerWork, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_IMPORTER_LOCK)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, workerWork.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, targetDb.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "fix04-imp-b")
                    .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "blocking_wait"));

            waitForFile(attemptingFile, errFile, 15_000L);
            Thread.sleep(350);
            assertFalse("Process B MUST stay blocked until Process A calls FileLock.release()!",
                    acquiredFile.exists());
            assertTrue(KanataM6SchemeCImporter.hasActiveCommitLock(targetDb));

            long releasedAtNanos = SystemClock.elapsedRealtimeNanos();
            allowARelease.countDown();
            KanataM6SchemeCImporter.ImportResult resA = fA.get(15, TimeUnit.SECONDS);
            assertEquals(50, resA.footerVerifiers.size());

            waitForFile(acquiredFile, errFile, 15_000L);
            JSONObject acq = new JSONObject(readSmallText(acquiredFile));
            assertNotEquals(Process.myPid(), acq.getInt("pid"));
            assertTrue(acq.getBoolean("acquired"));
            assertEquals("Importer cross-process lock must share identical st_dev", devA.get(), acq.getLong("lockDev"));
            assertEquals("Importer cross-process lock must share identical st_ino", inoA.get(), acq.getLong("lockIno"));
            assertTrue("Process B must acquire strictly AFTER Process A released",
                    acq.getLong("acquiredAtNanos") >= releasedAtNanos);

            assertFalse("hasActiveCommitLock must be false when dormant",
                    KanataM6SchemeCImporter.hasActiveCommitLock(targetDb));
            assertTrue("Stable commit lock file must remain on disk", lockFile.exists());
            assertEquals(inoA.get(), Os.lstat(lockFile.getPath()).st_ino);

            // Recovery & subsequent import overwrite reuse exact same inode without destroying lock file
            assertEquals(0, KanataM6SchemeCImporter.recoverIncompleteImports(workDir).scannedJournals);
            assertEquals(inoA.get(), Os.lstat(lockFile.getPath()).st_ino);

            AtomicLong inoOverwrite = new AtomicLong(-1L);
            KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                    new ByteArrayInputStream(pkgBytes), PW, catalog, workDir,
                    targetDb, impKey, new AtomicBoolean(false), true,
                    new KanataM6SchemeCImporter.ImportHooks() {
                        @Override
                        public void beforeTargetLockRelease(File lf, long dev, long ino) {
                            inoOverwrite.set(ino);
                        }
                    }, "fix04-imp-c");
            assertEquals(inoA.get(), inoOverwrite.get());
            assertFalse(KanataM6SchemeCImporter.hasActiveCommitLock(targetDb));
            assertTrue(lockFile.exists());

            Log.i(TAG, "FIX04_02=" + new JSONObject()
                    .put("importerCloseWindowBlockedB", true)
                    .put("sameInodeAcrossProcesses", true)
                    .put("stableLockSurvivedRecoveryAndReuse", true)
                    .put("dev", devA.get())
                    .put("ino", inoA.get())
                    .put("workerPidB", acq.getInt("pid")));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(impKey, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            SQLiteDatabase.deleteDatabase(targetDb);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void fix04_03_sigkillLockReacquireSameInodeExporterAndImporter() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_fix04_03_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File killExpDir = new File(workDir, "kill_exp");
        File killImpDir = new File(workDir, "kill_imp");
        File probeExpDir = new File(workDir, "probe_exp");
        File probeImpDir = new File(workDir, "probe_imp");
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        assertTrue(killExpDir.mkdirs());
        assertTrue(killImpDir.mkdirs());
        assertTrue(probeExpDir.mkdirs());
        assertTrue(probeImpDir.mkdirs());

        File srcDb = new File(workDir, "src.db");
        File expTarget = new File(workDir, "sigkill_exp.kpb1");
        File impTarget = new File(workDir, "sigkill_imp.db");
        byte[] srcKey = randomRawKey();
        byte[] impKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 18);

            // --- Part A: Exporter Process A killed via SIGKILL while holding TaskLockHandle in close() ---
            String expTid = "fix04-sigkill-exp";
            File readyExp = new File(killExpDir, "worker_ready.json");
            File errExp = new File(killExpDir, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_EXPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killExpDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_DB_PATH, srcDb.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(srcKey))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, expTarget.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, expTid)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE,
                            KanataM6KillableWorkerService.STAGE_BEFORE_TASK_LOCK_RELEASE));

            waitForFile(readyExp, errExp, 20_000L);
            JSONObject expReadyJson = new JSONObject(readSmallText(readyExp));
            int expPidA = expReadyJson.getInt("pid");
            long expDevA = expReadyJson.getLong("lockDev");
            long expInoA = expReadyJson.getLong("lockIno");
            assertTrue(KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, expTid));

            Process.killProcess(expPidA);
            waitProcessDead(targetCtx, expPidA);

            // Kernel auto-released FileLock; stable lock file still exists with same inode!
            File expLockFile = new File(spoolDir, ".task-" + expTid + ".lock");
            assertTrue(expLockFile.exists());
            assertFalse("hasActiveTaskLock must be false immediately after holder SIGKILL",
                    KanataM6SchemeCExporter.hasActiveTaskLock(spoolDir, expTid));

            // Fresh :m6worker Process B acquires Exporter lock on exact same (st_dev, st_ino)
            File acqExp = new File(probeExpDir, "worker_acquired.json");
            File probeErrExp = new File(probeExpDir, "worker_error.txt");
            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_EXPORTER_LOCK)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, probeExpDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, expTid)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
            waitForFile(acqExp, probeErrExp, 10_000L);
            JSONObject acqExpJson = new JSONObject(readSmallText(acqExp));
            assertTrue(acqExpJson.getBoolean("acquired"));
            assertEquals(expDevA, acqExpJson.getLong("lockDev"));
            assertEquals(expInoA, acqExpJson.getLong("lockIno"));

            // --- Part B: Importer Process A killed via SIGKILL while holding TargetCommitLockHandle in close() ---
            String impTid = "fix04-sigkill-imp";
            File readyImp = new File(killImpDir, "worker_ready.json");
            File errImp = new File(killImpDir, "worker_error.txt");

            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_IMPORT_PAUSE)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killImpDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PACKAGE_PATH, expTarget.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, KanataM6PortableCrypto.bytesToHex(impKey))
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, PW)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, impTarget.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, impTid)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE,
                            KanataM6KillableWorkerService.STAGE_BEFORE_TARGET_LOCK_RELEASE));

            waitForFile(readyImp, errImp, 20_000L);
            JSONObject impReadyJson = new JSONObject(readSmallText(readyImp));
            int impPidA = impReadyJson.getInt("pid");
            long impDevA = impReadyJson.getLong("lockDev");
            long impInoA = impReadyJson.getLong("lockIno");
            assertTrue(KanataM6SchemeCImporter.hasActiveCommitLock(impTarget));

            Process.killProcess(impPidA);
            waitProcessDead(targetCtx, impPidA);

            File impLockFile = KanataM6SchemeCImporter.lockFileForTarget(impTarget.getCanonicalFile());
            assertTrue(impLockFile.exists());
            assertFalse("hasActiveCommitLock must be false immediately after holder SIGKILL",
                    KanataM6SchemeCImporter.hasActiveCommitLock(impTarget));

            File acqImp = new File(probeImpDir, "worker_acquired.json");
            File probeErrImp = new File(probeImpDir, "worker_error.txt");
            targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_IMPORTER_LOCK)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, probeImpDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, impTarget.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, impTid)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
            waitForFile(acqImp, probeErrImp, 10_000L);
            JSONObject acqImpJson = new JSONObject(readSmallText(acqImp));
            assertTrue(acqImpJson.getBoolean("acquired"));
            assertEquals(impDevA, acqImpJson.getLong("lockDev"));
            assertEquals(impInoA, acqImpJson.getLong("lockIno"));

            Log.i(TAG, "FIX04_03=" + new JSONObject()
                    .put("exporterSigkillReacquiredSameInode", true)
                    .put("importerSigkillReacquiredSameInode", true)
                    .put("expIno", expInoA)
                    .put("impIno", impInoA));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(impKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void fix04_04_deterministicRegressionForOldUnlinkBeforeReleaseDefect() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();

        File workDir = new File(targetCtx.getFilesDir(), "m6_fix04_04_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File ctrlExpDir = new File(workDir, "ctrl_exp");
        File fixedExpDir = new File(workDir, "fixed_exp");
        File ctrlImpDir = new File(workDir, "ctrl_imp");
        File fixedImpDir = new File(workDir, "fixed_imp");
        assertTrue(spoolDir.mkdirs());
        assertTrue(ctrlExpDir.mkdirs());
        assertTrue(fixedExpDir.mkdirs());
        assertTrue(ctrlImpDir.mkdirs());
        assertTrue(fixedImpDir.mkdirs());

        try {
            // --- Part A: Exporter control (reproduces old FIX-03 close() bug: delete BEFORE release) ---
            String ctrlExpTid = "fix04-old-bug-exp";
            File ctrlExpLock = KanataM6SchemeCExporter.taskLockFileFor(spoolDir.getCanonicalFile(), ctrlExpTid);
            long ctrlExpInoA;
            try (RandomAccessFile rafA = new RandomAccessFile(ctrlExpLock, "rw");
                 FileLock flA = rafA.getChannel().tryLock()) {
                assertNotNull(flA);
                ctrlExpInoA = Os.fstat(rafA.getFD()).st_ino;
                // Reproduce exact FIX-03 bug: unlink while FileLock on inode A is STILL held!
                assertTrue(ctrlExpLock.delete());

                File acqFile = new File(ctrlExpDir, "worker_acquired.json");
                File errFile = new File(ctrlExpDir, "worker_error.txt");
                targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_EXPORTER_LOCK)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, ctrlExpDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, ctrlExpTid)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
                waitForFile(acqFile, errFile, 10_000L);
                JSONObject splitBrain = new JSONObject(readSmallText(acqFile));
                // Harness MUST detect dual-lock split-brain across distinct inodes while flA is still held!
                assertTrue("Harness must catch split-brain under old unlink-before-release", splitBrain.getBoolean("acquired"));
                assertNotEquals("New process got split inode B while old process held inode A!",
                        ctrlExpInoA, splitBrain.getLong("lockIno"));
            }

            // --- Part B: Fixed Exporter TaskLockHandle.close() prevents split-brain completely ---
            String fixedExpTid = "fix04-fixed-exp";
            CountDownLatch expInClose = new CountDownLatch(1);
            CountDownLatch expReleaseClose = new CountDownLatch(1);
            ExecutorService exExp = Executors.newSingleThreadExecutor();
            Future<?> expHolderFuture = exExp.submit(() -> {
                try (KanataM6SchemeCExporter.TaskLockHandle hExp =
                             KanataM6SchemeCExporter.tryAcquireTaskLock(spoolDir, fixedExpTid)) {
                    assertNotNull(hExp);
                    hExp.beforeOsReleaseHook = () -> {
                        expInClose.countDown();
                        try {
                            assertTrue(expReleaseClose.await(15, TimeUnit.SECONDS));
                        } catch (InterruptedException ie) {
                            throw new RuntimeException(ie);
                        }
                    };
                }
                return null;
            });
            try {
                assertTrue(expInClose.await(10, TimeUnit.SECONDS));
                File blkFile = new File(fixedExpDir, "worker_probe_blocked.json");
                File errFile = new File(fixedExpDir, "worker_error.txt");
                targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_EXPORTER_LOCK)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, fixedExpDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, fixedExpTid)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
                waitForFile(blkFile, errFile, 10_000L);
                JSONObject blk = new JSONObject(readSmallText(blkFile));
                assertTrue("Fixed close() MUST block Process B before FileLock.release()", blk.getBoolean("blocked"));
                assertFalse(new File(fixedExpDir, "worker_acquired.json").exists());
                expReleaseClose.countDown();
                expHolderFuture.get(10, TimeUnit.SECONDS);
            } finally {
                exExp.shutdownNow();
                exExp.awaitTermination(5, TimeUnit.SECONDS);
            }

            // --- Part C: Importer control (reproduces old FIX-03 close() bug: delete BEFORE release) ---
            File ctrlTarget = new File(workDir, "ctrl_imp_target.db");
            File ctrlImpLock = KanataM6SchemeCImporter.lockFileForTarget(ctrlTarget.getCanonicalFile());
            long ctrlImpInoA;
            try (RandomAccessFile rafA = new RandomAccessFile(ctrlImpLock, "rw");
                 FileLock flA = rafA.getChannel().tryLock()) {
                assertNotNull(flA);
                ctrlImpInoA = Os.fstat(rafA.getFD()).st_ino;
                assertTrue(ctrlImpLock.delete());

                File acqFile = new File(ctrlImpDir, "worker_acquired.json");
                File errFile = new File(ctrlImpDir, "worker_error.txt");
                targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_IMPORTER_LOCK)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, ctrlImpDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, ctrlTarget.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "ctrl-imp-probe")
                        .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
                waitForFile(acqFile, errFile, 10_000L);
                JSONObject splitBrain = new JSONObject(readSmallText(acqFile));
                assertTrue(splitBrain.getBoolean("acquired"));
                assertNotEquals(ctrlImpInoA, splitBrain.getLong("lockIno"));
            }

            // --- Part D: Fixed Importer TargetCommitLockHandle.close() prevents split-brain completely ---
            File fixedTarget = new File(workDir, "fixed_imp_target.db");
            CountDownLatch impInClose = new CountDownLatch(1);
            CountDownLatch impReleaseClose = new CountDownLatch(1);
            ExecutorService exImp = Executors.newSingleThreadExecutor();
            Future<?> impHolderFuture = exImp.submit(() -> {
                try (KanataM6SchemeCImporter.TargetCommitLockHandle hImp =
                             KanataM6SchemeCImporter.acquireTargetCommitLock(fixedTarget.getAbsoluteFile(), new AtomicBoolean(false))) {
                    hImp.beforeOsReleaseHook = () -> {
                        impInClose.countDown();
                        try {
                            assertTrue(impReleaseClose.await(15, TimeUnit.SECONDS));
                        } catch (InterruptedException ie) {
                            throw new RuntimeException(ie);
                        }
                    };
                }
                return null;
            });
            try {
                assertTrue(impInClose.await(10, TimeUnit.SECONDS));
                File blkFile = new File(fixedImpDir, "worker_probe_blocked.json");
                File errFile = new File(fixedImpDir, "worker_error.txt");
                targetCtx.startService(new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_COMPETE_IMPORTER_LOCK)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, fixedImpDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, fixedTarget.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "fixed-imp-probe")
                        .putExtra(KanataM6KillableWorkerService.EXTRA_LOCK_MODE, "try_once"));
                waitForFile(blkFile, errFile, 10_000L);
                JSONObject blk = new JSONObject(readSmallText(blkFile));
                assertTrue("Fixed close() MUST block Process B before FileLock.release()", blk.getBoolean("blocked"));
                assertFalse(new File(fixedImpDir, "worker_acquired.json").exists());
                impReleaseClose.countDown();
                impHolderFuture.get(10, TimeUnit.SECONDS);
            } finally {
                exImp.shutdownNow();
                exImp.awaitTermination(5, TimeUnit.SECONDS);
            }

            Log.i(TAG, "FIX04_04=" + new JSONObject()
                    .put("oldBugControlExporterCaughtSplitBrain", true)
                    .put("oldBugControlImporterCaughtSplitBrain", true)
                    .put("fixedExporterBlockedSplitBrain", true)
                    .put("fixedImporterBlockedSplitBrain", true));
        } finally {
            deleteRecursive(workDir);
        }
    }
}
