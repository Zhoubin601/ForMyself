package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteReadOnlyDatabaseException;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.KanataM6SqlCipherSessionProbe;
import net.zetetic.database.sqlcipher.SQLiteConnection;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook;
import net.zetetic.database.sqlcipher.SQLiteSession;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class KanataM6N02SnapshotProbeTest {
    private static final String TAG = "KanataM6N02";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    private static void report(String key, JSONObject value) {
        Log.i(TAG, key + "=" + value.toString());
    }

    private static byte[] randomRawKey(byte[] outDekCopy) {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        if (outDekCopy != null) System.arraycopy(dek, 0, outDekCopy, 0, 32);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    private static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, new Object[0])) {
            assertTrue("Expected row for " + sql, c.moveToFirst());
            return c.getString(0);
        }
    }

    private static void setupSyntheticSchemaAndEpoch1(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
        assertTrue(db.enableWriteAheadLogging());
        db.rawExecSQL("PRAGMA temp_store=MEMORY");
        db.rawExecSQL("PRAGMA synchronous=FULL");
        db.rawExecSQL("PRAGMA wal_autocheckpoint=0"); // Keep WAL uncommitted to main db file!
        db.rawExecSQL("PRAGMA busy_timeout=5000");
        db.rawExecSQL("PRAGMA application_id=1263424577"); // 0x4b4e5441 = 'KNTA'
        db.rawExecSQL("PRAGMA user_version=5");

        db.execSQL("CREATE TABLE probe_worlds("
                + "id TEXT PRIMARY KEY, name TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE probe_messages("
                + "id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES probe_worlds(id), "
                + "body TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE probe_entity_ids("
                + "entity_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE TRIGGER trg_probe_world_entity AFTER INSERT ON probe_worlds BEGIN "
                + "INSERT INTO probe_entity_ids(entity_id, entity_type, tx_epoch) "
                + "VALUES(NEW.id, 'world', NEW.tx_epoch); END");

        db.beginTransactionNonExclusive();
        try {
            db.execSQL("INSERT INTO probe_worlds VALUES('w1', 'Abydos', 1)");
            db.execSQL("INSERT INTO probe_messages VALUES('m1', 'w1', 'epoch1-msg', 1)");
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    @Test
    public void probeSqlCipherApiAndPrimitivesAndWal() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", context.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);
        System.loadLibrary("sqlcipher");

        File dir = new File(context.getCacheDir(), "m6-n02-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcFile = new File(dir, "src.db");
        File exportFile = new File(dir, "export_target.db");
        File vacuumFile = new File(dir, "vacuum_target.db");
        File cloneSrcFile = new File(dir, "clone_src.db");
        File cloneCopyFile = new File(dir, "clone_copy.db");

        byte[] srcKey = randomRawKey(null);
        byte[] exportKey = randomRawKey(null);
        // Convert x'...' bytes to SQL single-quoted literal for ATTACH KEY
        String exportKeySqlLiteral = "'" + new String(exportKey, StandardCharsets.US_ASCII).replace("'", "''") + "'";

        try {
            // 1. Inspect SQLCipher runtime info & reflection API surface
            List<String> backupOrSnapMethods = new ArrayList<>();
            for (Class<?> cls : new Class<?>[] { SQLiteDatabase.class, SQLiteConnection.class, SQLiteSession.class }) {
                for (Method m : cls.getDeclaredMethods()) {
                    String n = m.getName().toLowerCase();
                    if (n.contains("backup") || n.contains("export") || n.contains("snapshot")
                            || n.contains("readonly") || n.contains("transaction") || n.contains("key")) {
                        backupOrSnapMethods.add(cls.getSimpleName() + "." + m.getName() + "(" + m.getParameterCount() + ")");
                    }
                }
            }

            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                    srcFile.getPath(), srcKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                setupSyntheticSchemaAndEpoch1(db);

                JSONObject apiInfo = new JSONObject()
                        .put("hasCodec", SQLiteDatabase.hasCodec())
                        .put("cipherVersion", scalar(db, "PRAGMA cipher_version"))
                        .put("sqliteVersion", scalar(db, "SELECT sqlite_version()"))
                        .put("cipherProvider", scalar(db, "PRAGMA cipher_provider"))
                        .put("cipherProviderVersion", scalar(db, "PRAGMA cipher_provider_version"))
                        .put("cipherPageSize", scalar(db, "PRAGMA cipher_page_size"))
                        .put("journalMode", scalar(db, "PRAGMA journal_mode"))
                        .put("methodsMatching", new JSONArray(backupOrSnapMethods));
                report("SQLCIPHER_RUNTIME", apiInfo);

                // Verify raw key x'...' semantics: opening with ASCII passphrase without x'' fails
                byte[] wrongPassphrase = new byte[67];
                System.arraycopy(srcKey, 0, wrongPassphrase, 0, 67);
                wrongPassphrase[2] = (byte) (wrongPassphrase[2] == '0' ? '1' : '0');
                assertThrows(SQLiteException.class, () -> {
                    try (SQLiteDatabase bad = SQLiteDatabase.openDatabase(srcFile.getPath(), wrongPassphrase, null, FLAGS_RO, (d, e) -> {}, null)) {
                        scalar(bad, "SELECT count(*) FROM probe_worlds");
                    }
                });

                // 2. Verify beginTransactionReadOnly() & rawExecSQL("BEGIN DEFERRED") lock behavior
                JSONObject lockProbes = new JSONObject();
                ExecutorService pool = Executors.newFixedThreadPool(2);
                try {
                    // 2a. beginTransactionReadOnly() actually invokes BEGIN EXCLUSIVE!
                    db.beginTransactionReadOnly();
                    try {
                        Future<String> concurrentWrite = pool.submit(() -> {
                            try (SQLiteDatabase writer2 = SQLiteDatabase.openDatabase(
                                    srcFile.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                                writer2.rawExecSQL("PRAGMA busy_timeout=50");
                                writer2.execSQL("INSERT INTO probe_worlds VALUES('w_blocked', 'Blocked', 99)");
                                return "WRITE_OK";
                            } catch (Exception e) {
                                return e.getClass().getSimpleName() + ":" + e.getMessage();
                            }
                        });
                        String wRes = concurrentWrite.get(5, TimeUnit.SECONDS);
                        lockProbes.put("beginTransactionReadOnly_concurrentWriter", wRes);
                        assertFalse("beginTransactionReadOnly unexpectedly allowed concurrent writer", "WRITE_OK".equals(wRes));
                    } finally {
                        db.endTransaction();
                    }

                    // 2b. execSQL("BEGIN DEFERRED") is intercepted by SQLiteSession.executeSpecial as BEGIN EXCLUSIVE!
                    db.execSQL("BEGIN DEFERRED");
                    try {
                        boolean hasTx = KanataM6SqlCipherSessionProbe.hasTransaction(db);
                        lockProbes.put("execSQL_beginDeferred_sessionHasTx", hasTx);
                        Future<String> concurrentWrite = pool.submit(() -> {
                            try (SQLiteDatabase writer2 = SQLiteDatabase.openDatabase(
                                    srcFile.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                                writer2.rawExecSQL("PRAGMA busy_timeout=50");
                                writer2.execSQL("INSERT INTO probe_worlds VALUES('w_blocked2', 'Blocked2', 99)");
                                return "WRITE_OK";
                            } catch (Exception e) {
                                return e.getClass().getSimpleName() + ":" + e.getMessage();
                            }
                        });
                        String wRes = concurrentWrite.get(5, TimeUnit.SECONDS);
                        lockProbes.put("execSQL_beginDeferred_concurrentWriter", wRes);
                        assertFalse("execSQL(BEGIN DEFERRED) unexpectedly allowed concurrent writer", "WRITE_OK".equals(wRes));
                    } finally {
                        db.endTransaction();
                    }

                    // 2c. rawExecSQL("BEGIN DEFERRED") bypasses executeSpecial, leaves SQLiteSession without tx & releases connection!
                    db.rawExecSQL("BEGIN DEFERRED");
                    try {
                        boolean hasTx = KanataM6SqlCipherSessionProbe.hasTransaction(db);
                        boolean hasConn = KanataM6SqlCipherSessionProbe.hasConnection(db);
                        lockProbes.put("rawExecSQL_beginDeferred_sessionHasTx", hasTx);
                        lockProbes.put("rawExecSQL_beginDeferred_sessionHasConn", hasConn);
                        assertFalse(hasTx);
                        assertFalse(hasConn);
                    } finally {
                        try { db.rawExecSQL("ROLLBACK"); } catch (Throwable ignored) {}
                    }
                } finally {
                    pool.shutdownNow();
                }
                report("LOCK_TRAPS", lockProbes);

                // 3. Probe VACUUM INTO on encrypted WAL database
                JSONObject vacuumReport = new JSONObject();
                try {
                    db.execSQL("VACUUM INTO ?", new Object[] { vacuumFile.getPath() });
                    vacuumReport.put("executed", true);
                    // Check if output is plaintext or encrypted
                    byte[] head = new byte[16];
                    try (FileInputStream fis = new FileInputStream(vacuumFile)) {
                        int n = fis.read(head);
                        vacuumReport.put("bytesRead", n);
                        vacuumReport.put("startsWithSqliteHeader",
                                new String(head, 0, Math.max(0, n), StandardCharsets.ISO_8859_1).startsWith("SQLite format 3"));
                    }
                    // Can plain Android SQLite open it?
                    try (var plain = android.database.sqlite.SQLiteDatabase.openDatabase(
                            vacuumFile.getPath(), null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY)) {
                        try (Cursor c = plain.rawQuery("SELECT count(*) FROM probe_worlds", null)) {
                            c.moveToFirst();
                            vacuumReport.put("plainSqliteReadable", true);
                            vacuumReport.put("plainWorldCount", c.getInt(0));
                        }
                    } catch (Throwable t) {
                        vacuumReport.put("plainSqliteReadable", false);
                        vacuumReport.put("plainSqliteError", t.getClass().getSimpleName() + ":" + t.getMessage());
                    }
                    // Can source key open it?
                    try (SQLiteDatabase reopenSrcKey = SQLiteDatabase.openDatabase(
                            vacuumFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        vacuumReport.put("sourceKeyReadable", true);
                        vacuumReport.put("sourceKeyWorldCount", scalar(reopenSrcKey, "SELECT count(*) FROM probe_worlds"));
                        vacuumReport.put("sourceKeyUserVersion", scalar(reopenSrcKey, "PRAGMA user_version"));
                        vacuumReport.put("sourceKeyAppId", scalar(reopenSrcKey, "PRAGMA application_id"));
                    } catch (Throwable t) {
                        vacuumReport.put("sourceKeyReadable", false);
                        vacuumReport.put("sourceKeyError", t.getClass().getSimpleName() + ":" + t.getMessage());
                    }
                } catch (Throwable t) {
                    vacuumReport.put("executed", false);
                    vacuumReport.put("error", t.getClass().getSimpleName() + ":" + t.getMessage());
                }
                report("VACUUM_INTO_PROBE", vacuumReport);

                // 4. Probe sqlcipher_export() with independent random DEK & uncommitted WAL
                JSONObject exportReport = new JSONObject();
                // Write a WAL-only transaction (autocheckpoint=0)
                db.beginTransactionNonExclusive();
                try {
                    db.execSQL("INSERT INTO probe_worlds VALUES('w_wal', 'WalOnly', 1)");
                    db.execSQL("INSERT INTO probe_messages VALUES('m_wal', 'w_wal', 'wal-uncheckpointed', 1)");
                    db.setTransactionSuccessful();
                } finally {
                    db.endTransaction();
                }
                File walFile = new File(srcFile.getPath() + "-wal");
                exportReport.put("walBytesBeforeExport", walFile.exists() ? walFile.length() : 0L);

                // 4a. Test ATTACH + sqlcipher_export inside a transaction (SQLite forbids ATTACH inside active tx!)
                db.beginTransactionNonExclusive();
                try {
                    try {
                        // Force SQLite to actually start the tx before ATTACH, or test ATTACH + sqlcipher_export inside tx
                        scalar(db, "SELECT count(*) FROM probe_worlds");
                        db.rawExecSQL("ATTACH DATABASE '" + new File(dir, "exp_tx.db").getPath() + "' AS exp_tx KEY " + exportKeySqlLiteral);
                        exportReport.put("attachInsideTxAllowed", true);
                        try { db.rawExecSQL("DETACH DATABASE exp_tx"); } catch (Throwable ignored) {}
                    } catch (Throwable t) {
                        exportReport.put("attachInsideTxAllowed", false);
                        exportReport.put("attachInsideTxError", t.getClass().getSimpleName() + ":" + t.getMessage());
                    }
                } finally {
                    db.endTransaction();
                    SQLiteDatabase.deleteDatabase(new File(dir, "exp_tx.db"));
                }

                // 4b. Test sqlcipher_export on OPEN_READONLY connection (separate file path)
                File exportRoFile = new File(dir, "export_ro_target.db");
                try (SQLiteDatabase roDb = SQLiteDatabase.openDatabase(
                        srcFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    try {
                        roDb.rawExecSQL("ATTACH DATABASE '" + exportRoFile.getPath() + "' AS exp_ro KEY " + exportKeySqlLiteral);
                        scalar(roDb, "SELECT sqlcipher_export('exp_ro')");
                        roDb.rawExecSQL("DETACH DATABASE exp_ro");
                        exportReport.put("exportOnReadOnlyConnection", "SUCCEEDED");
                    } catch (Throwable t) {
                        exportReport.put("exportOnReadOnlyConnection", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                    }
                } finally {
                    SQLiteDatabase.deleteDatabase(exportRoFile);
                }

                // 4c. Test sqlcipher_export on OPEN_READWRITE connection (non-tx, clean attach name)
                try {
                    db.rawExecSQL("ATTACH DATABASE '" + exportFile.getPath() + "' AS exp KEY " + exportKeySqlLiteral);
                    scalar(db, "SELECT sqlcipher_export('exp')");
                    db.rawExecSQL("DETACH DATABASE exp");
                    exportReport.put("exportOnReadWriteNonTx", "SUCCEEDED");

                    // Inspect exported file with new independent DEK in fresh connection
                    try (SQLiteDatabase target = SQLiteDatabase.openDatabase(
                            exportFile.getPath(), exportKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        exportReport.put("targetUserVersion", scalar(target, "PRAGMA user_version"));
                        exportReport.put("targetAppId", scalar(target, "PRAGMA application_id"));
                        exportReport.put("targetWorldCount", scalar(target, "SELECT count(*) FROM probe_worlds"));
                        exportReport.put("targetEntityCount", scalar(target, "SELECT count(*) FROM probe_entity_ids"));
                        exportReport.put("targetHasWalRow", scalar(target, "SELECT count(*) FROM probe_worlds WHERE id='w_wal'"));
                        exportReport.put("targetIntegrity", scalar(target, "PRAGMA integrity_check(1)"));
                    }
                    // Verify source DEK rejected on target
                    assertThrows(SQLiteException.class, () -> {
                        try (SQLiteDatabase wrong = SQLiteDatabase.openDatabase(
                                exportFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                            scalar(wrong, "SELECT count(*) FROM probe_worlds");
                        }
                    });
                    exportReport.put("targetRejectsSourceKey", true);
                } catch (Throwable t) {
                    exportReport.put("exportOnReadWriteNonTx", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                }
                report("SQLCIPHER_EXPORT_PROBE", exportReport);

                // 5. Real DEFERRED Read-Only Transaction WAL Snapshot Pinning & Concurrency Test
                JSONObject walReport = new JSONObject();
                try (SQLiteDatabase roConn = SQLiteDatabase.openDatabase(
                        srcFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {

                    // 5a. Check what happens on OPEN_READONLY with public beginTransactionNonExclusive()
                    try {
                        roConn.beginTransactionNonExclusive();
                        roConn.endTransaction();
                        walReport.put("openReadOnly_beginNonExclusive", "SUCCEEDED");
                    } catch (Throwable t) {
                        walReport.put("openReadOnly_beginNonExclusive", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                    }

                    // 5b. Start true TRANSACTION_MODE_DEFERRED on OPEN_READONLY connection
                    KanataM6SqlCipherSessionProbe.beginDeferredTransaction(roConn, true, null);
                    try {
                        // First SELECT pins the WAL snapshot!
                        String epochBefore = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds");
                        String msgBefore = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_messages");
                        String entBefore = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_entity_ids");
                        walReport.put("snapshotStart_worlds", epochBefore);
                        walReport.put("snapshotStart_messages", msgBefore);
                        walReport.put("snapshotStart_entities", entBefore);

                        // Attempt write on OPEN_READONLY must fail
                        try {
                            roConn.execSQL("INSERT INTO probe_worlds VALUES('w_ro', 'Bad', 9)");
                            walReport.put("openReadOnly_writeRejected", false);
                        } catch (SQLiteException expected) {
                            walReport.put("openReadOnly_writeRejected", true);
                            walReport.put("openReadOnly_writeError", expected.getClass().getSimpleName() + ":" + expected.getMessage());
                        }

                        // Concurrently on RW connection:
                        // (1) Commit T2 (epoch=2) across all tables
                        // (2) Start UNCOMMITTED T3 (epoch=3) writing half of tables
                        // (3) Attempt WAL checkpoint(TRUNCATE) while reader pins snapshot -> must report busy=1
                        ExecutorService writerPool = Executors.newFixedThreadPool(2);
                        try {
                            Future<JSONObject> writerFuture = writerPool.submit(() -> {
                                JSONObject wOut = new JSONObject();
                                long tStartNs = System.nanoTime();
                                db.beginTransactionNonExclusive();
                                try {
                                    db.execSQL("INSERT INTO probe_worlds VALUES('w2', 'Gehenna', 2)");
                                    db.execSQL("INSERT INTO probe_messages VALUES('m2', 'w2', 'epoch2-msg', 2)");
                                    db.setTransactionSuccessful();
                                } finally {
                                    db.endTransaction();
                                }
                                wOut.put("t2CommittedWhileReaderPinned", true);
                                wOut.put("t2CommitMs", (System.nanoTime() - tStartNs) / 1_000_000L);

                                // Checkpoint must be busy because roConn pinned WAL; use 50ms timeout so test doesn't wait 5s
                                db.rawExecSQL("PRAGMA busy_timeout=50");
                                try (Cursor ck = db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                                    assertTrue(ck.moveToFirst());
                                    wOut.put("checkpointBusy", ck.getInt(0));
                                    wOut.put("checkpointLog", ck.getInt(1));
                                    wOut.put("checkpointCheckpointed", ck.getInt(2));
                                } finally {
                                    db.rawExecSQL("PRAGMA busy_timeout=5000");
                                }
                                return wOut;
                            });
                            JSONObject wRes = writerFuture.get(15, TimeUnit.SECONDS);
                            walReport.put("concurrentWriterResult", wRes);

                            // Start uncommitted T3 on a separate RW connection on another thread
                            CountDownLatch t3Inserted = new CountDownLatch(1);
                            CountDownLatch releaseT3 = new CountDownLatch(1);
                            Future<String> t3Future = writerPool.submit(() -> {
                                try (SQLiteDatabase db3 = SQLiteDatabase.openDatabase(
                                        srcFile.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                                    db3.rawExecSQL("PRAGMA busy_timeout=50");
                                    db3.beginTransactionNonExclusive();
                                    try {
                                        db3.execSQL("INSERT INTO probe_worlds VALUES('w3', 'TrinityUncommitted', 3)");
                                        t3Inserted.countDown();
                                        releaseT3.await(5, TimeUnit.SECONDS);
                                    } finally {
                                        db3.endTransaction(); // Rolls back T3!
                                    }
                                    return "T3_ROLLED_BACK";
                                }
                            });
                            assertTrue(t3Inserted.await(5, TimeUnit.SECONDS));

                            // While T2 is committed and T3 is in-flight uncommitted:
                            // roConn inside SAME DEFERRED transaction MUST still see ONLY epoch=1!
                            String epochMid = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds");
                            String msgMid = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_messages");
                            String entMid = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_entity_ids");
                            String schemaCount = scalar(roConn, "SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'");
                            assertEquals(epochBefore, epochMid);
                            assertEquals(msgBefore, msgMid);
                            assertEquals(entBefore, entMid);
                            walReport.put("snapshotMid_worlds", epochMid);
                            walReport.put("snapshotMid_messages", msgMid);
                            walReport.put("snapshotMid_entities", entMid);
                            walReport.put("snapshotMid_schemaCount", schemaCount);
                            walReport.put("crossTableInvariantPreserved", true);

                            // Concurrent second reader sees T2 (committed) but NOT uncommitted T3
                            try (SQLiteDatabase ro2 = SQLiteDatabase.openDatabase(
                                    srcFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                                KanataM6SqlCipherSessionProbe.beginDeferredTransaction(ro2, true, null);
                                try {
                                    walReport.put("concurrentReader2_worlds", scalar(ro2, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds"));
                                    assertEquals("3:2", scalar(ro2, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds"));
                                } finally {
                                    ro2.endTransaction();
                                }
                            }

                            releaseT3.countDown();
                            walReport.put("t3Status", t3Future.get(5, TimeUnit.SECONDS));
                        } finally {
                            writerPool.shutdownNow();
                        }
                    } finally {
                        roConn.endTransaction();
                    }

                    // After ending DEFERRED transaction, new DEFERRED transaction sees T2 (3:2), not rolled-back T3
                    KanataM6SqlCipherSessionProbe.beginDeferredTransaction(roConn, true, null);
                    try {
                        String afterEnd = scalar(roConn, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds");
                        assertEquals("3:2", afterEnd);
                        walReport.put("afterRelease_newSnapshot_worlds", afterEnd);
                    } finally {
                        roConn.endTransaction();
                    }

                    // CancellationSignal probe
                    CancellationSignal sig = new CancellationSignal();
                    sig.cancel();
                    try {
                        try (Cursor c = roConn.rawQuery("SELECT count(*) FROM probe_worlds", new String[0], sig)) {
                            c.moveToFirst();
                        }
                        walReport.put("cancelRejected", false);
                    } catch (OperationCanceledException expected) {
                        walReport.put("cancelRejected", true);
                    }
                    // Verify connection still healthy after cancel
                    assertEquals("3", scalar(roConn, "SELECT count(*) FROM probe_worlds"));
                    walReport.put("healthyAfterCancel", true);
                }

                // Checkpoint now succeeds with busy=0 after reader released
                try (Cursor ck = db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                    assertTrue(ck.moveToFirst());
                    walReport.put("postReleaseCheckpointBusy", ck.getInt(0));
                }

                // 5c. Same SQLiteDatabase pool behavior:
                // SQLiteConnectionPool.waitForConnection() gives mAvailablePrimaryConnection to a read-only
                // request whenever mAvailableNonPrimaryConnections is empty! Verify that holding a DEFERRED
                // tx on the same pool blocks a subsequent writer on that same pool, whereas separate
                // OPEN_READONLY instance (tested in 5b) does not block writers.
                ExecutorService samePoolExec = Executors.newSingleThreadExecutor();
                try {
                    CountDownLatch samePoolPinned = new CountDownLatch(1);
                    CountDownLatch releaseSamePool = new CountDownLatch(1);
                    Future<String> samePoolReader = samePoolExec.submit(() -> {
                        KanataM6SqlCipherSessionProbe.beginDeferredTransaction(db, true, null);
                        try {
                            String v = scalar(db, "SELECT count(*) || ':' || max(tx_epoch) FROM probe_worlds");
                            samePoolPinned.countDown();
                            releaseSamePool.await(10, TimeUnit.SECONDS);
                            return v;
                        } finally {
                            db.endTransaction();
                        }
                    });
                    assertTrue(samePoolPinned.await(10, TimeUnit.SECONDS));
                    ExecutorService samePoolWriterExec = Executors.newSingleThreadExecutor();
                    try {
                        Future<String> blockedWriter = samePoolWriterExec.submit(() -> {
                            db.beginTransactionNonExclusive();
                            try {
                                return "ACQUIRED";
                            } finally {
                                db.endTransaction();
                            }
                        });
                        boolean writerBlockedBySamePoolPrimary = false;
                        try {
                            blockedWriter.get(300, TimeUnit.MILLISECONDS);
                        } catch (java.util.concurrent.TimeoutException expected) {
                            writerBlockedBySamePoolPrimary = true;
                        }
                        walReport.put("samePoolReaderGrabsPrimaryAndBlocksWriter", writerBlockedBySamePoolPrimary);
                        assertTrue(writerBlockedBySamePoolPrimary);
                        releaseSamePool.countDown();
                        assertEquals("ACQUIRED", blockedWriter.get(5, TimeUnit.SECONDS));
                        assertEquals("3:2", samePoolReader.get(5, TimeUnit.SECONDS));
                    } finally {
                        samePoolWriterExec.shutdownNow();
                    }
                } finally {
                    samePoolExec.shutdownNow();
                }
                report("WAL_SNAPSHOT_PROBE", walReport);
            }

            // 6. Disposable synthetic clone: freeze -> checkpoint -> close all -> verify sidecars -> copy
            JSONObject cloneReport = new JSONObject();
            try (SQLiteDatabase cloneDb = SQLiteDatabase.openDatabase(
                    cloneSrcFile.getPath(), srcKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                setupSyntheticSchemaAndEpoch1(cloneDb);
                try (Cursor ck = cloneDb.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                    assertTrue(ck.moveToFirst());
                    cloneReport.put("checkpointBusy", ck.getInt(0));
                    cloneReport.put("checkpointLog", ck.getInt(1));
                    cloneReport.put("checkpointDone", ck.getInt(2));
                }
            }
            File cloneWal = new File(cloneSrcFile.getPath() + "-wal");
            File cloneShm = new File(cloneSrcFile.getPath() + "-shm");
            cloneReport.put("walExistsAfterClose", cloneWal.exists());
            cloneReport.put("walLengthAfterClose", cloneWal.exists() ? cloneWal.length() : 0L);
            cloneReport.put("shmExistsAfterClose", cloneShm.exists());
            cloneReport.put("shmLengthAfterClose", cloneShm.exists() ? cloneShm.length() : 0L);

            try (FileInputStream fis = new FileInputStream(cloneSrcFile);
                 FileOutputStream fos = new FileOutputStream(cloneCopyFile)) {
                byte[] buf = new byte[8192];
                int r;
                while ((r = fis.read(buf)) != -1) fos.write(buf, 0, r);
                fos.getFD().sync();
            }
            // Note: raw copy retains source DEK! Cannot be opened with independent exportKey without rekey.
            try (SQLiteDatabase copyWithSrcKey = SQLiteDatabase.openDatabase(
                    cloneCopyFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                cloneReport.put("copyOpensWithSourceKey", true);
                cloneReport.put("copyIntegrity", scalar(copyWithSrcKey, "PRAGMA integrity_check(1)"));
                cloneReport.put("copyWorldCount", scalar(copyWithSrcKey, "SELECT count(*) FROM probe_worlds"));
                cloneReport.put("copyUserVersion", scalar(copyWithSrcKey, "PRAGMA user_version"));
                cloneReport.put("copyAppId", scalar(copyWithSrcKey, "PRAGMA application_id"));
            }
            assertThrows(SQLiteException.class, () -> {
                try (SQLiteDatabase wrong = SQLiteDatabase.openDatabase(
                        cloneCopyFile.getPath(), exportKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    scalar(wrong, "SELECT count(*) FROM probe_worlds");
                }
            });
            cloneReport.put("copyRetainsSourceDekWithoutRekey", true);
            report("DISPOSABLE_CLONE_PROBE", cloneReport);
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(exportKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcFile);
            SQLiteDatabase.deleteDatabase(exportFile);
            SQLiteDatabase.deleteDatabase(vacuumFile);
            SQLiteDatabase.deleteDatabase(cloneSrcFile);
            SQLiteDatabase.deleteDatabase(cloneCopyFile);
            dir.delete();
        }
    }

    private static String logicalSnapshotDigest(SQLiteDatabase db) throws Exception {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
        for (String table : new String[] { "probe_worlds", "probe_messages", "probe_entity_ids" }) {
            try (Cursor c = db.rawQuery("SELECT * FROM " + table + " ORDER BY 1", new Object[0])) {
                md.update(table.getBytes(StandardCharsets.UTF_8));
                int cols = c.getColumnCount();
                while (c.moveToNext()) {
                    for (int i = 0; i < cols; i++) {
                        String val = c.isNull(i) ? "<NULL>" : c.getString(i);
                        md.update(val.getBytes(StandardCharsets.UTF_8));
                        md.update((byte) '|');
                    }
                    md.update((byte) '\n');
                }
            }
        }
        byte[] d = md.digest();
        StringBuilder sb = new StringBuilder(64);
        for (byte b : d) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    private static JSONArray schemaListing(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        try (Cursor c = db.rawQuery(
                "SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name",
                new Object[0])) {
            while (c.moveToNext()) {
                arr.put(c.getString(0) + ":" + c.getString(1) + ":" + c.getString(2));
            }
        }
        return arr;
    }

    private static void noRows(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, new Object[0])) {
            assertFalse("Expected zero rows for " + sql, c.moveToNext());
        }
    }

    private static void setupFullSchemeASyntheticDb(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
        assertTrue(db.enableWriteAheadLogging());
        db.rawExecSQL("PRAGMA temp_store=MEMORY");
        db.rawExecSQL("PRAGMA synchronous=FULL");
        db.rawExecSQL("PRAGMA wal_autocheckpoint=0");
        db.rawExecSQL("PRAGMA busy_timeout=5000");
        db.rawExecSQL("PRAGMA application_id=1263424577");
        db.rawExecSQL("PRAGMA user_version=5");

        db.execSQL("CREATE TABLE probe_worlds("
                + "id TEXT PRIMARY KEY, name TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE probe_messages("
                + "id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES probe_worlds(id), "
                + "body TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX idx_probe_msg_world ON probe_messages(world_id, tx_epoch)");
        db.execSQL("CREATE TABLE probe_entity_ids("
                + "entity_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, tx_epoch INTEGER NOT NULL)");
        db.execSQL("CREATE TRIGGER trg_probe_world_entity AFTER INSERT ON probe_worlds BEGIN "
                + "INSERT INTO probe_entity_ids(entity_id, entity_type, tx_epoch) "
                + "VALUES(NEW.id, 'world', NEW.tx_epoch); END");

        db.beginTransactionNonExclusive();
        try {
            db.execSQL("INSERT INTO probe_worlds VALUES('w1', 'Abydos', 1)");
            db.execSQL("INSERT INTO probe_messages VALUES('m1', 'w1', 'epoch1-msg', 1)");
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        // Second committed WAL transaction left uncheckpointed
        db.beginTransactionNonExclusive();
        try {
            db.execSQL("INSERT INTO probe_worlds VALUES('w2', 'Gehenna', 2)");
            db.execSQL("INSERT INTO probe_messages VALUES('m2', 'w2', 'wal-committed-msg', 2)");
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    @Test
    public void probeSchemeAExportMetadataAndCloneRekey() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", context.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);
        System.loadLibrary("sqlcipher");

        File dir = new File(context.getCacheDir(), "m6-f07-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcAFile = new File(dir, "src_a.db");
        File expAFile = new File(dir, "exp_a_target.db");
        File cloneSrcFile = new File(dir, "clone_src.db");
        File cloneCopyFile = new File(dir, "clone_rekey_target.db");

        byte[] srcKey = randomRawKey(null);
        byte[] exportKey = randomRawKey(null);
        byte[] rekeyTargetKey = randomRawKey(null);
        String exportKeySqlLiteral = "'" + new String(exportKey, StandardCharsets.US_ASCII).replace("'", "''") + "'";

        try {
            // === Experiment A: sqlcipher_export + explicit user_version / application_id restoration before DETACH ===
            JSONObject expAReport = new JSONObject();
            try (SQLiteDatabase srcDb = SQLiteDatabase.openDatabase(
                    srcAFile.getPath(), srcKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                setupFullSchemeASyntheticDb(srcDb);
                String srcDigestBefore = logicalSnapshotDigest(srcDb);
                String srcSchemaBefore = schemaListing(srcDb).toString();
                long walLen = new File(srcAFile.getPath() + "-wal").length();
                expAReport.put("walBytesBeforeExport", walLen);
                assertTrue("Expected uncommitted-to-main WAL bytes > 0", walLen > 0);

                // Verify uncommitted concurrent transaction is NOT included in export, or observe BUSY behavior
                ExecutorService concExec = Executors.newSingleThreadExecutor();
                CountDownLatch roPinned = new CountDownLatch(1);
                CountDownLatch roRelease = new CountDownLatch(1);
                Future<String> roHold = concExec.submit(() -> {
                    try (SQLiteDatabase ro = SQLiteDatabase.openDatabase(
                            srcAFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        KanataM6SqlCipherSessionProbe.beginDeferredTransaction(ro, true, null);
                        try {
                            String v = scalar(ro, "SELECT count(*) FROM probe_worlds");
                            roPinned.countDown();
                            roRelease.await(10, TimeUnit.SECONDS);
                            return v;
                        } finally {
                            ro.endTransaction();
                        }
                    }
                });
                assertTrue(roPinned.await(10, TimeUnit.SECONDS));

                try {
                    srcDb.rawExecSQL("ATTACH DATABASE '" + expAFile.getPath() + "' AS exp_a KEY " + exportKeySqlLiteral);
                    scalar(srcDb, "SELECT sqlcipher_export('exp_a')");
                    srcDb.rawExecSQL("PRAGMA exp_a.user_version = 5");
                    srcDb.rawExecSQL("PRAGMA exp_a.application_id = 1263424577");
                    srcDb.rawExecSQL("DETACH DATABASE exp_a");
                    expAReport.put("exportWithActiveReaderSucceeded", true);
                } finally {
                    roRelease.countDown();
                    assertEquals("2", roHold.get(5, TimeUnit.SECONDS));
                    concExec.shutdownNow();
                }

                // Reopen target with independent random DEK
                try (SQLiteDatabase targetDb = SQLiteDatabase.openDatabase(
                        expAFile.getPath(), exportKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                    targetDb.setForeignKeyConstraintsEnabled(true);
                    expAReport.put("targetUserVersion", scalar(targetDb, "PRAGMA user_version"));
                    expAReport.put("targetAppId", scalar(targetDb, "PRAGMA application_id"));
                    expAReport.put("targetIntegrity", scalar(targetDb, "PRAGMA integrity_check"));
                    noRows(targetDb, "PRAGMA cipher_integrity_check");
                    noRows(targetDb, "SELECT * FROM pragma_foreign_key_check");
                    expAReport.put("targetCipherAndFkOk", true);

                    String targetSchema = schemaListing(targetDb).toString();
                    String targetDigest = logicalSnapshotDigest(targetDb);
                    assertEquals(srcSchemaBefore, targetSchema);
                    assertEquals(srcDigestBefore, targetDigest);
                    expAReport.put("schemaExactMatch", true);
                    expAReport.put("logicalDigestExactMatch", true);
                    expAReport.put("logicalDigestHex", targetDigest);
                    expAReport.put("targetWorldCount", scalar(targetDb, "SELECT count(*) FROM probe_worlds"));
                    expAReport.put("targetMessageCount", scalar(targetDb, "SELECT count(*) FROM probe_messages"));
                    expAReport.put("targetEntityCount", scalar(targetDb, "SELECT count(*) FROM probe_entity_ids"));

                    // Verify triggers & FK actually enforce on reopened target
                    targetDb.execSQL("INSERT INTO probe_worlds VALUES('w_post', 'Trinity', 3)");
                    assertEquals("3", scalar(targetDb, "SELECT count(*) FROM probe_entity_ids"));
                    try {
                        targetDb.execSQL("INSERT INTO probe_messages VALUES('m_bad', 'missing_world', 'bad', 3)");
                        fail("FK must reject invalid world_id on target");
                    } catch (SQLiteException expectedFk) {
                        expAReport.put("targetFkEnforcedAfterReopen", true);
                    }
                }

                // Verify source DEK is rejected on target
                assertThrows(SQLiteException.class, () -> {
                    try (SQLiteDatabase wrong = SQLiteDatabase.openDatabase(
                            expAFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        scalar(wrong, "SELECT count(*) FROM probe_worlds");
                    }
                });
                expAReport.put("sourceDekRejectedOnTarget", true);

                // Verify source database unchanged
                assertEquals(srcDigestBefore, logicalSnapshotDigest(srcDb));
                assertEquals(srcSchemaBefore, schemaListing(srcDb).toString());
                assertEquals("5", scalar(srcDb, "PRAGMA user_version"));
                assertEquals("1263424577", scalar(srcDb, "PRAGMA application_id"));
                expAReport.put("sourceUnchanged", true);

                // Additional WAL concurrency check for sqlcipher_export: uncommitted writer on separate RW conn
                File expAConcFile = new File(dir, "exp_a_conc.db");
                ExecutorService uncommExec = Executors.newSingleThreadExecutor();
                CountDownLatch uncommReady = new CountDownLatch(1);
                CountDownLatch uncommRelease = new CountDownLatch(1);
                Future<String> uncommWriter = uncommExec.submit(() -> {
                    try (SQLiteDatabase w2 = SQLiteDatabase.openDatabase(
                            srcAFile.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                        w2.rawExecSQL("PRAGMA busy_timeout=50");
                        w2.beginTransactionNonExclusive();
                        try {
                            w2.execSQL("INSERT INTO probe_worlds VALUES('w_uncomm', 'Uncommitted', 99)");
                            uncommReady.countDown();
                            uncommRelease.await(10, TimeUnit.SECONDS);
                        } finally {
                            w2.endTransaction();
                        }
                        return "ROLLED_BACK";
                    }
                });
                assertTrue(uncommReady.await(5, TimeUnit.SECONDS));
                try {
                    srcDb.rawExecSQL("ATTACH DATABASE '" + expAConcFile.getPath() + "' AS exp_ac KEY " + exportKeySqlLiteral);
                    scalar(srcDb, "SELECT sqlcipher_export('exp_ac')");
                    srcDb.rawExecSQL("PRAGMA exp_ac.user_version = 5");
                    srcDb.rawExecSQL("PRAGMA exp_ac.application_id = 1263424577");
                    srcDb.rawExecSQL("DETACH DATABASE exp_ac");
                    try (SQLiteDatabase concTarget = SQLiteDatabase.openDatabase(
                            expAConcFile.getPath(), exportKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        String cnt = scalar(concTarget, "SELECT count(*) FROM probe_worlds");
                        expAReport.put("exportDuringUncommittedWriter", "SUCCEEDED_EXCLUDES_UNCOMMITTED_COUNT_" + cnt);
                        assertEquals("2", cnt);
                    }
                } catch (Throwable t) {
                    expAReport.put("exportDuringUncommittedWriter", "FAILED:" + t.getClass().getSimpleName() + ":" + t.getMessage());
                    try { srcDb.rawExecSQL("DETACH DATABASE exp_ac"); } catch (Throwable ignored) {}
                } finally {
                    uncommRelease.countDown();
                    assertEquals("ROLLED_BACK", uncommWriter.get(5, TimeUnit.SECONDS));
                    uncommExec.shutdownNow();
                    SQLiteDatabase.deleteDatabase(expAConcFile);
                }
            }
            report("F07_EXP_A_SQLCIPHER_EXPORT_META", expAReport);

            // === Experiment B: Disposable Clone + Checkpoint + Close + Copy + Open(srcKey) + Rekey(newDek) ===
            JSONObject expBReport = new JSONObject();
            String cloneOrigDigest;
            String cloneOrigSchema;
            // Step 1: Create disposable synthetic clone with WAL data
            try (SQLiteDatabase cloneDb = SQLiteDatabase.openDatabase(
                    cloneSrcFile.getPath(), srcKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
                setupFullSchemeASyntheticDb(cloneDb);
                cloneOrigDigest = logicalSnapshotDigest(cloneDb);
                cloneOrigSchema = schemaListing(cloneDb).toString();
                expBReport.put("walBytesBeforeCheckpoint", new File(cloneSrcFile.getPath() + "-wal").length());

                // Step 2: Complete checkpoint
                try (Cursor ck = cloneDb.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                    assertTrue(ck.moveToFirst());
                    expBReport.put("checkpointBusy", ck.getInt(0));
                    expBReport.put("checkpointLog", ck.getInt(1));
                    expBReport.put("checkpointCheckpointed", ck.getInt(2));
                    assertEquals(0, ck.getInt(0));
                }
            } // Step 3: All connections closed

            // Step 4: Verify WAL/SHM sidecar state
            File cloneWal = new File(cloneSrcFile.getPath() + "-wal");
            File cloneShm = new File(cloneSrcFile.getPath() + "-shm");
            expBReport.put("walExistsAfterClose", cloneWal.exists());
            expBReport.put("walBytesAfterClose", cloneWal.exists() ? cloneWal.length() : 0L);
            expBReport.put("shmExistsAfterClose", cloneShm.exists());
            expBReport.put("shmBytesAfterClose", cloneShm.exists() ? cloneShm.length() : 0L);

            // Step 5: Copy database file
            try (FileInputStream fis = new FileInputStream(cloneSrcFile);
                 FileOutputStream fos = new FileOutputStream(cloneCopyFile)) {
                byte[] buf = new byte[8192];
                int r;
                while ((r = fis.read(buf)) != -1) fos.write(buf, 0, r);
                fos.getFD().sync();
            }

            // Step 6 & 7: Open copy with source test key & attempt SQLCipher rekey to independent random test DEK
            try (SQLiteDatabase rekeyDb = SQLiteDatabase.openDatabase(
                    cloneCopyFile.getPath(), srcKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                expBReport.put("copyJournalModeBeforeRekey", scalar(rekeyDb, "PRAGMA journal_mode"));
                try {
                    rekeyDb.changePassword(rekeyTargetKey);
                    expBReport.put("rekeyMethod", "SQLiteDatabase.changePassword(byte[])");
                    expBReport.put("rekeySucceeded", true);
                } catch (Throwable t) {
                    expBReport.put("rekeyMethod", "SQLiteDatabase.changePassword(byte[])");
                    expBReport.put("rekeySucceeded", false);
                    expBReport.put("rekeyError", t.getClass().getSimpleName() + ":" + t.getMessage());
                }
            } // Step 8: Close copy

            // Step 8b & 9: Reopen copy with new key & reject old key
            if (expBReport.optBoolean("rekeySucceeded", false)) {
                try (SQLiteDatabase reopened = SQLiteDatabase.openDatabase(
                        cloneCopyFile.getPath(), rekeyTargetKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    expBReport.put("reopenNewKeySucceeded", true);
                    expBReport.put("targetUserVersion", scalar(reopened, "PRAGMA user_version"));
                    expBReport.put("targetAppId", scalar(reopened, "PRAGMA application_id"));
                    expBReport.put("targetIntegrity", scalar(reopened, "PRAGMA integrity_check"));
                    noRows(reopened, "PRAGMA cipher_integrity_check");
                    noRows(reopened, "SELECT * FROM pragma_foreign_key_check");
                    assertEquals("5", scalar(reopened, "PRAGMA user_version"));
                    assertEquals("1263424577", scalar(reopened, "PRAGMA application_id"));
                    assertEquals(cloneOrigSchema, schemaListing(reopened).toString());
                    assertEquals(cloneOrigDigest, logicalSnapshotDigest(reopened));
                    expBReport.put("schemaAndDigestExactMatch", true);
                }
                assertThrows(SQLiteException.class, () -> {
                    try (SQLiteDatabase oldKeyDb = SQLiteDatabase.openDatabase(
                            cloneCopyFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                        scalar(oldKeyDb, "SELECT count(*) FROM probe_worlds");
                    }
                });
                expBReport.put("oldKeyRejectedAfterRekey", true);
            }

            // Step 10: Verify original disposable clone source DB has no logical changes
            try (SQLiteDatabase verifySrc = SQLiteDatabase.openDatabase(
                    cloneSrcFile.getPath(), srcKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals(cloneOrigDigest, logicalSnapshotDigest(verifySrc));
                assertEquals(cloneOrigSchema, schemaListing(verifySrc).toString());
                assertEquals("5", scalar(verifySrc, "PRAGMA user_version"));
                assertEquals("1263424577", scalar(verifySrc, "PRAGMA application_id"));
                expBReport.put("originalSourceUnchanged", true);
            }
            report("F07_EXP_B_CLONE_AND_REKEY", expBReport);
        } finally {
            Arrays.fill(srcKey, (byte) 0);
            Arrays.fill(exportKey, (byte) 0);
            Arrays.fill(rekeyTargetKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcAFile);
            SQLiteDatabase.deleteDatabase(expAFile);
            SQLiteDatabase.deleteDatabase(cloneSrcFile);
            SQLiteDatabase.deleteDatabase(cloneCopyFile);
            dir.delete();
        }
    }
}
