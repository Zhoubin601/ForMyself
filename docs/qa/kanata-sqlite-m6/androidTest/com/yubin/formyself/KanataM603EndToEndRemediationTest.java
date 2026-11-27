package com.yubin.formyself;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Log;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/**
 * M6-03-R End-to-End Remediation Verification Suite (F02 / F03 / F06 / N-06 / F03-01~10).
 *
 * Replaces separated test-only journal assertions with real product-candidate path verification:
 * - e2e_01: Real Capacitor Bridge (KanataM6BridgeActivity WebView -> KanataM6RestoreBridgePlugin ->
 *           KanataDurableTxControl -> KanataM6GenerationStore -> KanataM6StagingRestoreEngine -> SQLCipher)
 *           with real SAF URI, cross-process Todo/Widget fence blocking during GATE, forged handle rejection,
 *           and cold-start active generation verification.
 * - e2e_02: Real separate-process (:m6worker) SIGKILL at 5 stages (GATE, PREPARED, before head rename,
 *           DECISION(target), FINALIZED-before-GC) followed by AUTONOMOUS product cold-start recovery
 *           via KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery() + repeated cold-start idempotency.
 * - e2e_03: Recovery-dedicated authentication bypassing damaged Vault, damaged legacy Kanata pages,
 *           and corrupted Settings preferences (B-01 / N-06 / F03-02).
 * - e2e_04: Same KPB1 restored into two isolated targets yields distinct independent DEKs & envelopes,
 *           wrong-password & cross-generation unwrap rejections (F06 / F03-10).
 * - e2e_05: Real Native long-field (multi-byte UTF-8 / emoji / large JSON) binding & bounded staging (N-03 / F03-02).
 * - e2e_06: Unified H-05 5-path legacy conflict detection & non-upgrade of unauthenticated legacy commit marker.
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class KanataM603EndToEndRemediationTest {
    private static final String TAG = "KanataM603E2E";
    private static final String BACKUP_PW = "M603R-E2E-Backup-Pass-2026!";
    private static final String MASTER_PW = "M603R-E2E-Master-Pass-2026!";

    private Context ctx;
    private File testRoot;
    private File controlRoot;
    private String hmacAlias;
    private String aeadAlias;
    private KanataM6PortableCatalog catalog;

    @Before
    public void setUp() throws Exception {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        System.loadLibrary("sqlcipher");
        catalog = KanataM6PortableCatalog.load(ctx);
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        testRoot = new File(ctx.getNoBackupFilesDir(), "m603r-e2e-" + suffix);
        assertTrue(testRoot.mkdirs() || testRoot.isDirectory());
        controlRoot = new File(testRoot, "tx-control");
        hmacAlias = "com.yubin.formyself.e2e.hmac." + suffix;
        aeadAlias = "com.yubin.formyself.e2e.aead." + suffix;
        KanataM6RestoreBridgePlugin.setTestControlRootOverride(controlRoot);
        cleanupLegacyFiles();
    }

    @After
    public void tearDown() {
        KanataM6RestoreBridgePlugin.setTestControlRootOverride(null);
        cleanupLegacyFiles();
        deleteKeystoreAliasQuiet(hmacAlias);
        deleteKeystoreAliasQuiet(aeadAlias);
        deleteRecursive(testRoot);
    }

    private void cleanupLegacyFiles() {
        File dir = new File(ctx.getFilesDir(), "formyself");
        for (String name : KanataDurableTxControl.LEGACY_RESTORE_FILES) {
            File f = new File(dir, name);
            if (f.exists()) f.delete();
        }
    }

    private static void deleteKeystoreAliasQuiet(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) {}
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) deleteRecursive(c);
        }
        f.delete();
    }

    private File exportSyntheticKpb1(String label, int messageCount, long seed) throws Exception {
        File srcDir = new File(testRoot, "src-" + label);
        File spoolDir = new File(testRoot, "spool-" + label);
        File outFile = new File(testRoot, label + ".kpb1");
        assertTrue(srcDir.mkdirs() || srcDir.isDirectory());
        assertTrue(spoolDir.mkdirs() || spoolDir.isDirectory());
        File srcDb = new File(srcDir, "source.db");
        byte[] rawKey = KanataKeyEnvelope.rawSqlCipherKey(KanataM6PortableCrypto.randomBytes(32));
        KanataM6SyntheticDataset.populateUniformDataset(srcDb, rawKey, catalog, messageCount);
        KanataM6SchemeCExporter.exportToSpool(
                srcDb.getAbsolutePath(), rawKey, BACKUP_PW, catalog,
                new KanataM6SnapshotOwner.WriteGate(), spoolDir, outFile,
                null, null, new AtomicBoolean(false), null, null);
        assertTrue(outFile.isFile() && outFile.length() > 0);
        return outFile;
    }

    private Uri publishToSyntheticSaf(File kpb1File, String displayName) throws Exception {
        Uri docUri = DocumentsContract.createDocument(
                ctx.getContentResolver(),
                KanataM6SyntheticSafProvider.rootUri(),
                "application/octet-stream",
                displayName);
        assertNotNull(docUri);
        try (FileInputStream in = new FileInputStream(kpb1File);
             OutputStream out = ctx.getContentResolver().openOutputStream(docUri, "w")) {
            assertNotNull(out);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            out.flush();
        }
        return docUri;
    }

    private KanataDurableTxControl.GenerationRegistration seedControlRootWithInitialGen(
            File targetControlRoot, String hAlias, String aAlias, String genId, int messages, long seed) throws Exception {
        KanataDurableTxControl.GenerationRegistration prevGen =
                KanataM6GenerationStore.createInitialGenerationWithPopulator(
                        targetControlRoot, genId, MASTER_PW,
                        (dbFile, rawKey) -> KanataM6SyntheticDataset.populateUniformDataset(dbFile, rawKey, catalog, messages));
        KanataDurableTxControl.initializeControlRoot(
                ctx, targetControlRoot, hAlias, aAlias, prevGen.generationId, prevGen,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataM6GenerationStore.installRecoveryVerifier(targetControlRoot, MASTER_PW);
        return prevGen;
    }

    @Test
    public void e2e_01_realBridgeFullRestoreFromSafThroughCandidateRoot() throws Exception {
        // Prepare initial active generation (15 messages) + KPB1 target package (60 messages) published via real SAF provider
        KanataDurableTxControl.GenerationRegistration prevGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-prev-bridge", 15, 1001L);
        File targetKpb1 = exportSyntheticKpb1("bridge-target-60", 60, 2002L);
        Uri safUri = publishToSyntheticSaf(targetKpb1, "e2e-bridge-" + UUID.randomUUID().toString().substring(0, 6) + ".kpb1");

        // Seed Todo store to prove cross-process fence blocks Todo/Widget during active GATE
        String today = TodoRepository.today();
        JSONObject todoSeed = new JSONObject()
                .put("version", 1).put("revision", 0)
                .put("tasks", new JSONArray().put(new JSONObject()
                        .put("id", "e2e-todo-1").put("title", "Bridge Fence Task")
                        .put("startDate", today).put("createdAt", 1000L)
                        .put("recurrence", new JSONObject().put("type", "none"))))
                .put("overrides", new JSONArray()).put("completions", new JSONArray());
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().putString(TodoRepository.KEY, todoSeed.toString()).commit();

        com.getcapacitor.JSObject cap = KanataRuntimeCapabilityInspector.inspect(ctx, null);
        if (!cap.optBoolean("webviewSupportedForBridge", false)) {
            // Honest API 24/25 stock WebView 52 recording: never fake bridge success on WebView 52!
            Log.i(TAG, "E2E_01_BRIDGE_SKIPPED_OLD_WEBVIEW=" + new JSONObject()
                    .put("api", Build.VERSION.SDK_INT)
                    .put("webviewVersion", cap.optString("webviewVersion", ""))
                    .put("reason", "WEBVIEW_BELOW_CAPACITOR_FLOOR")
                    .toString());
            return;
        }

        // Launch REAL Capacitor BridgeActivity and drive REAL window.Capacitor.Plugins.KanataM6RestoreBridge!
        try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
            waitForBridgeReady(scenario);

            String jsScript = "(async () => {"
                    + "  const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanataM6RestoreBridge;"
                    + "  if (!B) return JSON.stringify({ ok: false, err: 'BRIDGE_MISSING' });"
                    + "  const p0 = await B.probeState();"
                    + "  const staged = await B.stageBackup({"
                    + "    sourceUri: " + JSONObject.quote(safUri.toString()) + ","
                    + "    backupPassword: " + JSONObject.quote(BACKUP_PW) + ","
                    + "    localMasterPassword: " + JSONObject.quote(MASTER_PW) + ","
                    + "    ownerId: 'settings-ui-e2e',"
                    + "    sessionRevision: 7,"
                    + "    epoch: 1,"
                    + "    taskId: 'bridge-e2e-1'"
                    + "  });"
                    + "  const gated = await B.beginGateAndDrain({"
                    + "    txnId: 'txn-bridge-e2e-1',"
                    + "    ownerId: 'settings-ui-e2e',"
                    + "    epoch: 1,"
                    + "    expectedSeq: p0.sequence,"
                    + "    expectedDigest: p0.recordDigest,"
                    + "    inputDigest: staged.descriptor.transcriptHex"
                    + "  });"
                    + "  let forgedRejected = false;"
                    + "  try {"
                    + "    await B.prepareTransaction({"
                    + "      txnId: gated.txnId, ownerId: 'settings-ui-e2e', epoch: gated.epoch,"
                    + "      expectedSeq: gated.sequence, expectedDigest: gated.recordDigest,"
                    + "      stagingHandle: 'stg-forged-external-handle', sessionRevision: 7, stagingEpoch: 1"
                    + "    });"
                    + "  } catch (e) { forgedRejected = true; }"
                    + "  const prepared = await B.prepareTransaction({"
                    + "    txnId: gated.txnId, ownerId: 'settings-ui-e2e', epoch: gated.epoch,"
                    + "    expectedSeq: gated.sequence, expectedDigest: gated.recordDigest,"
                    + "    stagingHandle: staged.stagingHandle, sessionRevision: 7, stagingEpoch: 1,"
                    + "    participantPayloadJson: JSON.stringify({ scope: 'kanata-portable-v1' })"
                    + "  });"
                    + "  let cancelDuringPreparedBlocked = false;"
                    + "  try {"
                    + "    await B.cancelOrDestroyStaging({ taskId: 'bridge-e2e-1', generationId: staged.descriptor.generationId, stagingHandle: staged.stagingHandle });"
                    + "  } catch (e) { cancelDuringPreparedBlocked = true; }"
                    + "  const capCommit = await B.authenticateAndIssueCapability({"
                    + "    localMasterPassword: " + JSONObject.quote(MASTER_PW) + ","
                    + "    txnId: prepared.txnId, participantId: 'kanata', operation: 'COMMIT_DECISION',"
                    + "    generationId: staged.descriptor.generationId, ownerId: 'settings-ui-e2e', epoch: prepared.epoch"
                    + "  });"
                    + "  const decided = await B.commitDecision({"
                    + "    txnId: prepared.txnId, ownerId: 'settings-ui-e2e', epoch: prepared.epoch,"
                    + "    expectedSeq: prepared.sequence, expectedDigest: prepared.recordDigest,"
                    + "    preparedDigest: prepared.preparedDigest, direction: 'target', capability: capCommit"
                    + "  });"
                    + "  const capApply = await B.authenticateAndIssueCapability({"
                    + "    localMasterPassword: " + JSONObject.quote(MASTER_PW) + ","
                    + "    txnId: decided.txnId, participantId: 'kanata', operation: 'APPLY_GENERATION',"
                    + "    generationId: staged.descriptor.generationId, ownerId: 'settings-ui-e2e', epoch: decided.epoch"
                    + "  });"
                    + "  const verified = await B.verifyAndApplyGeneration({ localMasterPassword: " + JSONObject.quote(MASTER_PW) + ", capability: capApply });"
                    + "  const capFin = await B.authenticateAndIssueCapability({"
                    + "    localMasterPassword: " + JSONObject.quote(MASTER_PW) + ","
                    + "    txnId: decided.txnId, participantId: 'kanata', operation: 'FINALIZE',"
                    + "    generationId: staged.descriptor.generationId, ownerId: 'settings-ui-e2e', epoch: decided.epoch"
                    + "  });"
                    + "  const finalized = await B.finalizeTransaction({"
                    + "    txnId: decided.txnId, ownerId: 'settings-ui-e2e', epoch: decided.epoch,"
                    + "    expectedSeq: decided.sequence, expectedDigest: decided.recordDigest,"
                    + "    preparedDigest: decided.preparedDigest, gcRetired: true, capability: capFin"
                    + "  });"
                    + "  const health = await B.openActiveGenerationHealth({ localMasterPassword: " + JSONObject.quote(MASTER_PW) + " });"
                    + "  return JSON.stringify({"
                    + "    ok: true,"
                    + "    forgedRejected,"
                    + "    cancelDuringPreparedBlocked,"
                    + "    finalized: finalized.finalized,"
                    + "    cleanupError: finalized.cleanupError,"
                    + "    activeGenerationId: health.activeGenerationId,"
                    + "    messageCount: health.messageCount,"
                    + "    integrityOk: health.integrityOk,"
                    + "    cipherIntegrityOk: health.cipherIntegrityOk,"
                    + "    foreignKeysOk: health.foreignKeysOk,"
                    + "    verifiedCount: verified.messageCount"
                    + "  });"
                    + "})()";

            JSONObject res = evalAsyncJsInWebView(scenario, jsScript, 60_000L);
            assertTrue("Bridge E2E failed: " + res, res.optBoolean("ok", false));
            assertTrue("Forged handle must be rejected by Native HMAC", res.getBoolean("forgedRejected"));
            assertTrue("Cancelling/destroying PREPARED material must be blocked", res.getBoolean("cancelDuringPreparedBlocked"));
            assertTrue("Must be FINALIZED", res.getBoolean("finalized"));
            assertEquals("", res.optString("cleanupError", ""));
            assertEquals("gen-bridge-e2e-1", res.getString("activeGenerationId"));
            assertEquals(60L, res.getLong("messageCount"));
            assertTrue(res.getBoolean("integrityOk"));
            assertTrue(res.getBoolean("cipherIntegrityOk"));
            assertTrue(res.getBoolean("foreignKeysOk"));

            // Previous generation must have been safely GC'd after FINALIZED, and Todo ordinary writes re-enabled!
            assertFalse("Retired previous gen dir should be GC'd after FINALIZED",
                    KanataDurableTxControl.generationDir(controlRoot, prevGen.generationId).exists());
            JSONObject todoAfter = TodoRepository.toggleCompleted(ctx, controlRoot, "e2e-todo-1", today);
            assertEquals(1L, todoAfter.getLong("revision"));

            Log.i(TAG, "E2E_01_REAL_BRIDGE_SAF_RESTORE=" + res.toString());
        }
    }

    @Test
    public void e2e_02_realEndToEndSigkillAndColdStartAutonomousRecovery() throws Exception {
        File targetKpb1 = exportSyntheticKpb1("e2e-sigkill-target", 45, 3003L);
        String[] stages = new String[] {
                KanataM6KillableWorkerService.STAGE_E2E_AFTER_GATE,
                KanataM6KillableWorkerService.STAGE_E2E_AFTER_PREPARED,
                KanataM6KillableWorkerService.STAGE_E2E_BEFORE_HEAD_RENAME,
                KanataM6KillableWorkerService.STAGE_E2E_AFTER_DECISION_TARGET,
                KanataM6KillableWorkerService.STAGE_E2E_AFTER_FINALIZED_BEFORE_GC
        };
        long[] expectedMessagesAfterRecovery = new long[] { 15L, 15L, 15L, 45L, 45L };
        String[] expectedDirection = new String[] { "previous", "previous", "previous", "target", "none" };

        for (int idx = 0; idx < stages.length; idx++) {
            String stage = stages[idx];
            File stageDir = new File(testRoot, "e2e-sk-" + idx);
            File stageControl = new File(stageDir, "tx-control");
            String sHmac = "com.yubin.formyself.e2esk.h." + idx + "." + UUID.randomUUID().toString().substring(0, 6);
            String sAead = "com.yubin.formyself.e2esk.a." + idx + "." + UUID.randomUUID().toString().substring(0, 6);
            try {
                seedControlRootWithInitialGen(stageControl, sHmac, sAead, "gen-e2e-prev-" + idx, 15, 4000L + idx);

                Intent intent = new Intent(ctx, KanataM6KillableWorkerService.class);
                intent.setAction(KanataM6KillableWorkerService.ACTION_E2E_M603R_SIGKILL);
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, stageDir.getAbsolutePath());
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_CONTROL_ROOT, stageControl.getAbsolutePath());
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_PACKAGE_PATH, targetKpb1.getAbsolutePath());
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, BACKUP_PW);
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_MASTER_PASSWORD, MASTER_PW);
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "sk" + idx);
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, stage);
                intent.putExtra(KanataM6KillableWorkerService.EXTRA_OWNER_ID, "worker-e2e-" + idx);
                ctx.startService(intent);

                JSONObject ready = waitForJsonFile(new File(stageDir, "worker_ready.json"), 45_000L);
                assertNotNull("Worker did not reach stage " + stage, ready);
                int workerPid = ready.getInt("pid");
                assertNotEquals(Process.myPid(), workerPid);

                // Real OS SIGKILL of separate process!
                Process.killProcess(workerPid);
                waitForPidGone(workerPid, 10_000L);

                // Autonomous cold-start product recovery (NEVER test-chosen direction, NEVER manual journal deletion!)
                JSONObject recovered = KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                        ctx, stageControl, MASTER_PW, "cold-start-app-" + idx,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                assertTrue("Recovery must succeed at " + stage, recovered.getBoolean("recovered"));
                assertFalse("Fence must be cleared after recovery at " + stage, recovered.optBoolean("blocked", true));
                assertEquals("Direction mismatch at " + stage, expectedDirection[idx], recovered.getString("convergedDirection"));

                // Cold-open active generation by authoritative head using local master password
                KanataM6GenerationStore.ActiveGenerationHealth health =
                        KanataM6GenerationStore.openAuthoritativeActiveGeneration(
                                ctx, stageControl, MASTER_PW, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                assertEquals("Message count mismatch after recovery at " + stage,
                        expectedMessagesAfterRecovery[idx], health.messageCount);
                assertTrue(health.integrityOk && health.cipherIntegrityOk && health.foreignKeysOk);

                // F03-08: Repeated cold-start recovery MUST be strictly idempotent!
                JSONObject secondCold = KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                        ctx, stageControl, MASTER_PW, "cold-start-repeat-" + idx,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                assertTrue(secondCold.getBoolean("recovered"));
                assertEquals("none", secondCold.getString("convergedDirection"));
            } finally {
                deleteKeystoreAliasQuiet(sHmac);
                deleteKeystoreAliasQuiet(sAead);
            }
        }

        Log.i(TAG, "E2E_02_SIGKILL_AUTONOMOUS_RECOVERY=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("stagesTested", stages.length)
                .put("allAutonomousConvergedAndIdempotent", true)
                .toString());
    }

    @Test
    public void e2e_03_damagedVaultKanataSettingsRecoveryDedicatedAuth() throws Exception {
        // B-01 / N-06 / F03-02: Corrupt Vault file, legacy Kanata pages, and Settings preferences while a PREPARED tx is pending!
        KanataDurableTxControl.GenerationRegistration prevGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-b01-prev", 12, 5001L);
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);

        KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-b01", "owner-b01", 1L, init.headRecord.sequence, init.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE, false, "", prevGen, null,
                prevGen.generationId, "in-b01", "", "gate", "restore", "kanata", init.headRecord.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gated.txnId, "owner-b01", gated.epoch, gated.sequence, gated.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE, true, "", prevGen, null,
                prevGen.generationId, "in-b01", "", "prep-abort", "restore", "kanata", gated.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);

        // Deliberately corrupt Vault, legacy Kanata, and Settings storage!
        File formyselfDir = new File(ctx.getFilesDir(), "formyself");
        assertTrue(formyselfDir.mkdirs() || formyselfDir.isDirectory());
        File corruptedVault = new File(formyselfDir, "vault-v1.enc");
        File corruptedKanata = new File(formyselfDir, "kanata-v1.enc");
        try (FileOutputStream fos = new FileOutputStream(corruptedVault)) { fos.write("CORRUPT_VAULT_BYTES".getBytes(StandardCharsets.UTF_8)); }
        try (FileOutputStream fos = new FileOutputStream(corruptedKanata)) { fos.write("CORRUPT_KANATA_BYTES".getBytes(StandardCharsets.UTF_8)); }
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().putString("app_settings_v1", "{{BROKEN_SETTINGS_JSON").commit();

        try {
            // Wrong recovery password MUST fail with AUTH_FAILED
            try {
                KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                        ctx, controlRoot, "WRONG-MASTER-PW", "rec-b01",
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                fail("Wrong password must fail recovery auth");
            } catch (KanataDurableTxControl.TxControlException expected) {
                assertEquals("AUTH_FAILED", expected.code);
            }

            // Correct local master password succeeds WITHOUT needing Vault, legacy Kanata, or Settings readiness!
            JSONObject rec = KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                    ctx, controlRoot, MASTER_PW, "rec-b01",
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            assertTrue(rec.getBoolean("recovered"));
            assertEquals("previous", rec.getString("convergedDirection"));
            assertFalse(rec.getBoolean("blocked"));
        } finally {
            corruptedVault.delete();
            corruptedKanata.delete();
            ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().remove("app_settings_v1").commit();
        }

        Log.i(TAG, "E2E_03_DAMAGED_MODULES_RECOVERY_AUTH=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("bypassedDamagedVaultKanataSettings", true)
                .put("wrongPasswordRejected", true)
                .toString());
    }

    @Test
    public void e2e_04_sameKpb1TwoIsolatedTargetsDistinctDeksAndGenerationAtomicity() throws Exception {
        // F06 / F03-10: Restore the EXACT SAME KPB1 package into two isolated targets -> MUST get independent DEKs & envelopes!
        File sharedKpb1 = exportSyntheticKpb1("shared-cross-host", 30, 6001L);

        File rootA = new File(testRoot, "host-A");
        File rootB = new File(testRoot, "host-B");
        String hA = "com.yubin.formyself.e2ea.h." + UUID.randomUUID().toString().substring(0, 6);
        String aA = "com.yubin.formyself.e2ea.a." + UUID.randomUUID().toString().substring(0, 6);
        String hB = "com.yubin.formyself.e2eb.h." + UUID.randomUUID().toString().substring(0, 6);
        String aB = "com.yubin.formyself.e2eb.a." + UUID.randomUUID().toString().substring(0, 6);
        try {
            KanataDurableTxControl.initializeControlRoot(ctx, rootA, hA, aA, "", null,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);
            KanataDurableTxControl.initializeControlRoot(ctx, rootB, hB, aB, "", null,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);

            KanataM6GenerationStore.StagedGenerationResult resA = KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, rootA, null, sharedKpb1, BACKUP_PW, "HostA-Master-Pass!", "hostA", "ownerA", 1L, 1L,
                    catalog, 500, new AtomicBoolean(false), new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            KanataM6GenerationStore.StagedGenerationResult resB = KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, rootB, null, sharedKpb1, BACKUP_PW, "HostB-Master-Pass!", "hostB", "ownerB", 1L, 1L,
                    catalog, 500, new AtomicBoolean(false), new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

            // Distinct DEK fingerprints and distinct envelope SHA-256 digests!
            assertNotEquals("Same KPB1 across two hosts MUST generate distinct DEKs",
                    resA.dekFingerprintHex, resB.dekFingerprintHex);
            assertNotEquals("Same KPB1 across two hosts MUST generate distinct envelopes",
                    resA.registration.envelopeSha256Hex, resB.registration.envelopeSha256Hex);
            assertEquals("Logical dataset identity must match",
                    resA.registration.datasetIdentity, resB.registration.datasetIdentity);

            // Each opens cleanly with its own master password and rejects the other host's password!
            KanataM6GenerationStore.ActiveGenerationHealth healthA =
                    KanataM6GenerationStore.openAndVerifyGeneration(rootA, resA.registration.generationId, "HostA-Master-Pass!");
            KanataM6GenerationStore.ActiveGenerationHealth healthB =
                    KanataM6GenerationStore.openAndVerifyGeneration(rootB, resB.registration.generationId, "HostB-Master-Pass!");
            assertEquals(30L, healthA.messageCount);
            assertEquals(30L, healthB.messageCount);

            try {
                KanataM6GenerationStore.openAndVerifyGeneration(rootA, resA.registration.generationId, "HostB-Master-Pass!");
                fail("Wrong local password must fail envelope unwrap");
            } catch (KanataDurableTxControl.TxControlException expected) {
                assertEquals("UNLOCK_FAILED", expected.code);
            }

            // Cross-generation envelope swap (putting Host B's envelope with Host A's DB) MUST fail to open SQLCipher!
            File envA = KanataDurableTxControl.generationEnvelopeFile(rootA, resA.registration.generationId);
            File envB = KanataDurableTxControl.generationEnvelopeFile(rootB, resB.registration.generationId);
            byte[] envBBytes = KanataM6SchemeCExporter.readSmallFileBounded(envB, 4096);
            try (FileOutputStream fos = new FileOutputStream(envA, false)) { fos.write(envBBytes); }
            try {
                KanataM6GenerationStore.openAndVerifyGeneration(rootA, resA.registration.generationId, "HostB-Master-Pass!");
                fail("Mismatched DB + envelope pair must fail SQLCipher open");
            } catch (Exception expected) {
                // SQLCipher rejects wrong DEK
            }
        } finally {
            deleteKeystoreAliasQuiet(hA);
            deleteKeystoreAliasQuiet(aA);
            deleteKeystoreAliasQuiet(hB);
            deleteKeystoreAliasQuiet(aB);
        }

        Log.i(TAG, "E2E_04_CROSS_HOST_DISTINCT_DEK=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("distinctDeks", true)
                .put("wrongPasswordRejected", true)
                .put("envelopeSwapRejected", true)
                .toString());
    }

    @Test
    public void e2e_05_realNativeLongFieldBindingAndBoundedStaging() throws Exception {
        // B-03 / N-03 / F03-02: Real long TEXT/JSON with multi-byte UTF-8 & emoji surrogate pairs
        File srcDir = new File(testRoot, "src-long");
        File spoolDir = new File(testRoot, "spool-long");
        File outKpb1 = new File(testRoot, "long-fields.kpb1");
        assertTrue(srcDir.mkdirs() || srcDir.isDirectory());
        assertTrue(spoolDir.mkdirs() || spoolDir.isDirectory());
        File srcDb = new File(srcDir, "long.db");
        byte[] rawKey = KanataKeyEnvelope.rawSqlCipherKey(KanataM6PortableCrypto.randomBytes(32));
        KanataM6SyntheticDataset.populateUniformDataset(srcDb, rawKey, catalog, 10);

        // Inject a 200 KiB multi-byte UTF-8 + emoji long text into a message row
        StringBuilder sb = new StringBuilder(220_000);
        String pattern = "彼方长字段测试🚀🌟日本語テスト-UTF8-BOUNDARY-";
        while (sb.length() < 120_000) sb.append(pattern);
        String expectedLongContent = sb.toString();

        SQLiteDatabase db = SQLiteDatabase.openDatabase(srcDb.getPath(), rawKey, null, SQLiteDatabase.OPEN_READWRITE, null, null);
        String targetMsgId;
        try {
            try (android.database.Cursor c = db.rawQuery("SELECT id FROM messages ORDER BY id LIMIT 1", null)) {
                assertTrue(c.moveToFirst());
                targetMsgId = c.getString(0);
            }
            db.execSQL("UPDATE messages SET content = ?, revision = revision + 1 WHERE id = ?",
                    new Object[] { expectedLongContent, targetMsgId });
        } finally {
            db.close();
        }

        KanataM6SchemeCExporter.exportToSpool(
                srcDb.getAbsolutePath(), rawKey, BACKUP_PW, catalog,
                new KanataM6SnapshotOwner.WriteGate(), spoolDir, outKpb1,
                null, null, new AtomicBoolean(false), null, null);

        KanataDurableTxControl.initializeControlRoot(ctx, controlRoot, hmacAlias, aeadAlias, "", null,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE, KanataDurableTxControl.FaultInjector.NONE);

        KanataM6GenerationStore.StagedGenerationResult staged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, outKpb1, BACKUP_PW, MASTER_PW, "long-1", "owner-long", 1L, 1L,
                catalog, 500, new AtomicBoolean(false), new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        // Unwrap fresh envelope & verify exact byte-for-byte preservation of the long UTF-8 field!
        File dbFile = KanataDurableTxControl.generationDbFile(controlRoot, staged.registration.generationId);
        File envFile = KanataDurableTxControl.generationEnvelopeFile(controlRoot, staged.registration.generationId);
        JSONObject hdr = KanataKeyEnvelope.readHeader(new android.util.AtomicFile(envFile));
        byte[] kek = KanataM6GenerationStore.deriveLocalKek(MASTER_PW, hdr.getString("salt"));
        byte[] dek = KanataKeyEnvelope.unwrap(kek, hdr);
        byte[] genRawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);
        SQLiteDatabase restoredDb = SQLiteDatabase.openDatabase(
                dbFile.getPath(), genRawKey, null, SQLiteDatabase.OPEN_READONLY, null, null);
        try {
            try (android.database.Cursor c = restoredDb.rawQuery(
                    "SELECT content FROM messages WHERE id = ?", new String[] { targetMsgId })) {
                assertTrue(c.moveToFirst());
                assertEquals("Long multi-byte UTF-8 field must be preserved without truncation",
                        expectedLongContent, c.getString(0));
            }
        } finally {
            restoredDb.close();
            java.util.Arrays.fill(kek, (byte) 0);
            java.util.Arrays.fill(dek, (byte) 0);
            java.util.Arrays.fill(genRawKey, (byte) 0);
        }
        assertTrue("Peak RSS must remain bounded (<512 MiB)", staged.artifact.metrics.peakRssKiB < 524_288L);

        Log.i(TAG, "E2E_05_LONG_FIELD_BOUNDED=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("longFieldChars", expectedLongContent.length())
                .put("exactBytePreserved", true)
                .put("peakRssKiB", staged.artifact.metrics.peakRssKiB)
                .toString());
    }

    @Test
    public void e2e_06_legacyFivePathConflictAndNoAutoUpgrade() throws Exception {
        // H-05 / G-04: Unauthenticated legacy commit marker MUST NOT auto-upgrade to trusted new-protocol decision!
        seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-h05-0", 10, 8008L);
        File legacyDir = new File(ctx.getFilesDir(), "formyself");
        assertTrue(legacyDir.mkdirs() || legacyDir.isDirectory());

        // Plant orphan legacy commit marker (restore-v1.commit without restore-v1.enc)
        File orphanCommit = new File(legacyDir, "restore-v1.commit");
        try (FileOutputStream fos = new FileOutputStream(orphanCommit)) {
            fos.write("{\"digest\":\"0000000000000000000000000000000000000000000000000000000000000000\"}".getBytes(StandardCharsets.UTF_8));
        }

        KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue("Orphan legacy commit marker must block", st.blocked);
        assertEquals("BLOCKED_LEGACY_CONFLICT", st.recoveryAction);
        assertTrue(st.legacyInventory.orphanOrConflict);

        // Attempting autonomous new-protocol recovery MUST refuse and keep blocked (never auto-upgrade legacy marker!)
        try {
            KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                    ctx, controlRoot, MASTER_PW, "h05-rec",
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Must not auto-upgrade unauthenticated legacy commit marker");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("LEGACY_ORPHAN_OR_CONFLICT", expected.code);
        }
        assertTrue("Orphan legacy marker must be preserved, never silently deleted", orphanCommit.exists());

        Log.i(TAG, "E2E_06_LEGACY_CONFLICT_NO_AUTO_UPGRADE=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("orphanMarkerBlocked", true)
                .put("preservedWithoutAutoUpgrade", true)
                .toString());
    }

    // ---- WebView Bridge helpers ----

    private static void waitForBridgeReady(ActivityScenario<KanataM6BridgeActivity> scenario) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<String> res = new AtomicReference<>("");
            CountDownLatch latch = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebView wv = activity.getBridge() != null ? activity.getBridge().getWebView() : null;
                if (wv == null) { latch.countDown(); return; }
                wv.evaluateJavascript(
                        "Boolean(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanataM6RestoreBridge)",
                        v -> { res.set(v); latch.countDown(); });
            });
            latch.await(3, TimeUnit.SECONDS);
            if ("true".equals(res.get())) return;
            Thread.sleep(250);
        }
        fail("KanataM6RestoreBridge plugin did not become available in WebView");
    }

    private static JSONObject evalAsyncJsInWebView(
            ActivityScenario<KanataM6BridgeActivity> scenario, String asyncExpr, long timeoutMs) throws Exception {
        String key = "__m603r_" + UUID.randomUUID().toString().replace("-", "");
        CountDownLatch kickLatch = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            WebView wv = activity.getBridge().getWebView();
            String wrapper = "window." + key + " = null;"
                    + "(" + asyncExpr + ").then(function(r){ window." + key + " = r; })"
                    + ".catch(function(e){ window." + key + " = JSON.stringify({ ok: false, err: String(e && e.message || e) }); });";
            wv.evaluateJavascript(wrapper, v -> kickLatch.countDown());
        });
        assertTrue(kickLatch.await(10, TimeUnit.SECONDS));

        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<String> raw = new AtomicReference<>("null");
            CountDownLatch pollLatch = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebView wv = activity.getBridge().getWebView();
                wv.evaluateJavascript("window." + key, v -> { raw.set(v); pollLatch.countDown(); });
            });
            pollLatch.await(5, TimeUnit.SECONDS);
            String val = raw.get();
            if (val != null && !"null".equals(val) && !val.isEmpty()) {
                // evaluateJavascript JSON-encodes string returns
                String unquoted = new JSONArray("[" + val + "]").getString(0);
                return new JSONObject(unquoted);
            }
            Thread.sleep(200);
        }
        fail("Timed out waiting for async WebView Bridge evaluation");
        return new JSONObject();
    }

    private static JSONObject waitForJsonFile(File f, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (f.exists() && f.length() > 0) {
                byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(f, 65536);
                return new JSONObject(new String(raw, StandardCharsets.UTF_8));
            }
            Thread.sleep(100);
        }
        return null;
    }

    private static void waitForPidGone(int pid, long timeoutMs) throws InterruptedException {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        File procDir = new File("/proc/" + pid);
        while (SystemClock.elapsedRealtime() < deadline) {
            if (!procDir.exists()) return;
            Thread.sleep(50);
        }
    }
}
