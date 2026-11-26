package com.yubin.formyself;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Process;

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

    public static final String STAGE_KDF = "KDF";
    public static final String STAGE_DB_READ = "DB_READ";
    public static final String STAGE_SPOOL_WRITE = "SPOOL_WRITE";
    public static final String STAGE_COMMIT = "COMMIT";
    public static final String STAGE_AFTER_RENAME_BEFORE_JOURNAL_UPDATE = "AFTER_RENAME_BEFORE_JOURNAL_UPDATE";
    public static final String STAGE_BEFORE_POST_RENAME_JOURNAL_RENAME = "BEFORE_POST_RENAME_JOURNAL_RENAME";
    public static final String STAGE_AFTER_RENAME_BEFORE_DIR_SYNC = "AFTER_RENAME_BEFORE_DIR_SYNC";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
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
            try (FileOutputStream fos = new FileOutputStream(ready)) {
                fos.write(info.toString().getBytes(StandardCharsets.UTF_8));
                fos.getFD().sync();
            }
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
                    try (FileOutputStream fos = new FileOutputStream(recovered)) {
                        fos.write(out.toString().getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
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
                    try (FileOutputStream fos = new FileOutputStream(recovered)) {
                        fos.write(out.toString().getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
                } catch (Throwable ignored) {}
                stopSelf(startId);
            }, "m6-import-recovery-worker").start();
        }
        return START_NOT_STICKY;
    }
}
