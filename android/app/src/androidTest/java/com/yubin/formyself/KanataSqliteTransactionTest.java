package com.yubin.formyself;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteConstraintException;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

@RunWith(AndroidJUnit4.class)
public class KanataSqliteTransactionTest {
    @Test public void failedCommitCanRollbackOnPrimaryWriter() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", context.getPackageName());
        System.loadLibrary("sqlcipher");
        File file = new File(context.getCacheDir(), "m2-commit-" + UUID.randomUUID() + ".db");
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        byte[] key;
        try { key = KanataKeyEnvelope.rawSqlCipherKey(dek); }
        finally { Arrays.fill(dek, (byte) 0); }
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getPath(), key, null,
                SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS, (database, error) -> {}, null)) {
            db.setForeignKeyConstraintsEnabled(true);
            assertTrue(db.enableWriteAheadLogging());
            db.execSQL("CREATE TABLE parent(id INTEGER PRIMARY KEY)");
            db.execSQL("CREATE TABLE child(pid INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
            db.beginTransactionNonExclusive();
            // A concurrent reader must acquire a second pooled connection while
            // the primary is held. Verify that its FK setting is inherited.
            var reader = Executors.newSingleThreadExecutor();
            try {
                assertEquals(1, reader.submit(() -> {
                    try (Cursor result = db.rawQuery("SELECT foreign_keys FROM pragma_foreign_keys", new Object[0])) {
                        assertTrue(result.moveToFirst());
                        return result.getInt(0);
                    }
                }).get(5, TimeUnit.SECONDS).intValue());
            } finally { reader.shutdownNow(); }
            db.execSQL("INSERT INTO child VALUES(1)");
            db.setTransactionSuccessful();
            try {
                db.endTransaction();
                fail("Deferred FK must fail at COMMIT");
            } catch (SQLiteConstraintException failure) {
                db.rawExecSQL("ROLLBACK");
            }
            db.beginTransactionNonExclusive();
            try {
                try (Cursor result = db.rawQuery("SELECT count(*) FROM child", new Object[0])) {
                    assertTrue(result.moveToFirst());
                    assertEquals(0, result.getInt(0));
                }
                db.execSQL("INSERT INTO parent VALUES(1)");
                db.execSQL("INSERT INTO child VALUES(1)");
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        } finally {
            Arrays.fill(key, (byte) 0);
            SQLiteDatabase.deleteDatabase(file);
        }
    }
}
