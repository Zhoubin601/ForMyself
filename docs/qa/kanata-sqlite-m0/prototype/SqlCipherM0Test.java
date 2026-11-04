package com.formyself.qa.m0;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import java.io.File;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Synthetic cache directory only. Test SQLCipher 4.17, not the JS bridge. */
@RunWith(AndroidJUnit4.class)
public class SqlCipherM0Test {
  private static long count(SQLiteDatabase db) {
    try (android.database.Cursor c=db.rawQuery("SELECT count(*) FROM qa",new String[]{})) {assertTrue(c.moveToFirst());return c.getLong(0);}
  }
  @Test public void encryptionRollbackReopen() throws Exception {
    System.loadLibrary("sqlcipher");
    Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    File root=new File(context.getCacheDir(),"m0-"+UUID.randomUUID());assertTrue(root.mkdir());
    File file=new File(root,"synthetic.db");
    byte[] key=new byte[32],wrong=new byte[32];SecureRandom random=new SecureRandom();random.nextBytes(key);random.nextBytes(wrong);
    String secret=android.util.Base64.encodeToString(key,android.util.Base64.NO_WRAP);
    SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(file,secret,null,null);
    try {
      assertTrue("WAL_REQUIRED",db.enableWriteAheadLogging());
      try(android.database.Cursor c=db.rawQuery("PRAGMA journal_mode",new String[]{})){assertTrue(c.moveToFirst());assertEquals("wal",c.getString(0));}
      try(android.database.Cursor c=db.rawQuery("PRAGMA cipher_version",new String[]{})){assertTrue(c.moveToFirst());assertTrue("SQLCIPHER_417_REQUIRED",c.getString(0).startsWith("4.17."));}
      db.execSQL("PRAGMA synchronous=FULL");
      try(android.database.Cursor c=db.rawQuery("PRAGMA synchronous",new String[]{})){assertTrue(c.moveToFirst());assertEquals(2,c.getInt(0));}
      db.execSQL("CREATE TABLE qa(id INTEGER PRIMARY KEY,body TEXT)");
      db.beginTransaction();try{db.execSQL("INSERT INTO qa VALUES(?,?)",new Object[]{1,"synthetic-only"});db.setTransactionSuccessful();}finally{db.endTransaction();}
      db.beginTransaction();try{db.execSQL("INSERT INTO qa VALUES(?,?)",new Object[]{2,"rollback-only"});}finally{db.endTransaction();}
      assertEquals(1,count(db));
    } finally {db.close();}
    boolean rejected=false;
    try {SQLiteDatabase bad=SQLiteDatabase.openDatabase(file.getPath(),android.util.Base64.encodeToString(wrong,android.util.Base64.NO_WRAP),null,SQLiteDatabase.OPEN_READONLY,null);try{count(bad);}finally{bad.close();}} catch(Exception expected){rejected=true;}
    assertTrue("wrong key must fail",rejected);
    rejected=false;
    // Android's default corruption handler may delete a database, even during a read probe.
    // A rejection probe must retain the encrypted source for the following correct-key checks.
    try {android.database.sqlite.SQLiteDatabase plain=android.database.sqlite.SQLiteDatabase.openDatabase(file.getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY,database->{});try(android.database.Cursor c=plain.rawQuery("SELECT * FROM qa",null)){c.getCount();}finally{plain.close();}}catch(Exception expected){rejected=true;}
    assertTrue("ordinary SQLite must fail",rejected);
    assertFalse(new String(Files.readAllBytes(file.toPath()),java.nio.charset.StandardCharsets.ISO_8859_1).contains("synthetic-only"));
    for(int i=0;i<5;i++) {db=SQLiteDatabase.openOrCreateDatabase(file,secret,null,null);try{assertEquals(1,count(db));assertTrue(db.isDatabaseIntegrityOk());}finally{db.close();}}
    Arrays.fill(key,(byte)0);Arrays.fill(wrong,(byte)0);secret="";
    // Retain encrypted synthetic DB for optional device-side forensic test; no key is persisted.
  }
}
