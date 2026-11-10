package com.yubin.formyself;

import android.database.Cursor;
import android.os.SystemClock;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import android.util.Log;
import android.util.Xml;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;

import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;
import net.zetetic.database.Logger;
import net.zetetic.database.LogTarget;

@CapacitorPlugin(name = "KanataSqlite")
public final class KanataSqlitePlugin extends Plugin {
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicLong epoch = new AtomicLong();
    private volatile boolean foreground;
    private Challenge challenge;
    private SQLiteDatabase database;
    private byte[] rawKey;
    private Owner owner;
    private String transaction;
    private boolean transactionFailed;
    private boolean poisoned;
    private boolean creating;
    private boolean ready;
    private JSONObject catalog;

    private record Identity(long revision, long generation) {}
    private record Challenge(Identity identity, long epoch, String token, long expires, JSONObject header, boolean create) {}
    private record Owner(Identity identity, long epoch, String lease) {}

    private static final class Refusal extends RuntimeException {
        final String code;
        Refusal(String code) { this.code = code; }
    }

    @FunctionalInterface private interface Work { void run(long requestedEpoch) throws Exception; }

    private static void require(boolean ok, String code) {
        if (!ok) throw new Refusal(code);
    }

    private static void deny(PluginCall call, String code) {
        String fixed = code.startsWith("KANATA_SCHEMA_") ? code : "KANATA_SQLITE_" + code;
        call.reject(fixed, fixed);
    }

    private boolean activated() {
        return BuildConfig.KANATA_M2_SYNTHETIC && "com.yubin.formyself.m2qa".equals(getContext().getPackageName());
    }

    private void dispatch(PluginCall call, String failureCode, Work work) {
        if (!activated()) {
            call.getData().remove("kek");
            deny(call, "NOT_ACTIVATED");
            return;
        }
        long requestedEpoch = epoch.get();
        try {
            worker.execute(() -> {
                try { work.run(requestedEpoch); }
                catch (Refusal failure) { deny(call, failure.code); }
                catch (Exception | LinkageError failure) { deny(call, failureCode); }
                finally { call.getData().remove("kek"); }
            });
        } catch (RejectedExecutionException destroyed) {
            call.getData().remove("kek");
            deny(call, "LEASE_REVOKED");
        }
    }

    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnPause() { revoke(); }
    @Override protected void handleOnDestroy() { revoke(); worker.shutdown(); }

    private void revoke() {
        foreground = false;
        epoch.incrementAndGet();
        try {
            worker.execute(() -> {
                try { closeStorage(); }
                catch (Refusal failure) { poisoned = true; }
            });
        } catch (RejectedExecutionException destroyed) {
            // Destruction already queued the last close on this executor.
        }
    }

    private void closeStorage() {
        challenge = null;
        owner = null;
        ready = creating = false;
        transactionFailed = false;
        boolean rollbackFailed = false;
        try {
            if (transaction != null) {
                transaction = null;
                try { database.endTransaction(); }
                catch (RuntimeException error) { rollbackFailed = true; }
            }
            if (database != null) database.close();
        } catch (RuntimeException failure) {
            poisoned = true;
            throw new Refusal("CLOSE_FAILED");
        } finally {
            database = null;
            if (rawKey != null) Arrays.fill(rawKey, (byte) 0);
            rawKey = null;
        }
        if (rollbackFailed) {
            poisoned = true;
            throw new Refusal("ROLLBACK_FAILED");
        }
    }

    private File root() { return new File(getContext().getNoBackupFilesDir(), "kanata-sqlite-v1"); }
    private File dbFile() { return new File(root(), "kanata.db"); }
    private AtomicFile envelope() { return new AtomicFile(new File(root(), "envelope.json")); }
    private AtomicFile marker() { return new AtomicFile(new File(root(), "creation.pending")); }

    private static int mode(File file) throws ErrnoException {
        try { return Os.lstat(file.getPath()).st_mode; }
        catch (ErrnoException error) {
            if (error.errno == OsConstants.ENOENT) return 0;
            throw error;
        }
    }

    private static boolean exists(File file) throws ErrnoException { return mode(file) != 0; }

    private static boolean atomicExists(AtomicFile file) throws ErrnoException {
        File base = file.getBaseFile();
        return exists(base) || exists(new File(base.getPath() + ".bak")) || exists(new File(base.getPath() + ".new"));
    }

    private void verifyInventory(boolean create) throws Exception {
        File files = getContext().getFilesDir();
        int parentMode = mode(new File(files, "formyself"));
        require(parentMode == 0 || OsConstants.S_ISDIR(parentMode), "STATE_UNKNOWN");
        for (String path : new String[] {
            "kanata-v1.enc", "kanata-v1.enc.bak", "kanata-v1.enc.tmp", "kanata-pages-v1",
            "restore-v1.enc", "restore-v1.enc.commit", "restore-v1.enc.tmp",
        }) require(!exists(new File(files, "formyself/" + path)), "LEGACY_PRESENT");
        verifyRecoveryPreferences();
        require(!atomicExists(marker()), "INCOMPLETE_CREATION");
        int directoryMode = mode(root());
        require(directoryMode == 0 || OsConstants.S_ISDIR(directoryMode), "STATE_UNKNOWN");
        int databaseMode = mode(dbFile());
        int envelopeMode = mode(envelope().getBaseFile());
        boolean hasDb = databaseMode != 0;
        boolean hasEnvelope = envelopeMode != 0;
        require(hasDb == hasEnvelope, "INCOMPLETE_CREATION");
        require(!exists(new File(root(), "envelope.json.bak")) && !exists(new File(root(), "envelope.json.new")),
            "INCOMPLETE_CREATION");
        if (hasDb) {
            require(OsConstants.S_ISREG(databaseMode) && OsConstants.S_ISREG(envelopeMode), "STATE_UNKNOWN");
            require(!create, "INCOMPLETE_CREATION");
        } else {
            for (String suffix : new String[] { "-wal", "-shm", "-journal" }) {
                require(!exists(new File(dbFile().getPath() + suffix)), "INCOMPLETE_CREATION");
            }
            require(create, "DATABASE_ABSENT");
        }
    }

    private void verifyRecoveryPreferences() throws Exception {
        // SharedPreferences may turn malformed XML into an empty map. Check the
        // stored inventory without triggering its backup recovery or reading any value.
        File preferences = new File(getContext().getApplicationInfo().dataDir, "shared_prefs/CapacitorStorage.xml");
        require(!exists(new File(preferences.getPath() + ".bak")), "STATE_UNKNOWN");
        int fileMode = mode(preferences);
        if (fileMode == 0) return;
        require(OsConstants.S_ISREG(fileMode), "STATE_UNKNOWN");
        try (InputStream stream = new FileInputStream(preferences)) {
            XmlPullParser parser = Xml.newPullParser();
            parser.setInput(stream, "UTF-8");
            require(parser.nextTag() == XmlPullParser.START_TAG && "map".equals(parser.getName()), "STATE_UNKNOWN");
            for (int event = parser.next(); event != XmlPullParser.END_DOCUMENT; event = parser.next()) {
                if (event == XmlPullParser.START_TAG && parser.getDepth() == 2) {
                    String key = parser.getAttributeValue(null, "name");
                    require(key != null, "STATE_UNKNOWN");
                    require(!"my_kanata_recovery_encrypted_v1".equals(key), "LEGACY_PRESENT");
                }
            }
        }
    }

    private static long identityField(PluginCall call, String field) {
        Object value = call.getData().opt(field);
        require(value instanceof Integer || value instanceof Long, "LEASE_REVOKED");
        long number = ((Number) value).longValue();
        require(number >= 0 && number <= MAX_SAFE_INTEGER, "LEASE_REVOKED");
        return number;
    }

    private static Identity identity(PluginCall call) {
        return new Identity(identityField(call, "sessionRevision"), identityField(call, "ownerGeneration"));
    }

    private void front(long requestedEpoch, String code) {
        require(foreground && !poisoned && requestedEpoch == epoch.get(), code);
    }

    private void authorize(PluginCall call, long requestedEpoch) {
        front(requestedEpoch, "LEASE_REVOKED");
        require(owner != null && owner.epoch() == requestedEpoch && owner.lease().equals(call.getString("lease"))
            && owner.identity().equals(identity(call)), "LEASE_REVOKED");
    }

    @PluginMethod public void prepare(PluginCall call) {
        dispatch(call, "STATE_UNKNOWN", requestedEpoch -> {
            challenge = null;
            front(requestedEpoch, "CHALLENGE_INVALID");
            require(database == null, "TRANSACTION_BUSY");
            boolean create = Boolean.TRUE.equals(call.getBoolean("create"));
            verifyInventory(create);
            JSONObject header;
            try { header = create ? KanataKeyEnvelope.newHeader() : KanataKeyEnvelope.readHeader(envelope()); }
            catch (Exception failure) { throw new Refusal("UNLOCK_FAILED"); }
            String token = UUID.randomUUID().toString();
            challenge = new Challenge(identity(call), requestedEpoch, token,
                SystemClock.elapsedRealtime() + 30000, header, create);
            call.resolve(new JSObject().put("token", token).put("salt", header.getString("salt")));
        });
    }

    @PluginMethod public void unlock(PluginCall call) {
        dispatch(call, "UNLOCK_FAILED", requestedEpoch -> {
            Challenge pending = challenge;
            challenge = null;
            front(requestedEpoch, "CHALLENGE_INVALID");
            require(pending != null && pending.epoch() == requestedEpoch && database == null
                && pending.token().equals(call.getString("token")) && pending.identity().equals(identity(call))
                && SystemClock.elapsedRealtime() < pending.expires(), "CHALLENGE_INVALID");
            try { verifyInventory(pending.create()); }
            catch (Refusal failure) { throw failure; }
            catch (Exception failure) { throw new Refusal("STATE_UNKNOWN"); }
            byte[] kek = new byte[32];
            byte[] dek = null;
            try {
                KanataKeyEnvelope.decodeKek(call.getString("kek"), kek);
                call.getData().remove("kek");
                if (pending.create()) {
                    if (!root().mkdirs() && !root().isDirectory()) throw new IOException();
                    KanataKeyEnvelope.writeVerified(marker(), new byte[] { 1 });
                    dek = KanataKeyEnvelope.create(envelope(), pending.header(), kek);
                } else dek = KanataKeyEnvelope.unwrap(kek, pending.header());
                rawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);
                openStorage(pending.create());
                front(requestedEpoch, "LEASE_REVOKED");
                creating = pending.create();
                owner = new Owner(pending.identity(), requestedEpoch, UUID.randomUUID().toString());
                call.resolve(new JSObject().put("lease", owner.lease()));
            } catch (Exception | LinkageError failure) {
                closeStorage();
                throw failure;
            } finally {
                Arrays.fill(kek, (byte) 0);
                if (dek != null) Arrays.fill(dek, (byte) 0);
            }
        });
    }

    private void openStorage(boolean create) {
        System.loadLibrary("sqlcipher");
        Logger.setTarget(new LogTarget() {
            @Override public boolean isLoggable(String tag, int priority) { return false; }
            @Override public void log(int priority, String tag, String message, Throwable failure) {}
        });
        int flags = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
        if (create) flags |= SQLiteDatabase.CREATE_IF_NECESSARY;
        if (!create) preflightExisting();
        // The default corruption handler can delete files. Keep all original material.
        database = SQLiteDatabase.openDatabase(dbFile().getPath(), rawKey, null, flags, (db, error) -> {}, null);
        database.setForeignKeyConstraintsEnabled(true);
        require(database.enableWriteAheadLogging(), "INTEGRITY_FAILED");
        // Reply provenance and other SQLite work sets may contain protected metadata.
        database.rawExecSQL("PRAGMA temp_store=MEMORY");
        database.rawExecSQL("PRAGMA synchronous=FULL");
        database.rawExecSQL("PRAGMA cache_size=-2048");
        database.rawExecSQL("PRAGMA wal_autocheckpoint=1000");
        database.rawExecSQL("PRAGMA busy_timeout=5000");
    }

    private void preflightExisting() {
        int flags = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
        database = SQLiteDatabase.openDatabase(dbFile().getPath(), rawKey, null, flags, (db, error) -> {}, null);
        try {
            int version = Integer.parseInt(scalar("PRAGMA user_version"));
            int applicationId = Integer.parseInt(scalar("PRAGMA application_id"));
            JSONObject known = catalog();
            require(version <= known.getInt("version"), "KANATA_SCHEMA_FUTURE_VERSION");
            require(version >= 0, "KANATA_SCHEMA_METADATA_INVALID");
            require(applicationId == (version == 0 ? 0 : known.getInt("applicationId")), "KANATA_SCHEMA_WRONG_DATABASE");
            verifyReadOnlySchema(known, version);
            noRows("PRAGMA cipher_integrity_check");
            noRows("SELECT * FROM pragma_foreign_key_check LIMIT 1");
            require("ok".equals(scalar("PRAGMA integrity_check(1)")), "INTEGRITY_FAILED");
        } catch (Refusal failure) { throw failure; }
        catch (Exception failure) { throw new Refusal("INTEGRITY_FAILED"); }
        finally {
            try { database.close(); }
            catch (RuntimeException failure) {
                poisoned = true;
                throw new Refusal("CLOSE_FAILED");
            } finally { database = null; }
        }
    }

    private void verifyReadOnlySchema(JSONObject known, int version) throws Exception {
        JSONObject objects = known.getJSONArray("schemas").getJSONObject(version);
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        int count = 0;
        try (Cursor rows = database.rawQuery(
            "SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name LIMIT 1025", new Object[0])) {
            while (rows.moveToNext()) {
                count++;
                JSONArray expected = objects.optJSONArray(rows.getString(1));
                String sql = rows.getString(2);
                require(expected != null && sql != null && expected.getString(0).equals(rows.getString(0)),
                    "KANATA_SCHEMA_STRUCTURE_MISMATCH");
                sql = sql.trim().replaceFirst(";$", "");
                StringBuilder digest = new StringBuilder(64);
                for (byte value : sha.digest(sql.getBytes(StandardCharsets.UTF_8))) {
                    digest.append(Character.forDigit((value & 255) >>> 4, 16)).append(Character.forDigit(value & 15, 16));
                }
                require(expected.getString(1).contentEquals(digest), "KANATA_SCHEMA_STRUCTURE_MISMATCH");
            }
        }
        require(count == objects.length(), "KANATA_SCHEMA_STRUCTURE_MISMATCH");
        if (version == 0) return;
        JSONArray journal = known.getJSONArray("journal");
        try (Cursor rows = database.rawQuery(
            "SELECT version,name,checksum FROM schema_migrations ORDER BY version LIMIT 1025", new Object[0])) {
            for (int index = 0; index < version; index++) {
                JSONObject expected = journal.getJSONObject(index);
                require(rows.moveToNext() && rows.getInt(0) == expected.getInt("version")
                    && expected.getString("name").equals(rows.getString(1))
                    && expected.getString("checksum").equals(rows.getString(2)), "KANATA_SCHEMA_JOURNAL_MISMATCH");
            }
            require(!rows.moveToNext(), "KANATA_SCHEMA_JOURNAL_MISMATCH");
        }
        if (version < 3) {
            verifyLegacyQueries(known.getJSONArray("legacyAuditChecks"), "KANATA_SCHEMA_AUDIT_CONFLICT");
            verifyLegacyQueries(known.getJSONArray("legacyRegistryChecks"), "KANATA_SCHEMA_ENTITY_REGISTRY_CONFLICT");
            return;
        }
        try (Cursor rows = database.rawQuery(
            "SELECT version,applied_at,time_source FROM schema_migration_applications ORDER BY version LIMIT 1025", new Object[0])) {
            for (int index = 0; index < version; index++) {
                require(rows.moveToNext() && rows.getInt(0) == index + 1, "KANATA_SCHEMA_TIME_JOURNAL_MISMATCH");
                String source = rows.getString(2);
                require(("legacy-unrecorded".equals(source) && index < 2 && rows.isNull(1))
                    || ("js-wall-clock-utc-ms".equals(source) && rows.getType(1) == Cursor.FIELD_TYPE_INTEGER
                        && rows.getLong(1) >= 0 && rows.getLong(1) <= MAX_SAFE_INTEGER),
                    "KANATA_SCHEMA_TIME_JOURNAL_MISMATCH");
            }
            require(!rows.moveToNext(), "KANATA_SCHEMA_TIME_JOURNAL_MISMATCH");
        }
    }

    private void verifyLegacyQueries(JSONArray checks, String code) throws Exception {
        for (int index = 0; index < checks.length(); index++) {
            try (Cursor rows = database.rawQuery(checks.getString(index), new Object[0])) {
                require(!rows.moveToNext(), code);
            }
        }
    }

    @PluginMethod public void close(PluginCall call) {
        if (!activated()) { call.resolve(); return; }
        epoch.incrementAndGet();
        dispatch(call, "CLOSE_FAILED", ignored -> { closeStorage(); call.resolve(); });
    }

    @PluginMethod public void begin(PluginCall call) {
        dispatch(call, "TRANSACTION_BUSY", requestedEpoch -> {
            authorize(call, requestedEpoch);
            require(transaction == null, "TRANSACTION_BUSY");
            database.beginTransactionNonExclusive(); // Pins the primary writer with BEGIN IMMEDIATE.
            transactionFailed = false;
            transaction = UUID.randomUUID().toString();
            call.resolve(new JSObject().put("transaction", transaction));
        });
    }

    private void authorizeTransaction(PluginCall call, long requestedEpoch) {
        authorize(call, requestedEpoch);
        require(transaction != null && transaction.equals(call.getString("transaction")), "TRANSACTION_BUSY");
    }

    private void profileStatement(PluginCall call, long start, int rows) {
        if (BuildConfig.KANATA_M2_SYNTHETIC && Log.isLoggable("KanataSqliteQA", Log.DEBUG)) {
            Log.d("KanataSqliteQA", call.getString("statement", "COMMIT")
                + " elapsedNs=" + (SystemClock.elapsedRealtimeNanos() - start) + " rows=" + rows);
        }
    }

    @PluginMethod public void commit(PluginCall call) {
        dispatch(call, "TRANSACTION_FAILED", requestedEpoch -> {
            authorizeTransaction(call, requestedEpoch);
            if (transactionFailed) {
                endRollback();
                throw new Refusal("TRANSACTION_FAILED");
            }
            database.setTransactionSuccessful();
            transaction = null;
            long start = SystemClock.elapsedRealtimeNanos();
            try { database.endTransaction(); }
            catch (RuntimeException failure) {
                // SQLCipher 4.17 ends the Java session and returns its writer to the pool
                // on failed COMMIT. The raw path bypasses session transaction handling
                // and reacquires that primary writer; nothing else can interleave here.
                try { database.rawExecSQL("ROLLBACK"); }
                catch (RuntimeException rollbackFailure) {
                    poisoned = true;
                    closeStorage();
                    throw new Refusal("ROLLBACK_FAILED");
                }
                throw new Refusal("TRANSACTION_FAILED");
            }
            profileStatement(call, start, 0);
            front(requestedEpoch, "LEASE_REVOKED");
            call.resolve();
        });
    }

    @PluginMethod public void rollback(PluginCall call) {
        dispatch(call, "ROLLBACK_FAILED", requestedEpoch -> {
            authorizeTransaction(call, requestedEpoch);
            endRollback();
            call.resolve();
        });
    }

    private void endRollback() {
        transaction = null;
        try { database.endTransaction(); }
        catch (RuntimeException failure) {
            poisoned = true;
            closeStorage();
            throw new Refusal("ROLLBACK_FAILED");
        }
    }

    private JSONObject catalog() throws Exception {
        if (catalog == null) {
            try (InputStream stream = getContext().getAssets().open("kanata-sqlite-catalog.json")) {
                ByteArrayOutputStream contents = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = stream.read(buffer)) != -1) contents.write(buffer, 0, read);
                catalog = new JSONObject(contents.toString(StandardCharsets.UTF_8.name()));
            }
        }
        return catalog;
    }

    private JSONObject statement(PluginCall call, boolean query) throws Exception {
        String id = call.getString("statement", "");
        JSONObject entry = catalog().getJSONObject("statements").optJSONObject(id);
        require(entry != null && (ready ? "business" : "schema").equals(entry.optString("phase"))
            && query == "query".equals(entry.optString("mode")), "STATEMENT_DENIED");
        return entry;
    }

    private static Object[] parameters(PluginCall call, int arity) throws Exception {
        JSONArray values = call.getArray("parameters");
        require(values != null && values.length() == arity && arity <= 256, "STATEMENT_DENIED");
        Object[] result = new Object[values.length()];
        for (int index = 0; index < result.length; index++) {
            Object value = values.get(index);
            if (values.isNull(index)) continue;
            require((value instanceof String && ((String) value).length() <= 262144)
                || (value instanceof Number && Math.abs(((Number) value).doubleValue()) <= MAX_SAFE_INTEGER), "STATEMENT_DENIED");
            result[index] = value;
        }
        return result;
    }

    @PluginMethod public void query(PluginCall call) {
        dispatch(call, "TRANSACTION_FAILED", requestedEpoch -> {
            authorizeTransaction(call, requestedEpoch);
            boolean successful = false;
            try {
                JSONObject entry = statement(call, true);
                String sql = entry.getString("sql");
                long start = SystemClock.elapsedRealtimeNanos();
                JSArray rows = new JSArray();
                try (Cursor cursor = database.rawQuery(sql, parameters(call, entry.getInt("arity")))) {
                    String[] names = cursor.getColumnNames();
                    while (cursor.moveToNext()) {
                        require(rows.length() < (ready ? 256 : 1025), "STATEMENT_DENIED");
                        JSONObject row = new JSONObject();
                        for (int col = 0; col < names.length; col++) {
                            Object value = switch (cursor.getType(col)) {
                                case Cursor.FIELD_TYPE_NULL -> JSONObject.NULL;
                                case Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(col);
                                case Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(col);
                                case Cursor.FIELD_TYPE_STRING -> cursor.getString(col);
                                default -> throw new Refusal("STATEMENT_DENIED");
                            };
                            row.put(names[col], value);
                        }
                        rows.put(row);
                    }
                }
                front(requestedEpoch, "LEASE_REVOKED");
                successful = true;
                profileStatement(call, start, rows.length());
                call.resolve(new JSObject().put("rows", rows));
            } finally { if (!successful) transactionFailed = true; }
        });
    }

    @PluginMethod public void execute(PluginCall call) {
        dispatch(call, "TRANSACTION_FAILED", requestedEpoch -> {
            authorizeTransaction(call, requestedEpoch);
            boolean successful = false;
            try {
                JSONObject entry = statement(call, false);
                String sql = entry.getString("sql");
                Object[] args = parameters(call, entry.getInt("arity"));
                long start = SystemClock.elapsedRealtimeNanos();
                int affected = 0;
                if ("ddl".equals(entry.getString("mode"))) {
                    require(args.length == 0, "STATEMENT_DENIED");
                    database.execSQL(sql);
                } else {
                    try (SQLiteStatement command = database.compileStatement(sql)) {
                        for (int i = 0; i < args.length; i++) bind(command, i + 1, args[i]);
                        affected = command.executeUpdateDelete();
                    }
                }
                front(requestedEpoch, "LEASE_REVOKED");
                successful = true;
                profileStatement(call, start, affected);
                call.resolve(new JSObject().put("affectedRows", affected));
            } finally { if (!successful) transactionFailed = true; }
        });
    }

    private static void bind(SQLiteStatement command, int index, Object value) {
        if (value == null) command.bindNull(index);
        else if (value instanceof String text) command.bindString(index, text);
        else if (value instanceof Integer || value instanceof Long) command.bindLong(index, ((Number) value).longValue());
        else command.bindDouble(index, ((Number) value).doubleValue());
    }

    private String scalar(String sql) {
        try (Cursor cursor = database.rawQuery(sql, new Object[0])) {
            require(cursor.moveToNext(), "INTEGRITY_FAILED");
            String result = cursor.getString(0);
            require(!cursor.moveToNext(), "INTEGRITY_FAILED");
            return result;
        }
    }

    private void noRows(String sql) {
        try (Cursor cursor = database.rawQuery(sql, new Object[0])) {
            require(!cursor.moveToNext(), "INTEGRITY_FAILED");
        }
    }

    private JSObject inspect() {
        require(transaction == null, "TRANSACTION_BUSY");
        database.beginTransactionNonExclusive();
        try {
            String cipher = scalar("PRAGMA cipher_version");
            require(cipher.startsWith("4.17.0") && "wal".equals(scalar("PRAGMA journal_mode"))
                && "2".equals(scalar("PRAGMA synchronous")) && "1".equals(scalar("PRAGMA foreign_keys"))
                && "2".equals(scalar("PRAGMA temp_store"))
                && "-2048".equals(scalar("PRAGMA cache_size")) && "1000".equals(scalar("PRAGMA wal_autocheckpoint"))
                && "5000".equals(scalar("PRAGMA busy_timeout")), "INTEGRITY_FAILED");
            noRows("PRAGMA cipher_integrity_check");
            noRows("SELECT * FROM pragma_foreign_key_check LIMIT 1");
            require("ok".equals(scalar("PRAGMA integrity_check(1)")), "INTEGRITY_FAILED");
            return new JSObject().put("cipher", cipher).put("journalMode", "wal").put("synchronous", 2)
                .put("foreignKeys", 1).put("cacheSize", -2048).put("checkpoint", 1000).put("busyTimeout", 5000);
        } finally {
            try { database.endTransaction(); }
            catch (RuntimeException failure) {
                poisoned = true;
                closeStorage();
                throw new Refusal("ROLLBACK_FAILED");
            }
        }
    }

    @PluginMethod public void health(PluginCall call) {
        dispatch(call, "INTEGRITY_FAILED", requestedEpoch -> {
            authorize(call, requestedEpoch);
            JSObject health = inspect();
            front(requestedEpoch, "LEASE_REVOKED");
            call.resolve(health);
        });
    }

    @PluginMethod public void completeOpen(PluginCall call) {
        dispatch(call, "INTEGRITY_FAILED", requestedEpoch -> {
            authorize(call, requestedEpoch);
            require(!ready && transaction == null, "TRANSACTION_BUSY");
            inspect();
            require(catalog().getString("applicationId").equals(scalar("PRAGMA application_id"))
                && catalog().getString("version").equals(scalar("PRAGMA user_version")), "INTEGRITY_FAILED");
            front(requestedEpoch, "LEASE_REVOKED");
            if (creating) {
                marker().delete();
                require(!atomicExists(marker()), "INCOMPLETE_CREATION");
            }
            creating = false;
            ready = true;
            call.resolve();
        });
    }
}
