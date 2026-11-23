package com.yubin.formyself;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Process;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Isolated :m6worker process service used by N-04 / F02-02 to test real OS process kill
 * mid-export and clean restart recovery without killing the instrumentation runner process.
 */
public final class KanataM6KillableWorkerService extends Service {
    public static final String ACTION_START_HALF_EXPORT = "com.yubin.formyself.M6_START_HALF_EXPORT";
    public static final String ACTION_CHECK_RECOVERY = "com.yubin.formyself.M6_CHECK_RECOVERY";
    public static final String EXTRA_WORK_DIR = "workDir";
    public static final String EXTRA_TASK_ID = "taskId";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
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

        if (ACTION_START_HALF_EXPORT.equals(action)) {
            new Thread(() -> {
                try {
                    File pending = new File(workDir, taskId + ".pending");
                    try (FileOutputStream fos = new FileOutputStream(pending)) {
                        fos.write(("pid=" + Process.myPid() + "\nstate=WRITING_SPOOL\n").getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
                    File tmpSpool = new File(workDir, taskId + ".kpb1.spool.tmp");
                    try (FileOutputStream fos = new FileOutputStream(tmpSpool)) {
                        byte[] partial = new byte[124 + 76 + 1024];
                        System.arraycopy(new byte[] { 0x4b, 0x41, 0x4e, 0x41, 0x54, 0x41, 0x31, 0x00 }, 0, partial, 0, 8);
                        fos.write(partial);
                        fos.getFD().sync();
                    }
                    File ready = new File(workDir, "worker_ready.pid");
                    try (FileOutputStream fos = new FileOutputStream(ready)) {
                        fos.write(Integer.toString(Process.myPid()).getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
                    // Hold open until instrumentation issues Process.killProcess(workerPid)
                    Thread.sleep(60_000L);
                } catch (Throwable ignored) {}
            }, "m6-killable-worker").start();
        } else if (ACTION_CHECK_RECOVERY.equals(action)) {
            new Thread(() -> {
                try {
                    File pending = new File(workDir, taskId + ".pending");
                    File tmpSpool = new File(workDir, taskId + ".kpb1.spool.tmp");
                    boolean hadPending = pending.exists();
                    boolean hadTmp = tmpSpool.exists();
                    // Clean ONLY this task's owned incomplete artifacts; never touch unrelated files!
                    if (tmpSpool.exists()) tmpSpool.delete();
                    if (pending.exists()) pending.delete();
                    File recovered = new File(workDir, "worker_recovered.txt");
                    try (FileOutputStream fos = new FileOutputStream(recovered)) {
                        String summary = "pid=" + Process.myPid()
                                + ";hadPending=" + hadPending
                                + ";hadTmp=" + hadTmp
                                + ";tmpExistsNow=" + tmpSpool.exists()
                                + ";pendingExistsNow=" + pending.exists();
                        fos.write(summary.getBytes(StandardCharsets.UTF_8));
                        fos.getFD().sync();
                    }
                } catch (Throwable ignored) {}
                stopSelf(startId);
            }, "m6-recovery-worker").start();
        }
        return START_NOT_STICKY;
    }
}
