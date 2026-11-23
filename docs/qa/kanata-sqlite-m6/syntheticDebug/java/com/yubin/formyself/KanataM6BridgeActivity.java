package com.yubin.formyself;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Isolated synthetic BridgeActivity for N-03 (WebView / Capacitor Bridge / JS heap)
 * and N-04 (Activity lifecycle / pause / resume / rotation) instrumentation tests.
 */
public final class KanataM6BridgeActivity extends BridgeActivity {
    public static final AtomicInteger PAUSE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger RESUME_COUNT = new AtomicInteger(0);
    public static final AtomicInteger DESTROY_COUNT = new AtomicInteger(0);

    public static void resetLifecycleCounters() {
        PAUSE_COUNT.set(0);
        RESUME_COUNT.set(0);
        DESTROY_COUNT.set(0);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(KanataSqlitePlugin.class);
        registerPlugin(KanataM6SyntheticPortablePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        RESUME_COUNT.incrementAndGet();
    }

    @Override
    public void onPause() {
        PAUSE_COUNT.incrementAndGet();
        super.onPause();
    }

    @Override
    public void onDestroy() {
        DESTROY_COUNT.incrementAndGet();
        super.onDestroy();
    }
}
