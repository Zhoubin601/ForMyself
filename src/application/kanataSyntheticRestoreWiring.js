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
 * Returns null on ordinary APK and Web (preserving legacy canonical isolation).
 *
 * @param {{
 *   state: import('./contracts').RestoreState,
 *   getOwnerIdentity: () => { ownerId: string, sessionRevision: number, epoch?: number },
 *   synchronize?: () => Promise<unknown>,
 *   onPhase?: (phase: import('./contracts').RestoreCoordinatorPhase) => void,
 *   capacitor?: typeof Capacitor,
 *   bridge?: any,
 * }} options
 */
export function createSyntheticPortableRestoreCoordinator({
  state,
  getOwnerIdentity,
  synchronize = async () => {},
  onPhase,
  capacitor = Capacitor,
  bridge = null,
}) {
  if (!isSyntheticPortableRestoreBridgeAvailable(capacitor)) {
    return null
  }
  const activeBridge = bridge || getNativeRestoreBridge()

  /** @type {{ txnId: string, ownerId: string, epoch: number, sequence: number, recordDigest: string, preparedDigest: string, localMasterPassword: string, targetGenerationId: string } | null} */
  let activeNativeTx = null

  /**
   * Native-backed RestoreJournal adapter driven directly by KanataDurableTxControl (G-04).
   * - inspect() queries authoritative Native head.json + H-05 legacy inventory.
   * - prepare() transitions GATE -> PREPARED (writes AEAD payload + fixes preparedDigest).
   * - commit(expectedDigest) authenticates recovery capability + transitions PREPARED -> DECISION(target).
   * - clear() authenticates recovery capability + transitions DECISION -> FINALIZED.
   */
  const nativeControlJournal = {
    async inspect() {
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
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'COMMIT_DECISION',
        generationId: activeNativeTx.targetGenerationId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
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
    },
    async clear() {
      if (!activeNativeTx) return
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'FINALIZE',
        generationId: activeNativeTx.targetGenerationId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
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
  }

  /** @type {import('./contracts').KanataPortableRestoreEngine} */
  const nativeEngine = {
    async stageAndVerify(request) {
      const src = /** @type {any} */ (request.source)
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
      await activeBridge.cancelOrDestroyStaging({
        taskId: descriptor.taskId,
        generationId: descriptor.generationId,
        stagingHandle: descriptor.stagingHandle || '',
      })
    },
    async prepareWriteDrain({ ownerId = 'ui-owner', epoch = 1 } = {}) {
      const probed = await activeBridge.probeState()
      if (!probed || !probed.initialized) {
        throw Object.assign(new Error('TX_CONTROL_NOT_INITIALIZED'), { code: 'TX_CONTROL_CORRUPT' })
      }
      if (probed.blocked) {
        throw Object.assign(new Error('RESTORE_RECOVERY_REQUIRED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
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
      }
    },
    async capturePreviousGeneration() {
      const probed = await activeBridge.probeState()
      const prev = probed?.headRecord?.previousGeneration
      if (!prev || prev.absent) {
        return {
          kind: 'kanata-sqlite-generation-v1',
          generationId: prev?.generationId || 'gen-prev-absent',
          taskId: 'previous',
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
        generationId: prev.generationId,
        taskId: 'previous',
        absent: false,
        dbPath: prev.relativeDir ? `${prev.relativeDir}/kanata.db` : 'generations/previous/kanata.db',
        dbSha256Hex: prev.dbSha256Hex,
        envelopeSha256Hex: prev.envelopeSha256Hex,
        schemaVersion: 5,
        applicationId: 0x4b4e5441,
        schemaFingerprint: prev.schemaFingerprint || '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a',
        datasetIdentity: prev.datasetIdentity || 'previous',
        totalBusinessRows: prev.totalBusinessRows || 0,
        tableCount: prev.tableCount || 50,
        verified: true,
      }
    },
    async applyGeneration(descriptor) {
      if (!activeNativeTx || !descriptor || descriptor.absent) return
      const cap = await activeBridge.authenticateAndIssueCapability({
        localMasterPassword: activeNativeTx.localMasterPassword,
        txnId: activeNativeTx.txnId,
        participantId: 'kanata',
        operation: 'APPLY_GENERATION',
        generationId: descriptor.generationId,
        ownerId: activeNativeTx.ownerId,
        epoch: activeNativeTx.epoch,
      })
      await activeBridge.verifyAndApplyGeneration({
        localMasterPassword: activeNativeTx.localMasterPassword,
        capability: cap,
      })
    },
    async finalizeArtifacts({ previous }) {
      if (previous && !previous.absent && previous.generationId) {
        await activeBridge.cancelOrDestroyStaging({
          taskId: previous.taskId,
          generationId: previous.generationId,
          stagingHandle: '',
        })
      }
    },
    async recoverAuthoritative(localMasterPassword) {
      const id = getOwnerIdentity()
      return activeBridge.recoverAuthoritative({
        localMasterPassword,
        ownerId: id?.ownerId || 'recovery-owner',
      })
    },
    async inspectUnconfirmed() {
      const st = await activeBridge.probeState()
      return Array.isArray(st?.unconfirmed) ? st.unconfirmed : []
    },
    async reverifyUnconfirmed(taskId) {
      return activeBridge.reverifyUnconfirmed({ taskId })
    },
    async manualCleanupUnconfirmed(taskId, { confirmed }) {
      return activeBridge.manualCleanupUnconfirmed({ taskId, confirmed })
    },
  }

  return createKanataPortableRestoreCoordinator({
    journal: nativeControlJournal,
    state,
    engine: nativeEngine,
    getOwnerIdentity,
    synchronize,
    onPhase,
  })
}
