package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * M6-03 Work Package E: Live Capacitor Bridge & WebView Runtime Capability Handshake Test.
 * - On modern WebView (>= 60, API 33/34): verifies real JS <-> Native handshake round-trip with nonce echo.
 * - On legacy WebView (< 55, e.g. API 24/25 stock WebView 52.0): verifies honest detection & blocking
 *   without ever claiming Native PASS equals Bridge PASS.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM603BridgeCapabilityTest {
    private static final String TAG = "KanataM603Bridge";

    @Test
    public void m603_bridge_liveCapabilityHandshakeOrHonestWebViewBlock() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSObject nativePre = KanataRuntimeCapabilityInspector.inspect(targetCtx, null);
        int api = nativePre.getInt("androidApi");
        int wvMajor = nativePre.getInt("webviewMajorVersion");
        String wvVersion = nativePre.getString("webviewVersion");

        String nonce = "m603-hs-" + UUID.randomUUID().toString().substring(0, 12);
        AtomicReference<String> jsResultRef = new AtomicReference<>(null);
        AtomicReference<String> nativeWithBridgeRef = new AtomicReference<>(null);

        try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
            long deadline = SystemClock.elapsedRealtime() + 15_000L;
            while (SystemClock.elapsedRealtime() < deadline) {
                CountDownLatch latch = new CountDownLatch(1);
                scenario.onActivity(act -> {
                    if (act.getBridge() != null) {
                        nativeWithBridgeRef.set(KanataRuntimeCapabilityInspector.inspect(act, act.getBridge()).toString());
                    }
                    WebView wv = act.getBridge() != null ? act.getBridge().getWebView() : null;
                    if (wv == null) {
                        latch.countDown();
                        return;
                    }
                    String script = "(function(){ "
                            + "window.__m603CapDone = false; window.__m603CapRes = ''; "
                            + "var cap = window.Capacitor; "
                            + "var hasPlugin = !!(cap && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('KanataRuntimeCapability')); "
                            + "var p = cap && cap.Plugins && cap.Plugins.KanataRuntimeCapability; "
                            + "if (!hasPlugin || !p || typeof p.handshake !== 'function') { "
                            + "  window.__m603CapRes = JSON.stringify({ available: false, reason: 'PLUGIN_MISSING' }); "
                            + "  window.__m603CapDone = true; return; "
                            + "} "
                            + "p.handshake({ nonce: '" + nonce + "' }).then(function(r){ "
                            + "  window.__m603CapRes = JSON.stringify({ available: true, handshake: r }); "
                            + "  window.__m603CapDone = true; "
                            + "}).catch(function(e){ "
                            + "  window.__m603CapRes = JSON.stringify({ available: false, reason: String(e && e.message || e) }); "
                            + "  window.__m603CapDone = true; "
                            + "}); "
                            + "})();";
                    wv.evaluateJavascript(script, v -> latch.countDown());
                });
                latch.await(5, TimeUnit.SECONDS);

                // Poll for async promise settlement
                long pollEnd = SystemClock.elapsedRealtime() + 4_000L;
                while (SystemClock.elapsedRealtime() < pollEnd && jsResultRef.get() == null) {
                    CountDownLatch pLatch = new CountDownLatch(1);
                    scenario.onActivity(act -> {
                        WebView wv = act.getBridge() != null ? act.getBridge().getWebView() : null;
                        if (wv == null) {
                            pLatch.countDown();
                            return;
                        }
                        wv.evaluateJavascript("(function(){ return window.__m603CapDone ? window.__m603CapRes : ''; })()", val -> {
                            if (val != null && !val.equals("null") && !val.equals("\"\"")) {
                                jsResultRef.set(val);
                            }
                            pLatch.countDown();
                        });
                    });
                    pLatch.await(3, TimeUnit.SECONDS);
                    if (jsResultRef.get() == null) Thread.sleep(150);
                }

                String raw = jsResultRef.get();
                if (raw != null) {
                    String unquoted = new JSONObject("{\"v\":" + raw + "}").getString("v");
                    JSONObject parsed = new JSONObject(unquoted);
                    if (parsed.optBoolean("available", false)) {
                        break;
                    }
                    // If WebView >= 60, Bridge may still be finishing init; retry briefly
                    if (wvMajor >= KanataRuntimeCapabilityInspector.CAPACITOR_DEFAULT_MIN_WEBVIEW) {
                        jsResultRef.set(null);
                        Thread.sleep(300);
                    } else {
                        break;
                    }
                } else {
                    Thread.sleep(200);
                }
            }
        }

        String raw = jsResultRef.get();
        JSONObject parsed = null;
        if (raw != null) {
            String unquoted = new JSONObject("{\"v\":" + raw + "}").getString("v");
            parsed = new JSONObject(unquoted);
        }

        JSONObject summary = new JSONObject()
                .put("androidApi", api)
                .put("webviewVersion", wvVersion)
                .put("webviewMajorVersion", wvMajor)
                .put("nativeInspect", nativeWithBridgeRef.get() != null ? new JSONObject(nativeWithBridgeRef.get()) : new JSONObject(nativePre.toString()))
                .put("jsBridgeResult", parsed != null ? parsed : JSONObject.NULL);
        Log.i(TAG, "M603_BRIDGE_CAPABILITY=" + summary);

        if (wvMajor >= KanataRuntimeCapabilityInspector.CAPACITOR_DEFAULT_MIN_WEBVIEW) {
            assertNotNull("Expected JS handshake result on modern WebView " + wvVersion, parsed);
            assertTrue("Expected Bridge handshake available on WebView " + wvVersion + ", got " + parsed,
                    parsed.optBoolean("available", false));
            JSONObject hs = parsed.getJSONObject("handshake");
            assertTrue(hs.getBoolean("ok"));
            assertTrue(hs.getBoolean("bridgeHandshakeOk"));
            assertEquals(nonce, hs.getString("nonce"));
            assertTrue(hs.getBoolean("sqlitePluginRegistered"));
            assertTrue(hs.getBoolean("sqlitePluginActivated"));
            assertTrue(hs.getBoolean("safAvailable"));
        } else {
            // Legacy WebView (< 60, e.g. WebView 52.0 on API 24/25): MUST NOT falsely claim Bridge available!
            assertFalse("Legacy WebView " + wvVersion + " must report webviewSupportedForBridge=false",
                    nativePre.getBoolean("webviewSupportedForBridge"));
            boolean jsClaimedAvailable = parsed != null && parsed.optBoolean("available", false);
            assertFalse("WebView " + wvVersion + " cannot initialize Capacitor 8 Bridge", jsClaimedAvailable);
        }
    }
}
