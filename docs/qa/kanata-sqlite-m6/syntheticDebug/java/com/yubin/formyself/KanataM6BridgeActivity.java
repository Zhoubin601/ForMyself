package com.yubin.formyself;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Isolated synthetic BridgeActivity for N-03 (WebView / Capacitor Bridge / JS heap)
 * and N-04 (real Activity lifecycle / SAF DocumentsUI / Share Chooser) instrumentation tests.
 */
public final class KanataM6BridgeActivity extends BridgeActivity {
    public static final int REQ_SAF_CREATE = 6001;
    public static final int REQ_SAF_OPEN = 6002;
    public static final int REQ_SHARE_CHOOSER = 6003;

    public static final AtomicInteger PAUSE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger STOP_COUNT = new AtomicInteger(0);
    public static final AtomicInteger RESUME_COUNT = new AtomicInteger(0);
    public static final AtomicInteger DESTROY_COUNT = new AtomicInteger(0);

    private final KanataM6LifecycleController lifecycleController = new KanataM6LifecycleController();
    private final AtomicReference<Uri> lastResultUri = new AtomicReference<>();
    private final AtomicInteger lastResultCode = new AtomicInteger(Activity.RESULT_CANCELED);
    private final AtomicInteger lastResultFlags = new AtomicInteger(0);
    private volatile CountDownLatch pendingResultLatch;

    public static void resetLifecycleCounters() {
        PAUSE_COUNT.set(0);
        STOP_COUNT.set(0);
        RESUME_COUNT.set(0);
        DESTROY_COUNT.set(0);
    }

    public KanataM6LifecycleController getLifecycleController() {
        return lifecycleController;
    }

    public CountDownLatch prepareForActivityResult(int requestCode, Intent intent) {
        lastResultUri.set(null);
        lastResultCode.set(Activity.RESULT_CANCELED);
        CountDownLatch latch = new CountDownLatch(1);
        pendingResultLatch = latch;
        startActivityForResult(intent, requestCode);
        return latch;
    }

    public Uri awaitResultUri(CountDownLatch latch, long timeoutMs) throws InterruptedException {
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            return null;
        }
        return lastResultCode.get() == Activity.RESULT_OK ? lastResultUri.get() : null;
    }

    public Uri getLastResultUriIfOk() {
        return lastResultCode.get() == Activity.RESULT_OK ? lastResultUri.get() : null;
    }

    public int getLastResultFlags() {
        return lastResultFlags.get();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(KanataSqlitePlugin.class);
        registerPlugin(KanataRuntimeCapabilityPlugin.class);
        registerPlugin(KanataM6SyntheticPortablePlugin.class);
        registerPlugin(KanataM6RestoreBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SAF_CREATE || requestCode == REQ_SAF_OPEN || requestCode == REQ_SHARE_CHOOSER) {
            lastResultCode.set(resultCode);
            lastResultUri.set(data != null ? data.getData() : null);
            lastResultFlags.set(data != null ? data.getFlags() : 0);
            CountDownLatch latch = pendingResultLatch;
            if (latch != null) latch.countDown();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        RESUME_COUNT.incrementAndGet();
    }

    @Override
    public void onPause() {
        PAUSE_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        super.onPause();
    }

    @Override
    public void onStop() {
        STOP_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        super.onStop();
    }

    @Override
    public void onDestroy() {
        DESTROY_COUNT.incrementAndGet();
        lifecycleController.onHostBackgroundOrDestroy();
        super.onDestroy();
    }
}
