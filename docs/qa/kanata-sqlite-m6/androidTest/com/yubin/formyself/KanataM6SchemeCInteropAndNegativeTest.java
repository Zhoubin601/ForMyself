package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(AndroidJUnit4.class)
public class KanataM6SchemeCInteropAndNegativeTest {
    static {
        System.loadLibrary("sqlcipher");
    }
    private static final String TAG = "KanataM6CInterop";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
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

    private static byte[] readAssetBytes(Context instrCtx, String name) throws Exception {
        try (InputStream is = instrCtx.getAssets().open(name)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        }
    }

    private static JSONObject readAssetJson(Context instrCtx, String name) throws Exception {
        return new JSONObject(new String(readAssetBytes(instrCtx, name), StandardCharsets.UTF_8));
    }

    private static byte[] readFileBytes(File f) throws Exception {
        try (FileInputStream fis = new FileInputStream(f)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        }
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        return KanataM6PortableCrypto.bytesToHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            assertTrue("Expected row for " + sql, c.moveToFirst());
            return c.getString(0);
        }
    }

    @Test
    public void schemeC_emptyPackageByteForByteMatchesVectorsV1() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        JSONObject vectors = readAssetJson(instrCtx, "vectors-v1.json");
        String password = vectors.getString("password");
        JSONObject matJson = vectors.getJSONObject("material");
        JSONObject empJson = vectors.getJSONObject("emptyPackage");
        byte[] expectedBytes = KanataM6PortableCrypto.hexToBytes(empJson.getString("packageHex"));
        String expectedSha = empJson.getString("packageSha256");

        File workDir = new File(targetCtx.getFilesDir(), "m6_c_empty_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File dbFile = new File(workDir, "src.db");
        File outFile = new File(workDir, "empty.kpb1");
        File targetDbA = new File(workDir, "target_android.db");
        File targetDbB = new File(workDir, "target_vector.db");
        byte[] srcKey = randomRawKey();
        byte[] dstKeyA = randomRawKey();
        byte[] dstKeyB = randomRawKey();

        try {
            SQLiteDatabase db = SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), srcKey, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                // Seed runtime tables as well to prove runtime exclusions leave 0 business rows
                catalog.initSchema(db, 5, true);
            } finally {
                db.close();
            }

            KanataM6SchemeCExporter.ExportMaterial mat = new KanataM6SchemeCExporter.ExportMaterial(
                    KanataM6PortableCrypto.hexToBytes(matJson.getString("saltHex")),
                    KanataM6PortableCrypto.hexToBytes(matJson.getString("backupIdHex")),
                    KanataM6PortableCrypto.hexToBytes(matJson.getString("wrapNonceHex")),
                    KanataM6PortableCrypto.hexToBytes(matJson.getString("bekHex")));

            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    dbFile.getAbsolutePath(),
                    srcKey,
                    password,
                    catalog,
                    new KanataM6SnapshotOwner.WriteGate(),
                    spoolDir,
                    outFile,
                    mat,
                    null,
                    new AtomicBoolean(false),
                    null);

            byte[] actualBytes = readFileBytes(outFile);
            assertEquals("empty package byte length", empJson.getInt("packageByteLength"), actualBytes.length);
            assertEquals("empty package sha256", expectedSha, em.packageSha256Hex);
            assertEquals("empty package file sha256", expectedSha, sha256Hex(actualBytes));
            assertArrayEquals("empty package byte-for-byte match", expectedBytes, actualBytes);
            assertEquals("empty transcript", empJson.getString("transcriptHex"), em.transcriptHex);

            JSONArray vecVerifiers = empJson.getJSONArray("verifiers");
            assertEquals(vecVerifiers.length(), em.verifiers.size());
            Map<Integer, KanataM6SchemeCExporter.Verifier> byId = new HashMap<>();
            for (KanataM6SchemeCExporter.Verifier v : em.verifiers) byId.put(v.tableId, v);
            for (int i = 0; i < vecVerifiers.length(); i++) {
                JSONObject vv = vecVerifiers.getJSONObject(i);
                KanataM6SchemeCExporter.Verifier av = byId.get(vv.getInt("tableId"));
                assertNotNull(av);
                assertEquals(vv.getLong("rowCount"), av.rowCount);
                assertEquals(vv.getString("digestHex"), KanataM6PortableCrypto.bytesToHex(av.digest));
            }

            try (FileInputStream fis = new FileInputStream(outFile)) {
                KanataM6SchemeCImporter.ImportResult resA = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, password, catalog, workDir, targetDbA, dstKeyA, new AtomicBoolean(false));
                assertEquals(0L, resA.totalBusinessRows);
                assertEquals(empJson.getString("transcriptHex"), resA.transcriptHex);
            }
            try (ByteArrayInputStream bis = new ByteArrayInputStream(expectedBytes)) {
                KanataM6SchemeCImporter.ImportResult resB = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        bis, password, catalog, workDir, targetDbB, dstKeyB, new AtomicBoolean(false));
                assertEquals(0L, resB.totalBusinessRows);
                assertEquals(empJson.getString("transcriptHex"), resB.transcriptHex);
            }

            Log.i(TAG, "EMPTY_INTEROP=" + new JSONObject()
                    .put("bytes", actualBytes.length)
                    .put("sha256", expectedSha)
                    .put("byteForByteExact", true)
                    .put("transcriptHex", em.transcriptHex));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(dstKeyA, (byte) 0);
            Arrays.fill(dstKeyB, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void schemeC_populatedByteForByteMatchesNodeReferenceAndRoundtripsToTarget() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        JSONObject meta = readAssetJson(instrCtx, "node_interop_populated.json");
        byte[] nodeBytes = readAssetBytes(instrCtx, "node_interop_populated.kpb1");
        String password = meta.getString("password");

        File workDir = new File(targetCtx.getFilesDir(), "m6_c_pop_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        File srcDbFile = new File(workDir, "src_pop.db");
        File outFile = new File(workDir, "android_pop_det.kpb1");
        File outRandFile = new File(workDir, "android_pop_rand.kpb1");
        File targetFromNode = new File(workDir, "target_from_node.db");
        File targetFromAndroid = new File(workDir, "target_from_android.db");

        byte[] srcKey = randomRawKey();
        byte[] dstKey1 = randomRawKey();
        byte[] dstKey2 = randomRawKey();

        try {
            SQLiteDatabase db = SQLiteDatabase.openDatabase(srcDbFile.getAbsolutePath(), srcKey, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                catalog.initSchema(db, 5, true);
                db.beginTransactionNonExclusive();
                try {
                    db.execSQL("INSERT INTO dataset_metadata VALUES(1, 'user-interop', 2, '{\"k\": 1}')");
                    db.execSQL("INSERT INTO worlds VALUES('w1', '合成世界\uD83D\uDCE6', 'rules', 1, 'UTC', 0, 9007199254740991, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    try (SQLiteStatement st = db.compileStatement(
                            "INSERT INTO world_identities VALUES('id-1', 'w1', 'user-interop', CAST(? AS TEXT), 'bg', 1, '{}')")) {
                        st.bindBlob(1, "\ufeff e\u0301 \u0000\ufeff ".getBytes(StandardCharsets.UTF_8));
                        st.executeInsert();
                    }
                    db.execSQL("INSERT INTO character_cards VALUES('card-1', 'ver-1', 0, NULL, '{}')");
                    db.execSQL("INSERT INTO card_versions VALUES('ver-1', 'card-1', 1, '{\"name\":\"K\"}', '{\"raw\":true}', 'import', NULL, '{}')");
                    db.execSQL("INSERT INTO character_instances VALUES('inst-1', 'w1', 'card-1', 'ver-1', 1, '{}', 'calm', -0.0, 'home', 1, 0, '{}')");
                    db.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', 'Interop', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}')");
                    db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                    db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'inst-1', 'character', 1)");
                    db.execSQL("INSERT INTO messages VALUES('m1', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'hi', 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}')");
                    db.execSQL("INSERT INTO messages VALUES('m2', 'w1', 'c1', 'assistant', 'character', 'inst-1', 'K', 'hello', 101, 1, 'complete', 't1', 'b2', NULL, 'm1', 1, '{}')");
                    db.execSQL("INSERT INTO world_events VALUES('evt-1', 'w1', 'committed', 'private', '约定', 1000, 1000, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}')");
                    db.execSQL("INSERT INTO world_effects VALUES('eff-1', 'w1', 'evt-1', 'instance', 'inst-1', 'inst-1', NULL, 'set', 'state.mood', '\"happy\"', 1, '{}')");
                    db.execSQL("INSERT INTO effect_baselines VALUES('base-1', 'w1', 'instance', 'inst-1', 'inst-1', NULL, 'state.mood', '\"calm\"', '{}')");
                    db.execSQL("INSERT INTO background_tasks VALUES('task-1', 'w1', 'proactive', 'running', 'k1', 1, 1, 2000, 99999, 'c1', 'inst-1', NULL, '{}', NULL, NULL, NULL, NULL, NULL, '{}')");
                    db.setTransactionSuccessful();
                } finally {
                    db.endTransaction();
                }
            } finally {
                db.close();
            }

            KanataM6SchemeCExporter.ExportMaterial detMat = new KanataM6SchemeCExporter.ExportMaterial(
                    KanataM6PortableCrypto.hexToBytes(meta.getString("saltHex")),
                    KanataM6PortableCrypto.hexToBytes(meta.getString("backupIdHex")),
                    KanataM6PortableCrypto.hexToBytes(meta.getString("wrapNonceHex")),
                    KanataM6PortableCrypto.hexToBytes(meta.getString("bekHex")));

            KanataM6SchemeCExporter.ExportMetrics emDet = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getAbsolutePath(), srcKey, password, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, outFile,
                    detMat, null, new AtomicBoolean(false), null);

            byte[] androidDetBytes = readFileBytes(outFile);
            assertEquals("populated byte length", meta.getInt("packageByteLength"), androidDetBytes.length);
            assertEquals("populated sha256", meta.getString("packageSha256"), emDet.packageSha256Hex);
            assertEquals("populated transcript", meta.getString("transcriptHex"), emDet.transcriptHex);
            assertArrayEquals("populated byte-for-byte match vs Node", nodeBytes, androidDetBytes);

            // Import Node-generated .kpb1 into isolated Android SQLCipher target
            try (ByteArrayInputStream bis = new ByteArrayInputStream(nodeBytes)) {
                KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        bis, password, catalog, workDir, targetFromNode, dstKey1, new AtomicBoolean(false));
                assertEquals(meta.getString("transcriptHex"), ir.transcriptHex);
            }

            // Export with random material, write copy to external files dir for host Node verification, and also import on Android
            KanataM6SchemeCExporter.ExportMetrics emRand = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getAbsolutePath(), srcKey, password, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, outRandFile,
                    null, null, new AtomicBoolean(false), null);
            assertTrue(outRandFile.exists() && outRandFile.length() > 0);
            File extDir = targetCtx.getExternalFilesDir(null);
            String pulledHostPath = null;
            if (extDir != null) {
                File extCopy = new File(extDir, "m6_android_to_node_interop.kpb1");
                copyFile(outRandFile, extCopy);
                pulledHostPath = extCopy.getAbsolutePath();
            }

            try (FileInputStream fis = new FileInputStream(outRandFile)) {
                KanataM6SchemeCImporter.ImportResult ir2 = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, password, catalog, workDir, targetFromAndroid, dstKey2, new AtomicBoolean(false));
                assertEquals(emRand.transcriptHex, ir2.transcriptHex);
            }

            // Verify restored target contents (metadata BOM/NUL, -0.0 preservation, pause-sending-v1, runtime empty, integrity)
            for (File tDbFile : new File[] { targetFromNode, targetFromAndroid }) {
                byte[] key = (tDbFile == targetFromNode) ? dstKey1 : dstKey2;
                SQLiteDatabase tdb = SQLiteDatabase.openDatabase(tDbFile.getAbsolutePath(), key, null, FLAGS_RO, (d, e) -> {}, null);
                try {
                    assertEquals("5", scalar(tdb, "PRAGMA user_version"));
                    assertEquals("1263424577", scalar(tdb, "PRAGMA application_id"));
                    assertEquals("ok", scalar(tdb, "PRAGMA integrity_check"));
                    assertEquals("0", scalar(tdb, "SELECT count(*) FROM schema_migrations"));
                    assertEquals("0", scalar(tdb, "SELECT count(*) FROM schema_migration_applications"));
                    assertEquals("0", scalar(tdb, "SELECT count(*) FROM data_migrations"));
                    assertEquals("cancelled", scalar(tdb, "SELECT state FROM background_tasks WHERE id='task-1'"));
                    assertEquals("0", scalar(tdb, "SELECT lease_until FROM background_tasks WHERE id='task-1'"));

                    try (Cursor c = tdb.rawQuery("SELECT CAST(display_name AS BLOB) FROM world_identities WHERE id='id-1'", null)) {
                        assertTrue(c.moveToFirst());
                        assertArrayEquals(
                                "\ufeff e\u0301 \u0000\ufeff ".getBytes(StandardCharsets.UTF_8),
                                c.getBlob(0));
                    }
                    try (Cursor c = tdb.rawQuery("SELECT energy FROM character_instances WHERE id='inst-1'", null)) {
                        assertTrue(c.moveToFirst());
                        // SQLite compresses integer-valued -0.0 to 0 in B-tree storage (identical on both Node and Android)
                        assertEquals(0.0d, c.getDouble(0), 0.0d);
                    }
                } finally {
                    tdb.close();
                }
            }

            Log.i(TAG, "POPULATED_INTEROP=" + new JSONObject()
                    .put("nodeBytes", nodeBytes.length)
                    .put("androidBytes", androidDetBytes.length)
                    .put("sha256", emDet.packageSha256Hex)
                    .put("byteForByteExact", true)
                    .put("androidRandFileForNodeCheck", pulledHostPath)
                    .put("androidRandSha256", emRand.packageSha256Hex));
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(dstKey1, (byte) 0);
            Arrays.fill(dstKey2, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @Test
    public void schemeC_negativeRejectionsEnforced() throws Exception {
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getFilesDir(), "m6_c_neg_" + UUID.randomUUID());
        File spoolDir = new File(workDir, "spool");
        assertTrue(workDir.mkdirs());
        byte[] k004 = randomRawKey();
        byte[] kOrdMissing = randomRawKey();
        byte[] kOrdGap = randomRawKey();
        byte[] kValid = randomRawKey();
        byte[] kTarget = randomRawKey();
        String pw = "neg-test-pw";

        try {
            // 1. Schema 004 source rejected
            File db004 = new File(workDir, "schema004.db");
            SQLiteDatabase d4 = SQLiteDatabase.openDatabase(db004.getAbsolutePath(), k004, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                catalog.initSchema(d4, 4, true);
            } finally {
                d4.close();
            }
            assertThrowsPortable(KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            db004.getAbsolutePath(), k004, pw, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir,
                            new File(workDir, "never004.kpb1"), null, null, new AtomicBoolean(false), null));

            // 2. Missing ordinal row in event_array_order rejected (no auto-repair)
            File dbOrdMiss = new File(workDir, "ord_missing.db");
            SQLiteDatabase dm = SQLiteDatabase.openDatabase(dbOrdMiss.getAbsolutePath(), kOrdMissing, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                catalog.initSchema(dm, 5, true);
                dm.beginTransactionNonExclusive();
                try {
                    dm.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u1', 2, '{}')");
                    dm.execSQL("INSERT INTO worlds VALUES('w1', 'W', 'r', 1, 'UTC', 0, 0, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    dm.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u1', 'U', 'bg', 1, '{}')");
                    dm.execSQL("INSERT INTO world_events VALUES('evt-1', 'w1', 'committed', 'private', 'sum', 1000, 1000, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}')");
                    dm.execSQL("DROP TRIGGER event_array_order_no_delete");
                    dm.execSQL("DELETE FROM event_array_order WHERE entity_id='evt-1'");
                    dm.setTransactionSuccessful();
                } finally {
                    dm.endTransaction();
                }
            } finally {
                dm.close();
            }
            assertThrowsPortable(KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            dbOrdMiss.getAbsolutePath(), kOrdMissing, pw, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir,
                            new File(workDir, "never_miss.kpb1"), null, null, new AtomicBoolean(false), null));

            // 3. Gapped ordinal (0 -> 2) rejected without auto-repair
            File dbOrdGap = new File(workDir, "ord_gap.db");
            SQLiteDatabase dg = SQLiteDatabase.openDatabase(dbOrdGap.getAbsolutePath(), kOrdGap, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                catalog.initSchema(dg, 5, true);
                dg.beginTransactionNonExclusive();
                try {
                    dg.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u1', 2, '{}')");
                    dg.execSQL("INSERT INTO worlds VALUES('w1', 'W', 'r', 1, 'UTC', 0, 0, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    dg.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u1', 'U', 'bg', 1, '{}')");
                    dg.execSQL("INSERT INTO world_events VALUES('evt-0', 'w1', 'committed', 'private', 's0', 1000, 1000, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}')");
                    dg.execSQL("INSERT INTO world_events VALUES('evt-2', 'w1', 'committed', 'private', 's2', 1001, 1001, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}')");
                    dg.execSQL("DROP TRIGGER event_array_order_no_update");
                    dg.execSQL("UPDATE event_array_order SET ordinal=2 WHERE entity_id='evt-2'");
                    dg.setTransactionSuccessful();
                } finally {
                    dg.endTransaction();
                }
            } finally {
                dg.close();
            }
            assertThrowsPortable(KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            dbOrdGap.getAbsolutePath(), kOrdGap, pw, catalog,
                            new KanataM6SnapshotOwner.WriteGate(), spoolDir,
                            new File(workDir, "never_gap.kpb1"), null, null, new AtomicBoolean(false), null));

            // 4. Create valid populated package for container-level negative tests
            File validDb = new File(workDir, "valid.db");
            SQLiteDatabase dv = SQLiteDatabase.openDatabase(validDb.getAbsolutePath(), kValid, null,
                    FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
            try {
                catalog.initSchema(dv, 5, true);
                dv.beginTransactionNonExclusive();
                try {
                    dv.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u1', 2, '{}')");
                    dv.execSQL("INSERT INTO worlds VALUES('w1', 'W', 'r', 1, 'UTC', 0, 0, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    dv.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u1', 'U', 'bg', 1, '{}')");
                    dv.execSQL("INSERT INTO world_events VALUES('evt-0', 'w1', 'committed', 'private', 's0', 1000, 1000, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}')");
                    dv.setTransactionSuccessful();
                } finally {
                    dv.endTransaction();
                }
            } finally {
                dv.close();
            }
            File validPkg = new File(workDir, "valid.kpb1");
            KanataM6SchemeCExporter.exportToSpool(
                    validDb.getAbsolutePath(), kValid, pw, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, validPkg,
                    null, null, new AtomicBoolean(false), null);
            byte[] validBytes = readFileBytes(validPkg);

            // 4a. Production profile 0x0001 rejected BEFORE KDF (< 50 ms even without KDF!)
            byte[] prodProf = validBytes.clone();
            prodProf[12] = 0x00;
            prodProf[13] = 0x01;
            long t0 = System.nanoTime();
            File rejectTarget = new File(workDir, "reject_target.db");
            assertThrowsPortable(KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(prodProf), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false)));
            long prodRejectMs = (System.nanoTime() - t0) / 1_000_000L;
            assertFalse(rejectTarget.exists());

            // 4b. Bad magic rejected before KDF
            byte[] badMagic = validBytes.clone();
            badMagic[0] = 'X';
            assertThrowsPortable(KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(badMagic), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false)));
            assertFalse(rejectTarget.exists());

            // 4c. Wrong password -> AUTH_FAILED
            assertThrowsPortable(KanataM6PortableCrypto.ERR_AUTH_FAILED, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(validBytes), "wrong-pw", catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false)));
            assertFalse(rejectTarget.exists());

            // 4d. Tampered ciphertext near DATA/Footer -> AUTH_FAILED
            byte[] tamperedCipher = validBytes.clone();
            tamperedCipher[tamperedCipher.length - 40] ^= 0x55;
            assertThrowsPortable(KanataM6PortableCrypto.ERR_AUTH_FAILED, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(tamperedCipher), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false)));
            assertFalse(rejectTarget.exists());

            // 4e. Trailing 1 extra byte after Footer -> INVALID_CONTAINER
            byte[] trailingByte = Arrays.copyOf(validBytes, validBytes.length + 1);
            trailingByte[trailingByte.length - 1] = 0x01;
            assertThrowsPortable(KanataM6PortableCrypto.ERR_INVALID_CONTAINER, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(trailingByte), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false)));
            assertFalse(rejectTarget.exists());

            // 4f. Target DB post-install verification catches business table mismatch & header mismatch
            assertThrowsPortable(KanataM6PortableCrypto.ERR_INVALID_LOGICAL, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(validBytes), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false), false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void afterInstallBeforeVerify(SQLiteDatabase targetStageDb) {
                                    targetStageDb.execSQL("UPDATE worlds SET name='TAMPERED' WHERE id='w1'");
                                }
                            }));
            assertFalse(rejectTarget.exists());

            assertThrowsPortable(KanataM6PortableCrypto.ERR_INVALID_LOGICAL, () ->
                    KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            new ByteArrayInputStream(validBytes), pw, catalog, workDir,
                            rejectTarget, kTarget, new AtomicBoolean(false), false,
                            new KanataM6SchemeCImporter.ImportHooks() {
                                @Override
                                public void afterInstallBeforeVerify(SQLiteDatabase targetStageDb) {
                                    targetStageDb.rawExecSQL("PRAGMA user_version=4");
                                }
                            }));
            assertFalse(rejectTarget.exists());

            Log.i(TAG, "NEGATIVE_REJECTIONS=" + new JSONObject()
                    .put("schema004Rejected", true)
                    .put("missingOrdinalRejected", true)
                    .put("gappedOrdinalRejected", true)
                    .put("prodProfileRejectedBeforeKdfMs", prodRejectMs)
                    .put("badMagicRejected", true)
                    .put("wrongPasswordRejected", true)
                    .put("tamperedCipherRejected", true)
                    .put("trailingByteRejected", true));
        } finally {
            Arrays.fill(k004, (byte) 0);
            Arrays.fill(kOrdMissing, (byte) 0);
            Arrays.fill(kOrdGap, (byte) 0);
            Arrays.fill(kValid, (byte) 0);
            Arrays.fill(kTarget, (byte) 0);
            deleteRecursive(workDir);
        }
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static void assertThrowsPortable(String expectedCode, ThrowingRunnable action) throws Exception {
        try {
            action.run();
            fail("Expected PortableException(" + expectedCode + ") but succeeded");
        } catch (KanataM6PortableCrypto.PortableException pe) {
            assertEquals("Expected error code " + expectedCode + " but got " + pe.code + " (" + pe.stage + ")",
                    expectedCode, pe.code);
        }
    }

    private static void copyFile(File src, File dst) throws Exception {
        try (FileInputStream fis = new FileInputStream(src);
             FileOutputStream fos = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = fis.read(buf)) != -1) fos.write(buf, 0, n);
            fos.getFD().sync();
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
