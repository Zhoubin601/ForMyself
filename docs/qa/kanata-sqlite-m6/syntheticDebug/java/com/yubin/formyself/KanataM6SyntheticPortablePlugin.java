package com.yubin.formyself;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Isolated synthetic-only Capacitor plugin used by N-03 / N-04 tests to prove that
 * JS <-> Native bridge messages carry only small control commands, handles, and progress metadata.
 */
@CapacitorPlugin(name = "KanataM6SyntheticPortable")
public final class KanataM6SyntheticPortablePlugin extends Plugin {
    public static final int MAX_BRIDGE_CONTROL_BYTES = 4096;
    public static final int MAX_ROW_BODY_BYTES = 4_194_304;

    public static final List<Integer> OBSERVED_REQUEST_BYTES =
            Collections.synchronizedList(new ArrayList<>());
    public static final List<Integer> OBSERVED_RESPONSE_BYTES =
            Collections.synchronizedList(new ArrayList<>());
    public static final AtomicLong MAX_OBSERVED_BRIDGE_BYTES = new AtomicLong(0);
    public static final AtomicInteger REJECTED_OVERSIZE_BRIDGE_CALLS = new AtomicInteger(0);

    public static void resetMetrics() {
        OBSERVED_REQUEST_BYTES.clear();
        OBSERVED_RESPONSE_BYTES.clear();
        MAX_OBSERVED_BRIDGE_BYTES.set(0);
        REJECTED_OVERSIZE_BRIDGE_CALLS.set(0);
    }

    private static void recordSize(List<Integer> list, int bytes) {
        list.add(bytes);
        long prev;
        do {
            prev = MAX_OBSERVED_BRIDGE_BYTES.get();
            if (bytes <= prev) break;
        } while (!MAX_OBSERVED_BRIDGE_BYTES.compareAndSet(prev, bytes));
    }

    @PluginMethod
    public void controlStartExport(PluginCall call) {
        String raw = call.getData().toString();
        int reqBytes = raw.getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_REQUEST_BYTES, reqBytes);
        if (reqBytes > MAX_BRIDGE_CONTROL_BYTES || call.getData().has("bulkRows") || call.getData().has("base64Db")) {
            REJECTED_OVERSIZE_BRIDGE_CALLS.incrementAndGet();
            call.reject("BRIDGE_PAYLOAD_TOO_LARGE", "RESOURCE_LIMIT");
            return;
        }
        JSObject res = new JSObject()
                .put("handle", "m6-spool-handle-1")
                .put("state", "RUNNING")
                .put("framesInFlightCap", 2)
                .put("rowBufferCapBytes", MAX_ROW_BODY_BYTES);
        int resBytes = res.toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_RESPONSE_BYTES, resBytes);
        call.resolve(res);
    }

    @PluginMethod
    public void controlPollStatus(PluginCall call) {
        int reqBytes = call.getData().toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_REQUEST_BYTES, reqBytes);
        JSObject res = new JSObject()
                .put("handle", call.getString("handle", ""))
                .put("state", "COMPLETED")
                .put("tablesDone", 45)
                .put("dataFrames", 16)
                .put("verifiedReadback", true);
        int resBytes = res.toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_RESPONSE_BYTES, resBytes);
        call.resolve(res);
    }
}
