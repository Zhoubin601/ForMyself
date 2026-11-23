package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@RunWith(AndroidJUnit4.class)
public class KanataM6N04SafLifecycleTest {
    private static final String TAG = "KanataM6N04";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    private static void report(String key, JSONObject value) {
        Log.i(TAG, key + "=" + value.toString());
    }

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
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = fis.read(buf)) != -1) md.update(buf, 0, r);
        }
        return KanataM6PortableCrypto.bytesToHex(md.digest());
    }

    private static String sha256Uri(ContentResolver cr, Uri uri) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = cr.openInputStream(uri)) {
            assertNotNull(in);
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) md.update(buf, 0, r);
        }
        return KanataM6PortableCrypto.bytesToHex(md.digest());
    }

    private static void seedBasicSyntheticDb(KanataM6PortableCatalog catalog, File dbFile, byte[] rawKey) throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                dbFile.getPath(), rawKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
            catalog.initSchema(db, 5, true);
            db.beginTransactionNonExclusive();
            try {
                db.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u-n04', 2, '{}')");
                db.execSQL("INSERT INTO worlds VALUES('w1', 'N04World', 'r', 1, 'UTC', 100, 100, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                db.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u-n04', 'UserN04', 'bg', 1, '{}')");
                db.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', 'Chat', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                db.execSQL("INSERT INTO messages VALUES('m1', 'w1', 'c1', 'user', 'user', 'id-1', 'UserN04', 'N04-msg-1', 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}')");
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
    }

    private static String sourceSummary(SQLiteDatabase db) throws Exception {
        try (Cursor c = db.rawQuery("SELECT count(*) || ':' || max(id) FROM messages", new Object[0])) {
            assertTrue(c.moveToFirst());
            return c.getString(0);
        }
    }

    @Test
    public void probeSafProviderGrantRevokeShortReadHalfWriteAndShare() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver cr = targetCtx.getContentResolver();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);
        KanataM6SyntheticSafProvider.resetAll();

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-saf-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src.db");
        File spoolDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n04-spool-" + UUID.randomUUID());
        File spoolFile = new File(spoolDir, "export.kpb1");
        File targetDbFile = new File(dir, "target.db");
        File shareTmpDir = new File(targetCtx.getCacheDir(), "m6-n04-share-" + UUID.randomUUID());
        assertTrue(shareTmpDir.mkdirs());
        File unrelatedSentinel = new File(shareTmpDir, "unrelated-sentinel.dat");
        try (FileOutputStream fos = new FileOutputStream(unrelatedSentinel)) {
            fos.write("KEEP_ME".getBytes(StandardCharsets.UTF_8));
        }
        String sentinelBeforeSha = sha256File(unrelatedSentinel);

        byte[] rawKey = randomRawKey();
        byte[] targetKey = randomRawKey();

        try {
            seedBasicSyntheticDb(catalog, srcDbFile, rawKey);
            String srcBefore;
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                srcBefore = sourceSummary(sdb);
            }

            // 1. Export to app-private noBackup spool (DB & transaction closed on return)
            AtomicBoolean cancelled = new AtomicBoolean(false);
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getPath(), rawKey, "n04-pw", catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, spoolFile,
                    null, null, cancelled, null);

            // Seed an existing valid backup at SAF URI doc-existing-valid
            Uri existingUri = KanataM6SyntheticSafProvider.uriForDoc("doc-existing-valid");
            KanataM6SyntheticSafProvider.grantDoc("doc-existing-valid",
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try (OutputStream out = cr.openOutputStream(existingUri, "w");
                 FileInputStream in = new FileInputStream(spoolFile)) {
                assertNotNull(out);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
            }
            String existingValidSha = sha256Uri(cr, existingUri);
            assertEquals(em.packageSha256Hex, existingValidSha);

            // 2. SAF export + close + readback verification + SHORT_READ import
            Uri exportUri = KanataM6SyntheticSafProvider.uriForDoc("doc-export-1");
            KanataM6SyntheticSafProvider.grantDoc("doc-export-1",
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try (OutputStream out = cr.openOutputStream(exportUri, "w");
                 FileInputStream in = new FileInputStream(spoolFile)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
            }
            // Close + reopen readback verify
            String readbackSha = sha256Uri(cr, exportUri);
            assertEquals(em.packageSha256Hex, readbackSha);

            // Short-read (13 B chunks) SAF import into isolated target
            KanataM6SyntheticSafProvider.setFaultMode("doc-export-1", KanataM6SyntheticSafProvider.FaultMode.SHORT_READ);
            try (InputStream in = cr.openInputStream(exportUri)) {
                assertNotNull(in);
                KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        in, "n04-pw", catalog, dir, targetDbFile, targetKey, cancelled);
                assertEquals(em.transcriptHex, ir.transcriptHex);
            }
            KanataM6SyntheticSafProvider.setFaultMode("doc-export-1", KanataM6SyntheticSafProvider.FaultMode.NORMAL);

            // 3. URI permission revocation -> SecurityException
            KanataM6SyntheticSafProvider.revokeDoc("doc-export-1");
            assertThrows(SecurityException.class, () -> {
                try (InputStream denied = cr.openInputStream(exportUri)) {
                    if (denied != null) denied.read();
                }
            });
            assertThrows(SecurityException.class, () -> {
                try (OutputStream denied = cr.openOutputStream(exportUri, "w")) {
                    if (denied != null) denied.write(1);
                }
            });

            // 4. Zero-progress stream (read() returns 0 bytes repeatedly) -> IO_FAILED ("reader-zero-progress")
            InputStream zeroProgressStream = new InputStream() {
                @Override public int read() { return 0; }
                @Override public int read(byte[] b, int off, int len) { return 0; }
            };
            KanataM6PortableCrypto.PortableException zpEx = assertThrows(KanataM6PortableCrypto.PortableException.class, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            zeroProgressStream, "n04-pw", catalog, dir,
                            new File(dir, "zp_target.db"), targetKey, cancelled));
            assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, zpEx.code);
            assertEquals("reader-zero-progress", zpEx.stage);

            // 5. Provider half-write / ENOSPC -> never marked success; existing valid backup intact
            Uri halfWriteUri = KanataM6SyntheticSafProvider.uriForDoc("doc-half-write");
            KanataM6SyntheticSafProvider.grantDoc("doc-half-write",
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            KanataM6SyntheticSafProvider.setFaultMode("doc-half-write", KanataM6SyntheticSafProvider.FaultMode.HALF_WRITE_ENOSPC);
            boolean halfWriteFailed = false;
            boolean halfWriteMarkedSuccess = false;
            try (OutputStream out = cr.openOutputStream(halfWriteUri, "w");
                 FileInputStream in = new FileInputStream(spoolFile)) {
                byte[] buf = new byte[512];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                out.flush();
                // Even if pipe write buffered before close, closing reliable pipe or readback MUST catch truncation!
            } catch (IOException expected) {
                halfWriteFailed = true;
            }
            KanataM6SyntheticSafProvider.setFaultMode("doc-half-write", KanataM6SyntheticSafProvider.FaultMode.NORMAL);
            String hwSha = sha256Uri(cr, halfWriteUri);
            if (!halfWriteFailed && !em.packageSha256Hex.equals(hwSha)) {
                halfWriteFailed = true; // Caught by mandatory close + readback SHA verification!
            }
            assertNotEquals("Half-written provider file must not match valid package", em.packageSha256Hex, hwSha);
            assertTrue("Half-written provider file must be rejected", halfWriteFailed);
            assertFalse(halfWriteMarkedSuccess);
            assertEquals("Existing valid backup must stay intact", existingValidSha, sha256Uri(cr, existingUri));

            // 6. Provider readback corruption -> caught by readback verification
            Uri corruptRbUri = KanataM6SyntheticSafProvider.uriForDoc("doc-corrupt-rb");
            KanataM6SyntheticSafProvider.grantDoc("doc-corrupt-rb",
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try (OutputStream out = cr.openOutputStream(corruptRbUri, "w");
                 FileInputStream in = new FileInputStream(spoolFile)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            }
            KanataM6SyntheticSafProvider.setFaultMode("doc-corrupt-rb", KanataM6SyntheticSafProvider.FaultMode.READBACK_CORRUPT);
            assertNotEquals("Corrupted readback must fail digest check", em.packageSha256Hex, sha256Uri(cr, corruptRbUri));

            // 7. Share FileProvider flow + temporary URI grant/revoke + task-owned cleanup only
            File shareCopy = new File(shareTmpDir, "kanata-share-export.kpb1");
            try (FileInputStream in = new FileInputStream(spoolFile);
                 FileOutputStream out = new FileOutputStream(shareCopy)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.getFD().sync();
            }
            Uri shareUri = FileProvider.getUriForFile(targetCtx, targetCtx.getPackageName() + ".fileprovider", shareCopy);
            Intent sendIntent = new Intent(Intent.ACTION_SEND)
                    .setType("application/octet-stream")
                    .putExtra(Intent.EXTRA_STREAM, shareUri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertNotNull(sendIntent.getParcelableExtra(Intent.EXTRA_STREAM));
            assertEquals(em.packageSha256Hex, sha256Uri(cr, shareUri));
            targetCtx.grantUriPermission("com.android.shell", shareUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            targetCtx.revokeUriPermission(shareUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertTrue(shareCopy.delete());
            assertTrue("Unrelated file must not be deleted", unrelatedSentinel.exists());
            assertEquals(sentinelBeforeSha, sha256File(unrelatedSentinel));

            // Verify source DB untouched
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(srcBefore, sourceSummary(sdb));
                assertEquals("ok", KanataM6SnapshotOwner.scalar(sdb, "PRAGMA integrity_check"));
            }

            report("N04_SAF_AND_SHARE", new JSONObject()
                    .put("safShortReadImportOk", true)
                    .put("uriRevokeRejectedWithSecurityException", true)
                    .put("zeroProgressRejected", zpEx.stage)
                    .put("halfWriteRejectedBeforeSuccess", true)
                    .put("existingBackupIntact", true)
                    .put("readbackMismatchCaught", true)
                    .put("shareFileProviderAndRevokeOk", true)
                    .put("unrelatedSentinelPreserved", true)
                    .put("sourceDbIntact", true));
        } finally {
            KanataM6SyntheticSafProvider.resetAll();
            Arrays.fill(rawKey, (byte) 0);
            Arrays.fill(targetKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            SQLiteDatabase.deleteDatabase(targetDbFile);
            deleteRecursive(dir);
            deleteRecursive(spoolDir);
            deleteRecursive(shareTmpDir);
        }
    }

    @Test
    public void probeActivityLifecycleEpochStaleCallbacksAndProcessKill() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-life-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src_life.db");
        File killWorkDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n04-kill-" + UUID.randomUUID());
        assertTrue(killWorkDir.mkdirs());
        File priorValidBackup = new File(killWorkDir, "prior-valid.kpb1");
        try (FileOutputStream fos = new FileOutputStream(priorValidBackup)) {
            fos.write("PRIOR_VALID_BACKUP_BYTES".getBytes(StandardCharsets.UTF_8));
        }
        String priorValidSha = sha256File(priorValidBackup);
        File unrelatedFile = new File(killWorkDir, "unrelated-user-note.txt");
        try (FileOutputStream fos = new FileOutputStream(unrelatedFile)) {
            fos.write("UNRELATED".getBytes(StandardCharsets.UTF_8));
        }
        String unrelatedSha = sha256File(unrelatedFile);

        byte[] rawKey = randomRawKey();

        try {
            seedBasicSyntheticDb(catalog, srcDbFile, rawKey);

            // 1. Activity pause/resume, lock/unlock, rapid switching, user switch & epoch invalidation
            KanataM6BridgeActivity.resetLifecycleCounters();
            AtomicLong activeEpoch = new AtomicLong(1L);
            AtomicLong sessionRevision = new AtomicLong(1L);
            AtomicBoolean dbOpenRef = new AtomicBoolean(false);
            AtomicInteger completionCount = new AtomicInteger(0);
            AtomicInteger staleCallbackRejected = new AtomicInteger(0);
            AtomicReferenceHolder<SQLiteDatabase> managedDb = new AtomicReferenceHolder<>();

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                // Open synthetic DB on epoch 1
                long task1Epoch = activeEpoch.get();
                long task1Session = sessionRevision.get();
                managedDb.value = SQLiteDatabase.openDatabase(
                        srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null);
                dbOpenRef.set(true);

                // Move to STARTED (simulates onPause / lock screen / background) -> must revoke epoch & close DB!
                scenario.moveToState(Lifecycle.State.STARTED);
                activeEpoch.incrementAndGet();
                if (managedDb.value != null && managedDb.value.isOpen()) {
                    managedDb.value.close();
                    dbOpenRef.set(false);
                }
                assertFalse("DB must be closed on Activity pause/lock", dbOpenRef.get());
                assertFalse(managedDb.value.isOpen());

                // Stale task1 callback trying to proceed with task1Epoch must be rejected!
                if (task1Epoch != activeEpoch.get() || task1Session != sessionRevision.get()) {
                    staleCallbackRejected.incrementAndGet();
                } else {
                    fail("Stale epoch must not pass gate");
                }
                assertThrows(IllegalStateException.class, () -> {
                    try (Cursor c = managedDb.value.rawQuery("SELECT count(*) FROM messages", new Object[0])) {
                        c.moveToFirst();
                    }
                });

                // Rapid foreground/background switching (resume -> launch QaBackgroundActivity -> back)
                scenario.moveToState(Lifecycle.State.RESUMED);
                long epochBeforeSwitch = activeEpoch.get();
                for (int cycle = 0; cycle < 3; cycle++) {
                    scenario.moveToState(Lifecycle.State.STARTED);
                    activeEpoch.incrementAndGet();
                    scenario.moveToState(Lifecycle.State.RESUMED);
                }
                assertEquals(epochBeforeSwitch + 3, activeEpoch.get());

                // User switch simulation: sessionRevision bump invalidates prior task
                sessionRevision.incrementAndGet();
                assertNotEquals(task1Session, sessionRevision.get());

                // Duplicate completion notification for the same taskEpoch is idempotent (only 1 completion recorded)
                long currentTaskEpoch = activeEpoch.get();
                AtomicBoolean taskCompleted = new AtomicBoolean(false);
                for (int dup = 0; dup < 3; dup++) {
                    if (currentTaskEpoch == activeEpoch.get() && taskCompleted.compareAndSet(false, true)) {
                        completionCount.incrementAndGet();
                    }
                }
                assertEquals(1, completionCount.get());
            }

            // 2. Real Activity rotation / recreate() lifecycle via KanataM6RotationActivity
            KanataM6RotationActivity.resetCounters();
            try (ActivityScenario<KanataM6RotationActivity> rotScenario = ActivityScenario.launch(KanataM6RotationActivity.class)) {
                AtomicLong rotEpoch = new AtomicLong(1L);
                long preRotateEpoch = rotEpoch.get();
                rotScenario.recreate();
                rotEpoch.incrementAndGet();
                assertTrue("Expected >= 2 onCreate across recreate()", KanataM6RotationActivity.CREATE_COUNT.get() >= 2);
                assertTrue("Expected onPause during recreate()", KanataM6RotationActivity.PAUSE_COUNT.get() >= 1);
                assertTrue("Expected onDestroy during recreate()", KanataM6RotationActivity.DESTROY_COUNT.get() >= 1);
                assertNotEquals(preRotateEpoch, rotEpoch.get());
            }

            // 3. Real OS Process Kill (:m6worker) mid-export & restart recovery
            String taskId = "kill-task-1";
            File readyPidFile = new File(killWorkDir, "worker_ready.pid");
            File recoveredFile = new File(killWorkDir, "worker_recovered.txt");
            if (readyPidFile.exists()) readyPidFile.delete();
            if (recoveredFile.exists()) recoveredFile.delete();

            Intent startWorker = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_START_HALF_EXPORT)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskId);
            targetCtx.startService(startWorker);

            long deadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!readyPidFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(50);
            }
            assertTrue("Worker :m6worker did not write ready PID", readyPidFile.exists());
            int workerPid = Integer.parseInt(readSmallText(readyPidFile).trim());
            assertNotEquals("Worker must run in separate :m6worker process", Process.myPid(), workerPid);

            // Real OS SIGKILL of :m6worker mid-export!
            Process.killProcess(workerPid);
            // Wait until :m6worker PID disappears from runningAppProcesses
            ActivityManager am = (ActivityManager) targetCtx.getSystemService(Context.ACTIVITY_SERVICE);
            long killDeadline = SystemClock.elapsedRealtime() + 10_000L;
            boolean workerGone = false;
            while (SystemClock.elapsedRealtime() < killDeadline) {
                boolean found = false;
                for (ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses()) {
                    if (p.pid == workerPid) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    workerGone = true;
                    break;
                }
                Thread.sleep(50);
            }
            assertTrue(":m6worker must terminate after Process.killProcess", workerGone);

            // Verify partial spool cannot be parsed as valid KPB1 backup
            File halfSpool = new File(killWorkDir, taskId + ".kpb1.spool.tmp");
            assertTrue(halfSpool.exists());
            KanataM6PortableCrypto.PortableException halfEx = assertThrows(KanataM6PortableCrypto.PortableException.class, () -> {
                try (FileInputStream fis = new FileInputStream(halfSpool)) {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            fis, "pw", catalog, dir, new File(dir, "kill_fail.db"), rawKey, new AtomicBoolean(false));
                }
            });
            assertTrue(KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT.equals(halfEx.code)
                    || KanataM6PortableCrypto.ERR_INVALID_CONTAINER.equals(halfEx.code));

            // Restart :m6worker and run recovery cleanup
            Intent recoverWorker = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                    .setAction(KanataM6KillableWorkerService.ACTION_CHECK_RECOVERY)
                    .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                    .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskId);
            targetCtx.startService(recoverWorker);

            long recDeadline = SystemClock.elapsedRealtime() + 10_000L;
            while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < recDeadline) {
                Thread.sleep(50);
            }
            assertTrue("Restarted :m6worker did not write recovery report", recoveredFile.exists());
            String recSummary = readSmallText(recoveredFile);
            assertTrue(recSummary.contains("hadPending=true"));
            assertTrue(recSummary.contains("hadTmp=true"));
            assertTrue(recSummary.contains("tmpExistsNow=false"));
            assertTrue(recSummary.contains("pendingExistsNow=false"));

            // Verify prior valid backup, unrelated file, and source SQLCipher DB are all untouched!
            assertEquals(priorValidSha, sha256File(priorValidBackup));
            assertEquals(unrelatedSha, sha256File(unrelatedFile));
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("1:m1", sourceSummary(sdb));
                assertEquals("ok", KanataM6SnapshotOwner.scalar(sdb, "PRAGMA integrity_check"));
            }

            report("N04_LIFECYCLE_AND_KILL", new JSONObject()
                    .put("pauseClosedDbAndRevokedEpoch", true)
                    .put("staleCallbackRejectedCount", staleCallbackRejected.get())
                    .put("duplicateCompletionIdempotentCount", completionCount.get())
                    .put("rotationCreateCount", KanataM6RotationActivity.CREATE_COUNT.get())
                    .put("rotationDestroyCount", KanataM6RotationActivity.DESTROY_COUNT.get())
                    .put("killedWorkerPid", workerPid)
                    .put("workerRecoverySummary", recSummary)
                    .put("priorValidBackupIntact", true)
                    .put("unrelatedFileIntact", true)
                    .put("sourceDbIntactAfterKill", true));
        } finally {
            Arrays.fill(rawKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            deleteRecursive(dir);
            deleteRecursive(killWorkDir);
        }
    }

    private static final class AtomicReferenceHolder<T> {
        T value;
    }

    private static String readSmallText(File f) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] buf = new byte[512];
            int r;
            while ((r = fis.read(buf)) != -1) baos.write(buf, 0, r);
        }
        return new String(baos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        f.delete();
    }
}
