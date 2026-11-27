package com.yubin.formyself;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Isolated synthetic-only Capacitor Bridge plugin (com.yubin.formyself.m2qa ONLY; NEVER compiled in ordinary APK).
 *
 * Connects the real SettingsBackup -> PortableRestoreRuntime -> PortableRestoreCoordinator ->
 * RestoreCoordinator JS path directly to Native KanataDurableTxControl (G-04),
 * KanataM6GenerationStore (F06/N-06), and KanataM6StagingRestoreEngine (SQLCipher 4.17.0).
 */
@CapacitorPlugin(name = "KanataM6RestoreBridge")
public final class KanataM6RestoreBridgePlugin extends Plugin {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final ConcurrentHashMap<String, AtomicBoolean> ACTIVE_STAGING_CANCELS = new ConcurrentHashMap<>();
    private static volatile File OVERRIDE_CONTROL_ROOT = null;

    public static void setTestControlRootOverride(File controlRoot) {
        OVERRIDE_CONTROL_ROOT = controlRoot;
    }

    private File controlRoot() {
        File ov = OVERRIDE_CONTROL_ROOT;
        return ov != null ? ov : KanataDurableTxControl.defaultControlRoot(getContext());
    }

    private boolean activated() {
        return BuildConfig.KANATA_M2_SYNTHETIC
                && "com.yubin.formyself.m2qa".equals(getContext().getPackageName());
    }

    private boolean requireActivated(PluginCall call) {
        if (!activated()) {
            scrubSecrets(call);
            call.reject("SQLITE_PLUGIN_NOT_ACTIVATED", "SQLITE_PLUGIN_NOT_ACTIVATED");
            return false;
        }
        return true;
    }

    private static void scrubSecrets(PluginCall call) {
        if (call == null || call.getData() == null) return;
        call.getData().remove("backupPassword");
        call.getData().remove("localMasterPassword");
    }

    private static String extractErrorCode(Throwable t) {
        if (t instanceof KanataDurableTxControl.TxControlException) {
            return ((KanataDurableTxControl.TxControlException) t).code;
        }
        if (t instanceof KanataM6PortableCrypto.PortableException) {
            return ((KanataM6PortableCrypto.PortableException) t).code;
        }
        String msg = t.getMessage();
        if (msg != null && msg.matches("[A-Z0-9_]{3,64}")) return msg;
        return "IO_FAILED";
    }

    @PluginMethod
    public void pickBackupDocument(PluginCall call) {
        if (!requireActivated(call)) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handlePickBackupResult");
    }

    @ActivityCallback
    private void handlePickBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("CANCELLED", "CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        JSObject out = new JSObject();
        out.put("uri", uri.toString());
        out.put("name", uri.getLastPathSegment() != null ? uri.getLastPathSegment() : "backup.kpb1");
        call.resolve(out);
    }

    @PluginMethod
    public void probeState(PluginCall call) {
        if (!requireActivated(call)) return;
        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                        getContext(), root,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                List<KanataM6StagingRestoreEngine.UnconfirmedEntry> unconfirmed =
                        KanataM6StagingRestoreEngine.inspectUnconfirmedTasks(new File(root, "unconfirmed-journals"));
                JSONArray uncArr = new JSONArray();
                for (KanataM6StagingRestoreEngine.UnconfirmedEntry e : unconfirmed) {
                    uncArr.put(unconfirmedEntryToJson(e));
                }
                JSONObject out = st.toJson();
                out.put("unconfirmed", uncArr);
                call.resolve(JSObject.fromJSONObject(out));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void stageBackup(PluginCall call) {
        if (!requireActivated(call)) return;
        final String sourceUriStr = call.getString("sourceUri", "");
        final String sourcePath = call.getString("sourcePath", "");
        final String backupPassword = call.getString("backupPassword", "");
        final String localMasterPassword = call.getString("localMasterPassword", "");
        final String ownerId = call.getString("ownerId", "ui-owner");
        final long sessionRevision = call.getData().optLong("sessionRevision", 0L);
        final long epoch = call.getData().optLong("epoch", 1L);
        final String taskId = call.getString("taskId", "m603-" + UUID.randomUUID().toString().substring(0, 12));
        final int batchSize = call.getInt("batchSize", KanataM6StagingRestoreEngine.DEFAULT_BATCH_SIZE);
        scrubSecrets(call);

        AtomicBoolean cancelFlag = new AtomicBoolean(false);
        ACTIVE_STAGING_CANCELS.put(taskId, cancelFlag);

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(getContext());
                Uri uri = (sourceUriStr != null && !sourceUriStr.isEmpty()) ? Uri.parse(sourceUriStr) : null;
                File file = (sourcePath != null && !sourcePath.isEmpty()) ? new File(sourcePath) : null;

                KanataM6GenerationStore.StagedGenerationResult staged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                        getContext(),
                        root,
                        uri,
                        file,
                        backupPassword,
                        localMasterPassword,
                        taskId,
                        ownerId,
                        sessionRevision,
                        epoch,
                        catalog,
                        batchSize,
                        cancelFlag,
                        new KanataM6StagingRestoreEngine.StagingHooks() {},
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

                JSONObject descriptor = new JSONObject()
                        .put("kind", "kanata-sqlite-generation-v1")
                        .put("generationId", staged.registration.generationId)
                        .put("taskId", taskId)
                        .put("absent", false)
                        .put("dbPath", KanataDurableTxControl.generationDbFile(root, staged.registration.generationId).getAbsolutePath())
                        .put("dbSha256Hex", staged.registration.dbSha256Hex)
                        .put("envelopePath", KanataDurableTxControl.generationEnvelopeFile(root, staged.registration.generationId).getAbsolutePath())
                        .put("envelopeSha256Hex", staged.registration.envelopeSha256Hex)
                        .put("stagingHandle", staged.stagingHandle)
                        .put("ownerId", ownerId)
                        .put("sessionRevision", sessionRevision)
                        .put("epoch", epoch)
                        .put("schemaVersion", 5)
                        .put("applicationId", 0x4b4e5441)
                        .put("schemaFingerprint", staged.registration.schemaFingerprint)
                        .put("datasetIdentity", staged.registration.datasetIdentity)
                        .put("totalBusinessRows", staged.registration.totalBusinessRows)
                        .put("tableCount", staged.registration.tableCount)
                        .put("transcriptHex", staged.artifact.transcriptHex)
                        .put("verified", true);

                JSONObject summary = new JSONObject()
                        .put("datasetIdentity", staged.artifact.datasetIdentity)
                        .put("worldCount", staged.artifact.worldCount)
                        .put("messageCount", staged.artifact.messageCount)
                        .put("totalBusinessRows", staged.artifact.metrics.totalBusinessRows)
                        .put("tableCount", staged.artifact.footerVerifiers.size())
                        .put("dekFingerprintHex", staged.dekFingerprintHex);

                JSONObject out = new JSONObject()
                        .put("stagingHandle", staged.stagingHandle)
                        .put("descriptor", descriptor)
                        .put("summary", summary)
                        .put("metrics", staged.artifact.metrics.toJson());
                call.resolve(JSObject.fromJSONObject(out));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            } finally {
                ACTIVE_STAGING_CANCELS.remove(taskId);
            }
        });
    }

    @PluginMethod
    public void cancelOrDestroyStaging(PluginCall call) {
        if (!requireActivated(call)) return;
        final String taskId = call.getString("taskId", "");
        final String generationId = call.getString("generationId", "");
        final String stagingHandle = call.getString("stagingHandle", "");
        AtomicBoolean active = ACTIVE_STAGING_CANCELS.get(taskId);
        if (active != null) active.set(true);

        WORKER.execute(() -> {
            try {
                boolean removed = false;
                if (generationId != null && !generationId.isEmpty()) {
                    removed = KanataDurableTxControl.destroyUnreferencedGeneration(
                            getContext(), controlRoot(), generationId, stagingHandle,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                }
                JSObject out = new JSObject();
                out.put("cancelled", true);
                out.put("removed", removed);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void beginGateAndDrain(PluginCall call) {
        if (!requireActivated(call)) return;
        final String txnId = call.getString("txnId", "txn-" + UUID.randomUUID().toString().substring(0, 12));
        final String ownerId = call.getString("ownerId", "ui-owner");
        final long epoch = call.getData().optLong("epoch", 1L);
        final long expectedSeq = call.getData().optLong("expectedSeq", 0L);
        final String expectedDigest = call.getString("expectedDigest", "");
        final String inputDigest = call.getString("inputDigest", "");

        WORKER.execute(() -> {
            try {
                // Deterministically revoke and drain all active KanataSqlitePlugin workers (no sleep polling!)
                KanataSqlitePlugin.drainAndRevokeAllInstances();
                File root = controlRoot();
                KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                        getContext(), root,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                KanataDurableTxControl.GenerationRegistration curPrev = st.headRecord != null
                        ? st.headRecord.previousGeneration : null;
                String activeGenId = st.headRecord != null ? st.headRecord.activeGenerationId : "";
                if (st.headRecord != null && !activeGenId.isEmpty()
                        && (curPrev == null || !activeGenId.equals(curPrev.generationId))) {
                    File db = KanataDurableTxControl.generationDbFile(root, activeGenId);
                    File env = KanataDurableTxControl.generationEnvelopeFile(root, activeGenId);
                    curPrev = new KanataDurableTxControl.GenerationRegistration(
                            activeGenId, false, "generations/" + activeGenId,
                            KanataDurableTxControl.sha256FileHex(db),
                            KanataDurableTxControl.sha256FileHex(env),
                            "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a",
                            "sqlcipher-4.17.0", "ForMyself/Kanata/KEK/v1",
                            st.headRecord.targetGeneration != null && activeGenId.equals(st.headRecord.targetGeneration.generationId)
                                    ? st.headRecord.targetGeneration.datasetIdentity : "active",
                            0L, 50);
                }

                KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                        getContext(), root, txnId, ownerId, epoch, expectedSeq, expectedDigest,
                        KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                        false, "", curPrev, null, activeGenId, inputDigest, "", "gate-drained",
                        "kanata-portable-restore", "kanata-portable-v1",
                        Arrays.asList("kanata", "todo", "settings", "vault"),
                        false, 0L,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                call.resolve(JSObject.fromJSONObject(gated.toSummaryJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void prepareTransaction(PluginCall call) {
        if (!requireActivated(call)) return;
        final String txnId = call.getString("txnId", "");
        final String ownerId = call.getString("ownerId", "");
        final long epoch = call.getData().optLong("epoch", 0L);
        final long expectedSeq = call.getData().optLong("expectedSeq", 0L);
        final String expectedDigest = call.getString("expectedDigest", "");
        final String stagingHandle = call.getString("stagingHandle", "");
        final long sessionRevision = call.getData().optLong("sessionRevision", 0L);
        final long stagingEpoch = call.getData().optLong("stagingEpoch", epoch);
        final String participantPayload = call.getString("participantPayloadJson", "{}");
        scrubSecrets(call);

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                // Verify Native HMAC-authenticated staging registration (rejects forged external descriptors!)
                JSONObject regCan = KanataDurableTxControl.verifyStagingRegistration(
                        getContext(), root, stagingHandle, ownerId, sessionRevision, stagingEpoch,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                KanataDurableTxControl.GenerationRegistration targetGen =
                        KanataDurableTxControl.GenerationRegistration.fromJson(regCan.getJSONObject("generation"));
                String inputDigest = regCan.optString("inputDigest", "");

                KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                        getContext(), root,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                KanataDurableTxControl.GenerationRegistration prevGen = st.headRecord.previousGeneration != null
                        ? st.headRecord.previousGeneration
                        : KanataDurableTxControl.GenerationRegistration.absentGeneration("gen-prev-absent");

                // Persist encrypted sensitive recovery payload under independent AndroidKeyStore AES-256-GCM key.
                String payloadId = KanataDurableTxControl.writeEncryptedPayload(
                        getContext(), root, txnId, "recovery-state", targetGen.generationId,
                        participantPayload.getBytes(StandardCharsets.UTF_8),
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);

                KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                        getContext(), root, txnId, ownerId, epoch, expectedSeq, expectedDigest,
                        KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                        false, "", prevGen, targetGen, st.headRecord.activeGenerationId,
                        inputDigest, payloadId, "prepared-durable",
                        "kanata-portable-restore", "kanata-portable-v1",
                        st.headRecord.participants, false, 0L,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                call.resolve(JSObject.fromJSONObject(prepared.toSummaryJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void authenticateAndIssueCapability(PluginCall call) {
        if (!requireActivated(call)) return;
        final String localMasterPassword = call.getString("localMasterPassword", "");
        final String txnId = call.getString("txnId", "");
        final String participantId = call.getString("participantId", "kanata");
        final String operation = call.getString("operation", KanataDurableTxControl.OP_COMMIT_DECISION);
        final String generationId = call.getString("generationId", "");
        final String ownerId = call.getString("ownerId", "");
        final long epoch = call.getData().optLong("epoch", 0L);
        scrubSecrets(call);

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                // Recovery-dedicated authentication bypassing damaged Vault, legacy Kanata, and Settings!
                if (!KanataM6GenerationStore.verifyRecoveryPassword(root, localMasterPassword)) {
                    call.reject("AUTH_FAILED", "AUTH_FAILED");
                    return;
                }
                KanataDurableTxControl.RecoveryCapability cap = KanataDurableTxControl.issueRecoveryCapability(
                        getContext(), root, txnId, participantId, operation, generationId,
                        ownerId, epoch, KanataDurableTxControl.DEFAULT_CAPABILITY_TTL_MS,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                call.resolve(JSObject.fromJSONObject(cap.toJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void commitDecision(PluginCall call) {
        if (!requireActivated(call)) return;
        final String txnId = call.getString("txnId", "");
        final String ownerId = call.getString("ownerId", "");
        final long epoch = call.getData().optLong("epoch", 0L);
        final long expectedSeq = call.getData().optLong("expectedSeq", 0L);
        final String expectedDigest = call.getString("expectedDigest", "");
        final String preparedDigest = call.getString("preparedDigest", "");
        final String direction = call.getString("direction", "");
        final JSONObject capObj = call.getObject("capability");

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataDurableTxControl.RecoveryCapability cap = KanataDurableTxControl.RecoveryCapability.fromJson(capObj);
                try (KanataDurableTxControl.StableControlLock ignored = KanataDurableTxControl.acquireControlLock(root)) {
                    KanataDurableTxControl.verifyRecoveryCapabilityLocked(
                            getContext(), root, cap, "kanata", KanataDurableTxControl.OP_COMMIT_DECISION,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                }
                KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                        getContext(), root,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                KanataDurableTxControl.GenerationRegistration chosen = KanataDurableTxControl.DIR_TARGET.equals(direction)
                        ? st.headRecord.targetGeneration : st.headRecord.previousGeneration;
                String activeGen = (chosen != null && !chosen.absent) ? chosen.generationId : "";
                KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                        getContext(), root, txnId, ownerId, epoch, expectedSeq, expectedDigest,
                        KanataDurableTxControl.STATE_DECISION, direction,
                        false, preparedDigest, st.headRecord.previousGeneration, st.headRecord.targetGeneration,
                        activeGen, st.headRecord.inputDigest, st.headRecord.payloadId, "decided-" + direction,
                        st.headRecord.kind, st.headRecord.scope, st.headRecord.participants,
                        false, 0L,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                call.resolve(JSObject.fromJSONObject(decided.toSummaryJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void verifyAndApplyGeneration(PluginCall call) {
        if (!requireActivated(call)) return;
        final String localMasterPassword = call.getString("localMasterPassword", "");
        final JSONObject capObj = call.getObject("capability");
        scrubSecrets(call);

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataDurableTxControl.RecoveryCapability cap = KanataDurableTxControl.RecoveryCapability.fromJson(capObj);
                KanataDurableTxControl.ControlRecord cur;
                try (KanataDurableTxControl.StableControlLock ignored = KanataDurableTxControl.acquireControlLock(root)) {
                    cur = KanataDurableTxControl.verifyRecoveryCapabilityLocked(
                            getContext(), root, cap, "kanata", KanataDurableTxControl.OP_APPLY_GENERATION,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                }
                KanataDurableTxControl.GenerationRegistration chosen = KanataDurableTxControl.DIR_TARGET.equals(cur.decisionDirection)
                        ? cur.targetGeneration : cur.previousGeneration;
                if (chosen == null || chosen.absent) {
                    call.resolve(new JSObject().put("absent", true).put("verified", true));
                    return;
                }
                KanataM6GenerationStore.ActiveGenerationHealth health =
                        KanataM6GenerationStore.openAndVerifyGeneration(root, chosen.generationId, localMasterPassword);
                call.resolve(JSObject.fromJSONObject(health.toJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void finalizeTransaction(PluginCall call) {
        if (!requireActivated(call)) return;
        final String txnId = call.getString("txnId", "");
        final String ownerId = call.getString("ownerId", "");
        final long epoch = call.getData().optLong("epoch", 0L);
        final long expectedSeq = call.getData().optLong("expectedSeq", 0L);
        final String expectedDigest = call.getString("expectedDigest", "");
        final String preparedDigest = call.getString("preparedDigest", "");
        final boolean gcRetired = Boolean.TRUE.equals(call.getBoolean("gcRetired", true));
        final JSONObject capObj = call.getObject("capability");

        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataDurableTxControl.RecoveryCapability cap = KanataDurableTxControl.RecoveryCapability.fromJson(capObj);
                KanataDurableTxControl.ControlRecord cur;
                try (KanataDurableTxControl.StableControlLock ignored = KanataDurableTxControl.acquireControlLock(root)) {
                    cur = KanataDurableTxControl.verifyRecoveryCapabilityLocked(
                            getContext(), root, cap, "kanata", KanataDurableTxControl.OP_FINALIZE,
                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                }
                KanataDurableTxControl.ControlRecord fin = KanataDurableTxControl.compareAndSetTransition(
                        getContext(), root, txnId, ownerId, epoch, expectedSeq, expectedDigest,
                        KanataDurableTxControl.STATE_FINALIZED, cur.decisionDirection,
                        false, preparedDigest, cur.previousGeneration, cur.targetGeneration,
                        cur.activeGenerationId, cur.inputDigest, cur.payloadId, "finalized",
                        cur.kind, cur.scope, cur.participants, false, 0L,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);

                // F04: Separate GC cleanup outcome from FINALIZED commit success!
                String cleanupError = "";
                if (gcRetired) {
                    KanataDurableTxControl.GenerationRegistration retired =
                            KanataDurableTxControl.DIR_TARGET.equals(fin.decisionDirection)
                                    ? fin.previousGeneration : fin.targetGeneration;
                    if (retired != null && !retired.absent && !retired.generationId.equals(fin.activeGenerationId)) {
                        try {
                            KanataDurableTxControl.destroyUnreferencedGeneration(
                                    getContext(), root, retired.generationId, null,
                                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                        } catch (Exception gcErr) {
                            cleanupError = extractErrorCode(gcErr);
                        }
                    }
                }
                JSONObject out = fin.toSummaryJson();
                out.put("finalized", true);
                out.put("cleanupError", cleanupError);
                call.resolve(JSObject.fromJSONObject(out));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    /**
     * Authoritative cold-start recovery entry point (F02 / G-04 / B-01).
     * Authenticates local master password directly against recovery verifier (bypassing damaged Vault,
     * legacy Kanata, and Settings), inspects authoritative head, and deterministically converges:
     * - GATE -> PREPARED(abortOnly) -> DECISION(previous) -> verify -> FINALIZED
     * - PREPARED -> DECISION(previous) -> verify -> FINALIZED
     * - DECISION(previous|target) -> verify/replay same irreversible direction -> FINALIZED
     * - FINALIZED -> no-op READY
     * - Corrupt / missing head / missing key / unknown version / legacy conflict -> stays BLOCKED!
     */
    @PluginMethod
    public void recoverAuthoritative(PluginCall call) {
        if (!requireActivated(call)) return;
        final String localMasterPassword = call.getString("localMasterPassword", "");
        final String ownerId = call.getString("ownerId", "cold-start-recovery");
        scrubSecrets(call);

        WORKER.execute(() -> {
            try {
                JSONObject result = executeAuthoritativeColdStartRecovery(
                        getContext(), controlRoot(), localMasterPassword, ownerId,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                call.resolve(JSObject.fromJSONObject(result));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    /** Reusable product recovery convergence called by both Capacitor Bridge and real Android cold-start tests. */
    public static JSONObject executeAuthoritativeColdStartRecovery(
            Context context,
            File controlRoot,
            String localMasterPassword,
            String recoveryOwnerId,
            KanataDurableTxControl.KeyBackend keyBackend) throws Exception {
        KanataDurableTxControl.KeyBackend kb = keyBackend != null
                ? keyBackend : KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE;

        // 1) Probe authoritative head first.
        KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                context, controlRoot, kb, KanataDurableTxControl.FaultInjector.NONE);

        if (!st.initialized || st.headRecord == null || "BLOCKED_CORRUPT_OR_UNKNOWN".equals(st.recoveryAction)
                || "BLOCKED_LEGACY_CONFLICT".equals(st.recoveryAction)
                || "BLOCKED_LEGACY_PENDING".equals(st.recoveryAction)) {
            throw new KanataDurableTxControl.TxControlException(st.reasonCode,
                    "Authoritative control state cannot auto-converge: " + st.recoveryAction);
        }

        if ("READY".equals(st.recoveryAction)) {
            JSONObject out = st.toJson();
            out.put("recovered", true);
            out.put("convergedDirection", "none");
            return out;
        }

        // 2) Recovery-dedicated authentication bypassing Vault / legacy Kanata / Settings (B-01).
        if (!KanataM6GenerationStore.verifyRecoveryPassword(controlRoot, localMasterPassword)) {
            throw new KanataDurableTxControl.TxControlException("AUTH_FAILED",
                    "Recovery password verification failed");
        }

        // 3) Drain all active SQLite workers deterministically before taking over.
        KanataSqlitePlugin.drainAndRevokeAllInstances();

        KanataDurableTxControl.ControlRecord cur = st.headRecord;
        long takeoverEpoch = cur.epoch + 1L;

        // 4) GATE -> PREPARED(abortOnly=true) -> DECISION(previous)
        if (KanataDurableTxControl.STATE_GATE.equals(cur.state)) {
            KanataDurableTxControl.GenerationRegistration prevGen = cur.previousGeneration != null
                    ? cur.previousGeneration
                    : KanataDurableTxControl.GenerationRegistration.absentGeneration("gen-prev-absent");
            cur = KanataDurableTxControl.compareAndSetTransition(
                    context, controlRoot, cur.txnId, recoveryOwnerId, cur.epoch,
                    cur.sequence, cur.recordDigest,
                    KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                    true, "", prevGen, null, cur.activeGenerationId,
                    cur.inputDigest, cur.payloadId, "recovery-abort-gate",
                    cur.kind, cur.scope, cur.participants, true, takeoverEpoch,
                    kb, KanataDurableTxControl.FaultInjector.NONE);
        }

        // 5) PREPARED (undecided) -> DECISION(previous)
        if (KanataDurableTxControl.STATE_PREPARED.equals(cur.state)) {
            boolean needTakeover = !recoveryOwnerId.equals(cur.ownerId);
            long nextEpoch = needTakeover ? cur.epoch + 1L : cur.epoch;
            String prevActive = (cur.previousGeneration != null && !cur.previousGeneration.absent)
                    ? cur.previousGeneration.generationId : "";
            cur = KanataDurableTxControl.compareAndSetTransition(
                    context, controlRoot, cur.txnId, recoveryOwnerId, cur.epoch,
                    cur.sequence, cur.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_PREVIOUS,
                    cur.abortOnly, cur.preparedDigest, cur.previousGeneration, cur.targetGeneration,
                    prevActive, cur.inputDigest, cur.payloadId, "recovery-decided-previous",
                    cur.kind, cur.scope, cur.participants, needTakeover, nextEpoch,
                    kb, KanataDurableTxControl.FaultInjector.NONE);
        }

        // 6) DECISION(previous | target): irreversible direction! Take over epoch if needed, issue Native capability, verify generation, FINALIZED.
        if (KanataDurableTxControl.STATE_DECISION.equals(cur.state)) {
            if (!recoveryOwnerId.equals(cur.ownerId)) {
                cur = KanataDurableTxControl.compareAndSetTransition(
                        context, controlRoot, cur.txnId, recoveryOwnerId, cur.epoch,
                        cur.sequence, cur.recordDigest,
                        KanataDurableTxControl.STATE_DECISION, cur.decisionDirection,
                        cur.abortOnly, cur.preparedDigest, cur.previousGeneration, cur.targetGeneration,
                        cur.activeGenerationId, cur.inputDigest, cur.payloadId, "recovery-owner-takeover",
                        cur.kind, cur.scope, cur.participants, true, cur.epoch + 1L,
                        kb, KanataDurableTxControl.FaultInjector.NONE);
            }

            KanataDurableTxControl.GenerationRegistration chosen =
                    KanataDurableTxControl.DIR_TARGET.equals(cur.decisionDirection)
                            ? cur.targetGeneration : cur.previousGeneration;
            String chosenGenId = (chosen != null && !chosen.absent) ? chosen.generationId : "";

            // Issue & verify genuine Native capability before touching/verifying the chosen generation
            KanataDurableTxControl.RecoveryCapability applyCap = KanataDurableTxControl.issueRecoveryCapability(
                    context, controlRoot, cur.txnId, "kanata", KanataDurableTxControl.OP_APPLY_GENERATION,
                    chosenGenId, cur.ownerId, cur.epoch, KanataDurableTxControl.DEFAULT_CAPABILITY_TTL_MS, kb);
            try (KanataDurableTxControl.StableControlLock ignored = KanataDurableTxControl.acquireControlLock(controlRoot)) {
                KanataDurableTxControl.verifyRecoveryCapabilityLocked(
                        context, controlRoot, applyCap, "kanata", KanataDurableTxControl.OP_APPLY_GENERATION, kb);
            }

            KanataM6GenerationStore.ActiveGenerationHealth health = null;
            if (!chosenGenId.isEmpty()) {
                health = KanataM6GenerationStore.openAndVerifyGeneration(
                        controlRoot, chosenGenId, localMasterPassword);
            }

            KanataDurableTxControl.RecoveryCapability finCap = KanataDurableTxControl.issueRecoveryCapability(
                    context, controlRoot, cur.txnId, "kanata", KanataDurableTxControl.OP_FINALIZE,
                    chosenGenId, cur.ownerId, cur.epoch, KanataDurableTxControl.DEFAULT_CAPABILITY_TTL_MS, kb);
            try (KanataDurableTxControl.StableControlLock ignored = KanataDurableTxControl.acquireControlLock(controlRoot)) {
                KanataDurableTxControl.verifyRecoveryCapabilityLocked(
                        context, controlRoot, finCap, "kanata", KanataDurableTxControl.OP_FINALIZE, kb);
            }

            cur = KanataDurableTxControl.compareAndSetTransition(
                    context, controlRoot, cur.txnId, cur.ownerId, cur.epoch,
                    cur.sequence, cur.recordDigest,
                    KanataDurableTxControl.STATE_FINALIZED, cur.decisionDirection,
                    cur.abortOnly, cur.preparedDigest, cur.previousGeneration, cur.targetGeneration,
                    chosenGenId, cur.inputDigest, cur.payloadId, "recovery-finalized",
                    cur.kind, cur.scope, cur.participants, false, 0L,
                    kb, KanataDurableTxControl.FaultInjector.NONE);

            // Safe post-FINALIZED GC of unreferenced non-active generation
            KanataDurableTxControl.GenerationRegistration retired =
                    KanataDurableTxControl.DIR_TARGET.equals(cur.decisionDirection)
                            ? cur.previousGeneration : cur.targetGeneration;
            String cleanupError = "";
            if (retired != null && !retired.absent && !retired.generationId.equals(cur.activeGenerationId)) {
                try {
                    KanataDurableTxControl.destroyUnreferencedGeneration(
                            context, controlRoot, retired.generationId, null, kb);
                } catch (Exception gcErr) {
                    cleanupError = extractErrorCode(gcErr);
                }
            }

            JSONObject out = cur.toSummaryJson();
            out.put("recovered", true);
            out.put("blocked", false);
            out.put("convergedDirection", cur.decisionDirection);
            out.put("cleanupError", cleanupError);
            if (health != null) {
                out.put("activeHealth", health.toJson());
            }
            return out;
        }

        throw new KanataDurableTxControl.TxControlException("TX_CONTROL_UNKNOWN_STATE",
                "Unexpected recovery state: " + cur.state);
    }

    @PluginMethod
    public void openActiveGenerationHealth(PluginCall call) {
        if (!requireActivated(call)) return;
        final String localMasterPassword = call.getString("localMasterPassword", "");
        scrubSecrets(call);
        WORKER.execute(() -> {
            try {
                KanataM6GenerationStore.ActiveGenerationHealth health =
                        KanataM6GenerationStore.openAuthoritativeActiveGeneration(
                                getContext(), controlRoot(), localMasterPassword,
                                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                call.resolve(JSObject.fromJSONObject(health.toJson()));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void reverifyUnconfirmed(PluginCall call) {
        if (!requireActivated(call)) return;
        final String taskId = call.getString("taskId", "");
        WORKER.execute(() -> {
            try {
                File journalDir = new File(controlRoot(), "unconfirmed-journals");
                KanataM6StagingRestoreEngine.ManualActionResult res =
                        KanataM6StagingRestoreEngine.reverifyUnconfirmedTask(taskId, journalDir);
                call.resolve(JSObject.fromJSONObject(manualResultToJson(res)));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    @PluginMethod
    public void manualCleanupUnconfirmed(PluginCall call) {
        if (!requireActivated(call)) return;
        final String taskId = call.getString("taskId", "");
        final boolean confirmed = Boolean.TRUE.equals(call.getBoolean("confirmed", false));
        WORKER.execute(() -> {
            try {
                File root = controlRoot();
                KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                        getContext(), root,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                boolean pendingRestore = st.blocked;
                File journalDir = new File(root, "unconfirmed-journals");
                KanataM6StagingRestoreEngine.ManualActionResult res =
                        KanataM6StagingRestoreEngine.manualSafeCleanupUnconfirmedTask(
                                taskId, confirmed, pendingRestore, journalDir);
                call.resolve(JSObject.fromJSONObject(manualResultToJson(res)));
            } catch (Exception e) {
                call.reject(e.getMessage(), extractErrorCode(e));
            }
        });
    }

    private static JSONObject unconfirmedEntryToJson(KanataM6StagingRestoreEngine.UnconfirmedEntry e) throws Exception {
        return new JSONObject()
                .put("taskId", e.taskId)
                .put("kind", e.kind)
                .put("state", e.state)
                .put("journalPath", e.journalPath)
                .put("targetPath", e.targetPath)
                .put("expectedSha256Hex", e.expectedSha256Hex)
                .put("actualTargetSha256Hex", e.actualTargetSha256Hex)
                .put("targetExists", e.targetExists)
                .put("lockActive", e.lockActive)
                .put("shaMatches", e.shaMatches)
                .put("reason", e.reason);
    }

    private static JSONObject manualResultToJson(KanataM6StagingRestoreEngine.ManualActionResult r) throws Exception {
        return new JSONObject()
                .put("taskId", r.taskId)
                .put("resolved", r.resolved)
                .put("outcome", r.outcome)
                .put("reason", r.reason);
    }
}
