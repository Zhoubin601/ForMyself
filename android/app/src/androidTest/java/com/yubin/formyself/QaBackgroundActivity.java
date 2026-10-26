package com.yubin.formyself;

/** Separate test-APK task for real Android background/foreground lifecycle checks. */
public final class QaBackgroundActivity extends android.app.Activity {
    @Override protected void onCreate(android.os.Bundle state) {
        super.onCreate(state);
        android.widget.TextView label = new android.widget.TextView(this);
        label.setText("Synthetic background test Activity");
        setContentView(label);
    }
}
