package com.yubin.formyself;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Standard non-configChanges Activity to verify real Android configuration-change / rotation recreate().
 */
public final class KanataM6RotationActivity extends Activity {
    public static final AtomicInteger CREATE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger PAUSE_COUNT = new AtomicInteger(0);
    public static final AtomicInteger STOP_COUNT = new AtomicInteger(0);
    public static final AtomicInteger DESTROY_COUNT = new AtomicInteger(0);
    public static final AtomicInteger RESUME_COUNT = new AtomicInteger(0);

    public static void resetCounters() {
        CREATE_COUNT.set(0);
        PAUSE_COUNT.set(0);
        STOP_COUNT.set(0);
        DESTROY_COUNT.set(0);
        RESUME_COUNT.set(0);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CREATE_COUNT.incrementAndGet();
        TextView tv = new TextView(this);
        tv.setText("Kanata M6 Rotation Lifecycle Host");
        setContentView(tv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        RESUME_COUNT.incrementAndGet();
    }

    @Override
    protected void onPause() {
        PAUSE_COUNT.incrementAndGet();
        super.onPause();
    }

    @Override
    protected void onStop() {
        STOP_COUNT.incrementAndGet();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        DESTROY_COUNT.incrementAndGet();
        super.onDestroy();
    }
}
