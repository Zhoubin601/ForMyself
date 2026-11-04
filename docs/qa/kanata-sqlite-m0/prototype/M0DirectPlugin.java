package com.formyself.qa.m0;

import android.database.Cursor;
import android.os.SystemClock;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;

/** QA only. A fixed app-private database, no generic SQL or persistent plugin secret. */
@CapacitorPlugin(name = "M0Direct")
public class M0DirectPlugin extends Plugin {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String HEX = "0123456789abcdef";
    private static final String PURPOSE = "kanata-sqlcipher-dek-wrap";
    private static final String SCOPE = " WHERE world_id=? AND conversation_id=?";
    private volatile boolean foreground;
    private Challenge pending;
    private String lease;
    private SQLiteDatabase database;
    private byte[] rawKey;

    private record Challenge(String token, JSONObject header, boolean create, long expires) {}

    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnPause() { revoke(); }
    @Override protected void handleOnDestroy() { revoke(); }

    private void revoke() {
        foreground = false;
        synchronized (this) { release(); }
    }

    private void release() {
        pending = null;
        lease = null;
        SQLiteDatabase closing = database;
        database = null;
        try {
            if (closing != null) closing.close();
        } finally {
            if (rawKey != null) Arrays.fill(rawKey, (byte) 0);
            rawKey = null;
        }
    }

    private File root() { return new File(getContext().getFilesDir(), "m0-direct"); }
    private File databaseFile() { return new File(root(), "messages.db"); }
    private AtomicFile envelopeFile() { return new AtomicFile(new File(root(), "envelope.json")); }

    private static byte[] random(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static String encode(byte[] bytes) { return Base64.encodeToString(bytes, Base64.NO_WRAP); }

    private static byte[] decode(JSONObject json, String field, int length) throws Exception {
        byte[] bytes = Base64.decode(json.getString(field), Base64.NO_WRAP);
        if (bytes.length != length || !encode(bytes).equals(json.getString(field))) throw new IllegalArgumentException();
        return bytes;
    }

    private static JSONObject header(String salt, String nonce) throws Exception {
        return new JSONObject().put("version", 1).put("purpose", PURPOSE)
            .put("kdf", new JSONObject().put("name", "PBKDF2-SHA256").put("iterations", 600000).put("length", 256))
            .put("cipher", "AES-256-GCM").put("salt", salt).put("nonce", nonce);
    }

    private static byte[] crypt(int mode, byte[] kek, JSONObject envelope, byte[] input) throws Exception {
        byte[] nonce = decode(envelope, "nonce", 12);
        String aad = "{\"version\":1,\"purpose\":\"" + PURPOSE + "\",\"kdf\":"
            + "{\"name\":\"PBKDF2-SHA256\",\"iterations\":600000,\"length\":256},"
            + "\"cipher\":\"AES-256-GCM\",\"salt\":\"" + encode(decode(envelope, "salt", 16))
            + "\",\"nonce\":\"" + encode(nonce) + "\"}";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(kek, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return cipher.doFinal(input);
    }

    @PluginMethod public synchronized void prepare(PluginCall call) {
        if (!foreground || database != null) { call.reject("QA_SESSION_UNAVAILABLE"); return; }
        pending = null;
        try {
            boolean create = Boolean.TRUE.equals(call.getBoolean("create"));
            boolean hasEnvelope = envelopeFile().getBaseFile().isFile();
            if (create ? hasEnvelope || databaseFile().exists() : !hasEnvelope || !databaseFile().isFile()) {
                call.reject("QA_ENVELOPE_STATE"); return;
            }
            JSONObject metadata;
            if (create) metadata = header(encode(random(16)), encode(random(12)));
            else {
                byte[] bytes = envelopeFile().readFully();
                if (bytes.length > 1024) throw new IllegalArgumentException();
                metadata = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                JSONObject kdf = metadata.getJSONObject("kdf");
                if (metadata.getInt("version") != 1 || !PURPOSE.equals(metadata.getString("purpose"))
                    || !"AES-256-GCM".equals(metadata.getString("cipher")) || !"PBKDF2-SHA256".equals(kdf.getString("name"))
                    || kdf.getInt("iterations") != 600000 || kdf.getInt("length") != 256) throw new IllegalArgumentException();
                decode(metadata, "salt", 16);
                decode(metadata, "nonce", 12);
                decode(metadata, "ciphertext", 48);
            }
            pending = new Challenge(UUID.randomUUID().toString(), metadata, create, SystemClock.elapsedRealtime() + 30000);
            call.resolve(new JSObject().put("token", pending.token()).put("salt", metadata.getString("salt")));
        } catch (Exception error) { call.reject("QA_ENVELOPE_STATE"); }
    }

    @PluginMethod public synchronized void unlock(PluginCall call) {
        Challenge challenge = pending;
        pending = null;
        if (!foreground || challenge == null || !challenge.token().equals(call.getString("token"))
            || SystemClock.elapsedRealtime() >= challenge.expires()) { call.reject("QA_CHALLENGE_EXPIRED"); return; }
        byte[] kek = new byte[32], dek = null;
        try {
            String hex = call.getString("kek", "");
            if (hex.length() != 64) throw new IllegalArgumentException();
            for (int i = 0; i < kek.length; i++) {
                int high = HEX.indexOf(hex.charAt(i * 2)), low = HEX.indexOf(hex.charAt(i * 2 + 1));
                if (high < 0 || low < 0) throw new IllegalArgumentException();
                kek[i] = (byte) (16 * high + low);
            }
            JSONObject metadata = challenge.header();
            if (challenge.create()) {
                dek = random(32);
                metadata.put("ciphertext", encode(crypt(Cipher.ENCRYPT_MODE, kek, metadata, dek)));
                if (!root().mkdir() && !root().isDirectory()) throw new IllegalStateException();
            } else dek = crypt(Cipher.DECRYPT_MODE, kek, metadata, decode(metadata, "ciphertext", 48));
            rawKey = new byte[67];
            rawKey[0] = 'x';
            rawKey[1] = rawKey[66] = '\'';
            for (int i = 0; i < dek.length; i++) {
                rawKey[2 + 2 * i] = (byte) HEX.charAt((dek[i] & 0xff) >>> 4);
                rawKey[3 + 2 * i] = (byte) HEX.charAt(dek[i] & 15);
            }
            System.loadLibrary("sqlcipher");
            int flags = SQLiteDatabase.OPEN_READWRITE | (challenge.create() ? SQLiteDatabase.CREATE_IF_NECESSARY : 0);
            database = SQLiteDatabase.openDatabase(databaseFile().getPath(), rawKey, null, flags, (db, error) -> {}, null);
            if (!database.enableWriteAheadLogging()) throw new IllegalStateException();
            database.execSQL("PRAGMA synchronous=FULL");
            database.execSQL("PRAGMA cache_size=-2048");
            if (challenge.create()) {
                database.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,conversation_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL)");
                database.execSQL("CREATE INDEX scope_time ON messages(world_id,conversation_id,created_at DESC,id DESC)");
                AtomicFile envelope = envelopeFile();
                FileOutputStream output = envelope.startWrite();
                try {
                    output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
                    envelope.finishWrite(output);
                } catch (Exception failure) {
                    envelope.failWrite(output);
                    throw failure;
                }
                if (!getContext().getSharedPreferences("m0-direct-audit", 0).edit().putBoolean("probe", true).commit())
                    throw new IllegalStateException();
            } else {
                // Validate that the QA schema is readable before handing out a lease.
                try (Cursor probe = database.rawQuery("SELECT id FROM messages LIMIT 1", new String[0])) {
                    probe.moveToFirst();
                }
            }
            if (!foreground) throw new IllegalStateException();
            lease = UUID.randomUUID().toString();
            android.util.Log.i("KanataM0", "direct unlock probe");
            call.resolve(new JSObject().put("lease", lease));
        } catch (Exception | LinkageError failure) {
            release();
            call.reject("QA_UNLOCK_FAILED");
        } finally {
            Arrays.fill(kek, (byte) 0);
            if (dek != null) Arrays.fill(dek, (byte) 0);
            call.getData().remove("kek");
        }
    }

    private boolean authorized(PluginCall call) {
        if (foreground && database != null && lease != null && lease.equals(call.getString("lease"))) return true;
        call.reject("QA_SESSION_REVOKED");
        return false;
    }

    @PluginMethod public synchronized void lock(PluginCall call) {
        release();
        call.resolve();
    }

    @PluginMethod public synchronized void insert(PluginCall call) {
        if (!authorized(call)) return;
        try {
            JSONArray rows = call.getArray("rows");
            if (rows == null || rows.length() < 1 || rows.length() > 256) throw new IllegalArgumentException();
            database.beginTransaction();
            try {
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.getJSONObject(i);
                    String payload = row.getString("payload");
                    if (payload.length() > 4096) throw new IllegalArgumentException();
                    database.execSQL("INSERT INTO messages VALUES(?,?,?,?,?)", new Object[]{
                        row.getString("id"), row.getString("world"), row.getString("conversation"), row.getLong("time"), payload
                    });
                }
                if (!foreground) throw new IllegalStateException();
                database.setTransactionSuccessful();
            } finally { database.endTransaction(); }
            call.resolve();
        } catch (Exception failure) { call.reject("QA_INSERT_FAILED"); }
    }

    @PluginMethod public synchronized void page(PluginCall call) {
        if (!authorized(call)) return;
        try {
            String world = call.getString("world"), conversation = call.getString("conversation"), before = call.getString("before");
            if (world == null || conversation == null) throw new IllegalArgumentException();
            String query = "SELECT payload FROM messages" + SCOPE
                + (before == null ? "" : " AND (created_at,id)<(?,?)") + " ORDER BY created_at DESC,id DESC LIMIT 50";
            String[] args = before == null ? new String[]{world, conversation}
                : new String[]{world, conversation, call.getString("time"), before};
            JSArray rows = new JSArray();
            try (Cursor cursor = database.rawQuery(query, args)) {
                while (cursor.moveToNext()) rows.put(cursor.getString(0));
            }
            if (!foreground) throw new IllegalStateException();
            call.resolve(new JSObject().put("rows", rows));
        } catch (Exception failure) { call.reject("QA_QUERY_FAILED"); }
    }

    @PluginMethod public synchronized void verify(PluginCall call) {
        if (!authorized(call)) return;
        try (Cursor count = database.rawQuery("SELECT count(*) FROM messages", new String[0]);
             Cursor cipher = database.rawQuery("PRAGMA cipher_version", new String[0]);
             Cursor plan = database.rawQuery("EXPLAIN QUERY PLAN SELECT payload FROM messages" + SCOPE
                 + " AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT 50",
                 new String[]{call.getString("world"), call.getString("conversation"), "1700000000000", "cursor"})) {
            if (!count.moveToFirst() || !cipher.moveToFirst() || !plan.moveToFirst()) throw new IllegalStateException();
            call.resolve(new JSObject().put("rows", count.getLong(0)).put("cipher", cipher.getString(0))
                .put("plan", plan.getString(3)).put("integrity", database.isDatabaseIntegrityOk())
                .put("wal", pragma("PRAGMA journal_mode")).put("synchronous", pragma("PRAGMA synchronous"))
                .put("cacheSize", pragma("PRAGMA cache_size")).put("checkpoint", pragma("PRAGMA wal_autocheckpoint")));
        } catch (Exception failure) { call.reject("QA_VERIFY_FAILED"); }
    }

    private String pragma(String statement) {
        try (Cursor row = database.rawQuery(statement, new String[0])) {
            if (!row.moveToFirst()) throw new IllegalStateException();
            return row.getString(0);
        }
    }

    @PluginMethod public synchronized void edit(PluginCall call) {
        if (!authorized(call)) return;
        try {
            String payload = call.getString("payload");
            if (payload == null || payload.length() > 4096) throw new IllegalArgumentException();
            database.execSQL("UPDATE messages SET payload=?" + SCOPE + " AND id=?",
                new Object[]{payload, call.getString("world"), call.getString("conversation"), call.getString("id")});
            call.resolve();
        } catch (Exception failure) { call.reject("QA_EDIT_FAILED"); }
    }

    @PluginMethod public synchronized void remove(PluginCall call) {
        if (!authorized(call)) return;
        try {
            database.execSQL("DELETE FROM messages" + SCOPE + " AND id=?",
                new Object[]{call.getString("world"), call.getString("conversation"), call.getString("id")});
            call.resolve();
        } catch (Exception failure) { call.reject("QA_DELETE_FAILED"); }
    }

    /** The QA runner force-stops the app during this bounded uncommitted transaction. */
    @PluginMethod public synchronized void armCrash(PluginCall call) {
        if (!authorized(call)) return;
        boolean announced = false;
        try {
            database.beginTransaction();
            try {
                database.execSQL("INSERT INTO messages VALUES('qa-uncommitted','qa','qa',0,'{}')");
                if (!"1".equals(pragma("SELECT count(*) FROM messages WHERE id='qa-uncommitted'"))) throw new IllegalStateException();
                android.util.Log.i("KanataM0", "direct rollback armed");
                call.resolve(new JSObject().put("armed", true));
                announced = true;
                SystemClock.sleep(30000);
                android.util.Log.i("KanataM0", "direct rollback arm timed out");
            } finally { database.endTransaction(); }
        } catch (Exception failure) {
            if (!announced) call.reject("QA_ARM_FAILED");
        }
    }
}
