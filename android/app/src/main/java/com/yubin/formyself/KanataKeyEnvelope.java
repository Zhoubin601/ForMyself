package com.yubin.formyself;

import android.util.AtomicFile;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** M0 v1 envelope. The only returned plaintext is the caller-owned DEK. */
final class KanataKeyEnvelope {
    private static final String PURPOSE = "kanata-sqlcipher-dek-wrap";
    private static final String KDF = "PBKDF2-SHA256";
    private static final String CIPHER = "AES-256-GCM";
    private static final String HEX = "0123456789abcdef";
    private static final SecureRandom RANDOM = new SecureRandom();

    private KanataKeyEnvelope() {}

    private static byte[] random(int size) {
        byte[] bytes = new byte[size];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static String encode(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static byte[] decode(JSONObject json, String field, int size) throws Exception {
        String text = json.getString(field);
        if (text.length() != 4 * ((size + 2) / 3)) throw new IOException();
        byte[] decoded = Base64.decode(text, Base64.NO_WRAP);
        if (decoded.length != size || !encode(decoded).equals(text)) throw new IOException();
        return decoded;
    }

    static JSONObject newHeader() throws Exception {
        return new JSONObject().put("version", 1).put("purpose", PURPOSE)
            .put("kdf", new JSONObject().put("name", KDF).put("iterations", 600000).put("length", 256))
            .put("cipher", CIPHER).put("salt", encode(random(16))).put("nonce", encode(random(12)));
    }

    private static byte[] read(AtomicFile file) throws IOException {
        try (InputStream input = file.openRead()) {
            byte[] buffer = new byte[256];
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            int size;
            while ((size = input.read(buffer)) != -1) {
                if (output.size() + size > 1024) throw new IOException();
                output.write(buffer, 0, size);
            }
            return output.toByteArray();
        }
    }

    static void writeVerified(AtomicFile file, byte[] data) throws IOException {
        FileOutputStream output = file.startWrite();
        try {
            output.write(data);
            output.getFD().sync();
            file.finishWrite(output);
        } catch (IOException | RuntimeException failure) {
            file.failWrite(output);
            throw failure;
        }
        if (!MessageDigest.isEqual(data, read(file))) throw new IOException();
    }

    static JSONObject readHeader(AtomicFile file) throws Exception {
        JSONObject header = new JSONObject(new String(read(file), StandardCharsets.UTF_8));
        JSONObject kdf = header.getJSONObject("kdf");
        if (header.length() != 7 || kdf.length() != 3 || !Integer.valueOf(1).equals(header.get("version"))
            || !PURPOSE.equals(header.get("purpose")) || !CIPHER.equals(header.get("cipher"))
            || !KDF.equals(kdf.get("name")) || !Integer.valueOf(600000).equals(kdf.get("iterations"))
            || !Integer.valueOf(256).equals(kdf.get("length"))) throw new IOException();
        decode(header, "salt", 16);
        decode(header, "nonce", 12);
        decode(header, "ciphertext", 48);
        return header;
    }

    private static byte[] crypt(int mode, byte[] kek, JSONObject header, byte[] data) throws Exception {
        byte[] nonce = decode(header, "nonce", 12);
        String aad = "{\"version\":1,\"purpose\":\"" + PURPOSE + "\",\"kdf\":"
            + "{\"name\":\"" + KDF + "\",\"iterations\":600000,\"length\":256},"
            + "\"cipher\":\"" + CIPHER + "\",\"salt\":\"" + encode(decode(header, "salt", 16))
            + "\",\"nonce\":\"" + encode(nonce) + "\"}";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(kek, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return cipher.doFinal(data);
    }

    static byte[] unwrap(byte[] kek, JSONObject header) throws Exception {
        return crypt(Cipher.DECRYPT_MODE, kek, header, decode(header, "ciphertext", 48));
    }

    static byte[] create(AtomicFile file, JSONObject header, byte[] kek) throws Exception {
        byte[] generated = random(32);
        try {
            header.put("ciphertext", encode(crypt(Cipher.ENCRYPT_MODE, kek, header, generated)));
            writeVerified(file, header.toString().getBytes(StandardCharsets.UTF_8));
            byte[] verified = unwrap(kek, readHeader(file));
            if (MessageDigest.isEqual(generated, verified)) return verified;
            Arrays.fill(verified, (byte) 0);
            throw new IOException();
        } finally { Arrays.fill(generated, (byte) 0); }
    }

    static void decodeKek(String text, byte[] result) throws IOException {
        if (text == null || text.length() != 64 || result.length != 32) throw new IOException();
        for (int i = 0; i < result.length; i++) {
            int high = HEX.indexOf(text.charAt(2 * i));
            int low = HEX.indexOf(text.charAt(2 * i + 1));
            if (high < 0 || low < 0) throw new IOException();
            result[i] = (byte) ((high << 4) | low);
        }
    }

    static byte[] rawSqlCipherKey(byte[] dek) throws IOException {
        if (dek.length != 32) throw new IOException();
        byte[] key = new byte[67];
        key[0] = 'x';
        key[1] = key[66] = '\'';
        for (int i = 0; i < dek.length; i++) {
            key[2 + 2 * i] = (byte) HEX.charAt((dek[i] & 255) >>> 4);
            key[3 + 2 * i] = (byte) HEX.charAt(dek[i] & 15);
        }
        return key;
    }
}
