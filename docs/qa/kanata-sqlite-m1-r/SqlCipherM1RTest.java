package com.formyself.qa.m0;

import android.content.Context;
import android.database.Cursor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** M1-R native DDL/constraint test only. No JS migrator or production Driver. */
@RunWith(AndroidJUnit4.class)
public class SqlCipherM1RTest {
  private static long number(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,new String[]{})){assertTrue(c.moveToFirst());return c.getLong(0);}}
  private static void command(SQLiteDatabase db,JSONObject c)throws Exception{
    JSONArray p=c.getJSONArray("parameters");Object[] values=new Object[p.length()];
    for(int i=0;i<values.length;i++)values[i]=p.isNull(i)?null:p.get(i);
    db.execSQL(c.getString("sql"),values);
  }
  private static void apply(SQLiteDatabase db,JSONObject bundle,int from,int to)throws Exception{
    JSONArray list=bundle.getJSONArray("migrations");
    for(int i=from-1;i<to;i++){
      JSONObject m=list.getJSONObject(i);JSONArray sql=m.getJSONArray("statements");
      for(int j=0;j<sql.length();j++)db.execSQL(sql.getString(j));
      db.execSQL("INSERT INTO schema_migrations VALUES(?,?,?)",new Object[]{m.getInt("version"),m.getString("name"),m.getString("checksum")});
      db.execSQL("PRAGMA user_version="+m.getInt("version"));
    }
    db.execSQL("PRAGMA application_id="+bundle.getInt("applicationId"));
  }
  private static void reject(SQLiteDatabase db,String sql){boolean failed=false;try{db.execSQL(sql);}catch(android.database.SQLException expected){failed=true;}assertTrue("EXPECTED_SQL_REJECTION",failed);}
  private static void validHistory(SQLiteDatabase db,JSONObject bundle)throws Exception{
    JSONArray checks=bundle.getJSONArray("legacyValidationQueries");
    for(int i=0;i<checks.length();i++)try(Cursor c=db.rawQuery(checks.getString(i),new String[]{})){assertFalse(c.moveToFirst());}
  }
  @Test public void upgradeHistoryAndRollback()throws Exception{
    System.loadLibrary("sqlcipher");
    JSONObject bundle;
    try(java.io.InputStream stream=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("kanata-m1-r.json")){
      java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
      while((n=stream.read(buffer))!=-1)bytes.write(buffer,0,n);bundle=new JSONObject(bytes.toString("UTF-8"));
    }
    android.os.Bundle report=new android.os.Bundle();
    report.putString("stream","M1R_SCHEMA_SHA256="+bundle.getString("schemaSha256")+"\nM1R_FIXTURE_SHA256="+bundle.getString("fixtureSha256")+"\n");
    InstrumentationRegistry.getInstrumentation().sendStatus(0,report);
    Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    File root=new File(context.getCacheDir(),"m1-r-"+UUID.randomUUID());assertTrue(root.mkdir());File file=new File(root,"synthetic.db");
    byte[] dek=new byte[32],raw=new byte[67];new SecureRandom().nextBytes(dek);String hex="0123456789abcdef";
    raw[0]='x';raw[1]=raw[66]='\'';for(int i=0;i<dek.length;i++){raw[2+2*i]=(byte)hex.charAt((dek[i]&255)>>>4);raw[3+2*i]=(byte)hex.charAt(dek[i]&15);}Arrays.fill(dek,(byte)0);
    int flags=SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY|SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getPath(),raw,null,flags,(database,error)->{},null);
    try{
      db.setForeignKeyConstraintsEnabled(true);assertTrue(db.enableWriteAheadLogging());db.execSQL("PRAGMA synchronous=FULL");assertEquals(1,number(db,"PRAGMA foreign_keys"));
      try(Cursor c=db.rawQuery("PRAGMA cipher_version",new String[]{})){assertTrue(c.moveToFirst());assertTrue(c.getString(0).startsWith("4.17."));android.os.Bundle v=new android.os.Bundle();v.putString("stream","M1R_CIPHER_VERSION="+c.getString(0)+"\n");InstrumentationRegistry.getInstrumentation().sendStatus(0,v);}
      db.beginTransaction();try{apply(db,bundle,1,3);}finally{db.endTransaction();}
      assertEquals(0,number(db,"PRAGMA user_version"));assertEquals(0,number(db,"SELECT count(*) FROM sqlite_schema"));
      db.beginTransaction();try{apply(db,bundle,1,2);db.setTransactionSuccessful();}finally{db.endTransaction();}
      db.beginTransaction();try{JSONArray commands=bundle.getJSONArray("commands");for(int i=0;i<commands.length();i++)command(db,commands.getJSONObject(i));db.setTransactionSuccessful();}finally{db.endTransaction();}
      validHistory(db,bundle);
      // v2 permits this bad same-world snapshot. Validate before installing 003;
      // rollback the injected CONTROL transaction, never repair committed history.
      db.beginTransaction();try{
        command(db,bundle.getJSONArray("rejected").getJSONObject(0));boolean invalid=false;
        JSONArray checks=bundle.getJSONArray("legacyValidationQueries");
        for(int i=0;i<checks.length();i++)try(Cursor c=db.rawQuery(checks.getString(i),new String[]{})){if(c.moveToFirst())invalid=true;}
        assertTrue("LEGACY_HISTORY_MUST_BE_REJECTED",invalid);
      }finally{db.endTransaction();}
      assertEquals(1,number(db,"SELECT count(*) FROM message_audits"));
      db.beginTransaction();try{apply(db,bundle,3,3);}finally{db.endTransaction();}
      assertEquals(2,number(db,"PRAGMA user_version"));assertEquals(0,number(db,"SELECT count(*) FROM sqlite_schema WHERE name='schema_migration_applications'"));assertEquals(1,number(db,"SELECT count(*) FROM message_audits"));
      db.beginTransaction();try{apply(db,bundle,3,3);db.setTransactionSuccessful();}finally{db.endTransaction();}
      assertEquals(3,number(db,"PRAGMA user_version"));
      db.execSQL("INSERT INTO schema_migration_applications VALUES(1,NULL,'legacy-unrecorded')");
      db.execSQL("INSERT INTO schema_migration_applications VALUES(2,NULL,'legacy-unrecorded')");
      reject(db,"INSERT INTO schema_migration_applications VALUES(3,-1,'js-wall-clock-utc-ms')");
      reject(db,"UPDATE schema_migration_applications SET applied_at=0");reject(db,"DELETE FROM schema_migrations");
      JSONArray rejected=bundle.getJSONArray("rejected");
      for(int i=0;i<rejected.length();i++){boolean failed=false;try{command(db,rejected.getJSONObject(i));}catch(android.database.SQLException expected){failed=true;}assertTrue("M1R_CASE_"+i,failed);}
      db.execSQL("UPDATE character_instances SET location=''");reject(db,"UPDATE character_instances SET location=NULL");reject(db,"UPDATE virtual_schedules SET location=''");
      // All writes below are synthetic SQL capability tests, not M2 command code.
      db.beginTransaction();try{db.execSQL("UPDATE messages SET content='rollback',revision=3 WHERE id='message-one'");command(db,bundle.getJSONObject("nextAudit"));}finally{db.endTransaction();}
      assertEquals(2,number(db,"SELECT revision FROM messages WHERE id='message-one'"));assertEquals(1,number(db,"SELECT count(*) FROM message_audits"));
      reject(db,bundle.getString("redact"));
      db.execSQL("UPDATE messages SET content='（已删除的原始记录）',deleted=1,revision=3 WHERE id='message-one'");db.execSQL(bundle.getString("redact"));
      reject(db,"UPDATE message_audits SET at=at+1");
      reject(db,"UPDATE message_audits SET previous_json=json_set(previous_json,'$.content','restore')");
      reject(db,"DELETE FROM messages WHERE id='message-one'");reject(db,"DELETE FROM world_events WHERE id='event-one'");
      db.beginTransaction();try{db.execSQL("DELETE FROM messages WHERE id='message-two'");assertEquals(1,number(db,"SELECT count(*) FROM messages"));}finally{db.endTransaction();}
      try(Cursor c=db.rawQuery("PRAGMA foreign_key_check",new String[]{})){assertFalse(c.moveToFirst());}
      try(Cursor c=db.rawQuery("PRAGMA cipher_integrity_check",new String[]{})){assertFalse(c.moveToFirst());}assertTrue(db.isDatabaseIntegrityOk());
      db.close();db=SQLiteDatabase.openDatabase(file.getPath(),raw,null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.NO_LOCALIZED_COLLATORS,(database,error)->{},null);db.setForeignKeyConstraintsEnabled(true);
      assertEquals(3,number(db,"PRAGMA user_version"));assertEquals(2,number(db,"SELECT count(*) FROM messages"));reject(db,"DELETE FROM event_audits");assertTrue(db.isDatabaseIntegrityOk());
    }finally{if(db.isOpen())db.close();Arrays.fill(raw,(byte)0);SQLiteDatabase.deleteDatabase(file);assertTrue(root.delete());}
  }
}
