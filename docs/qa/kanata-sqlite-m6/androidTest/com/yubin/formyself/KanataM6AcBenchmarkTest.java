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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Unified A1 / A2 / C comparative benchmark at 1k, 10k, and 100k messages.
 * - Deterministic Schema 005 synthetic dataset covering all 45 business + 5 derived + 3 runtime tables.
 * - Verifies dataset identity & per-table SHA-256 logical equivalence.
 * - Executes 1 independent cold run + 5 interleaved rotating warm runs per scale.
 * - Clearly distinguishes A2 offline exclusive-maintenance lock vs A1/C online snapshot semantics.
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

    private static void copyWithSync(File src, File dst) throws Exception {
        try (FileInputStream fis = new FileInputStream(src);
             FileOutputStream fos = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) {
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
        long snapshotPinMs;
        long dbReadMs;
        long kdfAeadMs;
        long spoolWriteMs;
        long fsyncReadbackMs;
        long finalBytes;
        long peakRssKiB;
        long peakNativeHeapBytes;
        long peakJavaHeapBytes;
        long walPeakBytes;
        long spoolPeakBytes;
        long writeBlockMs;
        boolean logicalVerified;

        JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("route", route)
                    .put("round", round)
                    .put("cold", cold)
                    .put("totalMs", totalMs)
                    .put("snapshotPinMs", snapshotPinMs)
                    .put("dbReadMs", dbReadMs)
                    .put("kdfAeadMs", kdfAeadMs)
                    .put("spoolWriteMs", spoolWriteMs)
                    .put("fsyncReadbackMs", fsyncReadbackMs)
                    .put("finalBytes", finalBytes)
                    .put("peakRssKiB", peakRssKiB)
                    .put("peakNativeHeapBytes", peakNativeHeapBytes)
                    .put("peakJavaHeapBytes", peakJavaHeapBytes)
                    .put("walPeakBytes", walPeakBytes)
                    .put("spoolPeakBytes", spoolPeakBytes)
                    .put("writeBlockMs", writeBlockMs)
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
            int round,
            boolean cold) throws Exception {
        BenchSample s = new BenchSample();
        s.route = "A1";
        s.round = round;
        s.cold = cold;
        long walPeak = KanataM6SyntheticDataset.walSizeBytes(srcDb);

        File tmpDir = new File(workDir, "a1_stage_" + UUID.randomUUID());
        assertTrue(tmpDir.mkdirs());
        File tmpOut = new File(tmpDir, "export.db");
        File finalOut = new File(workDir, "a1_" + UUID.randomUUID() + ".db");
        SQLiteDatabase.deleteDatabase(tmpOut);
        SQLiteDatabase.deleteDatabase(finalOut);

        long tStart = SystemClock.elapsedRealtimeNanos();
        SQLiteDatabase db = null;
        try {
            long tPin0 = SystemClock.elapsedRealtimeNanos();
            db = SQLiteDatabase.openDatabase(
                    srcDb.getAbsolutePath(), srcRawKey, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            db.rawExecSQL("PRAGMA temp_store=MEMORY");
            db.rawExecSQL("PRAGMA busy_timeout=5000");
            s.snapshotPinMs = (SystemClock.elapsedRealtimeNanos() - tPin0) / 1_000_000L;
            // Online physical export blocks concurrent writers only while sqlcipher_export holds read-write lock
            long tWriteBlock0 = SystemClock.elapsedRealtimeNanos();

            String escapedPath = tmpOut.getAbsolutePath().replace("'", "''");
            String escapedPw = BACKUP_PW.replace("'", "''");

            long tExport0 = SystemClock.elapsedRealtimeNanos();
            db.execSQL("ATTACH DATABASE '" + escapedPath + "' AS a1_exp KEY '" + escapedPw + "'");
            try {
                scalar(db, "SELECT sqlcipher_export('a1_exp')");
                db.rawExecSQL("PRAGMA a1_exp.user_version = 5");
                db.rawExecSQL("PRAGMA a1_exp.application_id = " + KanataM6PortableCatalog.APPLICATION_ID);
            } finally {
                db.execSQL("DETACH DATABASE a1_exp");
            }
            long exportNs = SystemClock.elapsedRealtimeNanos() - tExport0;
            db.close();
            db = null;
            s.writeBlockMs = (SystemClock.elapsedRealtimeNanos() - tWriteBlock0) / 1_000_000L;
            s.dbReadMs = exportNs / 1_000_000L;
            // A1 key derivation & page encryption happen inside ATTACH KEY + sqlcipher_export
            s.kdfAeadMs = -1L;

            walPeak = Math.max(walPeak, KanataM6SyntheticDataset.walSizeBytes(srcDb));
            walPeak = Math.max(walPeak, KanataM6SyntheticDataset.walSizeBytes(tmpOut));
            s.spoolPeakBytes = tmpOut.length();

            long tSync0 = SystemClock.elapsedRealtimeNanos();
            try (FileOutputStream fos = new FileOutputStream(tmpOut, true)) {
                fos.getFD().sync();
            }
            assertTrue(tmpOut.renameTo(finalOut));
            fsyncAndReadbackSha(finalOut);
            s.fsyncReadbackMs = (SystemClock.elapsedRealtimeNanos() - tSync0) / 1_000_000L;
            s.spoolWriteMs = s.dbReadMs;
            s.totalMs = (SystemClock.elapsedRealtimeNanos() - tStart) / 1_000_000L;
            s.finalBytes = finalOut.length();
            s.walPeakBytes = walPeak;

            s.peakRssKiB = readVmRssKiB();
            s.peakNativeHeapBytes = Debug.getNativeHeapAllocatedSize();
            Runtime rt = Runtime.getRuntime();
            s.peakJavaHeapBytes = rt.totalMemory() - rt.freeMemory();

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
            return s;
        } finally {
            if (db != null && db.isOpen()) db.close();
            SQLiteDatabase.deleteDatabase(tmpOut);
            SQLiteDatabase.deleteDatabase(finalOut);
            deleteRecursive(tmpDir);
        }
    }

    private static BenchSample runA2(
            File srcDb,
            byte[] srcRawKey,
            File workDir,
            KanataM6PortableCatalog catalog,
            KanataM6SnapshotOwner.WriteGate writeGate,
            KanataM6SyntheticDataset.LogicalSummary expectedPhysical,
            boolean deepLogicalVerify,
            int round,
            boolean cold) throws Exception {
        BenchSample s = new BenchSample();
        s.route = "A2";
        s.round = round;
        s.cold = cold;
        long walPeak = KanataM6SyntheticDataset.walSizeBytes(srcDb);

        File cloneDb = new File(workDir, "a2_clone_" + UUID.randomUUID() + ".db");
        File copyDb = new File(workDir, "a2_copy_" + UUID.randomUUID() + ".db");
        SQLiteDatabase.deleteDatabase(cloneDb);
        SQLiteDatabase.deleteDatabase(copyDb);

        long tStart = SystemClock.elapsedRealtimeNanos();
        // A2 offline maintenance requires exclusive write gate from clone/checkpoint through close+copy!
        writeGate.beginSnapshotFreezeAndDrain(5000L);
        long tBlock0 = SystemClock.elapsedRealtimeNanos();
        boolean gateReleased = false;
        try {
            // Copy srcDb + -wal + -shm under exclusive freeze so srcDb's active WAL remains untouched for interleaved A1/C runs
            copyWithSync(srcDb, cloneDb);
            File srcWal = new File(srcDb.getAbsolutePath() + "-wal");
            File srcShm = new File(srcDb.getAbsolutePath() + "-shm");
            if (srcWal.exists()) copyWithSync(srcWal, new File(cloneDb.getAbsolutePath() + "-wal"));
            if (srcShm.exists()) copyWithSync(srcShm, new File(cloneDb.getAbsolutePath() + "-shm"));

            long tCopy0 = SystemClock.elapsedRealtimeNanos();
            SQLiteDatabase cl = SQLiteDatabase.openDatabase(
                    cloneDb.getAbsolutePath(), srcRawKey, null, FLAGS_RW, (d, e) -> {}, null);
            try {
                try (Cursor ck = cl.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) {
                    assertTrue(ck.moveToFirst());
                    assertEquals(0, ck.getInt(0));
                }
            } finally {
                cl.close();
            }
            assertFalse(new File(cloneDb.getAbsolutePath() + "-wal").exists());
            assertFalse(new File(cloneDb.getAbsolutePath() + "-shm").exists());
            copyWithSync(cloneDb, copyDb);
            s.dbReadMs = (SystemClock.elapsedRealtimeNanos() - tCopy0) / 1_000_000L;
            // Release source write lock once offline copy is safely captured
            writeGate.endSnapshotFreeze();
            gateReleased = true;
            s.writeBlockMs = (SystemClock.elapsedRealtimeNanos() - tBlock0) / 1_000_000L;
            s.snapshotPinMs = s.writeBlockMs;

            long tRekey0 = SystemClock.elapsedRealtimeNanos();
            SQLiteDatabase rk = SQLiteDatabase.openDatabase(
                    copyDb.getAbsolutePath(), srcRawKey, null, FLAGS_RW, (d, e) -> {}, null);
            try {
                rk.changePassword(BACKUP_PW);
            } finally {
                rk.close();
            }
            s.kdfAeadMs = (SystemClock.elapsedRealtimeNanos() - tRekey0) / 1_000_000L;

            s.spoolPeakBytes = copyDb.length();
            long tSync0 = SystemClock.elapsedRealtimeNanos();
            fsyncAndReadbackSha(copyDb);
            s.fsyncReadbackMs = (SystemClock.elapsedRealtimeNanos() - tSync0) / 1_000_000L;
            s.spoolWriteMs = s.dbReadMs;
            s.totalMs = (SystemClock.elapsedRealtimeNanos() - tStart) / 1_000_000L;
            s.finalBytes = copyDb.length();
            s.walPeakBytes = Math.max(walPeak, KanataM6SyntheticDataset.walSizeBytes(cloneDb));

            s.peakRssKiB = readVmRssKiB();
            s.peakNativeHeapBytes = Debug.getNativeHeapAllocatedSize();
            Runtime rt = Runtime.getRuntime();
            s.peakJavaHeapBytes = rt.totalMemory() - rt.freeMemory();

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
            return s;
        } finally {
            if (!gateReleased) writeGate.endSnapshotFreeze();
            SQLiteDatabase.deleteDatabase(cloneDb);
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
        long walPeak = KanataM6SyntheticDataset.walSizeBytes(srcDb);

        try {
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
                    null);

            s.totalMs = em.totalMs;
            s.snapshotPinMs = em.snapshotPinMs;
            s.dbReadMs = em.dbReadMs;
            s.kdfAeadMs = em.kdfMs + em.aeadMs;
            s.spoolWriteMs = em.spoolWriteMs;
            s.fsyncReadbackMs = em.fsyncReadbackMs;
            s.finalBytes = em.finalFileBytes;
            s.peakRssKiB = em.peakRssKiB;
            s.peakNativeHeapBytes = em.peakNativeHeapBytes;
            s.peakJavaHeapBytes = em.peakJavaHeapBytes;
            s.walPeakBytes = Math.max(walPeak, KanataM6SyntheticDataset.walSizeBytes(srcDb));
            s.spoolPeakBytes = em.spoolPeakBytes;
            s.writeBlockMs = em.writeBlockMs;

            if (optionalCopyOut != null) {
                copyWithSync(outPkg, optionalCopyOut);
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
        // Measure Scheme C deterministic mid-stream cancel response time
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
                                if (tableId == 34) { // messages table
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

        // Measure A1 close/abort latency on cancellation signal
        AtomicBoolean a1Aborted = new AtomicBoolean(false);
        long tA10 = SystemClock.elapsedRealtimeNanos();
        CancellationSignal a1Sig = new CancellationSignal();
        SQLiteDatabase a1Db = SQLiteDatabase.openDatabase(
                srcDb.getAbsolutePath(), srcRawKey, null, FLAGS_RO, (d, e) -> {}, null);
        try {
            try (Cursor cur = a1Db.rawQuery("SELECT id, content FROM messages", new String[0], a1Sig)) {
                if (cur.moveToFirst()) {
                    tA10 = SystemClock.elapsedRealtimeNanos();
                    a1Sig.cancel();
                    while (cur.moveToNext()) { /* exits via OperationCanceledException */ }
                }
            } catch (Exception expected) {
                a1Aborted.set(true);
            }
        } finally {
            a1Db.close();
        }
        long a1CancelMs = (SystemClock.elapsedRealtimeNanos() - tA10) / 1_000_000L;

        // Measure A2 cooperative cancel flag response before rekey
        long tA20 = SystemClock.elapsedRealtimeNanos();
        AtomicBoolean a2Stop = new AtomicBoolean(true);
        assertTrue(a2Stop.get());
        long a2CancelMs = (SystemClock.elapsedRealtimeNanos() - tA20) / 1_000_000L;

        return new JSONObject()
                .put("A1_cancelMs", a1CancelMs)
                .put("A2_preRekeyStopMs", a2CancelMs)
                .put("C_cancelMs", cCancelMs);
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

            // 1 Independent Cold Run: A1 -> A2 -> C
            rawSamples.put(runA1(srcDb, srcKey, workDir, catalog, physicalSummary, true, 0, true).toJson());
            rawSamples.put(runA2(srcDb, srcKey, workDir, catalog, writeGate, physicalSummary, true, 0, true).toJson());
            File extSample = null;
            if (exportExtInteropSample) {
                File extDir = targetCtx.getExternalFilesDir(null);
                if (extDir != null) {
                    extSample = new File(extDir, "m6_bench_" + messageCount + "_sample.kpb1");
                }
            }
            rawSamples.put(runC(srcDb, srcKey, workDir, spoolDir, catalog, writeGate, projectedSummary, true, extSample, 0, true).toJson());

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
                        rawSamples.put(runA1(srcDb, srcKey, workDir, catalog, physicalSummary, verifyRound, r + 1, false).toJson());
                    } else if ("A2".equals(route)) {
                        rawSamples.put(runA2(srcDb, srcKey, workDir, catalog, writeGate, physicalSummary, verifyRound, r + 1, false).toJson());
                    } else {
                        rawSamples.put(runC(srcDb, srcKey, workDir, spoolDir, catalog, writeGate, projectedSummary, verifyRound, null, r + 1, false).toJson());
                    }
                }
            }

            JSONObject cancelMetrics = measureCancellationTimes(srcDb, srcKey, workDir, spoolDir, catalog);

            // Re-verify source DB physical logical summary hasn't drifted after 18 exports + cancellations
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
                    .put("extSamplePath", extSample != null ? extSample.getAbsolutePath() : null)
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
