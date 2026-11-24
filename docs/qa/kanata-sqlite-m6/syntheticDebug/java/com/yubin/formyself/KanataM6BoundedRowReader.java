package com.yubin.formyself;

import android.database.Cursor;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.List;

/**
 * Bounded row reader & logical body encoder for kanata-logical-v1 on Android SQLCipher.
 *
 * Guarantees:
 * - Pre-checks column UTF-8 byte lengths via length(CAST(col AS BLOB)) BEFORE allocating large row buffers.
 * - Rejects TEXT > 2 MiB and row body > 4 MiB with RESOURCE_LIMIT prior to multi-MiB allocation.
 * - Reads large TEXT columns (> 256 KiB) in 256 KiB BLOB chunks via substr(CAST(col AS BLOB), ?, ?)
 *   to stay strictly within Android SQLite CursorWindow (2 MiB) limits without truncation.
 * - Retains at most 1 encoded row body (<= 4 MiB) in memory at a time.
 * - Deterministic sensitive buffer ownership & zeroization on every exit path.
 */
public final class KanataM6BoundedRowReader {
    public static final int INLINE_TEXT_THRESHOLD_BYTES = 262_144; // 256 KiB

    public interface BufferObserver {
        void onSensitiveBufferAllocated(String label, byte[] buffer);
    }

    private KanataM6BoundedRowReader() {}

    public static final class EncodedRow implements AutoCloseable {
        public final byte[] body;
        public final int bodyLen;
        public final byte[][] pkTextBytes;
        public final long[] pkNumericValues;
        public final byte[] ordinalWorldIdBytes;
        public final long ordinal;
        private boolean closed = false;

        EncodedRow(
                byte[] body,
                int bodyLen,
                byte[][] pkTextBytes,
                long[] pkNumericValues,
                byte[] ordinalWorldIdBytes,
                long ordinal) {
            this.body = body;
            this.bodyLen = bodyLen;
            this.pkTextBytes = pkTextBytes;
            this.pkNumericValues = pkNumericValues;
            this.ordinalWorldIdBytes = ordinalWorldIdBytes;
            this.ordinal = ordinal;
        }

        @Override
        public void close() {
            if (closed) return;
            closed = true;
            KanataM6PortableCrypto.zeroize(body);
            if (pkTextBytes != null) {
                for (int i = 0; i < pkTextBytes.length; i++) {
                    KanataM6PortableCrypto.zeroize(pkTextBytes[i]);
                    pkTextBytes[i] = null;
                }
            }
            KanataM6PortableCrypto.zeroize(ordinalWorldIdBytes);
        }
    }

    public static String buildSelectSql(KanataM6PortableCatalog.TableDef tableDef) {
        StringBuilder sb = new StringBuilder();
        sb.append("SELECT ");
        String alias = tableDef.hasOrdinal ? "e" : "t";
        List<KanataM6PortableCatalog.ColumnDef> cols = tableDef.columns;
        for (int i = 0; i < cols.size(); i++) {
            KanataM6PortableCatalog.ColumnDef c = cols.get(i);
            if (i > 0) sb.append(", ");
            if (c.type == KanataM6PortableCatalog.ColType.TEXT) {
                sb.append("length(CAST(").append(alias).append('.').append(c.name).append(" AS BLOB)) AS __len_").append(i)
                        .append(", CASE WHEN ").append(alias).append('.').append(c.name).append(" IS NULL THEN NULL ")
                        .append("WHEN length(CAST(").append(alias).append('.').append(c.name).append(" AS BLOB)) <= ")
                        .append(INLINE_TEXT_THRESHOLD_BYTES)
                        .append(" THEN CAST(").append(alias).append('.').append(c.name).append(" AS BLOB) ELSE NULL END AS __val_").append(i);
            } else {
                sb.append(alias).append('.').append(c.name);
            }
        }
        if (tableDef.hasOrdinal) {
            String orderTable = tableDef.orderTableName();
            sb.append(", o.ordinal AS __ordinal FROM ").append(tableDef.name).append(" e ")
                    .append("JOIN ").append(orderTable).append(" o ON o.world_id = e.world_id AND o.entity_id = e.id ")
                    .append("ORDER BY e.world_id COLLATE BINARY ASC, o.ordinal ASC");
        } else {
            sb.append(" FROM ").append(tableDef.name).append(" t ORDER BY ");
            List<KanataM6PortableCatalog.ColumnDef> pks = tableDef.pkColumns;
            for (int i = 0; i < pks.size(); i++) {
                if (i > 0) sb.append(", ");
                KanataM6PortableCatalog.ColumnDef pk = pks.get(i);
                sb.append("t.").append(pk.name);
                if (pk.type == KanataM6PortableCatalog.ColType.TEXT) sb.append(" COLLATE BINARY");
                sb.append(" ASC");
            }
        }
        return sb.toString();
    }

    /**
     * Reads and encodes the current cursor row into a single bounded kanata-logical-v1 row body.
     * Enforces 2 MiB field limit and 4 MiB row limit BEFORE allocating the row body buffer.
     */
    public static EncodedRow readAndEncodeCurrentRow(
            SQLiteDatabase roDb,
            Cursor cursor,
            KanataM6PortableCatalog.TableDef tableDef,
            boolean applyTaskPolicy,
            boolean validateJson) {
        return readAndEncodeCurrentRow(roDb, cursor, tableDef, applyTaskPolicy, validateJson, null);
    }

    public static EncodedRow readAndEncodeCurrentRow(
            SQLiteDatabase roDb,
            Cursor cursor,
            KanataM6PortableCatalog.TableDef tableDef,
            boolean applyTaskPolicy,
            boolean validateJson,
            BufferObserver observer) {
        List<KanataM6PortableCatalog.ColumnDef> cols = tableDef.columns;
        int colCount = cols.size();

        // Pass 1: Determine exact wire body size and validate field/row limits BEFORE allocating body!
        long computedBodyBytes = tableDef.hasOrdinal ? 8L : 0L;
        int cursorIdx = 0;
        int[] textLens = new int[colCount];
        boolean[] isNullCol = new boolean[colCount];

        for (int i = 0; i < colCount; i++) {
            KanataM6PortableCatalog.ColumnDef c = cols.get(i);
            if (c.type == KanataM6PortableCatalog.ColType.TEXT) {
                int lenIdx = cursorIdx++;
                cursorIdx++; // valIdx
                if (cursor.isNull(lenIdx)) {
                    KanataM6PortableCrypto.requirePortable(!c.notnull,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + c.name);
                    isNullCol[i] = true;
                    computedBodyBytes += 1L;
                } else {
                    long byteLen = cursor.getLong(lenIdx);
                    KanataM6PortableCrypto.requirePortable(
                            byteLen >= 0 && byteLen <= KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES,
                            KanataM6PortableCrypto.ERR_RESOURCE_LIMIT,
                            "col-text-limit:" + tableDef.name + "." + c.name);
                    textLens[i] = (int) byteLen;
                    computedBodyBytes += 5L + byteLen;
                }
            } else {
                int valIdx = cursorIdx++;
                if (cursor.isNull(valIdx)) {
                    KanataM6PortableCrypto.requirePortable(!c.notnull,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + c.name);
                    isNullCol[i] = true;
                    computedBodyBytes += 1L;
                } else {
                    computedBodyBytes += 9L;
                }
            }
            KanataM6PortableCrypto.requirePortable(
                    computedBodyBytes <= KanataM6PortableCrypto.MAX_ROW_BODY_BYTES,
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT,
                    "row-body-size:" + tableDef.name);
        }

        long ordinal = -1L;
        if (tableDef.hasOrdinal) {
            ordinal = cursor.getLong(cursorIdx);
            KanataM6PortableCrypto.requirePortable(
                    ordinal >= 0 && ordinal <= KanataM6PortableCrypto.MAX_ORDINAL,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL,
                    "ordinal-range");
        }

        // Check if any column requires chunked BLOB fetch (> 256 KiB); if so, collect PK values first.
        byte[] body = new byte[(int) computedBodyBytes];
        if (observer != null) observer.onSensitiveBufferAllocated("row.body", body);
        byte[][] colInlineBytes = new byte[colCount][];
        boolean handedOff = false;
        try {
            int outPos = 0;
            if (tableDef.hasOrdinal) {
                KanataM6PortableCrypto.writeU64BE(body, outPos, ordinal);
                outPos += 8;
            }

            // Track PK & world_id for order verification and optional chunked fetch
            long[] colIntValues = new long[colCount];
            double[] colRealValues = new double[colCount];
            boolean[] hasLargeText = new boolean[colCount];

            cursorIdx = 0;
            for (int i = 0; i < colCount; i++) {
                KanataM6PortableCatalog.ColumnDef c = cols.get(i);
                if (c.type == KanataM6PortableCatalog.ColType.TEXT) {
                    cursorIdx++; // lenIdx
                    int valIdx = cursorIdx++;
                    if (!isNullCol[i]) {
                        if (textLens[i] <= INLINE_TEXT_THRESHOLD_BYTES) {
                            byte[] raw = cursor.getBlob(valIdx);
                            if (raw == null) raw = new byte[0];
                            if (observer != null && raw.length > 0) {
                                observer.onSensitiveBufferAllocated("row.colInline." + c.name, raw);
                            }
                            colInlineBytes[i] = raw;
                            KanataM6PortableCrypto.requirePortable(raw.length == textLens[i],
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "blob-len-mismatch");
                        } else {
                            hasLargeText[i] = true;
                        }
                    }
                } else if (c.type == KanataM6PortableCatalog.ColType.INTEGER) {
                    int valIdx = cursorIdx++;
                    if (!isNullCol[i]) colIntValues[i] = cursor.getLong(valIdx);
                } else {
                    int valIdx = cursorIdx++;
                    if (!isNullCol[i]) colRealValues[i] = cursor.getDouble(valIdx);
                }
            }

            // Apply pause-sending-v1 projection for background_tasks without mutating source DB
            if (applyTaskPolicy && "background_tasks".equals(tableDef.name)) {
                int kindIdx = tableDef.columnsByName.get("kind").cid;
                int stateIdx = tableDef.columnsByName.get("state").cid;
                int leaseIdx = tableDef.columnsByName.get("lease_until").cid;
                String kind = new String(colInlineBytes[kindIdx], java.nio.charset.StandardCharsets.UTF_8);
                String state = new String(colInlineBytes[stateIdx], java.nio.charset.StandardCharsets.UTF_8);
                colIntValues[leaseIdx] = 0L;
                String nextState = null;
                if (("reply".equals(kind) || "proactive".equals(kind) || "followup".equals(kind))
                        && ("pending".equals(state) || "running".equals(state) || "failed".equals(state))) {
                    nextState = "cancelled";
                } else if ("running".equals(state)) {
                    nextState = "pending";
                }
                if (nextState != null) {
                    byte[] next = nextState.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    if (observer != null) observer.onSensitiveBufferAllocated("row.projectedState", next);
                    KanataM6PortableCrypto.zeroize(colInlineBytes[stateIdx]);
                    colInlineBytes[stateIdx] = next;
                    textLens[stateIdx] = next.length;
                    int exactLen = 0;
                    for (int i = 0; i < colCount; i++) {
                        if (isNullCol[i]) exactLen += 1;
                        else if (cols.get(i).type == KanataM6PortableCatalog.ColType.TEXT) exactLen += 5 + textLens[i];
                        else exactLen += 9;
                    }
                    if (exactLen != body.length) {
                        KanataM6PortableCrypto.zeroize(body);
                        body = new byte[exactLen];
                        if (observer != null) observer.onSensitiveBufferAllocated("row.body.reprojected", body);
                    }
                }
            }

            // Build PK arrays for order tracking and chunked query WHERE clause
            List<KanataM6PortableCatalog.ColumnDef> pks = tableDef.pkColumns;
            byte[][] pkTextBytes = new byte[pks.size()][];
            long[] pkNumericValues = new long[pks.size()];
            Object[] pkBindArgs = new Object[pks.size()];
            StringBuilder pkWhere = new StringBuilder();
            for (int p = 0; p < pks.size(); p++) {
                KanataM6PortableCatalog.ColumnDef pk = pks.get(p);
                if (p > 0) pkWhere.append(" AND ");
                pkWhere.append(pk.name).append(" = ?");
                if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                    byte[] b = colInlineBytes[pk.cid];
                    pkTextBytes[p] = b;
                    pkBindArgs[p] = KanataM6PortableCrypto.decodeStrictUtf8(b, "pk:" + pk.name);
                } else {
                    pkNumericValues[p] = colIntValues[pk.cid];
                    pkBindArgs[p] = colIntValues[pk.cid];
                }
            }

            byte[] ordinalWorldIdBytes = null;
            if (tableDef.hasOrdinal) {
                int widCid = tableDef.columnsByName.get("world_id").cid;
                ordinalWorldIdBytes = colInlineBytes[widCid];
            }

            // Pass 2: Encode every column directly into body[]
            for (int i = 0; i < colCount; i++) {
                KanataM6PortableCatalog.ColumnDef c = cols.get(i);
                if (isNullCol[i]) {
                    body[outPos++] = 0;
                    continue;
                }
                body[outPos++] = 1;
                if (c.type == KanataM6PortableCatalog.ColType.INTEGER) {
                    KanataM6PortableCrypto.writeU64BE(body, outPos, colIntValues[i]);
                    outPos += 8;
                } else if (c.type == KanataM6PortableCatalog.ColType.REAL) {
                    double d = colRealValues[i];
                    KanataM6PortableCrypto.requirePortable(!Double.isNaN(d) && !Double.isInfinite(d),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "real-nonfinite");
                    if (d == 0.0d) d = 0.0d; // Canonicalize -0.0 -> +0.0
                    long bits = Double.doubleToRawLongBits(d);
                    KanataM6PortableCrypto.writeU64BE(body, outPos, bits);
                    outPos += 8;
                } else {
                    int len = textLens[i];
                    KanataM6PortableCrypto.writeU32BE(body, outPos, len);
                    outPos += 4;
                    if (!hasLargeText[i]) {
                        byte[] raw = colInlineBytes[i];
                        // Validate strict UTF-8 & optional JSON shape without mutating raw bytes
                        String decoded = KanataM6PortableCrypto.decodeStrictUtf8(raw, "col:" + tableDef.name + "." + c.name);
                        if (validateJson) validateJsonColumn(c.name, decoded);
                        System.arraycopy(raw, 0, body, outPos, len);
                        outPos += len;
                    } else {
                        // Chunked BLOB read in 256 KiB windows directly into body[outPos .. outPos + len)
                        int copied = 0;
                        String chunkSql = "SELECT substr(CAST(" + c.name + " AS BLOB), ?, ?) FROM "
                                + tableDef.name + " WHERE " + pkWhere;
                        while (copied < len) {
                            int take = Math.min(INLINE_TEXT_THRESHOLD_BYTES, len - copied);
                            Object[] args = new Object[2 + pkBindArgs.length];
                            args[0] = copied + 1; // SQLite substr() is 1-based!
                            args[1] = take;
                            System.arraycopy(pkBindArgs, 0, args, 2, pkBindArgs.length);
                            try (Cursor chunkCur = roDb.rawQuery(chunkSql, args)) {
                                KanataM6PortableCrypto.requirePortable(chunkCur.moveToFirst(),
                                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "chunk-missing");
                                byte[] piece = chunkCur.getBlob(0);
                                try {
                                    if (observer != null && piece != null) {
                                        observer.onSensitiveBufferAllocated("row.chunk." + c.name, piece);
                                    }
                                    KanataM6PortableCrypto.requirePortable(piece != null && piece.length == take,
                                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "chunk-len");
                                    System.arraycopy(piece, 0, body, outPos + copied, take);
                                } finally {
                                    KanataM6PortableCrypto.zeroize(piece);
                                }
                            }
                            copied += take;
                        }
                        // Validate strict UTF-8 on the bounded slice (<= 2 MiB) without extra 2 MiB copy
                        String decoded = KanataM6PortableCrypto.decodeStrictUtf8(
                                body, outPos, len, "col:" + tableDef.name + "." + c.name);
                        if (validateJson) validateJsonColumn(c.name, decoded);
                        outPos += len;
                    }
                }
            }

            KanataM6PortableCrypto.requirePortable(outPos == body.length,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-encode-size");

            EncodedRow result = new EncodedRow(body, outPos, pkTextBytes, pkNumericValues, ordinalWorldIdBytes, ordinal);
            handedOff = true;
            return result;
        } finally {
            if (!handedOff) {
                KanataM6PortableCrypto.zeroize(body);
            }
            for (int i = 0; i < colCount; i++) {
                byte[] b = colInlineBytes[i];
                if (b != null) {
                    boolean keepPk = false;
                    if (handedOff) {
                        if (cols.get(i).pk > 0 || (tableDef.hasOrdinal && "world_id".equals(cols.get(i).name))) {
                            keepPk = true;
                        }
                    }
                    if (!keepPk) {
                        KanataM6PortableCrypto.zeroize(b);
                    }
                }
            }
        }
    }

    public static void validateJsonColumn(String colName, String value) {
        int kind = jsonColumnKind(colName);
        if (kind == 0) return;
        try {
            org.json.JSONTokener tok = new org.json.JSONTokener(value);
            Object parsed = tok.nextValue();
            if (tok.nextClean() != 0) {
                throw new IllegalArgumentException("trailing json tokens");
            }
            if (kind == 1 && !(parsed instanceof JSONObject)) {
                throw new IllegalArgumentException("expected json object");
            } else if (kind == 2 && !(parsed instanceof JSONArray)) {
                throw new IllegalArgumentException("expected json array");
            } else if (parsed == null) {
                throw new IllegalArgumentException("empty json");
            }
        } catch (Exception e) {
            throw new KanataM6PortableCrypto.PortableException(
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "json-column:" + colName, e);
        }
    }

    private static int jsonColumnKind(String name) {
        switch (name) {
            case "extensions_json":
            case "definition_json":
            case "overrides_json":
            case "metadata_json":
            case "previous_json":
            case "next_json":
            case "imported_json":
                return 1; // object
            case "keys_json":
            case "secondary_keys_json":
                return 2; // array
            case "raw_data_json":
            case "value_json":
            case "cursor_json":
                return 3; // any valid json
            default:
                return 0;
        }
    }
}
