package com.yubin.formyself;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
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
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Kanata M6-03-R2 Final Integration & Resource Ownership Remediation Suite (R01 / R02 / R03).
 *
 * Covers:
 * - R01: Real MainActivity WebView E2E driving ACTUAL mounted SettingsBackup.vue ->
 *        useBackupSettings -> KanataPortableRestoreRuntime -> KanataPortableRestoreCoordinator ->
 *        RestoreCoordinator (commitStrategy='decision_then_apply') -> KanataM6RestoreBridgePlugin ->
 *        KanataDurableTxControl -> KanataM6GenerationStore -> SQLCipher 4.17.0,
 *        plus Native state-machine strict gates (PREPARED forbids APPLY/FINALIZE, FINALIZED requires verification receipt).
 * - R02: Exclusive generation reservation & ownership protection (duplicate active taskId,
 *        concurrent race for same genId, duplicate on PREPARED gen, wrong password / corrupt KPB1
 *        targeting existing gen, failure cleanup ownership, cancel race, ACTIVE_STAGING_CANCELS putIfAbsent).
 * - R03: Authoritative KanataSqlitePlugin business routing via head.activeGenerationId,
 *        in-flight writer drain & full write fence verification, PREPARED immutable bindings negative CAS matrix,
 *        and cold-start read-only 5-path inventory preserving orphan markers without auto-upgrade.
 */
@RunWith(AndroidJUnit4.class)
public class KanataM603R2FinalRemediationTest {
    private static final String TAG = "KanataM603R2";
    private static final String BACKUP_PW = "Synthetic-M603R2-Backup-Pass!";
    private static final String MASTER_PW = "Synthetic-M603R2-Master-Pass!";

    // Whitelisted real business queries from kanata-sqlite-catalog.json
    private static final String STMT_LIST_WORLDS =
            "1f65cf9e540afca27d7c661da5650657b26fd1547278c695052ee2ae08aa5a6b";
    private static final String STMT_COUNT_MESSAGES_IN_CONV =
            "3519ab1946f14b739048dac91e366a9efc0bd9db1fc603ad24785c851c84bfbd";

    private Context ctx;
    private File testRoot;
    private File controlRoot;
    private String hmacAlias;
    private String aeadAlias;
    private KanataM6PortableCatalog catalog;
    private final List<String> createdAliases = new ArrayList<>();

    @Before
    public void setUp() throws Exception {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.yubin.formyself.m2qa", ctx.getPackageName());
        catalog = KanataM6PortableCatalog.load(ctx);
        String runId = "m603r2-" + UUID.randomUUID().toString().substring(0, 8);
        testRoot = new File(ctx.getNoBackupFilesDir(), runId);
        assertTrue(testRoot.mkdirs());
        controlRoot = new File(testRoot, "tx-control");
        hmacAlias = "com.yubin.formyself.r2.hmac." + runId;
        aeadAlias = "com.yubin.formyself.r2.aead." + runId;
        createdAliases.add(hmacAlias);
        createdAliases.add(aeadAlias);

        cleanLegacyArtifacts();
        KanataM6RestoreBridgePlugin.setTestControlRootOverride(controlRoot);
        KanataM6RestoreBridgePlugin.setTestPickedDocument(null, null);
        KanataM6RestoreBridgePlugin.setTestFailNextVerifyApply(false);
        KanataM6RestoreBridgePlugin.clearCallTrace();
    }

    @After
    public void tearDown() {
        KanataM6RestoreBridgePlugin.setTestControlRootOverride(null);
        KanataM6RestoreBridgePlugin.setTestPickedDocument(null, null);
        KanataM6RestoreBridgePlugin.setTestFailNextVerifyApply(false);
        KanataM6RestoreBridgePlugin.clearCallTrace();
        cleanLegacyArtifacts();
        deleteQuiet(testRoot);
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            for (String a : createdAliases) {
                if (ks.containsAlias(a)) ks.deleteEntry(a);
            }
        } catch (Exception ignored) {}
    }

    private void cleanLegacyArtifacts() {
        File dir = new File(ctx.getFilesDir(), "formyself");
        for (String f : new String[] {
                "restore-v1.enc", "restore-v1.commit", "restore-v1.tmp",
                "restore-v1.enc.commit", "restore-v1.enc.tmp",
                "kanata-v1.enc", "kanata-v1.enc.bak", "kanata-v1.enc.tmp"
        }) {
            new File(dir, f).delete();
        }
        deleteQuiet(new File(dir, "kanata-pages-v1"));
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().remove("my_kanata_recovery_encrypted_v1").commit();
    }

    private static void deleteQuiet(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteQuiet(k);
        }
        f.delete();
    }

    private File exportSyntheticKpb1(String label, int messages, long seed) throws Exception {
        File srcDb = new File(testRoot, "src-" + label + ".db");
        File work = new File(testRoot, "exp-work-" + label);
        File out = new File(testRoot, label + ".kpb1");
        assertTrue(work.mkdirs());
        byte[] dek = new byte[32];
        new java.security.SecureRandom().nextBytes(dek);
        byte[] rawKey = KanataKeyEnvelope.rawSqlCipherKey(dek);
        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDb, rawKey, catalog, messages);
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                    srcDb.getPath(), rawKey, null, SQLiteDatabase.OPEN_READWRITE, null, null)) {
                db.execSQL("UPDATE worlds SET name = ? WHERE id = 'w1'", new Object[] { "world-" + label });
            }
            KanataM6SchemeCExporter.exportToSpool(
                    srcDb.getAbsolutePath(), rawKey, BACKUP_PW, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), work, out,
                    null, null, new AtomicBoolean(false), null, null);
            assertTrue(out.isFile() && out.length() > 0);
            return out;
        } finally {
            Arrays.fill(dek, (byte) 0);
            Arrays.fill(rawKey, (byte) 0);
            srcDb.delete();
            new File(srcDb.getPath() + "-wal").delete();
            new File(srcDb.getPath() + "-shm").delete();
            deleteQuiet(work);
        }
    }

    private Uri publishToSyntheticSaf(File kpb1File, String displayName) throws Exception {
        Uri docUri = android.provider.DocumentsContract.createDocument(
                ctx.getContentResolver(),
                KanataM6SyntheticSafProvider.rootUri(),
                "application/octet-stream",
                displayName);
        assertNotNull(docUri);
        try (java.io.FileInputStream in = new java.io.FileInputStream(kpb1File);
             java.io.OutputStream out = ctx.getContentResolver().openOutputStream(docUri, "w")) {
            assertNotNull(out);
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
            out.flush();
        }
        return docUri;
    }

    private KanataDurableTxControl.GenerationRegistration seedControlRootWithInitialGen(
            File root, String hAlias, String aAlias, String genId, int messages, long seed) throws Exception {
        KanataDurableTxControl.GenerationRegistration initGen =
                KanataM6GenerationStore.createInitialGenerationWithPopulator(
                        root, genId, MASTER_PW,
                        (dbFile, rawKey) -> {
                            KanataM6SyntheticDataset.populateUniformDataset(dbFile, rawKey, catalog, messages);
                            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                                    dbFile.getPath(), rawKey, null, SQLiteDatabase.OPEN_READWRITE, null, null)) {
                                db.execSQL("UPDATE worlds SET name = ? WHERE id = 'w1'",
                                        new Object[] { "world-" + genId });
                            }
                        });
        KanataM6GenerationStore.installRecoveryVerifier(root, MASTER_PW);
        KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.initializeControlRoot(
                ctx, root, hAlias, aAlias, initGen.generationId, initGen,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertFalse(st.blocked);
        return initGen;
    }

    private JSONObject evalAsyncJsInMainActivity(
            ActivityScenario<MainActivity> scenario, String asyncBody, long timeoutMs) throws Exception {
        String key = "__m603r2_" + UUID.randomUUID().toString().replace("-", "");
        String wrapper = "(function(){ window[" + JSONObject.quote(key) + "] = null; "
                + "(async function(){ try { const r = await (" + asyncBody + "); "
                + "window[" + JSONObject.quote(key) + "] = typeof r === 'string' ? r : JSON.stringify(r); } "
                + "catch (e) { window[" + JSONObject.quote(key) + "] = JSON.stringify({ ok: false, jsErr: String(e && (e.stack || e.message || e)) }); } })(); })();";

        scenario.onActivity(act -> {
            WebView wv = act.getBridge().getWebView();
            wv.evaluateJavascript(wrapper, null);
        });

        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> rawRef = new AtomicReference<>(null);
            scenario.onActivity(act -> {
                WebView wv = act.getBridge().getWebView();
                wv.evaluateJavascript("window[" + JSONObject.quote(key) + "]", val -> {
                    rawRef.set(val);
                    latch.countDown();
                });
            });
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            String raw = rawRef.get();
            if (raw != null && !"null".equals(raw) && !"undefined".equals(raw)) {
                String unquoted = new JSONArray("[" + raw + "]").getString(0);
                return new JSONObject(unquoted);
            }
            SystemClock.sleep(150);
        }
        fail("Timed out waiting for WebView async JS evaluation");
        return new JSONObject();
    }

    private String resolveBuiltVueEntryAsset() throws Exception {
        String[] entries = ctx.getAssets().list("public/assets");
        if (entries != null) {
            for (String name : entries) {
                if (name.startsWith("index-") && name.endsWith(".js")) {
                    return name;
                }
            }
        }
        throw new IllegalStateException("Missing built Vue entry chunk index-*.js under assets/public/assets/");
    }

    private void waitForVueAppMounted(ActivityScenario<MainActivity> scenario) throws Exception {
        String entryJs = resolveBuiltVueEntryAsset();
        long deadline = SystemClock.uptimeMillis() + 30_000L;
        boolean injectedBootstrap = false;
        String lastDiag = "";
        while (SystemClock.uptimeMillis() < deadline) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> res = new AtomicReference<>("");
            final boolean shouldInject = !injectedBootstrap;
            scenario.onActivity(act -> {
                if (act.getBridge() == null || act.getBridge().getWebView() == null) {
                    res.set("\"NO_WEBVIEW\"");
                    latch.countDown();
                    return;
                }
                String js = "(function(){"
                        + " var C=window.Capacitor;"
                        + " var bridgeReady=Boolean(C && C.Plugins && C.Plugins.KanataM6RestoreBridge && C.Plugins.KanataSqlite && location.origin==='https://localhost');"
                        + " if (!bridgeReady) return JSON.stringify({step:'wait_bridge',url:location.href,hasCap:!!C});"
                        + " var el=document.querySelector('#app');"
                        + " if (!el && " + shouldInject + " && !window.__r2BootStarted) {"
                        + "   window.__r2BootStarted=true;"
                        + "   el=document.createElement('div'); el.id='app'; document.body.innerHTML=''; document.body.appendChild(el);"
                        + "   var sc=document.createElement('script'); sc.type='module'; sc.src='/assets/' + " + JSONObject.quote(entryJs) + "; document.head.appendChild(sc);"
                        + "   return JSON.stringify({step:'booting_real_vue_app',entry:" + JSONObject.quote(entryJs) + "});"
                        + " }"
                        + " var mounted=Boolean(el && el.__vue_app__);"
                        + " return mounted ? 'READY' : JSON.stringify({step:'wait_mount',hasEl:!!el,hasApp:mounted,bootStarted:!!window.__r2BootStarted});"
                        + "})()";
                act.getBridge().getWebView().evaluateJavascript(js, val -> {
                    res.set(val);
                    latch.countDown();
                });
            });
            latch.await(5, TimeUnit.SECONDS);
            lastDiag = res.get();
            if (lastDiag != null && lastDiag.contains("booting_real_vue_app")) {
                injectedBootstrap = true;
            }
            if ("\"READY\"".equals(lastDiag)) return;
            SystemClock.sleep(200);
        }
        fail("Timed out waiting for MainActivity Vue app + Capacitor Bridge ready; lastDiag=" + lastDiag);
    }

    /**
     * R01 + R03.1 Real Application WebView E2E Test:
     * Launches REAL MainActivity (loading actual built Vue bundle), opens REAL SettingsBackup.vue,
     * clicks REAL UI buttons (driving useBackupSettings -> KanataPortableRestoreRuntime ->
     * KanataPortableRestoreCoordinator -> RestoreCoordinator[decision_then_apply] ->
     * KanataM6RestoreBridgePlugin -> KanataDurableTxControl -> KanataM6GenerationStore -> SQLCipher),
     * verifies:
     *   (A) Normal restore + exact Native call order + UI final state;
     *   (B) Pre-commit failure (wrong password before DECISION) -> clean abort without verifyAndApply;
     *   (C) Post-decision failure (injected inside verifyAndApplyGeneration AFTER durable DECISION(target))
     *       -> direction NOT reversed -> real MainActivity restart -> real retryFullRecovery button
     *       through RestoreCoordinator.recover() (zero openRestoreRecord!) -> FINALIZED;
     *   (D) Ordinary business read via REAL KanataSqlitePlugin (prepare -> unlock -> completeOpen -> begin -> query)
     *       reads the restored target generation (75 messages), NEVER old generations (15 / 60 messages)!
     */
    @Test
    public void r01_realAppWebViewEndToEndThroughSettingsBackupAndRestoreCoordinator() throws Exception {
        com.getcapacitor.JSObject cap = KanataRuntimeCapabilityInspector.inspect(ctx, null);
        if (!cap.optBoolean("webviewSupportedForBridge", false)) {
            Log.i(TAG, "R01_WEBVIEW_E2E_SKIPPED_OLD_WEBVIEW=" + new JSONObject()
                    .put("api", Build.VERSION.SDK_INT)
                    .put("webviewVersion", cap.optString("webviewVersion", ""))
                    .put("reason", "WEBVIEW_BELOW_CAPACITOR_FLOOR")
                    .toString());
            return;
        }

        KanataDurableTxControl.GenerationRegistration initGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-r01-init", 15, 1101L);
        File kpbA = exportSyntheticKpb1("r01-target-60", 60, 2202L);
        File kpbB = exportSyntheticKpb1("r01-precommit-30", 30, 3303L);
        File kpbC = exportSyntheticKpb1("r01-postdec-75", 75, 4404L);

        Uri safA = publishToSyntheticSaf(kpbA, "r01-a-" + UUID.randomUUID().toString().substring(0, 6) + ".kpb1");
        Uri safB = publishToSyntheticSaf(kpbB, "r01-b-" + UUID.randomUUID().toString().substring(0, 6) + ".kpb1");
        Uri safC = publishToSyntheticSaf(kpbC, "r01-c-" + UUID.randomUUID().toString().substring(0, 6) + ".kpb1");

        String genAfterA;
        String genAfterC;
        List<String> traceA;

        // ---- Session 1: Normal Restore (A) + Pre-Commit Failure (B) + Post-Decision Interruption (C-1) ----
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitForVueAppMounted(scenario);

            // Scenario A: Normal Restore through REAL SettingsBackup.vue UI controls!
            KanataM6RestoreBridgePlugin.setTestPickedDocument(safA, "r01-target-60.kpb1");
            KanataM6RestoreBridgePlugin.clearCallTrace();

            String scenarioAJs = "(async () => {"
                    + "  const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;"
                    + "  const auth = stores.get('auth');"
                    + "  const settings = stores.get('settings');"
                    + "  const waitFor = async (fn, label, ms=15000) => { const d = Date.now() + ms; while (Date.now() < d) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw new Error('TIMEOUT:' + label + ' phase=' + (document.querySelector('[data-testid=\"restore-phase-label\"]')?.textContent || '') + ' err=' + (document.querySelector('[data-testid=\"restore-error-box\"]')?.textContent || '') + ' cap=' + (document.querySelector('[data-testid=\"capability-unavailable-reason\"]')?.textContent || '')); };"
                    + "  if (!auth.hasMasterPassword) {"
                    + "    await auth.setMasterPassword(" + JSONObject.quote(MASTER_PW) + ");"
                    + "  } else if (auth.isLocked) {"
                    + "    await auth.unlockWithPassword(" + JSONObject.quote(MASTER_PW) + ");"
                    + "  }"
                    + "  settings.switchView('settings');"
                    + "  settings.openGeneralSettingsSection('data');"
                    + "  const pickBtn = await waitFor(() => document.querySelector('[data-testid=\"select-portable-file-btn\"]'), 'pickBtn');"
                    + "  const ensureCapReady = async (tag) => {"
                    + "    await waitFor(() => {"
                    + "      const s = document.querySelector('[data-testid=\"capability-summary\"]')?.textContent || '';"
                    + "      if (s.includes('能力状态：可用')) return true;"
                    + "      const unavail = document.querySelector('[data-testid=\"capability-unavailable-reason\"]')?.textContent || '';"
                    + "      if (unavail.includes('HANDSHAKE_TIMEOUT')) {"
                    + "        const rbtn = document.querySelector('[data-testid=\"refresh-capability-btn\"]');"
                    + "        if (rbtn && !rbtn.disabled) rbtn.click();"
                    + "      }"
                    + "      return false;"
                    + "    }, tag, 20000);"
                    + "  };"
                    + "  await ensureCapReady('capReady');"
                    + "  pickBtn.click();"
                    + "  await waitFor(() => pickBtn.textContent.includes('r01-target-60.kpb1'), 'filePicked');"
                    + "  const pwInput = document.querySelector('[data-testid=\"portable-password-input\"]');"
                    + "  pwInput.value = " + JSONObject.quote(BACKUP_PW) + ";"
                    + "  pwInput.dispatchEvent(new Event('input', { bubbles: true }));"
                    + "  const startBtn = await waitFor(() => { const b = document.querySelector('[data-testid=\"start-portable-restore-btn\"]'); return b && !b.disabled ? b : null; }, 'startBtn');"
                    + "  startBtn.click();"
                    + "  const confirmBtn = await waitFor(() => document.querySelector('[data-testid=\"confirm-portable-restore-btn\"]'), 'confirmBtn', 30000);"
                    + "  const stagedSummary = document.querySelector('[data-testid=\"staged-summary\"]')?.textContent || '';"
                    + "  confirmBtn.click();"
                    + "  const modalConfirm = await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认切换'), 'modalConfirm');"
                    + "  modalConfirm.click();"
                    + "  const phaseLabel = await waitFor(() => { const t = document.querySelector('[data-testid=\"restore-phase-label\"]')?.textContent || ''; return t.includes('恢复成功') ? t : null; }, 'succeeded', 30000);"
                    + "  const cleanupErr = document.querySelector('[data-testid=\"restore-cleanup-error\"]')?.textContent || '';"
                    + "  return { ok: true, stagedSummary, phaseLabel, cleanupErr };"
                    + "})()";

            JSONObject resA = evalAsyncJsInMainActivity(scenario, scenarioAJs, 60_000L);
            assertTrue("Scenario A UI restore failed: " + resA, resA.optBoolean("ok", false));
            assertTrue("Staged summary must show 60 messages: " + resA, resA.getString("stagedSummary").contains("60"));
            assertTrue("Phase label must show succeeded: " + resA, resA.getString("phaseLabel").contains("恢复成功"));
            assertEquals("", resA.getString("cleanupErr"));

            // Assert ACTUAL Native Bridge call order emitted by real RestoreCoordinator!
            traceA = KanataM6RestoreBridgePlugin.snapshotCallTrace();
            int iStage = traceA.indexOf("stageBackup");
            int iGate = traceA.indexOf("beginGateAndDrain");
            int iPrep = traceA.indexOf("prepareTransaction");
            int iCapCommit = traceA.indexOf("authenticateAndIssueCapability:COMMIT_DECISION");
            int iCommit = traceA.indexOf("commitDecision:target");
            int iCapApply = traceA.indexOf("authenticateAndIssueCapability:APPLY_GENERATION");
            int iApply = traceA.indexOf("verifyAndApplyGeneration");
            int iCapFin = traceA.indexOf("authenticateAndIssueCapability:FINALIZE");
            int iFin = traceA.indexOf("finalizeTransaction");
            assertTrue("Trace missing expected steps: " + traceA,
                    iStage >= 0 && iGate > iStage && iPrep > iGate && iCapCommit > iPrep
                            && iCommit > iCapCommit && iCapApply > iCommit && iApply > iCapApply
                            && iCapFin > iApply && iFin > iCapFin);

            KanataDurableTxControl.AuthoritativeState stAfterA = KanataDurableTxControl.probe(
                    ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            assertFalse(stAfterA.blocked);
            assertEquals("FINALIZED", stAfterA.headRecord.state);
            genAfterA = stAfterA.headRecord.activeGenerationId;
            assertNotEquals(initGen.generationId, genAfterA);
            assertEquals(60L, KanataM6GenerationStore.openAuthoritativeActiveGeneration(
                    ctx, controlRoot, MASTER_PW, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE).messageCount);

            // Scenario B: Pre-commit failure (wrong local master password at COMMIT_DECISION) through real UI!
            KanataM6RestoreBridgePlugin.setTestPickedDocument(safB, "r01-precommit-30.kpb1");
            KanataM6RestoreBridgePlugin.clearCallTrace();

            String scenarioBJs = "(async () => {"
                    + "  const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;"
                    + "  const auth = stores.get('auth');"
                    + "  auth.savedMasterPwd = " + JSONObject.quote(MASTER_PW) + ";"
                    + "  const waitFor = async (fn, label, ms=15000) => { const d = Date.now() + ms; while (Date.now() < d) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw new Error('TIMEOUT:' + label); };"
                    + "  const pickBtn = await waitFor(() => document.querySelector('[data-testid=\"select-portable-file-btn\"]'), 'pickBtnB');"
                    + "  pickBtn.click();"
                    + "  await waitFor(() => pickBtn.textContent.includes('r01-precommit-30.kpb1'), 'filePickedB');"
                    + "  const pwInput = document.querySelector('[data-testid=\"portable-password-input\"]');"
                    + "  pwInput.value = " + JSONObject.quote(BACKUP_PW) + ";"
                    + "  pwInput.dispatchEvent(new Event('input', { bubbles: true }));"
                    + "  const startBtn = await waitFor(() => { const b = document.querySelector('[data-testid=\"start-portable-restore-btn\"]'); return b && !b.disabled ? b : null; }, 'startBtnB');"
                    + "  startBtn.click();"
                    + "  const confirmBtn = await waitFor(() => document.querySelector('[data-testid=\"confirm-portable-restore-btn\"]'), 'confirmBtnB', 30000);"
                    + "  auth.savedMasterPwd = 'Wrong-Master-Password-For-PreCommit-Fail!';"
                    + "  confirmBtn.click();"
                    + "  const modalConfirm = await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认切换'), 'modalConfirmB');"
                    + "  modalConfirm.click();"
                    + "  const alertText = await waitFor(() => { const a = document.querySelector('[role=\"alert\"]'); return a && a.textContent.includes('验证并重试恢复') ? a.textContent : null; }, 'blockedAlertB', 20000);"
                    + "  return { ok: true, alertText };"
                    + "})()";

            JSONObject resB = evalAsyncJsInMainActivity(scenario, scenarioBJs, 60_000L);
            assertTrue("Scenario B failed: " + resB, resB.optBoolean("ok", false));
            List<String> traceB = KanataM6RestoreBridgePlugin.snapshotCallTrace();
            assertTrue("Pre-commit failure must reach prepareTransaction and COMMIT_DECISION auth: " + traceB,
                    traceB.contains("prepareTransaction") && traceB.contains("authenticateAndIssueCapability:COMMIT_DECISION"));
            assertFalse("Pre-commit failure MUST NOT invoke commitDecision:target: " + traceB,
                    traceB.contains("commitDecision:target"));
            assertFalse("Pre-commit failure MUST NOT invoke verifyAndApplyGeneration: " + traceB,
                    traceB.contains("verifyAndApplyGeneration"));

            KanataDurableTxControl.AuthoritativeState stPreRollbackB = KanataDurableTxControl.probe(
                    ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            assertTrue("Failed rollback with wrong password must stay blocked", stPreRollbackB.blocked);
            assertEquals("PREPARED", stPreRollbackB.headRecord.state);

            // Restore correct master password and click REAL App.vue retryFullRecovery button -> RestoreCoordinator.recover() rolls back to previous (genAfterA)!
            KanataM6RestoreBridgePlugin.clearCallTrace();
            String scenarioBRecoverJs = "(async () => {"
                    + "  const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;"
                    + "  const auth = stores.get('auth');"
                    + "  auth.savedMasterPwd = " + JSONObject.quote(MASTER_PW) + ";"
                    + "  const waitFor = async (fn, label, ms=20000) => { const d = Date.now() + ms; while (Date.now() < d) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw new Error('TIMEOUT:' + label); };"
                    + "  const recoverBtn = await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '验证并重试恢复'), 'recoverBtnB');"
                    + "  recoverBtn.click();"
                    + "  await waitFor(() => document.querySelector('[data-testid=\"select-portable-file-btn\"]'), 'settingsRemountB', 25000);"
                    + "  return { ok: true };"
                    + "})()";
            JSONObject resBRec = evalAsyncJsInMainActivity(scenario, scenarioBRecoverJs, 60_000L);
            assertTrue("Scenario B rollback recovery failed: " + resBRec, resBRec.optBoolean("ok", false));

            KanataDurableTxControl.AuthoritativeState stAfterB = KanataDurableTxControl.probe(
                    ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            assertFalse(stAfterB.blocked);
            assertEquals("FINALIZED", stAfterB.headRecord.state);
            assertEquals("Active generation must stay at Scenario A after pre-commit failure",
                    genAfterA, stAfterB.headRecord.activeGenerationId);

            // Scenario C-1: Post-DECISION interruption (inject failure inside verifyAndApplyGeneration AFTER durable DECISION(target)!)
            KanataM6RestoreBridgePlugin.setTestPickedDocument(safC, "r01-postdec-75.kpb1");
            KanataM6RestoreBridgePlugin.setTestFailNextVerifyApply(true);
            KanataM6RestoreBridgePlugin.clearCallTrace();

            String scenarioC1Js = "(async () => {"
                    + "  const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;"
                    + "  const auth = stores.get('auth');"
                    + "  auth.savedMasterPwd = " + JSONObject.quote(MASTER_PW) + ";"
                    + "  const waitFor = async (fn, label, ms=15000) => { const d = Date.now() + ms; while (Date.now() < d) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw new Error('TIMEOUT:' + label); };"
                    + "  const pickBtn = await waitFor(() => document.querySelector('[data-testid=\"select-portable-file-btn\"]'), 'pickBtnC');"
                    + "  await waitFor(() => {"
                    + "    const s = document.querySelector('[data-testid=\"capability-summary\"]')?.textContent || '';"
                    + "    if (s.includes('能力状态：可用')) return true;"
                    + "    const unavail = document.querySelector('[data-testid=\"capability-unavailable-reason\"]')?.textContent || '';"
                    + "    if (unavail.includes('HANDSHAKE_TIMEOUT')) {"
                    + "      const rbtn = document.querySelector('[data-testid=\"refresh-capability-btn\"]');"
                    + "      if (rbtn && !rbtn.disabled) rbtn.click();"
                    + "    }"
                    + "    return false;"
                    + "  }, 'capReadyC', 20000);"
                    + "  pickBtn.click();"
                    + "  await waitFor(() => pickBtn.textContent.includes('r01-postdec-75.kpb1'), 'filePickedC');"
                    + "  const pwInput = document.querySelector('[data-testid=\"portable-password-input\"]');"
                    + "  pwInput.value = " + JSONObject.quote(BACKUP_PW) + ";"
                    + "  pwInput.dispatchEvent(new Event('input', { bubbles: true }));"
                    + "  const startBtn = await waitFor(() => { const b = document.querySelector('[data-testid=\"start-portable-restore-btn\"]'); return b && !b.disabled ? b : null; }, 'startBtnC');"
                    + "  startBtn.click();"
                    + "  const confirmBtn = await waitFor(() => document.querySelector('[data-testid=\"confirm-portable-restore-btn\"]'), 'confirmBtnC', 30000);"
                    + "  confirmBtn.click();"
                    + "  const modalConfirm = await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认切换'), 'modalConfirmC');"
                    + "  modalConfirm.click();"
                    + "  const alertText = await waitFor(() => { const a = document.querySelector('[role=\"alert\"]'); return a && a.textContent.includes('验证并重试恢复') ? a.textContent : null; }, 'blockedAlertC', 20000);"
                    + "  return { ok: true, alertText };"
                    + "})()";

            JSONObject resC1 = evalAsyncJsInMainActivity(scenario, scenarioC1Js, 60_000L);
            assertTrue("Scenario C-1 failed: " + resC1, resC1.optBoolean("ok", false));

            KanataDurableTxControl.AuthoritativeState stInterrupted = KanataDurableTxControl.probe(
                    ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            assertTrue("Must stay blocked after post-DECISION failure", stInterrupted.blocked);
            assertEquals("DECISION", stInterrupted.headRecord.state);
            assertEquals("target", stInterrupted.headRecord.decisionDirection);
            genAfterC = stInterrupted.headRecord.activeGenerationId;
            assertNotEquals(genAfterA, genAfterC);
        }

        // ---- Session 2: Real Cold-Start MainActivity Restart -> Real retryFullRecovery() via RestoreCoordinator.recover() + R03.1 KanataSqlitePlugin Business Read! ----
        KanataM6RestoreBridgePlugin.clearCallTrace();
        try (ActivityScenario<MainActivity> restarted = ActivityScenario.launch(MainActivity.class)) {
            waitForVueAppMounted(restarted);

            String scenarioC2AndDJs = "(async () => {"
                    + "  const stores = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;"
                    + "  const auth = stores.get('auth');"
                    + "  const waitFor = async (fn, label, ms=20000) => { const d = Date.now() + ms; while (Date.now() < d) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw new Error('TIMEOUT:' + label); };"
                    + "  if (auth.isLocked) { await auth.unlockWithPassword(" + JSONObject.quote(MASTER_PW) + "); }"
                    + "  const recoverBtn = await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '验证并重试恢复'), 'recoverBtn');"
                    + "  recoverBtn.click();"
                    + "  await waitFor(() => !document.querySelector('[role=\"alert\"]'), 'recoverDone', 25000);"
                    + "  const SQL = window.Capacitor.Plugins.KanataSqlite;"
                    + "  const prep = await SQL.prepare({ create: false, sessionRevision: 1, ownerGeneration: 1 });"
                    + "  const saltRaw = Uint8Array.from(atob(prep.salt), c => c.charCodeAt(0));"
                    + "  const domain = new TextEncoder().encode('ForMyself/Kanata/KEK/v1\\0');"
                    + "  const domainSalt = new Uint8Array(domain.length + saltRaw.length);"
                    + "  domainSalt.set(domain, 0); domainSalt.set(saltRaw, domain.length);"
                    + "  const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(" + JSONObject.quote(MASTER_PW) + "), 'PBKDF2', false, ['deriveBits']);"
                    + "  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: domainSalt, iterations: 600000, hash: 'SHA-256' }, keyMat, 256);"
                    + "  const kekBytes = new Uint8Array(bits);"
                    + "  const kekHex = Array.from(kekBytes, b => b.toString(16).padStart(2, '0')).join('');"
                    + "  const unlocked = await SQL.unlock({ token: prep.token, kek: kekHex, sessionRevision: 1, ownerGeneration: 1 });"
                    + "  await SQL.completeOpen({ lease: unlocked.lease, sessionRevision: 1, ownerGeneration: 1 });"
                    + "  const tx = await SQL.begin({ lease: unlocked.lease, sessionRevision: 1, ownerGeneration: 1 });"
                    + "  const worldRes = await SQL.query({ lease: unlocked.lease, transaction: tx.transaction, sessionRevision: 1, ownerGeneration: 1, statement: " + JSONObject.quote(STMT_LIST_WORLDS) + ", parameters: [0, 10] });"
                    + "  const cnt1 = await SQL.query({ lease: unlocked.lease, transaction: tx.transaction, sessionRevision: 1, ownerGeneration: 1, statement: " + JSONObject.quote(STMT_COUNT_MESSAGES_IN_CONV) + ", parameters: ['w1', 'c1'] });"
                    + "  const cnt2 = await SQL.query({ lease: unlocked.lease, transaction: tx.transaction, sessionRevision: 1, ownerGeneration: 1, statement: " + JSONObject.quote(STMT_COUNT_MESSAGES_IN_CONV) + ", parameters: ['w1', 'c2'] });"
                    + "  await SQL.rollback({ lease: unlocked.lease, transaction: tx.transaction, sessionRevision: 1, ownerGeneration: 1 });"
                    + "  await SQL.close();"
                    + "  return {"
                    + "    ok: true,"
                    + "    prepActiveGen: prep.activeGenerationId,"
                    + "    unlockedActiveGen: unlocked.activeGenerationId,"
                    + "    worldTitle: worldRes.rows?.[0]?.title || '',"
                    + "    businessMessageCount: (cnt1.rows?.[0]?.count ?? 0) + (cnt2.rows?.[0]?.count ?? 0)"
                    + "  };"
                    + "})()";

            JSONObject resCD = evalAsyncJsInMainActivity(restarted, scenarioC2AndDJs, 60_000L);
            assertTrue("Restart recovery + business SQLite read failed: " + resCD, resCD.optBoolean("ok", false));

            List<String> traceRecovery = KanataM6RestoreBridgePlugin.snapshotCallTrace();
            int iRecPrep = traceRecovery.indexOf("prepareRecoveryDecision");
            int iRecApply = traceRecovery.indexOf("verifyAndApplyGeneration");
            int iRecFin = traceRecovery.indexOf("finalizeTransaction");
            assertTrue("Restart recovery must run through RestoreCoordinator (prepareRecoveryDecision -> verifyAndApplyGeneration -> finalizeTransaction): "
                    + traceRecovery, iRecPrep >= 0 && iRecApply > iRecPrep && iRecFin > iRecApply);

            // R03.1 assertions: ordinary KanataSqlitePlugin business query MUST read Backup C target (75 messages, world-r01-postdec-75)!
            assertEquals(genAfterC, resCD.getString("prepActiveGen"));
            assertEquals(genAfterC, resCD.getString("unlockedActiveGen"));
            assertEquals("world-r01-postdec-75", resCD.getString("worldTitle"));
            assertEquals(75L, resCD.getLong("businessMessageCount"));

            Log.i(TAG, "R01_R03_REAL_APP_WEBVIEW_E2E=" + new JSONObject()
                    .put("traceA", new JSONArray(traceA))
                    .put("traceRecovery", new JSONArray(traceRecovery))
                    .put("genAfterA", genAfterA)
                    .put("genAfterC", genAfterC)
                    .put("businessWorldTitle", resCD.getString("worldTitle"))
                    .put("businessMessageCount", resCD.getLong("businessMessageCount"))
                    .toString());
        }
    }

    /**
     * R01.3 / R01.4 / R01.5 / R01.6 Native State Machine Strict Gates (runs on API 34, 24, 25):
     * - PREPARED strictly forbids OP_APPLY_GENERATION and OP_FINALIZE capabilities (RECOVERY_CAPABILITY_STATE_INVALID).
     * - DECISION strictly forbids FINALIZED without verification receipt (FINALIZE_UNVERIFIED_GENERATION).
     * - DECISION(target) strictly forbids reversing to DECISION(previous) (CAS_DIRECTION_IRREVERSIBLE).
     */
    @Test
    public void r01_nativeStateMachineStrictGates() throws Exception {
        KanataDurableTxControl.GenerationRegistration prevGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-gate-prev", 10, 5001L);
        File targetKpb1 = exportSyntheticKpb1("gate-target-25", 25, 5002L);
        KanataM6GenerationStore.StagedGenerationResult staged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, targetKpb1, BACKUP_PW, MASTER_PW,
                "gate-t1", "owner-gate", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        KanataDurableTxControl.AuthoritativeState st0 = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-r01-gates", "owner-gate", 1L,
                st0.headRecord.sequence, st0.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, null, prevGen.generationId, staged.artifact.transcriptHex, "",
                "gate", "kanata-portable-restore", "kanata-portable-v1",
                Arrays.asList("kanata", "todo", "settings", "vault"), false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gated.txnId, gated.ownerId, gated.epoch,
                gated.sequence, gated.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, staged.registration, prevGen.generationId,
                staged.artifact.transcriptHex, "", "prepared",
                gated.kind, gated.scope, gated.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // 1) In PREPARED, issuing APPLY_GENERATION or FINALIZE MUST be rejected!
        try {
            KanataDurableTxControl.issueRecoveryCapability(
                    ctx, controlRoot, prepared.txnId, "kanata", KanataDurableTxControl.OP_APPLY_GENERATION,
                    staged.registration.generationId, prepared.ownerId, prepared.epoch, 60_000L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("OP_APPLY_GENERATION must be forbidden in STATE_PREPARED");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RECOVERY_CAPABILITY_STATE_INVALID", expected.code);
        }
        try {
            KanataDurableTxControl.issueRecoveryCapability(
                    ctx, controlRoot, prepared.txnId, "kanata", KanataDurableTxControl.OP_FINALIZE,
                    staged.registration.generationId, prepared.ownerId, prepared.epoch, 60_000L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("OP_FINALIZE must be forbidden in STATE_PREPARED");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RECOVERY_CAPABILITY_STATE_INVALID", expected.code);
        }

        // 2) Advance PREPARED -> DECISION(target)
        KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, prepared.txnId, prepared.ownerId, prepared.epoch,
                prepared.sequence, prepared.recordDigest,
                KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                false, prepared.preparedDigest, prepared.previousGeneration, prepared.targetGeneration,
                staged.registration.generationId, prepared.inputDigest, prepared.payloadId, "decided-target",
                prepared.kind, prepared.scope, prepared.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // 3) Reversing DECISION(target) -> DECISION(previous) MUST be rejected!
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, decided.txnId, decided.ownerId, decided.epoch,
                    decided.sequence, decided.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_PREVIOUS,
                    false, decided.preparedDigest, decided.previousGeneration, decided.targetGeneration,
                    prevGen.generationId, decided.inputDigest, decided.payloadId, "reverse-attempt",
                    decided.kind, decided.scope, decided.participants, false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Reversing DECISION direction must be rejected");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_DIRECTION_IRREVERSIBLE", expected.code);
        }

        // 4) Finalizing BEFORE selected generation verification receipt MUST be rejected!
        try {
            KanataDurableTxControl.assertDecisionGenerationVerified(
                    ctx, controlRoot, decided, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("FINALIZED before verification receipt must be rejected");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("FINALIZE_UNVERIFIED_GENERATION", expected.code);
        }

        // 5) Verify selected generation + persist HMAC receipt -> now assertDecisionGenerationVerified passes!
        KanataM6GenerationStore.ActiveGenerationHealth h = KanataM6GenerationStore.openAndVerifyGeneration(
                controlRoot, staged.registration.generationId, MASTER_PW);
        assertEquals(25L, h.messageCount);
        KanataDurableTxControl.recordDecisionGenerationVerified(
                ctx, controlRoot, decided, staged.registration,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        KanataDurableTxControl.assertDecisionGenerationVerified(
                ctx, controlRoot, decided, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        Log.i(TAG, "R01_NATIVE_STATE_GATES=PASS");
    }

    /**
     * R02 Exclusive Generation Reservation & Ownership Protection Matrix (runs on API 34, 24, 25).
     */
    @Test
    public void r02_exclusiveGenerationReservationAndOwnershipProtection() throws Exception {
        KanataDurableTxControl.GenerationRegistration activeGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-active-r02", 18, 6001L);
        File validKpb1 = exportSyntheticKpb1("r02-valid-40", 40, 6002L);
        File corruptKpb1 = new File(testRoot, "r02-corrupt.kpb1");
        try (FileOutputStream fos = new FileOutputStream(corruptKpb1)) {
            fos.write("NOT_A_VALID_KPB1_STREAM".getBytes(StandardCharsets.UTF_8));
        }

        // Capture baseline hashes of active generation materials & head!
        File activeDb = KanataDurableTxControl.generationDbFile(controlRoot, activeGen.generationId);
        File activeEnv = KanataDurableTxControl.generationEnvelopeFile(controlRoot, activeGen.generationId);
        File activeManifest = KanataDurableTxControl.generationManifestFile(controlRoot, activeGen.generationId);
        File headFile = new File(controlRoot, "head.json");
        String origDbSha = KanataDurableTxControl.sha256FileHex(activeDb);
        String origEnvSha = KanataDurableTxControl.sha256FileHex(activeEnv);
        String origManifestSha = KanataDurableTxControl.sha256FileHex(activeManifest);
        String origHeadSha = KanataDurableTxControl.sha256FileHex(headFile);

        // Case 1: Duplicate active generation taskId ("active-r02" -> genId "gen-active-r02") with valid KPB1
        try {
            KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, controlRoot, null, validKpb1, BACKUP_PW, MASTER_PW,
                    "active-r02", "attacker", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Duplicate active generation taskId must be rejected");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("GENERATION_ID_CONFLICT", expected.code);
        }
        assertEquals(origDbSha, KanataDurableTxControl.sha256FileHex(activeDb));
        assertEquals(origEnvSha, KanataDurableTxControl.sha256FileHex(activeEnv));
        assertEquals(origManifestSha, KanataDurableTxControl.sha256FileHex(activeManifest));
        assertEquals(origHeadSha, KanataDurableTxControl.sha256FileHex(headFile));

        // Case 2: Wrong password / corrupt KPB1 targeting the SAME active taskId -> MUST NOT delete active gen!
        try {
            KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, controlRoot, null, corruptKpb1, "WrongPw!", MASTER_PW,
                    "active-r02", "attacker", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Corrupt KPB1 on active taskId must be rejected before touching files");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("GENERATION_ID_CONFLICT", expected.code);
        }
        assertTrue(activeDb.isFile());
        assertEquals(origDbSha, KanataDurableTxControl.sha256FileHex(activeDb));
        assertEquals(origEnvSha, KanataDurableTxControl.sha256FileHex(activeEnv));
        assertEquals(origManifestSha, KanataDurableTxControl.sha256FileHex(activeManifest));
        assertEquals(origHeadSha, KanataDurableTxControl.sha256FileHex(headFile));

        // Case 3: Two concurrent tasks racing for the SAME brand-new generationId ("race-1" -> "gen-race-1")
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<String>> futures = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                final String owner = "racer-" + i;
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await(5, TimeUnit.SECONDS);
                    try {
                        KanataM6GenerationStore.stageKpb1IntoGeneration(
                                ctx, controlRoot, null, validKpb1, BACKUP_PW, MASTER_PW,
                                "race-1", owner, 1L, 1L, catalog, 500, new AtomicBoolean(false),
                                new KanataM6StagingRestoreEngine.StagingHooks() {},
                                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                        return "WON:" + owner;
                    } catch (KanataDurableTxControl.TxControlException ex) {
                        return "REJECTED:" + ex.code;
                    }
                }));
            }
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            go.countDown();
            String r0 = futures.get(0).get(30, TimeUnit.SECONDS);
            String r1 = futures.get(1).get(30, TimeUnit.SECONDS);
            int wins = (r0.startsWith("WON:") ? 1 : 0) + (r1.startsWith("WON:") ? 1 : 0);
            int rejects = (r0.startsWith("REJECTED:") ? 1 : 0) + (r1.startsWith("REJECTED:") ? 1 : 0);
            assertEquals("Exactly 1 racer must win: " + r0 + " / " + r1, 1, wins);
            assertEquals("Exactly 1 racer must be rejected: " + r0 + " / " + r1, 1, rejects);
            String rej = r0.startsWith("REJECTED:") ? r0 : r1;
            assertTrue("Expected GENERATION_ID_IN_USE or GENERATION_ALREADY_EXISTS, got " + rej,
                    rej.contains("GENERATION_ID_IN_USE") || rej.contains("GENERATION_ALREADY_EXISTS"));
            // Winner's directory must still be completely intact & readable!
            assertEquals(40L, KanataM6GenerationStore.openAndVerifyGeneration(controlRoot, "gen-race-1", MASTER_PW).messageCount);
        } finally {
            pool.shutdownNow();
        }

        // Case 4: Wrong password on a brand-new unused taskId cleans ONLY its own directory; active gen untouched!
        try {
            KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, controlRoot, null, validKpb1, "WrongBackupPassword!", MASTER_PW,
                    "ephemeral-fail-1", "owner-fail", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Wrong backup password must fail");
        } catch (KanataM6PortableCrypto.PortableException expected) {
            assertEquals("AUTH_FAILED", expected.code);
        }
        assertFalse("Failed newly created dir must be cleaned by its owner",
                KanataDurableTxControl.generationDir(controlRoot, "gen-ephemeral-fail-1").exists());
        assertEquals(origDbSha, KanataDurableTxControl.sha256FileHex(activeDb));
        assertEquals(origHeadSha, KanataDurableTxControl.sha256FileHex(headFile));

        // Case 5: Cancel race during staging + external GC attempt while reserved!
        AtomicBoolean cancelFlag = new AtomicBoolean(false);
        AtomicReference<String> externalGcCode = new AtomicReference<>("");
        try {
            KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, controlRoot, null, validKpb1, BACKUP_PW, MASTER_PW,
                    "cancel-race-1", "owner-cancel", 1L, 1L, catalog, 500, cancelFlag,
                    new KanataM6StagingRestoreEngine.StagingHooks() {
                        @Override
                        public void afterBatchCommit(String tableName, int batchIndex, int rowsInBatch, long batchMs) {
                            if (batchIndex == 1 && externalGcCode.get().isEmpty()) {
                                // While reserved, external destroy MUST be blocked with GENERATION_ID_IN_USE!
                                try {
                                    KanataDurableTxControl.destroyUnreferencedGeneration(
                                            ctx, controlRoot, "gen-cancel-race-1", null,
                                            KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
                                } catch (KanataDurableTxControl.TxControlException ex) {
                                    externalGcCode.set(ex.code);
                                }
                                cancelFlag.set(true);
                            }
                        }
                    },
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Cancelled staging must throw CANCELLED");
        } catch (KanataM6PortableCrypto.PortableException expected) {
            assertEquals("CANCELLED", expected.code);
        }
        assertEquals("GENERATION_ID_IN_USE", externalGcCode.get());
        assertFalse("Owner must clean its own cancelled dir after releasing reservation",
                KanataDurableTxControl.generationDir(controlRoot, "gen-cancel-race-1").exists());

        // Case 6: PREPARED-referenced generation encounters duplicate creation -> rejected & byte-identical!
        KanataM6GenerationStore.StagedGenerationResult prepStaged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, validKpb1, BACKUP_PW, MASTER_PW,
                "prep-protected", "owner-prep", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        KanataDurableTxControl.AuthoritativeState st0 = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-r02-prep", "owner-prep", 1L,
                st0.headRecord.sequence, st0.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", activeGen, null, activeGen.generationId, prepStaged.artifact.transcriptHex, "",
                "gate", "kanata-portable-restore", "kanata-portable-v1",
                Arrays.asList("kanata", "todo"), false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gated.txnId, gated.ownerId, gated.epoch,
                gated.sequence, gated.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                false, "", activeGen, prepStaged.registration, activeGen.generationId,
                prepStaged.artifact.transcriptHex, "", "prepared",
                gated.kind, gated.scope, gated.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        File prepDb = KanataDurableTxControl.generationDbFile(controlRoot, prepStaged.registration.generationId);
        String prepDbSha = KanataDurableTxControl.sha256FileHex(prepDb);
        String headBeforeDupPrep = KanataDurableTxControl.sha256FileHex(headFile);

        try {
            KanataM6GenerationStore.stageKpb1IntoGeneration(
                    ctx, controlRoot, null, corruptKpb1, "WrongPw", MASTER_PW,
                    "prep-protected", "attacker", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                    new KanataM6StagingRestoreEngine.StagingHooks() {},
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Duplicate staging on PREPARED generation must be rejected");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("GENERATION_ID_CONFLICT", expected.code);
        }
        assertEquals(prepDbSha, KanataDurableTxControl.sha256FileHex(prepDb));
        assertEquals(headBeforeDupPrep, KanataDurableTxControl.sha256FileHex(headFile));
        assertEquals(origDbSha, KanataDurableTxControl.sha256FileHex(activeDb));

        Log.i(TAG, "R02_EXCLUSIVE_OWNERSHIP_MATRIX=PASS");
    }

    /**
     * R03.5 & R03.6 Negative CAS Matrix:
     * After PREPARED, substituting previousGeneration, targetGeneration, participants, scope,
     * inputDigest, or payloadId in DECISION or FINALIZED while keeping the old preparedDigest
     * MUST be strictly rejected with CAS_PREPARED_BINDING_IMMUTABLE!
     */
    @Test
    public void r03_preparedBindingsImmutableNegativeCasMatrix() throws Exception {
        KanataDurableTxControl.GenerationRegistration prevGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-imm-prev", 12, 7001L);
        File kpb1 = exportSyntheticKpb1("imm-target-22", 22, 7002L);
        File kpb2 = exportSyntheticKpb1("imm-rogue-33", 33, 7003L);
        KanataM6GenerationStore.StagedGenerationResult legit = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, kpb1, BACKUP_PW, MASTER_PW,
                "imm-legit", "owner-imm", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        KanataM6GenerationStore.StagedGenerationResult rogue = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, kpb2, BACKUP_PW, MASTER_PW,
                "imm-rogue", "owner-imm", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        KanataDurableTxControl.AuthoritativeState st0 = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-r03-imm", "owner-imm", 1L,
                st0.headRecord.sequence, st0.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, null, prevGen.generationId, legit.artifact.transcriptHex, "pl-orig",
                "gate", "kanata-portable-restore", "kanata-portable-v1",
                Arrays.asList("kanata", "todo", "settings", "vault"), false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gated.txnId, gated.ownerId, gated.epoch,
                gated.sequence, gated.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, legit.registration, prevGen.generationId,
                legit.artifact.transcriptHex, "pl-orig", "prepared",
                gated.kind, gated.scope, gated.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // Attempt 1: Replace targetGeneration with rogue generation while keeping old preparedDigest
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.previousGeneration, rogue.registration, prepared.inputDigest, prepared.payloadId,
                prepared.scope, prepared.participants, "target-replace");
        // Attempt 2: Replace previousGeneration with rogue generation
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                rogue.registration, prepared.targetGeneration, prepared.inputDigest, prepared.payloadId,
                prepared.scope, prepared.participants, "prev-replace");
        // Attempt 3: Mutate participants list
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.previousGeneration, prepared.targetGeneration, prepared.inputDigest, prepared.payloadId,
                prepared.scope, Collections.singletonList("kanata"), "participants-replace");
        // Attempt 4: Mutate scope
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.previousGeneration, prepared.targetGeneration, prepared.inputDigest, prepared.payloadId,
                "tampered-scope", prepared.participants, "scope-replace");
        // Attempt 5: Mutate inputDigest
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.previousGeneration, prepared.targetGeneration, "0".repeat(64), prepared.payloadId,
                prepared.scope, prepared.participants, "inputDigest-replace");
        // Attempt 6: Mutate payloadId
        assertCasImmutableRejected(prepared, KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.previousGeneration, prepared.targetGeneration, prepared.inputDigest, "pl-tampered",
                prepared.scope, prepared.participants, "payloadId-replace");

        // Head must still be unchanged at `prepared`!
        KanataDurableTxControl.AuthoritativeState afterNeg = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals(prepared.sequence, afterNeg.headRecord.sequence);
        assertEquals(prepared.recordDigest, afterNeg.headRecord.recordDigest);

        // Now legitimately transition to DECISION(target), and assert FINALIZED ALSO rejects target replacement!
        KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, prepared.txnId, prepared.ownerId, prepared.epoch,
                prepared.sequence, prepared.recordDigest,
                KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.abortOnly, prepared.preparedDigest, prepared.previousGeneration, prepared.targetGeneration,
                legit.registration.generationId, prepared.inputDigest, prepared.payloadId, "decided-legit",
                prepared.kind, prepared.scope, prepared.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        assertCasImmutableRejected(decided, KanataDurableTxControl.STATE_FINALIZED, KanataDurableTxControl.DIR_TARGET,
                decided.previousGeneration, rogue.registration, decided.inputDigest, decided.payloadId,
                decided.scope, decided.participants, "finalize-target-replace");

        Log.i(TAG, "R03_PREPARED_IMMUTABLE_CAS_MATRIX=PASS");
    }

    private void assertCasImmutableRejected(
            KanataDurableTxControl.ControlRecord cur,
            String nextState,
            String nextDir,
            KanataDurableTxControl.GenerationRegistration prev,
            KanataDurableTxControl.GenerationRegistration target,
            String inputDigest,
            String payloadId,
            String scope,
            List<String> participants,
            String label) {
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, cur.txnId, cur.ownerId, cur.epoch,
                    cur.sequence, cur.recordDigest,
                    nextState, nextDir, cur.abortOnly, cur.preparedDigest,
                    prev, target, cur.activeGenerationId, inputDigest, payloadId, label,
                    cur.kind, scope, participants, false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_PREPARED_BINDING_IMMUTABLE for " + label);
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals(label, "CAS_PREPARED_BINDING_IMMUTABLE", expected.code);
        }
    }

    /**
     * R03.1 / R03.4 Authoritative Routing & Fence Verification across all Native write surfaces (runs on API 34, 24, 25).
     */
    @Test
    public void r03_authoritativeRoutingAndFullNativeFenceEnforcement() throws Exception {
        KanataDurableTxControl.GenerationRegistration prevGen =
                seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-route-prev", 15, 8001L);
        File targetKpb1 = exportSyntheticKpb1("route-target-52", 52, 8002L);
        KanataM6GenerationStore.StagedGenerationResult staged = KanataM6GenerationStore.stageKpb1IntoGeneration(
                ctx, controlRoot, null, targetKpb1, BACKUP_PW, MASTER_PW,
                "route-t1", "owner-route", 1L, 1L, catalog, 500, new AtomicBoolean(false),
                new KanataM6StagingRestoreEngine.StagingHooks() {},
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        // Before switch: authoritative open reads prevGen (15 msgs)
        assertEquals(15L, KanataM6GenerationStore.openAuthoritativeActiveGeneration(
                ctx, controlRoot, MASTER_PW, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE).messageCount);

        // Enter GATE + drain
        KanataSqlitePlugin.drainAndRevokeAllInstances();
        KanataDurableTxControl.AuthoritativeState st0 = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord gated = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-r03-route", "owner-route", 1L,
                st0.headRecord.sequence, st0.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, null, prevGen.generationId, staged.artifact.transcriptHex, "",
                "gate", "kanata-portable-restore", "kanata-portable-v1",
                Arrays.asList("kanata", "todo", "settings", "vault"), false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // Under GATE: verify TodoRepository CAS, Widget toggle, ArchiveFileBatch fence, and ordinary SQLite/Reminder fence ALL block!
        try {
            TodoRepository.toggleCompleted(ctx, "any", TodoRepository.today());
            fail("Widget write must be blocked under GATE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RESTORE_RECOVERY_REQUIRED", expected.code);
            assertEquals("RESTORE_RECOVERY_REQUIRED", expected.getMessage());
        }
        try {
            KanataDurableTxControl.assertOrdinaryWriteAllowed(
                    ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Ordinary SQLite / Reminder / Archive write fence must block under GATE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RESTORE_RECOVERY_REQUIRED", expected.code);
        }

        // Complete PREPARED -> DECISION(target) -> verify -> FINALIZED
        KanataDurableTxControl.ControlRecord prepared = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gated.txnId, gated.ownerId, gated.epoch,
                gated.sequence, gated.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                false, "", prevGen, staged.registration, prevGen.generationId,
                staged.artifact.transcriptHex, "", "prepared",
                gated.kind, gated.scope, gated.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord decided = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, prepared.txnId, prepared.ownerId, prepared.epoch,
                prepared.sequence, prepared.recordDigest,
                KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                prepared.abortOnly, prepared.preparedDigest, prepared.previousGeneration, prepared.targetGeneration,
                staged.registration.generationId, prepared.inputDigest, prepared.payloadId, "decided-target",
                prepared.kind, prepared.scope, prepared.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataM6GenerationStore.openAndVerifyGeneration(controlRoot, staged.registration.generationId, MASTER_PW);
        KanataDurableTxControl.recordDecisionGenerationVerified(
                ctx, controlRoot, decided, staged.registration,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        KanataDurableTxControl.assertDecisionGenerationVerified(
                ctx, controlRoot, decided, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, decided.txnId, decided.ownerId, decided.epoch,
                decided.sequence, decided.recordDigest,
                KanataDurableTxControl.STATE_FINALIZED, KanataDurableTxControl.DIR_TARGET,
                decided.abortOnly, decided.preparedDigest, decided.previousGeneration, decided.targetGeneration,
                staged.registration.generationId, decided.inputDigest, decided.payloadId, "finalized",
                decided.kind, decided.scope, decided.participants, false, 0L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // After FINALIZED: authoritative open reads target (52 msgs), NOT prevGen (15 msgs)!
        KanataM6GenerationStore.ActiveGenerationHealth active =
                KanataM6GenerationStore.openAuthoritativeActiveGeneration(
                        ctx, controlRoot, MASTER_PW, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        assertEquals(staged.registration.generationId, active.activeGenerationId);
        assertEquals(52L, active.messageCount);

        Log.i(TAG, "R03_AUTHORITATIVE_ROUTING_AND_FENCE=PASS");
    }

    /**
     * R03.7 & R03.8 Cold-Start Read-Only Five-Path Inventory:
     * Proves orphan legacy markers (restore-v1.commit / restore-v1.tmp without restore-v1.enc)
     * are detected and BLOCKED by read-only Native probe WITHOUT deleting them and WITHOUT
     * auto-upgrading them into a new protocol decision!
     */
    @Test
    public void r03_coldStartReadOnlyFivePathInventoryPreservesOrphanMarker() throws Exception {
        seedControlRootWithInitialGen(controlRoot, hmacAlias, aeadAlias, "gen-orphan-init", 12, 9001L);
        File formyselfDir = new File(ctx.getFilesDir(), "formyself");
        if (!formyselfDir.exists()) assertTrue(formyselfDir.mkdirs());
        File orphanCommit = new File(formyselfDir, "restore-v1.commit");
        File orphanTmp = new File(formyselfDir, "restore-v1.tmp");
        try (FileOutputStream fos = new FileOutputStream(orphanCommit)) {
            fos.write("{\"digest\":\"0000\"}".getBytes(StandardCharsets.UTF_8));
        }
        try (FileOutputStream fos = new FileOutputStream(orphanTmp)) {
            fos.write("orphan-tmp".getBytes(StandardCharsets.UTF_8));
        }

        // Candidate cold-start runs read-only Native probe FIRST (never calling legacy restoreJournal.inspect()!).
        KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                ctx, controlRoot, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue("Orphan markers must block cold start", st.blocked);
        assertEquals("BLOCKED_LEGACY_CONFLICT", st.recoveryAction);
        assertFalse(st.legacyInventory.clean);
        assertTrue(st.legacyInventory.orphanOrConflict);
        // Critical R03.7 check: orphan files MUST STILL EXIST on disk untouched!
        assertTrue("Read-only probe must NOT delete restore-v1.commit", orphanCommit.isFile());
        assertTrue("Read-only probe must NOT delete restore-v1.tmp", orphanTmp.isFile());
        // Critical R03.8 check: cold-start recovery MUST NOT auto-upgrade orphan marker into new protocol decision!
        try {
            KanataM6RestoreBridgePlugin.executeAuthoritativeColdStartRecovery(
                    ctx, controlRoot, MASTER_PW, "orphan-no-upgrade",
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Must not auto-upgrade orphan legacy marker");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertNotNull(expected.code);
        }
        assertTrue("Orphan commit must remain untouched after rejected recovery", orphanCommit.isFile());

        Log.i(TAG, "R03_READ_ONLY_FIVE_PATH_ORPHAN_PRESERVED=PASS");
    }
}
