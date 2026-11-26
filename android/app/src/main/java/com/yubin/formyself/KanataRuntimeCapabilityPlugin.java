package com.yubin.formyself;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Read-only Capacitor plugin exposing verified Android runtime, WebView, plugin registration,
 * SAF availability, and live Bridge handshake verification.
 * Does NOT alter SQLite activation flags or access any user data.
 */
@CapacitorPlugin(name = "KanataRuntimeCapability")
public final class KanataRuntimeCapabilityPlugin extends Plugin {
    private static final int MAX_NONCE_LENGTH = 128;

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject info = KanataRuntimeCapabilityInspector.inspect(getContext(), getBridge());
        call.resolve(info);
    }

    @PluginMethod
    public void handshake(PluginCall call) {
        String nonce = call.getString("nonce", "");
        if (nonce == null || nonce.isEmpty() || nonce.length() > MAX_NONCE_LENGTH) {
            call.reject("INVALID_HANDSHAKE_NONCE", "INVALID_ARGUMENT");
            return;
        }
        JSObject info = KanataRuntimeCapabilityInspector.inspect(getContext(), getBridge());
        info.put("ok", true);
        info.put("nonce", nonce);
        info.put("bridgeHandshakeOk", true);
        info.put("timestampMs", System.currentTimeMillis());
        call.resolve(info);
    }
}
