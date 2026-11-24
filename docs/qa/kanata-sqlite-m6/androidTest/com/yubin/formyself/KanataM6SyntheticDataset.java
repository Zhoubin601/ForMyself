package com.yubin.formyself;

import android.database.Cursor;
import android.util.Base64;

import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Deterministic Schema 005 synthetic dataset generator (1k / 10k / 100k messages)
 * and per-table logical SHA-256 identity verifier for A1 / A2 / C unified comparison.
 */
public final class KanataM6SyntheticDataset {
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    public static final class LogicalSummary {
        public final Map<String, Long> tableRowCounts;
        public final Map<String, String> tableDigestsHex;
        public final String overallDigestHex;
        public final long totalFooterRows;
        public final long totalBusinessRows;
        public final int populatedBusinessTableCount;
        public final int populatedDerivedTableCount;

        LogicalSummary(
                Map<String, Long> tableRowCounts,
                Map<String, String> tableDigestsHex,
                String overallDigestHex,
                long totalFooterRows,
                long totalBusinessRows,
                int populatedBusinessTableCount,
                int populatedDerivedTableCount) {
            this.tableRowCounts = Collections.unmodifiableMap(tableRowCounts);
            this.tableDigestsHex = Collections.unmodifiableMap(tableDigestsHex);
            this.overallDigestHex = overallDigestHex;
            this.totalFooterRows = totalFooterRows;
            this.totalBusinessRows = totalBusinessRows;
            this.populatedBusinessTableCount = populatedBusinessTableCount;
            this.populatedDerivedTableCount = populatedDerivedTableCount;
        }
    }

    private KanataM6SyntheticDataset() {}

    public static long walSizeBytes(File dbFile) {
        File wal = new File(dbFile.getAbsolutePath() + "-wal");
        return wal.exists() ? wal.length() : 0L;
    }

    public static void populateUniformDataset(
            File dbFile,
            byte[] rawKey,
            KanataM6PortableCatalog catalog,
            int messageCount) throws Exception {
        try (SQLiteDatabase db = populateWithActiveWal(dbFile, rawKey, catalog, messageCount)) {
            // Closes DB cleanly when no live uncheckpointed WAL retention is needed
        }
    }

    /**
     * Populates the full Schema 005 synthetic dataset and keeps the writer connection open
     * (with wal_autocheckpoint=0) so committed pages remain in the active uncheckpointed -wal file.
     * Caller MUST close the returned SQLiteDatabase in try-with-resources.
     */
    public static SQLiteDatabase populateWithActiveWal(
            File dbFile,
            byte[] rawKey,
            KanataM6PortableCatalog catalog,
            int messageCount) throws Exception {
        SQLiteDatabase.deleteDatabase(dbFile);
        SQLiteDatabase db = SQLiteDatabase.openDatabase(
                dbFile.getAbsolutePath(), rawKey, null,
                FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null);
        boolean handedOff = false;
        try {
            catalog.initSchema(db, 5, true);

            // Transaction 1: seed core entities covering all 45 business tables + 5 derived + 3 runtime
            db.beginTransactionNonExclusive();
            try {
                db.execSQL("INSERT INTO data_migrations VALUES('dm-1', 5, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'messages', '{}', 0, 'complete', '{}')");
                db.execSQL("INSERT INTO dataset_metadata VALUES(1, 'user-synth-1', 2, '{\"dataset\":\"uniform\"}')");
                db.execSQL("INSERT INTO worlds VALUES('w1', '合成基准世界\uD83D\uDCE6', 'rules-v1', 1, 'Asia/Shanghai', 1700000000000, 1700000001000, 1, 1, 1, 'daily', NULL, 'id-1', '{\"k\":\"w1\"}')");
                try (SQLiteStatement st = db.compileStatement(
                        "INSERT INTO world_identities VALUES('id-1', 'w1', 'user-synth-1', CAST(? AS TEXT), 'bg-合成', 1, '{}')")) {
                    st.bindBlob(1, "\ufeff用户 e\u0301 \u0000\ufeff ".getBytes(StandardCharsets.UTF_8));
                    st.executeInsert();
                }

                db.execSQL("INSERT INTO character_cards VALUES('card-1', 'ver-1', 0, 'preset-main', '{}')");
                db.execSQL("INSERT INTO card_versions VALUES('ver-1', 'card-1', 1, '{\"name\":\"K-1\"}', '{\"raw\":1}', 'import', '{\"src\":1}', '{}')");
                db.execSQL("INSERT INTO character_cards VALUES('card-2', 'ver-2', 0, NULL, '{}')");
                db.execSQL("INSERT INTO card_versions VALUES('ver-2', 'card-2', 1, '{\"name\":\"K-2\"}', '{\"raw\":2}', 'manual', NULL, '{}')");

                db.execSQL("INSERT INTO character_instances VALUES('inst-1', 'w1', 'card-1', 'ver-1', 1, '{}', 'calm', -0.0, 'home', 1, 1, '{}')");
                db.execSQL("INSERT INTO character_instances VALUES('inst-2', 'w1', 'card-2', 'ver-2', 1, '{}', 'bright', 0.75, 'park', 1, 0, '{}')");

                db.execSQL("INSERT INTO role_binding_state VALUES(1, 1, '{}')");
                db.execSQL("INSERT INTO role_bindings VALUES('global', 1, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO preset_applications VALUES('pa-1', 'w1', 'init-1', 'preset-main', 1, '{}')");
                db.execSQL("INSERT INTO memory_policies VALUES('w1', 'standard', 1, 10, 40, 20, 8000, 1, '{}')");
                db.execSQL("INSERT INTO autonomy_policies VALUES('w1', 1, 2, 12, 'standard', 1380, 420, 'private', '{}')");

                db.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', '主对话\uD83D\uDCAC', 'daily', 1, 1700000000500, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO conversations VALUES('c2', 'w1', 'group', '群聊', 'inherit', 1, 1700000000600, 2, 12, 1, 1500, '{}')");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'inst-1', 'character', 1)");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c2', 'id-1', 'user', 0)");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c2', 'inst-1', 'character', 1)");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c2', 'inst-2', 'character', 2)");
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }

            // Transaction 2..N: batch-insert messages (leave final 20 un-checkpointed in WAL)
            int initialBatchCount = Math.max(0, messageCount - 20);
            String insertMsgSql = "INSERT INTO messages VALUES(?, 'w1', ?, ?, ?, ?, ?, ?, ?, 1, 'complete', ?, ?, NULL, ?, ?, ?)";
            String sampleB64 = Base64.encodeToString("kanata-synthetic-payload-vector-0123456789".getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            int chunkSize = 2000;
            for (int start = 0; start < initialBatchCount; start += chunkSize) {
                int end = Math.min(initialBatchCount, start + chunkSize);
                db.beginTransactionNonExclusive();
                try (SQLiteStatement st = db.compileStatement(insertMsgSql)) {
                    insertMessageRange(st, start, end, messageCount, sampleB64);
                    db.setTransactionSuccessful();
                } finally {
                    db.endTransaction();
                }
            }

            // Insert remaining business tables + final 20 messages inside active WAL transaction
            db.beginTransactionNonExclusive();
            try {
                if (initialBatchCount < messageCount) {
                    try (SQLiteStatement st = db.compileStatement(insertMsgSql)) {
                        insertMessageRange(st, initialBatchCount, messageCount, messageCount, sampleB64);
                    }
                }

                db.execSQL("INSERT INTO archived_message_marks VALUES('w1', 'c2', 'msg-000000')");
                db.execSQL("UPDATE messages SET revision=2 WHERE id='msg-000000'");
                db.execSQL("INSERT INTO message_audits VALUES('ma-1', 'w1', 'msg-000000', 1700000000900, 1, 2, '{\"id\":\"msg-000000\",\"worldId\":\"w1\",\"conversationId\":\"c2\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":1700000100000,\"content\":\"old\",\"senderNameSnapshot\":\"用户\",\"status\":\"complete\",\"revision\":1}', '{\"id\":\"msg-000000\",\"worldId\":\"w1\",\"conversationId\":\"c2\",\"senderId\":\"id-1\",\"senderType\":\"user\",\"role\":\"user\",\"createdAt\":1700000100000,\"content\":\"new\",\"senderNameSnapshot\":\"用户\",\"status\":\"complete\",\"revision\":2}', '{}')");

                db.execSQL("INSERT INTO lorebook_entries VALUES('lb-1', 'w1', 'character', 'inst-1', 'inst-1', '[\"约定\"]', '[\"日记\"]', '设定文本\uD83D\uDCD6', 5, 'keyword', 'participants', 'user', 1, 1, 0, '{}')");
                db.execSQL("INSERT INTO lorebook_known_by VALUES('w1', 'lb-1', 'inst-1')");

                db.execSQL("INSERT INTO memories VALUES('mem-1', 'w1', 'character', 'inst-1', 'inst-1', 'L2', 'key-1', '记住这个约定', 'active', 1, 'participants', 'c1', 'confirmed', 'gen-1', '{}')");
                db.execSQL("INSERT INTO memories VALUES('mem-2', 'w1', 'world', 'w1', NULL, 'L3', 'key-2', '世界背景记忆', 'active', 1, 'public', NULL, 'statement', NULL, '{}')");
                db.execSQL("INSERT INTO memory_known_by VALUES('w1', 'mem-1', 'inst-1')");
                db.execSQL("INSERT INTO memory_links VALUES('w1', 'mem-1', 'mem-2', 'shared')");
                db.execSQL("INSERT INTO memory_sources VALUES('w1', 'mem-1', 'msg-000000', 1)");

                db.execSQL("INSERT INTO relationships VALUES('rel-1', 'w1', 'id-1', 'inst-1', 'friend', 'new', '互相信任的朋友', 0.65, 0.45, 0.72, 1, 1, '{}')");

                db.execSQL("INSERT INTO world_events VALUES('evt-1', 'w1', 'committed', 'private', '散步事件', 1700000001000, 1700000001000, 2, 'explicit', 'move', 'inst-1', NULL, 'park', NULL, '{}')");
                db.execSQL("INSERT INTO world_events VALUES('evt-2', 'w1', 'committed', 'participants', '对话支持事件', 1700000001100, 1700000001100, 1, 'unknown', 'support', 'inst-1', 'rel-1', 'home', NULL, '{}')");
                db.execSQL("INSERT INTO event_audits VALUES('ea-1', 'w1', 'evt-1', 1700000001200, 1, 2, '{\"id\":\"evt-1\",\"worldId\":\"w1\",\"revision\":1}', '{\"id\":\"evt-1\",\"worldId\":\"w1\",\"revision\":2}', '{}')");
                db.execSQL("INSERT INTO event_causes VALUES('w1', 'evt-2', 'evt-1')");
                db.execSQL("INSERT INTO event_participants VALUES('w1', 'evt-1', 'inst-1')");
                db.execSQL("INSERT INTO event_sources VALUES('w1', 'evt-1', 'msg-000000', 1)");
                db.execSQL("INSERT INTO relationship_events VALUES('w1', 'rel-1', 'evt-2')");
                db.execSQL("INSERT INTO memory_events VALUES('w1', 'mem-1', 'evt-1')");

                db.execSQL("INSERT INTO world_effects VALUES('eff-1', 'w1', 'evt-1', 'instance', 'inst-1', 'inst-1', NULL, 'set', 'state.mood', '\"happy\"', 1, '{}')");
                db.execSQL("INSERT INTO effect_baselines VALUES('base-1', 'w1', 'instance', 'inst-1', 'inst-1', NULL, 'state.mood', '\"calm\"', '{}')");

                db.execSQL("INSERT INTO life_grants VALUES('gr-1', 'w1', 'inst-1', 'mood', 1, 1, 1, 1, '{}')");
                db.execSQL("INSERT INTO message_life_sources VALUES('w1', 'msg-000000', 'gr-1', 'inst-1', 'mood', 1, '1111111111111111111111111111111111111111111111111111111111111111')");
                db.execSQL("INSERT INTO memory_life_sources VALUES('w1', 'mem-1', 'gr-1', 'inst-1', 'mood', 1, '2222222222222222222222222222222222222222222222222222222222222222')");
                db.execSQL("INSERT INTO event_life_sources VALUES('w1', 'evt-1', 'gr-1', 'inst-1', 'mood', 1, '3333333333333333333333333333333333333333333333333333333333333333')");

                db.execSQL("INSERT INTO background_tasks VALUES('task-1', 'w1', 'proactive', 'running', 'k-pro-1', 1, 1, 1700000002000, 99999, 'c1', 'inst-1', NULL, '{}', NULL, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO background_tasks VALUES('task-2', 'w1', 'reply', 'pending', 'k-rep-2', 1, 0, 1700000002001, 0, 'c1', 'inst-1', NULL, '{}', NULL, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO background_tasks VALUES('task-3', 'w1', 'memory', 'running', 'k-mem-3', 1, 1, 1700000002002, 99999, NULL, NULL, NULL, '{}', NULL, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO task_social_participants VALUES('w1', 'task-1', 'c1', 'inst-1', 'character')");
                db.execSQL("INSERT INTO task_sources VALUES('w1', 'task-1', 'msg-000000', 1)");
                db.execSQL("INSERT INTO task_result_events VALUES('w1', 'task-1', 'evt-1')");
                db.execSQL("INSERT INTO task_result_memories VALUES('w1', 'task-1', 'mem-1')");

                db.execSQL("INSERT INTO usage_events VALUES('ue-1', 'w1', 'c1', 'inst-1', 'character', 'turn-0', 'gpt-test', 1, 1700000002000, 1700000002010, 'stream', 'succeeded', '', 'stop', 120, 64, 120, 64, 16, 'chat', '{}')");
                db.execSQL("INSERT INTO virtual_schedules VALUES('vs-1', 'w1', 'inst-1', 540, 1020, 'library', 'reading', 0, 1, '{}')");
                db.execSQL("INSERT INTO virtual_schedule_days VALUES('w1', 'vs-1', 1)");
                db.execSQL("INSERT INTO domain_command_receipts VALUES('cmd-1', '4444444444444444444444444444444444444444444444444444444444444444', 'msg-000000')");

                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }

            // Assert all 53 tables (45 business + 5 derived + 3 runtime) have >= 1 row
            for (KanataM6PortableCatalog.TableDef td : catalog.allTables) {
                try (Cursor c = db.rawQuery("SELECT count(*) FROM " + td.name, null)) {
                    if (!c.moveToFirst() || c.getLong(0) < 1L) {
                        throw new IllegalStateException("Expected >= 1 row in table " + td.name + ", got " + (c.moveToFirst() ? c.getLong(0) : -1));
                    }
                }
            }
            handedOff = true;
            return db;
        } finally {
            if (!handedOff) {
                db.close();
            }
        }
    }

    private static void insertMessageRange(
            SQLiteStatement st,
            int start,
            int end,
            int totalMessages,
            String sampleB64) {
        // Insert in descending index order within each batch so forward reply_to_message_id FKs (e.g. msg-000001 -> msg-000003) satisfy immediate FK checks
        for (int i = end - 1; i >= start; i--) {
            String id = String.format("msg-%06d", i);
            boolean isUser = (i % 2 == 0);
            String convId = (i % 10 == 0) ? "c2" : "c1";
            String role = isUser ? "user" : "assistant";
            String senderType = isUser ? "user" : "character";
            String senderId = isUser ? "id-1" : "inst-1";
            String senderName = isUser ? "用户" : "K-1";
            String content = (i % 100 == 0)
                    ? "第" + i + "条\uD83D\uDCE6 e\u0301 b64=" + sampleB64
                    : "Synthetic message #" + i + " 你好\uD83D\uDE80";
            long ts = 1700000100000L + i;
            String turnId = "turn-" + (i / 2);
            String batchId = "batch-" + (i / 10);

            st.clearBindings();
            st.bindString(1, id);
            st.bindString(2, convId);
            st.bindString(3, role);
            st.bindString(4, senderType);
            st.bindString(5, senderId);
            st.bindString(6, senderName);
            st.bindString(7, content);
            st.bindLong(8, ts);
            st.bindString(9, turnId);
            st.bindString(10, batchId);
            if (i == 1 && end > 3) {
                // Forward FK reference inside c1 to verify two-pass recovery order during Scheme C restore
                st.bindString(11, "msg-000003");
                st.bindLong(12, 1L);
            } else {
                st.bindNull(11);
                st.bindNull(12);
            }
            st.bindString(13, "{\"seq\":" + i + "}");
            st.executeInsert();
        }
    }

    public static LogicalSummary computeLogicalFingerprint(
            SQLiteDatabase roDb,
            KanataM6PortableCatalog catalog,
            boolean applyTaskPauseProjection) throws Exception {
        MessageDigest overall = MessageDigest.getInstance("SHA-256");
        byte[] tableDomainPrefix = "KPB1/table\0".getBytes(StandardCharsets.US_ASCII);
        byte[] tidBytes = new byte[2];
        byte[] lenBuf = new byte[4];

        Map<String, Long> rowCounts = new HashMap<>(50);
        Map<String, String> digests = new HashMap<>(50);
        long totalFooterRows = 0L;
        long totalBizRows = 0L;
        int popBiz = 0;
        int popDer = 0;

        for (KanataM6PortableCatalog.TableDef td : catalog.footerTables) {
            MessageDigest tSha = MessageDigest.getInstance("SHA-256");
            tSha.update(tableDomainPrefix);
            KanataM6PortableCrypto.writeU16BE(tidBytes, 0, td.tableId);
            tSha.update(tidBytes);

            long rc = 0L;
            String sql = KanataM6BoundedRowReader.buildSelectSql(td);
            try (Cursor c = roDb.rawQuery(sql, null)) {
                while (c.moveToNext()) {
                    KanataM6BoundedRowReader.EncodedRow row = KanataM6BoundedRowReader.readAndEncodeCurrentRow(
                            roDb, c, td, applyTaskPauseProjection, false);
                    KanataM6PortableCrypto.writeU32BE(lenBuf, 0, row.bodyLen);
                    tSha.update(lenBuf);
                    tSha.update(row.body, 0, row.bodyLen);
                    KanataM6PortableCrypto.zeroize(row.body);
                    rc++;
                }
            }
            String dHex = KanataM6PortableCrypto.bytesToHex(tSha.digest());
            rowCounts.put(td.name, rc);
            digests.put(td.name, dHex);
            totalFooterRows += rc;
            if (td.category == KanataM6PortableCatalog.Category.BUSINESS) {
                totalBizRows += rc;
                if (rc > 0L) popBiz++;
            } else if (td.category == KanataM6PortableCatalog.Category.DERIVED) {
                if (rc > 0L) popDer++;
            }
            String line = td.tableId + ":" + rc + ":" + dHex + "\n";
            overall.update(line.getBytes(StandardCharsets.UTF_8));
        }

        return new LogicalSummary(
                rowCounts,
                digests,
                KanataM6PortableCrypto.bytesToHex(overall.digest()),
                totalFooterRows,
                totalBizRows,
                popBiz,
                popDer);
    }
}
