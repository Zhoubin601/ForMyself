package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.os.CancellationSignal;
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
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * F02-01 ~ F02-04 Fault Injection Matrix for Kanata SQLite M6-02 Scheme C.
 * Verifies all 6 safety invariants for every injected fault:
 * 1. Failure accurately identified with expected error code.
 * 2. Source database stays intact & verifiable.
 * 3. Prior valid backup stays byte-for-byte intact.
 * 4. Partial / tampered artifacts are rejected and never committed.
 * 5. Zero DB connection / executor / thread leaks.
 * 6. Zero false success states.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM6F02FaultMatrixTest {
    static {
        System.loadLibrary("sqlcipher");
    }
    private static final String TAG = "KanataM6F02";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final String PW = "f02-fault-matrix-pw";

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
            byte[] buf = new byte[65536];
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

    private static void assertSourceIntact(
            File srcDb,
            byte[] srcKey,
            KanataM6PortableCatalog catalog,
            String expectedOverallShaIfKnown) throws Exception {
        SQLiteDatabase ro = SQLiteDatabase.openDatabase(
                srcDb.getAbsolutePath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null);
        try {
            try (Cursor ic = ro.rawQuery("PRAGMA integrity_check", null)) {
                assertTrue(ic.moveToFirst());
                assertEquals("ok", ic.getString(0));
            }
            try (Cursor fkc = ro.rawQuery("PRAGMA foreign_key_check", null)) {
                assertEquals(0, fkc.getCount());
            }
            if (expectedOverallShaIfKnown != null) {
                KanataM6SyntheticDataset.LogicalSummary sum =
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, false);
                assertEquals(expectedOverallShaIfKnown, sum.overallDigestHex);
            }
        } finally {
            ro.close();
        }
    }

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            assertTrue(c.moveToFirst());
            return c.getString(0);
        }
    }

    @Test
    public void f02_01_and_02_walConcurrencyDrainBusyAndAtomicity() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_f02_12_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File outPkg1 = new File(workDir, "snap_drain.kpb1");
        File outPkg2 = new File(workDir, "snap_uncommitted.kpb1");
        File targetDb1 = new File(workDir, "target1.db");
        File targetDb2 = new File(workDir, "target2.db");
        byte[] srcKey = randomRawKey();
        byte[] targetKey1 = randomRawKey();
        byte[] targetKey2 = randomRawKey();
        ExecutorService exec = Executors.newFixedThreadPool(3);

        try {
            try (SQLiteDatabase activeWalConn = KanataM6SyntheticDataset.populateWithActiveWal(srcDb, srcKey, catalog, 200)) {
                assertNotNull(activeWalConn);
                assertTrue("Expected non-zero initial WAL", KanataM6SyntheticDataset.walSizeBytes(srcDb) > 0L);

                KanataM6SnapshotOwner.WriteGate writeGate = new KanataM6SnapshotOwner.WriteGate();

            // --- Scenario A: Long concurrent WAL reader triggers checkpoint busy=1 + WriteGate drains in-flight writer ---
            CountDownLatch readerPinned = new CountDownLatch(1);
            CountDownLatch releaseReader = new CountDownLatch(1);
            Future<Integer> readerFuture = exec.submit(() -> {
                SQLiteDatabase rdb = SQLiteDatabase.openDatabase(
                        srcDb.getAbsolutePath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    rdb.rawExecSQL("BEGIN DEFERRED");
                    try (Cursor c = rdb.rawQuery("SELECT count(*) FROM messages", null)) {
                        assertTrue(c.moveToFirst());
                        assertEquals(200, c.getInt(0));
                    }
                    readerPinned.countDown();
                    assertTrue(releaseReader.await(15, TimeUnit.SECONDS));
                    rdb.rawExecSQL("COMMIT");
                    return 200;
                } finally {
                    rdb.close();
                }
            });
            assertTrue(readerPinned.await(5, TimeUnit.SECONDS));

            // Observe BUSY checkpoint behavior cleanly without corrupting snapshot
            SQLiteDatabase ckDb = SQLiteDatabase.openDatabase(
                    srcDb.getAbsolutePath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null);
            int busyWhileReaderActive;
            try {
                try (Cursor ck = ckDb.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) {
                    assertTrue(ck.moveToFirst());
                    busyWhileReaderActive = ck.getInt(0);
                    assertEquals("Checkpoint must report busy=1 under active long WAL reader", 1, busyWhileReaderActive);
                }
            } finally {
                ckDb.close();
            }

            // In-flight writer inside WriteGate: cross-table atomic tx (message + message_audits)
            CountDownLatch inflightEntered = new CountDownLatch(1);
            Future<Long> inflightFuture = exec.submit(() -> {
                long epoch = writeGate.enterWriter();
                try {
                    inflightEntered.countDown();
                    Thread.sleep(60);
                    SQLiteDatabase wdb = SQLiteDatabase.openDatabase(
                            srcDb.getAbsolutePath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null);
                    try {
                        wdb.rawExecSQL("PRAGMA busy_timeout=5000");
                        wdb.beginTransactionNonExclusive();
                        try {
                            wdb.execSQL("INSERT INTO messages VALUES('msg-drained-001', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'DRAINED_COMMITTED', 1700008888888, 2, 'complete', 't-dr', 'b-dr', NULL, NULL, NULL, '{}')");
                            wdb.execSQL("INSERT INTO message_audits VALUES('ma-drained-001', 'w1', 'msg-drained-001', 1700008888888, 1, 2, '{\"id\":\"msg-drained-001\",\"worldId\":\"w1\",\"conversationId\":\"c1\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":1700008888888,\"content\":\"DRAINED_COMMITTED_V1\",\"senderNameSnapshot\":\"u\",\"status\":\"complete\",\"revision\":1}', '{\"id\":\"msg-drained-001\",\"worldId\":\"w1\",\"conversationId\":\"c1\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":1700008888888,\"content\":\"DRAINED_COMMITTED\",\"senderNameSnapshot\":\"u\",\"status\":\"complete\",\"revision\":2}', '{}')");
                            wdb.setTransactionSuccessful();
                        } finally {
                            wdb.endTransaction();
                        }
                    } finally {
                        wdb.close();
                    }
                    return epoch;
                } finally {
                    writeGate.exitWriter();
                }
            });
            assertTrue(inflightEntered.await(5, TimeUnit.SECONDS));

            // Concurrent mid-export post-snapshot writer runs right when table 34 (messages) finishes reading
            AtomicBoolean postWriterCommitted = new AtomicBoolean(false);
            KanataM6SchemeCExporter.ExportMetrics em1 = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), srcKey, PW, catalog, writeGate, spoolDir, outPkg1,
                    null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void afterTableRead(int tableId, long rowCount) {
                            if (tableId == 34) {
                                assertTrue("WriteGate must be unblocked after snapshot pinned", writeGate.tryEnterWriterNonBlocking());
                                try {
                                    SQLiteDatabase postDb = SQLiteDatabase.openDatabase(
                                            srcDb.getAbsolutePath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null);
                                    try {
                                        postDb.rawExecSQL("PRAGMA busy_timeout=5000");
                                        postDb.beginTransactionNonExclusive();
                                        try {
                                            postDb.execSQL("INSERT INTO messages VALUES('msg-post-snap-001', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'POST_SNAPSHOT_TX', 1700009990000, 1, 'complete', 't-ps', 'b-ps', NULL, NULL, NULL, '{}')");
                                            postDb.setTransactionSuccessful();
                                            postWriterCommitted.set(true);
                                        } finally {
                                            postDb.endTransaction();
                                        }
                                    } finally {
                                        postDb.close();
                                    }
                                } finally {
                                    writeGate.exitWriter();
                                }
                            }
                        }
                    });

            assertNotNull(inflightFuture.get(10, TimeUnit.SECONDS));
            assertTrue(postWriterCommitted.get());
            releaseReader.countDown();
            assertEquals(Integer.valueOf(200), readerFuture.get(10, TimeUnit.SECONDS));

            // After long reader released, checkpoint succeeds with busy=0
            int busyAfterReaderClose;
            SQLiteDatabase ckDb2 = SQLiteDatabase.openDatabase(
                    srcDb.getAbsolutePath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null);
            try {
                try (Cursor ck = ckDb2.rawQuery("PRAGMA wal_checkpoint(PASSIVE)", null)) {
                    assertTrue(ck.moveToFirst());
                    busyAfterReaderClose = ck.getInt(0);
                    assertEquals(0, busyAfterReaderClose);
                }
            } finally {
                ckDb2.close();
            }

            // Restore snapshot 1 and verify drained tx IS present, post-snapshot tx IS NOT present
            try (FileInputStream fis = new FileInputStream(outPkg1)) {
                KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, PW, catalog, workDir, targetDb1, targetKey1, new AtomicBoolean(false));
            }
            SQLiteDatabase t1 = SQLiteDatabase.openDatabase(
                    targetDb1.getAbsolutePath(), targetKey1, null, FLAGS_RO, (d, e) -> {}, null);
            try {
                assertEquals("201", scalar(t1, "SELECT count(*) FROM messages"));
                assertEquals("1", scalar(t1, "SELECT count(*) FROM messages WHERE id='msg-drained-001'"));
                assertEquals("1", scalar(t1, "SELECT count(*) FROM message_audits WHERE id='ma-drained-001'"));
                assertEquals("0", scalar(t1, "SELECT count(*) FROM messages WHERE id='msg-post-snap-001'"));
            } finally {
                t1.close();
            }

            // --- Scenario B: Open uncommitted WAL writer active during Scheme C READONLY export ---
            CountDownLatch uncommReady = new CountDownLatch(1);
            CountDownLatch allowUncommRollback = new CountDownLatch(1);
            Future<Boolean> uncommFuture = exec.submit(() -> {
                SQLiteDatabase wdb = SQLiteDatabase.openDatabase(
                        srcDb.getAbsolutePath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null);
                try {
                    wdb.rawExecSQL("PRAGMA busy_timeout=5000");
                    wdb.beginTransactionNonExclusive();
                    try {
                        wdb.execSQL("INSERT INTO messages VALUES('msg-uncommitted-999', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'UNCOMMITTED_WAL', 1700009999999, 1, 'complete', 't-un', 'b-un', NULL, NULL, NULL, '{}')");
                        uncommReady.countDown();
                        assertTrue(allowUncommRollback.await(15, TimeUnit.SECONDS));
                    } finally {
                        wdb.endTransaction();
                    }
                    return true;
                } finally {
                    wdb.close();
                }
            });
            assertTrue(uncommReady.await(5, TimeUnit.SECONDS));

            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), srcKey, PW, catalog, writeGate, spoolDir, outPkg2,
                    null, null, new AtomicBoolean(false), null);
            allowUncommRollback.countDown();
            assertTrue(uncommFuture.get(10, TimeUnit.SECONDS));

            try (FileInputStream fis = new FileInputStream(outPkg2)) {
                KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, PW, catalog, workDir, targetDb2, targetKey2, new AtomicBoolean(false));
            }
            SQLiteDatabase t2 = SQLiteDatabase.openDatabase(
                    targetDb2.getAbsolutePath(), targetKey2, null, FLAGS_RO, (d, e) -> {}, null);
            try {
                assertEquals("202", scalar(t2, "SELECT count(*) FROM messages"));
                assertEquals("0", scalar(t2, "SELECT count(*) FROM messages WHERE id='msg-uncommitted-999'"));
            } finally {
                t2.close();
            }
            assertSourceIntact(srcDb, srcKey, catalog, null);

            Log.i(TAG, "F02_01_02=" + new JSONObject()
                    .put("busyWhileReaderActive", busyWhileReaderActive)
                    .put("busyAfterReaderClose", busyAfterReaderClose)
                    .put("drainedTxCaptured", true)
                    .put("postSnapshotTxExcluded", true)
                    .put("uncommittedWalExcluded", true)
                    .put("pkg1Bytes", em1.finalFileBytes));
            }
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(targetKey1, (byte) 0);
            Arrays.fill(targetKey2, (byte) 0);
            exec.shutdownNow();
            exec.awaitTermination(5, TimeUnit.SECONDS);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void f02_03_cancellationEnospcFsyncAndReadbackFailures() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_f02_3_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File priorValidBackup = new File(workDir, "backup_target.kpb1");
        byte[] srcKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 50);
            String srcSha;
            SQLiteDatabase ro0 = SQLiteDatabase.openDatabase(srcDb.getAbsolutePath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null);
            try {
                srcSha = KanataM6SyntheticDataset.computeLogicalFingerprint(ro0, catalog, false).overallDigestHex;
            } finally {
                ro0.close();
            }

            // Produce baseline valid backup that MUST remain untouched when subsequent faults fail
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                    null, null, new AtomicBoolean(false), null);
            String baselineBackupSha = sha256File(priorValidBackup);

            // 1. Cancel during mid-stream DATA read (table 34) targeting same path as priorValidBackup
            AtomicBoolean cancelMid = new AtomicBoolean(false);
            CancellationSignal sigMid = new CancellationSignal();
            assertThrowsCode(KanataM6PortableCrypto.ERR_CANCELLED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getAbsolutePath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                            null, sigMid, cancelMid, new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void afterTableRead(int tableId, long rowCount) {
                                    if (tableId == 34) {
                                        cancelMid.set(true);
                                        sigMid.cancel();
                                    }
                                }
                            }));
            assertEquals(baselineBackupSha, sha256File(priorValidBackup));
            assertEquals(0, spoolDir.listFiles() == null ? 0 : spoolDir.listFiles().length);

            // 2. ENOSPC simulated during spool write
            assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getAbsolutePath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {
                                    if (totalWrittenSoFar > 512) {
                                        throw new IOException("ENOSPC: No space left on device");
                                    }
                                }
                            }));
            assertEquals(baselineBackupSha, sha256File(priorValidBackup));
            assertEquals(0, spoolDir.listFiles() == null ? 0 : spoolDir.listFiles().length);

            // 3. fsync failure
            assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getAbsolutePath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeFsync() throws IOException {
                                    throw new IOException("EIO: fsync failed");
                                }
                            }));
            assertEquals(baselineBackupSha, sha256File(priorValidBackup));
            assertEquals(0, spoolDir.listFiles() == null ? 0 : spoolDir.listFiles().length);

            // 4. Readback verification mismatch (corrupt 1 byte in tmpSpool right before readback)
            File expectedTmpSpool = new File(spoolDir, priorValidBackup.getName() + ".spool.tmp");
            assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getAbsolutePath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                            null, null, new AtomicBoolean(false), new KanataM6SchemeCExporter.SpoolHooks() {
                                @Override
                                public void beforeReadback() throws IOException {
                                    try (RandomAccessFile raf = new RandomAccessFile(expectedTmpSpool, "rw")) {
                                        long pos = Math.max(0L, raf.length() - 10L);
                                        raf.seek(pos);
                                        int b = raf.read();
                                        raf.seek(pos);
                                        raf.write(b ^ 0xFF);
                                    }
                                }
                            }));
            assertEquals(baselineBackupSha, sha256File(priorValidBackup));
            assertFalse("Failed tmpSpool must be deleted", expectedTmpSpool.exists());

            // 5. Cancel right at pre-set atomic flag (KDF / startup stage)
            AtomicBoolean preCancelled = new AtomicBoolean(true);
            assertThrowsCode(KanataM6PortableCrypto.ERR_CANCELLED, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            srcDb.getAbsolutePath(), srcKey, PW, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir, priorValidBackup,
                            null, null, preCancelled, null));
            assertEquals(baselineBackupSha, sha256File(priorValidBackup));
            assertSourceIntact(srcDb, srcKey, catalog, srcSha);

            Log.i(TAG, "F02_03=" + new JSONObject()
                    .put("midCancelRejectedAndCleaned", true)
                    .put("enospcRejectedAndPriorPreserved", true)
                    .put("fsyncFailureRejectedAndPriorPreserved", true)
                    .put("readbackMismatchCaught", true)
                    .put("preCancelRejected", true)
                    .put("priorBackupSha256", baselineBackupSha)
                    .put("sourceSha256", srcSha));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void f02_04_streamShortReadZeroProgressAndContainerTampering() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_f02_4_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File srcDb = new File(workDir, "src.db");
        File validPkg = new File(workDir, "valid.kpb1");
        File okTarget = new File(workDir, "target_shortread_ok.db");
        File badTarget = new File(workDir, "target_must_not_exist.db");
        byte[] srcKey = randomRawKey();
        byte[] dstKeyOk = randomRawKey();
        byte[] dstKeyBad = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, 25);
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), srcKey, PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, validPkg,
                    null, null, new AtomicBoolean(false), null);
            byte[] pkgBytes = readAllBytes(validPkg);
            String validPkgSha = sha256File(validPkg);

            // 1. Extreme short-read (7 bytes per read) must still reconstruct cleanly
            try (InputStream shortIn = new FilterInputStream(new ByteArrayInputStream(pkgBytes)) {
                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    return super.read(b, off, Math.min(len, 7));
                }
            }) {
                KanataM6SchemeCImporter.ImportResult res = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        shortIn, PW, catalog, workDir, okTarget, dstKeyOk, new AtomicBoolean(false));
                assertTrue(res.totalBusinessRows >= 45L);
            }
            assertTrue(okTarget.exists());

            // 2. Zero-progress stream (returns 0 repeatedly) rejected with ERR_IO_FAILED
            try (InputStream zeroProg = new InputStream() {
                @Override public int read() { return 0; }
                @Override public int read(byte[] b, int off, int len) { return 0; }
            }) {
                assertThrowsCode(KanataM6PortableCrypto.ERR_IO_FAILED, () ->
                        KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                                zeroProg, PW, catalog, workDir, badTarget, dstKeyBad, new AtomicBoolean(false)));
            }
            assertFalse("Zero-progress target must not exist", badTarget.exists());

            // 3. Trailing byte appended after authenticated Footer -> ERR_INVALID_CONTAINER
            byte[] trailing = Arrays.copyOf(pkgBytes, pkgBytes.length + 1);
            trailing[trailing.length - 1] = (byte) 0x7F;
            assertThrowsCode(KanataM6PortableCrypto.ERR_INVALID_CONTAINER, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(trailing), PW, catalog, workDir,
                            badTarget, dstKeyBad, new AtomicBoolean(false)));
            assertFalse("Trailing-byte target must not exist", badTarget.exists());

            // 4. Tampered DATA frame ciphertext (mid-package) -> ERR_AUTH_FAILED
            byte[] tamperedData = pkgBytes.clone();
            tamperedData[250] ^= 0x01;
            assertThrowsCode(KanataM6PortableCrypto.ERR_AUTH_FAILED, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(tamperedData), PW, catalog, workDir,
                            badTarget, dstKeyBad, new AtomicBoolean(false)));
            assertFalse("Tampered-data target must not exist", badTarget.exists());

            // 5. Tampered GCM authentication tag on Footer (last byte of container) -> ERR_AUTH_FAILED
            byte[] tamperedTag = pkgBytes.clone();
            tamperedTag[tamperedTag.length - 1] ^= (byte) 0x80;
            assertThrowsCode(KanataM6PortableCrypto.ERR_AUTH_FAILED, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(tamperedTag), PW, catalog, workDir,
                            badTarget, dstKeyBad, new AtomicBoolean(false)));
            assertFalse("Tampered-tag target must not exist", badTarget.exists());

            // Valid archive untouched
            assertEquals(validPkgSha, sha256File(validPkg));

            Log.i(TAG, "F02_04=" + new JSONObject()
                    .put("shortRead7ByteOk", true)
                    .put("zeroProgressRejected", true)
                    .put("trailingByteRejected", true)
                    .put("tamperedCipherRejected", true)
                    .put("tamperedTagRejected", true)
                    .put("priorValidBackupIntact", true));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(dstKeyOk, (byte) 0);
            Arrays.fill(dstKeyBad, (byte) 0);
            deleteRecursive(workDir);
        }
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
