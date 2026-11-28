// @ts-check
// M6-03-R / F03 Isolated Synthetic Application Composition-Root Wiring.
//
// Connects SettingsBackup -> KanataPortableRestoreRuntime -> KanataPortableRestoreCoordinator ->
// actual RestoreCoordinator -> Native KanataM6RestoreBridgePlugin -> KanataDurableTxControl (G-04) ->
// KanataM6GenerationStore (F06) -> KanataM6StagingRestoreEngine (SQLCipher 4.17.0).
//
// STRICT PRODUCTION ISOLATION:
// - Ordinary production APKs (BuildConfig.KANATA_M2_SYNTHETIC=false) NEVER compile or register
//   `KanataM6RestoreBridge`, so `isSyntheticPortableRestoreBridgeAvailable()` returns false
//   and `createSyntheticPortableRestoreCoordinator()` returns null.
// - Web browsers return false/null and stay on existing encrypted .json file backup/restore.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { createKanataPortableRestoreCoordinator } from './kanataPortableRestoreCoordinator.js'

/** @type {any} */
let cachedBridge = null
const getNativeRestoreBridge = () => {
  if (!cachedBridge) cachedBridge = registerPlugin('KanataM6RestoreBridge')
  return cachedBridge
}

/**
 * Check whether the isolated synthetic Native restore bridge plugin is genuinely registered
 * on Android (only true in com.yubin.formyself.m2qa synthetic QA builds).
 * @param {typeof Capacitor} [capacitor]
 */
export function isSyntheticPortableRestoreBridgeAvailable(capacitor = Capacitor) {
  return capacitor?.getPlatform?.() === 'android'
    && Boolean(capacitor?.isPluginAvailable?.('KanataM6RestoreBridge'))
}

/**
 * Probe Native durable transaction control root during app cold start (only when synthetic bridge exists).
 * Never runs on ordinary production APKs or Web.
 * @param {{ capacitor?: typeof Capacitor, bridge?: any }} [options]
 */
export async function probeNativeDurableControlState({
  capacitor = Capacitor,
  bridge = null,
} = {}) {
  if (!isSyntheticPortableRestoreBridgeAvailable(capacitor)) {
    return null
  }
  return (bridge || getNativeRestoreBridge()).probeState()
}

/**
 * Execute authoritative Native cold-start recovery (bypasses damaged Vault, legacy Kanata, Settings).
 * @param {string} localMasterPassword
 * @param {{ ownerId?: string, capacitor?: typeof Capacitor, bridge?: any }} [options]
 */
export async function recoverNativeDurableControlState(localMasterPassword, {
  ownerId = 'app-cold-start-recovery',
  capacitor = Capacitor,
  bridge = null,
} = {}) {
  if (!isSyntheticPortableRestoreBridgeAvailable(capacitor)) {
    return null
  }
  return (bridge || getNativeRestoreBridge()).recoverAuthoritative({ localMasterPassword, ownerId })
}

/**
 * Pick a KPB1 backup document via Android SAF DocumentsUI through Native bridge.
 * @param {{ capacitor?: typeof Capacitor, bridge?: any }} [options]
 */
export async function pickNativeBackupDocument({
  capacitor = Capacitor,
  bridge = null,
} = {}) {
  if (!isSyntheticPortableRestoreBridgeAvailable(capacitor)) {
    throw Object.assign(new Error('SQLITE_PLUGIN_NOT_ACTIVATED'), { code: 'SQLITE_PLUGIN_NOT_ACTIVATED' })
  }
  return (bridge || getNativeRestoreBridge()).pickBackupDocument()
}

/**
 * Create a real product-candidate KanataPortableRestoreCoordinator wired to the Native
 * KanataM6RestoreBridgePlugin + KanataDurableTxControl + SQLCipher 4.17.0.
 *
 * Uses `commitStrategy: 'decision_then_apply'` inside the single RestoreCoordinator:
 *   GATE -> PREPARED -> DECISION(target) -> verifyAndApplyGeneration(selected) -> FINALIZED -> GC.
 * Cold-start recovery routes through `RestoreCoordinator.recover()` -> `resolveRecovery()`
 * (NEVER calls legacy `openRestoreRecord()` on Native control records).
 *
 * Returns null on ordinary APK and Web (preserving legacy canonical isolation).
 *
 * @param {{
 *   state: import('./contracts').RestoreState,
 *   getOwnerIdentity: () => { ownerId: string, sessionRevision: number, epoch?: number },
 *   synchronize?: () => Promise<unknown>,
 *   onPhase?: (phase: import('./contracts').RestoreCoordinatorPhase) => void,
 *   onNativeCall?: (method: string, meta?: Record<string, unknown>) => void,
 *   capacitor?: typeof Capacitor,
 *   bridge?: any,
 * }} options
 */
export function createSyntheticPortableRestoreCoordinator({
  state,
  getOwnerIdentity,
  synchronize = async () => {},
  onPhase,
  onNativeCall,
  capacitor = Capacitor,
  bridge = null,
}) {
  if (!isSyntheticPortableRestoreBridgeAvailable(capacitor)) {
    return null
  }
  const activeBridge = bridge || getNativeRestoreBridge()
  const trace = (/** @type {string} */ method, /** @type {Record<string, unknown>} */ meta = {}) => {
    try { onNativeCall?.(method, meta) } catch {}
  }

  /** @type {{ txnId: string, ownerId: string, epoch: number, sequence: number, recordDigest: string, preparedDigest: string, localMasterPassword: string, targetGenerationId: string, selectedGenerationId: string, decisionDirection: 'none' | 'previous' | 'target' } | null} */
  let activeNativeTx = null

  /** @param {any} gen @param {string} fallbackTaskId @returns {import('./contracts').KanataSqliteGenerationDescriptor} */
  const toDescriptorFromNativeGen = (gen, fallbackTaskId) => {
    if (!gen || gen.absent) {
      return {
        kind: 'kanata-sqlite-generation-v1',
        generationId: gen?.generationId || 'gen-prev-absent',
        taskId: fallbackTaskId,
        absent: true,
        dbPath: '',
        dbSha256Hex: '',
        schemaVersion: 5,
        applicationId: 0x4b4e5441,
        schemaFingerprint: '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a',
        datasetIdentity: 'absent',
        totalBusinessRows: 0,
        tableCount: 50,
        verified: false,
      }
    }
    return {
      kind: 'kanata-sqlite-generation-v1',
      generationId: gen.generationId,
      taskId: fallbackTaskId,
      absent: false,
      dbPath: gen.relativeDir ? `${gen.relativeDir}/kanata.db` : `generations/${gen.generationId}/kanata.db`,
      dbSha256Hex: gen.dbSha256Hex,
      envelopeSha256Hex: gen.envelopeSha256Hex,
      schemaVersion: 5,
      applicationId: 0x4b4e5441,
      schemaFingerprint: gen.schemaFingerprint || '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a',
      datasetIdentity: gen.datasetIdentity || fallbackTaskId,
      totalBusinessRows: typeof gen.totalBusinessRows === 'number' ? gen.totalBusinessRows : 0,
      tableCount: typeof gen.tableCount === 'number' ? gen.tableCount : 50,
      verified: true,
    }
  }

  /**
   * Native-backed RestoreJournal adapter driven directly by KanataDurableTxControl (G-04 / R01).
   * - inspect(): read-only authoritative Native head + H-05 five-path legacy inventory.
   * - prepare(): GATE -> PREPARED (writes AEAD payload + binds preparedDigest).
   * - commit(expectedDigest): authenticates recovery capability + PREPARED -> DECISION(target).
   * - abortPrepared(expectedDigest, password): pre-decision rollback (GATE/PREPARED -> DECISION(previous) -> verify -> FINALIZED).
   * - clear(): verifies selected generation receipt + DECISION -> FINALIZED.
   * - resolveRecovery(password): Native cold-start recovery resolver (NEVER calls legacy openRestoreRecord).
   */
  const nativeControlJournal = {
    async inspect() {
      trace('probeState')
      const st = await activeBridge.probeState()
      if (!st || !st.blocked) return null
      return {
        encrypted: JSON.stringify({ nativeControl: true, txnId: st.txnId || '', state: st.state || '' }),
        committed: st.state === 'DECISION' && st.decisionDirection === 'target',
        digest: st.preparedDigest || st.recordDigest || '',
      }
    },
    async prepare(record, localMasterPassword) {
      if (!activeNativeTx) {
        throw Object.assign(new Error('NATIVE_TX_GATE_REQUIRED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
      const target = record?.target
      const id = getOwnerIdentity()
      trace('prepareTransaction', { txnId: activeNativeTx.txnId, generationId: target?.generationId || '' })
      const prepared = await activeBridge.prepareTransaction({
        txnId: activeNativeTx.txnId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
        expectedSeq: activeNativeTx.sequence,
        expectedDigest: activeNativeTx.recordDigest,
        stagingHandle: target?.stagingHandle || '',
        sessionRevision: id?.sessionRevision ?? 0,
        stagingEpoch: typeof id?.epoch === 'number' ? id.epoch : activeNativeTx.epoch,
        participantPayloadJson: JSON.stringify({
          previous: record?.previous || null,
          target: target || null,
        }),
      })
      activeNativeTx.sequence = prepared.sequence
      activeNativeTx.recordDigest = prepared.recordDigest
      activeNativeTx.preparedDigest = prepared.preparedDigest
      activeNativeTx.localMasterPassword = localMasterPassword
      activeNativeTx.targetGenerationId = target?.generationId || ''
      return { digest: prepared.preparedDigest }
    },
    async commit(expectedDigest) {
      if (!activeNativeTx) {
        throw Object.assign(new Error('NATIVE_TX_NOT_PREPARED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
      if (expectedDigest && activeNativeTx.preparedDigest && expectedDigest !== activeNativeTx.preparedDigest) {
        throw Object.assign(new Error('RESTORE_COMMIT_MISMATCH'), { code: 'CAS_PREPARED_DIGEST_MISMATCH' })
      }
      trace('authenticateAndIssueCapability', { operation: 'COMMIT_DECISION', generationId: activeNativeTx.targetGenerationId })
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'COMMIT_DECISION',
        generationId: activeNativeTx.targetGenerationId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
      trace('commitDecision', { direction: 'target', generationId: activeNativeTx.targetGenerationId })
      const decided = await activeBridge.commitDecision({
        txnId: activeNativeTx.txnId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
        expectedSeq: activeNativeTx.sequence,
        expectedDigest: activeNativeTx.recordDigest,
        preparedDigest: activeNativeTx.preparedDigest,
        direction: 'target',
        capability: cap,
      })
      activeNativeTx.sequence = decided.sequence
      activeNativeTx.recordDigest = decided.recordDigest
      activeNativeTx.decisionDirection = 'target'
      activeNativeTx.selectedGenerationId = decided.activeGenerationId || activeNativeTx.targetGenerationId
    },
    async abortPrepared(_expectedDigest, localMasterPassword) {
      // Pre-decision abort: converge undecided GATE or PREPARED to DECISION(previous) -> verify -> FINALIZED
      // without ever invoking legacy openRestoreRecord().
      const owner = getOwnerIdentity()
      const pwd = localMasterPassword || activeNativeTx?.localMasterPassword || ''
      trace('recoverAuthoritative', { reason: 'pre_commit_abort' })
      const aborted = await activeBridge.recoverAuthoritative({
        localMasterPassword: pwd,
        ownerId: owner?.ownerId || activeNativeTx?.ownerId || 'pre-commit-abort',
      })
      activeNativeTx = null
      if (!aborted || aborted.recovered !== true || aborted.blocked !== false) {
        throw Object.assign(new Error('RESTORE_PRE_COMMIT_ABORT_FAILED'), { code: 'ROLLBACK_FAILED' })
      }
    },
    async clear() {
      if (!activeNativeTx) return
      trace('authenticateAndIssueCapability', { operation: 'FINALIZE', generationId: activeNativeTx.selectedGenerationId })
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'FINALIZE',
        generationId: activeNativeTx.selectedGenerationId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
      trace('finalizeTransaction', { txnId: activeNativeTx.txnId, direction: activeNativeTx.decisionDirection })
      const fin = await activeBridge.finalizeTransaction({
        txnId: activeNativeTx.txnId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
        expectedSeq: activeNativeTx.sequence,
        expectedDigest: activeNativeTx.recordDigest,
        preparedDigest: activeNativeTx.preparedDigest,
        gcRetired: false, // Deferred to finalizeArtifacts so cleanup failures remain decoupled from FINALIZED!
        capability: cap,
      })
      activeNativeTx.sequence = fin.sequence
      activeNativeTx.recordDigest = fin.recordDigest
      activeNativeTx = null
    },
    async resolveRecovery(localMasterPassword) {
      // R01.7: Native cold-start recovery driven through RestoreCoordinator.recover()
      // (prepareDecisionForRecovery -> apply(selected) -> clear(FINALIZED)), NEVER openRestoreRecord!
      const owner = getOwnerIdentity()
      trace('prepareRecoveryDecision')
      const plan = await activeBridge.prepareRecoveryDecision({
        localMasterPassword,
        ownerId: owner?.ownerId || 'cold-start-recovery',
      })
      if (plan?.alreadyFinalized === true) {
        activeNativeTx = null
        return { direction: /** @type {'none'} */ ('none'), alreadyFinalized: true }
      }
      /** @type {'previous' | 'target'} */
      const dir = plan?.direction === 'target' ? 'target' : 'previous'
      const selectedGen = dir === 'target' ? plan?.headRecord?.targetGeneration : plan?.headRecord?.previousGeneration
      activeNativeTx = {
        txnId: plan.txnId,
        ownerId: plan.ownerId,
        epoch: plan.epoch,
        sequence: plan.sequence,
        recordDigest: plan.recordDigest,
        preparedDigest: plan.preparedDigest,
        localMasterPassword,
        targetGenerationId: plan?.headRecord?.targetGeneration?.generationId || '',
        selectedGenerationId: plan.activeGenerationId || selectedGen?.generationId || '',
        decisionDirection: dir,
      }
      return {
        direction: dir,
        snapshot: toDescriptorFromNativeGen(selectedGen, dir),
        alreadyFinalized: false,
      }
    },
  }

  /** @type {import('./contracts').KanataPortableRestoreEngine} */
  const nativeEngine = {
    async stageAndVerify(request) {
      const src = /** @type {any} */ (request.source)
      trace('stageBackup', { sourceUri: src?.uri || '', sourcePath: src?.path || '' })
      const res = await activeBridge.stageBackup({
        sourceUri: src?.uri || '',
        sourcePath: src?.path || '',
        backupPassword: request.backupPassword,
        localMasterPassword: request.localMasterPassword || '',
        ownerId: request.ownerId || 'ui-owner',
        sessionRevision: request.sessionRevision ?? 0,
        epoch: request.epoch ?? 0,
      })
      return {
        descriptor: res.descriptor,
        summary: res.summary,
        metrics: res.metrics,
      }
    },
    async destroyStaging(descriptor) {
      trace('cancelOrDestroyStaging', { generationId: descriptor.generationId })
      await activeBridge.cancelOrDestroyStaging({
        taskId: descriptor.taskId,
        generationId: descriptor.generationId,
        stagingHandle: descriptor.stagingHandle || '',
      })
    },
    async prepareWriteDrain({ ownerId = 'ui-owner', epoch = 1 } = {}) {
      trace('probeState')
      const probed = await activeBridge.probeState()
      if (!probed || !probed.initialized) {
        throw Object.assign(new Error('TX_CONTROL_NOT_INITIALIZED'), { code: 'TX_CONTROL_CORRUPT' })
      }
      if (probed.blocked) {
        throw Object.assign(new Error('RESTORE_RECOVERY_REQUIRED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
      trace('beginGateAndDrain', { ownerId })
      const gated = await activeBridge.beginGateAndDrain({
        txnId: `txn-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        ownerId,
        epoch: Math.max((probed.epoch || 0) + 1, epoch || 1),
        expectedSeq: probed.sequence,
        expectedDigest: probed.recordDigest,
        inputDigest: '',
      })
      activeNativeTx = {
        txnId: gated.txnId,
        ownerId: gated.ownerId,
        epoch: gated.epoch,
        sequence: gated.sequence,
        recordDigest: gated.recordDigest,
        preparedDigest: '',
        localMasterPassword: '',
        targetGenerationId: '',
        selectedGenerationId: '',
        decisionDirection: 'none',
      }
    },
    async capturePreviousGeneration() {
      trace('probeState')
      const probed = await activeBridge.probeState()
      const prev = probed?.headRecord?.previousGeneration
      return toDescriptorFromNativeGen(prev, 'previous')
    },
    async applyGeneration(descriptor) {
      if (!activeNativeTx || !descriptor || descriptor.absent) return
      // Under `decision_then_apply`, this runs strictly AFTER durable DECISION!
      const chosenGenId = activeNativeTx.selectedGenerationId || descriptor.generationId
      trace('authenticateAndIssueCapability', { operation: 'APPLY_GENERATION', generationId: chosenGenId })
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'APPLY_GENERATION',
        generationId: chosenGenId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
      trace('verifyAndApplyGeneration', { generationId: chosenGenId })
      await activeBridge.verifyAndApplyGeneration({
        localMasterPassword: activeNativeTx.localMasterPassword,
        capability: cap,
      })
    },
    async finalizeArtifacts({ previous }) {
      if (previous && !previous.absent && previous.generationId) {
        trace('cancelOrDestroyStaging', { generationId: previous.generationId, postFinalizeGc: true })
        await activeBridge.cancelOrDestroyStaging({
          taskId: previous.taskId,
          generationId: previous.generationId,
          stagingHandle: '',
        })
      }
    },
    async recoverAuthoritative(localMasterPassword) {
      const id = getOwnerIdentity()
      trace('recoverAuthoritative')
      return activeBridge.recoverAuthoritative({
        localMasterPassword,
        ownerId: id?.ownerId || 'recovery-owner',
      })
    },
    async inspectUnconfirmed() {
      trace('probeState')
      const st = await activeBridge.probeState()
      return Array.isArray(st?.unconfirmed) ? st.unconfirmed : []
    },
    async reverifyUnconfirmed(taskId) {
      trace('reverifyUnconfirmed', { taskId })
      return activeBridge.reverifyUnconfirmed({ taskId })
    },
    async manualCleanupUnconfirmed(taskId, { confirmed }) {
      trace('manualCleanupUnconfirmed', { taskId, confirmed })
      return activeBridge.manualCleanupUnconfirmed({ taskId, confirmed })
    },
  }

  return createKanataPortableRestoreCoordinator({
    journal: nativeControlJournal,
    state,
    engine: nativeEngine,
    commitStrategy: 'decision_then_apply',
    getOwnerIdentity,
    synchronize,
    onPhase,
  })
}
