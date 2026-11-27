package com.yubin.formyself;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Process;
import android.os.SystemClock;
import android.system.Os;
import android.system.StructStat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Isolated :m6worker process service used by N-04 / F02-02 to execute REAL
 * KanataM6SchemeCExporter.exportToSpool() in a separate OS process, pause at
 * explicit stage hooks (KDF / DB_READ / SPOOL_WRITE / COMMIT) for real SIGKILL,
 * and verify restart recovery via KanataM6SchemeCExporter.recoverIncompleteTasks().
 */
public final class KanataM6KillableWorkerService extends Service {
    public static final String ACTION_START_EXPORT_PAUSE = "com.yubin.formyself.M6_START_EXPORT_PAUSE";
    public static final String ACTION_CHECK_RECOVERY = "com.yubin.formyself.M6_CHECK_RECOVERY";
    public static final String ACTION_START_IMPORT_PAUSE = "com.yubin.formyself.M6_START_IMPORT_PAUSE";
    public static final String ACTION_CHECK_IMPORT_RECOVERY = "com.yubin.formyself.M6_CHECK_IMPORT_RECOVERY";
    public static final String ACTION_COMPETE_EXPORTER_LOCK = "com.yubin.formyself.M6_COMPETE_EXPORTER_LOCK";
    public static final String ACTION_COMPETE_IMPORTER_LOCK = "com.yubin.formyself.M6_COMPETE_IMPORTER_LOCK";
    public static final String ACTION_START_M603_RESTORE_PAUSE = "com.yubin.formyself.M603_START_RESTORE_PAUSE";
    public static final String ACTION_N05_CROSS_PROCESS_CAS = "com.yubin.formyself.N05_CROSS_PROCESS_CAS";
    public static final String ACTION_N05_SIGKILL_AT_STATE = "com.yubin.formyself.N05_SIGKILL_AT_STATE";
    public static final String EXTRA_CONTROL_ROOT = "controlRoot";
    public static final String EXTRA_EXPECTED_SEQ = "expectedSeq";
    public static final String EXTRA_EXPECTED_DIGEST = "expectedDigest";
    public static final String EXTRA_OWNER_ID = "ownerId";
    public static final String EXTRA_HOLD_LOCK_MS = "holdLockMs";
    public static final String STAGE_N05_AFTER_GATE = "N05_AFTER_GATE";
    public static final String STAGE_N05_AFTER_PREPARED = "N05_AFTER_PREPARED";
    public static final String STAGE_N05_BEFORE_HEAD_RENAME = "N05_BEFORE_HEAD_RENAME";
    public static final String STAGE_N05_AFTER_DECISION_TARGET = "N05_AFTER_DECISION_TARGET";
    public static final String ACTION_E2E_M603R_SIGKILL = "com.yubin.formyself.E2E_M603R_SIGKILL";
    public static final String STAGE_E2E_AFTER_GATE = "E2E_AFTER_GATE";
    public static final String STAGE_E2E_AFTER_PREPARED = "E2E_AFTER_PREPARED";
    public static final String STAGE_E2E_BEFORE_HEAD_RENAME = "E2E_BEFORE_HEAD_RENAME";
    public static final String STAGE_E2E_AFTER_DECISION_TARGET = "E2E_AFTER_DECISION_TARGET";
    public static final String STAGE_E2E_AFTER_FINALIZED_BEFORE_GC = "E2E_AFTER_FINALIZED_BEFORE_GC";
    public static final String EXTRA_JOURNAL_DIR = "journalDir";
    public static final String EXTRA_MASTER_PASSWORD = "masterPassword";
    public static final String STAGE_M603_DURING_STAGING = "M603_DURING_STAGING";
    public static final String STAGE_M603_AFTER_STAGING_BEFORE_JOURNAL = "M603_AFTER_STAGING_BEFORE_JOURNAL";
    public static final String STAGE_M603_AFTER_JOURNAL_BEFORE_APPLY = "M603_AFTER_JOURNAL_BEFORE_APPLY";
    public static final String STAGE_M603_DURING_APPLY_BEFORE_RENAME = "M603_DURING_APPLY_BEFORE_RENAME";
    public static final String STAGE_M603_BEFORE_COMMIT_MARKER = "M603_BEFORE_COMMIT_MARKER";
    public static final String STAGE_M603_AFTER_COMMIT_MARKER = "M603_AFTER_COMMIT_MARKER";
    public static final String STAGE_M603_DURING_JOURNAL_CLEAR = "M603_DURING_JOURNAL_CLEAR";
    public static final String EXTRA_WORK_DIR = "workDir";
    public static final String EXTRA_SPOOL_DIR = "spoolDir";
    public static final String EXTRA_DB_PATH = "dbPath";
    public static final String EXTRA_PACKAGE_PATH = "packagePath";
    public static final String EXTRA_RAW_KEY_HEX = "rawKeyHex";
    public static final String EXTRA_PASSWORD = "password";
    public static final String EXTRA_TARGET_PATH = "targetPath";
    public static final String EXTRA_TARGET_DIR = "targetDir";
    public static final String EXTRA_TASK_ID = "taskId";
    public static final String EXTRA_PAUSE_STAGE = "pauseStage";
    public static final String EXTRA_LOCK_MODE = "lockMode";

    public static final String STAGE_KDF = "KDF";
    public static final String STAGE_DB_READ = "DB_READ";
    public static final String STAGE_SPOOL_WRITE = "SPOOL_WRITE";
    public static final String STAGE_COMMIT = "COMMIT";
    public static final String STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE = "AFTER_RENAME_BEFORE_JOURNAL_UPDATE";
    public static final String STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME = "BEFORE_POST_RENAME_JOURNAL_RENAME";
    public static final String STAGE_AFTER_RENAME_BEFORE_DIR_SYNC = "AFTER_RENAME_BEFORE_DIR_SYNC";
    public static final String STAGE_BEFORE_TASK_LOCK_RELEASE = "BEFORE_TASK_LOCK_RELEASE";
    public static final String STAGE_BEFORE_TARGET_LOCK_RELEASE = "BEFORE_TARGET_LOCK_RELEASE";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static void writeJsonAtomically(File target, JSONObject json) throws Exception {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp." + Process.myPid());
        try (FileOutputStream fos = new FileOutputStream(tmp, false)) {
            fos.write(json.toString().getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.getFD().sync();
        }
        Os.rename(tmp.getAbsolutePath(), target.getAbsolutePath());
    }

    private static void signalReadyAndHoldForSigkill(
            File workDir, String taskId, String stage, File tmpSpool, JSONObject extraFields) {
        try {
            File ready = new File(workDir, "worker_ready.json");
            JSONObject info = new JSONObject()
                    .put("pid", Process.myPid())
                    .put("taskId", taskId)
                    .put("stage", stage)
                    .put("tmpSpoolPath", tmpSpool != null ? tmpSpool.getAbsolutePath() : null);
            if (extraFields != null) {
                java.util.Iterator<String> it = extraFields.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    info.put(k, extraFields.get(k));
                }
            }
            writeJsonAtomically(ready, info);
            // Hold open until instrumentation issues Process.killProcess(workerPid)
            Thread.sleep(60_000L);
        } catch (Throwable ignored) {}
    }

    private static void signalReadyAndHoldForSigkill(File workDir, String taskId, String stage, File tmpSpool) {
        signalReadyAndHoldForSigkill(workDir, taskId, stage, tmpSpool, null);
    }

    private static String readJournalStateSafe(File journalFile) {
        if (journalFile == null || !journalFile.exists()) return "";
        try {
            byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(journalFile, 65536);
            return new JSONObject(new String(raw, StandardCharsets.UTF_8)).optString("state", "");
        } catch (Throwable t) {
            return "ERR:" + t.getMessage();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        String workDirPath = intent.getStringExtra(EXTRA_WORK_DIR);
        String taskId = intent.getStringExtra(EXTRA_TASK_ID);
        if (workDirPath == null || taskId == null) return START_NOT_STICKY;

        File workDir = new File(workDirPath);
        if (!workDir.exists()) workDir.mkdirs();

        if (ACTION_START_EXPORT_PAUSE.equals(action)) {
            String spoolDirPath = intent.getStringExtra(EXTRA_SPOOL_DIR);
            String dbPath = intent.getStringExtra(EXTRA_DB_PATH);
            String rawKeyHex = intent.getStringExtra(EXTRA_RAW_KEY_HEX);
            String password = intent.getStringExtra(EXTRA_PASSWORD);
            String targetPath = intent.getStringExtra(EXTRA_TARGET_PATH);
            String pauseStage = intent.getStringExtra(EXTRA_PAUSE_STAGE);

            new Thread(() -> {
                byte[] rawKey = null;
                try {
                    System.loadLibrary("sqlcipher");
                    rawKey = KanataM6PortableCrypto.hexToBytes(rawKeyHex);
                    KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getApplicationContext());
                    File spoolDir = new File(spoolDirPath);
                    File targetFile = new File(targetPath);
                    final File[] createdTmpRef = new File[1];
                    final AtomicBoolean triggered = new AtomicBoolean(false);

                    KanataM6SchemeCExporter.exportToSpool(
                            dbPath,
                            rawKey,
                            password,
                            catalog,
                            new KanataM6SnapshotOwner.WriteGate(),
                            spoolDir,
                            targetFile,
                            null,
                            null,
                            new AtomicBoolean(false),
                            new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void onTaskTempFileCreated(String tid, File tmpSpool) {
                                    createdTmpRef[0] = tmpSpool;
                                }

                                @Override
                                public void onKdfProgress(int block, int iteration) {
                                    if (STAGE_KDF.equals(pauseStage)
                                            && iteration >= 10240
                                            && triggered.compareAndSet(false, true)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, STAGE_KDF, createdTmpRef[0]);
                                    }
                                }

                                @Override
                                public void afterTableRead(int tableId, long rowCount) {
                                    if (STAGE_DB_READ.equals(pauseStage)
                                            && tableId >= 10
                                            && triggered.compareAndSet(false, true)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, STAGE_DB_READ, createdTmpRef[0]);
                                    }
                                }

                                @Override
                                public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                    if (STAGE_SPOOL_WRITE.equals(pauseStage)
                                            && totalWrittenSoFar >= 200L
                                            && triggered.compareAndSet(false, true)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, STAGE_SPOOL_WRITE, createdTmpRef[0]);
                                    }
                                }

                                @Override
                                public void beforeAtomicCommit(File stagedFile, File finalTargetFile) throws IOException {
                                    if (STAGE_COMMIT.equals(pauseStage)
                                            && triggered.compareAndSet(false, true)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, STAGE_COMMIT, stagedFile);
                                    }
                                }

                                @Override
                                public void afterAtomicRenameBeforeJournalUpdate(
                                        File stagedFile, File finalTargetFile, File journalFile) throws IOException {
                                    if (STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE.equals(pauseStage)
                                            && triggered.compareAndSet(false, true)) {
                                        JSONObject extra = new JSONObject();
                                        try {
                                            extra.put("journalStateAtPause", readJournalStateSafe(journalFile))
                                                    .put("stagedExistsAtPause", stagedFile != null && stagedFile.exists())
                                                    .put("targetExistsAtPause", finalTargetFile != null && finalTargetFile.exists());
                                        } catch (Throwable ignored) {}
                                        signalReadyAndHoldForSigkill(
                                                workDir, taskId, STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE, finalTargetFile, extra);
                                    }
                                }

                                @Override
                                public void beforeJournalRename(
                                        String nextState, File tmpJournalFile, File journalFile) throws IOException {
                                    if (STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME.equals(pauseStage)
                                            && "RENAMED_PENDING_DIR_SYNC".equals(nextState)
                                            && triggered.compareAndSet(false, true)) {
                                        JSONObject extra = new JSONObject();
                                        try {
                                            extra.put("journalStateAtPause", readJournalStateSafe(journalFile))
                                                    .put("tmpNextExistsAtPause", tmpJournalFile != null && tmpJournalFile.exists())
                                                    .put("targetExistsAtPause", targetFile.exists());
                                        } catch (Throwable ignored) {}
                                        signalReadyAndHoldForSigkill(
                                                workDir, taskId, STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME, targetFile, extra);
                                    }
                                }

                                @Override
                                public void performTargetDirFsync(File targetParentDir) throws IOException {
                                    if (STAGE_AFTER_RENAME_BEFORE_DIR_SYNC.equals(pauseStage)
                                            && triggered.compareAndSet(false, true)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, STAGE_AFTER_RENAME_BEFORE_DIR_SYNC, targetFile);
                                    }
                                    KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParentDir);
                                }

                                @Override
                                public void beforeTaskLockRelease(String tid, File lockFile, long dev, long ino) {
                                    if (STAGE_BEFORE_TASK_LOCK_RELEASE.equals(pauseStage)
                                            && triggered.compareAndSet(false, true)) {
                                        JSONObject extra = new JSONObject();
                                        try {
                                            extra.put("lockPath", lockFile.getAbsolutePath())
                                                    .put("lockDev", dev)
                                                    .put("lockIno", ino)
                                                    .put("lockExists", lockFile.exists());
                                        } catch (Throwable ignored) {}
                                        signalReadyAndHoldForSigkill(
                                                workDir, tid, STAGE_BEFORE_TASK_LOCK_RELEASE, lockFile, extra);
                                    }
                                }
                            },
                            taskId);
                } catch (Throwable t) {
                    try {
                        File errFile = new File(workDir, "worker_error.txt");
                        try (FileOutputStream fos = new FileOutputStream(errFile)) {
                            fos.write((t.getClass().getName() + ":" + t.getMessage()).getBytes(StandardCharsets.UTF_8));
                        }
                    } catch (Throwable ignored) {}
                } finally {
                    KanataM6PortableCrypto.zeroize(rawKey);
                }
            }, "m6-killable-exporter").start();
        } else if (ACTION_CHECK_RECOVERY.equals(action)) {
            String spoolDirPath = intent.getStringExtra(EXTRA_SPOOL_DIR);
            String targetDirPath = intent.getStringExtra(EXTRA_TARGET_DIR);
            new Thread(() -> {
                try {
                    File spoolDir = new File(spoolDirPath);
                    KanataM6SchemeCExporter.RecoveryReport rep = (targetDirPath != null && !targetDirPath.isEmpty())
                            ? KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir, new File(targetDirPath))
                            : KanataM6SchemeCExporter.recoverIncompleteTasks(spoolDir);
                    File recovered = new File(workDir, "worker_recovered.json");
                    JSONObject out = new JSONObject()
                            .put("pid", Process.myPid())
                            .put("scannedJournals", rep.scannedJournals)
                            .put("cleanedTasks", rep.cleanedTasks)
                            .put("confirmedCommitTasks", rep.confirmedCommitTasks)
                            .put("unconfirmedCommitTasks", rep.unconfirmedCommitTasks)
                            .put("rejectedUntrustedJournals", rep.rejectedUntrustedJournals)
                            .put("cleanedTaskIds", new org.json.JSONArray(rep.cleanedTaskIds))
                            .put("skippedActiveTaskIds", new org.json.JSONArray(rep.skippedActiveTaskIds))
                            .put("confirmedCommitTaskIds", new org.json.JSONArray(rep.confirmedCommitTaskIds))
                            .put("unconfirmedCommitTaskIds", new org.json.JSONArray(rep.unconfirmedCommitTaskIds))
                            .put("rejectedJournalNames", new org.json.JSONArray(rep.rejectedJournalNames));
                    writeJsonAtomically(recovered, out);
                } catch (Throwable ignored) {}
                stopSelf(startId);
            }, "m6-recovery-worker").start();
        } else if (ACTION_START_IMPORT_PAUSE.equals(action)) {
            String packagePath = intent.getStringExtra(EXTRA_PACKAGE_PATH);
            String rawKeyHex = intent.getStringExtra(EXTRA_RAW_KEY_HEX);
            String password = intent.getStringExtra(EXTRA_PASSWORD);
            String targetPath = intent.getStringExtra(EXTRA_TARGET_PATH);
            String pauseStage = intent.getStringExtra(EXTRA_PAUSE_STAGE);
            new Thread(() -> {
                byte[] rawKey = null;
                try {
                    System.loadLibrary("sqlcipher");
                    rawKey = KanataM6PortableCrypto.hexToBytes(rawKeyHex);
                    KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getApplicationContext());
                    File pkgFile = new File(packagePath);
                    File targetFile = new File(targetPath);
                    final AtomicBoolean triggered = new AtomicBoolean(false);
                    try (java.io.FileInputStream fis = new java.io.FileInputStream(pkgFile)) {
                        KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                                fis,
                                password,
                                catalog,
                                workDir,
                                targetFile,
                                rawKey,
                                new AtomicBoolean(false),
                                false,
                                new KanataM6SchemeCImporter.ImportHooks() {
                                    @Override
                                    public void afterTargetRenameBeforeJournalUpdate(
                                            File targetDbFile, File importJournalFile) throws Exception {
                                        if (STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE.equals(pauseStage)
                                                && triggered.compareAndSet(false, true)) {
                                            JSONObject extra = new JSONObject();
                                            try {
                                                extra.put("journalStateAtPause", readJournalStateSafe(importJournalFile))
                                                        .put("targetExistsAtPause", targetDbFile != null && targetDbFile.exists());
                                            } catch (Throwable ignored) {}
                                            signalReadyAndHoldForSigkill(
                                                    workDir, taskId, STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE, targetDbFile, extra);
                                        }
                                    }

                                    @Override
                                    public void performTargetDirFsync(File targetParentDir) throws Exception {
                                        if (STAGE_AFTER_RENAME_BEFORE_DIR_SYNC.equals(pauseStage)
                                                && triggered.compareAndSet(false, true)) {
                                            signalReadyAndHoldForSigkill(
                                                    workDir, taskId, STAGE_AFTER_RENAME_BEFORE_DIR_SYNC, targetFile);
                                        }
                                        KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParentDir);
                                    }

                                    @Override
                                    public void beforeTargetLockRelease(File lockFile, long dev, long ino) {
                                        if (STAGE_BEFORE_TARGET_LOCK_RELEASE.equals(pauseStage)
                                                && triggered.compareAndSet(false, true)) {
                                            JSONObject extra = new JSONObject();
                                            try {
                                                extra.put("lockPath", lockFile.getAbsolutePath())
                                                        .put("lockDev", dev)
                                                        .put("lockIno", ino)
                                                        .put("lockExists", lockFile.exists());
                                            } catch (Throwable ignored) {}
                                            signalReadyAndHoldForSigkill(
                                                    workDir, taskId, STAGE_BEFORE_TARGET_LOCK_RELEASE, lockFile, extra);
                                        }
                                    }
                                },
                                taskId);
                    }
                } catch (Throwable t) {
                    try {
                        File errFile = new File(workDir, "worker_error.txt");
                        try (FileOutputStream fos = new FileOutputStream(errFile)) {
                            fos.write((t.getClass().getName() + ":" + t.getMessage()).getBytes(StandardCharsets.UTF_8));
                        }
                    } catch (Throwable ignored) {}
                } finally {
                    KanataM6PortableCrypto.zeroize(rawKey);
                }
            }, "m6-killable-importer").start();
        } else if (ACTION_CHECK_IMPORT_RECOVERY.equals(action)) {
            String targetDirPath = intent.getStringExtra(EXTRA_TARGET_DIR);
            new Thread(() -> {
                try {
                    KanataM6SchemeCImporter.ImportRecoveryReport rep =
                            KanataM6SchemeCImporter.recoverIncompleteImports(new File(targetDirPath));
                    File recovered = new File(workDir, "worker_import_recovered.json");
                    JSONObject out = new JSONObject()
                            .put("pid", Process.myPid())
                            .put("scannedJournals", rep.scannedJournals)
                            .put("cleanedTasks", rep.cleanedTasks)
                            .put("confirmedCommitTasks", rep.confirmedCommitTasks)
                            .put("unconfirmedCommitTasks", rep.unconfirmedCommitTasks)
                            .put("rejectedUntrustedJournals", rep.rejectedUntrustedJournals)
                            .put("cleanedTaskIds", new org.json.JSONArray(rep.cleanedTaskIds))
                            .put("skippedActiveTaskIds", new org.json.JSONArray(rep.skippedActiveTaskIds))
                            .put("confirmedCommitTaskIds", new org.json.JSONArray(rep.confirmedCommitTaskIds))
                            .put("unconfirmedCommitTaskIds", new org.json.JSONArray(rep.unconfirmedCommitTaskIds))
                            .put("rejectedJournalNames", new org.json.JSONArray(rep.rejectedJournalNames));
                    writeJsonAtomically(recovered, out);
                } catch (Throwable ignored) {}
                stopSelf(startId);
            }, "m6-import-recovery-worker").start();
        } else if (ACTION_COMPETE_EXPORTER_LOCK.equals(action)) {
            String spoolDirPath = intent.getStringExtra(EXTRA_SPOOL_DIR);
            String lockMode = intent.getStringExtra(EXTRA_LOCK_MODE);
            new Thread(() -> {
                try {
                    File spoolDir = new File(spoolDirPath).getCanonicalFile();
                    File lockFile = KanataM6SchemeCExporter.taskLockFileFor(spoolDir, taskId);
                    int blockedCount = 0;
                    long deadline = SystemClock.elapsedRealtime() + 25_000L;
                    KanataM6SchemeCExporter.TaskLockHandle acquired = null;
                    while (true) {
                        acquired = KanataM6SchemeCExporter.tryAcquireTaskLock(spoolDir, taskId);
                        if (acquired != null) {
                            long acquiredAt = SystemClock.elapsedRealtimeNanos();
                            long dev = acquired.lockDev;
                            long ino = acquired.lockIno;
                            acquired.close();
                            JSONObject out = new JSONObject()
                                    .put("pid", Process.myPid())
                                    .put("taskId", taskId)
                                    .put("acquired", true)
                                    .put("blockedCount", blockedCount)
                                    .put("lockPath", lockFile.getAbsolutePath())
                                    .put("lockDev", dev)
                                    .put("lockIno", ino)
                                    .put("acquiredAtNanos", acquiredAt);
                            writeJsonAtomically(new File(workDir, "worker_acquired.json"), out);
                            break;
                        }
                        blockedCount++;
                        if (blockedCount == 1) {
                            StructStat diskStat = KanataM6SchemeCExporter.lstatOrNull(lockFile);
                            JSONObject blk = new JSONObject()
                                    .put("pid", Process.myPid())
                                    .put("taskId", taskId)
                                    .put("acquired", false)
                                    .put("blocked", true)
                                    .put("lockExists", lockFile.exists())
                                    .put("diskDev", diskStat != null ? diskStat.st_dev : -1L)
                                    .put("diskIno", diskStat != null ? diskStat.st_ino : -1L);
                            writeJsonAtomically(new File(workDir, "worker_probe_blocked.json"), blk);
                        }
                        if ("try_once".equals(lockMode) || SystemClock.elapsedRealtime() >= deadline) {
                            break;
                        }
                        Thread.sleep(20L);
                    }
                } catch (Throwable t) {
                    try {
                        writeJsonAtomically(new File(workDir, "worker_error.txt"),
                                new JSONObject().put("error", t.getClass().getName() + ":" + t.getMessage()));
                    } catch (Throwable ignored) {}
                }
                stopSelf(startId);
            }, "m6-compete-exporter-lock").start();
        } else if (ACTION_COMPETE_IMPORTER_LOCK.equals(action)) {
            String targetPath = intent.getStringExtra(EXTRA_TARGET_PATH);
            String lockMode = intent.getStringExtra(EXTRA_LOCK_MODE);
            new Thread(() -> {
                try {
                    File targetAbs = new File(targetPath).getAbsoluteFile();
                    if ("try_once".equals(lockMode)) {
                        try (KanataM6SchemeCImporter.TargetCommitLockHandle h =
                                     KanataM6SchemeCImporter.tryAcquireTargetCommitLock(targetAbs)) {
                            if (h == null) {
                                writeJsonAtomically(new File(workDir, "worker_probe_blocked.json"),
                                        new JSONObject().put("pid", Process.myPid()).put("acquired", false).put("blocked", true));
                            } else {
                                writeJsonAtomically(new File(workDir, "worker_acquired.json"),
                                        new JSONObject()
                                                .put("pid", Process.myPid())
                                                .put("acquired", true)
                                                .put("lockDev", h.lockDev)
                                                .put("lockIno", h.lockIno)
                                                .put("acquiredAtNanos", SystemClock.elapsedRealtimeNanos()));
                            }
                        }
                    } else {
                        writeJsonAtomically(new File(workDir, "worker_attempting.json"),
                                new JSONObject()
                                        .put("pid", Process.myPid())
                                        .put("attemptingAtNanos", SystemClock.elapsedRealtimeNanos()));
                        try (KanataM6SchemeCImporter.TargetCommitLockHandle h =
                                     KanataM6SchemeCImporter.acquireTargetCommitLock(targetAbs, new AtomicBoolean(false))) {
                            long acquiredAt = SystemClock.elapsedRealtimeNanos();
                            writeJsonAtomically(new File(workDir, "worker_acquired.json"),
                                    new JSONObject()
                                            .put("pid", Process.myPid())
                                            .put("acquired", true)
                                            .put("lockDev", h.lockDev)
                                            .put("lockIno", h.lockIno)
                                            .put("lockPath", h.lockFile.getAbsolutePath())
                                            .put("acquiredAtNanos", acquiredAt));
                        }
                    }
                } catch (Throwable t) {
                    try {
                        writeJsonAtomically(new File(workDir, "worker_error.txt"),
                                new JSONObject().put("error", t.getClass().getName() + ":" + t.getMessage()));
                    } catch (Throwable ignored) {}
                }
                stopSelf(startId);
            }, "m6-compete-importer-lock").start();
        } else if (ACTION_START_M603_RESTORE_PAUSE.equals(action)) {
            String packagePath = intent.getStringExtra(EXTRA_PACKAGE_PATH);
            String rawKeyHex = intent.getStringExtra(EXTRA_RAW_KEY_HEX);
            String backupPassword = intent.getStringExtra(EXTRA_PASSWORD);
            String masterPassword = intent.getStringExtra(EXTRA_MASTER_PASSWORD);
            String targetPath = intent.getStringExtra(EXTRA_TARGET_PATH);
            String journalDirPath = intent.getStringExtra(EXTRA_JOURNAL_DIR);
            String pauseStage = intent.getStringExtra(EXTRA_PAUSE_STAGE);

            new Thread(() -> {
                byte[] rawKey = null;
                try {
                    System.loadLibrary("sqlcipher");
                    KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getApplicationContext());
                    rawKey = KanataM6PortableCrypto.hexToBytes(rawKeyHex);
                    File targetFile = new File(targetPath);
                    File targetDir = targetFile.getParentFile();
                    File journalDir = new File(journalDirPath);
                    if (!journalDir.exists()) journalDir.mkdirs();
                    File stagingDir = new File(targetDir, "staging");
                    File rollbackDir = new File(targetDir, "rollback");
                    if (!stagingDir.exists()) stagingDir.mkdirs();
                    if (!rollbackDir.exists()) rollbackDir.mkdirs();

                    KanataM6StagingRestoreEngine.PreparedStagingArtifact staged =
                            KanataM6StagingRestoreEngine.prepareStagingFromFile(
                                    new File(packagePath),
                                    backupPassword,
                                    catalog,
                                    workDir,
                                    stagingDir,
                                    rawKey,
                                    null,
                                    50,
                                    new AtomicBoolean(false),
                                    new KanataM6StagingRestoreEngine.StagingHooks() {
                                        @Override
                                        public void beforeBatchCommit(String tableName, int batchIndex, int rowsInBatch, net.zetetic.database.sqlcipher.SQLiteDatabase stagingDb) {
                                            if (STAGE_M603_DURING_STAGING.equals(pauseStage) && "messages".equals(tableName)) {
                                                signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null);
                                            }
                                        }
                                    },
                                    taskId);

                    if (STAGE_M603_AFTER_STAGING_BEFORE_JOURNAL.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, staged.stagingDbFile,
                                new JSONObject().put("stagePath", staged.stagingDbFile.getAbsolutePath())
                                        .put("stageSha", staged.stagingSha256Hex));
                        return;
                    }

                    KanataM6StagingRestoreEngine.CapturedPreviousGeneration previous =
                            KanataM6StagingRestoreEngine.capturePreviousGeneration(
                                    targetFile, rawKey, rollbackDir, taskId, new KanataM6SnapshotOwner.WriteGate());

                    // Persist AES-256-GCM encrypted restore journal record (restore-v1.enc)
                    JSONObject record = new JSONObject()
                            .put("version", 1)
                            .put("taskId", taskId)
                            .put("previous", new JSONObject()
                                    .put("absent", previous.absent)
                                    .put("dbPath", previous.rollbackDbFile != null ? previous.rollbackDbFile.getAbsolutePath() : "")
                                    .put("dbSha256Hex", previous.rollbackSha256Hex))
                            .put("target", new JSONObject()
                                    .put("absent", false)
                                    .put("dbPath", staged.stagingDbFile.getAbsolutePath())
                                    .put("dbSha256Hex", staged.stagingSha256Hex));
                    byte[] salt = KanataM6PortableCrypto.randomBytes(16);
                    byte[] iv = KanataM6PortableCrypto.randomBytes(12);
                    byte[] key = new byte[32];
                    KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAllocInto(
                            masterPassword.getBytes(StandardCharsets.UTF_8), salt, 50_000, 32, new AtomicBoolean(false), key);
                    byte[] plain = record.toString().getBytes(StandardCharsets.UTF_8);
                    byte[] cipher = KanataM6PortableCrypto.aesGcmEncrypt(key, iv, plain, plain.length, new byte[0], "worker-journal");
                    KanataM6PortableCrypto.zeroize(key, plain);
                    JSONObject env = new JSONObject()
                            .put("version", 1)
                            .put("saltHex", KanataM6PortableCrypto.bytesToHex(salt))
                            .put("ivHex", KanataM6PortableCrypto.bytesToHex(iv))
                            .put("cipherHex", KanataM6PortableCrypto.bytesToHex(cipher));
                    String encText = env.toString();
                    File journalFile = new File(journalDir, "restore-v1.enc");
                    File commitFile = new File(journalDir, "restore-v1.commit");
                    writeJsonAtomically(journalFile, env);
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(journalDir);
                    String journalDigest = KanataM6SchemeCExporter.computeFileSha256Hex(journalFile);

                    if (STAGE_M603_AFTER_JOURNAL_BEFORE_APPLY.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, journalFile,
                                new JSONObject().put("journalDigest", journalDigest)
                                        .put("rollbackPath", previous.rollbackDbFile != null ? previous.rollbackDbFile.getAbsolutePath() : "")
                                        .put("stagePath", staged.stagingDbFile.getAbsolutePath()));
                        return;
                    }

                    KanataM6StagingRestoreEngine.applyVerifiedGeneration(
                            staged.stagingDbFile,
                            staged.stagingSha256Hex,
                            false,
                            targetFile,
                            rawKey,
                            taskId,
                            new AtomicBoolean(false),
                            new KanataM6StagingRestoreEngine.ApplyHooks() {
                                @Override
                                public void beforeApplyRename(File applyTmpFile, File activeDbFile) {
                                    if (STAGE_M603_DURING_APPLY_BEFORE_RENAME.equals(pauseStage)) {
                                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, applyTmpFile);
                                    }
                                }
                            });

                    if (STAGE_M603_BEFORE_COMMIT_MARKER.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, journalFile,
                                new JSONObject().put("journalDigest", journalDigest));
                        return;
                    }

                    writeJsonAtomically(commitFile, new JSONObject().put("digest", journalDigest));
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(journalDir);

                    if (STAGE_M603_AFTER_COMMIT_MARKER.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, commitFile,
                                new JSONObject().put("journalDigest", journalDigest));
                        return;
                    }

                    // Delete restore-v1.enc first, then pause before removing commit marker
                    journalFile.delete();
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(journalDir);
                    if (STAGE_M603_DURING_JOURNAL_CLEAR.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, commitFile,
                                new JSONObject().put("journalDigest", journalDigest));
                        return;
                    }
                    commitFile.delete();
                    KanataM6SchemeCExporter.fsyncDirectoryStrict(journalDir);
                } catch (Throwable t) {
                    try {
                        writeJsonAtomically(new File(workDir, "worker_error.txt"),
                                new JSONObject().put("error", t.getClass().getName() + ":" + t.getMessage()));
                    } catch (Throwable ignored) {}
                } finally {
                    KanataM6PortableCrypto.zeroize(rawKey);
                }
                stopSelf(startId);
            }, "m603-restore-pause-worker").start();
        } else if (ACTION_N05_CROSS_PROCESS_CAS.equals(action)) {
            final String controlRootPath = intent.getStringExtra(EXTRA_CONTROL_ROOT);
            final long expectedSeq = intent.getLongExtra(EXTRA_EXPECTED_SEQ, 0L);
            final String expectedDigest = intent.getStringExtra(EXTRA_EXPECTED_DIGEST);
            final String ownerId = intent.getStringExtra(EXTRA_OWNER_ID);
            final long holdLockMs = intent.getLongExtra(EXTRA_HOLD_LOCK_MS, 0L);
            new Thread(() -> {
                File controlRoot = new File(controlRootPath);
                JSONObject res = new JSONObject();
                try {
                    res.put("pid", Process.myPid());
                    res.put("ownerId", ownerId);
                    if (holdLockMs > 0) {
                        try (KanataDurableTxControl.StableControlLock lock =
                                     KanataDurableTxControl.acquireControlLock(controlRoot)) {
                            res.put("lockDev", lock.dev);
                            res.put("lockIno", lock.ino);
                            writeJsonAtomically(new File(workDir, "n05_lock_held.json"),
                                    new JSONObject().put("pid", Process.myPid()).put("dev", lock.dev).put("ino", lock.ino));
                            Thread.sleep(holdLockMs);
                        }
                        res.put("ok", true);
                        res.put("mode", "hold_lock");
                    } else {
                        KanataDurableTxControl.ControlRecord next = KanataDurableTxControl.compareAndSetTransition(
                                getApplicationContext(),
                                controlRoot,
                                "txn-" + ownerId,
                                ownerId,
                                1L,
                                expectedSeq,
                                expectedDigest,
                                KanataDurableTxControl.STATE_GATE,
                                KanataDurableTxControl.DIR_NONE,
                                false,
                                "",
                                null,
                                null,
                                null,
                                "input-n05",
                                "",
                                "worker-gate",
                                "kanata-portable-restore",
                                "kanata-portable-v1",
                                java.util.Arrays.asList("kanata", "todo", "settings", "vault"),
                                false,
                                0L,
                                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                                KanataDurableTxControl.FaultInjector.NONE);
                        res.put("ok", true);
                        res.put("sequence", next.sequence);
                        res.put("recordDigest", next.recordDigest);
                        res.put("txnId", next.txnId);
                    }
                } catch (KanataDurableTxControl.TxControlException e) {
                    try {
                        res.put("ok", false);
                        res.put("errorCode", e.code);
                        res.put("error", e.getMessage());
                    } catch (Throwable ignored) {}
                } catch (Throwable t) {
                    try {
                        res.put("ok", false);
                        res.put("errorCode", "UNEXPECTED");
                        res.put("error", t.getClass().getName() + ":" + t.getMessage());
                    } catch (Throwable ignored) {}
                }
                try {
                    writeJsonAtomically(new File(workDir, "n05_worker_result.json"), res);
                } catch (Throwable ignored) {}
                stopSelf(startId);
            }, "n05-cas-worker").start();
        } else if (ACTION_N05_SIGKILL_AT_STATE.equals(action)) {
            final String controlRootPath = intent.getStringExtra(EXTRA_CONTROL_ROOT);
            final String pauseStage = intent.getStringExtra(EXTRA_PAUSE_STAGE);
            final String ownerId = intent.getStringExtra(EXTRA_OWNER_ID);
            new Thread(() -> {
                File controlRoot = new File(controlRootPath);
                try {
                    KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                            getApplicationContext(),
                            controlRoot,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);
                    KanataDurableTxControl.ControlRecord cur = st.headRecord;
                    KanataDurableTxControl.GenerationRegistration prevGen = cur.previousGeneration;
                    KanataDurableTxControl.GenerationRegistration targetGen =
                            KanataDurableTxControl.GenerationRegistration.absentGeneration("gen-n05-target");
                    // Build a real sealed target generation dir if one was pre-staged in workDir
                    File stagedMarker = new File(workDir, "n05_target_gen.json");
                    if (stagedMarker.exists()) {
                        byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(stagedMarker, 65536);
                        targetGen = KanataDurableTxControl.GenerationRegistration.fromJson(
                                new JSONObject(new String(raw, StandardCharsets.UTF_8)));
                    }

                    KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot,
                            "txn-sigkill-" + pauseStage, ownerId, cur.epoch + 1L,
                            cur.sequence, cur.recordDigest,
                            KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                            false, "", prevGen, null, cur.activeGenerationId,
                            "input-sigkill", "", "gate-entered",
                            "kanata-portable-restore", "kanata-portable-v1",
                            java.util.Arrays.asList("kanata", "todo", "settings", "vault"),
                            false, 0L,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    if (STAGE_N05_AFTER_GATE.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("sequence", gated.sequence).put("txnId", gated.txnId));
                        return;
                    }

                    KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot,
                            gated.txnId, ownerId, gated.epoch,
                            gated.sequence, gated.recordDigest,
                            KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                            false, "", prevGen, targetGen, cur.activeGenerationId,
                            "input-sigkill", "", "prepared",
                            "kanata-portable-restore", "kanata-portable-v1",
                            gated.participants, false, 0L,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    if (STAGE_N05_AFTER_PREPARED.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("sequence", prepared.sequence)
                                        .put("txnId", prepared.txnId)
                                        .put("preparedDigest", prepared.preparedDigest));
                        return;
                    }

                    KanataDurableTxControl.FaultInjector headPauseInjector = STAGE_N05_BEFORE_HEAD_RENAME.equals(pauseStage)
                            ? new KanataDurableTxControl.FaultInjector() {
                                @Override
                                public void beforeRename(String targetLabel) {
                                    if ("head".equals(targetLabel)) {
                                        JSONObject extra = null;
                                        try {
                                            extra = new JSONObject().put("sequence", prepared.sequence)
                                                    .put("txnId", prepared.txnId);
                                        } catch (Exception ignored) {}
                                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null, extra);
                                    }
                                }
                            }
                            : KanataDurableTxControl.FaultInjector.NONE;

                    KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot,
                            prepared.txnId, ownerId, prepared.epoch,
                            prepared.sequence, prepared.recordDigest,
                            KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                            false, prepared.preparedDigest, prevGen, targetGen,
                            targetGen.absent ? "" : targetGen.generationId,
                            "input-sigkill", "", "decided-target",
                            "kanata-portable-restore", "kanata-portable-v1",
                            prepared.participants, false, 0L,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            headPauseInjector);

                    if (STAGE_N05_AFTER_DECISION_TARGET.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("sequence", decided.sequence)
                                        .put("txnId", decided.txnId)
                                        .put("activeGenerationId", decided.activeGenerationId));
                        return;
                    }
                } catch (Throwable t) {
                    try {
                        writeJsonAtomically(new File(workDir, "worker_error.txt"),
                                new JSONObject().put("error", t.getClass().getName() + ":" + t.getMessage()));
                    } catch (Throwable ignored) {}
                }
                stopSelf(startId);
            }, "n05-sigkill-worker").start();
        } else if (ACTION_E2E_M603R_SIGKILL.equals(action)) {
            final String controlRootPath = intent.getStringExtra(EXTRA_CONTROL_ROOT);
            final String packagePath = intent.getStringExtra(EXTRA_PACKAGE_PATH);
            final String backupPassword = intent.getStringExtra(EXTRA_PASSWORD);
            final String masterPassword = intent.getStringExtra(EXTRA_MASTER_PASSWORD);
            final String pauseStage = intent.getStringExtra(EXTRA_PAUSE_STAGE);
            final String ownerId = intent.getStringExtra(EXTRA_OWNER_ID);
            new Thread(() -> {
                File controlRoot = new File(controlRootPath);
                try {
                    KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getApplicationContext());
                    KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                            getApplicationContext(), controlRoot,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);
                    KanataDurableTxControl.ControlRecord cur = st.headRecord;

                    // 1) Real KPB1 staging into isolated target generation directory with fresh DEK + envelope
                    KanataM6GenerationStore.StagedGenerationResult staged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                            getApplicationContext(), controlRoot, null, new File(packagePath),
                            backupPassword, masterPassword, "e2e-" + taskId, ownerId, 1L, cur.epoch + 1L,
                            catalog, KanataM6StagingRestoreEngine.DEFAULT_BATCH_SIZE,
                            new AtomicBoolean(false), new KanataM6StagingRestoreEngine.StagingHooks() {},
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

                    // 2) FINALIZED -> GATE
                    KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot, "txn-e2e-" + taskId, ownerId, cur.epoch + 1L,
                            cur.sequence, cur.recordDigest,
                            KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                            false, "", cur.previousGeneration, null, cur.activeGenerationId,
                            staged.artifact.transcriptHex, "", "e2e-gate",
                            "kanata-portable-restore", "kanata-portable-v1", cur.participants,
                            false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    if (STAGE_E2E_AFTER_GATE.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("txnId", gated.txnId).put("targetGenId", staged.registration.generationId));
                        return;
                    }

                    // 3) GATE -> PREPARED (with AEAD recovery payload + two-generation registration)
                    String payloadId = KanataDurableTxControl.writeEncryptedPayload(
                            getApplicationContext(), controlRoot, gated.txnId, "recovery-state",
                            staged.registration.generationId,
                            new JSONObject().put("prev", cur.activeGenerationId).put("target", staged.registration.generationId).toString().getBytes(StandardCharsets.UTF_8),
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot, gated.txnId, ownerId, gated.epoch,
                            gated.sequence, gated.recordDigest,
                            KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                            false, "", cur.previousGeneration, staged.registration, cur.activeGenerationId,
                            staged.artifact.transcriptHex, payloadId, "e2e-prepared",
                            "kanata-portable-restore", "kanata-portable-v1", gated.participants,
                            false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    if (STAGE_E2E_AFTER_PREPARED.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("txnId", prepared.txnId).put("preparedDigest", prepared.preparedDigest));
                        return;
                    }

                    KanataDurableTxControl.FaultInjector headHook = STAGE_E2E_BEFORE_HEAD_RENAME.equals(pauseStage)
                            ? new KanataDurableTxControl.FaultInjector() {
                                @Override
                                public void beforeRename(String targetLabel) {
                                    if ("head".equals(targetLabel)) {
                                        JSONObject ex = null;
                                        try { ex = new JSONObject().put("txnId", prepared.txnId); } catch (Exception ignored) {}
                                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null, ex);
                                    }
                                }
                            }
                            : KanataDurableTxControl.FaultInjector.NONE;

                    // 4) PREPARED -> DECISION(target)
                    KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot, prepared.txnId, ownerId, prepared.epoch,
                            prepared.sequence, prepared.recordDigest,
                            KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                            false, prepared.preparedDigest, cur.previousGeneration, staged.registration,
                            staged.registration.generationId, staged.artifact.transcriptHex, payloadId,
                            "e2e-decided-target", "kanata-portable-restore", "kanata-portable-v1",
                            prepared.participants, false, 0L,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, headHook);

                    if (STAGE_E2E_AFTER_DECISION_TARGET.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("txnId", decided.txnId).put("targetGenId", staged.registration.generationId));
                        return;
                    }

                    // 5) DECISION(target) -> FINALIZED, then pause BEFORE cleaning up retired previous generation
                    KanataDurableTxControl.ControlRecord fin = KanataDurableTxControl.compareAndSetTransition(
                            getApplicationContext(), controlRoot, decided.txnId, ownerId, decided.epoch,
                            decided.sequence, decided.recordDigest,
                            KanataDurableTxControl.STATE_FINALIZED, KanataDurableTxControl.DIR_TARGET,
                            false, decided.preparedDigest, cur.previousGeneration, staged.registration,
                            staged.registration.generationId, staged.artifact.transcriptHex, payloadId,
                            "e2e-finalized", "kanata-portable-restore", "kanata-portable-v1",
                            decided.participants, false, 0L,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                            KanataDurableTxControl.FaultInjector.NONE);

                    if (STAGE_E2E_AFTER_FINALIZED_BEFORE_GC.equals(pauseStage)) {
                        signalReadyAndHoldForSigkill(workDir, taskId, pauseStage, null,
                                new JSONObject().put("txnId", fin.txnId).put("activeGenId", fin.activeGenerationId));
                        return;
                    }
                } catch (Throwable t) {
                    try {
                        writeJsonAtomically(new File(workDir, "worker_error.txt"),
                                new JSONObject().put("error", t.getClass().getName() + ":" + t.getMessage()));
                    } catch (Throwable ignored) {}
                }
                stopSelf(startId);
            }, "e2e-m603r-sigkill-worker").start();
        }
        return START_NOT_STICKY;
    }
}
