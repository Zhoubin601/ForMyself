package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteException;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

@RunWith(AndroidJUnit4.class)
public class KanataM5CipherTest {
    private static final String SENTINEL = "m5-synthetic-cipher-sentinel";
    private static final int FLAGS = SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    private static SQLiteDatabase open(File file, byte[] key, int flags) {
        return SQLiteDatabase.openDatabase(file.getPath(), key, null, flags, (db, error) -> {}, null);
    }

    @Test public void encryptedBytesKeyRejectionAndRelease() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", context.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);
        System.loadLibrary("sqlcipher");
        File file = new File(context.getCacheDir(), "m5-cipher-" + UUID.randomUUID() + ".db");
        byte[] dek = new byte[32];
        byte[] wrongDek = new byte[32];
        new SecureRandom().nextBytes(dek);
        System.arraycopy(dek, 0, wrongDek, 0, dek.length);
        wrongDek[0] ^= 1;
        byte[] key;
        byte[] wrongKey;
        try {
            key = KanataKeyEnvelope.rawSqlCipherKey(dek);
            wrongKey = KanataKeyEnvelope.rawSqlCipherKey(wrongDek);
        } finally {
            Arrays.fill(dek, (byte) 0);
            Arrays.fill(wrongDek, (byte) 0);
        }
        try {
            SQLiteDatabase closed = open(file, key, FLAGS | SQLiteDatabase.CREATE_IF_NECESSARY);
            try (closed) {
                closed.execSQL("CREATE TABLE m5_sentinel(body TEXT NOT NULL)");
                closed.execSQL("INSERT INTO m5_sentinel VALUES(?)", new Object[]{SENTINEL});
                try (Cursor version = closed.rawQuery("PRAGMA cipher_version", new Object[0])) {
                    assertTrue(version.moveToFirst());
                    assertTrue(version.getString(0).startsWith("4.17.0"));
                }
            }
            assertFalse(closed.isOpen());
            assertThrows(IllegalStateException.class, () -> {
                try (Cursor cursor = closed.rawQuery("SELECT 1", new Object[0])) { cursor.moveToFirst(); }
            });
            try (FileInputStream bytes = new FileInputStream(file)) {
                String wire = new String(bytes.readAllBytes(), StandardCharsets.ISO_8859_1);
                assertFalse(wire.startsWith("SQLite format 3"));
                assertFalse(wire.contains(SENTINEL));
            }
            assertThrows(android.database.sqlite.SQLiteException.class, () -> {
                try (var plain = android.database.sqlite.SQLiteDatabase.openDatabase(
                        file.getPath(), null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
                     Cursor cursor = plain.rawQuery("SELECT body FROM m5_sentinel", null)) {
                    cursor.moveToFirst();
                }
            });
            assertThrows(SQLiteException.class, () -> {
                try (SQLiteDatabase wrong = open(file, wrongKey, FLAGS);
                     Cursor cursor = wrong.rawQuery("SELECT body FROM m5_sentinel", new Object[0])) {
                    cursor.moveToFirst();
                }
            });
            try (SQLiteDatabase right = open(file, key, FLAGS);
                 Cursor cursor = right.rawQuery("SELECT body FROM m5_sentinel", new Object[0])) {
                assertTrue(cursor.moveToFirst());
                assertEquals(SENTINEL, cursor.getString(0));
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(wrongKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(file);
        }
    }
}
