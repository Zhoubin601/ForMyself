package com.formyself.qa.m0;

import android.content.Context;
import android.database.Cursor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exact production M1 DDL, synthetic cache DB. Does not test the JS migrator/bridge. */
@RunWith(AndroidJUnit4.class)
public class SqlCipherM1SchemaTest {
  private static long number(SQLiteDatabase db,String sql) {
    try(Cursor c=db.rawQuery(sql,new String[]{})){assertTrue(c.moveToFirst());return c.getLong(0);}
  }
  private static void execute(SQLiteDatabase db,JSONObject command) throws Exception {
    JSONArray parameters=command.getJSONArray("parameters");Object[] args=new Object[parameters.length()];
    for(int i=0;i<args.length;i++)args[i]=parameters.isNull(i)?null:parameters.get(i);
    db.execSQL(command.getString("sql"),args);
  }
  private static void schema(SQLiteDatabase db,JSONObject bundle) throws Exception {
    JSONArray migrations=bundle.getJSONArray("migrations");
    for(int i=0;i<migrations.length();i++){
      JSONObject m=migrations.getJSONObject(i);JSONArray statements=m.getJSONArray("statements");
      for(int j=0;j<statements.length();j++)db.execSQL(statements.getString(j));
      db.execSQL("INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)",new Object[]{m.getInt("version"),m.getString("name"),m.getString("checksum")});
      db.execSQL("PRAGMA user_version="+m.getInt("version"));
    }
    db.execSQL("PRAGMA application_id="+bundle.getInt("applicationId"));
  }
  @Test public void schemaConstraintsRollbackAndReopen() throws Exception {
    System.loadLibrary("sqlcipher");
    Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
    JSONObject bundle;
    try(java.io.InputStream stream=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("kanata-m1-schema.json")){
      java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
      while((n=stream.read(buffer))!=-1)bytes.write(buffer,0,n);
      bundle=new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
    }
    android.os.Bundle identity=new android.os.Bundle();
    identity.putString("stream","M1_SCHEMA_SHA256="+bundle.getString("schemaSha256")+"\nM1_FIXTURE_SHA256="+bundle.getString("fixtureSha256")+"\n");
    InstrumentationRegistry.getInstrumentation().sendStatus(0,identity);
    File directory=new File(target.getCacheDir(),"m1-schema-"+UUID.randomUUID());assertTrue(directory.mkdir());
    File file=new File(directory,"synthetic.db");byte[] key=new byte[32];new SecureRandom().nextBytes(key);
    byte[] rawKey=new byte[67];rawKey[0]='x';rawKey[1]=rawKey[66]='\'';
    final String hex="0123456789abcdef";
    for(int i=0;i<key.length;i++){rawKey[2+2*i]=(byte)hex.charAt((key[i]&255)>>>4);rawKey[3+2*i]=(byte)hex.charAt(key[i]&15);}
    Arrays.fill(key,(byte)0);
    // SQLCipher 4.17 skips initial locale setup when a codec is present. Verify
    // that the default open is genuinely empty; never drop a platform table to
    // disguise a nonempty database. Keep binary collations explicit below.
    File control=new File(directory,"localized-control.db");
    int defaultFlags=SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY;
    SQLiteDatabase localized=SQLiteDatabase.openDatabase(control.getPath(),rawKey,null,defaultFlags,(database,error)->{},null);
    try{assertEquals(0,number(localized,"SELECT count(*) FROM sqlite_schema"));}
    finally{localized.close();SQLiteDatabase.deleteDatabase(control);}
    // Binary ordering is required for stable IDs/cursors; no localized collation
    // or platform metadata writes are needed by Kanata's schema.
    int flags=defaultFlags|SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getPath(),rawKey,null,flags,(database,error)->{},null);
    try {
      // Configure the pool, not just the primary connection via a one-off PRAGMA.
      db.setForeignKeyConstraintsEnabled(true);assertTrue(db.enableWriteAheadLogging());db.execSQL("PRAGMA synchronous=FULL");
      assertEquals(1,number(db,"PRAGMA foreign_keys"));
      try(Cursor c=db.rawQuery("PRAGMA cipher_version",new String[]{})){
        assertTrue(c.moveToFirst());assertTrue(c.getString(0).startsWith("4.17."));
        android.os.Bundle version=new android.os.Bundle();version.putString("stream","M1_CIPHER_VERSION="+c.getString(0)+"\n");
        InstrumentationRegistry.getInstrumentation().sendStatus(0,version);
      }
      // Simulate failure before migration commit. DDL and user_version both roll back.
      db.beginTransaction();try{schema(db,bundle);}finally{db.endTransaction();}
      assertEquals(0,number(db,"PRAGMA user_version"));assertEquals(0,number(db,"SELECT count(*) FROM sqlite_schema"));
      db.beginTransaction();try{schema(db,bundle);db.setTransactionSuccessful();}finally{db.endTransaction();}
      assertEquals(2,number(db,"PRAGMA user_version"));
      JSONArray commands=bundle.getJSONArray("commands");
      db.beginTransaction();try{for(int i=0;i<commands.length();i++)execute(db,commands.getJSONObject(i));db.setTransactionSuccessful();}finally{db.endTransaction();}
      assertEquals(2,number(db,"SELECT count(*) FROM worlds"));assertEquals(2,number(db,"SELECT count(*) FROM messages"));
      JSONArray rejected=bundle.getJSONArray("rejected");
      for(int i=0;i<rejected.length();i++){
        boolean failed=false;try{execute(db,rejected.getJSONObject(i));}catch(android.database.SQLException expected){failed=true;}
        assertTrue("M1_REJECTED_CASE_"+i,failed);
      }
      assertEquals(1,number(db,"SELECT message_revision FROM memory_sources"));
      try(Cursor c=db.rawQuery("PRAGMA foreign_key_check",new String[]{})){assertFalse(c.moveToFirst());}
      try(Cursor c=db.rawQuery("PRAGMA cipher_integrity_check",new String[]{})){assertFalse(c.moveToFirst());}
      try(Cursor c=db.rawQuery("EXPLAIN QUERY PLAN SELECT id FROM messages WHERE world_id=? AND conversation_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
        new String[]{bundle.getString("worldId"),bundle.getString("conversationId"),"1000","message-two","50"})){
        assertTrue(c.moveToFirst());assertTrue(c.getString(3).contains("SEARCH messages USING COVERING INDEX messages_scope_time"));
      }
      assertTrue(db.isDatabaseIntegrityOk());
    } finally {db.close();}
    db=SQLiteDatabase.openDatabase(file.getPath(),rawKey,null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.NO_LOCALIZED_COLLATORS,(database,error)->{},null);
    try {db.setForeignKeyConstraintsEnabled(true);assertEquals(1,number(db,"PRAGMA foreign_keys"));assertEquals(2,number(db,"PRAGMA user_version"));assertEquals(2,number(db,"SELECT count(*) FROM messages"));assertTrue(db.isDatabaseIntegrityOk());}
    finally {db.close();Arrays.fill(rawKey,(byte)0);SQLiteDatabase.deleteDatabase(file);assertTrue(directory.delete());}
  }
}
