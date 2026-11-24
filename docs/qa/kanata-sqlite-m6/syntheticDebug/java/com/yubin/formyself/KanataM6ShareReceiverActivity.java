package com.yubin.formyself;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Independent Share target Activity running in separate process (:m6sharerecv) to receive
 * real ACTION_SEND intents via Android system chooser, open EXTRA_STREAM URI, verify SHA-256,
 * and persist receiver telemetry for N-04 verification.
 */
public final class KanataM6ShareReceiverActivity extends Activity {
    public static final String REPORT_FILE_NAME = "m6_share_receiver_result.json";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText("Kanata Share Test Receiver");
        setContentView(tv);

        Intent intent = getIntent();
        JSONObject out = new JSONObject();
        try {
            out.put("receiverPid", Process.myPid());
            out.put("action", intent != null ? intent.getAction() : null);
            Uri streamUri = intent != null ? intent.getParcelableExtra(Intent.EXTRA_STREAM) : null;
            out.put("uri", streamUri != null ? streamUri.toString() : null);
            if (Intent.ACTION_SEND.equals(intent != null ? intent.getAction() : null) && streamUri != null) {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long totalBytes = 0L;
                try (InputStream in = getContentResolver().openInputStream(streamUri)) {
                    if (in == null) {
                        throw new IllegalStateException("openInputStream returned null");
                    }
                    byte[] buf = new byte[8192];
                    int r;
                    while ((r = in.read(buf)) != -1) {
                        md.update(buf, 0, r);
                        totalBytes += r;
                    }
                }
                out.put("ok", true);
                out.put("bytesRead", totalBytes);
                out.put("sha256", KanataM6PortableCrypto.bytesToHex(md.digest()));
            } else {
                out.put("ok", false);
                out.put("error", "missing-send-uri");
            }
        } catch (Throwable t) {
            try {
                out.put("ok", false);
                out.put("error", t.getClass().getSimpleName() + ":" + t.getMessage());
            } catch (Throwable ignored) {}
        }

        try {
            File reportFile = new File(getCacheDir(), REPORT_FILE_NAME);
            try (FileOutputStream fos = new FileOutputStream(reportFile)) {
                fos.write(out.toString().getBytes(StandardCharsets.UTF_8));
                fos.getFD().sync();
            }
        } catch (Throwable ignored) {}
        finish();
    }
}
