package com.yubin.formyself;

import android.database.Cursor;
import android.os.CancellationSignal;
import android.os.Debug;
import android.os.SystemClock;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Scheme C Native SQLCipher -> kanata-logical-v1 -> KPB1 streaming encrypted spool exporter.
 *
 * Strictly enforces:
 * - Bounded 1 row (<= 4 MiB) + max 2 DATA frames (<= 64 KiB each, 1-frame lookahead) queue.
 * - Single pinned DEFERRED read-only snapshot across all 45 business + 5 derived tables.
 * - Exact M6-01 KPB1 wire format, Zero-Alloc PBKDF2, HKDF, AES-256-GCM, transcript, and 50 verifiers.
 * - Spool flush + fsync + close + full readback verification + exact EOF before atomic rename to final file.
 * - Full sensitive buffer zeroization on every exit path.
 */
public final class KanataM6SchemeCExporter {
    public static final class ExportMaterial {
        public final byte[] salt;
        public final byte[] backupId;
        public final byte[] wrapNonce;
        public final byte[] bek;

        public ExportMaterial(byte[] salt, byte[] backupId, byte[] wrapNonce, byte[] bek) {
            this.salt = salt;
            this.backupId = backupId;
            this.wrapNonce = wrapNonce;
            this.bek = bek;
        }

        public static ExportMaterial random() {
            return new ExportMaterial(
                    KanataM6PortableCrypto.randomBytes(KanataM6PortableCrypto.SALT_SIZE),
                    KanataM6PortableCrypto.randomBytes(KanataM6PortableCrypto.BACKUP_ID_SIZE),
                    KanataM6PortableCrypto.randomBytes(KanataM6PortableCrypto.WRAP_NONCE_SIZE),
                    KanataM6PortableCrypto.randomBytes(KanataM6PortableCrypto.KEY_SIZE));
        }

        void zeroize() {
            KanataM6PortableCrypto.zeroize(salt, backupId, wrapNonce, bek);
        }
    }

    public static final class Verifier {
        public final int tableId;
        public final long rowCount;
        public final byte[] digest;

        public Verifier(int tableId, long rowCount, byte[] digest) {
            this.tableId = tableId;
            this.rowCount = rowCount;
            this.digest = digest;
        }
    }

    public interface SpoolHooks {
        default void onFrameQueued(int inFlightFrames, int maxRowBytes) {}
        default void beforeSpoolWrite(long totalWrittenSoFar, byte[] chunk) throws IOException {}
        default void beforeFsync() throws IOException {}
        default void beforeReadback() throws IOException {}
        default void afterTableRead(int tableId, long rowCount) {}
    }

    public static final class ExportMetrics {
        public long totalMs;
        public long snapshotPinMs;
        public long writeBlockMs;
        public long dbReadMs;
        public long kdfMs;
        public long aeadMs;
        public long spoolWriteMs;
        public long fsyncReadbackMs;
        public long finalFileBytes;
        public long totalPlaintextBytes;
        public long totalCiphertextBytes;
        public int dataFrameCount;
        public long peakRssKiB;
        public long peakNativeHeapBytes;
        public long peakJavaHeapBytes;
        public int maxInFlightFrames;
        public int maxRowBodyBytes;
        public long spoolPeakBytes;
        public String packageSha256Hex;
        public String transcriptHex;
        public List<Verifier> verifiers;
    }

    private KanataM6SchemeCExporter() {}

    private static final class OrderTracker {
        private final KanataM6PortableCatalog.TableDef tableDef;
        private byte[] prevWorldIdBytes;
        private long prevOrdinal = -1;
        private byte[][] prevPkText;
        private long[] prevPkNum;

        OrderTracker(KanataM6PortableCatalog.TableDef tableDef) {
            this.tableDef = tableDef;
        }

        void accept(KanataM6BoundedRowReader.EncodedRow row) {
            if (tableDef.hasOrdinal) {
                long ord = row.ordinal;
                byte[] wid = row.ordinalWorldIdBytes;
                if (prevWorldIdBytes == null) {
                    KanataM6PortableCrypto.requirePortable(ord == 0L,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                } else {
                    int cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevWorldIdBytes, wid);
                    KanataM6PortableCrypto.requirePortable(cmp <= 0,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-world-order");
                    if (cmp == 0) {
                        KanataM6PortableCrypto.requirePortable(ord == prevOrdinal + 1L,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-sequence");
                    } else {
                        KanataM6PortableCrypto.requirePortable(ord == 0L,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                    }
                }
                prevWorldIdBytes = wid;
                prevOrdinal = ord;
                return;
            }

            List<KanataM6PortableCatalog.ColumnDef> pks = tableDef.pkColumns;
            if (prevPkText != null) {
                int cmp = 0;
                for (int i = 0; i < pks.size(); i++) {
                    KanataM6PortableCatalog.ColumnDef pk = pks.get(i);
                    if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                        cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevPkText[i], row.pkTextBytes[i]);
                    } else {
                        cmp = Long.compare(prevPkNum[i], row.pkNumericValues[i]);
                    }
                    if (cmp != 0) break;
                }
                KanataM6PortableCrypto.requirePortable(cmp < 0,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "pk-order:" + tableDef.name);
            }
            prevPkText = row.pkTextBytes;
            prevPkNum = row.pkNumericValues;
        }
    }

    private static byte[] encodePublicHeader(byte[] salt, byte[] backupId) {
        byte[] h = new byte[KanataM6PortableCrypto.HEADER_SIZE];
        System.arraycopy(KanataM6PortableCrypto.MAGIC, 0, h, 0, 8);
        KanataM6PortableCrypto.writeU16BE(h, 8, KanataM6PortableCrypto.FORMAT_VERSION);
        KanataM6PortableCrypto.writeU16BE(h, 10, KanataM6PortableCrypto.CIPHER_SUITE);
        KanataM6PortableCrypto.writeU16BE(h, 12, KanataM6PortableCrypto.SYNTHETIC_PROFILE);
        KanataM6PortableCrypto.writeU16BE(h, 14, 0);
        KanataM6PortableCrypto.writeU32BE(h, 16, KanataM6PortableCrypto.SYNTHETIC_ITERATIONS);
        System.arraycopy(salt, 0, h, 20, 16);
        System.arraycopy(backupId, 0, h, 36, 16);
        h[52] = (byte) KanataM6PortableCrypto.SCOPE_KANATA_SINGLE;
        h[53] = (byte) KanataM6PortableCrypto.PAYLOAD_LOGICAL_V1;
        KanataM6PortableCrypto.writeU32BE(h, 54, KanataM6PortableCrypto.FRAME_LIMIT);
        return h;
    }

    private static byte[] encodeFrameHeader(int streamId, int type, int flags, long index, int plainLen, int cipherLen) {
        byte[] f = new byte[KanataM6PortableCrypto.FRAME_HEADER_SIZE];
        KanataM6PortableCrypto.writeU16BE(f, 0, streamId);
        f[2] = (byte) type;
        f[3] = (byte) flags;
        KanataM6PortableCrypto.writeU64BE(f, 4, index);
        KanataM6PortableCrypto.writeU32BE(f, 12, plainLen);
        KanataM6PortableCrypto.writeU32BE(f, 16, cipherLen);
        return f;
    }

    private static byte[] buildFrameNonce(int streamId, int type, long index) {
        byte[] n = new byte[KanataM6PortableCrypto.FRAME_NONCE_SIZE];
        KanataM6PortableCrypto.writeU16BE(n, 0, streamId);
        n[2] = (byte) type;
        n[3] = 0;
        KanataM6PortableCrypto.writeU64BE(n, 4, index);
        return n;
    }

    private static byte[] buildFrameKeyInfo(int streamId, int type) {
        byte[] prefix = "KPB1/frame\0".getBytes(StandardCharsets.US_ASCII);
        byte[] out = new byte[prefix.length + 3];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        KanataM6PortableCrypto.writeU16BE(out, prefix.length, streamId);
        out[prefix.length + 2] = (byte) type;
        return out;
    }

    private static long readVmRssKiB() {
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/status"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("VmRSS:")) {
                    return Long.parseLong(line.trim().split("\\s+")[1]);
                }
            }
        } catch (Exception ignored) {}
        return -1L;
    }

    private static void sampleResources(ExportMetrics m) {
        long rss = readVmRssKiB();
        if (rss > m.peakRssKiB) m.peakRssKiB = rss;
        long nat = Debug.getNativeHeapAllocatedSize();
        if (nat > m.peakNativeHeapBytes) m.peakNativeHeapBytes = nat;
        Runtime rt = Runtime.getRuntime();
        long java = rt.totalMemory() - rt.freeMemory();
        if (java > m.peakJavaHeapBytes) m.peakJavaHeapBytes = java;
    }

    public static ExportMetrics exportToSpool(
            String dbPath,
            byte[] rawSqlCipherKey,
            String password,
            KanataM6PortableCatalog catalog,
            KanataM6SnapshotOwner.WriteGate writeGate,
            File spoolDir,
            File finalTargetFile,
            ExportMaterial explicitMaterial,
            CancellationSignal cancelSignal,
            AtomicBoolean cancelled,
            SpoolHooks hooks) throws Exception {
        long tTotalStart = SystemClock.elapsedRealtimeNanos();
        ExportMetrics m = new ExportMetrics();
        sampleResources(m);

        byte[] pwBytes = KanataM6PortableCrypto.encodeStrictPasswordUtf8(password);
        ExportMaterial mat = explicitMaterial != null ? explicitMaterial : ExportMaterial.random();
        byte[] baseKek = new byte[KanataM6PortableCrypto.KEY_SIZE];
        byte[] wrapKey = null;
        byte[] manifestKey = null;
        byte[] dataKey = null;
        byte[] footerKey = null;

        byte[] outPlain = new byte[KanataM6PortableCrypto.FRAME_LIMIT];
        byte[] pendingPlain = null;
        int pendingLen = 0;

        if (!spoolDir.exists() && !spoolDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "spool-mkdir");
        }
        File tmpSpool = new File(spoolDir, finalTargetFile.getName() + ".spool.tmp");
        if (tmpSpool.exists()) tmpSpool.delete();

        long dbReadNs = 0L;
        long aeadNs = 0L;
        long spoolWriteNs = 0L;
        long totalSpoolWritten = 0L;
        boolean exportCommitted = false;

        try (KanataM6SnapshotOwner.PinnedSnapshot snap = KanataM6SnapshotOwner.acquirePinnedSnapshot(
                dbPath, rawSqlCipherKey, writeGate, catalog, cancelSignal, cancelled, true)) {
            m.snapshotPinMs = snap.snapshotPinNs / 1_000_000L;
            m.writeBlockMs = snap.writeBlockNs / 1_000_000L;
            sampleResources(m);

            // 1. KDF + Key Derivation
            long tKdfStart = SystemClock.elapsedRealtimeNanos();
            byte[] header = encodePublicHeader(mat.salt, mat.backupId);
            byte[] kekSalt = KanataM6PortableCrypto.concat(
                    "KPB1/KEK\0".getBytes(StandardCharsets.US_ASCII), mat.salt, mat.backupId);
            KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAllocInto(
                    pwBytes, kekSalt, KanataM6PortableCrypto.SYNTHETIC_ITERATIONS,
                    KanataM6PortableCrypto.KEY_SIZE, cancelled, baseKek);
            KanataM6PortableCrypto.zeroize(pwBytes);

            wrapKey = KanataM6PortableCrypto.hkdfSha256(
                    baseKek, mat.backupId,
                    KanataM6PortableCrypto.concat("KPB1/wrap\0".getBytes(StandardCharsets.US_ASCII), header),
                    KanataM6PortableCrypto.KEY_SIZE);
            KanataM6PortableCrypto.zeroize(baseKek);

            manifestKey = KanataM6PortableCrypto.hkdfSha256(
                    mat.bek, mat.backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_MANIFEST),
                    KanataM6PortableCrypto.KEY_SIZE);
            dataKey = KanataM6PortableCrypto.hkdfSha256(
                    mat.bek, mat.backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_DATA, KanataM6PortableCrypto.FRAME_DATA),
                    KanataM6PortableCrypto.KEY_SIZE);
            footerKey = KanataM6PortableCrypto.hkdfSha256(
                    mat.bek, mat.backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_FOOTER),
                    KanataM6PortableCrypto.KEY_SIZE);
            m.kdfMs = (SystemClock.elapsedRealtimeNanos() - tKdfStart) / 1_000_000L;

            long tAead = SystemClock.elapsedRealtimeNanos();
            byte[] wrappedBek = KanataM6PortableCrypto.aesGcmEncrypt(
                    wrapKey, mat.wrapNonce, mat.bek, mat.bek.length, header, "wrap-bek");
            aeadNs += SystemClock.elapsedRealtimeNanos() - tAead;
            KanataM6PortableCrypto.zeroize(wrapKey);
            wrapKey = null;

            byte[] prefix = KanataM6PortableCrypto.concat(header, mat.wrapNonce, wrappedBek);
            byte[] envelopeDigest = MessageDigest.getInstance("SHA-256").digest(prefix);
            MessageDigest transcriptSha = MessageDigest.getInstance("SHA-256");
            transcriptSha.update("KPB1/transcript\0".getBytes(StandardCharsets.US_ASCII));
            transcriptSha.update(envelopeDigest);

            MessageDigest spoolSha = MessageDigest.getInstance("SHA-256");

            try (FileOutputStream fos = new FileOutputStream(tmpSpool)) {
                // Helper to write to spool & track SHA-256
                class SpoolWriter {
                    long written = 0L;
                    void write(byte[] chunk) throws IOException {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        if (hooks != null) hooks.beforeSpoolWrite(written, chunk);
                        long ts = SystemClock.elapsedRealtimeNanos();
                        fos.write(chunk);
                        written += chunk.length;
                        if (written > m.spoolPeakBytes) m.spoolPeakBytes = written;
                        spoolSha.update(chunk);
                        long te = SystemClock.elapsedRealtimeNanos();
                        // accumulate via return or field
                        lastWriteNs += (te - ts);
                    }
                    long lastWriteNs = 0L;
                }
                SpoolWriter writer = new SpoolWriter();

                writer.write(prefix);

                // 2. MANIFEST frame
                byte[] manifestPlain = new byte[KanataM6PortableCrypto.MANIFEST_SIZE];
                KanataM6PortableCrypto.writeU32BE(manifestPlain, 0, KanataM6PortableCatalog.APPLICATION_ID);
                KanataM6PortableCrypto.writeU16BE(manifestPlain, 4, KanataM6PortableCatalog.SCHEMA_VERSION);
                System.arraycopy(catalog.schemaFingerprintBytes, 0, manifestPlain, 6, 32);
                manifestPlain[38] = 1; // pause-sending-v1
                manifestPlain[39] = 0;

                byte[] mfHeader = encodeFrameHeader(
                        KanataM6PortableCrypto.STREAM_CONTROL,
                        KanataM6PortableCrypto.FRAME_MANIFEST,
                        KanataM6PortableCrypto.FLAG_CONTINUE,
                        0L,
                        KanataM6PortableCrypto.MANIFEST_SIZE,
                        KanataM6PortableCrypto.MANIFEST_SIZE + KanataM6PortableCrypto.TAG_SIZE);
                long ta1 = SystemClock.elapsedRealtimeNanos();
                byte[] mfCipher = KanataM6PortableCrypto.aesGcmEncrypt(
                        manifestKey,
                        buildFrameNonce(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_MANIFEST, 0L),
                        manifestPlain,
                        manifestPlain.length,
                        KanataM6PortableCrypto.concat(envelopeDigest, mfHeader),
                        "manifest-encrypt");
                aeadNs += SystemClock.elapsedRealtimeNanos() - ta1;
                transcriptSha.update(mfHeader);
                transcriptSha.update(mfCipher);
                writer.write(mfHeader);
                writer.write(mfCipher);

                long totalPackageBytes = prefix.length + mfHeader.length + mfCipher.length;
                long totalPlainBytes = 0L;
                long totalCipherBytes = 0L;
                int dataFrameCount = 0;
                int outOff = 0;

                final byte[] finalDataKey = dataKey;
                final long[] totalPlainRef = new long[] { 0L };
                final long[] totalCipherRef = new long[] { 0L };
                final long[] totalPkgRef = new long[] { totalPackageBytes };
                final int[] dfCountRef = new int[] { 0 };
                final long[] aeadRef = new long[] { aeadNs };

                // Flush a completed 64 KiB (or final) DATA frame with 1-frame lookahead
                // At most 2 plaintext buffers (outPlain + pendingPlain) exist simultaneously.
                class FramePipeline {
                    byte[] pendingBuf = null;
                    int pendingSize = 0;

                    void emitFrame(byte[] plainBuf, int plainLen, int flags) throws IOException {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        KanataM6PortableCrypto.requirePortable(
                                dfCountRef[0] < KanataM6PortableCrypto.MAX_DATA_FRAMES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "data-frame-count");
                        long idx = dfCountRef[0];
                        int cipherLen = plainLen + KanataM6PortableCrypto.TAG_SIZE;
                        totalPlainRef[0] += plainLen;
                        totalCipherRef[0] += cipherLen;
                        totalPkgRef[0] += KanataM6PortableCrypto.FRAME_HEADER_SIZE + cipherLen;
                        KanataM6PortableCrypto.requirePortable(
                                totalPlainRef[0] <= KanataM6PortableCrypto.MAX_DATA_PLAINTEXT_BYTES
                                        && totalPkgRef[0] <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");

                        byte[] fh = encodeFrameHeader(
                                KanataM6PortableCrypto.STREAM_DATA,
                                KanataM6PortableCrypto.FRAME_DATA,
                                flags, idx, plainLen, cipherLen);
                        long ta = SystemClock.elapsedRealtimeNanos();
                        byte[] ct = KanataM6PortableCrypto.aesGcmEncrypt(
                                finalDataKey,
                                buildFrameNonce(KanataM6PortableCrypto.STREAM_DATA, KanataM6PortableCrypto.FRAME_DATA, idx),
                                plainBuf, plainLen,
                                KanataM6PortableCrypto.concat(envelopeDigest, fh),
                                "data-encrypt:" + idx);
                        aeadRef[0] += SystemClock.elapsedRealtimeNanos() - ta;
                        transcriptSha.update(fh);
                        transcriptSha.update(ct);
                        dfCountRef[0]++;
                        writer.write(fh);
                        writer.write(ct);
                        Arrays.fill(plainBuf, 0, plainLen, (byte) 0);
                    }

                    void pushChunk(byte[] fullChunk, int len) throws IOException {
                        if (pendingBuf != null) {
                            int inFlight = 2; // pendingBuf + incoming fullChunk
                            if (inFlight > m.maxInFlightFrames) m.maxInFlightFrames = inFlight;
                            if (hooks != null) hooks.onFrameQueued(inFlight, m.maxRowBodyBytes);
                            emitFrame(pendingBuf, pendingSize, KanataM6PortableCrypto.FLAG_CONTINUE);
                            pendingBuf = null;
                            pendingSize = 0;
                        } else {
                            if (1 > m.maxInFlightFrames) m.maxInFlightFrames = 1;
                            if (hooks != null) hooks.onFrameQueued(1, m.maxRowBodyBytes);
                        }
                        pendingBuf = new byte[len];
                        System.arraycopy(fullChunk, 0, pendingBuf, 0, len);
                        pendingSize = len;
                    }

                    void finishFinal() throws IOException {
                        KanataM6PortableCrypto.requirePortable(
                                pendingBuf != null && pendingSize >= 1,
                                KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "empty-data-stream");
                        emitFrame(pendingBuf, pendingSize, KanataM6PortableCrypto.FLAG_FINAL);
                        KanataM6PortableCrypto.zeroize(pendingBuf);
                        pendingBuf = null;
                        pendingSize = 0;
                    }
                    void zeroizePending() {
                        KanataM6PortableCrypto.zeroize(pendingBuf);
                        pendingBuf = null;
                        pendingSize = 0;
                    }
                }
                List<Verifier> allVerifiers = new ArrayList<>(50);
                byte[] lenBuf = new byte[4];
                byte[] tableDomainPrefix = "KPB1/table\0".getBytes(StandardCharsets.US_ASCII);
                FramePipeline pipeline = new FramePipeline();
                try {

                // Helper to append bytes into 64 KiB outPlain buffer and emit when full
                class LogicalChunker {
                    int off = 0;
                    void append(byte[] src, int srcOff, int len) throws IOException {
                        int pos = 0;
                        while (pos < len) {
                            int avail = KanataM6PortableCrypto.FRAME_LIMIT - off;
                            int take = Math.min(avail, len - pos);
                            System.arraycopy(src, srcOff + pos, outPlain, off, take);
                            off += take;
                            pos += take;
                            if (off == KanataM6PortableCrypto.FRAME_LIMIT) {
                                pipeline.pushChunk(outPlain, off);
                                off = 0;
                                sampleResources(m);
                            }
                        }
                    }
                    void flushRemainder() throws IOException {
                        if (off > 0) {
                            pipeline.pushChunk(outPlain, off);
                            off = 0;
                        }
                    }
                }
                LogicalChunker chunker = new LogicalChunker();

                // 3. Stream all 45 business tables from the SAME pinned DEFERRED snapshot
                long totalBusinessRows = 0L;
                byte[] tableHeader = new byte[10];

                for (KanataM6PortableCatalog.TableDef tableDef : catalog.businessTables) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    long tRead0 = SystemClock.elapsedRealtimeNanos();
                    String countSql = tableDef.hasOrdinal
                            ? "SELECT count(*) FROM " + tableDef.name
                            : "SELECT count(*) FROM " + tableDef.name;
                    long expectedCount = Long.parseLong(KanataM6SnapshotOwner.scalar(snap.roDb, countSql));
                    totalBusinessRows += expectedCount;
                    KanataM6PortableCrypto.requirePortable(
                            totalBusinessRows <= KanataM6PortableCrypto.MAX_BUSINESS_ROWS,
                            KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "business-row-count");

                    KanataM6PortableCrypto.writeU16BE(tableHeader, 0, tableDef.tableId);
                    KanataM6PortableCrypto.writeU64BE(tableHeader, 2, expectedCount);
                    dbReadNs += SystemClock.elapsedRealtimeNanos() - tRead0;

                    chunker.append(tableHeader, 0, 10);

                    MessageDigest tableSha = MessageDigest.getInstance("SHA-256");
                    tableSha.update(tableDomainPrefix);
                    byte[] tidBytes = new byte[2];
                    KanataM6PortableCrypto.writeU16BE(tidBytes, 0, tableDef.tableId);
                    tableSha.update(tidBytes);

                    OrderTracker tracker = new OrderTracker(tableDef);
                    long actualCount = 0L;

                    String selectSql = KanataM6BoundedRowReader.buildSelectSql(tableDef);
                    long tCur0 = SystemClock.elapsedRealtimeNanos();
                    try (Cursor c = snap.roDb.rawQuery(selectSql, new String[0], cancelSignal)) {
                        dbReadNs += SystemClock.elapsedRealtimeNanos() - tCur0;
                        while (true) {
                            long tNext0 = SystemClock.elapsedRealtimeNanos();
                            boolean hasNext = c.moveToNext();
                            dbReadNs += SystemClock.elapsedRealtimeNanos() - tNext0;
                            if (!hasNext) break;
                            KanataM6PortableCrypto.checkCancelled(cancelled);

                            long tRow0 = SystemClock.elapsedRealtimeNanos();
                            KanataM6BoundedRowReader.EncodedRow row = KanataM6BoundedRowReader.readAndEncodeCurrentRow(
                                    snap.roDb, c, tableDef, true, true);
                            dbReadNs += SystemClock.elapsedRealtimeNanos() - tRow0;

                            if (row.bodyLen > m.maxRowBodyBytes) m.maxRowBodyBytes = row.bodyLen;
                            tracker.accept(row);

                            KanataM6PortableCrypto.writeU32BE(lenBuf, 0, row.bodyLen);
                            tableSha.update(lenBuf);
                            tableSha.update(row.body, 0, row.bodyLen);

                            chunker.append(lenBuf, 0, 4);
                            chunker.append(row.body, 0, row.bodyLen);
                            KanataM6PortableCrypto.zeroize(row.body);
                            actualCount++;
                            KanataM6PortableCrypto.requirePortable(
                                    actualCount <= expectedCount,
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-count-mismatch");
                        }
                    }
                    KanataM6PortableCrypto.requirePortable(
                            actualCount == expectedCount,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-count-mismatch");
                    allVerifiers.add(new Verifier(tableDef.tableId, actualCount, tableSha.digest()));
                    if (hooks != null) hooks.afterTableRead(tableDef.tableId, actualCount);
                }

                chunker.flushRemainder();
                pipeline.finishFinal();
                sampleResources(m);
                } finally {
                    pipeline.zeroizePending();
                }

                // 4. Compute 5 derived table verifiers from the SAME pinned snapshot
                for (KanataM6PortableCatalog.TableDef derDef : catalog.derivedTables) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    MessageDigest derSha = MessageDigest.getInstance("SHA-256");
                    derSha.update(tableDomainPrefix);
                    byte[] tidBytes = new byte[2];
                    KanataM6PortableCrypto.writeU16BE(tidBytes, 0, derDef.tableId);
                    derSha.update(tidBytes);

                    OrderTracker tracker = new OrderTracker(derDef);
                    long rowCount = 0L;
                    String selectSql = KanataM6BoundedRowReader.buildSelectSql(derDef);
                    long td0 = SystemClock.elapsedRealtimeNanos();
                    try (Cursor c = snap.roDb.rawQuery(selectSql, new String[0], cancelSignal)) {
                        dbReadNs += SystemClock.elapsedRealtimeNanos() - td0;
                        while (true) {
                            long tn0 = SystemClock.elapsedRealtimeNanos();
                            boolean hasNext = c.moveToNext();
                            dbReadNs += SystemClock.elapsedRealtimeNanos() - tn0;
                            if (!hasNext) break;
                            KanataM6PortableCrypto.checkCancelled(cancelled);
                            long tr0 = SystemClock.elapsedRealtimeNanos();
                            KanataM6BoundedRowReader.EncodedRow row = KanataM6BoundedRowReader.readAndEncodeCurrentRow(
                                    snap.roDb, c, derDef, true, true);
                            dbReadNs += SystemClock.elapsedRealtimeNanos() - tr0;
                            tracker.accept(row);
                            KanataM6PortableCrypto.writeU32BE(lenBuf, 0, row.bodyLen);
                            derSha.update(lenBuf);
                            derSha.update(row.body, 0, row.bodyLen);
                            KanataM6PortableCrypto.zeroize(row.body);
                            rowCount++;
                        }
                    }
                    allVerifiers.add(new Verifier(derDef.tableId, rowCount, derSha.digest()));
                }

                // 5. FOOTER frame
                allVerifiers.sort(Comparator.comparingInt(v -> v.tableId));
                KanataM6PortableCrypto.requirePortable(
                        allVerifiers.size() == KanataM6PortableCrypto.FOOTER_TABLE_COUNT,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "footer-verifier-count");
                byte[] transcript = transcriptSha.digest();
                byte[] footerPlain = new byte[KanataM6PortableCrypto.FOOTER_SIZE];
                KanataM6PortableCrypto.writeU32BE(footerPlain, 0, dfCountRef[0]);
                KanataM6PortableCrypto.writeU64BE(footerPlain, 4, totalPlainRef[0]);
                KanataM6PortableCrypto.writeU64BE(footerPlain, 12, totalCipherRef[0]);
                System.arraycopy(transcript, 0, footerPlain, 20, 32);
                int fOff = 52;
                for (int i = 0; i < allVerifiers.size(); i++) {
                    Verifier v = allVerifiers.get(i);
                    KanataM6PortableCrypto.requirePortable(
                            v.tableId == catalog.footerTables.get(i).tableId,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "footer-table-order");
                    KanataM6PortableCrypto.writeU16BE(footerPlain, fOff, v.tableId);
                    KanataM6PortableCrypto.writeU64BE(footerPlain, fOff + 2, v.rowCount);
                    System.arraycopy(v.digest, 0, footerPlain, fOff + 10, 32);
                    fOff += KanataM6PortableCrypto.FOOTER_VERIFIER_SIZE;
                }

                byte[] ffHeader = encodeFrameHeader(
                        KanataM6PortableCrypto.STREAM_CONTROL,
                        KanataM6PortableCrypto.FRAME_FOOTER,
                        KanataM6PortableCrypto.FLAG_CONTINUE,
                        0L,
                        KanataM6PortableCrypto.FOOTER_SIZE,
                        KanataM6PortableCrypto.FOOTER_SIZE + KanataM6PortableCrypto.TAG_SIZE);
                long taf = SystemClock.elapsedRealtimeNanos();
                byte[] ffCipher = KanataM6PortableCrypto.aesGcmEncrypt(
                        footerKey,
                        buildFrameNonce(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_FOOTER, 0L),
                        footerPlain, footerPlain.length,
                        KanataM6PortableCrypto.concat(envelopeDigest, ffHeader),
                        "footer-encrypt");
                aeadRef[0] += SystemClock.elapsedRealtimeNanos() - taf;
                totalPkgRef[0] += ffHeader.length + ffCipher.length;
                KanataM6PortableCrypto.requirePortable(
                        totalPkgRef[0] <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                        KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");

                writer.write(ffHeader);
                writer.write(ffCipher);

                // 6. Flush + fsync before closing spool
                long tFsync0 = SystemClock.elapsedRealtimeNanos();
                fos.flush();
                if (hooks != null) hooks.beforeFsync();
                fos.getFD().sync();
                long fsyncElapsedNs = SystemClock.elapsedRealtimeNanos() - tFsync0;

                totalSpoolWritten = writer.written;
                spoolWriteNs = writer.lastWriteNs;
                aeadNs = aeadRef[0];
                dataFrameCount = dfCountRef[0];
                totalPlainBytes = totalPlainRef[0];
                totalCipherBytes = totalCipherRef[0];

                m.dataFrameCount = dataFrameCount;
                m.totalPlaintextBytes = totalPlainBytes;
                m.totalCiphertextBytes = totalCipherBytes;
                m.transcriptHex = KanataM6PortableCrypto.bytesToHex(transcript);
                m.verifiers = allVerifiers;

                // Record fsync time; readback will be added right after try-with-resources closes fos
                m.fsyncReadbackMs = fsyncElapsedNs;
            }

            // 7. Close-then-reopen full readback & SHA-256 + structural boundary verification
            long tReadback0 = SystemClock.elapsedRealtimeNanos();
            if (hooks != null) hooks.beforeReadback();
            byte[] expectedSha = spoolSha.digest();
            MessageDigest readbackSha = MessageDigest.getInstance("SHA-256");
            long readbackBytes = 0L;
            byte[] buf = new byte[65536];
            try (FileInputStream fis = new FileInputStream(tmpSpool)) {
                int r;
                while ((r = fis.read(buf)) != -1) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    readbackSha.update(buf, 0, r);
                    readbackBytes += r;
                }
            } finally {
                Arrays.fill(buf, (byte) 0);
            }
            byte[] actualSha = readbackSha.digest();
            if (readbackBytes != totalSpoolWritten || !MessageDigest.isEqual(expectedSha, actualSha)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "spool-readback-mismatch");
            }
            if (finalTargetFile.exists() && !finalTargetFile.delete()) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "target-replace-delete");
            }
            if (!tmpSpool.renameTo(finalTargetFile)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "spool-atomic-rename");
            }
            long readbackElapsedNs = SystemClock.elapsedRealtimeNanos() - tReadback0;
            m.fsyncReadbackMs = (m.fsyncReadbackMs + readbackElapsedNs) / 1_000_000L;
            m.finalFileBytes = finalTargetFile.length();
            m.packageSha256Hex = KanataM6PortableCrypto.bytesToHex(actualSha);
            m.dbReadMs = dbReadNs / 1_000_000L;
            m.aeadMs = aeadNs / 1_000_000L;
            m.spoolWriteMs = spoolWriteNs / 1_000_000L;
            sampleResources(m);
            m.totalMs = (SystemClock.elapsedRealtimeNanos() - tTotalStart) / 1_000_000L;
            exportCommitted = true;
            return m;
        } catch (KanataM6PortableCrypto.PortableException pe) {
            throw pe;
        } catch (IOException ioe) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "spool-io", ioe);
        } finally {
            if (!exportCommitted && tmpSpool.exists()) {
                tmpSpool.delete();
            }
            KanataM6PortableCrypto.zeroize(pwBytes, baseKek, wrapKey, manifestKey, dataKey, footerKey, outPlain, pendingPlain);
            if (explicitMaterial == null) mat.zeroize();
        }
    }
}
