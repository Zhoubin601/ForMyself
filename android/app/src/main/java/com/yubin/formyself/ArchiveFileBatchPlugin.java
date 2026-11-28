package com.yubin.formyself;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ArchiveFileBatch")
public class ArchiveFileBatchPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    @PluginMethod public void execute(PluginCall call) {
        try {
            executor.execute(() -> {
                try {
                    org.json.JSONArray ops = call.getArray("operations");
                    boolean hasMutation = false;
                    if (ops != null) {
                        for (int i = 0; i < ops.length(); i++) {
                            String op = ops.optJSONObject(i) != null ? ops.optJSONObject(i).optString("operation", "") : "";
                            if ("write".equals(op) || "delete".equals(op)) { hasMutation = true; break; }
                        }
                    }
                    JSObject result = new JSObject();
                    if (hasMutation) {
                        org.json.JSONArray executed = KanataDurableTxControl.executeOrdinaryWriteUnderFence(
                                getContext(),
                                KanataDurableTxControl.effectiveControlRoot(getContext()),
                                false,
                                () -> ArchiveFileBatchStore.execute(getContext().getFilesDir(), ops));
                        result.put("results", executed);
                    } else {
                        result.put("results", ArchiveFileBatchStore.execute(getContext().getFilesDir(), ops));
                    }
                    call.resolve(result);
                } catch (Exception ignored) { call.reject("ARCHIVE_FILE_BATCH_FAILED", "ARCHIVE_FILE_BATCH_FAILED"); }
            });
        } catch (Exception ignored) { call.reject("ARCHIVE_FILE_BATCH_FAILED", "ARCHIVE_FILE_BATCH_FAILED"); }
    }
    @Override protected void handleOnDestroy() {
        executor.shutdown(); // settle already accepted ciphertext I/O; never interrupt a file write
        super.handleOnDestroy();
    }
}
