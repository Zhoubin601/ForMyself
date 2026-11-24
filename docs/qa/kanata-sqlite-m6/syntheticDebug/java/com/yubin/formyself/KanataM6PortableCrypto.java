package com.yubin.formyself;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CharsetEncoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Shared KPB1 cryptographic & strict UTF-8/wire primitives for M6-02 isolated synthetic tests.
 * Uses zero-allocation SHA-256 midstate PBKDF2-HMAC-SHA256 to avoid Conscrypt OpenSSLMac Scudo OOM.
 */
public final class KanataM6PortableCrypto {
    public static final byte[] MAGIC = new byte[] { 0x4b, 0x41, 0x4e, 0x41, 0x54, 0x41, 0x31, 0x00 };
    public static final int FORMAT_VERSION = 1;
    public static final int CIPHER_SUITE = 1;
    public static final int SYNTHETIC_PROFILE = 0xff01;
    public static final int PRODUCTION_PROFILE = 0x0001;
    public static final int SYNTHETIC_ITERATIONS = 600_000;
    public static final int SCOPE_KANATA_SINGLE = 1;
    public static final int PAYLOAD_LOGICAL_V1 = 1;
    public static final int FRAME_LIMIT = 65_536;

    public static final int HEADER_SIZE = 64;
    public static final int SALT_SIZE = 16;
    public static final int BACKUP_ID_SIZE = 16;
    public static final int WRAP_NONCE_SIZE = 12;
    public static final int FRAME_NONCE_SIZE = 12;
    public static final int KEY_SIZE = 32;
    public static final int DIGEST_SIZE = 32;
    public static final int TAG_SIZE = 16;
    public static final int ENVELOPE_SIZE = KEY_SIZE + TAG_SIZE;
    public static final int PREFIX_SIZE = HEADER_SIZE + WRAP_NONCE_SIZE + ENVELOPE_SIZE; // 124
    public static final int FRAME_HEADER_SIZE = 20;
    public static final int MANIFEST_SIZE = 40;
    public static final int FOOTER_TABLE_COUNT = 50;
    public static final int FOOTER_VERIFIER_SIZE = 42;
    public static final int FOOTER_SIZE = 52 + FOOTER_TABLE_COUNT * FOOTER_VERIFIER_SIZE; // 2152

    public static final int STREAM_CONTROL = 0;
    public static final int STREAM_DATA = 1;
    public static final int FRAME_MANIFEST = 1;
    public static final int FRAME_DATA = 2;
    public static final int FRAME_FOOTER = 3;
    public static final int FLAG_CONTINUE = 0;
    public static final int FLAG_FINAL = 1;

    public static final int MAX_PASSWORD_CHARS = 1024;
    public static final int MAX_PASSWORD_BYTES = 1024;
    public static final int MAX_DATA_FRAMES = 65_536;
    public static final long MAX_DATA_PLAINTEXT_BYTES = 4_294_967_296L;
    public static final long MAX_PACKAGE_BYTES = 4_294_967_296L + 2_361_684L;
    public static final int MAX_TEXT_FIELD_BYTES = 2_097_152; // 2 MiB
    public static final int MAX_ROW_BODY_BYTES = 4_194_304;   // 4 MiB
    public static final long MAX_BUSINESS_ROWS = 16_777_216L;
    public static final long MAX_ORDINAL = 9_007_199_254_740_991L;
    public static final int MAX_ZERO_PROGRESS_READS = 8;

    public static final String ERR_UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT";
    public static final String ERR_RESOURCE_LIMIT = "RESOURCE_LIMIT";
    public static final String ERR_AUTH_FAILED = "AUTH_FAILED";
    public static final String ERR_INVALID_CONTAINER = "INVALID_CONTAINER";
    public static final String ERR_INVALID_LOGICAL = "INVALID_LOGICAL";
    public static final String ERR_INVALID_PASSWORD_INPUT = "INVALID_PASSWORD_INPUT";
    public static final String ERR_IO_FAILED = "IO_FAILED";
    public static final String ERR_DURABILITY_UNCONFIRMED = "DURABILITY_UNCONFIRMED";
    public static final String ERR_CANCELLED = "CANCELLED";
    public static final String ERR_ARRAY_ORDER_INCOMPLETE = "ARRAY_ORDER_INCOMPLETE";

    private static final SecureRandom RNG = new SecureRandom();

    public static final class PortableException extends RuntimeException {
        public final String code;
        public final String stage;

        public PortableException(String code, String stage) {
            super(code + " (" + stage + ")");
            this.code = code;
            this.stage = stage;
        }

        public PortableException(String code, String stage, Throwable cause) {
            super(code + " (" + stage + ")", cause);
            this.code = code;
            this.stage = stage;
        }
    }

    public static void requirePortable(boolean ok, String code, String stage) {
        if (!ok) throw new PortableException(code, stage);
    }

    public static void checkCancelled(AtomicBoolean cancelled) {
        if (cancelled != null && cancelled.get()) {
            throw new PortableException(ERR_CANCELLED, "cancelled");
        }
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

    private KanataM6PortableCrypto() {}

    public static byte[] randomBytes(int len) {
        byte[] out = new byte[len];
        RNG.nextBytes(out);
        return out;
    }

    public static void zeroize(byte[]... bufs) {
        if (bufs == null) return;
        for (byte[] b : bufs) {
            if (b != null) Arrays.fill(b, (byte) 0);
        }
    }

    public static boolean constantTimeEquals(byte[] a, byte[] b) {
        return a != null && b != null && MessageDigest.isEqual(a, b);
    }

    public static int compareUnsignedBytes(byte[] a, byte[] b) {
        int len = Math.min(a.length, b.length);
        for (int i = 0; i < len; i++) {
            int av = a[i] & 0xff;
            int bv = b[i] & 0xff;
            if (av != bv) return av < bv ? -1 : 1;
        }
        return Integer.compare(a.length, b.length);
    }

    public static String bytesToHex(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    public static byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return out;
    }

    public static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) total += p.length;
        byte[] out = new byte[total];
        int off = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, off, p.length);
            off += p.length;
        }
        return out;
    }

    public static void writeU16BE(byte[] b, int off, int v) {
        b[off] = (byte) (v >>> 8);
        b[off + 1] = (byte) v;
    }

    public static void writeU32BE(byte[] b, int off, long v) {
        b[off] = (byte) (v >>> 24);
        b[off + 1] = (byte) (v >>> 16);
        b[off + 2] = (byte) (v >>> 8);
        b[off + 3] = (byte) v;
    }

    public static void writeU64BE(byte[] b, int off, long v) {
        b[off] = (byte) (v >>> 56);
        b[off + 1] = (byte) (v >>> 48);
        b[off + 2] = (byte) (v >>> 40);
        b[off + 3] = (byte) (v >>> 32);
        b[off + 4] = (byte) (v >>> 24);
        b[off + 5] = (byte) (v >>> 16);
        b[off + 6] = (byte) (v >>> 8);
        b[off + 7] = (byte) v;
    }

    public static int readU16BE(byte[] b, int off) {
        return ((b[off] & 0xff) << 8) | (b[off + 1] & 0xff);
    }

    public static long readU32BE(byte[] b, int off) {
        return ((long) (b[off] & 0xff) << 24)
                | ((long) (b[off + 1] & 0xff) << 16)
                | ((long) (b[off + 2] & 0xff) << 8)
                | ((long) (b[off + 3] & 0xff));
    }

    public static long readU64BE(byte[] b, int off) {
        return ((long) (b[off] & 0xff) << 56)
                | ((long) (b[off + 1] & 0xff) << 48)
                | ((long) (b[off + 2] & 0xff) << 40)
                | ((long) (b[off + 3] & 0xff) << 32)
                | ((long) (b[off + 4] & 0xff) << 24)
                | ((long) (b[off + 5] & 0xff) << 16)
                | ((long) (b[off + 6] & 0xff) << 8)
                | ((long) (b[off + 7] & 0xff));
    }

    public static boolean isWellFormedUtf16(String s) {
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

    public static byte[] encodeStrictPasswordUtf8(String password) {
        if (password == null || password.isEmpty() || password.length() > MAX_PASSWORD_CHARS
                || !isWellFormedUtf16(password)) {
            throw new PortableException(ERR_INVALID_PASSWORD_INPUT, "password");
        }
        try {
            CharsetEncoder encoder = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT);
            ByteBuffer encoded = encoder.encode(CharBuffer.wrap(password));
            byte[] out = new byte[encoded.remaining()];
            encoded.get(out);
            if (encoded.hasArray()) Arrays.fill(encoded.array(), (byte) 0);
            if (out.length == 0 || out.length > MAX_PASSWORD_BYTES) {
                Arrays.fill(out, (byte) 0);
                throw new PortableException(ERR_INVALID_PASSWORD_INPUT, "password");
            }
            return out;
        } catch (PortableException pe) {
            throw pe;
        } catch (Exception e) {
            throw new PortableException(ERR_INVALID_PASSWORD_INPUT, "password", e);
        }
    }

    public static byte[] encodeStrictUtf8(String value, String stage) {
        if (value == null || !isWellFormedUtf16(value)) {
            throw new PortableException(ERR_INVALID_LOGICAL, stage);
        }
        try {
            CharsetEncoder encoder = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT);
            ByteBuffer encoded = encoder.encode(CharBuffer.wrap(value));
            if (encoded.remaining() > MAX_TEXT_FIELD_BYTES) {
                if (encoded.hasArray()) Arrays.fill(encoded.array(), (byte) 0);
                throw new PortableException(ERR_RESOURCE_LIMIT, stage);
            }
            byte[] out = new byte[encoded.remaining()];
            encoded.get(out);
            if (encoded.hasArray()) Arrays.fill(encoded.array(), (byte) 0);
            return out;
        } catch (PortableException pe) {
            throw pe;
        } catch (Exception e) {
            throw new PortableException(ERR_INVALID_LOGICAL, stage, e);
        }
    }

    public static String decodeStrictUtf8(byte[] bytes, String stage) {
        requirePortable(bytes != null, ERR_INVALID_LOGICAL, stage);
        return decodeStrictUtf8(bytes, 0, bytes.length, stage);
    }

    /**
     * Strict RFC 3629 UTF-8 decoder that preserves leading/interior BOM (U+FEFF), embedded NUL (U+0000),
     * and original normalization forms, while rejecting overlong sequences, surrogate code points,
     * out-of-range code points (> U+10FFFF), and truncated/stray continuation bytes.
     * Avoids Android ICU CharsetDecoder which strips leading UTF-8 BOM (EF BB BF) at stream offset 0.
     */
    public static String decodeStrictUtf8(byte[] bytes, int offset, int length, String stage) {
        requirePortable(bytes != null && offset >= 0 && length >= 0 && offset + length <= bytes.length,
                ERR_INVALID_LOGICAL, stage);
        requirePortable(length <= MAX_TEXT_FIELD_BYTES, ERR_RESOURCE_LIMIT, stage);
        char[] out = new char[length];
        int charPos = 0;
        int i = offset;
        int end = offset + length;
        while (i < end) {
            int b1 = bytes[i++] & 0xff;
            if (b1 < 0x80) {
                out[charPos++] = (char) b1;
            } else if ((b1 >> 5) == 0x06) {
                if (i >= end) throw new PortableException(ERR_INVALID_LOGICAL, stage);
                int b2 = bytes[i++] & 0xff;
                if ((b2 & 0xc0) != 0x80) throw new PortableException(ERR_INVALID_LOGICAL, stage);
                int cp = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
                if (cp < 0x80) throw new PortableException(ERR_INVALID_LOGICAL, stage);
                out[charPos++] = (char) cp;
            } else if ((b1 >> 4) == 0x0e) {
                if (i + 1 >= end) throw new PortableException(ERR_INVALID_LOGICAL, stage);
                int b2 = bytes[i++] & 0xff;
                int b3 = bytes[i++] & 0xff;
                if ((b2 & 0xc0) != 0x80 || (b3 & 0xc0) != 0x80) {
                    throw new PortableException(ERR_INVALID_LOGICAL, stage);
                }
                int cp = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
                if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) {
                    throw new PortableException(ERR_INVALID_LOGICAL, stage);
                }
                out[charPos++] = (char) cp;
            } else if ((b1 >> 3) == 0x1e) {
                if (i + 2 >= end) throw new PortableException(ERR_INVALID_LOGICAL, stage);
                int b2 = bytes[i++] & 0xff;
                int b3 = bytes[i++] & 0xff;
                int b4 = bytes[i++] & 0xff;
                if ((b2 & 0xc0) != 0x80 || (b3 & 0xc0) != 0x80 || (b4 & 0xc0) != 0x80) {
                    throw new PortableException(ERR_INVALID_LOGICAL, stage);
                }
                int cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
                if (cp < 0x10000 || cp > 0x10ffff) {
                    throw new PortableException(ERR_INVALID_LOGICAL, stage);
                }
                int u = cp - 0x10000;
                out[charPos++] = (char) (0xd800 | (u >> 10));
                out[charPos++] = (char) (0xdc00 | (u & 0x3ff));
            } else {
                throw new PortableException(ERR_INVALID_LOGICAL, stage);
            }
        }
        return new String(out, 0, charPos);
    }

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

    public interface KdfProgressHook {
        void onKdfProgress(int block, int iteration);
    }

    public static byte[] pbkdf2HmacSha256ZeroAlloc(
            byte[] passwordBytes, byte[] salt, int iterations, int keyLen, AtomicBoolean cancelled) {
        byte[] out = new byte[keyLen];
        pbkdf2HmacSha256ZeroAllocInto(passwordBytes, salt, iterations, keyLen, cancelled, out, null);
        return out;
    }

    public static void pbkdf2HmacSha256ZeroAllocInto(
            byte[] passwordBytes, byte[] salt, int iterations, int keyLen, AtomicBoolean cancelled, byte[] out) {
        pbkdf2HmacSha256ZeroAllocInto(passwordBytes, salt, iterations, keyLen, cancelled, out, null);
    }

    public static void pbkdf2HmacSha256ZeroAllocInto(
            byte[] passwordBytes,
            byte[] salt,
            int iterations,
            int keyLen,
            AtomicBoolean cancelled,
            byte[] out,
            KdfProgressHook progressHook) {
        if (passwordBytes == null || salt == null || iterations <= 0 || keyLen <= 0 || out == null || out.length < keyLen) {
            throw new PortableException(ERR_INVALID_PASSWORD_INPUT, "pbkdf2-args");
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
                checkCancelled(cancelled);
                firstMsg[salt.length] = (byte) (block >>> 24);
                firstMsg[salt.length + 1] = (byte) (block >>> 16);
                firstMsg[salt.length + 2] = (byte) (block >>> 8);
                firstMsg[salt.length + 3] = (byte) block;

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

                System.arraycopy(state, 0, w, 0, 8);
                w[8] = 0x80000000;
                Arrays.fill(w, 9, 15, 0);
                w[15] = 768;
                System.arraycopy(opadMid, 0, state, 0, 8);
                sha256Compress(state, w);
                System.arraycopy(state, 0, u, 0, 8);
                System.arraycopy(state, 0, t, 0, 8);

                for (int iter = 2; iter <= iterations; iter++) {
                    if ((iter & 0x3ff) == 0) {
                        if (progressHook != null) {
                            progressHook.onKdfProgress(block, iter);
                        }
                        if (cancelled != null && cancelled.get()) {
                            throw new PortableException(ERR_CANCELLED, "kdf");
                        }
                    }
                    System.arraycopy(u, 0, w, 0, 8);
                    w[8] = 0x80000000;
                    w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0;
                    w[15] = 768;
                    System.arraycopy(ipadMid, 0, state, 0, 8);
                    sha256Compress(state, w);

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
            checkCancelled(cancelled);
            completed = true;
        } catch (PortableException pe) {
            throw pe;
        } catch (Exception e) {
            throw new PortableException(ERR_IO_FAILED, "kdf", e);
        } finally {
            if (!completed) Arrays.fill(out, 0, keyLen, (byte) 0);
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

    public static byte[] hkdfSha256(byte[] ikm, byte[] salt, byte[] info, int len) {
        byte[] prk = null;
        byte[] t = new byte[0];
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(salt, "HmacSHA256"));
            prk = mac.doFinal(ikm);
            byte[] okm = new byte[len];
            int offset = 0;
            int counter = 1;
            while (offset < len) {
                mac.init(new SecretKeySpec(prk, "HmacSHA256"));
                mac.update(t);
                mac.update(info);
                mac.update((byte) counter);
                Arrays.fill(t, (byte) 0);
                t = mac.doFinal();
                int take = Math.min(t.length, len - offset);
                System.arraycopy(t, 0, okm, offset, take);
                offset += take;
                counter++;
            }
            return okm;
        } catch (Exception e) {
            throw new PortableException(ERR_IO_FAILED, "hkdf", e);
        } finally {
            zeroize(prk, t);
        }
    }

    public static byte[] aesGcmEncrypt(byte[] key, byte[] nonce, byte[] plain, int plainLen, byte[] aad, String stage) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            if (aad != null && aad.length > 0) cipher.updateAAD(aad);
            return cipher.doFinal(plain, 0, plainLen);
        } catch (Exception e) {
            throw new PortableException(ERR_IO_FAILED, stage, e);
        }
    }

    public static byte[] aesGcmDecrypt(byte[] key, byte[] nonce, byte[] cipherAndTag, int cipherLen, byte[] aad, String stage) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            if (aad != null && aad.length > 0) cipher.updateAAD(aad);
            return cipher.doFinal(cipherAndTag, 0, cipherLen);
        } catch (AEADBadTagException bad) {
            throw new PortableException(ERR_AUTH_FAILED, stage, bad);
        } catch (Exception e) {
            throw new PortableException(ERR_AUTH_FAILED, stage, e);
        }
    }
}
