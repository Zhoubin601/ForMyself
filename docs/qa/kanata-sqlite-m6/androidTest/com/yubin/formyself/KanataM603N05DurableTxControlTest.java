package com.yubin.formyself;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.UUID;

import static org.junit.Assert.*;

/**
 * M6-03-R / N-05 Native Durable Transaction Control Layer Verification Suite.
 *
 * Verified on API 24, API 25, and API 33/34 real emulators BEFORE product entry wiring:
 * - Real AndroidKeyStore 256-bit HMAC-SHA256 + AES-256-GCM cold-start durability
 * - Authoritative head & immutable content-addressed records (no scan/guess when head missing)
 * - Strict in-lock CAS state machine (GATE -> PREPARED -> DECISION -> FINALIZED) & irreversible direction
 * - Tamper, replay, unknown protocol version, missing key, H-05 all-5-path legacy inventory & conflict
 * - Deterministic fault injection: ENOSPC write, file fsync, rename, parent dir fsync (DURABILITY_UNCONFIRMED), readback
 * - Cross-process control.lock + CAS contention (:m6worker), FIX-04 stable lock inode invariant
 * - Shared Todo/Widget ordinary write fence + unforgeable Native RecoveryCapability enforcement
 * - Real separate-process SIGKILL at GATE, PREPARED, before-head-rename, DECISION(target) + authoritative cold-start probe
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class KanataM603N05DurableTxControlTest {
    private static final String TAG = "KanataM603N05";

    private Context ctx;
    private File testRoot;
    private File controlRoot;
    private String hmacAlias;
    private String aeadAlias;

    @Before
    public void setUp() {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        testRoot = new File(ctx.getNoBackupFilesDir(), "n05-test-" + suffix);
        assertTrue(testRoot.mkdirs() || testRoot.isDirectory());
        controlRoot = new File(testRoot, "tx-control");
        hmacAlias = "com.yubin.formyself.n05.hmac." + suffix;
        aeadAlias = "com.yubin.formyself.n05.aead." + suffix;
        cleanupLegacyFiles();
    }

    @After
    public void tearDown() {
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

    private KanataDurableTxControl.GenerationRegistration createSealedDummyGeneration(String genId, String markerText) throws Exception {
        File genDir = KanataDurableTxControl.generationDir(controlRoot, genId);
        assertTrue(genDir.mkdirs() || genDir.isDirectory());
        File db = new File(genDir, "kanata.db");
        File env = new File(genDir, "envelope.json");
        writeBytes(db, ("synthetic-db-" + genId + "-" + markerText).getBytes(StandardCharsets.UTF_8));
        writeBytes(env, ("{\"version\":1,\"gen\":\"" + genId + "\"}").getBytes(StandardCharsets.UTF_8));
        KanataDurableTxControl.GenerationRegistration reg = new KanataDurableTxControl.GenerationRegistration(
                genId,
                false,
                "generations/" + genId,
                KanataDurableTxControl.sha256FileHex(db),
                KanataDurableTxControl.sha256FileHex(env),
                "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a",
                "sqlcipher-4.17.0",
                "ForMyself/Kanata/KEK/v1",
                "kds-" + genId,
                12L,
                50);
        KanataDurableTxControl.sealGenerationDirectory(controlRoot, reg, KanataDurableTxControl.FaultInjector.NONE);
        return reg;
    }

    private static void writeBytes(File f, byte[] data) throws IOException {
        File p = f.getParentFile();
        if (p != null && !p.exists()) p.mkdirs();
        try (FileOutputStream fos = new FileOutputStream(f, false)) {
            fos.write(data);
            fos.flush();
            fos.getFD().sync();
        }
    }

    @Test
    public void n05_01_keystoreHmacAeadAndColdStartPersistence() throws Exception {
        KanataDurableTxControl.GenerationRegistration gen0 = createSealedDummyGeneration("gen-init-0", "initial");
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.initializeControlRoot(
                ctx, controlRoot, hmacAlias, aeadAlias, gen0.generationId, gen0,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        assertTrue(init.initialized);
        assertFalse(init.blocked);
        assertEquals("READY", init.recoveryAction);
        assertEquals(0L, init.headRecord.sequence);
        assertEquals(gen0.generationId, init.headRecord.activeGenerationId);

        // Re-initializing an already registered root MUST fail (G-04: never blank existing control root).
        try {
            KanataDurableTxControl.initializeControlRoot(
                    ctx, controlRoot, hmacAlias, aeadAlias, gen0.generationId, gen0,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected refusal to re-initialize existing control root");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("TX_CONTROL_ALREADY_INITIALIZED_OR_CORRUPT", expected.code);
        }

        // Independent AndroidKeyStore AES-256-GCM payload round-trip + domain AAD rejection.
        byte[] secretPayload = "{\"previous\":\"gen-init-0\",\"note\":\"synthetic-only\"}".getBytes(StandardCharsets.UTF_8);
        String payloadId = KanataDurableTxControl.writeEncryptedPayload(
                ctx, controlRoot, "txn-aead-1", "recovery-state", gen0.generationId, secretPayload,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        byte[] opened = KanataDurableTxControl.readEncryptedPayload(
                ctx, controlRoot, payloadId, "txn-aead-1", "recovery-state", gen0.generationId,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertArrayEquals(secretPayload, opened);

        // Wrong txn/role binding MUST fail!
        try {
            KanataDurableTxControl.readEncryptedPayload(
                    ctx, controlRoot, payloadId, "txn-WRONG", "recovery-state", gen0.generationId,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected binding mismatch");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("TX_PAYLOAD_BINDING_MISMATCH", expected.code);
        }

        // Deleting Keystore HMAC key -> probe MUST return blocked=true (TX_CONTROL_KEY_UNAVAILABLE), never rebuild!
        deleteKeystoreAliasQuiet(hmacAlias);
        KanataDurableTxControl.AuthoritativeState missingKey = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(missingKey.blocked);
        assertEquals("TX_CONTROL_KEY_UNAVAILABLE", missingKey.reasonCode);
        assertEquals("BLOCKED_CORRUPT_OR_UNKNOWN", missingKey.recoveryAction);

        Log.i(TAG, "N05_01_KEYSTORE_PERSIST=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("keystoreHmacAeadOk", true)
                .put("missingKeyBlocked", true)
                .toString());
    }

    @Test
    public void n05_02_strictStateMachineCasAndIrreversibleDirection() throws Exception {
        KanataDurableTxControl.GenerationRegistration genPrev = createSealedDummyGeneration("gen-prev-1", "prev");
        KanataDurableTxControl.GenerationRegistration genTarg = createSealedDummyGeneration("gen-targ-1", "targ");
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.initializeControlRoot(
                ctx, controlRoot, hmacAlias, aeadAlias, genPrev.generationId, genPrev,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // Illegal direct FINALIZED -> DECISION edge rejected
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-bad", "owner-A", 1L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                    false, "deadbeef", genPrev, genTarg, genTarg.generationId,
                    "in", "", "bad", "restore", "kanata", Arrays.asList("kanata"),
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_ILLEGAL_EDGE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_ILLEGAL_EDGE", expected.code);
        }

        // 1) FINALIZED -> GATE
        KanataDurableTxControl.ControlRecord gate = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-main-1", "owner-A", 1L,
                init.headRecord.sequence, init.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", genPrev, null, genPrev.generationId,
                "in-1", "", "gate", "restore", "kanata", Arrays.asList("kanata", "todo"),
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals(1L, gate.sequence);
        assertEquals(KanataDurableTxControl.STATE_GATE, gate.state);

        // 2) GATE -> PREPARED
        KanataDurableTxControl.ControlRecord prep = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gate.txnId, "owner-A", gate.epoch,
                gate.sequence, gate.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                false, "", genPrev, genTarg, genPrev.generationId,
                "in-1", "", "prepared", "restore", "kanata", gate.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals(2L, prep.sequence);
        assertEquals(64, prep.preparedDigest.length());

        // Wrong preparedDigest MUST be rejected on DECISION
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, prep.txnId, "owner-A", prep.epoch,
                    prep.sequence, prep.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                    false, "0000000000000000000000000000000000000000000000000000000000000000",
                    genPrev, genTarg, genTarg.generationId,
                    "in-1", "", "wrong-prep", "restore", "kanata", prep.participants,
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_PREPARED_DIGEST_MISMATCH");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_PREPARED_DIGEST_MISMATCH", expected.code);
        }

        // 3) PREPARED -> DECISION(target)
        KanataDurableTxControl.ControlRecord dec = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, prep.txnId, "owner-A", prep.epoch,
                prep.sequence, prep.recordDigest,
                KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                false, prep.preparedDigest, genPrev, genTarg, genTarg.generationId,
                "in-1", "", "decided-target", "restore", "kanata", prep.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals(KanataDurableTxControl.STATE_DECISION, dec.state);
        assertEquals(KanataDurableTxControl.DIR_TARGET, dec.decisionDirection);
        assertEquals(genTarg.generationId, dec.activeGenerationId);

        // Attempt to reverse DECISION(target) -> DECISION(previous) MUST fail!
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, dec.txnId, "owner-A", dec.epoch,
                    dec.sequence, dec.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_PREVIOUS,
                    false, dec.preparedDigest, genPrev, genTarg, genPrev.generationId,
                    "in-1", "", "reverse-attempt", "restore", "kanata", dec.participants,
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_DIRECTION_IRREVERSIBLE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_DIRECTION_IRREVERSIBLE", expected.code);
        }

        // Owner takeover with higher epoch succeeds and invalidates old owner
        KanataDurableTxControl.ControlRecord progress = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, dec.txnId, "owner-RECOVERY", dec.epoch,
                dec.sequence, dec.recordDigest,
                KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                false, dec.preparedDigest, genPrev, genTarg, genTarg.generationId,
                "in-1", "", "replay-verified", "restore", "kanata", dec.participants,
                true, dec.epoch + 1L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals("owner-RECOVERY", progress.ownerId);
        assertEquals(dec.epoch + 1L, progress.epoch);

        // Old owner attempt rejected
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, progress.txnId, "owner-A", dec.epoch,
                    progress.sequence, progress.recordDigest,
                    KanataDurableTxControl.STATE_FINALIZED, KanataDurableTxControl.DIR_TARGET,
                    false, progress.preparedDigest, genPrev, genTarg, genTarg.generationId,
                    "in-1", "", "stale-owner", "restore", "kanata", progress.participants,
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_OWNER_OR_EPOCH_MISMATCH");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_OWNER_OR_EPOCH_MISMATCH", expected.code);
        }

        // 4) DECISION(target) -> FINALIZED
        KanataDurableTxControl.ControlRecord fin = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, progress.txnId, "owner-RECOVERY", progress.epoch,
                progress.sequence, progress.recordDigest,
                KanataDurableTxControl.STATE_FINALIZED, KanataDurableTxControl.DIR_TARGET,
                false, progress.preparedDigest, genPrev, genTarg, genTarg.generationId,
                "in-1", "", "finalized", "restore", "kanata", progress.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertEquals(KanataDurableTxControl.STATE_FINALIZED, fin.state);
        assertEquals(genTarg.generationId, fin.activeGenerationId);

        // 5) Abort-only GATE -> PREPARED(abortOnly=true) MUST reject DECISION(target)
        KanataDurableTxControl.ControlRecord gate2 = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-abort-2", "owner-B", fin.epoch + 1L,
                fin.sequence, fin.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", genTarg, null, genTarg.generationId,
                "in-2", "", "gate2", "restore", "kanata", fin.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.ControlRecord abortPrep = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, gate2.txnId, "owner-B", gate2.epoch,
                gate2.sequence, gate2.recordDigest,
                KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                true, "", genTarg, null, genTarg.generationId,
                "in-2", "", "abort-only", "restore", "kanata", gate2.participants,
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, abortPrep.txnId, "owner-B", abortPrep.epoch,
                    abortPrep.sequence, abortPrep.recordDigest,
                    KanataDurableTxControl.STATE_DECISION, KanataDurableTxControl.DIR_TARGET,
                    false, abortPrep.preparedDigest, genTarg, genPrev, genPrev.generationId,
                    "in-2", "", "illegal-target", "restore", "kanata", abortPrep.participants,
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_ABORT_ONLY_VIOLATION");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_ABORT_ONLY_VIOLATION", expected.code);
        }

        Log.i(TAG, "N05_02_STATE_MACHINE_CAS=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("fullLifecycleOk", true)
                .put("directionIrreversible", true)
                .put("abortOnlyEnforced", true)
                .toString());
    }

    @Test
    public void n05_03_tamperReplayOrphanVersionAndMissingHead() throws Exception {
        KanataDurableTxControl.GenerationRegistration gen0 = createSealedDummyGeneration("gen-tamp-0", "t0");
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.initializeControlRoot(
                ctx, controlRoot, hmacAlias, aeadAlias, gen0.generationId, gen0,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        KanataDurableTxControl.ControlRecord gate = KanataDurableTxControl.compareAndSetTransition(
                ctx, controlRoot, "txn-tamp-1", "owner-T", 1L,
                init.headRecord.sequence, init.headRecord.recordDigest,
                KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                false, "", gen0, null, gen0.generationId,
                "in", "", "g", "restore", "kanata", Arrays.asList("kanata"),
                false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // 1) Replay historical genesis record while current head is at seq=1 MUST fail
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-replay", "owner-R", 2L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                    false, "", gen0, null, gen0.generationId,
                    "in", "", "replay", "restore", "kanata", Arrays.asList("kanata"),
                    false, 0L, KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            fail("Expected CAS_SEQUENCE_MISMATCH on historical replay");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("CAS_SEQUENCE_MISMATCH", expected.code);
        }

        // 2) H-05 all 5 legacy restore paths conflict with new control layer
        File legacyDir = new File(ctx.getFilesDir(), "formyself");
        assertTrue(legacyDir.mkdirs() || legacyDir.isDirectory());
        for (String legacyFile : KanataDurableTxControl.LEGACY_RESTORE_FILES) {
            File f = new File(legacyDir, legacyFile);
            writeBytes(f, "{\"digest\":\"abc\"}".getBytes(StandardCharsets.UTF_8));
            KanataDurableTxControl.AuthoritativeState st = KanataDurableTxControl.probe(
                    ctx, controlRoot,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            assertTrue("Legacy artifact must block: " + legacyFile, st.blocked);
            assertFalse(st.legacyInventory.clean);
            assertTrue(f.delete());
        }

        // 3) Record content replacement -> digest mismatch + blocked
        File recFile = new File(new File(controlRoot, "records"), gate.recordDigest + ".json");
        byte[] origRec = KanataM6SchemeCExporter.readSmallFileBounded(recFile, 65536);
        writeBytes(recFile, "{\"canonical\":\"e30=\",\"macHex\":\"0000000000000000000000000000000000000000000000000000000000000000\"}".getBytes(StandardCharsets.UTF_8));
        KanataDurableTxControl.AuthoritativeState tamperedRec = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(tamperedRec.blocked);
        assertEquals("TX_CONTROL_RECORD_DIGEST_MISMATCH", tamperedRec.reasonCode);
        writeBytes(recFile, origRec);

        // 4) Head MAC tampering -> TX_CONTROL_AUTH_FAILED + blocked
        File headFile = new File(controlRoot, "head.json");
        byte[] origHead = KanataM6SchemeCExporter.readSmallFileBounded(headFile, 65536);
        JSONObject badHead = new JSONObject(new String(origHead, StandardCharsets.UTF_8));
        badHead.put("macHex", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        writeBytes(headFile, badHead.toString().getBytes(StandardCharsets.UTF_8));
        KanataDurableTxControl.AuthoritativeState badHeadSt = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(badHeadSt.blocked);
        assertEquals("TX_CONTROL_AUTH_FAILED", badHeadSt.reasonCode);

        // 5) Missing head.json while records/ still has valid records -> MUST NOT scan or guess!
        assertTrue(headFile.delete());
        KanataDurableTxControl.AuthoritativeState missingHead = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(missingHead.blocked);
        assertEquals("TX_CONTROL_HEAD_MISSING", missingHead.reasonCode);
        assertNull(missingHead.headRecord);
        writeBytes(headFile, origHead);

        // 6) Unknown protocol version in installation.json -> TX_CONTROL_UNSUPPORTED_VERSION + blocked
        File installFile = new File(controlRoot, "installation.json");
        JSONObject instEnv = new JSONObject(new String(KanataM6SchemeCExporter.readSmallFileBounded(installFile, 65536), StandardCharsets.UTF_8));
        JSONObject instCan = new JSONObject(new String(android.util.Base64.decode(instEnv.getString("canonical"), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8));
        instCan.put("protocolVersion", 99);
        instEnv.put("canonical", android.util.Base64.encodeToString(instCan.toString().getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP));
        writeBytes(installFile, instEnv.toString().getBytes(StandardCharsets.UTF_8));
        KanataDurableTxControl.AuthoritativeState unknownVer = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(unknownVer.blocked);
        assertEquals("TX_CONTROL_UNSUPPORTED_VERSION", unknownVer.reasonCode);

        Log.i(TAG, "N05_03_TAMPER_REPLAY_LEGACY=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("replayRejected", true)
                .put("legacy5PathsBlocked", true)
                .put("missingHeadNoScan", true)
                .put("unknownVersionBlocked", true)
                .toString());
    }

    @Test
    public void n05_04_faultInjectionWriteFsyncRenameDirSyncReadbackEnospc() throws Exception {
        KanataDurableTxControl.GenerationRegistration gen0 = createSealedDummyGeneration("gen-flt-0", "f0");
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.initializeControlRoot(
                ctx, controlRoot, hmacAlias, aeadAlias, gen0.generationId, gen0,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // 1) ENOSPC on record write
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-enospc", "owner-F", 1L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                    false, "", gen0, null, gen0.generationId, "in", "", "g",
                    "restore", "kanata", Arrays.asList("kanata"), false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    new KanataDurableTxControl.FaultInjector() {
                        @Override
                        public void beforeFileWrite(String targetLabel) throws IOException {
                            if ("record".equals(targetLabel)) throw new IOException("ENOSPC: No space left on device");
                        }
                    });
            fail("Expected ENOSPC");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("ENOSPC", expected.code);
        }
        assertEquals(0L, KanataDurableTxControl.probe(ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE).headRecord.sequence);

        // 2) File fsync failure on head
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-fsync", "owner-F", 1L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                    false, "", gen0, null, gen0.generationId, "in", "", "g",
                    "restore", "kanata", Arrays.asList("kanata"), false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    new KanataDurableTxControl.FaultInjector() {
                        @Override
                        public void beforeFileFsync(String targetLabel) throws IOException {
                            if ("head".equals(targetLabel)) throw new IOException("Simulated fsync EIO");
                        }
                    });
            fail("Expected IO_FAILED");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("IO_FAILED", expected.code);
        }
        // Head was NOT renamed -> still seq=0!
        assertEquals(0L, KanataDurableTxControl.probe(ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE).headRecord.sequence);

        // 3) Parent dir fsync failure AFTER rename -> MUST raise DURABILITY_UNCONFIRMED!
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-dirsync", "owner-F", 1L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                    false, "", gen0, null, gen0.generationId, "in", "", "g",
                    "restore", "kanata", Arrays.asList("kanata"), false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    new KanataDurableTxControl.FaultInjector() {
                        @Override
                        public void beforeParentDirFsync(String targetLabel) throws IOException {
                            if ("head".equals(targetLabel)) throw new IOException("Simulated dir fsync EIO");
                        }
                    });
            fail("Expected DURABILITY_UNCONFIRMED");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("DURABILITY_UNCONFIRMED", expected.code);
        }
        // Authoritative head is now at GATE (seq=1) -> probe MUST be blocked=true!
        KanataDurableTxControl.AuthoritativeState afterDirSyncErr = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        assertTrue(afterDirSyncErr.blocked);
        assertEquals("BLOCKED_ABORT_GATE", afterDirSyncErr.recoveryAction);

        // 4) Readback mismatch injection
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, afterDirSyncErr.headRecord.txnId, "owner-F", afterDirSyncErr.headRecord.epoch,
                    afterDirSyncErr.headRecord.sequence, afterDirSyncErr.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_PREPARED, KanataDurableTxControl.DIR_NONE,
                    true, "", gen0, null, gen0.generationId, "in", "", "abort",
                    "restore", "kanata", afterDirSyncErr.headRecord.participants, false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    new KanataDurableTxControl.FaultInjector() {
                        @Override
                        public void afterRenameBeforeReadback(String targetLabel) throws IOException {
                            if ("head".equals(targetLabel)) {
                                writeBytes(new File(controlRoot, "head.json"), "corrupted-after-rename".getBytes(StandardCharsets.UTF_8));
                            }
                        }
                    });
            fail("Expected TX_READBACK_VERIFY_FAILED");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("TX_READBACK_VERIFY_FAILED", expected.code);
        }

        Log.i(TAG, "N05_04_FAULT_INJECTION=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("enospcOk", true)
                .put("fsyncFailOk", true)
                .put("dirFsyncUnconfirmedOk", true)
                .put("readbackMismatchOk", true)
                .toString());
    }

    @Test
    public void n05_05_todoWidgetCrossProcessLockFenceAndRecoveryCapability() throws Exception {
        KanataDurableTxControl.GenerationRegistration gen0 = createSealedDummyGeneration("gen-todo-0", "td0");
        KanataDurableTxControl.AuthoritativeState init = KanataDurableTxControl.initializeControlRoot(
                ctx, controlRoot, hmacAlias, aeadAlias, gen0.generationId, gen0,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);

        // Reset synthetic Todo store for clean CAS testing
        String today = TodoRepository.today();
        JSONObject seed = new JSONObject()
                .put("version", 1)
                .put("revision", 0)
                .put("tasks", new JSONArray().put(new JSONObject()
                        .put("id", "n05-task-1")
                        .put("title", "N05 Synthetic Task")
                        .put("startDate", today)
                        .put("createdAt", 1000L)
                        .put("recurrence", new JSONObject().put("type", "none"))))
                .put("overrides", new JSONArray())
                .put("completions", new JSONArray());
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().putString(TodoRepository.KEY, seed.toString()).commit();

        // 1) Ordinary Todo CAS & Widget toggle succeed when state == FINALIZED
        JSONObject afterWidget = TodoRepository.toggleCompleted(ctx, controlRoot, "n05-task-1", today);
        assertEquals(1L, afterWidget.getLong("revision"));
        long baseIno;
        try (KanataDurableTxControl.StableControlLock lock = KanataDurableTxControl.acquireControlLock(controlRoot)) {
            baseIno = lock.ino;
        }

        // 2) Cross-process CAS race against :m6worker at seq=0 (only ONE winner allowed, lock inode invariant!)
        File workDir = new File(testRoot, "cp-cas");
        assertTrue(workDir.mkdirs() || workDir.isDirectory());
        Intent i = new Intent(ctx, KanataM6KillableWorkerService.class);
        i.setAction(KanataM6KillableWorkerService.ACTION_N05_CROSS_PROCESS_CAS);
        i.putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "n05-cp-cas");
        i.putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, workDir.getAbsolutePath());
        i.putExtra(KanataM6KillableWorkerService.EXTRA_CONTROL_ROOT, controlRoot.getAbsolutePath());
        i.putExtra(KanataM6KillableWorkerService.EXTRA_EXPECTED_SEQ, init.headRecord.sequence);
        i.putExtra(KanataM6KillableWorkerService.EXTRA_EXPECTED_DIGEST, init.headRecord.recordDigest);
        i.putExtra(KanataM6KillableWorkerService.EXTRA_OWNER_ID, "worker-proc");
        ctx.startService(i);

        boolean mainWon = false;
        try {
            KanataDurableTxControl.compareAndSetTransition(
                    ctx, controlRoot, "txn-main-proc", "main-proc", 1L,
                    init.headRecord.sequence, init.headRecord.recordDigest,
                    KanataDurableTxControl.STATE_GATE, KanataDurableTxControl.DIR_NONE,
                    false, "", gen0, null, gen0.generationId, "in", "", "main-gate",
                    "restore", "kanata", Arrays.asList("kanata", "todo"), false, 0L,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                    KanataDurableTxControl.FaultInjector.NONE);
            mainWon = true;
        } catch (KanataDurableTxControl.TxControlException lost) {
            assertEquals("CAS_SEQUENCE_MISMATCH", lost.code);
        }

        File workerResFile = new File(workDir, "n05_worker_result.json");
        JSONObject workerRes = waitForJsonFile(workerResFile, 15_000L);
        assertNotNull("Worker result missing", workerRes);
        boolean workerWon = workerRes.optBoolean("ok", false);
        assertTrue("Exactly one process must win CAS (mainWon=" + mainWon + ", workerWon=" + workerWon + ")",
                mainWon ^ workerWon);
        if (!workerWon) {
            assertEquals("CAS_SEQUENCE_MISMATCH", workerRes.optString("errorCode"));
        }

        // Verify control.lock inode was NEVER unlinked or recreated (FIX-04)
        try (KanataDurableTxControl.StableControlLock lock = KanataDurableTxControl.acquireControlLock(controlRoot)) {
            assertEquals("control.lock inode must remain stable", baseIno, lock.ino);
        }

        // 3) Now state == GATE -> BOTH ordinary Todo CAS and Widget write MUST BE REJECTED!
        try {
            TodoRepository.toggleCompleted(ctx, controlRoot, "n05-task-1", today);
            fail("Widget write must be blocked under active GATE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RESTORE_RECOVERY_REQUIRED", expected.code);
        }
        try {
            JSONObject nextOrdinary = new JSONObject(afterWidget.toString()).put("revision", 2L);
            TodoRepository.compareAndSet(ctx, controlRoot, 1L, nextOrdinary);
            fail("Ordinary Todo CAS must be blocked under active GATE");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RESTORE_RECOVERY_REQUIRED", expected.code);
        }

        // 4) Forged RecoveryCapability MUST be rejected; genuine Native RecoveryCapability succeeds with monotonic revision!
        KanataDurableTxControl.AuthoritativeState gateSt = KanataDurableTxControl.probe(
                ctx, controlRoot,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                KanataDurableTxControl.FaultInjector.NONE);
        KanataDurableTxControl.RecoveryCapability genuine = KanataDurableTxControl.issueRecoveryCapability(
                ctx, controlRoot,
                gateSt.headRecord.txnId, "todo", KanataDurableTxControl.OP_RECOVERY_TODO_CAS,
                gen0.generationId, gateSt.headRecord.ownerId, gateSt.headRecord.epoch, 60_000L,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);

        KanataDurableTxControl.RecoveryCapability forged = new KanataDurableTxControl.RecoveryCapability(
                genuine.tokenId, genuine.txnId, genuine.participantId, genuine.operation,
                genuine.generationId, genuine.ownerId, genuine.epoch,
                genuine.issuedAtElapsedMs, genuine.expiresAtElapsedMs,
                "0000000000000000000000000000000000000000000000000000000000000000");
        try {
            JSONObject recData = new JSONObject(afterWidget.toString()).put("revision", 2L);
            TodoRepository.applyRecoveryCompareAndSet(
                    ctx, controlRoot, forged, 1L, recData,
                    KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
            fail("Forged recovery capability must be rejected");
        } catch (KanataDurableTxControl.TxControlException expected) {
            assertEquals("RECOVERY_CAPABILITY_FORGED", expected.code);
        }

        // Genuine capability succeeds under active GATE and increments revision monotonically!
        JSONObject recData = new JSONObject(afterWidget.toString()).put("revision", 2L);
        JSONObject saved = TodoRepository.applyRecoveryCompareAndSet(
                ctx, controlRoot, genuine, 1L, recData,
                KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE);
        assertEquals(2L, saved.getLong("revision"));

        Log.i(TAG, "N05_05_TODO_WIDGET_CP_CAS=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("crossProcessCasMutualExclusion", true)
                .put("lockInodeStable", true)
                .put("ordinaryTodoAndWidgetBlocked", true)
                .put("forgedCapabilityRejected", true)
                .put("genuineCapabilitySucceeded", true)
                .toString());
    }

    @Test
    public void n05_06_realProcessSigkillDurabilityAndAuthoritativeColdStart() throws Exception {
        String[] stages = new String[] {
                KanataM6KillableWorkerService.STAGE_N05_AFTER_GATE,
                KanataM6KillableWorkerService.STAGE_N05_AFTER_PREPARED,
                KanataM6KillableWorkerService.STAGE_N05_BEFORE_HEAD_RENAME,
                KanataM6KillableWorkerService.STAGE_N05_AFTER_DECISION_TARGET
        };
        String[] expectedActions = new String[] {
                "BLOCKED_ABORT_GATE",
                "BLOCKED_ROLLBACK_PREPARED",
                "BLOCKED_ROLLBACK_PREPARED", // Before head rename -> head is still PREPARED!
                "BLOCKED_REPLAY_TARGET"
        };

        for (int idx = 0; idx < stages.length; idx++) {
            String stage = stages[idx];
            File stageDir = new File(testRoot, "sigkill-" + idx);
            File stageControlRoot = new File(stageDir, "tx-control");
            String stageHmac = "com.yubin.formyself.n05.sk.hmac." + idx + "." + UUID.randomUUID().toString().substring(0, 6);
            String stageAead = "com.yubin.formyself.n05.sk.aead." + idx + "." + UUID.randomUUID().toString().substring(0, 6);
            try {
                File prevGenDir = KanataDurableTxControl.generationDir(stageControlRoot, "gen-sk-prev-" + idx);
                assertTrue(prevGenDir.mkdirs() || prevGenDir.isDirectory());
                File prevDb = new File(prevGenDir, "kanata.db");
                File prevEnv = new File(prevGenDir, "envelope.json");
                writeBytes(prevDb, ("prev-db-" + idx).getBytes(StandardCharsets.UTF_8));
                writeBytes(prevEnv, "{\"version\":1}".getBytes(StandardCharsets.UTF_8));
                KanataDurableTxControl.GenerationRegistration prevGen = new KanataDurableTxControl.GenerationRegistration(
                        "gen-sk-prev-" + idx, false, "generations/gen-sk-prev-" + idx,
                        KanataDurableTxControl.sha256FileHex(prevDb), KanataDurableTxControl.sha256FileHex(prevEnv),
                        "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a",
                        "sqlcipher-4.17.0", "ForMyself/Kanata/KEK/v1", "kds-prev", 10L, 50);
                KanataDurableTxControl.sealGenerationDirectory(stageControlRoot, prevGen, KanataDurableTxControl.FaultInjector.NONE);

                File targGenDir = KanataDurableTxControl.generationDir(stageControlRoot, "gen-sk-targ-" + idx);
                assertTrue(targGenDir.mkdirs() || targGenDir.isDirectory());
                File targDb = new File(targGenDir, "kanata.db");
                File targEnv = new File(targGenDir, "envelope.json");
                writeBytes(targDb, ("targ-db-" + idx).getBytes(StandardCharsets.UTF_8));
                writeBytes(targEnv, "{\"version\":1,\"t\":2}".getBytes(StandardCharsets.UTF_8));
                KanataDurableTxControl.GenerationRegistration targGen = new KanataDurableTxControl.GenerationRegistration(
                        "gen-sk-targ-" + idx, false, "generations/gen-sk-targ-" + idx,
                        KanataDurableTxControl.sha256FileHex(targDb), KanataDurableTxControl.sha256FileHex(targEnv),
                        "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a",
                        "sqlcipher-4.17.0", "ForMyself/Kanata/KEK/v1", "kds-targ", 20L, 50);
                KanataDurableTxControl.sealGenerationDirectory(stageControlRoot, targGen, KanataDurableTxControl.FaultInjector.NONE);

                KanataDurableTxControl.initializeControlRoot(
                        ctx, stageControlRoot, stageHmac, stageAead, prevGen.generationId, prevGen,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);

                writeBytes(new File(stageDir, "n05_target_gen.json"), targGen.toJson().toString().getBytes(StandardCharsets.UTF_8));

                Intent i = new Intent(ctx, KanataM6KillableWorkerService.class);
                i.setAction(KanataM6KillableWorkerService.ACTION_N05_SIGKILL_AT_STATE);
                i.putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, stageDir.getAbsolutePath());
                i.putExtra(KanataM6KillableWorkerService.EXTRA_CONTROL_ROOT, stageControlRoot.getAbsolutePath());
                i.putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, "sk-" + idx);
                i.putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, stage);
                i.putExtra(KanataM6KillableWorkerService.EXTRA_OWNER_ID, "worker-sk-" + idx);
                ctx.startService(i);

                JSONObject ready = waitForJsonFile(new File(stageDir, "worker_ready.json"), 20_000L);
                assertNotNull("Worker did not reach stage " + stage, ready);
                int workerPid = ready.getInt("pid");
                assertNotEquals("Worker must run in separate OS process", Process.myPid(), workerPid);

                // REAL OS SIGKILL
                Process.killProcess(workerPid);
                waitForPidGone(workerPid, 10_000L);

                // Authoritative cold-start probe using real AndroidKeyStore in main process
                KanataDurableTxControl.AuthoritativeState cold = KanataDurableTxControl.probe(
                        ctx, stageControlRoot,
                        KanataDurableTxControl.AndroidKeyStoreBackend.INSTANCE,
                        KanataDurableTxControl.FaultInjector.NONE);
                assertTrue("Cold-start probe must remain blocked at " + stage, cold.blocked);
                assertEquals("Unexpected cold-start recovery action at " + stage, expectedActions[idx], cold.recoveryAction);
                if (KanataM6KillableWorkerService.STAGE_N05_AFTER_DECISION_TARGET.equals(stage)) {
                    assertEquals(targGen.generationId, cold.headRecord.activeGenerationId);
                } else {
                    assertEquals(prevGen.generationId, cold.headRecord.activeGenerationId);
                }
            } finally {
                deleteKeystoreAliasQuiet(stageHmac);
                deleteKeystoreAliasQuiet(stageAead);
            }
        }

        Log.i(TAG, "N05_06_SIGKILL_COLD_START=" + new JSONObject()
                .put("api", Build.VERSION.SDK_INT)
                .put("stagesTested", stages.length)
                .put("allAuthoritative", true)
                .toString());
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
