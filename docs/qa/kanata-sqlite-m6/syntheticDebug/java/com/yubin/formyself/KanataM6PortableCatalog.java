package com.yubin.formyself;

import android.content.Context;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Trusted static Schema 005 catalog & DDL initializer for M6-02 isolated synthetic tests.
 * Loaded from kanata-portable-catalog-v1.json (generated directly from M6-01 frozen catalog.js & kanataSchema.js).
 */
public final class KanataM6PortableCatalog {
    public static final int APPLICATION_ID = 0x4b4e5441; // 1263424577
    public static final int SCHEMA_VERSION = 5;
    public static final String EXPECTED_SCHEMA_005_FP =
            "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a";

    public enum Category { BUSINESS, DERIVED, RUNTIME }
    public enum ColType { TEXT, INTEGER, REAL }

    public static final class ColumnDef {
        public final String name;
        public final int cid;
        public final ColType type;
        public final boolean notnull;
        public final int pk;

        ColumnDef(String name, int cid, ColType type, boolean notnull, int pk) {
            this.name = name;
            this.cid = cid;
            this.type = type;
            this.notnull = notnull;
            this.pk = pk;
        }
    }

    public static final class TableDef {
        public final int tableId;
        public final String name;
        public final Category category;
        public final boolean hasOrdinal;
        public final List<ColumnDef> columns;
        public final List<ColumnDef> pkColumns;
        public final Map<String, ColumnDef> columnsByName;

        TableDef(int tableId, String name, Category category, boolean hasOrdinal, List<ColumnDef> columns) {
            this.tableId = tableId;
            this.name = name;
            this.category = category;
            this.hasOrdinal = hasOrdinal;
            this.columns = Collections.unmodifiableList(columns);
            List<ColumnDef> pks = new ArrayList<>();
            Map<String, ColumnDef> byName = new HashMap<>();
            for (ColumnDef c : columns) {
                byName.put(c.name, c);
                if (c.pk > 0) pks.add(c);
            }
            pks.sort((a, b) -> Integer.compare(a.pk, b.pk));
            this.pkColumns = Collections.unmodifiableList(pks);
            this.columnsByName = Collections.unmodifiableMap(byName);
        }

        public String orderTableName() {
            switch (name) {
                case "world_events": return "event_array_order";
                case "world_effects": return "effect_array_order";
                case "effect_baselines": return "baseline_array_order";
                default: return null;
            }
        }
    }

    public static final class MigrationDef {
        public final int version;
        public final String name;
        public final List<String> statements;

        MigrationDef(int version, String name, List<String> statements) {
            this.version = version;
            this.name = name;
            this.statements = Collections.unmodifiableList(statements);
        }
    }

    private static volatile KanataM6PortableCatalog INSTANCE;

    public final byte[] schemaFingerprintBytes;
    public final String schemaFingerprintHex;
    public final List<TableDef> allTables;
    public final List<TableDef> businessTables;
    public final List<TableDef> derivedTables;
    public final List<TableDef> runtimeTables;
    public final List<TableDef> footerTables;
    public final Map<Integer, TableDef> byId;
    public final Map<String, TableDef> byName;
    public final List<String> installOrder;
    public final List<MigrationDef> migrations;

    private KanataM6PortableCatalog(JSONObject json) throws Exception {
        this.schemaFingerprintHex = json.getString("schemaFingerprint");
        if (!EXPECTED_SCHEMA_005_FP.equals(this.schemaFingerprintHex)) {
            throw new IllegalStateException("Catalog fingerprint mismatch: " + this.schemaFingerprintHex);
        }

        List<MigrationDef> migs = new ArrayList<>();
        JSONArray migArr = json.getJSONArray("migrations");
        MessageDigest fpSha = MessageDigest.getInstance("SHA-256");
        fpSha.update("KPB1/schema-005\0".getBytes(StandardCharsets.US_ASCII));
        for (int i = 0; i < migArr.length(); i++) {
            JSONObject mo = migArr.getJSONObject(i);
            int ver = mo.getInt("version");
            String name = mo.getString("name");
            JSONArray stArr = mo.getJSONArray("statements");
            List<String> stmts = new ArrayList<>(stArr.length());
            fpSha.update(new byte[] { (byte) (ver >>> 8), (byte) ver });
            int sc = stArr.length();
            fpSha.update(new byte[] { (byte) (sc >>> 24), (byte) (sc >>> 16), (byte) (sc >>> 8), (byte) sc });
            for (int j = 0; j < sc; j++) {
                String s = stArr.getString(j);
                stmts.add(s);
                byte[] sb = s.getBytes(StandardCharsets.UTF_8);
                fpSha.update(new byte[] {
                        (byte) (sb.length >>> 24), (byte) (sb.length >>> 16), (byte) (sb.length >>> 8), (byte) sb.length
                });
                fpSha.update(sb);
            }
            migs.add(new MigrationDef(ver, name, stmts));
        }
        byte[] computedFp = fpSha.digest();
        String computedHex = KanataM6PortableCrypto.bytesToHex(computedFp);
        if (!EXPECTED_SCHEMA_005_FP.equals(computedHex)) {
            throw new IllegalStateException("Computed Schema 005 DDL fingerprint mismatch: " + computedHex);
        }
        this.schemaFingerprintBytes = computedFp;
        this.migrations = Collections.unmodifiableList(migs);

        List<TableDef> all = new ArrayList<>();
        List<TableDef> biz = new ArrayList<>();
        List<TableDef> der = new ArrayList<>();
        List<TableDef> run = new ArrayList<>();
        List<TableDef> foo = new ArrayList<>();
        Map<Integer, TableDef> idMap = new HashMap<>();
        Map<String, TableDef> nameMap = new HashMap<>();

        JSONArray tArr = json.getJSONArray("tables");
        for (int i = 0; i < tArr.length(); i++) {
            JSONObject to = tArr.getJSONObject(i);
            int tid = to.getInt("tableId");
            String tname = to.getString("name");
            Category cat = Category.valueOf(to.getString("category").toUpperCase());
            boolean hasOrd = to.getBoolean("hasOrdinal");
            JSONArray cArr = to.getJSONArray("columns");
            List<ColumnDef> cols = new ArrayList<>(cArr.length());
            for (int j = 0; j < cArr.length(); j++) {
                JSONObject co = cArr.getJSONObject(j);
                cols.add(new ColumnDef(
                        co.getString("name"),
                        co.getInt("cid"),
                        ColType.valueOf(co.getString("type")),
                        co.getBoolean("notnull"),
                        co.getInt("pk")));
            }
            TableDef td = new TableDef(tid, tname, cat, hasOrd, cols);
            all.add(td);
            idMap.put(tid, td);
            nameMap.put(tname, td);
            if (cat == Category.BUSINESS) {
                biz.add(td);
                foo.add(td);
            } else if (cat == Category.DERIVED) {
                der.add(td);
                foo.add(td);
            } else {
                run.add(td);
            }
        }
        if (all.size() != 53 || biz.size() != 45 || der.size() != 5 || run.size() != 3 || foo.size() != 50) {
            throw new IllegalStateException("Unexpected catalog counts: " + all.size());
        }
        this.allTables = Collections.unmodifiableList(all);
        this.businessTables = Collections.unmodifiableList(biz);
        this.derivedTables = Collections.unmodifiableList(der);
        this.runtimeTables = Collections.unmodifiableList(run);
        this.footerTables = Collections.unmodifiableList(foo);
        this.byId = Collections.unmodifiableMap(idMap);
        this.byName = Collections.unmodifiableMap(nameMap);

        JSONArray ordArr = json.getJSONArray("installOrder");
        List<String> ord = new ArrayList<>(ordArr.length());
        for (int i = 0; i < ordArr.length(); i++) {
            ord.add(ordArr.getString(i));
        }
        if (ord.size() != 45) {
            throw new IllegalStateException("Expected 45 installOrder tables, got " + ord.size());
        }
        this.installOrder = Collections.unmodifiableList(ord);
    }

    public static KanataM6PortableCatalog load(Context instrContext) throws Exception {
        KanataM6PortableCatalog existing = INSTANCE;
        if (existing != null) return existing;
        synchronized (KanataM6PortableCatalog.class) {
            if (INSTANCE != null) return INSTANCE;
            try (InputStream is = instrContext.getAssets().open("kanata-portable-catalog-v1.json")) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                JSONObject json = new JSONObject(baos.toString(StandardCharsets.UTF_8.name()));
                INSTANCE = new KanataM6PortableCatalog(json);
                return INSTANCE;
            }
        }
    }

    public void initSchema(SQLiteDatabase db, int targetVersion, boolean recordMigrationRows) throws Exception {
        db.setForeignKeyConstraintsEnabled(true);
        db.enableWriteAheadLogging();
        db.rawExecSQL("PRAGMA temp_store=MEMORY");
        db.rawExecSQL("PRAGMA synchronous=FULL");
        db.rawExecSQL("PRAGMA wal_autocheckpoint=0");
        db.rawExecSQL("PRAGMA busy_timeout=5000");
        db.rawExecSQL("PRAGMA application_id=" + APPLICATION_ID);

        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        for (MigrationDef mig : migrations) {
            if (mig.version > targetVersion) break;
            db.beginTransactionNonExclusive();
            try {
                for (String stmt : mig.statements) {
                    db.execSQL(stmt);
                }
                if (recordMigrationRows) {
                    String syntheticChecksum = KanataM6PortableCrypto.bytesToHex(
                            sha.digest((mig.version + ":" + mig.name).getBytes(StandardCharsets.UTF_8)));
                    db.execSQL("INSERT INTO schema_migrations(version, name, checksum) VALUES(?, ?, ?)",
                            new Object[] { mig.version, mig.name, syntheticChecksum });
                    if (mig.version >= 3) {
                        if (mig.version == 3) {
                            db.execSQL("INSERT INTO schema_migration_applications(version, applied_at, time_source) VALUES(1, NULL, 'legacy-unrecorded')");
                            db.execSQL("INSERT INTO schema_migration_applications(version, applied_at, time_source) VALUES(2, NULL, 'legacy-unrecorded')");
                        }
                        db.execSQL("INSERT INTO schema_migration_applications(version, applied_at, time_source) VALUES(?, ?, 'js-wall-clock-utc-ms')",
                                new Object[] { mig.version, 1732348800000L + mig.version });
                    }
                }
                db.rawExecSQL("PRAGMA user_version=" + mig.version);
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
    }
}
