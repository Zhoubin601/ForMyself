package com.formyself.qa.m0;

import android.content.Context;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Isolated native candidate. No Capacitor SQLite secret API or production session registration. */
@RunWith(AndroidJUnit4.class)
public class SqlCipherM0SessionTest {
  private static final int ITERATIONS = 600_000;
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final byte[] DOMAIN = "ForMyself/Kanata/KEK/v1\0".getBytes(StandardCharsets.UTF_8);
  private static final byte[] HEX = "0123456789abcdef".getBytes(StandardCharsets.US_ASCII);

  private record Envelope(byte[] salt, byte[] nonce, byte[] ciphertext) {}

  private static byte[] randomBytes(int size) {
    byte[] bytes = new byte[size];
    RANDOM.nextBytes(bytes);
    return bytes;
  }

  private static byte[] crypt(int mode, char[] password, Envelope envelope, byte[] input)
      throws GeneralSecurityException {
    byte[] salt = Arrays.copyOf(DOMAIN, DOMAIN.length + envelope.salt.length);
    System.arraycopy(envelope.salt, 0, salt, DOMAIN.length, envelope.salt.length);
    PBEKeySpec spec = new PBEKeySpec(password, salt, ITERATIONS, 256);
    byte[] kek = null;
    try {
      kek = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(mode, new SecretKeySpec(kek, "AES"), new GCMParameterSpec(128, envelope.nonce));
      String aad = "{\"version\":1,\"purpose\":\"kanata-sqlcipher-dek-wrap\",\"kdf\":"
          + "{\"name\":\"PBKDF2-SHA256\",\"iterations\":" + ITERATIONS + ",\"length\":256},"
          + "\"cipher\":\"AES-256-GCM\",\"salt\":\"" + Base64.encodeToString(envelope.salt, Base64.NO_WRAP)
          + "\",\"nonce\":\"" + Base64.encodeToString(envelope.nonce, Base64.NO_WRAP) + "\"}";
      cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
      return cipher.doFinal(input);
    } finally {
      spec.clearPassword();
      if (kek != null) Arrays.fill(kek, (byte) 0);
    }
  }

  private static Envelope wrap(char[] password, byte[] key) throws GeneralSecurityException {
    Envelope header = new Envelope(randomBytes(16), randomBytes(12), null);
    return new Envelope(header.salt, header.nonce, crypt(Cipher.ENCRYPT_MODE, password, header, key));
  }

  private static byte[] unwrap(char[] password, Envelope envelope) throws GeneralSecurityException {
    return crypt(Cipher.DECRYPT_MODE, password, envelope, envelope.ciphertext);
  }

  private static final class Session implements AutoCloseable {
    private final byte[] rawKey;
    private final SQLiteDatabase database;
    private boolean released;

    Session(File file, char[] password, Envelope envelope, boolean create) throws GeneralSecurityException {
      byte[] dek = unwrap(password, envelope);
      rawKey = new byte[67];
      rawKey[0] = 'x';
      rawKey[1] = rawKey[66] = '\'';
      for (int i = 0; i < dek.length; i++) {
        rawKey[2 + 2 * i] = HEX[(dek[i] & 0xff) >>> 4];
        rawKey[3 + 2 * i] = HEX[dek[i] & 0x0f];
      }
      Arrays.fill(dek, (byte) 0);
      int flags = SQLiteDatabase.OPEN_READWRITE | (create ? SQLiteDatabase.CREATE_IF_NECESSARY : 0);
      try {
        database = SQLiteDatabase.openDatabase(file.getPath(), rawKey, null, flags, (db, error) -> {}, null);
      } catch (RuntimeException failure) {
        Arrays.fill(rawKey, (byte) 0);
        throw failure;
      }
    }

    SQLiteDatabase database() {
      if (released) throw new IllegalStateException("QA_SESSION_RELEASED");
      return database;
    }

    @Override public void close() {
      released = true;
      try {
        database.close();
      } finally {
        Arrays.fill(rawKey, (byte) 0);
      }
    }
  }

  @Test public void nativeEnvelopeAndSessionRelease() throws Exception {
    System.loadLibrary("sqlcipher");
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    File dir = Files.createTempDirectory(context.getCacheDir().toPath(), "m0-session-").toFile();
    File file = new File(dir, "session.db");
    char[] password = UUID.randomUUID().toString().toCharArray();
    char[] nextPassword = UUID.randomUUID().toString().toCharArray();
    byte[] dek = randomBytes(32);
    try {
      double[] wrapMs = new double[5];
      Envelope envelope = null;
      for (int i = 0; i < wrapMs.length; i++) {
        long start = SystemClock.elapsedRealtimeNanos();
        envelope = wrap(password, dek);
        wrapMs[i] = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0;
      }
      Envelope previous = envelope;
      Envelope next = wrap(nextPassword, dek);
      Arrays.fill(dek, (byte) 0);
      Session session = new Session(file, password, previous, true);
      try (session) {
        assertTrue(session.database().enableWriteAheadLogging());
        session.database().execSQL("CREATE TABLE qa(id INTEGER PRIMARY KEY)");
        session.database().execSQL("INSERT INTO qa VALUES(1)");
      }
      assertFalse(session.database.isOpen());
      assertTrue(Arrays.equals(new byte[67], session.rawKey));
      assertThrows(IllegalStateException.class, session::database);
      assertThrows(AEADBadTagException.class, () -> unwrap(password, next));
      byte[] tampered = next.ciphertext.clone();
      tampered[0] ^= 1;
      assertThrows(AEADBadTagException.class,
          () -> unwrap(nextPassword, new Envelope(next.salt, next.nonce, tampered)));
      try (Session reopened = new Session(file, nextPassword, next, false);
           android.database.Cursor row = reopened.database().rawQuery("SELECT id FROM qa", new String[0])) {
        assertTrue(row.moveToFirst());
        assertEquals(1, row.getInt(0));
        assertTrue(reopened.database().isDatabaseIntegrityOk());
      }
      Log.i("KanataM0", "native envelope wrap elapsed ms " + Arrays.toString(wrapMs));
    } finally {
      Arrays.fill(dek, (byte) 0);
      Arrays.fill(password, '\0');
      Arrays.fill(nextPassword, '\0');
      SQLiteDatabase.deleteDatabase(file);
      Files.delete(dir.toPath());
    }
  }
}
