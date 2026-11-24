package com.yubin.formyself;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Lifecycle-managed database & operation-lease owner for N-04 tests.
 * Automatically closes owned SQLCipher DB connections and revokes active lease epochs
 * when the host Activity enters onPause / onStop / onDestroy or invalidates the session.
 */
public final class KanataM6LifecycleController {
    public static final class OperationLease {
        public final long epoch;
        public final long sessionRevision;

        OperationLease(long epoch, long sessionRevision) {
            this.epoch = epoch;
            this.sessionRevision = sessionRevision;
        }
    }

    public enum CompletionStatus {
        COMPLETED,
        ALREADY_COMPLETED,
        REJECTED_STALE_EPOCH,
        REJECTED_STALE_SESSION
    }

    private final AtomicLong epoch = new AtomicLong(1L);
    private final AtomicLong sessionRevision = new AtomicLong(1L);
    private final AtomicInteger completionCount = new AtomicInteger(0);
    private final AtomicInteger staleRejectedCount = new AtomicInteger(0);
    private final Set<Long> completedEpochs = Collections.synchronizedSet(new HashSet<>());
    private SQLiteDatabase ownedDb;

    public synchronized void restoreMonotonicCounters(long savedEpoch, long savedSessionRevision) {
        if (savedEpoch > epoch.get()) {
            epoch.set(savedEpoch);
        }
        if (savedSessionRevision > sessionRevision.get()) {
            sessionRevision.set(savedSessionRevision);
        }
    }

    public synchronized OperationLease openManagedDatabase(String dbPath, byte[] rawKey) {
        closeOwnedDatabaseInternal();
        int flagsRo = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
        ownedDb = SQLiteDatabase.openDatabase(dbPath, rawKey, null, flagsRo, (d, e) -> {}, null);
        return new OperationLease(epoch.get(), sessionRevision.get());
    }

    public synchronized SQLiteDatabase getOwnedDb() {
        return ownedDb;
    }

    public synchronized boolean isDbOpen() {
        return ownedDb != null && ownedDb.isOpen();
    }

    public long getEpoch() {
        return epoch.get();
    }

    public long getSessionRevision() {
        return sessionRevision.get();
    }

    public int getCompletionCount() {
        return completionCount.get();
    }

    public int getStaleRejectedCount() {
        return staleRejectedCount.get();
    }

    /** Called by host Activity's onPause() / onStop() / onDestroy(). */
    public synchronized void onHostBackgroundOrDestroy() {
        epoch.incrementAndGet();
        closeOwnedDatabaseInternal();
    }

    /** Called when simulated user/session switch invalidates the session. */
    public synchronized void invalidateSession() {
        sessionRevision.incrementAndGet();
        epoch.incrementAndGet();
        closeOwnedDatabaseInternal();
    }

    public synchronized CompletionStatus tryComplete(OperationLease lease) {
        if (lease == null) {
            staleRejectedCount.incrementAndGet();
            return CompletionStatus.REJECTED_STALE_EPOCH;
        }
        if (lease.sessionRevision != sessionRevision.get()) {
            staleRejectedCount.incrementAndGet();
            return CompletionStatus.REJECTED_STALE_SESSION;
        }
        if (lease.epoch != epoch.get()) {
            staleRejectedCount.incrementAndGet();
            return CompletionStatus.REJECTED_STALE_EPOCH;
        }
        if (!completedEpochs.add(lease.epoch)) {
            return CompletionStatus.ALREADY_COMPLETED;
        }
        completionCount.incrementAndGet();
        return CompletionStatus.COMPLETED;
    }

    private void closeOwnedDatabaseInternal() {
        if (ownedDb != null) {
            try {
                if (ownedDb.inTransaction()) {
                    ownedDb.endTransaction();
                }
            } catch (Throwable ignored) {}
            try {
                if (ownedDb.isOpen()) {
                    ownedDb.close();
                }
            } catch (Throwable ignored) {}
            ownedDb = null;
        }
    }
}
