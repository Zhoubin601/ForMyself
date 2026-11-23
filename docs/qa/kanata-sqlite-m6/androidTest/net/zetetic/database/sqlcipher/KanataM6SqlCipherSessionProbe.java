package net.zetetic.database.sqlcipher;

import android.os.CancellationSignal;

/**
 * M6-02 N-02 isolated QA probe helper exposing package-private SQLiteSession
 * TRANSACTION_MODE_DEFERRED entry on SQLiteDatabase without modifying the AAR.
 */
public final class KanataM6SqlCipherSessionProbe {
    private KanataM6SqlCipherSessionProbe() {}

    public static void beginDeferredTransaction(
            SQLiteDatabase db,
            boolean readOnlyConnectionFlag,
            CancellationSignal signal) {
        int flags = db.getThreadDefaultConnectionFlags(readOnlyConnectionFlag);
        db.getThreadSession().beginTransaction(
                SQLiteSession.TRANSACTION_MODE_DEFERRED,
                null,
                flags,
                signal);
    }

    public static boolean hasConnection(SQLiteDatabase db) {
        return db.getThreadSession().hasConnection();
    }

    public static boolean hasTransaction(SQLiteDatabase db) {
        return db.getThreadSession().hasTransaction();
    }
}
