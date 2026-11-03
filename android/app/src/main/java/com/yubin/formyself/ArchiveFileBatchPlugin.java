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
                    JSObject result = new JSObject();
                    result.put("results", ArchiveFileBatchStore.execute(getContext().getFilesDir(), call.getArray("operations")));
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
