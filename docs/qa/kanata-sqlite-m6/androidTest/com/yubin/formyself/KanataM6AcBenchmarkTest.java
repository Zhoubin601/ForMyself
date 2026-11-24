package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.os.CancellationSignal;
import android.os.Debug;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Unified A1 / A2 / C comparative benchmark at 1k, 10k, and 100k messages.
 * Remediated measurement methodology:
 * - Uniform 10 ms high-frequency ResourceSampler across A1, A2, and C (RSS, Native Heap, Java Heap, WAL peak, spool peak).
 * - Write-block timing starts BEFORE beginSnapshotFreezeAndDrain() for both A2 and C, and spans full lock for A1.
 * - Unmeasurable or inapplicable phases are explicitly recorded as -1 (N/A) without double-counting any interval.
 * - A2 executes the full offline maintenance contract on an independent per-round active-WAL DB copy:
 *   freeze -> drain -> checkpoint(TRUNCATE) -> close ALL source connections -> verify sidecars absent -> copy -> endFreeze -> rekey.
 * - Real mid-operation cancellation probes for A1 (sqlcipher_export), A2 (file copy + rekey limitation), and C (exportToSpool).
 * - Includes explicit same-scope size comparison (excluding runtime tables + pre-applied task projection).
 */
@RunWith(AndroidJUnit4.class)
public class KanataM6AcBenchmarkTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM6Bench";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final String BACKUP_PW = "bench-合成📦-pw-v1";

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
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

    private static final class ResourceSampler implements AutoCloseable {
        private final File[] walFiles;
        private final File[] spoolFiles;
        private final AtomicBoolean running = new AtomicBoolean(true);
        private final Thread thread;
        volatile long peakRssKiB = -1L;
        volatile long peakNativeHeapBytes = -1L;
        volatile long peakJavaHeapBytes = -1L;
        volatile long peakWalBytes = 0L;
        volatile long peakSpoolBytes = 0L;

        ResourceSampler(File[] walFiles, File[] spoolFiles) {
            this.walFiles = walFiles != null ? walFiles : new File[0];
            this.spoolFiles = spoolFiles != null ? spoolFiles : new File[0];
            sampleOnce();
            this.thread = new Thread(() -> {
                while (running.get()) {
                    sampleOnce();
                    SystemClock.sleep(10);
                }
            }, "m6-res-sampler");
            this.thread.start();
        }

        void sampleOnce() {
            long rss = readVmRssKiB();
            if (rss > peakRssKiB) peakRssKiB = rss;
            long nat = Debug.getNativeHeapAllocatedSize();
            if (nat > peakNativeHeapBytes) peakNativeHeapBytes = nat;
            Runtime rt = Runtime.getRuntime();
            long java = rt.totalMemory() - rt.freeMemory();
            if (java > peakJavaHeapBytes) peakJavaHeapBytes = java;
            long walSum = 0L;
            for (File wf : walFiles) {
                if (wf != null && wf.exists()) walSum += wf.length();
            }
            if (walSum > peakWalBytes) peakWalBytes = walSum;
            long spSum = 0L;
            for (File sf : spoolFiles) {
                if (sf != null && sf.exists()) spSum += sf.length();
            }
            if (spSum > peakSpoolBytes) peakSpoolBytes = spSum;
        }

        @Override
        public void close() {
            running.set(false);
            try {
                thread.join(2000L);
            } catch (InterruptedException ignored) {}
            sampleOnce();
        }
    }

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            assertTrue("Expected row for " + sql, c.moveToFirst());
            return c.getString(0);
        }
    }

    private static void verifySqliteDbIntegrity(File dbFile, String passwordOrNull, byte[] rawKeyOrNull) {
        SQLiteDatabase db = rawKeyOrNull != null
                ? SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), rawKeyOrNull, null, FLAGS_RO, (d, e) -> {}, null)
                : SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), passwordOrNull, null, FLAGS_RO, (d, e) -> {}, null);
        try {
            assertEquals("5", scalar(db, "PRAGMA user_version"));
            assertEquals("1263424577", scalar(db, "PRAGMA application_id"));
            assertEquals("ok", scalar(db, "PRAGMA integrity_check"));
            try (Cursor cic = db.rawQuery("PRAGMA cipher_integrity_check", null)) {
                assertEquals("cipher_integrity_check must be empty", 0, cic.getCount());
            }
            try (Cursor fkc = db.rawQuery("PRAGMA foreign_key_check", null)) {
                assertEquals("foreign_key_check must be empty", 0, fkc.getCount());
            }
        } finally {
            db.close();
        }
    }

    private static void fsyncAndReadbackSha(File file) throws Exception {
        try (FileInputStream fis = new FileInputStream(file)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
            assertEquals(32, md.digest().length);
        }
    }

    private static void copyWithSync(File src, File dst, AtomicBoolean cancelFlag) throws Exception {
        try (FileInputStream fis = new FileInputStream(src);
             FileOutputStream fos = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) {
                if (cancelFlag != null && cancelFlag.get()) {
                    throw new IOException("COPY_CANCELLED");
                }
                fos.write(buf, 0, n);
            }
            fos.flush();
            fos.getFD().sync();
        }
    }

    private static final class BenchSample {
        String route;
        int round;
        boolean cold;
        long totalMs;
        long freezeDrainMs = -1L;
        long snapshotPinMs = -1L;
        long dbReadMs = -1L;
        long kdfAeadMs = -1L;
        long spoolWriteMs = -1L;
        long exportExecMs = -1L;
        long checkpointCloseMs = -1L;
        long fileCopyMs = -1L;
        long fsyncReadbackMs = -1L;
        long writeBlockMs = -1L;
        long finalBytes;
        long peakRssKiB;
        long peakNativeHeapBytes;
        long peakJavaHeapBytes;
        long walPeakBytes;
        long spoolPeakBytes;
        boolean logicalVerified;

        JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("route", route)
                    .put("round", round)
                    .put("cold", cold)
                    .put("totalMs", totalMs)
                    .put("freezeDrainMs", freezeDrainMs)
                    .put("snapshotPinMs", snapshotPinMs)
                    .put("dbReadMs", dbReadMs)
                    .put("kdfAeadMs", kdfAeadMs)
                    .put("spoolWriteMs", spoolWriteMs)
                    .put("exportExecMs", exportExecMs)
                    .put("checkpointCloseMs", checkpointCloseMs)
                    .put("fileCopyMs", fileCopyMs)
                    .put("fsyncReadbackMs", fsyncReadbackMs)
                    .put("writeBlockMs", writeBlockMs)
                    .put("finalBytes", finalBytes)
                    .put("peakRssKiB", peakRssKiB)
                    .put("peakNativeHeapBytes", peakNativeHeapBytes)
                    .put("peakJavaHeapBytes", peakJavaHeapBytes)
                    .put("walPeakBytes", walPeakBytes)
                    .put("spoolPeakBytes", spoolPeakBytes)
                    .put("logicalVerified", logicalVerified);
        }
    }

    private static BenchSample runA1(
            File srcDb,
            byte[] srcRawKey,
            File workDir,
            KanataM6PortableCatalog catalog,
            KanataM6SyntheticDataset.LogicalSummary expectedPhysical,
            boolean deepLogicalVerify,
            File optionalCopyOut,
            int round,
            boolean cold) throws Exception {
        BenchSample s = new BenchSample();
        s.route = "A1";
        s.round = round;
        s.cold = cold;

        File tmpDir = new File(workDir, "a1_stage_" + UUID.randomUUID());
        assertTrue(tmpDir.mkdirs());
        File tmpOut = new File(tmpDir, "export.db");
        File finalOut = new File(workDir, "a1_" + UUID.randomUUID() + ".db");
        SQLiteDatabase.deleteDatabase(tmpOut);
        SQLiteDatabase.deleteDatabase(finalOut);

        File srcWal = new File(srcDb.getAbsolutePath() + "-wal");
        File tmpWal = new File(tmpOut.getAbsolutePath() + "-wal");
        SQLiteDatabase db = null;

        try (ResourceSampler sampler = new ResourceSampler(
                new File[] { srcWal, tmpWal },
                new File[] { tmpOut, finalOut })) {
            long tStart = SystemClock.elapsedRealtimeNanos();
            db = SQLiteDatabase.openDatabase(
                    srcDb.getAbsolutePath(), srcRawKey, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            db.rawExecSQL("PRAGMA temp_store=MEMORY");
            db.rawExecSQL("PRAGMA busy_timeout=5000");

            // A1 has no separate non-blocking snapshot pin; sqlcipher_export holds source lock for full duration
            s.snapshotPinMs = -1L; // N/A
            s.dbReadMs = -1L;      // N/A (fused inside sqlcipher_export)
            s.kdfAeadMs = -1L;     // N/A (inline inside ATTACH KEY + sqlcipher_export)
            s.spoolWriteMs = -1L;  // N/A (fused inside sqlcipher_export)

            long tWriteBlock0 = SystemClock.elapsedRealtimeNanos();
            String escapedPath = tmpOut.getAbsolutePath().replace("'", "''");
            String escapedPw = BACKUP_PW.replace("'", "''");

            db.execSQL("ATTACH DATABASE '" + escapedPath + "' AS a1_exp KEY '" + escapedPw + "'");
            try {
                scalar(db, "SELECT sqlcipher_export('a1_exp')");
                db.rawExecSQL("PRAGMA a1_exp.user_version = 5");
                db.rawExecSQL("PRAGMA a1_exp.application_id = " + KanataM6PortableCatalog.APPLICATION_ID);
            } finally {
                db.execSQL("DETACH DATABASE a1_exp");
            }
            db.close();
            db = null;
            long tWriteBlockEnd = SystemClock.elapsedRealtimeNanos();
            s.exportExecMs = (tWriteBlockEnd - tWriteBlock0) / 1_000_000L;
            s.writeBlockMs = s.exportExecMs;
            sampler.sampleOnce();

            long tSync0 = SystemClock.elapsedRealtimeNanos();
            try (FileOutputStream fos = new FileOutputStream(tmpOut, true)) {
                fos.getFD().sync();
            }
            KanataM6SchemeCExporter.defaultAtomicReplace(tmpOut, finalOut);
            fsyncAndReadbackSha(finalOut);
            s.fsyncReadbackMs = (SystemClock.elapsedRealtimeNanos() - tSync0) / 1_000_000L;
            s.totalMs = (SystemClock.elapsedRealtimeNanos() - tStart) / 1_000_000L;
            s.finalBytes = finalOut.length();
            sampler.sampleOnce();

            if (optionalCopyOut != null) {
                copyWithSync(finalOut, optionalCopyOut, null);
            }

            verifySqliteDbIntegrity(finalOut, BACKUP_PW, null);
            if (deepLogicalVerify) {
                SQLiteDatabase outRo = SQLiteDatabase.openDatabase(
                        finalOut.getAbsolutePath(), BACKUP_PW, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    KanataM6SyntheticDataset.LogicalSummary outSum =
                            KanataM6SyntheticDataset.computeLogicalFingerprint(outRo, catalog, false);
                    assertEquals("A1 logical digest mismatch", expectedPhysical.overallDigestHex, outSum.overallDigestHex);
                    s.logicalVerified = true;
                } finally {
                    outRo.close();
                }
            }

            s.peakRssKiB = sampler.peakRssKiB;
            s.peakNativeHeapBytes = sampler.peakNativeHeapBytes;
            s.peakJavaHeapBytes = sampler.peakJavaHeapBytes;
            s.walPeakBytes = sampler.peakWalBytes;
            s.spoolPeakBytes = Math.max(sampler.peakSpoolBytes, s.finalBytes);
            return s;
        } finally {
            if (db != null && db.isOpen()) db.close();
            SQLiteDatabase.deleteDatabase(tmpOut);
            SQLiteDatabase.deleteDatabase(finalOut);
            deleteRecursive(tmpDir);
        }
    }

    /**
     * A2 Offline Maintenance Contract on an independent per-round synthetic DB with live uncheckpointed WAL:
     * beginSnapshotFreezeAndDrain -> wal_checkpoint(TRUNCATE) -> close ALL source connections ->
     * verify -wal/-shm absent -> copy stable file -> endSnapshotFreeze -> changePassword(rekey) -> fsync/readback.
     */
    private static BenchSample runA2Offline(
            int messageCount,
            byte[] srcRawKey,
            File workDir,
            KanataM6PortableCatalog catalog,
            KanataM6SnapshotOwner.WriteGate writeGate,
            KanataM6SyntheticDataset.LogicalSummary expectedPhysical,
            boolean deepLogicalVerify,
            File optionalCopyOut,
            int round,
            boolean cold) throws Exception {
        BenchSample s = new BenchSample();
        s.route = "A2";
        s.round = round;
        s.cold = cold;

        File roundSrcDb = new File(workDir, "a2_round_src_" + UUID.randomUUID() + ".db");
        File copyDb = new File(workDir, "a2_copy_" + UUID.randomUUID() + ".db");
        SQLiteDatabase.deleteDatabase(roundSrcDb);
        SQLiteDatabase.deleteDatabase(copyDb);

        // Seed independent per-round synthetic DB with active uncheckpointed WAL BEFORE timed A2 export!
        SQLiteDatabase activeSrcConn = KanataM6SyntheticDataset.populateWithActiveWal(
                roundSrcDb, srcRawKey, catalog, messageCount);
        File srcWal = new File(roundSrcDb.getAbsolutePath() + "-wal");
        File srcShm = new File(roundSrcDb.getAbsolutePath() + "-shm");
        assertTrue("A2 round source must start with active uncheckpointed WAL",
                srcWal.exists() && srcWal.length() > 0L);

        boolean gateReleased = false;
        try (ResourceSampler sampler = new ResourceSampler(
                new File[] { srcWal },
                new File[] { copyDb })) {
            long tStart = SystemClock.elapsedRealtimeNanos();
            // Start write-block timer BEFORE calling beginSnapshotFreezeAndDrain()
            long tBlock0 = SystemClock.elapsedRealtimeNanos();
            writeGate.beginSnapshotFreezeAndDrain(5000L);
            long tAfterDrain = SystemClock.elapsedRealtimeNanos();
            s.freezeDrainMs = (tAfterDrain - tBlock0) / 1_000_000L;

            // Offline maintenance: checkpoint(TRUNCATE) and close ALL source connections before copying
            long tCk0 = SystemClock.elapsedRealtimeNanos();
            try (Cursor ck = activeSrcConn.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) {
                assertTrue(ck.moveToFirst());
                assertEquals(0, ck.getInt(0));
            }
            activeSrcConn.close();
            activeSrcConn = null;
            assertFalse("-wal must not exist after closing all source connections", srcWal.exists());
            assertFalse("-shm must not exist after closing all source connections", srcShm.exists());
            long tAfterClose = SystemClock.elapsedRealtimeNanos();
            s.checkpointCloseMs = (tAfterClose - tCk0) / 1_000_000L;

            long tCopy0 = SystemClock.elapsedRealtimeNanos();
            copyWithSync(roundSrcDb, copyDb, null);
            long tAfterCopy = SystemClock.elapsedRealtimeNanos();
            s.fileCopyMs = (tAfterCopy - tCopy0) / 1_000_000L;

            writeGate.endSnapshotFreeze();
            gateReleased = true;
            s.writeBlockMs = (SystemClock.elapsedRealtimeNanos() - tBlock0) / 1_000_000L;

            s.snapshotPinMs = -1L; // N/A (offline exclusive lock, not online WAL snapshot pin)
            s.dbReadMs = -1L;      // N/A (file-level copy)
            s.spoolWriteMs = -1L;  // N/A (file-level copy accounted in fileCopyMs)
            sampler.sampleOnce();

            long tRekey0 = SystemClock.elapsedRealtimeNanos();
            SQLiteDatabase rk = SQLiteDatabase.openDatabase(
                    copyDb.getAbsolutePath(), srcRawKey, null, FLAGS_RW, (d, e) -> {}, null);
            try {
                rk.changePassword(BACKUP_PW);
            } finally {
                rk.close();
            }
            s.kdfAeadMs = (SystemClock.elapsedRealtimeNanos() - tRekey0) / 1_000_000L;

            long tSync0 = SystemClock.elapsedRealtimeNanos();
            fsyncAndReadbackSha(copyDb);
            s.fsyncReadbackMs = (SystemClock.elapsedRealtimeNanos() - tSync0) / 1_000_000L;
            s.totalMs = (SystemClock.elapsedRealtimeNanos() - tStart) / 1_000_000L;
            s.finalBytes = copyDb.length();
            sampler.sampleOnce();

            if (optionalCopyOut != null) {
                copyWithSync(copyDb, optionalCopyOut, null);
            }

            verifySqliteDbIntegrity(copyDb, BACKUP_PW, null);
            if (deepLogicalVerify) {
                SQLiteDatabase outRo = SQLiteDatabase.openDatabase(
                        copyDb.getAbsolutePath(), BACKUP_PW, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    KanataM6SyntheticDataset.LogicalSummary outSum =
                            KanataM6SyntheticDataset.computeLogicalFingerprint(outRo, catalog, false);
                    assertEquals("A2 logical digest mismatch", expectedPhysical.overallDigestHex, outSum.overallDigestHex);
                    s.logicalVerified = true;
                } finally {
                    outRo.close();
                }
            }

            s.peakRssKiB = sampler.peakRssKiB;
            s.peakNativeHeapBytes = sampler.peakNativeHeapBytes;
            s.peakJavaHeapBytes = sampler.peakJavaHeapBytes;
            s.walPeakBytes = sampler.peakWalBytes;
            s.spoolPeakBytes = Math.max(sampler.peakSpoolBytes, s.finalBytes);
            return s;
        } finally {
            if (!gateReleased) writeGate.endSnapshotFreeze();
            if (activeSrcConn != null && activeSrcConn.isOpen()) activeSrcConn.close();
            SQLiteDatabase.deleteDatabase(roundSrcDb);
            SQLiteDatabase.deleteDatabase(copyDb);
        }
    }

    private static BenchSample runC(
            File srcDb,
            byte[] srcRawKey,
            File workDir,
            File spoolDir,
            KanataM6PortableCatalog catalog,
            KanataM6SnapshotOwner.WriteGate writeGate,
            KanataM6SyntheticDataset.LogicalSummary expectedProjected,
            boolean deepLogicalVerify,
            File optionalCopyOut,
            int round,
            boolean cold) throws Exception {
        BenchSample s = new BenchSample();
        s.route = "C";
        s.round = round;
        s.cold = cold;

        File outPkg = new File(workDir, "scheme_c_" + UUID.randomUUID() + ".kpb1");
        File targetDb = new File(workDir, "scheme_c_target_" + UUID.randomUUID() + ".db");
        byte[] targetKey = randomRawKey();
        File srcWal = new File(srcDb.getAbsolutePath() + "-wal");
        final File[] tmpSpoolRef = new File[1];

        try (ResourceSampler sampler = new ResourceSampler(
                new File[] { srcWal },
                new File[] { outPkg })) {
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(),
                    srcRawKey,
                    BACKUP_PW,
                    catalog,
                    writeGate,
                    spoolDir,
                    outPkg,
                    null,
                    null,
                    new AtomicBoolean(false),
                    new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void onTaskTempFileCreated(String taskId, File tmpSpool) {
                            tmpSpoolRef[0] = tmpSpool;
                        }
                        @Override
                        public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) {
                            sampler.sampleOnce();
                        }
                    });
            sampler.sampleOnce();

            s.totalMs = em.totalMs;
            s.freezeDrainMs = em.freezeDrainMs;
            s.snapshotPinMs = em.snapshotPinMs;
            s.dbReadMs = em.dbReadMs;
            s.kdfAeadMs = em.kdfMs + em.aeadMs;
            s.spoolWriteMs = em.spoolWriteMs;
            s.fsyncReadbackMs = em.fsyncReadbackMs;
            s.finalBytes = em.finalFileBytes;
            s.peakRssKiB = Math.max(sampler.peakRssKiB, em.peakRssKiB);
            s.peakNativeHeapBytes = Math.max(sampler.peakNativeHeapBytes, em.peakNativeHeapBytes);
            s.peakJavaHeapBytes = Math.max(sampler.peakJavaHeapBytes, em.peakJavaHeapBytes);
            s.walPeakBytes = sampler.peakWalBytes;
            s.spoolPeakBytes = Math.max(sampler.peakSpoolBytes, em.spoolPeakBytes);
            s.writeBlockMs = em.writeBlockMs;

            if (optionalCopyOut != null) {
                copyWithSync(outPkg, optionalCopyOut, null);
            }

            if (deepLogicalVerify) {
                try (FileInputStream fis = new FileInputStream(outPkg)) {
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            fis, BACKUP_PW, catalog, workDir, targetDb, targetKey, new AtomicBoolean(false));
                }
                SQLiteDatabase tRo = SQLiteDatabase.openDatabase(
                        targetDb.getAbsolutePath(), targetKey, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    KanataM6SyntheticDataset.LogicalSummary cSum =
                            KanataM6SyntheticDataset.computeLogicalFingerprint(tRo, catalog, true);
                    assertEquals("C logical digest mismatch", expectedProjected.overallDigestHex, cSum.overallDigestHex);
                    s.logicalVerified = true;
                } finally {
                    tRo.close();
                }
            }
            return s;
        } finally {
            Arrays.fill(targetKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(targetDb);
            outPkg.delete();
        }
    }

    private static JSONObject measureCancellationTimes(
            File srcDb,
            byte[] srcRawKey,
            File workDir,
            File spoolDir,
            KanataM6PortableCatalog catalog) throws Exception {
        // 1. Scheme C deterministic mid-stream cancel response time
        AtomicBoolean cFlag = new AtomicBoolean(false);
        CancellationSignal cSig = new CancellationSignal();
        long[] cCancelTriggerNs = new long[] { 0L };
        File cCancelOut = new File(workDir, "c_cancel_" + UUID.randomUUID() + ".kpb1");
        try {
            try {
                KanataM6SchemeCExporter.exportToSpool(
                        srcDb.getAbsolutePath(), srcRawKey, BACKUP_PW, catalog,
                        new KanataM6SnapshotOwner.WriteGate(), spoolDir, cCancelOut,
                        null, cSig, cFlag, new KanataM6SchemeCExporter.SpoolHooks() {
                            @Override
                            public void afterTableRead(int tableId, long rowCount) {
                                if (tableId == 34) {
                                    cCancelTriggerNs[0] = SystemClock.elapsedRealtimeNanos();
                                    cFlag.set(true);
                                    cSig.cancel();
                                }
                            }
                        });
                fail("Expected Scheme C cancel to abort");
            } catch (KanataM6PortableCrypto.PortableException pe) {
                assertEquals(KanataM6PortableCrypto.ERR_CANCELLED, pe.code);
            }
        } finally {
            cCancelOut.delete();
        }
        long cCancelMs = Math.max(0L, (SystemClock.elapsedRealtimeNanos() - cCancelTriggerNs[0]) / 1_000_000L);

        // 2. A1 real sqlcipher_export() mid-operation cancellation test (NOT a SELECT probe!)
        File a1CancelOut = new File(workDir, "a1_cancel_" + UUID.randomUUID() + ".db");
        SQLiteDatabase.deleteDatabase(a1CancelOut);
        CancellationSignal a1Sig = new CancellationSignal();
        boolean a1Interrupted = false;
        long a1WaitAfterCancelMs = -1L;
        ExecutorService a1Exec = Executors.newSingleThreadExecutor();
        try {
            long[] triggerNs = new long[] { 0L };
            java.util.concurrent.CountDownLatch exportStarted = new java.util.concurrent.CountDownLatch(1);
            Future<String> fut = a1Exec.submit(() -> {
                SQLiteDatabase db = SQLiteDatabase.openDatabase(
                        srcDb.getAbsolutePath(), srcRawKey, null, FLAGS_RW, (d, e) -> {}, null);
                try {
                    String escPath = a1CancelOut.getAbsolutePath().replace("'", "''");
                    String escPw = BACKUP_PW.replace("'", "''");
                    db.execSQL("ATTACH DATABASE '" + escPath + "' AS a1_c KEY '" + escPw + "'");
                    exportStarted.countDown();
                    try (Cursor c = db.rawQuery("SELECT sqlcipher_export('a1_c')", null, a1Sig)) {
                        c.moveToFirst();
                    } finally {
                        try { db.execSQL("DETACH DATABASE a1_c"); } catch (Throwable ignored) {}
                    }
                    return "COMPLETED_UNINTERRUPTED";
                } catch (Throwable t) {
                    return "ABORTED:" + t.getClass().getSimpleName();
                } finally {
                    db.close();
                }
            });
            exportStarted.await(5, TimeUnit.SECONDS);
            Thread.sleep(5);
            triggerNs[0] = SystemClock.elapsedRealtimeNanos();
            a1Sig.cancel();
            String a1Outcome = fut.get(30, TimeUnit.SECONDS);
            a1WaitAfterCancelMs = Math.max(0L, (SystemClock.elapsedRealtimeNanos() - triggerNs[0]) / 1_000_000L);
            a1Interrupted = a1Outcome.startsWith("ABORTED:");
        } finally {
            a1Exec.shutdownNow();
            a1Exec.awaitTermination(5, TimeUnit.SECONDS);
            SQLiteDatabase.deleteDatabase(a1CancelOut);
        }

        // 3. A2 real file copy cooperative cancel + explicit rekey limitation
        File a2CancelCopy = new File(workDir, "a2_cancel_copy_" + UUID.randomUUID() + ".db");
        File srcWal = new File(srcDb.getAbsolutePath() + "-wal");
        File a2CopySource = (srcWal.exists() && srcWal.length() > srcDb.length()) ? srcWal : srcDb;
        AtomicBoolean a2CopyStop = new AtomicBoolean(false);
        long a2CopyCancelMs = -1L;
        boolean a2CopyAborted = false;
        ExecutorService a2Exec = Executors.newSingleThreadExecutor();
        try {
            long[] a2TrigNs = new long[] { 0L };
            java.util.concurrent.CountDownLatch copyStarted = new java.util.concurrent.CountDownLatch(1);
            Future<Boolean> fut = a2Exec.submit(() -> {
                try {
                    copyStarted.countDown();
                    copyWithSync(a2CopySource, a2CancelCopy, a2CopyStop);
                    return false;
                } catch (IOException expected) {
                    return "COPY_CANCELLED".equals(expected.getMessage());
                }
            });
            copyStarted.await(5, TimeUnit.SECONDS);
            Thread.sleep(2);
            a2TrigNs[0] = SystemClock.elapsedRealtimeNanos();
            a2CopyStop.set(true);
            a2CopyAborted = fut.get(10, TimeUnit.SECONDS);
            a2CopyCancelMs = Math.max(0L, (SystemClock.elapsedRealtimeNanos() - a2TrigNs[0]) / 1_000_000L);
        } finally {
            a2Exec.shutdownNow();
            a2Exec.awaitTermination(5, TimeUnit.SECONDS);
            SQLiteDatabase.deleteDatabase(a2CancelCopy);
        }

        return new JSONObject()
                .put("C_midStreamCancelSupported", true)
                .put("C_cancelMs", cCancelMs)
                .put("A1_midExportCancelSupported", a1Interrupted)
                .put("A1_waitAfterCancelMs", a1WaitAfterCancelMs)
                .put("A2_fileCopyCancelSupported", a2CopyAborted)
                .put("A2_fileCopyCancelMs", a2CopyCancelMs)
                .put("A2_rekeyCancelSupported", false);
    }

    private JSONObject measureSameScopeSizeComparison(
            File srcDb,
            byte[] srcKey,
            File workDir,
            File spoolDir,
            KanataM6PortableCatalog catalog) throws Exception {
        File cOut = new File(workDir, "same_scope_c_" + UUID.randomUUID() + ".kpb1");
        File sameScopeDb = new File(workDir, "same_scope_db_" + UUID.randomUUID() + ".db");
        File a1Out = new File(workDir, "same_scope_a1_" + UUID.randomUUID() + ".db");
        byte[] tmpKey = randomRawKey();
        try {
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), srcKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, cOut,
                    null, null, new AtomicBoolean(false), null);
            try (FileInputStream in = new FileInputStream(cOut)) {
                KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        in, BACKUP_PW, catalog, workDir, sameScopeDb, tmpKey, new AtomicBoolean(false));
            }
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(
                    sameScopeDb.getAbsolutePath(), tmpKey, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                String escPath = a1Out.getAbsolutePath().replace("'", "''");
                String escPw = BACKUP_PW.replace("'", "''");
                rw.execSQL("ATTACH DATABASE '" + escPath + "' AS ss_exp KEY '" + escPw + "'");
                try {
                    scalar(rw, "SELECT sqlcipher_export('ss_exp')");
                    rw.rawExecSQL("PRAGMA ss_exp.user_version = 5");
                    rw.rawExecSQL("PRAGMA ss_exp.application_id = " + KanataM6PortableCatalog.APPLICATION_ID);
                } finally {
                    rw.execSQL("DETACH DATABASE ss_exp");
                }
            }
            return new JSONObject()
                    .put("sameScope_A1_Bytes", a1Out.length())
                    .put("sameScope_C_Bytes", em.finalFileBytes);
        } finally {
            Arrays.fill(tmpKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(sameScopeDb);
            SQLiteDatabase.deleteDatabase(a1Out);
            cOut.delete();
        }
    }

    private void runScaleBenchmark(int messageCount, boolean exportExtInteropSample) throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_bench_" + messageCount + "_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File srcDb = new File(workDir, "uniform_" + messageCount + ".db");
        byte[] srcKey = randomRawKey();

        try {
            long tGen0 = SystemClock.elapsedRealtimeNanos();
            try (SQLiteDatabase activeWalConn = KanataM6SyntheticDataset.populateWithActiveWal(srcDb, srcKey, catalog, messageCount)) {
                assertNotNull(activeWalConn);
                long genMs = (SystemClock.elapsedRealtimeNanos() - tGen0) / 1_000_000L;
                long initialWalBytes = KanataM6SyntheticDataset.walSizeBytes(srcDb);
                assertTrue("Expected uncheckpointed active WAL > 0", initialWalBytes > 0L);

                KanataM6SyntheticDataset.LogicalSummary physicalSummary;
                KanataM6SyntheticDataset.LogicalSummary projectedSummary;
                SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getAbsolutePath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    physicalSummary = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, false);
                    projectedSummary = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true);
                } finally {
                    ro.close();
                }
                assertEquals(45, physicalSummary.populatedBusinessTableCount);
                assertEquals(5, physicalSummary.populatedDerivedTableCount);
                assertEquals(messageCount, physicalSummary.tableRowCounts.get("messages").longValue());

                KanataM6SnapshotOwner.WriteGate writeGate = new KanataM6SnapshotOwner.WriteGate();
                JSONArray rawSamples = new JSONArray();

                File extSampleC = null;
                File extSampleA1 = null;
                File extSampleA2 = null;
                if (exportExtInteropSample) {
                    File extDir = targetCtx.getExternalFilesDir(null);
                    if (extDir != null) {
                        extSampleC = new File(extDir, "m6_bench_" + messageCount + "_sample.kpb1");
                        extSampleA1 = new File(extDir, "m6_cross_api_a1.db");
                        extSampleA2 = new File(extDir, "m6_cross_api_a2.db");
                    }
                }

                // 1 Independent Cold Run: A1 -> A2 -> C
                rawSamples.put(runA1(srcDb, srcKey, workDir, catalog, physicalSummary, true, extSampleA1, 0, true).toJson());
                rawSamples.put(runA2Offline(messageCount, srcKey, workDir, catalog, writeGate, physicalSummary, true, extSampleA2, 0, true).toJson());
                rawSamples.put(runC(srcDb, srcKey, workDir, spoolDir, catalog, writeGate, projectedSummary, true, extSampleC, 0, true).toJson());

                // 5 Interleaved Rotating Warm Runs
                String[][] schedules = new String[][] {
                        { "A1", "C", "A2" },
                        { "C", "A2", "A1" },
                        { "A2", "A1", "C" },
                        { "A1", "A2", "C" },
                        { "C", "A1", "A2" }
                };
                for (int r = 0; r < schedules.length; r++) {
                    boolean verifyRound = (r == schedules.length - 1);
                    for (String route : schedules[r]) {
                        if ("A1".equals(route)) {
                            rawSamples.put(runA1(srcDb, srcKey, workDir, catalog, physicalSummary, verifyRound, null, r + 1, false).toJson());
                        } else if ("A2".equals(route)) {
                            rawSamples.put(runA2Offline(messageCount, srcKey, workDir, catalog, writeGate, physicalSummary, verifyRound, null, r + 1, false).toJson());
                        } else {
                            rawSamples.put(runC(srcDb, srcKey, workDir, spoolDir, catalog, writeGate, projectedSummary, verifyRound, null, r + 1, false).toJson());
                        }
                    }
                }

                JSONObject cancelMetrics = measureCancellationTimes(srcDb, srcKey, workDir, spoolDir, catalog);
                JSONObject sameScopeSizes = (messageCount <= 10000)
                        ? measureSameScopeSizeComparison(srcDb, srcKey, workDir, spoolDir, catalog)
                        : null;

                SQLiteDatabase roAfter = SQLiteDatabase.openDatabase(srcDb.getAbsolutePath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    KanataM6SyntheticDataset.LogicalSummary after =
                            KanataM6SyntheticDataset.computeLogicalFingerprint(roAfter, catalog, false);
                    assertEquals(physicalSummary.overallDigestHex, after.overallDigestHex);
                } finally {
                    roAfter.close();
                }

                for (int i = 0; i < rawSamples.length(); i++) {
                    Log.i(TAG, "SAMPLE_" + messageCount + "=" + rawSamples.getJSONObject(i).toString());
                }
                Log.i(TAG, "BENCH_SUMMARY_" + messageCount + "=" + new JSONObject()
                        .put("messageCount", messageCount)
                        .put("datasetGenMs", genMs)
                        .put("initialWalBytes", initialWalBytes)
                        .put("srcDbBytes", srcDb.length())
                        .put("physicalOverallSha256", physicalSummary.overallDigestHex)
                        .put("projectedOverallSha256", projectedSummary.overallDigestHex)
                        .put("totalBusinessRows", physicalSummary.totalBusinessRows)
                        .put("sameScopeComparison", sameScopeSizes)
                        .put("extSamplePath", extSampleC != null ? extSampleC.getAbsolutePath() : null)
                        .put("extA1Path", extSampleA1 != null ? extSampleA1.getAbsolutePath() : null)
                        .put("extA2Path", extSampleA2 != null ? extSampleA2.getAbsolutePath() : null)
                        .put("cancel", cancelMetrics));
            }
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void benchmark1kMessages() throws Exception {
        runScaleBenchmark(1000, true);
    }

    @Test
    public void benchmark10kMessages() throws Exception {
        runScaleBenchmark(10000, false);
    }

    @Test
    public void benchmark100kMessages() throws Exception {
        runScaleBenchmark(100000, false);
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
