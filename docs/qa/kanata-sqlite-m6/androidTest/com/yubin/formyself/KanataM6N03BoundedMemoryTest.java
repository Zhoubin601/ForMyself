package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.os.Debug;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class KanataM6N03BoundedMemoryTest {
    private static final String TAG = "KanataM6N03";
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

    private static long readProcStatusKiB(String prefix) {
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/status"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith(prefix)) {
                    return Long.parseLong(line.trim().split("\\s+")[1]);
                }
            }
        } catch (Exception ignored) {}
        return -1L;
    }

    private static String repeatChar(char c, int count) {
        char[] arr = new char[count];
        Arrays.fill(arr, c);
        return new String(arr);
    }

    private static String makeJsonWithPayload(String prefix, int targetUtf8Bytes, String suffix) {
        String head = "{\"p\":\"" + prefix + "\",\"b\":\"";
        String tail = suffix + "\"}";
        int headLen = head.getBytes(StandardCharsets.UTF_8).length;
        int tailLen = tail.getBytes(StandardCharsets.UTF_8).length;
        int fill = Math.max(0, targetUtf8Bytes - headLen - tailLen);
        return head + repeatChar('A', fill) + tail;
    }

    @Test
    public void probeCursorWindowLongFieldsAndPreAllocRejection() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        assertEquals("com.yubin.formyself.m2qa", targetCtx.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);
        System.loadLibrary("sqlcipher");

        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);
        File dir = new File(targetCtx.getCacheDir(), "m6-n03-cw-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File dbFile = new File(dir, "src.db");
        File overTextDbFile = new File(dir, "over_text.db");
        File overRowDbFile = new File(dir, "over_row.db");
        File spoolDir = new File(dir, "spool");
        File outKpb = new File(dir, "n03_long.kpb1");
        File targetDbFile = new File(dir, "target.db");

        byte[] rawKey = randomRawKey();
        byte[] targetKey = randomRawKey();

        try {
            JSONObject cwReport = new JSONObject();

            // Build strings at exact boundaries:
            // - 262144 & 262145 UTF-16 code units
            // - 2 MiB (2,097,152 B) exact UTF-8 field
            // - Chinese, astral emoji, NFD, NUL, BOM, Base64, Card & Audit JSON
            String edgePrefix = "合成📦e\u0301\u0000\ufeff";
            String edge262144 = edgePrefix + repeatChar('X', 262144 - edgePrefix.length());
            assertEquals(262144, edge262144.length());
            String edge262145 = edgePrefix + repeatChar('Y', 262145 - edgePrefix.length());
            assertEquals(262145, edge262145.length());

            // Exact 2,097,152 B (2 MiB) UTF-8 string containing Chinese + astral + NUL + BOM + Base64
            String prefix2M = "\ufeff合成📦\u0000BASE64:";
            int prefix2MBytes = prefix2M.getBytes(StandardCharsets.UTF_8).length;
            String exact2MiBText = prefix2M + repeatChar('B', KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES - prefix2MBytes);
            assertEquals(KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES, exact2MiBText.getBytes(StandardCharsets.UTF_8).length);

            // Composite large row in card_versions:
            // definition_json (~1.95 MiB) + raw_data_json (~1.95 MiB) -> total row body ~3.90 MiB (< 4 MiB, > 2 MiB CursorWindow!)
            String bigCardDef = makeJsonWithPayload("card-def-\ufeff📦", 1_950_000, "end");
            String bigCardRaw = makeJsonWithPayload("card-raw-合成", 1_950_000, "end");
            // Audit JSON (~1.90 MiB each -> ~3.80 MiB composite row in message_audits)
            String auditPrev = "{\"id\":\"m-262145\",\"worldId\":\"w1\",\"conversationId\":\"c1\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":101,\"revision\":1,\"senderNameSnapshot\":\"u\",\"status\":\"complete\",\"content\":\""
                    + repeatChar('P', 1_800_000) + "\"}";
            String auditNext = "{\"id\":\"m-262145\",\"worldId\":\"w1\",\"conversationId\":\"c1\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":101,\"revision\":2,\"senderNameSnapshot\":\"u\",\"status\":\"complete\",\"content\":\""
                    + repeatChar('N', 1_800_000) + "\"}";

            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                    dbFile.getPath(), rawKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                catalog.initSchema(db, 5, true);
                db.beginTransactionNonExclusive();
                try {
                    db.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u1', 2, '{}')");
                    db.execSQL("INSERT INTO worlds VALUES('w1', '合成世界📦', 'rules', 1, 'UTC', 100, 100, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    db.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u1', ?, 'bg', 1, '{}')",
                            new Object[] { "\ufeff合成\u0000e\u0301" });
                    db.execSQL("INSERT INTO character_cards VALUES('card-1', 'cv-1', 0, NULL, '{}')");
                    db.execSQL("INSERT INTO card_versions VALUES('cv-1', 'card-1', 1, ?, ?, 'import', '{}', '{}')",
                            new Object[] { bigCardDef, bigCardRaw });
                    db.execSQL("INSERT INTO character_instances VALUES('inst-1', 'w1', 'card-1', 'cv-1', 1, '{}', 'calm', 0.5, 'home', 1, 0, '{}')");
                    db.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', 'N03', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}')");
                    db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                    db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'inst-1', 'character', 1)");
                    // 262144 UTF-16 message
                    db.execSQL("INSERT INTO messages VALUES('m-262144', 'w1', 'c1', 'user', 'user', 'id-1', 'u', ?, 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}')",
                            new Object[] { edge262144 });
                    // 262145 UTF-16 message
                    db.execSQL("INSERT INTO messages VALUES('m-262145', 'w1', 'c1', 'user', 'user', 'id-1', 'u', ?, 101, 2, 'complete', 't2', 'b2', NULL, NULL, NULL, '{}')",
                            new Object[] { edge262145 });
                    // Exact 2 MiB TEXT field message inserted via CAST(? AS TEXT) to preserve leading U+FEFF BOM
                    db.execSQL("INSERT INTO messages VALUES('m-2mib', 'w1', 'c1', 'user', 'user', 'id-1', 'u', CAST(? AS TEXT), 102, 1, 'complete', 't3', 'b3', NULL, NULL, NULL, '{}')",
                            new Object[] { exact2MiBText.getBytes(StandardCharsets.UTF_8) });
                    // Audit composite ~3.6 MiB row
                    db.execSQL("INSERT INTO message_audits VALUES('ma-1', 'w1', 'm-262145', 105, 1, 2, ?, ?, '{}')",
                            new Object[] { auditPrev, auditNext });
                    db.setTransactionSuccessful();
                } finally {
                    db.endTransaction();
                }

                // Empirical check: does SQLCipher bindString strip leading U+FEFF BOM on INSERT?
                try (Cursor c = db.rawQuery(
                        "SELECT length(CAST(content AS BLOB)), hex(substr(CAST(content AS BLOB), 1, 12)) FROM messages WHERE id='m-2mib'",
                        new Object[0])) {
                    assertTrue(c.moveToFirst());
                    cwReport.put("src_m2mib_blobLen", c.getLong(0));
                    cwReport.put("src_m2mib_headHex", c.getString(1));
                }

                // 1. Empirical probe of direct CursorWindow getString() on > 2 MiB composite row & embedded NUL!
                try (Cursor c = db.rawQuery("SELECT content FROM messages WHERE id='m-262144'", new Object[0])) {
                    assertTrue(c.moveToFirst());
                    String direct = c.getString(0);
                    cwReport.put("directGetString_262144_len", direct.length());
                    cwReport.put("directGetString_preservesEmbeddedNul", direct.equals(edge262144));
                } catch (Throwable t) {
                    cwReport.put("directGetString_262144_error", t.getClass().getSimpleName() + ":" + t.getMessage());
                }

                try (Cursor c = db.rawQuery("SELECT definition_json, raw_data_json FROM card_versions WHERE id='cv-1'", new Object[0])) {
                    c.moveToFirst();
                    String s0 = c.getString(0);
                    String s1 = c.getString(1);
                    cwReport.put("directCursorWindow_3_9MiB_row", "SUCCEEDED:" + (s0.length() + s1.length()));
                } catch (Throwable t) {
                    cwReport.put("directCursorWindow_3_9MiB_row", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                }

                try (Cursor c = db.rawQuery("SELECT content FROM messages WHERE id='m-2mib'", new Object[0])) {
                    c.moveToFirst();
                    String s0 = c.getString(0);
                    cwReport.put("directCursorWindow_2MiB_text", "SUCCEEDED:" + s0.length());
                } catch (Throwable t) {
                    cwReport.put("directCursorWindow_2MiB_text", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                }
            }

            // 2. Full Scheme C bounded export & isolated target import with slow spool backpressure!
            AtomicBoolean cancelled = new AtomicBoolean(false);
            long rssBefore = readProcStatusKiB("VmRSS:");
            long natBefore = Debug.getNativeHeapAllocatedSize();
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    dbFile.getPath(), rawKey, "n03-pass-\ufeff📦", catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, outKpb,
                    null, null, cancelled,
                    new KanataM6SchemeCExporter.SpoolHooks() {
                        @Override
                        public void onFrameQueued(int inFlightFrames, int maxRowBytes) {
                            assertTrue("In-flight DATA frames must be <= 2, got " + inFlightFrames, inFlightFrames <= 2);
                            assertTrue("Max row body must be <= 4 MiB, got " + maxRowBytes,
                                    maxRowBytes <= KanataM6PortableCrypto.MAX_ROW_BODY_BYTES);
                        }
                        @Override
                        public void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) {
                            // Inject mild backpressure delay on early frames
                            if (totalWrittenSoFar < 512_000L) {
                                SystemClock.sleep(1);
                            }
                        }
                    });
            assertTrue("Expected multi-frame 64 KiB DATA stream (>150 frames), got " + em.dataFrameCount,
                    em.dataFrameCount > 150);
            assertTrue("In-flight frame cap violated: " + em.maxInFlightFrames, em.maxInFlightFrames <= 2);
            assertTrue("RSS exceeded 512 MiB red line: " + em.peakRssKiB, em.peakRssKiB < 524_288L);
            assertTrue("Max row body > 3.5 MiB expected", em.maxRowBodyBytes > 3_500_000);

            cwReport.put("schemeC_dataFrameCount", em.dataFrameCount);
            cwReport.put("schemeC_maxInFlightFrames", em.maxInFlightFrames);
            cwReport.put("schemeC_maxRowBodyBytes", em.maxRowBodyBytes);
            cwReport.put("schemeC_finalFileBytes", em.finalFileBytes);
            cwReport.put("schemeC_rssBeforeKiB", rssBefore);
            cwReport.put("schemeC_peakRssKiB", em.peakRssKiB);
            cwReport.put("schemeC_vmHwmKiB", readProcStatusKiB("VmHWM:"));
            cwReport.put("schemeC_nativeHeapDeltaBytes", em.peakNativeHeapBytes - natBefore);
            cwReport.put("schemeC_peakJavaHeapBytes", em.peakJavaHeapBytes);

            // Import into isolated Schema 005 SQLCipher target and verify exact byte-for-byte restoration!
            try (FileInputStream fis = new FileInputStream(outKpb)) {
                KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                        fis, "n03-pass-\ufeff📦", catalog, dir, targetDbFile, targetKey, cancelled);
                assertEquals(em.dataFrameCount, ir.dataFrameCount);
                assertEquals(em.transcriptHex, ir.transcriptHex);
            }

            try (SQLiteDatabase tdb = SQLiteDatabase.openDatabase(
                    targetDbFile.getPath(), targetKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(edge262144, readTextViaBlob(tdb, "messages", "content", "id='m-262144'"));
                assertEquals(edge262145, readTextViaBlob(tdb, "messages", "content", "id='m-262145'"));
                String src2Mib;
                try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(dbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    src2Mib = readTextViaBlob(sdb, "messages", "content", "id='m-2mib'");
                }
                assertTrue("Expected leading U+FEFF BOM preserved in src", src2Mib.startsWith("\ufeff"));
                cwReport.put("src_m2mib_startsWithBom", true);
                assertEquals(exact2MiBText, src2Mib);
                assertEquals(exact2MiBText, readTextViaBlob(tdb, "messages", "content", "id='m-2mib'"));
                assertEquals(bigCardDef, readTextViaBlob(tdb, "card_versions", "definition_json", "id='cv-1'"));
                assertEquals(bigCardRaw, readTextViaBlob(tdb, "card_versions", "raw_data_json", "id='cv-1'"));
                assertEquals(auditPrev, readTextViaBlob(tdb, "message_audits", "previous_json", "id='ma-1'"));
                assertEquals(auditNext, readTextViaBlob(tdb, "message_audits", "next_json", "id='ma-1'"));
            }
            cwReport.put("targetExactRoundtripVerified", true);

            // 3. Pre-allocation over-limit rejection: 2 MiB + 1 TEXT field & > 4 MiB composite row
            String over2MiB = repeatChar('Z', KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES + 1);
            try (SQLiteDatabase dbOver = SQLiteDatabase.openDatabase(
                    overTextDbFile.getPath(), rawKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                catalog.initSchema(dbOver, 5, false);
                dbOver.beginTransactionNonExclusive();
                try {
                    dbOver.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u1', 2, '{}')");
                    dbOver.execSQL("INSERT INTO worlds VALUES('w1', 'W', 'r', 1, 'UTC', 100, 100, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                    dbOver.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u1', 'U', 'bg', 1, '{}')");
                    dbOver.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', 'N03', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}')");
                    dbOver.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                    dbOver.execSQL("INSERT INTO messages VALUES('m-over', 'w1', 'c1', 'user', 'user', 'id-1', 'u', ?, 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}')",
                            new Object[] { over2MiB });
                    dbOver.setTransactionSuccessful();
                } finally {
                    dbOver.endTransaction();
                }
            }
            KanataM6PortableCrypto.PortableException exText = assertThrows(KanataM6PortableCrypto.PortableException.class, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            overTextDbFile.getPath(), rawKey, "pw", catalog,
                            null, spoolDir, new File(dir, "fail1.kpb1"), null, null, cancelled, null));
            assertEquals(KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, exText.code);
            cwReport.put("over2MiBTextRejectedBeforeAlloc", exText.stage);

            // Composite > 4 MiB row (3 JSON columns on card_versions: 1.5M + 1.5M + 1.3M = 4.3M > 4 MiB)
            String p15 = makeJsonWithPayload("a", 1_500_000, "z");
            String p13 = makeJsonWithPayload("c", 1_300_000, "z");
            try (SQLiteDatabase dbRowOver = SQLiteDatabase.openDatabase(
                    overRowDbFile.getPath(), rawKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                catalog.initSchema(dbRowOver, 5, false);
                dbRowOver.beginTransactionNonExclusive();
                try {
                    dbRowOver.execSQL("INSERT INTO character_cards VALUES('card-1', 'cv-1', 0, NULL, '{}')");
                    dbRowOver.execSQL("INSERT INTO card_versions VALUES('cv-1', 'card-1', 1, ?, ?, 'import', ?, '{}')",
                            new Object[] { p15, p15, p13 });
                    dbRowOver.setTransactionSuccessful();
                } finally {
                    dbRowOver.endTransaction();
                }
            }
            KanataM6PortableCrypto.PortableException exRow = assertThrows(KanataM6PortableCrypto.PortableException.class, () ->
                    KanataM6SchemeCExporter.exportToSpool(
                            overRowDbFile.getPath(), rawKey, "pw", catalog,
                            null, spoolDir, new File(dir, "fail2.kpb1"), null, null, cancelled, null));
            assertEquals(KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, exRow.code);
            cwReport.put("over4MiBRowRejectedBeforeAlloc", exRow.stage);

            report("N03_LONG_FIELDS_AND_BOUNDED_MEMORY", cwReport);
        } finally {
            Arrays.fill(rawKey, (byte) 0);
            Arrays.fill(targetKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(dbFile);
            SQLiteDatabase.deleteDatabase(overTextDbFile);
            SQLiteDatabase.deleteDatabase(overRowDbFile);
            SQLiteDatabase.deleteDatabase(targetDbFile);
            deleteRecursive(dir);
        }
    }

    @Test
    public void probeCapacitorBridgeControlBoundsAndWebViewMemory() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        System.loadLibrary("sqlcipher");
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File workDir = new File(targetCtx.getCacheDir(), "m6-n03-bridge-" + UUID.randomUUID());
        File spoolDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n03-bridge-spool-" + UUID.randomUUID());
        assertTrue(workDir.mkdirs());
        assertTrue(spoolDir.mkdirs());
        File srcDbFile = new File(workDir, "bridge_src.db");
        File verifyTargetDb = new File(workDir, "bridge_verify_target.db");
        byte[] rawKey = randomRawKey();
        byte[] verifyKey = randomRawKey();
        String bridgePw = "n03-bridge-real-pw";

        KanataM6SyntheticPortablePlugin.resetMetricsAndJobs();
        JSONObject bridgeReport = new JSONObject();

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDbFile, rawKey, catalog, 250);
            KanataM6SyntheticPortablePlugin.registerSyntheticSource(
                    "src-n03", srcDbFile.getAbsolutePath(), rawKey, bridgePw, spoolDir, workDir);

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                CountDownLatch jsDone = new CountDownLatch(1);
                AtomicReference<String> jsResult = new AtomicReference<>();

                // Wait for Capacitor bridge & synthetic plugin injection across WebView cold-start/navigation
                long bridgeReadyDeadline = SystemClock.elapsedRealtime() + 15_000L;
                while (SystemClock.elapsedRealtime() < bridgeReadyDeadline) {
                    CountDownLatch readyLatch = new CountDownLatch(1);
                    AtomicReference<String> readyVal = new AtomicReference<>();
                    scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                            "(function(){ return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanataM6SyntheticPortable); })()",
                            val -> {
                                readyVal.set(val);
                                readyLatch.countDown();
                            }));
                    readyLatch.await(2, TimeUnit.SECONDS);
                    if ("true".equals(readyVal.get())) {
                        break;
                    }
                    Thread.sleep(250);
                }

                scenario.onActivity(activity -> {
                    WebView webView = activity.getBridge().getWebView();
                    String script =
                            "(function() {" +
                            "  var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanataM6SyntheticPortable;" +
                            "  if (!p) return Promise.resolve(JSON.stringify({ error: 'PLUGIN_MISSING' }));" +
                            "  var u8 = new Uint8Array(65536);" +
                            "  u8[0] = 0x4b; u8[65535] = 0x01;" +
                            "  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };" +
                            "  var state = { duplicateRejected: false, cancelAfterCompleteRejected: false, dupCancelRejected: false, staleRejected: false, rejectedOversize: false };" +
                            "  function pollUntilDone(handle, maxIter, delayMs) {" +
                            "    var i = 0;" +
                            "    function step() {" +
                            "      return p.controlPollStatus({ handle: handle }).then(function(res) {" +
                            "        if (res.state === 'COMPLETED' || res.state === 'FAILED' || res.state === 'CANCELLED' || i >= maxIter - 1) return res;" +
                            "        i++;" +
                            "        return delay(delayMs).then(step);" +
                            "      });" +
                            "    }" +
                            "    return step();" +
                            "  }" +
                            "  return p.controlStartExport({ sourceId: 'src-n03', targetName: 'bridge_out.kpb1', clientRequestId: 'req-1' }).then(function(sr) {" +
                            "    state.startRes = sr;" +
                            "    return p.controlStartExport({ sourceId: 'src-n03', targetName: 'bridge_dup.kpb1', clientRequestId: 'req-1' }).then(function() {}, function() { state.duplicateRejected = true; });" +
                            "  }).then(function() {" +
                            "    return pollUntilDone(state.startRes.handle, 120, 100);" +
                            "  }).then(function(pr) {" +
                            "    state.pollRes = pr;" +
                            "    return p.controlCancelExport({ handle: state.startRes.handle }).then(function() {}, function() { state.cancelAfterCompleteRejected = true; });" +
                            "  }).then(function() {" +
                            "    return p.controlStartExport({ sourceId: 'src-n03', targetName: 'bridge_cancel.kpb1', clientRequestId: 'req-2', tableDelayMs: 25 });" +
                            "  }).then(function(s2) {" +
                            "    state.start2 = s2;" +
                            "    return delay(120);" +
                            "  }).then(function() {" +
                            "    return p.controlCancelExport({ handle: state.start2.handle });" +
                            "  }).then(function(cr) {" +
                            "    state.cancelRes = cr;" +
                            "    return p.controlCancelExport({ handle: state.start2.handle }).then(function() {}, function() { state.dupCancelRejected = true; });" +
                            "  }).then(function() {" +
                            "    return pollUntilDone(state.start2.handle, 80, 50);" +
                            "  }).then(function(p2) {" +
                            "    state.poll2 = p2;" +
                            "    return p.controlPollStatus({ handle: 'non-existent-stale-handle' }).then(function() {}, function() { state.staleRejected = true; });" +
                            "  }).then(function() {" +
                            "    return p.controlStartExport({ handle: 'x', bulkRows: Array(8193).join('A') }).then(function() {}, function() { state.rejectedOversize = true; });" +
                            "  }).then(function() {" +
                            "    var mem = window.performance && window.performance.memory ? {" +
                            "      usedJSHeapSize: window.performance.memory.usedJSHeapSize," +
                            "      totalJSHeapSize: window.performance.memory.totalJSHeapSize," +
                            "      jsHeapSizeLimit: window.performance.memory.jsHeapSizeLimit" +
                            "    } : null;" +
                            "    return JSON.stringify({" +
                            "      startRes: state.startRes," +
                            "      pollRes: state.pollRes," +
                            "      duplicateRejected: state.duplicateRejected," +
                            "      cancelAfterCompleteRejected: state.cancelAfterCompleteRejected," +
                            "      cancelHandle: state.start2.handle," +
                            "      cancelRes: state.cancelRes," +
                            "      dupCancelRejected: state.dupCancelRejected," +
                            "      poll2: state.poll2," +
                            "      staleRejected: state.staleRejected," +
                            "      rejectedOversize: state.rejectedOversize," +
                            "      typedArrayLen: u8.byteLength," +
                            "      jsMemory: mem" +
                            "    });" +
                            "  });" +
                            "})()";
                    webView.evaluateJavascript(
                            "(function(){ var r = " + script + "; r.then(function(v){ window.__n03Out = v; }).catch(function(e){ window.__n03Out = JSON.stringify({err:String(e)}); }); return 'PENDING'; })()",
                            ignored -> {});
                });

                long deadline = SystemClock.elapsedRealtime() + 30_000L;
                while (SystemClock.elapsedRealtime() < deadline) {
                    CountDownLatch step = new CountDownLatch(1);
                    scenario.onActivity(activity -> {
                        WebView webView = activity.getBridge().getWebView();
                        webView.evaluateJavascript("window.__n03Out || null", value -> {
                            if (value != null && !"null".equals(value)) {
                                jsResult.set(value);
                                jsDone.countDown();
                            }
                            step.countDown();
                        });
                    });
                    step.await(2, TimeUnit.SECONDS);
                    if (jsDone.getCount() == 0) break;
                    Thread.sleep(200);
                }
                assertEquals("WebView JS bridge script did not finish", 0, jsDone.getCount());

                String rawJsonString = jsResult.get();
                String unquoted = new org.json.JSONTokener(rawJsonString).nextValue().toString();
                JSONObject jsObj = new JSONObject(unquoted);
                assertFalse("Plugin error in WebView: " + unquoted, jsObj.has("error") || jsObj.has("err"));
                assertTrue("Oversize bridge call must be rejected", jsObj.getBoolean("rejectedOversize"));
                assertTrue("Duplicate request must be rejected", jsObj.getBoolean("duplicateRejected"));
                assertTrue("Cancel after complete must be rejected", jsObj.getBoolean("cancelAfterCompleteRejected"));
                assertTrue("Duplicate cancel must be rejected", jsObj.getBoolean("dupCancelRejected"));
                assertTrue("Stale handle must be rejected", jsObj.getBoolean("staleRejected"));
                assertEquals(65536, jsObj.getInt("typedArrayLen"));

                JSONObject pollRes = jsObj.getJSONObject("pollRes");
                assertEquals("COMPLETED", pollRes.getString("state"));
                assertEquals(45, pollRes.getInt("tablesDone"));
                assertTrue(pollRes.getInt("dataFrames") >= 1);
                assertTrue(pollRes.getBoolean("verifiedReadback"));
                assertTrue(pollRes.getLong("finalFileBytes") > 0L);

                JSONObject poll2 = jsObj.getJSONObject("poll2");
                assertEquals("CANCELLED", poll2.getString("state"));
                assertEquals(KanataM6PortableCrypto.ERR_CANCELLED, poll2.getString("errorCode"));
                assertFalse("Cancelled bridge export must not leave final file",
                        new File(workDir, "bridge_cancel.kpb1").exists());

                // Verify exported KPB1 file on Native side decrypts and passes all 50-table verification!
                File exportedFile = new File(workDir, "bridge_out.kpb1");
                assertTrue(exportedFile.exists());
                assertEquals(pollRes.getLong("finalFileBytes"), exportedFile.length());
                try (FileInputStream fis = new FileInputStream(exportedFile)) {
                    KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            fis, bridgePw, catalog, workDir, verifyTargetDb, verifyKey, new AtomicBoolean(false));
                    assertEquals(250L + 56L, ir.totalBusinessRows);
                    assertEquals(50, ir.footerVerifiers.size());
                }

                // Expire active handle and prove JS rejects subsequent poll on expired handle
                String completedHandle = jsObj.getJSONObject("startRes").getString("handle");
                KanataM6SyntheticPortablePlugin.expireHandle(completedHandle);
                CountDownLatch expLatch = new CountDownLatch(1);
                AtomicReference<String> expOut = new AtomicReference<>();
                scenario.onActivity(act -> act.getBridge().getWebView().evaluateJavascript(
                        "(async function(){ try { await window.Capacitor.Plugins.KanataM6SyntheticPortable.controlPollStatus({handle:'"
                                + completedHandle + "'}); window.__n03Exp='UNEXPECTED_OK'; } catch(e) { window.__n03Exp='REJECTED'; } })()",
                        ignored -> {}));
                long expDeadline = SystemClock.elapsedRealtime() + 5_000L;
                while (SystemClock.elapsedRealtime() < expDeadline && expLatch.getCount() > 0) {
                    CountDownLatch s = new CountDownLatch(1);
                    scenario.onActivity(act -> act.getBridge().getWebView().evaluateJavascript("window.__n03Exp || null", val -> {
                        if (val != null && !"null".equals(val)) {
                            expOut.set(val);
                            expLatch.countDown();
                        }
                        s.countDown();
                    }));
                    s.await(1, TimeUnit.SECONDS);
                    if (expLatch.getCount() == 0) break;
                    Thread.sleep(100);
                }
                assertEquals("\"REJECTED\"", expOut.get());

                assertEquals(1, KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_BRIDGE_CALLS.get());
                assertTrue(KanataM6SyntheticPortablePlugin.REJECTED_STALE_OR_DUPLICATE_CALLS.get() >= 4);
                assertFalse(KanataM6SyntheticPortablePlugin.OBSERVED_RESPONSE_BYTES.isEmpty());
                assertFalse(KanataM6SyntheticPortablePlugin.OBSERVED_REQUEST_BYTES.isEmpty());
                for (int sz : KanataM6SyntheticPortablePlugin.OBSERVED_RESPONSE_BYTES) {
                    assertTrue("Bridge control response too large: " + sz,
                            sz <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_RESPONSE_BYTES);
                }
                for (int sz : KanataM6SyntheticPortablePlugin.OBSERVED_REQUEST_BYTES) {
                    assertTrue("Accepted Bridge control request must stay <= 4096 B, got " + sz,
                            sz <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_CONTROL_BYTES);
                }
                assertTrue("MAX_OBSERVED_BRIDGE_BYTES must never include rejected oversize calls, got "
                                + KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get(),
                        KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get()
                                <= KanataM6SyntheticPortablePlugin.MAX_BRIDGE_CONTROL_BYTES);

                long rss = readProcStatusKiB("VmRSS:");
                long hwm = readProcStatusKiB("VmHWM:");
                assertTrue("App+WebView RSS must stay below 512 MiB: " + rss, rss < 524_288L);
                bridgeReport.put("jsResult", jsObj);
                bridgeReport.put("observedMaxBridgeBytes", KanataM6SyntheticPortablePlugin.MAX_OBSERVED_BRIDGE_BYTES.get());
                bridgeReport.put("rejectedOversizeCalls", KanataM6SyntheticPortablePlugin.REJECTED_OVERSIZE_BRIDGE_CALLS.get());
                bridgeReport.put("rejectedStaleOrDuplicateCalls", KanataM6SyntheticPortablePlugin.REJECTED_STALE_OR_DUPLICATE_CALLS.get());
                bridgeReport.put("appPlusWebViewVmRssKiB", rss);
                bridgeReport.put("appPlusWebViewVmHwmKiB", hwm);
                bridgeReport.put("nativeHeapAllocatedBytes", Debug.getNativeHeapAllocatedSize());
                Runtime rt = Runtime.getRuntime();
                bridgeReport.put("javaHeapUsedBytes", rt.totalMemory() - rt.freeMemory());
                report("N03_BRIDGE_AND_WEBVIEW", bridgeReport);
            }
        } finally {
            KanataM6SyntheticPortablePlugin.resetMetricsAndJobs();
            Arrays.fill(rawKey, (byte) 0);
            Arrays.fill(verifyKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            SQLiteDatabase.deleteDatabase(verifyTargetDb);
            deleteRecursive(workDir);
            deleteRecursive(spoolDir);
        }
    }

    private static String readTextViaBlob(SQLiteDatabase db, String table, String col, String where) throws Exception {
        int len;
        try (Cursor c = db.rawQuery("SELECT length(CAST(" + col + " AS BLOB)) FROM " + table + " WHERE " + where, new Object[0])) {
            assertTrue(c.moveToFirst());
            len = (int) c.getLong(0);
        }
        byte[] out = new byte[len];
        int copied = 0;
        while (copied < len) {
            int take = Math.min(262_144, len - copied);
            try (Cursor c = db.rawQuery(
                    "SELECT substr(CAST(" + col + " AS BLOB), ?, ?) FROM " + table + " WHERE " + where,
                    new Object[] { copied + 1, take })) {
                assertTrue(c.moveToFirst());
                byte[] piece = c.getBlob(0);
                assertNotNull(piece);
                assertEquals(take, piece.length);
                System.arraycopy(piece, 0, out, copied, take);
            }
            copied += take;
        }
        return KanataM6PortableCrypto.decodeStrictUtf8(out, "readTextViaBlob");
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
