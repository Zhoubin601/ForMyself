package com.yubin.formyself;

import android.database.Cursor;
import android.os.CancellationSignal;
import android.os.SystemClock;

import net.zetetic.database.sqlcipher.KanataM6SqlCipherSessionProbe;
import net.zetetic.database.sqlcipher.SQLiteDatabase;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Snapshot owner & write gate for Scheme C Native SQLCipher consistent read-only export.
 *
 * Lifecycle:
 * 1. Revokes old operation lease & pauses synthetic task scheduler.
 * 2. Acquires write gate: blocks new ordinary writers and drains in-flight writers already committing.
 * 3. Opens an independent OPEN_READONLY SQLiteDatabase instance and pins a DEFERRED read-only
 *    transaction with a first SELECT inside the write gate.
 * 4. Verifies Schema 005 metadata (user_version=5, application_id=0x4b4e5441) and 005 ordinal completeness
 *    on the pinned snapshot (never auto-repairs missing/gapped ordinals).
 * 5. Unblocks ordinary writers after the WAL snapshot is pinned (recording writeBlockNs), while keeping
 *    the single DEFERRED read-only view pinned across all 45 business + 5 derived table reads.
 */
public final class KanataM6SnapshotOwner {
    public static final class WriteGate {
        private final ReentrantLock lock = new ReentrantLock(true);
        private final Condition drained = lock.newCondition();
        private final Condition unblocked = lock.newCondition();
        private int activeWriters = 0;
        private boolean gateClosed = false;
        private long leaseEpoch = 1L;
        private boolean taskSchedulerFrozen = false;

        public long currentLeaseEpoch() {
            lock.lock();
            try {
                return leaseEpoch;
            } finally {
                lock.unlock();
            }
        }

        public boolean isTaskSchedulerFrozen() {
            lock.lock();
            try {
                return taskSchedulerFrozen;
            } finally {
                lock.unlock();
            }
        }

        public long enterWriter() throws InterruptedException {
            lock.lock();
            try {
                while (gateClosed) {
                    unblocked.await();
                }
                activeWriters++;
                return leaseEpoch;
            } finally {
                lock.unlock();
            }
        }

        public boolean tryEnterWriterNonBlocking() {
            lock.lock();
            try {
                if (gateClosed) return false;
                activeWriters++;
                return true;
            } finally {
                lock.unlock();
            }
        }

        public void exitWriter() {
            lock.lock();
            try {
                if (activeWriters > 0) activeWriters--;
                if (activeWriters == 0) drained.signalAll();
            } finally {
                lock.unlock();
            }
        }

        public long beginSnapshotFreezeAndDrain(long timeoutMs) throws InterruptedException {
            long deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
            lock.lock();
            try {
                leaseEpoch++;
                taskSchedulerFrozen = true;
                gateClosed = true;
                while (activeWriters > 0) {
                    long rem = deadlineNs - System.nanoTime();
                    if (rem <= 0) {
                        gateClosed = false;
                        taskSchedulerFrozen = false;
                        unblocked.signalAll();
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_IO_FAILED, "writer-drain-timeout");
                    }
                    drained.awaitNanos(rem);
                }
                return leaseEpoch;
            } finally {
                lock.unlock();
            }
        }

        public void endSnapshotFreeze() {
            lock.lock();
            try {
                gateClosed = false;
                taskSchedulerFrozen = false;
                unblocked.signalAll();
            } finally {
                lock.unlock();
            }
        }
    }

    public static final class PinnedSnapshot implements AutoCloseable {
        public final SQLiteDatabase roDb;
        public final long leaseEpoch;
        public final long freezeDrainNs;
        public final long writeBlockNs;
        public final long snapshotPinNs;
        private boolean closed = false;

        PinnedSnapshot(
                SQLiteDatabase roDb,
                long leaseEpoch,
                long freezeDrainNs,
                long writeBlockNs,
                long snapshotPinNs) {
            this.roDb = roDb;
            this.leaseEpoch = leaseEpoch;
            this.freezeDrainNs = freezeDrainNs;
            this.writeBlockNs = writeBlockNs;
            this.snapshotPinNs = snapshotPinNs;
        }

        @Override
        public void close() {
            if (closed) return;
            closed = true;
            try {
                if (roDb.inTransaction()) {
                    roDb.endTransaction();
                }
            } finally {
                roDb.close();
            }
        }
    }

    private KanataM6SnapshotOwner() {}

    public static PinnedSnapshot acquirePinnedSnapshot(
            String dbPath,
            byte[] rawSqlCipherKey,
            WriteGate gate,
            KanataM6PortableCatalog catalog,
            CancellationSignal cancelSignal,
            AtomicBoolean cancelled,
            boolean releaseGateAfterPin) throws Exception {
        long tStartNs = SystemClock.elapsedRealtimeNanos();
        long newEpoch = gate != null ? gate.beginSnapshotFreezeAndDrain(5000L) : 0L;
        long tAfterDrainNs = SystemClock.elapsedRealtimeNanos();
        long freezeDrainNs = tAfterDrainNs - tStartNs;
        boolean handedOff = false;
        SQLiteDatabase roDb = null;
        try {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            int flagsRo = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
            roDb = SQLiteDatabase.openDatabase(dbPath, rawSqlCipherKey, null, flagsRo, (d, e) -> {}, null);
            roDb.rawExecSQL("PRAGMA busy_timeout=5000");

            KanataM6SqlCipherSessionProbe.beginDeferredTransaction(roDb, true, cancelSignal);
            // First SELECT inside DEFERRED transaction pins the exact WAL snapshot view!
            int userVersion = Integer.parseInt(scalar(roDb, "PRAGMA user_version"));
            int appId = Integer.parseInt(scalar(roDb, "PRAGMA application_id"));
            if (userVersion != KanataM6PortableCatalog.SCHEMA_VERSION) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "source-schema-version:" + userVersion);
            }
            if (appId != KanataM6PortableCatalog.APPLICATION_ID) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "source-app-id:" + appId);
            }

            // Verify expected Schema 005 tables exist in sqlite_schema within the same snapshot
            int expectedTableCount = catalog.allTables.size();
            int actualTables = Integer.parseInt(scalar(roDb,
                    "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'"));
            if (actualTables != expectedTableCount) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL,
                        "schema-table-count:" + actualTables + "!=" + expectedTableCount);
            }

            // Verify Schema 005 ordinal completeness (no missing/gapped ordinals; never auto-repair)
            verifySchema005Ordinals(roDb);

            long tPinnedNs = SystemClock.elapsedRealtimeNanos();
            if (gate != null && releaseGateAfterPin) {
                gate.endSnapshotFreeze();
            }
            long tUnblockedNs = SystemClock.elapsedRealtimeNanos();
            // Write block spans from BEFORE beginSnapshotFreezeAndDrain() through endSnapshotFreeze() (or pin if kept frozen)
            long writeBlockNs = (gate != null && releaseGateAfterPin)
                    ? (tUnblockedNs - tStartNs)
                    : (tPinnedNs - tStartNs);
            long pinNs = tPinnedNs - tStartNs;
            handedOff = true;
            return new PinnedSnapshot(roDb, newEpoch, freezeDrainNs, writeBlockNs, pinNs);
        } finally {
            if (!handedOff) {
                if (gate != null) gate.endSnapshotFreeze();
                if (roDb != null) {
                    try {
                        if (roDb.inTransaction()) roDb.endTransaction();
                    } catch (Throwable ignored) {}
                    try {
                        roDb.close();
                    } catch (Throwable ignored) {}
                }
            }
        }
    }

    public static void verifySchema005Ordinals(SQLiteDatabase roDb) {
        String[][] pairs = new String[][] {
                { "world_events", "event_array_order" },
                { "world_effects", "effect_array_order" },
                { "effect_baselines", "baseline_array_order" }
        };
        for (String[] pair : pairs) {
            String entity = pair[0];
            String order = pair[1];
            // 1. Total entity rows must equal total order rows, and every entity must join cleanly
            String entCount = scalar(roDb, "SELECT count(*) FROM " + entity);
            String ordCount = scalar(roDb, "SELECT count(*) FROM " + order);
            if (!entCount.equals(ordCount)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE,
                        "count-mismatch:" + entity + ":" + entCount + "!=" + ordCount);
            }
            String joinCount = scalar(roDb,
                    "SELECT count(*) FROM " + entity + " e JOIN " + order
                            + " o ON o.world_id = e.world_id AND o.entity_id = e.id");
            if (!entCount.equals(joinCount)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE,
                        "join-mismatch:" + entity + ":" + entCount + "!=" + joinCount);
            }
            // 2. Per-world continuity: min=0, max=count-1, no holes
            try (Cursor c = roDb.rawQuery(
                    "SELECT world_id, count(*), min(ordinal), max(ordinal) FROM " + order + " GROUP BY world_id",
                    new Object[0])) {
                while (c.moveToNext()) {
                    long cnt = c.getLong(1);
                    long minOrd = c.getLong(2);
                    long maxOrd = c.getLong(3);
                    if (minOrd != 0L || maxOrd != cnt - 1L) {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_ARRAY_ORDER_INCOMPLETE,
                                "ordinal-gap:" + order + ":" + minOrd + ".." + maxOrd + "/" + cnt);
                    }
                }
            }
        }
    }

    static String scalar(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, new Object[0])) {
            if (!c.moveToFirst()) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "empty-scalar:" + sql);
            }
            return c.getString(0);
        }
    }
}
