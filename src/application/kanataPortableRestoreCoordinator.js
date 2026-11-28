// @ts-check
// M6-03-R Kanata SQLCipher Portable Restore Coordinator (F04 / F05 / F06).
// Deeply integrates isolated SQLCipher staging restore into the project's single
// RestoreCoordinator + AES-GCM RestoreJournal / Native Durable Tx Control protocol.
//
// Guarantees:
// - Explicit 6-state material lifecycle (UNREGISTERED_STAGING -> VERIFIED_AWAITING_CONFIRM ->
//   PREPARED_REGISTERED -> DECIDED -> FINALIZED / UNCONFIRMED).
// - After PREPARED_REGISTERED, UI cancel/reselect/dispose CANNOT delete referenced materials.
// - Exclusive TxContext ownership lock eliminates shared-state races (activeExpectedIdentity,
//   restoreGeneration, lastCapturedPrevious).
// - Staging descriptors are privately registered & bound to (ownerId, sessionRevision, epoch, generation);
//   externally forged `{ verified: true }` descriptors are rejected before prepare/journal.
// - Post-FINALIZED artifact cleanup failure is decoupled from committed business success (`committed: true` + `cleanupError`).
// - Recovery of already-decided or pending transactions runs under dedicated recovery capability,
//   never blocked by ordinary UI session invalidation.

import { createRestoreCoordinator } from './restoreCoordinator.js'

export const KANATA_SQLITE_GENERATION_KIND = 'kanata-sqlite-generation-v1'
export const KANATA_SQLITE_APPLICATION_ID = 0x4b4e5441
export const KANATA_SQLITE_SCHEMA_VERSION = 5
export const KANATA_SQLITE_SCHEMA_005_FINGERPRINT = '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a'
export const KANATA_SQLITE_VERIFIER_COUNT = 50

export const RESTORE_MATERIAL_LIFECYCLE = Object.freeze({
  UNREGISTERED_STAGING: 'UNREGISTERED_STAGING',
  VERIFIED_AWAITING_CONFIRM: 'VERIFIED_AWAITING_CONFIRM',
  PREPARED_REGISTERED: 'PREPARED_REGISTERED',
  DECIDED: 'DECIDED',
  FINALIZED: 'FINALIZED',
  UNCONFIRMED: 'UNCONFIRMED',
})

const HEX64_RE = /^[a-f0-9]{64}$/
const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

/**
 * Strictly validate and clone an immutable KanataSqliteGenerationDescriptor.
 * Invalid descriptors fail before any journal write or business mutation.
 * @param {unknown} input
 * @returns {import('./contracts').KanataSqliteGenerationDescriptor}
 */
export function validateKanataGenerationDescriptor(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('INVALID_GENERATION_DESCRIPTOR'), { code: 'INVALID_LOGICAL' })
  }
  const d = /** @type {Record<string, unknown>} */ (input)
  if (d.kind !== KANATA_SQLITE_GENERATION_KIND) {
    throw Object.assign(new Error('UNSUPPORTED_GENERATION_KIND'), { code: 'UNSUPPORTED_FORMAT' })
  }
  if (typeof d.generationId !== 'string' || !SAFE_ID_RE.test(d.generationId)) {
    throw Object.assign(new Error('INVALID_GENERATION_ID'), { code: 'INVALID_LOGICAL' })
  }
  if (typeof d.taskId !== 'string' || !SAFE_ID_RE.test(d.taskId)) {
    throw Object.assign(new Error('INVALID_TASK_ID'), { code: 'INVALID_LOGICAL' })
  }
  const absent = d.absent === true
  if (d.absent !== undefined && typeof d.absent !== 'boolean') {
    throw Object.assign(new Error('INVALID_ABSENT_FLAG'), { code: 'INVALID_LOGICAL' })
  }
  if (!absent) {
    if (typeof d.dbPath !== 'string' || !d.dbPath.length || d.dbPath.includes('..')) {
      throw Object.assign(new Error('INVALID_DB_PATH'), { code: 'INVALID_LOGICAL' })
    }
    if (typeof d.dbSha256Hex !== 'string' || !HEX64_RE.test(d.dbSha256Hex)) {
      throw Object.assign(new Error('INVALID_DB_SHA256'), { code: 'INVALID_LOGICAL' })
    }
    if (d.schemaVersion !== KANATA_SQLITE_SCHEMA_VERSION) {
      throw Object.assign(new Error('UNSUPPORTED_SCHEMA_VERSION'), { code: 'UNSUPPORTED_FORMAT' })
    }
    if (d.applicationId !== KANATA_SQLITE_APPLICATION_ID) {
      throw Object.assign(new Error('INVALID_APPLICATION_ID'), { code: 'INVALID_LOGICAL' })
    }
    if (d.schemaFingerprint !== KANATA_SQLITE_SCHEMA_005_FINGERPRINT) {
      throw Object.assign(new Error('SCHEMA_FINGERPRINT_MISMATCH'), { code: 'INVALID_LOGICAL' })
    }
    if (d.tableCount !== KANATA_SQLITE_VERIFIER_COUNT) {
      throw Object.assign(new Error('INVALID_VERIFIER_COUNT'), { code: 'INVALID_LOGICAL' })
    }
    if (typeof d.totalBusinessRows !== 'number' || !Number.isInteger(d.totalBusinessRows) || d.totalBusinessRows < 0) {
      throw Object.assign(new Error('INVALID_ROW_COUNT'), { code: 'INVALID_LOGICAL' })
    }
    if (typeof d.datasetIdentity !== 'string' || !d.datasetIdentity.length) {
      throw Object.assign(new Error('INVALID_DATASET_IDENTITY'), { code: 'INVALID_LOGICAL' })
    }
    if (d.verified !== true) {
      throw Object.assign(new Error('STAGING_NOT_VERIFIED'), { code: 'INVALID_LOGICAL' })
    }
  }
  if (d.envelopePath !== undefined && (typeof d.envelopePath !== 'string' || d.envelopePath.includes('..'))) {
    throw Object.assign(new Error('INVALID_ENVELOPE_PATH'), { code: 'INVALID_LOGICAL' })
  }
  if (d.envelopeSha256Hex !== undefined && d.envelopeSha256Hex !== '' && (typeof d.envelopeSha256Hex !== 'string' || !HEX64_RE.test(d.envelopeSha256Hex))) {
    throw Object.assign(new Error('INVALID_ENVELOPE_SHA256'), { code: 'INVALID_LOGICAL' })
  }
  if (d.stagingHandle !== undefined && d.stagingHandle !== '' && (typeof d.stagingHandle !== 'string' || !SAFE_ID_RE.test(d.stagingHandle))) {
    throw Object.assign(new Error('INVALID_STAGING_HANDLE'), { code: 'INVALID_LOGICAL' })
  }
  if (d.transcriptHex !== undefined && (typeof d.transcriptHex !== 'string' || !HEX64_RE.test(d.transcriptHex))) {
    throw Object.assign(new Error('INVALID_TRANSCRIPT_HEX'), { code: 'INVALID_LOGICAL' })
  }

  /** @type {import('./contracts').KanataSqliteGenerationDescriptor} */
  const normalized = Object.freeze({
    kind: KANATA_SQLITE_GENERATION_KIND,
    generationId: d.generationId,
    taskId: d.taskId,
    absent,
    dbPath: absent ? '' : /** @type {string} */ (d.dbPath),
    dbSha256Hex: absent ? '' : /** @type {string} */ (d.dbSha256Hex),
    ...(d.envelopePath ? { envelopePath: /** @type {string} */ (d.envelopePath) } : {}),
    ...(d.envelopeSha256Hex ? { envelopeSha256Hex: /** @type {string} */ (d.envelopeSha256Hex) } : {}),
    ...(d.stagingHandle ? { stagingHandle: /** @type {string} */ (d.stagingHandle) } : {}),
    schemaVersion: KANATA_SQLITE_SCHEMA_VERSION,
    applicationId: KANATA_SQLITE_APPLICATION_ID,
    schemaFingerprint: KANATA_SQLITE_SCHEMA_005_FINGERPRINT,
    datasetIdentity: absent ? 'absent' : /** @type {string} */ (d.datasetIdentity),
    totalBusinessRows: absent ? 0 : /** @type {number} */ (d.totalBusinessRows),
    tableCount: KANATA_SQLITE_VERIFIER_COUNT,
    ...(d.transcriptHex ? { transcriptHex: /** @type {string} */ (d.transcriptHex) } : {}),
    verified: !absent,
  })
  return normalized
}

/**
 * Create the M6-03-R Kanata Portable Restore Coordinator wrapping the product's
 * RestoreCoordinator + AES-GCM RestoreJournal / Native Durable Control Layer.
 *
 * @param {import('./contracts').KanataPortableRestoreCoordinatorOptions} options
 */
export function createKanataPortableRestoreCoordinator({
  journal,
  state,
  engine,
  commitStrategy = 'apply_then_commit',
  getOwnerIdentity,
  synchronize = async () => {},
  onPhase,
}) {
  if (!journal || !state || !engine) {
    throw new Error('PORTABLE_RESTORE_COORDINATOR_DEPS_REQUIRED')
  }

  let generationCounter = 0
  let txTokenSeq = 0

  /**
   * Private authentic staging registry: ONLY descriptors produced by this coordinator's
   * `stageAndVerify()` enter this registry. External caller-fabricated `{ verified: true }`
   * objects are rejected on `commitStagedRestore()`.
   * @typedef {{
   *   key: string,
   *   descriptor: import('./contracts').KanataSqliteGenerationDescriptor,
   *   ownerId: string,
   *   sessionRevision: number,
   *   epoch: number,
   *   generation: number,
   *   lifecycle: string,
   * }} StagedBinding
   */
  /** @type {WeakMap<object, StagedBinding>} */
  const stagedByObject = new WeakMap()
  /** @type {Map<string, StagedBinding>} */
  const stagedByKey = new Map()

  /**
   * Exclusive transaction ownership context (F05):
   * Eliminates shared mutable `activeExpectedIdentity`, `lastCapturedPrevious`, `lastStagedTarget`.
   * @typedef {{
   *   txToken: number,
   *   kind: 'stage' | 'commit' | 'recover' | 'cleanup',
   *   ownerId: string,
   *   sessionRevision: number,
   *   epoch: number,
   *   generation: number,
   *   lifecycle: string,
   *   capturedPrevious: import('./contracts').KanataSqliteGenerationDescriptor | null,
   *   stagedBinding: StagedBinding | null,
   *   recoveryMode: boolean,
   * }} ExclusiveTxContext
   */
  /** @type {ExclusiveTxContext | null} */
  let activeTx = null

  /** @type {{ previous: import('./contracts').KanataSqliteGenerationDescriptor | null, target: import('./contracts').KanataSqliteGenerationDescriptor } | null} */
  let pendingPostCommitCleanup = null

  const bindingKey = (/** @type {import('./contracts').KanataSqliteGenerationDescriptor} */ d) =>
    `${d.generationId}::${d.taskId}::${d.dbSha256Hex}::${d.stagingHandle || ''}`

  const readOwnerSnapshot = () => {
    const id = getOwnerIdentity?.()
    return {
      ownerId: id?.ownerId ?? 'default',
      sessionRevision: id?.sessionRevision ?? 0,
      epoch: typeof id?.epoch === 'number' ? id.epoch : 0,
      generation: generationCounter,
    }
  }

  /** @param {string} phase */
  const emitPhase = phase => {
    try { onPhase?.(/** @type {import('./contracts').RestoreCoordinatorPhase} */ (phase)) } catch {}
  }

  /**
   * Acquire exclusive ownership before mutating any shared transaction state.
   * @param {'stage' | 'commit' | 'recover' | 'cleanup'} kind
   * @param {{ recoveryMode?: boolean, stagedBinding?: StagedBinding | null }} [opts]
   * @returns {ExclusiveTxContext}
   */
  const acquireExclusiveTx = (kind, { recoveryMode = false, stagedBinding = null } = {}) => {
    if (activeTx !== null) {
      throw Object.assign(new Error('RESTORE_BUSY'), { code: 'RESTORE_BUSY' })
    }
    const snap = readOwnerSnapshot()
    const ctx = {
      txToken: ++txTokenSeq,
      kind,
      ownerId: snap.ownerId,
      sessionRevision: snap.sessionRevision,
      epoch: snap.epoch,
      generation: snap.generation,
      lifecycle: stagedBinding ? stagedBinding.lifecycle : RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING,
      capturedPrevious: null,
      stagedBinding,
      recoveryMode,
    }
    activeTx = ctx
    return ctx
  }

  /** @param {ExclusiveTxContext} ctx */
  const releaseExclusiveTx = ctx => {
    if (activeTx && activeTx.txToken === ctx.txToken) {
      activeTx = null
    }
  }

  /**
   * Re-verify exclusive ownership, ownerId, sessionRevision, epoch, and generation at every await boundary.
   * Note (F05): Once a transaction is in `recoveryMode` OR has already reached durable `DECIDED`,
   * ordinary UI session expiry MUST NOT abort mandatory recovery/completion of the decided direction.
   * @param {ExclusiveTxContext} ctx
   */
  const assertTxBoundary = ctx => {
    if (!activeTx || activeTx.txToken !== ctx.txToken) {
      throw Object.assign(new Error('RESTORE_OWNERSHIP_LOST'), { code: 'CANCELLED' })
    }
    if (ctx.recoveryMode || ctx.lifecycle === RESTORE_MATERIAL_LIFECYCLE.DECIDED) {
      return
    }
    const cur = readOwnerSnapshot()
    if (
      cur.ownerId !== ctx.ownerId ||
      cur.sessionRevision !== ctx.sessionRevision ||
      cur.epoch !== ctx.epoch ||
      cur.generation !== ctx.generation
    ) {
      throw Object.assign(new Error('RESTORE_SESSION_OR_OWNER_CHANGED'), { code: 'CANCELLED' })
    }
  }

  /**
   * @param {ExclusiveTxContext} ctx
   * @param {string} nextLifecycle
   */
  const advanceLifecycle = (ctx, nextLifecycle) => {
    ctx.lifecycle = nextLifecycle
    if (ctx.stagedBinding) {
      ctx.stagedBinding.lifecycle = nextLifecycle
    }
  }

  /** @param {string} lifecycle */
  const isReferencedLifecycle = lifecycle =>
    lifecycle === RESTORE_MATERIAL_LIFECYCLE.PREPARED_REGISTERED ||
    lifecycle === RESTORE_MATERIAL_LIFECYCLE.DECIDED ||
    lifecycle === RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED

  /** @param {import('./contracts').RestoreCoordinatorPhase} phase */
  const handleCoordinatorPhase = phase => {
    const tx = activeTx
    if (tx) {
      if (phase === 'journal_persisting') {
        advanceLifecycle(tx, RESTORE_MATERIAL_LIFECYCLE.PREPARED_REGISTERED)
      } else if (phase === 'committing') {
        advanceLifecycle(tx, RESTORE_MATERIAL_LIFECYCLE.DECIDED)
      } else if (phase === 'unconfirmed') {
        advanceLifecycle(tx, RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED)
      } else if (phase === 'succeeded') {
        advanceLifecycle(tx, RESTORE_MATERIAL_LIFECYCLE.FINALIZED)
      }
    }
    emitPhase(phase)
  }

  const coordinator = createRestoreCoordinator({
    journal,
    state,
    journalRollback: true,
    commitStrategy,
    assertSession: () => {
      if (activeTx) assertTxBoundary(activeTx)
    },
    onPhase: handleCoordinatorPhase,
    validate: validateKanataGenerationDescriptor,
    validateRecovery: validateKanataGenerationDescriptor,
    prepare: async (options = {}) => {
      const tx = activeTx
      await engine.prepareWriteDrain({
        ...options,
        ownerId: tx?.ownerId,
        epoch: tx?.epoch,
      })
    },
    capture: async () => {
      const tx = activeTx
      const captured = validateKanataGenerationDescriptor(await engine.capturePreviousGeneration())
      if (tx) tx.capturedPrevious = captured
      return captured
    },
    apply: async descriptor => {
      const tx = activeTx
      await engine.applyGeneration(descriptor, {
        recoveryMode: Boolean(tx?.recoveryMode),
        ownerId: tx?.ownerId,
        epoch: tx?.epoch,
      })
    },
    synchronize,
  })

  return {
    /**
     * Probe both the encrypted RestoreJournal / Native durable control root and UNCONFIRMED records.
     */
    async probe() {
      await coordinator.probe()
      const unconfirmed = (await engine.inspectUnconfirmed?.()) ?? []
      if (unconfirmed.length > 0 && !state.blocked) {
        state.blocked = true
        state.message = '检测到未确认的加密备份/恢复提交记录，请先在设置中核验后再继续修改。'
        emitPhase('unconfirmed')
      }
      return {
        blocked: state.blocked,
        message: state.message,
        unconfirmed,
      }
    },

    /**
     * Query current lifecycle state for a staged descriptor.
     * @param {import('./contracts').KanataSqliteGenerationDescriptor | null | undefined} descriptor
     */
    getMaterialLifecycle(descriptor) {
      if (!descriptor || typeof descriptor !== 'object') return RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING
      const binding = stagedByObject.get(descriptor) || stagedByKey.get(bindingKey(descriptor))
      return binding ? binding.lifecycle : RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING
    },

    /**
     * Phase 1: Stream-decode KPB1 into isolated SQLCipher staging DB and run full 12-point verification.
     * Acquires exclusive staging ownership; never touches active DB or durable control head.
     * @param {import('./contracts').KanataPortableStageRequest} request
     */
    async stageAndVerify(request) {
      if (state.blocked) {
        throw Object.assign(new Error('RESTORE_RECOVERY_REQUIRED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
      if (state.busy) {
        throw Object.assign(new Error('RESTORE_BUSY'), { code: 'RESTORE_BUSY' })
      }
      const tx = acquireExclusiveTx('stage')
      try {
        emitPhase('reading_kpb1')
        const staged = await engine.stageAndVerify({
          ...request,
          ownerId: tx.ownerId,
          sessionRevision: tx.sessionRevision,
          epoch: tx.epoch,
        })
        try {
          assertTxBoundary(tx)
        } catch (sessionErr) {
          // Staging returned after session/owner invalidated: destroy unregistered staging safely!
          if (staged?.descriptor && !staged.descriptor.absent) {
            await engine.destroyStaging?.(staged.descriptor).catch(() => {})
          }
          throw sessionErr
        }
        const descriptor = validateKanataGenerationDescriptor(staged.descriptor)
        if (descriptor.absent || !descriptor.verified) {
          throw Object.assign(new Error('STAGING_NOT_VERIFIED'), { code: 'INVALID_LOGICAL' })
        }
        /** @type {StagedBinding} */
        const binding = {
          key: bindingKey(descriptor),
          descriptor,
          ownerId: tx.ownerId,
          sessionRevision: tx.sessionRevision,
          epoch: tx.epoch,
          generation: tx.generation,
          lifecycle: RESTORE_MATERIAL_LIFECYCLE.VERIFIED_AWAITING_CONFIRM,
        }
        stagedByObject.set(descriptor, binding)
        stagedByKey.set(binding.key, binding)
        emitPhase('awaiting_confirmation')
        return {
          descriptor,
          summary: staged.summary,
          metrics: staged.metrics,
          lifecycle: binding.lifecycle,
        }
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    /**
     * Cancel/discard a staging artifact ONLY when it has NOT entered PREPARED_REGISTERED or beyond.
     * STRICT F04: Never deletes any material referenced by an in-flight or UNCONFIRMED transaction.
     * @param {import('./contracts').KanataSqliteGenerationDescriptor | null} [descriptor]
     */
    async discardStaging(descriptor) {
      if (!descriptor || descriptor.absent) {
        return { discarded: false, reason: 'NO_STAGING' }
      }
      const binding = stagedByObject.get(descriptor) || stagedByKey.get(bindingKey(descriptor))
      if (binding && isReferencedLifecycle(binding.lifecycle)) {
        return { discarded: false, reason: 'MATERIAL_REFERENCED_BY_TX' }
      }
      // Also refuse if an exclusive commit/recover transaction is currently referencing this descriptor
      if (activeTx && activeTx.kind === 'commit' && activeTx.stagedBinding?.key === bindingKey(descriptor)) {
        return { discarded: false, reason: 'MATERIAL_REFERENCED_BY_TX' }
      }
      await engine.destroyStaging?.(descriptor)
      if (binding) {
        stagedByObject.delete(binding.descriptor)
        stagedByKey.delete(binding.key)
      }
      return { discarded: true, reason: 'DISCARDED' }
    },

    /**
     * Phase 2: Hand an authentically registered staging descriptor to the single RestoreCoordinator.
     * - Rejects externally forged `{ verified: true }` descriptors (F05).
     * - Verifies ownerId / sessionRevision / epoch / generation binding (F05).
     * - Protects materials from UI deletion once PREPARED_REGISTERED is reached (F04).
     * - Decouples post-FINALIZED `finalizeArtifacts` cleanup failure from business commit success (F04).
     *
     * @param {import('./contracts').KanataSqliteGenerationDescriptor} stagedDescriptor
     * @param {string} localMasterPassword
     */
    async commitStagedRestore(stagedDescriptor, localMasterPassword) {
      if (!localMasterPassword) {
        throw Object.assign(new Error('RESTORE_PASSWORD_REQUIRED'), { code: 'INVALID_PASSWORD_INPUT' })
      }
      const validated = validateKanataGenerationDescriptor(stagedDescriptor)
      if (validated.absent || !validated.verified) {
        throw Object.assign(new Error('STAGING_NOT_VERIFIED'), { code: 'INVALID_LOGICAL' })
      }

      // F05: Reject any externally fabricated descriptor not authentically registered by stageAndVerify()!
      const binding = stagedByObject.get(stagedDescriptor) || stagedByKey.get(bindingKey(validated))
      if (!binding) {
        throw Object.assign(new Error('STAGING_NOT_REGISTERED'), { code: 'STAGING_NOT_REGISTERED' })
      }
      if (binding.lifecycle !== RESTORE_MATERIAL_LIFECYCLE.VERIFIED_AWAITING_CONFIRM) {
        throw Object.assign(new Error('STAGING_LIFECYCLE_INVALID'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }

      // Verify owner/session/epoch/generation still matches the binding created at staging time!
      const curSnap = readOwnerSnapshot()
      if (
        curSnap.ownerId !== binding.ownerId ||
        curSnap.sessionRevision !== binding.sessionRevision ||
        curSnap.epoch !== binding.epoch ||
        curSnap.generation !== binding.generation
      ) {
        throw Object.assign(new Error('RESTORE_SESSION_OR_OWNER_CHANGED'), { code: 'CANCELLED' })
      }

      // Optional Native HMAC registration check before acquiring commit barrier
      if (typeof engine.verifyStagingRegistration === 'function') {
        await engine.verifyStagingRegistration(validated, {
          ownerId: binding.ownerId,
          sessionRevision: binding.sessionRevision,
          epoch: binding.epoch,
        })
      }

      const tx = acquireExclusiveTx('commit', { stagedBinding: binding })
      try {
        await coordinator.restore(validated, localMasterPassword)
        advanceLifecycle(tx, RESTORE_MATERIAL_LIFECYCLE.FINALIZED)

        // Business commit + journal.clear() SUCCEEDED!
        // F04: Artifact cleanup is strictly separated from business commit success.
        let cleanupError = ''
        try {
          await engine.finalizeArtifacts?.({
            previous: tx.capturedPrevious,
            target: validated,
          })
          pendingPostCommitCleanup = null
        } catch (gcErr) {
          cleanupError = (gcErr && typeof gcErr === 'object' && 'code' in gcErr && typeof gcErr.code === 'string')
            ? gcErr.code
            : 'ARTIFACT_CLEANUP_FAILED'
          pendingPostCommitCleanup = {
            previous: tx.capturedPrevious,
            target: validated,
          }
        }
        stagedByObject.delete(binding.descriptor)
        stagedByKey.delete(binding.key)
        return {
          committed: true,
          descriptor: validated,
          syncError: state.syncError,
          cleanupError,
        }
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    /**
     * Retry non-critical post-FINALIZED unreferenced artifact cleanup without re-importing business data.
     */
    async retryPostCommitCleanup() {
      if (!pendingPostCommitCleanup) {
        return { cleaned: true, cleanupError: '' }
      }
      if (state.blocked || state.busy) {
        return { cleaned: false, cleanupError: 'RESTORE_RECOVERY_REQUIRED' }
      }
      const tx = acquireExclusiveTx('cleanup')
      try {
        await engine.finalizeArtifacts?.(pendingPostCommitCleanup)
        pendingPostCommitCleanup = null
        return { cleaned: true, cleanupError: '' }
      } catch (err) {
        const code = (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string')
          ? err.code
          : 'ARTIFACT_CLEANUP_FAILED'
        return { cleaned: false, cleanupError: code }
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    /**
     * Recover an interrupted restore from the authoritative durable record / AES-GCM RestoreJournal.
     * Runs under `recoveryMode: true` so ordinary UI session revocation does NOT prevent recovery
     * of an already-prepared or decided transaction (F05 / B-01).
     * @param {string} localMasterPassword
     */
    async recover(localMasterPassword) {
      const tx = acquireExclusiveTx('recover', { recoveryMode: true })
      try {
        if (typeof journal.resolveRecovery === 'function') {
          // R01: Always drive Native cold-start recovery through the single RestoreCoordinator!
          await coordinator.recover(localMasterPassword)
          return {
            recovered: true,
            blocked: state.blocked,
            syncError: state.syncError,
            cleanupError: '',
          }
        }
        if (typeof engine.recoverAuthoritative === 'function') {
          const res = await engine.recoverAuthoritative(localMasterPassword)
          if (res?.recovered === true && res?.blocked === false) {
            state.blocked = false
            state.message = ''
            emitPhase('succeeded')
            return {
              recovered: true,
              blocked: false,
              convergedDirection: res.convergedDirection || '',
              syncError: state.syncError,
              cleanupError: res.cleanupError || '',
            }
          }
        }
        await coordinator.recover(localMasterPassword)
        return {
          recovered: true,
          blocked: state.blocked,
          syncError: state.syncError,
          cleanupError: '',
        }
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    retrySynchronization() {
      return coordinator.retrySynchronization()
    },

    async inspectUnconfirmed() {
      return (await engine.inspectUnconfirmed?.()) ?? []
    },

    /**
     * Re-verify an UNCONFIRMED task under Native stable lock + SHA-256 + directory fsync.
     * Serialized via exclusive cleanup lock so it cannot race with active restore/recover.
     * @param {string} taskId
     */
    async reverifyUnconfirmed(taskId) {
      if (!engine.reverifyUnconfirmed) {
        return { taskId, resolved: false, outcome: 'UNSUPPORTED', reason: 'NO_NATIVE_REVERIFY' }
      }
      const tx = acquireExclusiveTx('cleanup', { recoveryMode: true })
      try {
        const res = await engine.reverifyUnconfirmed(taskId)
        const remaining = (await engine.inspectUnconfirmed?.()) ?? []
        if (remaining.length === 0 && !(await journal.inspect())) {
          state.blocked = false
          state.message = ''
        }
        return res
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    /**
     * Manual safe cleanup for an UNCONFIRMED task.
     * Serialized via exclusive cleanup lock; refuses without confirmation or when journal/tx is active.
     * @param {string} taskId
     * @param {{ confirmed: boolean }} options
     */
    async manualCleanupUnconfirmed(taskId, { confirmed }) {
      if (confirmed !== true) {
        return { taskId, resolved: false, outcome: 'REFUSED', reason: 'USER_CONFIRMATION_REQUIRED' }
      }
      const tx = acquireExclusiveTx('cleanup', { recoveryMode: true })
      try {
        const pendingJournal = await journal.inspect()
        if (pendingJournal) {
          return { taskId, resolved: false, outcome: 'REFUSED_BLOCKED', reason: 'RESTORE_JOURNAL_PENDING' }
        }
        if (!engine.manualCleanupUnconfirmed) {
          return { taskId, resolved: false, outcome: 'REFUSED', reason: 'NO_NATIVE_CLEANUP' }
        }
        const res = await engine.manualCleanupUnconfirmed(taskId, {
          confirmed: true,
          restoreJournalPending: false,
        })
        const remaining = (await engine.inspectUnconfirmed?.()) ?? []
        if (remaining.length === 0 && !(await journal.inspect())) {
          state.blocked = false
          state.message = ''
        }
        return res
      } finally {
        releaseExclusiveTx(tx)
      }
    },

    invalidateGeneration() {
      generationCounter += 1
    },
  }
}
