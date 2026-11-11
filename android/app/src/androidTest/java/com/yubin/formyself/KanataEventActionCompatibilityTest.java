package com.yubin.formyself;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.database.Cursor;
import android.os.Build;
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

/** ER1 feasibility spike, not candidate business-path acceptance. All data is
 * generated here in a new random QA cache DB. No production DB is opened. */
@RunWith(AndroidJUnit4.class)
public class KanataEventActionCompatibilityTest {
    @Test public void rawJsonAndDecodedTextHaveSeparateUtf16Contracts() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", context.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);
        assertEquals(34, Build.VERSION.SDK_INT);
        assertEquals("x86_64", Build.SUPPORTED_ABIS[0]);
        System.loadLibrary("sqlcipher");
        File file = new File(context.getCacheDir(), "er1-action-" + UUID.randomUUID() + ".db");
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        byte[] key;
        try { key = KanataKeyEnvelope.rawSqlCipherKey(dek); }
        finally { Arrays.fill(dek, (byte) 0); }
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getPath(), key, null,
                SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS, (database, error) -> {}, null)) {
            try (Cursor c = db.rawQuery("PRAGMA cipher_version", new Object[0])) {
                assertTrue(c.moveToFirst());
                assertEquals("4.17.0 community", c.getString(0));
                Log.i("ER1_ACTION_SPIKE", "cipher=" + c.getString(0));
            }
            String[][] cases = {
                {"empty", "\"\""}, {"ascii", "\"ascii\""}, {"bmp", "\"界\""},
                {"pair", "\"\\ud83d\\ude00\""}, {"high", "\"\\ud800\""}, {"low", "\"\\udc00\""},
                {"mixed", "\"x\\ud83d\\ude00界\\ud800y\\udc00\""}, {"null", "null"},
                {"array", "[\"\\ud83d\\ude00\",null]"}, {"object", "{\"10\":\"ten\",\"2\":\"two\",\"future\":null}"},
                {"missing", null}
            };
            for (String[] item : cases) probe(db, item[0], item[1]);
            for (int size : new int[]{1000,10000}) {
                probe(db, "mixed-repetitions-" + size, "\"" + "x\\ud83d\\ude00界\\ud800y\\udc00".repeat(size) + "\"");
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            SQLiteDatabase.deleteDatabase(file);
        }
    }

    private static void probe(SQLiteDatabase db, String name, String raw) throws Exception {
        String json = raw == null ? "{}" : "{\"action\":" + raw + "}";
        // Both variants are measured. Successful raw preservation must not be
        // represented as successful decoded-text or UTF-16 spread conversion.
        try (Cursor c = db.rawQuery("SELECT ? -> '$.action', json_extract(?,'$.action'), json_type(?,'$.action')",
                new Object[]{json,json,json})) {
            assertTrue(c.moveToFirst());
            assertEquals(raw, c.isNull(0) ? null : c.getString(0));
            String type = c.isNull(2) ? "missing" : c.getString(2);
            JSONObject result = new JSONObject();
            result.put("case",name);
            result.put("type",type);
            result.put("rawEqual",true);
            if ("text".equals(type)) {
                String expected = new JSONObject(json).getString("action");
                String decoded = c.getString(1);
                result.put("decodedEqual",expected.equals(decoded));
                result.put("expectedCodeUnits",expected.length());
                result.put("decodedCodeUnits",decoded.length());
                if (expected.length() < 40) {
                    result.put("expectedUnits",units(expected));
                    result.put("decodedUnits",units(decoded));
                }
            }
            Log.i("ER1_ACTION_SPIKE",result.toString());
            System.out.println("ER1_ACTION_SPIKE " + result);
        }
    }

    private static String units(String text) {
        StringBuilder result = new StringBuilder();
        for (int i=0;i<text.length();i++)result.append(String.format("%04x",(int)text.charAt(i)));
        return result.toString();
    }
}
