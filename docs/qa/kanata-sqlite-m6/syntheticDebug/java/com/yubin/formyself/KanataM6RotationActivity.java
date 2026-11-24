package com.yubin.formyself;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Standard non-configChanges Activity to verify real Android configuration-change / rotation recreate()
 * and automatic lifecycle controller DB closure + lease epoch revocation.
 */
public final class KanataM6RotationActivity extends Activity {
    private static final String STATE_EPOCH = "m6_rot_epoch";
    private static final String STATE_SESSION = "m6_rot_session";

    public static final AtomicInteger CREATE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger PAUSE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger STOP_COUNT = new AtomicInteger(0);
    public static final AtomicInteger DESTROY_COUNT = new AtomicInteger(0);
    public static final AtomicInteger RESUME_COUNT = new AtomicInteger(0);
    private static final AtomicLong GLOBAL_MONOTONIC_EPOCH = new AtomicLong(1L);

    private final KanataM6LifecycleController lifecycleController = new KanataM6LifecycleController();

    public static void resetCounters() {
        CREATE_COUNT.set(0);
        PAUSE_COUNT.set(0);
        STOP_COUNT.set(0);
        DESTROY_COUNT.set(0);
        RESUME_COUNT.set(0);
        GLOBAL_MONOTONIC_EPOCH.set(1L);
    }

    public KanataM6LifecycleController getLifecycleController() {
        return lifecycleController;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CREATE_COUNT.incrementAndGet();
        long savedEpoch = savedInstanceState != null ? savedInstanceState.getLong(STATE_EPOCH, 1L) : 1L;
        long savedSession = savedInstanceState != null ? savedInstanceState.getLong(STATE_SESSION, 1L) : 1L;
        long monotonicEpoch = Math.max(savedEpoch, GLOBAL_MONOTONIC_EPOCH.get());
        lifecycleController.restoreMonotonicCounters(monotonicEpoch, savedSession);
        TextView tv = new TextView(this);
        tv.setText("Kanata M6 Rotation Lifecycle Host");
        setContentView(tv);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putLong(STATE_EPOCH, lifecycleController.getEpoch());
        outState.putLong(STATE_SESSION, lifecycleController.getSessionRevision());
    }

    @Override
    protected void onResume() {
        super.onResume();
        RESUME_COUNT.incrementAndGet();
    }

    @Override
    protected void onPause() {
        PAUSE_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        GLOBAL_MONOTONIC_EPOCH.set(Math.max(GLOBAL_MONOTONIC_EPOCH.get(), lifecycleController.getEpoch()));
        super.onPause();
    }

    @Override
    protected void onStop() {
        STOP_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        GLOBAL_MONOTONIC_EPOCH.set(Math.max(GLOBAL_MONOTONIC_EPOCH.get(), lifecycleController.getEpoch()));
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        DESTROY_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        GLOBAL_MONOTONIC_EPOCH.set(Math.max(GLOBAL_MONOTONIC_EPOCH.get(), lifecycleController.getEpoch()));
        super.onDestroy();
    }
}
