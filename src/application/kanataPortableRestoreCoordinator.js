// @ts-check
// M6-03 Kanata SQLCipher Portable Restore Coordinator.
// Deeply integrates isolated SQLCipher staging restore into the project's single
// RestoreCoordinator + AES-GCM RestoreJournal protocol. Never bypasses coordinator
// or deletes journals to clear errors.

import { createRestoreCoordinator } from './restoreCoordinator.js'

export const KANATA_SQLITE_GENERATION_KIND = 'kanata-sqlite-generation-v1'
export const KANATA_SQLITE_APPLICATION_ID = 0x4b4e5441
export const KANATA_SQLITE_SCHEMA_VERSION = 5
export const KANATA_SQLITE_SCHEMA_005_FINGERPRINT = '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a'
export const KANATA_SQLITE_VERIFIER_COUNT = 50

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
 * Create the M6-03 Kanata Portable Restore Coordinator wrapping the product's
 * RestoreCoordinator + AES-GCM RestoreJournal.
 *
 * Guarantees:
 * - Staging & verification happen completely outside active DB mutation.
 * - Unverified staging artifacts are rejected before coordinator prepare/journal.
 * - Every async boundary re-checks owner, session revision, and restore generation.
 * - Previous generation is captured durably before journal prepare and retained until
 *   after journal.clear() succeeds.
 * - Rollback failure keeps state.blocked=true and retains encrypted journal & materials.
 * - DURABILITY_UNCONFIRMED retains protected state for manual verification; never auto-deletes.
 * - Derived sync errors are kept separate from business DB commit success.
 *
 * @param {import('./contracts').KanataPortableRestoreCoordinatorOptions} options
 */
export function createKanataPortableRestoreCoordinator({
  journal,
  state,
  engine,
  getOwnerIdentity,
  synchronize = async () => {},
  onPhase,
}) {
  if (!journal || !state || !engine) {
    throw new Error('PORTABLE_RESTORE_COORDINATOR_DEPS_REQUIRED')
  }

  let restoreGeneration = 0
  /** @type {import('./contracts').KanataSqliteGenerationDescriptor | null} */
  let lastCapturedPrevious = null
  /** @type {import('./contracts').KanataSqliteGenerationDescriptor | null} */
  let lastStagedTarget = null

  /** @param {string} phase */
  const emitPhase = phase => {
    try { onPhase?.(/** @type {import('./contracts').RestoreCoordinatorPhase} */ (phase)) } catch {}
  }

  const snapshotIdentity = () => {
    const id = getOwnerIdentity?.()
    return {
      ownerId: id?.ownerId ?? 'default',
      sessionRevision: id?.sessionRevision ?? 0,
      generation: restoreGeneration,
    }
  }

  /** @param {{ ownerId: string, sessionRevision: number, generation: number }} expected */
  const assertIdentityMatches = expected => {
    const current = getOwnerIdentity?.()
    const curOwner = current?.ownerId ?? 'default'
    const curSession = current?.sessionRevision ?? 0
    if (curOwner !== expected.ownerId || curSession !== expected.sessionRevision || restoreGeneration !== expected.generation) {
      throw Object.assign(new Error('RESTORE_SESSION_OR_OWNER_CHANGED'), { code: 'CANCELLED' })
    }
  }

  /** @type {{ ownerId: string, sessionRevision: number, generation: number } | null} */
  let activeExpectedIdentity = null

  const assertActiveSession = () => {
    if (activeExpectedIdentity) {
      assertIdentityMatches(activeExpectedIdentity)
    }
  }

  const coordinator = createRestoreCoordinator({
    journal,
    state,
    journalRollback: true,
    assertSession: assertActiveSession,
    onPhase: emitPhase,
    validate: validateKanataGenerationDescriptor,
    validateRecovery: validateKanataGenerationDescriptor,
    prepare: async (options = {}) => {
      await engine.prepareWriteDrain(options)
    },
    capture: async () => {
      const captured = validateKanataGenerationDescriptor(await engine.capturePreviousGeneration())
      lastCapturedPrevious = captured
      return captured
    },
    apply: async descriptor => {
      await engine.applyGeneration(descriptor)
    },
    synchronize,
  })

  return {
    /**
     * Probe both the encrypted RestoreJournal and any Native UNCONFIRMED records.
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
     * Phase 1: Stream-decode KPB1 into isolated SQLCipher staging DB and run full 12-point verification.
     * Does NOT touch active DB or RestoreJournal.
     * @param {import('./contracts').KanataPortableStageRequest} request
     */
    async stageAndVerify(request) {
      if (state.blocked) {
        throw Object.assign(new Error('RESTORE_RECOVERY_REQUIRED'), { code: 'RESTORE_RECOVERY_REQUIRED' })
      }
      if (state.busy) {
        throw Object.assign(new Error('RESTORE_BUSY'), { code: 'RESTORE_BUSY' })
      }
      const expected = snapshotIdentity()
      emitPhase('reading_kpb1')
      const staged = await engine.stageAndVerify(request)
      assertIdentityMatches(expected)
      const descriptor = validateKanataGenerationDescriptor(staged.descriptor)
      if (descriptor.absent || !descriptor.verified) {
        throw Object.assign(new Error('STAGING_NOT_VERIFIED'), { code: 'INVALID_LOGICAL' })
      }
      lastStagedTarget = descriptor
      emitPhase('awaiting_confirmation')
      return {
        descriptor,
        summary: staged.summary,
        metrics: staged.metrics,
      }
    },

    /**
     * Cancel/discard a prepared staging artifact before coordinator commit.
     * @param {import('./contracts').KanataSqliteGenerationDescriptor | null} [descriptor]
     */
    async discardStaging(descriptor = lastStagedTarget) {
      if (descriptor && !descriptor.absent) {
        await engine.destroyStaging?.(descriptor)
      }
      if (descriptor === lastStagedTarget) {
        lastStagedTarget = null
      }
    },

    /**
     * Phase 2: Hand a fully verified staging descriptor to the single RestoreCoordinator.
     * Checks owner, session revision, and restore generation after every await.
     * Cleans up unreferenced rollback/staging artifacts ONLY AFTER journal.clear() succeeds.
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
      restoreGeneration += 1
      activeExpectedIdentity = snapshotIdentity()
      lastCapturedPrevious = null
      try {
        await coordinator.restore(validated, localMasterPassword)
        // Coordinator commit + journal.clear() succeeded! Safe to clean up proven-unreferenced artifacts.
        await engine.finalizeArtifacts?.({
          previous: lastCapturedPrevious,
          target: validated,
        })
        lastStagedTarget = null
        lastCapturedPrevious = null
        return {
          committed: true,
          descriptor: validated,
          syncError: state.syncError,
        }
      } finally {
        activeExpectedIdentity = null
      }
    },

    /**
     * Recover an interrupted restore from the AES-GCM encrypted RestoreJournal.
     * Before commit marker -> restores previous; after commit marker -> replays target.
     * @param {string} localMasterPassword
     */
    async recover(localMasterPassword) {
      restoreGeneration += 1
      activeExpectedIdentity = snapshotIdentity()
      try {
        await coordinator.recover(localMasterPassword)
        return {
          recovered: true,
          blocked: state.blocked,
          syncError: state.syncError,
        }
      } finally {
        activeExpectedIdentity = null
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
     * @param {string} taskId
     */
    async reverifyUnconfirmed(taskId) {
      if (!engine.reverifyUnconfirmed) {
        return { taskId, resolved: false, outcome: 'UNSUPPORTED', reason: 'NO_NATIVE_REVERIFY' }
      }
      const res = await engine.reverifyUnconfirmed(taskId)
      const remaining = (await engine.inspectUnconfirmed?.()) ?? []
      if (remaining.length === 0 && !(await journal.inspect())) {
        state.blocked = false
        state.message = ''
      }
      return res
    },

    /**
     * Manual safe cleanup for an UNCONFIRMED task.
     * Refuses without explicit confirmation, refuses when restore journal is pending,
     * and refuses whenever safety (lock/inode/containment/SHA-256) cannot be proven.
     * @param {string} taskId
     * @param {{ confirmed: boolean }} options
     */
    async manualCleanupUnconfirmed(taskId, { confirmed }) {
      if (confirmed !== true) {
        return { taskId, resolved: false, outcome: 'REFUSED', reason: 'USER_CONFIRMATION_REQUIRED' }
      }
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
    },

    invalidateGeneration() {
      restoreGeneration += 1
    },
  }
}
