package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Debug;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetEncoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Provider;
import java.security.Security;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

@RunWith(AndroidJUnit4.class)
public class KanataM6N01CryptoProbeTest {
    private static final String TAG = "KanataM6N01";
    private static final int MAX_PASSWORD_CHARS = 1024;
    private static final int MAX_PASSWORD_BYTES = 1024;

    private static void report(String key, JSONObject value) {
        Log.i(TAG, key + "=" + value.toString());
    }

    private static byte[] hexToBytes(String hex) {
        int len = hex.length();
        assertEquals(0, len % 2);
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return out;
    }

    private static String bytesToHex(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    private static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) total += p.length;
        byte[] out = new byte[total];
        int offset = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, offset, p.length);
            offset += p.length;
        }
        return out;
    }

    private static byte[] u16be(int v) {
        return new byte[] { (byte) (v >>> 8), (byte) v };
    }

    private static byte[] u32be(long v) {
        return new byte[] {
                (byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v
        };
    }

    private static byte[] u64be(long v) {
        return new byte[] {
                (byte) (v >>> 56), (byte) (v >>> 48), (byte) (v >>> 40), (byte) (v >>> 32),
                (byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v
        };
    }

    private static int readU16be(byte[] b, int off) {
        return ((b[off] & 0xff) << 8) | (b[off + 1] & 0xff);
    }

    private static long readU32be(byte[] b, int off) {
        return ((long) (b[off] & 0xff) << 24)
                | ((long) (b[off + 1] & 0xff) << 16)
                | ((long) (b[off + 2] & 0xff) << 8)
                | ((long) (b[off + 3] & 0xff));
    }

    private static boolean isWellFormedUtf16(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1))) {
                    return false;
                }
                i++;
            } else if (Character.isLowSurrogate(c)) {
                return false;
            }
        }
        return true;
    }

    private static byte[] encodeStrictPasswordUtf8(String password) throws Exception {
        if (password == null || password.isEmpty() || password.length() > MAX_PASSWORD_CHARS
                || !isWellFormedUtf16(password)) {
            throw new IllegalArgumentException("INVALID_PASSWORD_INPUT");
        }
        CharsetEncoder encoder = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        ByteBuffer encoded = encoder.encode(CharBuffer.wrap(password));
        byte[] out = new byte[encoded.remaining()];
        encoded.get(out);
        if (encoded.hasArray()) {
            Arrays.fill(encoded.array(), (byte) 0);
        }
        if (out.length == 0 || out.length > MAX_PASSWORD_BYTES) {
            Arrays.fill(out, (byte) 0);
            throw new IllegalArgumentException("INVALID_PASSWORD_INPUT");
        }
        return out;
    }

    private static String providerSummary(Provider p) {
        if (p == null) return "null";
        return p.getName() + " v" + p.getVersion();
    }

    private static final int[] SHA256_IV = {
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };

    private static final int[] SHA256_K = {
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    private static void sha256Compress(int[] state, int[] w) {
        for (int t = 16; t < 64; t++) {
            int s0 = Integer.rotateRight(w[t - 15], 7) ^ Integer.rotateRight(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            int s1 = Integer.rotateRight(w[t - 2], 17) ^ Integer.rotateRight(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = w[t - 16] + s0 + w[t - 7] + s1;
        }
        int a = state[0], b = state[1], c = state[2], d = state[3];
        int e = state[4], f = state[5], g = state[6], h = state[7];
        for (int t = 0; t < 64; t++) {
            int S1 = Integer.rotateRight(e, 6) ^ Integer.rotateRight(e, 11) ^ Integer.rotateRight(e, 25);
            int ch = (e & f) ^ ((~e) & g);
            int temp1 = h + S1 + ch + SHA256_K[t] + w[t];
            int S0 = Integer.rotateRight(a, 2) ^ Integer.rotateRight(a, 13) ^ Integer.rotateRight(a, 22);
            int maj = (a & b) ^ (a & c) ^ (b & c);
            int temp2 = S0 + maj;
            h = g; g = f; f = e; e = d + temp1;
            d = c; c = b; b = a; a = temp1 + temp2;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
    }

    private static void sha256BlockFromBytes(int[] state, byte[] block, int off, int[] w) {
        for (int i = 0; i < 16; i++) {
            int p = off + (i << 2);
            w[i] = ((block[p] & 0xff) << 24) | ((block[p + 1] & 0xff) << 16)
                    | ((block[p + 2] & 0xff) << 8) | (block[p + 3] & 0xff);
        }
        sha256Compress(state, w);
    }

    /**
     * Zero-allocation byte-safe PBKDF2-HMAC-SHA256 using precomputed HMAC ipad/opad SHA-256 midstates.
     * Clears all intermediate and output buffers on exception or cancellation paths.
     */
    private static byte[] pbkdf2HmacSha256ZeroAlloc(
            byte[] passwordBytes,
            byte[] salt,
            int iterations,
            int keyLen,
            AtomicBoolean cancelled) throws Exception {
        byte[] out = new byte[keyLen];
        pbkdf2HmacSha256ZeroAllocInto(passwordBytes, salt, iterations, keyLen, cancelled, out);
        return out;
    }

    private static void pbkdf2HmacSha256ZeroAllocInto(
            byte[] passwordBytes,
            byte[] salt,
            int iterations,
            int keyLen,
            AtomicBoolean cancelled,
            byte[] out) throws Exception {
        if (passwordBytes == null || salt == null || iterations <= 0 || keyLen <= 0 || out == null || out.length < keyLen) {
            throw new IllegalArgumentException("INVALID_PBKDF2_ARGS");
        }
        byte[] keyBlock = new byte[64];
        byte[] padBlock = new byte[64];
        int[] ipadMid = new int[8];
        int[] opadMid = new int[8];
        int[] state = new int[8];
        int[] w = new int[64];
        int[] u = new int[8];
        int[] t = new int[8];
        byte[] firstMsg = new byte[salt.length + 4];
        byte[] fullBlock = new byte[128];
        boolean completed = false;
        try {
            if (passwordBytes.length > 64) {
                byte[] hashedKey = MessageDigest.getInstance("SHA-256").digest(passwordBytes);
                System.arraycopy(hashedKey, 0, keyBlock, 0, hashedKey.length);
                Arrays.fill(hashedKey, (byte) 0);
            } else {
                System.arraycopy(passwordBytes, 0, keyBlock, 0, passwordBytes.length);
            }
            for (int i = 0; i < 64; i++) padBlock[i] = (byte) (keyBlock[i] ^ 0x36);
            System.arraycopy(SHA256_IV, 0, ipadMid, 0, 8);
            sha256BlockFromBytes(ipadMid, padBlock, 0, w);

            for (int i = 0; i < 64; i++) padBlock[i] = (byte) (keyBlock[i] ^ 0x5c);
            System.arraycopy(SHA256_IV, 0, opadMid, 0, 8);
            sha256BlockFromBytes(opadMid, padBlock, 0, w);

            System.arraycopy(salt, 0, firstMsg, 0, salt.length);
            int blocks = (keyLen + 31) / 32;
            for (int block = 1; block <= blocks; block++) {
                if (cancelled != null && cancelled.get()) {
                    throw new InterruptedException("CANCELLED");
                }
                firstMsg[salt.length] = (byte) (block >>> 24);
                firstMsg[salt.length + 1] = (byte) (block >>> 16);
                firstMsg[salt.length + 2] = (byte) (block >>> 8);
                firstMsg[salt.length + 3] = (byte) block;

                // U_1 inner = SHA256(ipadMid, firstMsg)
                System.arraycopy(ipadMid, 0, state, 0, 8);
                int pos = 0;
                while (firstMsg.length - pos >= 64) {
                    sha256BlockFromBytes(state, firstMsg, pos, w);
                    pos += 64;
                }
                int rem = firstMsg.length - pos;
                Arrays.fill(fullBlock, (byte) 0);
                System.arraycopy(firstMsg, pos, fullBlock, 0, rem);
                fullBlock[rem] = (byte) 0x80;
                int padBlocks = (rem + 9 <= 64) ? 1 : 2;
                long totalBits = (64L + firstMsg.length) * 8L;
                int lenOff = padBlocks * 64 - 8;
                for (int b = 0; b < 8; b++) {
                    fullBlock[lenOff + b] = (byte) (totalBits >>> (56 - b * 8));
                }
                sha256BlockFromBytes(state, fullBlock, 0, w);
                if (padBlocks == 2) sha256BlockFromBytes(state, fullBlock, 64, w);

                // U_1 outer = SHA256(opadMid, state[0..7])
                System.arraycopy(state, 0, w, 0, 8);
                w[8] = 0x80000000;
                Arrays.fill(w, 9, 15, 0);
                w[15] = 768; // (64 + 32) * 8
                System.arraycopy(opadMid, 0, state, 0, 8);
                sha256Compress(state, w);
                System.arraycopy(state, 0, u, 0, 8);
                System.arraycopy(state, 0, t, 0, 8);

                for (int iter = 2; iter <= iterations; iter++) {
                    if (cancelled != null && (iter & 0x3ff) == 0 && cancelled.get()) {
                        throw new InterruptedException("CANCELLED");
                    }
                    // inner(u)
                    System.arraycopy(u, 0, w, 0, 8);
                    w[8] = 0x80000000;
                    w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0;
                    w[15] = 768;
                    System.arraycopy(ipadMid, 0, state, 0, 8);
                    sha256Compress(state, w);
                    // outer(innerDigest)
                    System.arraycopy(state, 0, w, 0, 8);
                    w[8] = 0x80000000;
                    w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0;
                    w[15] = 768;
                    System.arraycopy(opadMid, 0, state, 0, 8);
                    sha256Compress(state, w);
                    System.arraycopy(state, 0, u, 0, 8);
                    t[0] ^= u[0]; t[1] ^= u[1]; t[2] ^= u[2]; t[3] ^= u[3];
                    t[4] ^= u[4]; t[5] ^= u[5]; t[6] ^= u[6]; t[7] ^= u[7];
                }
                int outOff = (block - 1) * 32;
                for (int i = 0; i < 8 && outOff < keyLen; i++) {
                    int val = t[i];
                    if (outOff < keyLen) out[outOff++] = (byte) (val >>> 24);
                    if (outOff < keyLen) out[outOff++] = (byte) (val >>> 16);
                    if (outOff < keyLen) out[outOff++] = (byte) (val >>> 8);
                    if (outOff < keyLen) out[outOff++] = (byte) val;
                }
            }
            if (cancelled != null && cancelled.get()) {
                throw new InterruptedException("CANCELLED");
            }
            completed = true;
        } finally {
            if (!completed) {
                Arrays.fill(out, 0, keyLen, (byte) 0);
            }
            Arrays.fill(keyBlock, (byte) 0);
            Arrays.fill(padBlock, (byte) 0);
            Arrays.fill(ipadMid, 0);
            Arrays.fill(opadMid, 0);
            Arrays.fill(state, 0);
            Arrays.fill(w, 0);
            Arrays.fill(u, 0);
            Arrays.fill(t, 0);
            Arrays.fill(firstMsg, (byte) 0);
            Arrays.fill(fullBlock, (byte) 0);
        }
    }

    private static byte[] pbkdf2HmacSha256ByteSafe(
            byte[] passwordBytes,
            byte[] salt,
            int iterations,
            int keyLen,
            AtomicBoolean cancelled,
            AtomicReference<String> providerOut) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        if (providerOut != null) {
            providerOut.set(providerSummary(mac.getProvider()));
        }
        SecretKeySpec keySpec = new SecretKeySpec(passwordBytes, "HmacSHA256");
        mac.init(keySpec);
        int hLen = mac.getMacLength();
        int blocks = (keyLen + hLen - 1) / hLen;
        byte[] dk = new byte[blocks * hLen];
        byte[] u = new byte[hLen];
        byte[] t = new byte[hLen];
        byte[] saltBlock = new byte[salt.length + 4];
        System.arraycopy(salt, 0, saltBlock, 0, salt.length);
        try {
            for (int block = 1; block <= blocks; block++) {
                if (cancelled != null && cancelled.get()) {
                    throw new InterruptedException("CANCELLED");
                }
                saltBlock[salt.length] = (byte) (block >>> 24);
                saltBlock[salt.length + 1] = (byte) (block >>> 16);
                saltBlock[salt.length + 2] = (byte) (block >>> 8);
                saltBlock[salt.length + 3] = (byte) block;
                mac.update(saltBlock);
                mac.doFinal(u, 0);
                System.arraycopy(u, 0, t, 0, hLen);
                for (int i = 2; i <= iterations; i++) {
                    if (cancelled != null && (i & 0x3ff) == 0 && cancelled.get()) {
                        throw new InterruptedException("CANCELLED");
                    }
                    mac.update(u);
                    mac.doFinal(u, 0);
                    for (int k = 0; k < hLen; k++) {
                        t[k] ^= u[k];
                    }
                }
                System.arraycopy(t, 0, dk, (block - 1) * hLen, hLen);
            }
            return Arrays.copyOf(dk, keyLen);
        } finally {
            Arrays.fill(dk, (byte) 0);
            Arrays.fill(u, (byte) 0);
            Arrays.fill(t, (byte) 0);
            Arrays.fill(saltBlock, (byte) 0);
        }
    }

    private static byte[] hkdfSha256(byte[] ikm, byte[] salt, byte[] info, int len) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        byte[] okm = new byte[len];
        byte[] t = new byte[0];
        int offset = 0;
        int counter = 1;
        try {
            while (offset < len) {
                mac.init(new SecretKeySpec(prk, "HmacSHA256"));
                mac.update(t);
                mac.update(info);
                mac.update((byte) counter);
                t = mac.doFinal();
                int take = Math.min(t.length, len - offset);
                System.arraycopy(t, 0, okm, offset, take);
                offset += take;
                counter++;
            }
            return okm;
        } finally {
            Arrays.fill(prk, (byte) 0);
            Arrays.fill(t, (byte) 0);
        }
    }

    private static byte[] aesGcmCrypt(
            int mode, byte[] key, byte[] nonce, byte[] input, byte[] aad, AtomicReference<String> providerOut)
            throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (providerOut != null) {
            providerOut.set(providerSummary(cipher.getProvider()));
        }
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        if (aad != null && aad.length > 0) {
            cipher.updateAAD(aad);
        }
        return cipher.doFinal(input);
    }

    private static long readVmRssKiB() {
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/self/status"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("VmRSS:")) {
                    String[] parts = line.trim().split("\\s+");
                    return Long.parseLong(parts[1]);
                }
            }
        } catch (Exception ignored) {}
        return -1;
    }

    private static String readAssetText(Context instrContext, String name) throws Exception {
        try (InputStream is = instrContext.getAssets().open(name)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
            return baos.toString(StandardCharsets.UTF_8.name());
        }
    }

    @Test
    public void probeEnvironmentAndKatAndPerformance() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context testCtx = InstrumentationRegistry.getInstrumentation().getContext();
        assertEquals("com.yubin.formyself.m2qa", targetCtx.getPackageName());
        assertTrue(BuildConfig.KANATA_M2_SYNTHETIC);

        // 1. Environment & Providers
        String webViewPkg = "unknown";
        String webViewVer = "unknown";
        try {
            PackageInfo wv = WebView.getCurrentWebViewPackage();
            if (wv != null) {
                webViewPkg = wv.packageName;
                webViewVer = wv.versionName + " (" + wv.getLongVersionCode() + ")";
            }
        } catch (Throwable ignored) {}

        JSONObject env = new JSONObject()
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("release", Build.VERSION.RELEASE)
                .put("abis", String.join(",", Build.SUPPORTED_ABIS))
                .put("model", Build.MODEL)
                .put("manufacturer", Build.MANUFACTURER)
                .put("product", Build.PRODUCT)
                .put("hardware", Build.HARDWARE)
                .put("webViewPackage", webViewPkg)
                .put("webViewVersion", webViewVer);

        StringBuilder providerList = new StringBuilder();
        for (Provider p : Security.getProviders()) {
            if (providerList.length() > 0) providerList.append("; ");
            providerList.append(p.getName()).append("@").append(p.getVersion());
        }
        env.put("securityProviders", providerList.toString());

        // 2. Load M6-01 KAT vectors-v1.json
        JSONObject vectors = new JSONObject(readAssetText(testCtx, "vectors-v1.json"));
        String katPassword = vectors.getString("password");
        JSONObject mat = vectors.getJSONObject("material");
        byte[] salt = hexToBytes(mat.getString("saltHex"));
        byte[] backupId = hexToBytes(mat.getString("backupIdHex"));
        byte[] wrapNonce = hexToBytes(mat.getString("wrapNonceHex"));
        byte[] bek = hexToBytes(mat.getString("bekHex"));

        byte[] pwBytes = encodeStrictPasswordUtf8(katPassword);
        byte[] kekSalt = concat("KPB1/KEK\0".getBytes(StandardCharsets.US_ASCII), salt, backupId);

        // 3. Test JCA SecretKeyFactory("PBKDF2WithHmacSHA256") vs byte-safe Mac PBKDF2
        JSONObject jcaPbkdf2Report = new JSONObject();
        try {
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            jcaPbkdf2Report.put("provider", providerSummary(skf.getProvider()));
            // ASCII sanity check
            byte[] asciiByteRef = pbkdf2HmacSha256ByteSafe(
                    "ascii-123".getBytes(StandardCharsets.UTF_8), kekSalt, 1000, 32, null, null);
            byte[] asciiJca = skf.generateSecret(
                    new PBEKeySpec("ascii-123".toCharArray(), kekSalt, 1000, 256)).getEncoded();
            jcaPbkdf2Report.put("ascii1000MatchesByteSafe", MessageDigest.isEqual(asciiByteRef, asciiJca));

            // UTF-8 + NUL KAT password check on JCA SecretKeyFactory
            try {
                byte[] utf8Jca = skf.generateSecret(
                        new PBEKeySpec(katPassword.toCharArray(), kekSalt, 600000, 256)).getEncoded();
                byte[] expectedKek = hexToBytes(vectors.getJSONObject("emptyPackage").getString("baseKekHex"));
                jcaPbkdf2Report.put("katPasswordStatus", "RETURNED_BYTES");
                jcaPbkdf2Report.put("katPasswordMatchesM601", MessageDigest.isEqual(utf8Jca, expectedKek));
                jcaPbkdf2Report.put("katPasswordDerivedHex", bytesToHex(utf8Jca));
            } catch (Throwable t) {
                jcaPbkdf2Report.put("katPasswordStatus", "THREW_" + t.getClass().getSimpleName());
                jcaPbkdf2Report.put("katPasswordError", String.valueOf(t.getMessage()));
            }
        } catch (Throwable t) {
            jcaPbkdf2Report.put("available", false);
            jcaPbkdf2Report.put("error", t.getClass().getName() + ": " + t.getMessage());
        }
        report("JCA_PBKDF2", jcaPbkdf2Report);

        // 4. Zero-alloc Byte-safe PBKDF2 + HKDF + AES-GCM KAT exact match on emptyPackage & populatedPackage
        // Also cross-check single short Mac("HmacSHA256") call for provider capture without triggering Scudo OOM.
        AtomicReference<String> macProvider = new AtomicReference<>();
        AtomicReference<String> gcmProvider = new AtomicReference<>();
        byte[] macShortCheck = pbkdf2HmacSha256ByteSafe(pwBytes, kekSalt, 1000, 32, null, macProvider);
        byte[] zeroShortCheck = pbkdf2HmacSha256ZeroAlloc(pwBytes, kekSalt, 1000, 32, null);
        assertArrayEquals("Zero-alloc PBKDF2 must match JCA Mac PBKDF2 bit-for-bit", macShortCheck, zeroShortCheck);

        long t0 = SystemClock.elapsedRealtimeNanos();
        byte[] derivedKek = pbkdf2HmacSha256ZeroAlloc(pwBytes, kekSalt, 600000, 32, null);
        long pbkdf2ColdMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000L;

        env.put("macProvider", macProvider.get());

        for (String pkgKey : new String[] { "emptyPackage", "populatedPackage" }) {
            JSONObject pkgObj = vectors.getJSONObject(pkgKey);
            byte[] pkgBytes = hexToBytes(pkgObj.getString("packageHex"));
            assertEquals(pkgObj.getInt("packageByteLength"), pkgBytes.length);
            byte[] sha = MessageDigest.getInstance("SHA-256").digest(pkgBytes);
            assertEquals(pkgObj.getString("packageSha256"), bytesToHex(sha));

            assertEquals(pkgObj.getString("baseKekHex"), bytesToHex(derivedKek));

            byte[] header = Arrays.copyOfRange(pkgBytes, 0, 64);
            byte[] wrapInfo = concat("KPB1/wrap\0".getBytes(StandardCharsets.US_ASCII), header);
            byte[] wrapKey = hkdfSha256(derivedKek, backupId, wrapInfo, 32);
            assertEquals(pkgObj.getString("wrapKeyHex"), bytesToHex(wrapKey));

            byte[] encryptedWrap = aesGcmCrypt(Cipher.ENCRYPT_MODE, wrapKey, wrapNonce, bek, header, gcmProvider);
            byte[] reconstructedPrefix = concat(header, wrapNonce, encryptedWrap);
            assertEquals(pkgObj.getString("prefixHex"), bytesToHex(reconstructedPrefix));

            byte[] envDigest = MessageDigest.getInstance("SHA-256").digest(reconstructedPrefix);
            assertEquals(pkgObj.getString("envelopeDigestHex"), bytesToHex(envDigest));

            // Frame keys
            byte[] manifestKey = hkdfSha256(
                    bek, backupId, concat("KPB1/frame\0".getBytes(StandardCharsets.US_ASCII), u16be(0), new byte[]{1}), 32);
            byte[] dataKey = hkdfSha256(
                    bek, backupId, concat("KPB1/frame\0".getBytes(StandardCharsets.US_ASCII), u16be(1), new byte[]{2}), 32);
            byte[] footerKey = hkdfSha256(
                    bek, backupId, concat("KPB1/frame\0".getBytes(StandardCharsets.US_ASCII), u16be(0), new byte[]{3}), 32);
            assertEquals(pkgObj.getString("manifestKeyHex"), bytesToHex(manifestKey));
            assertEquals(pkgObj.getString("dataKeyHex"), bytesToHex(dataKey));
            assertEquals(pkgObj.getString("footerKeyHex"), bytesToHex(footerKey));

            // Decrypt & re-encrypt every frame from pkgBytes verifying byte-for-byte identity
            int pos = 124;
            MessageDigest transcript = MessageDigest.getInstance("SHA-256");
            transcript.update("KPB1/transcript\0".getBytes(StandardCharsets.US_ASCII));
            transcript.update(envDigest);

            // Frame 0: Manifest
            byte[] mfHeader = Arrays.copyOfRange(pkgBytes, pos, pos + 20);
            long mfPlainLen = readU32be(mfHeader, 12);
            long mfCipherLen = readU32be(mfHeader, 16);
            assertEquals(40L, mfPlainLen);
            assertEquals(56L, mfCipherLen);
            byte[] mfCipher = Arrays.copyOfRange(pkgBytes, pos + 20, pos + 20 + (int) mfCipherLen);
            byte[] mfNonce = concat(u16be(0), new byte[]{1, 0}, u64be(0));
            byte[] mfAad = concat(envDigest, mfHeader);
            byte[] mfPlain = aesGcmCrypt(Cipher.DECRYPT_MODE, manifestKey, mfNonce, mfCipher, mfAad, null);
            byte[] mfReEnc = aesGcmCrypt(Cipher.ENCRYPT_MODE, manifestKey, mfNonce, mfPlain, mfAad, null);
            assertArrayEquals(mfCipher, mfReEnc);
            byte[] mfFull = concat(mfHeader, mfCipher);
            assertEquals(pkgObj.getString("manifestFrameHex"), bytesToHex(mfFull));
            transcript.update(mfFull);
            pos += 20 + (int) mfCipherLen;

            // Data frames
            int dataCount = pkgObj.getInt("dataFrameCount");
            long sumPlain = 0;
            long sumCipher = 0;
            for (int idx = 0; idx < dataCount; idx++) {
                byte[] dfHeader = Arrays.copyOfRange(pkgBytes, pos, pos + 20);
                assertEquals(1, readU16be(dfHeader, 0));
                assertEquals(2, dfHeader[2] & 0xff);
                long dfPlainLen = readU32be(dfHeader, 12);
                long dfCipherLen = readU32be(dfHeader, 16);
                assertEquals(dfPlainLen + 16, dfCipherLen);
                byte[] dfCipher = Arrays.copyOfRange(pkgBytes, pos + 20, pos + 20 + (int) dfCipherLen);
                byte[] dfNonce = concat(u16be(1), new byte[]{2, 0}, u64be(idx));
                byte[] dfAad = concat(envDigest, dfHeader);
                byte[] dfPlain = aesGcmCrypt(Cipher.DECRYPT_MODE, dataKey, dfNonce, dfCipher, dfAad, null);
                assertEquals(dfPlainLen, dfPlain.length);
                byte[] dfReEnc = aesGcmCrypt(Cipher.ENCRYPT_MODE, dataKey, dfNonce, dfPlain, dfAad, null);
                assertArrayEquals(dfCipher, dfReEnc);
                transcript.update(concat(dfHeader, dfCipher));
                sumPlain += dfPlainLen;
                sumCipher += dfCipherLen;
                pos += 20 + (int) dfCipherLen;
            }
            assertEquals(pkgObj.getLong("totalPlaintextBytes"), sumPlain);
            assertEquals(pkgObj.getLong("totalCiphertextBytes"), sumCipher);
            byte[] actualTranscript = transcript.digest();
            assertEquals(pkgObj.getString("transcriptHex"), bytesToHex(actualTranscript));

            // Footer frame
            byte[] ffHeader = Arrays.copyOfRange(pkgBytes, pos, pos + 20);
            long ffPlainLen = readU32be(ffHeader, 12);
            long ffCipherLen = readU32be(ffHeader, 16);
            assertEquals(2152L, ffPlainLen);
            assertEquals(2168L, ffCipherLen);
            byte[] ffCipher = Arrays.copyOfRange(pkgBytes, pos + 20, pos + 20 + (int) ffCipherLen);
            byte[] ffNonce = concat(u16be(0), new byte[]{3, 0}, u64be(0));
            byte[] ffAad = concat(envDigest, ffHeader);
            byte[] ffPlain = aesGcmCrypt(Cipher.DECRYPT_MODE, footerKey, ffNonce, ffCipher, ffAad, null);
            byte[] ffReEnc = aesGcmCrypt(Cipher.ENCRYPT_MODE, footerKey, ffNonce, ffPlain, ffAad, null);
            assertArrayEquals(ffCipher, ffReEnc);
            assertEquals(pkgObj.getString("footerFrameHex"), bytesToHex(concat(ffHeader, ffCipher)));
            assertEquals(bytesToHex(actualTranscript), bytesToHex(Arrays.copyOfRange(ffPlain, 20, 52)));
            pos += 20 + (int) ffCipherLen;
            assertEquals(pkgBytes.length, pos);

            // Negative checks: wrong key, tampered ciphertext, tampered tag, tampered AAD, wrong nonce
            byte[] badWrapKey = Arrays.copyOf(wrapKey, wrapKey.length);
            badWrapKey[0] ^= 1;
            assertThrows(AEADBadTagException.class, () ->
                    aesGcmCrypt(Cipher.DECRYPT_MODE, badWrapKey, wrapNonce, encryptedWrap, header, null));

            byte[] badCipher = Arrays.copyOf(encryptedWrap, encryptedWrap.length);
            badCipher[0] ^= 1;
            assertThrows(AEADBadTagException.class, () ->
                    aesGcmCrypt(Cipher.DECRYPT_MODE, wrapKey, wrapNonce, badCipher, header, null));

            byte[] badTag = Arrays.copyOf(encryptedWrap, encryptedWrap.length);
            badTag[badTag.length - 1] ^= 1;
            assertThrows(AEADBadTagException.class, () ->
                    aesGcmCrypt(Cipher.DECRYPT_MODE, wrapKey, wrapNonce, badTag, header, null));

            byte[] badAad = Arrays.copyOf(header, header.length);
            badAad[63] ^= 1;
            assertThrows(AEADBadTagException.class, () ->
                    aesGcmCrypt(Cipher.DECRYPT_MODE, wrapKey, wrapNonce, encryptedWrap, badAad, null));

            byte[] badNonce = Arrays.copyOf(wrapNonce, wrapNonce.length);
            badNonce[11] ^= 1;
            assertThrows(AEADBadTagException.class, () ->
                    aesGcmCrypt(Cipher.DECRYPT_MODE, wrapKey, badNonce, encryptedWrap, header, null));
        }

        env.put("gcmProvider", gcmProvider.get());
        report("ENV_AND_PROVIDERS", env);

        // 5. UTF-8 edge cases (Chinese, Astral, NFC vs NFD, spaces, NUL, BOM, lone surrogates)
        for (String bad : new String[] { "", "\uD800", "\uDC00", "abc\uD83D", "\uDCE6xyz", "\uDBFF\u0041" }) {
            assertThrows("Must reject bad password", IllegalArgumentException.class,
                    () -> encodeStrictPasswordUtf8(bad));
        }
        String nfc = "\u00e9";
        String nfd = "e\u0301";
        byte[] nfcKey = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8(nfc), salt, 1000, 32, null);
        byte[] nfdKey = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8(nfd), salt, 1000, 32, null);
        assertFalse("NFC and NFD must not be normalized together", MessageDigest.isEqual(nfcKey, nfdKey));
        byte[] nulA = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("a\u0000b"), salt, 1000, 32, null);
        byte[] nulB = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("a"), salt, 1000, 32, null);
        assertFalse("NUL must not truncate password", MessageDigest.isEqual(nulA, nulB));
        byte[] bomA = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("\ufeffabc"), salt, 1000, 32, null);
        byte[] bomB = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("abc"), salt, 1000, 32, null);
        assertFalse("BOM must be preserved", MessageDigest.isEqual(bomA, bomB));
        byte[] spA = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8(" abc "), salt, 1000, 32, null);
        byte[] spB = pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("abc"), salt, 1000, 32, null);
        assertFalse("Leading/trailing spaces must be preserved", MessageDigest.isEqual(spA, spB));

        report("UTF8_EDGE_CASES", new JSONObject()
                .put("nfcHex", bytesToHex(nfcKey))
                .put("nfdHex", bytesToHex(nfdKey))
                .put("nulHex", bytesToHex(nulA))
                .put("bomHex", bytesToHex(bomA))
                .put("astralChineseHex", bytesToHex(
                        pbkdf2HmacSha256ZeroAlloc(encodeStrictPasswordUtf8("合成📦"), salt, 1000, 32, null))));

        // 6. Performance & resource benchmark across candidate iterations (informational only)
        JSONObject perf = new JSONObject();
        perf.put("impl", "zero_alloc_java_sha256_midstate");
        perf.put("pbkdf2_600k_cold_ms", pbkdf2ColdMs);
        int[] candidates = new int[] { 100_000, 210_000, 300_000, 600_000 };
        for (int iter : candidates) {
            long rssBefore = readVmRssKiB();
            long natBefore = Debug.getNativeHeapAllocatedSize();
            long javaBefore = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
            long start = SystemClock.elapsedRealtimeNanos();
            byte[] out = pbkdf2HmacSha256ZeroAlloc(pwBytes, kekSalt, iter, 32, null);
            long elapsedMs = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000L;
            long rssAfter = readVmRssKiB();
            long natAfter = Debug.getNativeHeapAllocatedSize();
            long javaAfter = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
            Arrays.fill(out, (byte) 0);
            perf.put("iter_" + iter + "_ms", elapsedMs);
            perf.put("iter_" + iter + "_rss_kib", rssAfter);
            perf.put("iter_" + iter + "_rss_delta_kib", rssAfter - rssBefore);
            perf.put("iter_" + iter + "_native_heap_delta_bytes", natAfter - natBefore);
            perf.put("iter_" + iter + "_java_heap_delta_bytes", javaAfter - javaBefore);
        }

        // Additional 5 warm runs of 600k for median/min/max
        long[] warm600k = new long[5];
        for (int r = 0; r < 5; r++) {
            long s = SystemClock.elapsedRealtimeNanos();
            byte[] out = pbkdf2HmacSha256ZeroAlloc(pwBytes, kekSalt, 600_000, 32, null);
            warm600k[r] = (SystemClock.elapsedRealtimeNanos() - s) / 1_000_000L;
            Arrays.fill(out, (byte) 0);
        }
        perf.put("pbkdf2_600k_warm_5runs_ms", Arrays.toString(warm600k));

        // Benchmark single JCA SecretKeyFactory 600k for comparison
        try {
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            long jStart = SystemClock.elapsedRealtimeNanos();
            byte[] jOut = skf.generateSecret(new PBEKeySpec(katPassword.toCharArray(), kekSalt, 600_000, 256)).getEncoded();
            perf.put("jca_skf_600k_ms", (SystemClock.elapsedRealtimeNanos() - jStart) / 1_000_000L);
            Arrays.fill(jOut, (byte) 0);
        } catch (Throwable t) {
            perf.put("jca_skf_600k_error", t.getClass().getSimpleName());
        }

        // 7. Cancellation latency test on 600k
        AtomicBoolean cancelled = new AtomicBoolean(false);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);
        AtomicLong cancelTriggerNs = new AtomicLong();
        AtomicLong cancelFinishNs = new AtomicLong();
        AtomicReference<Throwable> cancelError = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            started.countDown();
            try {
                pbkdf2HmacSha256ZeroAlloc(pwBytes, kekSalt, 600_000, 32, cancelled);
            } catch (Throwable t) {
                cancelError.set(t);
            } finally {
                cancelFinishNs.set(SystemClock.elapsedRealtimeNanos());
                finished.countDown();
            }
        });
        worker.start();
        assertTrue(started.await(5, TimeUnit.SECONDS));
        Thread.sleep(25);
        cancelTriggerNs.set(SystemClock.elapsedRealtimeNanos());
        cancelled.set(true);
        assertTrue(finished.await(5, TimeUnit.SECONDS));
        assertTrue(cancelError.get() instanceof InterruptedException);
        long cancelLatencyMs = (cancelFinishNs.get() - cancelTriggerNs.get()) / 1_000_000L;
        perf.put("cancel_600k_latency_ms", cancelLatencyMs);
        perf.put("peak_rss_kib_end", readVmRssKiB());
        perf.put("native_heap_alloc_bytes_end", Debug.getNativeHeapAllocatedSize());
        report("PERF_AND_CANCEL", perf);

        Arrays.fill(pwBytes, (byte) 0);
        Arrays.fill(derivedKek, (byte) 0);
    }

    @Test
    public void probeStandardPbkdf2VectorsAndFailureBufferWipe() throws Exception {
        // 1. Independent PBKDF2-HMAC-SHA256 standard vectors (RFC 7914 / NUL / >64-byte key)
        Object[][] stdVectors = new Object[][] {
                { "password".getBytes(StandardCharsets.UTF_8), "salt".getBytes(StandardCharsets.UTF_8), 1, 32,
                        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b" },
                { "password".getBytes(StandardCharsets.UTF_8), "salt".getBytes(StandardCharsets.UTF_8), 2, 32,
                        "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43" },
                { "password".getBytes(StandardCharsets.UTF_8), "salt".getBytes(StandardCharsets.UTF_8), 4096, 32,
                        "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a" },
                { "passwordPASSWORDpassword".getBytes(StandardCharsets.UTF_8),
                        "saltSALTsaltSALTsaltSALTsaltSALTsalt".getBytes(StandardCharsets.UTF_8), 4096, 40,
                        "348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9" },
                { "pass\u0000word".getBytes(StandardCharsets.UTF_8), "sa\u0000lt".getBytes(StandardCharsets.UTF_8), 4096, 16,
                        "89b69d0516f829893c696226650a8687" },
                { ("A".repeat(70) + "\u0000" + "B".repeat(10)).getBytes(StandardCharsets.UTF_8),
                        "long-key-salt-0123456789".getBytes(StandardCharsets.UTF_8), 1000, 48,
                        "5f1a8aa74130b6f114322e03286f836a18c4b3384f2c3cf4a9d94a3200db2eccf299dde4bac2020386b3daa7d443f62c" }
        };
        JSONObject vecReport = new JSONObject();
        for (int i = 0; i < stdVectors.length; i++) {
            byte[] p = (byte[]) stdVectors[i][0];
            byte[] s = (byte[]) stdVectors[i][1];
            int c = (int) stdVectors[i][2];
            int dkLen = (int) stdVectors[i][3];
            String expectedHex = (String) stdVectors[i][4];
            byte[] actual = pbkdf2HmacSha256ZeroAlloc(p, s, c, dkLen, null);
            assertEquals("Standard vector " + i + " mismatch", expectedHex, bytesToHex(actual));
            Arrays.fill(actual, (byte) 0);
            vecReport.put("vec_" + i + "_c" + c + "_dk" + dkLen, expectedHex);
        }

        // 2. Verify partial output buffer is wiped on mid-block-2 cancellation (keyLen=64)
        byte[] outBuf = new byte[64];
        byte[] pTest = "cancel-wipe-test".getBytes(StandardCharsets.UTF_8);
        byte[] sTest = "cancel-salt-16bb".getBytes(StandardCharsets.UTF_8);
        AtomicBoolean cancelled = new AtomicBoolean(false);
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<Throwable> err = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            try {
                pbkdf2HmacSha256ZeroAllocInto(pTest, sTest, 300_000, 64, cancelled, outBuf);
            } catch (Throwable t) {
                err.set(t);
            } finally {
                finished.countDown();
            }
        });
        worker.start();
        // Spin briefly until block 1 has been written into outBuf[0..31], then cancel during block 2!
        long deadline = SystemClock.elapsedRealtime() + 10_000;
        boolean sawPartialWrite = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            boolean nonZero = false;
            for (int i = 0; i < 32; i++) {
                if (outBuf[i] != 0) {
                    nonZero = true;
                    break;
                }
            }
            if (nonZero) {
                sawPartialWrite = true;
                cancelled.set(true);
                break;
            }
            Thread.yield();
        }
        assertTrue("Expected block 1 write before cancel", sawPartialWrite);
        assertTrue(finished.await(10, TimeUnit.SECONDS));
        assertTrue("Expected InterruptedException on cancel", err.get() instanceof InterruptedException);
        for (int i = 0; i < outBuf.length; i++) {
            assertEquals("Output buffer byte " + i + " was not wiped after cancel", 0, outBuf[i]);
        }

        // 3. Verify invalid-argument exception path does not leave caller sentinel or fail silently
        byte[] errBuf = new byte[32];
        Arrays.fill(errBuf, (byte) 0x55);
        assertThrows(IllegalArgumentException.class,
                () -> pbkdf2HmacSha256ZeroAllocInto(pTest, sTest, 0, 32, null, errBuf));

        vecReport.put("sawPartialBlock1WriteBeforeCancel", sawPartialWrite);
        vecReport.put("outputBufferWipedAfterCancel", true);
        vecReport.put("invalidArgRejected", true);
        report("F08_STD_VECTORS_AND_WIPE", vecReport);
    }
}
