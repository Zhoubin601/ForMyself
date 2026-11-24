package com.yubin.formyself;

import android.os.CancellationSignal;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Isolated synthetic-only Capacitor plugin used by N-03 / N-04 tests to execute real
 * Scheme C exports behind opaque Native handles while proving JS <-> Native bridge
 * messages carry only small control commands, handles, and real progress metadata.
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
    public static final AtomicInteger REJECTED_STALE_OR_DUPLICATE_CALLS = new AtomicInteger(0);

    private static final class RegisteredSource {
        final String dbPath;
        final byte[] rawKey;
        final String password;
        final File spoolDir;
        final File targetDir;

        RegisteredSource(String dbPath, byte[] rawKey, String password, File spoolDir, File targetDir) {
            this.dbPath = dbPath;
            this.rawKey = rawKey.clone();
            this.password = password;
            this.spoolDir = spoolDir;
            this.targetDir = targetDir;
        }

        void zeroize() {
            Arrays.fill(rawKey, (byte) 0);
        }
    }

    public static final class ExportJob {
        public final String handle;
        public final File targetFile;
        public final AtomicBoolean cancelled = new AtomicBoolean(false);
        public final CancellationSignal cancelSignal = new CancellationSignal();
        public final AtomicBoolean cancelRequested = new AtomicBoolean(false);
        public final AtomicInteger tablesDone = new AtomicInteger(0);
        public final AtomicInteger dataFramesObserved = new AtomicInteger(0);
        public volatile String state = "RUNNING";
        public volatile boolean verifiedReadback = false;
        public volatile long finalFileBytes = 0L;
        public volatile String packageSha256Hex = "";
        public volatile String errorCode = "";
        public volatile boolean expired = false;

        ExportJob(String handle, File targetFile) {
            this.handle = handle;
            this.targetFile = targetFile;
        }
    }

    private static final ConcurrentHashMap<String, RegisteredSource> SOURCES = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, ExportJob> JOBS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, String> REQUEST_IDS = new ConcurrentHashMap<>();
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    public static void registerSyntheticSource(
            String sourceId,
            String dbPath,
            byte[] rawSqlCipherKey,
            String password,
            File spoolDir,
            File targetDir) {
        RegisteredSource prev = SOURCES.put(sourceId,
                new RegisteredSource(dbPath, rawSqlCipherKey, password, spoolDir, targetDir));
        if (prev != null) prev.zeroize();
    }

    public static ExportJob getJob(String handle) {
        return JOBS.get(handle);
    }

    public static void expireHandle(String handle) {
        ExportJob job = JOBS.get(handle);
        if (job != null) job.expired = true;
    }

    public static void resetMetricsAndJobs() {
        OBSERVED_REQUEST_BYTES.clear();
        OBSERVED_RESPONSE_BYTES.clear();
        MAX_OBSERVED_BRIDGE_BYTES.set(0);
        REJECTED_OVERSIZE_BRIDGE_CALLS.set(0);
        REJECTED_STALE_OR_DUPLICATE_CALLS.set(0);
        for (ExportJob job : JOBS.values()) {
            job.cancelled.set(true);
            job.cancelSignal.cancel();
            job.expired = true;
        }
        JOBS.clear();
        REQUEST_IDS.clear();
        for (RegisteredSource src : SOURCES.values()) {
            src.zeroize();
        }
        SOURCES.clear();
    }

    private static void recordSize(List<Integer> list, int bytes) {
        list.add(bytes);
        long prev;
        do {
            prev = MAX_OBSERVED_BRIDGE_BYTES.get();
            if (bytes <= prev) break;
        } while (!MAX_OBSERVED_BRIDGE_BYTES.compareAndSet(prev, bytes));
    }

    private void resolveSmall(PluginCall call, JSObject res) {
        int resBytes = res.toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_RESPONSE_BYTES, resBytes);
        call.resolve(res);
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

        String sourceId = call.getString("sourceId", "");
        String targetName = call.getString("targetName", "bridge-export.kpb1");
        String clientRequestId = call.getString("clientRequestId", "");
        int tableDelayMs = call.getInt("tableDelayMs", 0);

        RegisteredSource src = SOURCES.get(sourceId);
        if (src == null) {
            REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
            call.reject("UNKNOWN_SOURCE", "INVALID_HANDLE");
            return;
        }
        if (targetName.contains("/") || targetName.contains("..")) {
            call.reject("INVALID_TARGET_NAME", "INVALID_ARGUMENT");
            return;
        }
        String handle = "m6-job-" + UUID.randomUUID();
        if (!clientRequestId.isEmpty()) {
            String prev = REQUEST_IDS.putIfAbsent(clientRequestId, handle);
            if (prev != null) {
                REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
                call.reject("DUPLICATE_OPERATION", "DUPLICATE_REQUEST");
                return;
            }
        }

        File targetFile = new File(src.targetDir, targetName);
        ExportJob job = new ExportJob(handle, targetFile);
        JOBS.put(handle, job);

        EXECUTOR.submit(() -> {
            try {
                System.loadLibrary("sqlcipher");
                KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getContext());
                KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                        src.dbPath,
                        src.rawKey,
                        src.password,
                        catalog,
                        new KanataM6SnapshotOwner.WriteGate(),
                        src.spoolDir,
                        targetFile,
                        null,
                        job.cancelSignal,
                        job.cancelled,
                        new KanataM6SchemeCExporter.SpoolHooks() {
                            @Override
                            public void onFrameQueued(int inFlightFrames, int maxRowBytes) {
                                job.dataFramesObserved.incrementAndGet();
                            }

                            @Override
                            public void afterTableRead(int tableId, long rowCount) {
                                job.tablesDone.incrementAndGet();
                                if (tableDelayMs > 0 && !job.cancelled.get()) {
                                    try {
                                        Thread.sleep(tableDelayMs);
                                    } catch (InterruptedException ie) {
                                        job.cancelled.set(true);
                                    }
                                }
                            }
                        },
                        handle);
                job.finalFileBytes = em.finalFileBytes;
                job.packageSha256Hex = em.packageSha256Hex;
                job.dataFramesObserved.set(em.dataFrameCount);
                job.verifiedReadback = true;
                job.state = "COMPLETED";
            } catch (KanataM6PortableCrypto.PortableException pe) {
                job.errorCode = pe.code;
                if (KanataM6PortableCrypto.ERR_CANCELLED.equals(pe.code)) {
                    job.state = "CANCELLED";
                } else {
                    job.state = "FAILED";
                }
            } catch (Throwable t) {
                job.errorCode = t.getClass().getSimpleName();
                job.state = "FAILED";
            }
        });

        JSObject res = new JSObject()
                .put("handle", handle)
                .put("state", "RUNNING")
                .put("framesInFlightCap", 2)
                .put("rowBufferCapBytes", MAX_ROW_BODY_BYTES);
        resolveSmall(call, res);
    }

    @PluginMethod
    public void controlPollStatus(PluginCall call) {
        int reqBytes = call.getData().toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_REQUEST_BYTES, reqBytes);
        String handle = call.getString("handle", "");
        ExportJob job = JOBS.get(handle);
        if (job == null || job.expired) {
            REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
            call.reject("STALE_OR_UNKNOWN_HANDLE", "INVALID_HANDLE");
            return;
        }
        JSObject res = new JSObject()
                .put("handle", handle)
                .put("state", job.state)
                .put("tablesDone", job.tablesDone.get())
                .put("dataFrames", job.dataFramesObserved.get())
                .put("verifiedReadback", job.verifiedReadback)
                .put("finalFileBytes", job.finalFileBytes)
                .put("errorCode", job.errorCode);
        resolveSmall(call, res);
    }

    @PluginMethod
    public void controlCancelExport(PluginCall call) {
        int reqBytes = call.getData().toString().getBytes(StandardCharsets.UTF_8).length;
        recordSize(OBSERVED_REQUEST_BYTES, reqBytes);
        String handle = call.getString("handle", "");
        ExportJob job = JOBS.get(handle);
        if (job == null || job.expired) {
            REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
            call.reject("STALE_OR_UNKNOWN_HANDLE", "INVALID_HANDLE");
            return;
        }
        if ("COMPLETED".equals(job.state) || "FAILED".equals(job.state)) {
            REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
            call.reject("ALREADY_TERMINAL", "INVALID_STATE");
            return;
        }
        if (!job.cancelRequested.compareAndSet(false, true)) {
            REJECTED_STALE_OR_DUPLICATE_CALLS.incrementAndGet();
            call.reject("DUPLICATE_CANCEL", "DUPLICATE_REQUEST");
            return;
        }
        job.cancelled.set(true);
        job.cancelSignal.cancel();
        JSObject res = new JSObject()
                .put("handle", handle)
                .put("cancelAccepted", true)
                .put("state", job.state);
        resolveSmall(call, res);
    }
}
