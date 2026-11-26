package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * M6-03 Work Package B: 1k / 10k / 100k SQLCipher Temporary Staging Restore Capacity Benchmark.
 * Enforces ALL frozen M6-01/M6-02 limits and Android 512 MiB RSS ceiling.
 * Records: totalRestoreMs, decodeMs, stagingInstallMs, verifyMs, batchCount, maxBatchRows,
 * maxBatchMs, medianBatchMs, stagingDbBytes, peakRssKiB, peakJavaHeapBytes, peakNativeHeapBytes, webViewRssKiB.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM603CapacityBenchmarkTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM603Bench";
    private static final String BACKUP_PW = "m603-bench-合成📦-pw-v1";
    private static final long ANDROID_RSS_CEILING_KIB = 512L * 1024L;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
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

    private void runScale(int scale) throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m603_bench_" + scale + "_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        File stagingDir = new File(workDir, "staging");
        assertTrue(workDir.mkdirs() && spoolDir.mkdirs() && stagingDir.mkdirs());

        File srcDb = new File(workDir, "src_" + scale + ".db");
        File kpb1File = new File(workDir, "pkg_" + scale + ".kpb1");
        File activeDb = new File(workDir, "active_" + scale + ".db");
        byte[] srcKey = randomRawKey();
        byte[] targetKey = randomRawKey();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, srcKey, catalog, scale);
            String expectedProjected;
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(srcDb.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                expectedProjected = KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex;
            }
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getPath(), srcKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, kpb1File,
                    null, null, new AtomicBoolean(false), null, "m603-bench-exp-" + scale);

            // Free source DB before measuring restore memory footprint
            SQLiteDatabase.deleteDatabase(srcDb);

            KanataM6StagingRestoreEngine.PreparedStagingArtifact staged =
                    KanataM6StagingRestoreEngine.prepareStagingFromFile(
                            kpb1File, BACKUP_PW, catalog, workDir, stagingDir,
                            targetKey, null, KanataM6StagingRestoreEngine.DEFAULT_BATCH_SIZE,
                            new AtomicBoolean(false), null, "m603-bench-rst-" + scale);

            assertEquals(50, staged.footerVerifiers.size());
            assertEquals((long) scale, staged.messageCount);
            assertTrue("maxBatchRows must stay <= 500", staged.metrics.maxBatchRows <= KanataM6StagingRestoreEngine.DEFAULT_BATCH_SIZE);
            assertTrue("Android peak RSS must stay below 512 MiB (" + staged.metrics.peakRssKiB + " KiB)",
                    staged.metrics.peakRssKiB < ANDROID_RSS_CEILING_KIB);

            // Complete atomic switch to activeDb and verify projected fingerprint
            KanataM6StagingRestoreEngine.applyVerifiedGeneration(
                    staged.stagingDbFile, staged.stagingSha256Hex, false,
                    activeDb, targetKey, "m603-bench-rst-" + scale, new AtomicBoolean(false), null);
            try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(activeDb.getPath(), targetKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(expectedProjected,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(ro, catalog, true).overallDigestHex);
            }

            JSONObject record = staged.metrics.toJson()
                    .put("scale", scale)
                    .put("kpb1FileBytes", em.finalFileBytes)
                    .put("datasetIdentity", staged.datasetIdentity)
                    .put("verified50Tables", true);
            Log.i(TAG, "M603_RESTORE_BENCH_" + scale + "=" + record);
            staged.destroyStaging();
        } finally {
            KanataM6PortableCrypto.zeroize(srcKey, targetKey);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void bench_01_restore_1k_messages() throws Exception {
        runScale(1_000);
    }

    @Test
    public void bench_02_restore_10k_messages() throws Exception {
        runScale(10_000);
    }

    @Test
    public void bench_03_restore_100k_messages() throws Exception {
        runScale(100_000);
    }
}
