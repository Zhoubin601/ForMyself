package com.formyself.qa.m0;

import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.spec.GCMParameterSpec;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class M0KeystoreTest {
  private static KeyStore loadKeystore() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    return store;
  }

  @Test public void revokedAuxiliaryKeyAndNoPlainProbeInPreferencesOrLog() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    String alias = "m0-aux-" + UUID.randomUUID();
    byte[] key = new byte[32];
    new SecureRandom().nextBytes(key);
    var store = loadKeystore();
    try {
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(alias,
          KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256).build());
      Cipher wrap = Cipher.getInstance("AES/GCM/NoPadding");
      wrap.init(Cipher.ENCRYPT_MODE, generator.generateKey());
      byte[] ciphertext = wrap.doFinal(key);
      Cipher unwrap = Cipher.getInstance("AES/GCM/NoPadding");
      unwrap.init(Cipher.DECRYPT_MODE, loadKeystore().getKey(alias, null),
          new GCMParameterSpec(128, wrap.getIV()));
      byte[] readback = unwrap.doFinal(ciphertext);
      try {
        assertTrue("Auxiliary DEK round trip failed", Arrays.equals(key, readback));
      } finally {
        Arrays.fill(readback, (byte) 0);
      }
      store.deleteEntry(alias);
      assertFalse(loadKeystore().containsAlias(alias));
      assertNull(loadKeystore().getKey(alias, null));

      // Compare only in memory. No secret or captured log content is emitted.
      String base64 = Base64.encodeToString(key, Base64.NO_WRAP);
      StringBuilder hexBuilder = new StringBuilder(64);
      for (byte value : key) {
        hexBuilder.append(Character.forDigit((value & 0xff) >>> 4, 16));
        hexBuilder.append(Character.forDigit(value & 0x0f, 16));
      }
      String hex = hexBuilder.toString();
      Context context = instrumentation.getTargetContext();
      assertTrue(context.getSharedPreferences("m0-keystore-probe", Context.MODE_PRIVATE)
          .edit().putBoolean("probe_marker", true).commit());
      File prefs = new File(context.getDataDir(), "shared_prefs");
      File[] files = prefs.listFiles();
      assertNotNull(files);
      assertTrue(new File(prefs, "m0-keystore-probe.xml").isFile());
      for (File file : files) {
        String content = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        assertFalse("Synthetic DEK detected in Preferences", content.contains(base64) || content.contains(hex));
      }
      String canary = "m0-keystore-scan-" + UUID.randomUUID();
      Log.i("KanataM0", canary);
      try (var logs = new ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation()
          .executeShellCommand("logcat -d --pid=" + Process.myPid()))) {
        String captured = new String(logs.readAllBytes(), StandardCharsets.UTF_8);
        assertTrue("Log sample missing canary", captured.contains(canary));
        assertFalse("Synthetic DEK detected in logcat", captured.contains(base64) || captured.contains(hex));
      }
    } finally {
      Arrays.fill(key, (byte) 0);
      if (store.containsAlias(alias)) store.deleteEntry(alias);
      instrumentation.getTargetContext().deleteSharedPreferences("m0-keystore-probe");
    }
  }
}
