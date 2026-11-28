// @ts-check
// M6-03-R Portable Restore UI Runtime & State Machine Controller (F04 / F05).
// Bridges SettingsBackup UI with capability detection, RestoreCoordinator commit status,
// explicit 6-state material lifecycle protection, cancellation propagation,
// post-FINALIZED cleanup decoupling, and UNCONFIRMED manual verification/safe cleanup.

import { reactive } from 'vue'
import { probeBackupRuntimeCapability } from '../platform/runtime/backupCapabilityProbe.js'
import { RESTORE_MATERIAL_LIFECYCLE } from './kanataPortableRestoreCoordinator.js'

/** @type {Readonly<Record<string, string>>} */
export const PORTABLE_RESTORE_PHASE_LABELS = Object.freeze({
  idle: '就绪',
  capability_check: '正在检测运行环境与桥接能力…',
  reading_kpb1: '正在流式读取加密备份容器…',
  authenticating: '正在校验密码与容器认证标签…',
  staging_import: '正在隔离 SQLCipher 临时库分批恢复…',
  verifying_staging: '正在核验 50 项表摘要、外键与完整性…',
  awaiting_confirmation: '临时库校验已通过，等待确认切换',
  coordinator_prepare: '正在排空写入并捕获原数据快照…',
  journal_persisting: '正在持久化加密恢复记录与两代登记…',
  applying: '正在执行世代原子切换与校验…',
  rolling_back: '切换异常，正在回滚至原世代…',
  committing: '正在写入持久决定标记…',
  clearing_journal: '正在完成 FINALIZED 并解除写入保护…',
  synchronizing: '正在同步派生提醒与桌面组件…',
  succeeded: '恢复成功（已完成协调器持久提交）',
  failed: '恢复失败（原数据已保全）',
  rollback_failed: '回滚失败（已保持写入保护）',
  cancelled: '已取消恢复（原数据未变更）',
  unconfirmed: '提交持久性待确认（需要人工核验）',
  manual_verification_required: '需要人工核验未确认记录',
})

/** @type {Readonly<Record<string, { message: string, retryHint: string }>>} */
const PORTABLE_ERROR_CATALOG = Object.freeze({
  AUTH_FAILED: {
    message: '备份密码或本地主密码校验失败。',
    retryHint: '请核对密码后重试；原数据未被修改。',
  },
  INVALID_PASSWORD_INPUT: {
    message: '备份密码不能为空或包含非法字符。',
    retryHint: '请输入有效的备份密码后重试。',
  },
  UNSUPPORTED_FORMAT: {
    message: '备份文件格式版本、加密套件或 Schema 版本不受当前版本支持。',
    retryHint: '请确认选择了兼容的加密备份文件，或更新至支持该版本的客户端。',
  },
  INVALID_CONTAINER: {
    message: '备份容器结构损坏、存在缺失/重复/乱序分块、截断或尾随数据。',
    retryHint: '请重新获取完整的备份文件后再尝试恢复；不完整数据不会被导入。',
  },
  INVALID_LOGICAL: {
    message: '备份数据未能通过 50 项表摘要、外键、ordinal 顺序或完整性复核。',
    retryHint: '该备份包数据一致性校验未通过，原数据保持不变；请换用完整备份。',
  },
  STAGING_NOT_REGISTERED: {
    message: '待提交的临时库未经过本会话真实 Native 登记，已拒绝切换。',
    retryHint: '请重新选择备份文件执行校验后再确认切换。',
  },
  MATERIAL_REFERENCED_BY_TX: {
    message: '该恢复材料已进入持久事务登记，不可由页面直接删除。',
    retryHint: '请等待当前事务完成或通过恢复入口按权威状态收敛。',
  },
  RESOURCE_LIMIT: {
    message: '备份文件超出有界内存、字段长度、分块数量或行数上限。',
    retryHint: '为防止内存溢出已安全中止，请保留原数据。',
  },
  CANCELLED: {
    message: '恢复操作已取消或会话已变更，未修改当前业务数据。',
    retryHint: '如需恢复，可重新选择备份文件并输入密码。',
  },
  DURABILITY_UNCONFIRMED: {
    message: '原子切换后目录持久性尚未确认，已进入保护状态。',
    retryHint: '请勿卸载应用或手动删除文件，请使用下方“人工核验”入口核验后再决定下一步。',
  },
  IO_FAILED: {
    message: '读取备份文件或写入隔离临时库时发生存储 I/O 错误。',
    retryHint: '请检查设备剩余空间与文件访问权限后重试；原数据已保留。',
  },
  RESTORE_RECOVERY_REQUIRED: {
    message: '存在未完成的恢复事务或未确认记录，当前处于写入保护状态。',
    retryHint: '请先完成既有恢复或人工核验后再发起新的恢复。',
  },
  RESTORE_BUSY: {
    message: '已有恢复任务正在进行中，请勿重复提交。',
    retryHint: '请等待当前任务完成或安全取消后再重试。',
  },
  CAPABILITY_UNAVAILABLE: {
    message: '当前运行环境不满足加密隔离恢复所需的能力条件。',
    retryHint: '请查看上方运行环境与 WebView/Bridge 检测详情。',
  },
  WEB_KPB1_RESTORE_UNAVAILABLE: {
    message: '当前 Web 浏览器未启用 KPB1 隔离 SQLCipher 恢复。',
    retryHint: 'Web 端请继续使用上方现有加密 .json 完整/单项恢复。',
  },
  ROLLBACK_FAILED: {
    message: '恢复失败且回滚未完全成功，系统已保持写入保护并保留持久控制记录。',
    retryHint: '请勿卸载应用，请重新验证身份后使用恢复入口继续恢复原数据。',
  },
})

/**
 * Resolve stable user-facing error metadata without leaking secrets or raw payloads.
 * @param {unknown} error
 */
export function describePortableRestoreError(error) {
  if (error && typeof error === 'object' && 'rollbackFailed' in error && error.rollbackFailed === true) {
    return { code: 'ROLLBACK_FAILED', ...PORTABLE_ERROR_CATALOG.ROLLBACK_FAILED }
  }
  const rawCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : (error instanceof Error ? error.message : '')
  if (rawCode && Object.hasOwn(PORTABLE_ERROR_CATALOG, rawCode)) {
    return { code: rawCode, ...PORTABLE_ERROR_CATALOG[rawCode] }
  }
  return {
    code: rawCode && /^[A-Z0-9_]{3,64}$/.test(rawCode) ? rawCode : 'IO_FAILED',
    message: '恢复过程未能完成，原数据与恢复材料已安全保留。',
    retryHint: '请核对运行环境、存储空间和备份密码后重试。',
  }
}

/** @param {string} lifecycle */
function isProtectedTransactionLifecycle(lifecycle) {
  return lifecycle === RESTORE_MATERIAL_LIFECYCLE.PREPARED_REGISTERED ||
    lifecycle === RESTORE_MATERIAL_LIFECYCLE.DECIDED ||
    lifecycle === RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED
}

/**
 * Create reactive controller for portable encrypted backup capability, restore workflow,
 * 6-state material lifecycle safety, cancellation, post-commit cleanup decoupling,
 * and UNCONFIRMED manual verification.
 *
 * @param {{
 *   probeCapability?: () => Promise<import('./contracts').BackupRuntimeCapability>,
 *   coordinator?: ReturnType<typeof import('./kanataPortableRestoreCoordinator.js').createKanataPortableRestoreCoordinator> | null,
 *   onDisposed?: () => void,
 * }} [options]
 */
export function createKanataPortableRestoreRuntime({
  probeCapability = () => probeBackupRuntimeCapability(),
  coordinator = null,
  onDisposed,
} = {}) {
  let disposed = false
  let opSeq = 0
  let activeCommitInFlight = false
  let activeAbortController = /** @type {AbortController | null} */ (null)
  let selectedFile = /** @type {File | Blob | { name?: string, uri?: string, path?: string } | null} */ (null)
  let pendingStagedDescriptor = /** @type {import('./contracts').KanataSqliteGenerationDescriptor | null} */ (null)

  const state = reactive({
    capabilityLoading: false,
    /** @type {import('./contracts').BackupRuntimeCapability | null} */
    capability: null,
    /** @type {import('./contracts').RestoreCoordinatorPhase} */
    phase: 'idle',
    phaseLabel: PORTABLE_RESTORE_PHASE_LABELS.idle,
    materialLifecycle: /** @type {string} */ (RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING),
    progressPercent: 0,
    busy: false,
    selectedFileName: '',
    /** @type {{ datasetIdentity: string, worldCount: number, messageCount: number, totalBusinessRows: number, tableCount: number } | null} */
    stagedSummary: null,
    /** @type {{ committed: boolean, datasetIdentity: string, totalBusinessRows: number, tableCount: number, completedAt: number } | null} */
    completionResult: null,
    errorCode: '',
    errorMessage: '',
    retryHint: '',
    /** @type {'' | 'pre_commit' | 'post_decision' | 'post_finalize_cleanup'} */
    failureStage: '',
    syncError: '',
    cleanupError: '',
    /** @type {import('./contracts').UnconfirmedTaskSummary[]} */
    unconfirmedItems: [],
    unconfirmedBusy: false,
    unconfirmedMessage: '',
  })

  const syncLifecycleFromCoordinator = () => {
    if (coordinator && typeof coordinator.getMaterialLifecycle === 'function' && pendingStagedDescriptor) {
      state.materialLifecycle = coordinator.getMaterialLifecycle(pendingStagedDescriptor)
    }
  }

  const isCurrentMaterialProtected = () => {
    syncLifecycleFromCoordinator()
    return activeCommitInFlight || isProtectedTransactionLifecycle(state.materialLifecycle)
  }

  const setPhase = (/** @type {import('./contracts').RestoreCoordinatorPhase} */ nextPhase, percent) => {
    if (disposed) return
    state.phase = nextPhase
    state.phaseLabel = PORTABLE_RESTORE_PHASE_LABELS[nextPhase] || nextPhase
    if (typeof percent === 'number') {
      state.progressPercent = Math.max(0, Math.min(100, Math.round(percent)))
    }
    if (nextPhase === 'journal_persisting') {
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.PREPARED_REGISTERED
    } else if (nextPhase === 'committing') {
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.DECIDED
    } else if (nextPhase === 'unconfirmed') {
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED
    } else if (nextPhase === 'succeeded') {
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.FINALIZED
    }
  }

  const clearErrors = () => {
    state.errorCode = ''
    state.errorMessage = ''
    state.retryHint = ''
    state.failureStage = ''
  }

  const refreshCapability = async () => {
    if (disposed) return null
    state.capabilityLoading = true
    try {
      const cap = await probeCapability()
      if (disposed) return null
      state.capability = cap
      return cap
    } finally {
      if (!disposed) state.capabilityLoading = false
    }
  }

  const refreshUnconfirmed = async () => {
    if (disposed || !coordinator) return []
    const items = await coordinator.inspectUnconfirmed()
    if (disposed) return []
    state.unconfirmedItems = Array.isArray(items) ? items : []
    if (state.unconfirmedItems.length > 0 && state.phase === 'idle') {
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED
      setPhase('manual_verification_required', 0)
    }
    return state.unconfirmedItems
  }

  /**
   * Select a new backup file / SAF document.
   * F04: If an unregistered staging exists awaiting confirmation, safely discard it first.
   * If a material is already PREPARED_REGISTERED or commit is active, REFUSE reselection!
   * @param {File | { name?: string, uri?: string, path?: string } | null} file
   */
  const selectBackupFile = file => {
    if (disposed || state.busy || isCurrentMaterialProtected()) return
    const previousStaged = pendingStagedDescriptor
    pendingStagedDescriptor = null
    if (previousStaged && coordinator) {
      void coordinator.discardStaging(previousStaged).catch(() => {})
    }
    selectedFile = file || null
    state.selectedFileName = file && typeof file.name === 'string' ? file.name : ''
    state.stagedSummary = null
    state.completionResult = null
    state.cleanupError = ''
    state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING
    clearErrors()
    if (state.phase !== 'unconfirmed' && state.phase !== 'manual_verification_required' && state.phase !== 'rollback_failed') {
      setPhase('idle', 0)
    }
  }

  /**
   * Step 1: Capability check -> bounded KPB1 decode -> isolated SQLCipher staging -> full verification.
   * Never mutates active DB; pauses at `awaiting_confirmation`.
   * @param {{ backupPassword: string, localMasterPassword?: string }} params
   */
  const startStaging = async ({ backupPassword, localMasterPassword = '' }) => {
    if (disposed) return false
    if (state.busy || isCurrentMaterialProtected()) {
      const err = describePortableRestoreError({ code: isCurrentMaterialProtected() ? 'RESTORE_RECOVERY_REQUIRED' : 'RESTORE_BUSY' })
      state.errorCode = err.code
      state.errorMessage = err.message
      state.retryHint = err.retryHint
      return false
    }
    // Clean any stale unregistered staging before starting a fresh staging job
    if (pendingStagedDescriptor && coordinator) {
      const stale = pendingStagedDescriptor
      pendingStagedDescriptor = null
      await coordinator.discardStaging(stale).catch(() => {})
    }

    const myOp = ++opSeq
    clearErrors()
    state.completionResult = null
    state.stagedSummary = null
    state.syncError = ''
    state.cleanupError = ''
    state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING
    state.busy = true
    setPhase('capability_check', 2)

    const controller = new AbortController()
    activeAbortController = controller
    try {
      const cap = await refreshCapability()
      if (disposed || myOp !== opSeq || controller.signal.aborted) {
        if (!disposed && myOp === opSeq) setPhase('cancelled', 0)
        return false
      }
      if (!cap || !cap.portableRestoreAvailable) {
        state.errorCode = cap?.unavailableCode || 'CAPABILITY_UNAVAILABLE'
        state.errorMessage = cap?.unavailableReason || PORTABLE_ERROR_CATALOG.CAPABILITY_UNAVAILABLE.message
        state.retryHint = PORTABLE_ERROR_CATALOG[state.errorCode]?.retryHint || PORTABLE_ERROR_CATALOG.CAPABILITY_UNAVAILABLE.retryHint
        setPhase('failed', 0)
        return false
      }
      if (!selectedFile) {
        const err = describePortableRestoreError({ code: 'IO_FAILED' })
        state.errorCode = err.code
        state.errorMessage = '请先选择加密备份文件。'
        state.retryHint = '点击选择备份文件后再开始校验与恢复。'
        setPhase('failed', 0)
        return false
      }
      if (!backupPassword) {
        const err = describePortableRestoreError({ code: 'INVALID_PASSWORD_INPUT' })
        state.errorCode = err.code
        state.errorMessage = err.message
        state.retryHint = err.retryHint
        setPhase('failed', 0)
        return false
      }
      if (!coordinator) {
        state.errorCode = 'CAPABILITY_UNAVAILABLE'
        state.errorMessage = '当前运行环境尚未挂载隔离 SQLCipher 恢复引擎（保持 legacy 生产隔离）。'
        state.retryHint = '普通构建请继续使用上方加密 .json 完整/单项恢复。'
        setPhase('failed', 0)
        return false
      }

      const staged = await coordinator.stageAndVerify({
        source: /** @type {any} */ (selectedFile),
        backupPassword,
        localMasterPassword,
        signal: controller.signal,
        onProgress: p => {
          if (!disposed && myOp === opSeq) setPhase(p.phase, p.percent)
        },
      })
      // F04/F05: If cancelled, superseded, or disposed while underlying staging finished late,
      // discard the unregistered staging and never pollute newer transaction state!
      if (disposed || myOp !== opSeq || controller.signal.aborted) {
        await coordinator.discardStaging(staged.descriptor).catch(() => {})
        if (!disposed && myOp === opSeq) setPhase('cancelled', 0)
        return false
      }
      pendingStagedDescriptor = staged.descriptor
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.VERIFIED_AWAITING_CONFIRM
      state.stagedSummary = {
        datasetIdentity: staged.descriptor.datasetIdentity,
        worldCount: staged.summary?.worldCount ?? 0,
        messageCount: staged.summary?.messageCount ?? 0,
        totalBusinessRows: staged.descriptor.totalBusinessRows,
        tableCount: staged.descriptor.tableCount,
      }
      setPhase('awaiting_confirmation', 80)
      return true
    } catch (error) {
      if (disposed || myOp !== opSeq) return false
      const info = describePortableRestoreError(error)
      state.errorCode = info.code
      state.errorMessage = info.message
      state.retryHint = info.retryHint
      setPhase(info.code === 'CANCELLED' ? 'cancelled' : 'failed', 0)
      return false
    } finally {
      if (activeAbortController === controller) activeAbortController = null
      if (!disposed && myOp === opSeq) state.busy = false
    }
  }

  /**
   * Step 2: Hand authentically registered staging descriptor to RestoreCoordinator.
   * Only marks `succeeded` when actual Coordinator commit resolves with committed === true!
   * F04: Decouples post-FINALIZED cleanup failure (`cleanupError`) from committed business success.
   * @param {{ localMasterPassword: string }} params
   */
  const confirmCommitRestore = async ({ localMasterPassword }) => {
    if (disposed || state.busy || activeCommitInFlight || !coordinator || !pendingStagedDescriptor) return false
    const myOp = ++opSeq
    const descriptorToCommit = pendingStagedDescriptor
    clearErrors()
    state.cleanupError = ''
    state.busy = true
    activeCommitInFlight = true
    setPhase('coordinator_prepare', 82)
    try {
      const cap = await refreshCapability()
      if (!cap || !cap.portableRestoreAvailable) {
        state.errorCode = cap?.unavailableCode || 'CAPABILITY_UNAVAILABLE'
        state.errorMessage = cap?.unavailableReason || PORTABLE_ERROR_CATALOG.CAPABILITY_UNAVAILABLE.message
        state.retryHint = PORTABLE_ERROR_CATALOG.CAPABILITY_UNAVAILABLE.retryHint
        setPhase('failed', 0)
        return false
      }
      const result = await coordinator.commitStagedRestore(descriptorToCommit, localMasterPassword)
      if (!result || result.committed !== true) {
        throw Object.assign(new Error('COORDINATOR_COMMIT_NOT_CONFIRMED'), { code: 'IO_FAILED' })
      }
      pendingStagedDescriptor = null
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.FINALIZED
      state.syncError = result.syncError || ''
      // F04: Business commit succeeded! Report cleanupError separately without failing or inducing re-import!
      state.cleanupError = result.cleanupError
        ? `业务数据已成功提交并生效，但旧临时材料清理失败（${result.cleanupError}），请点击“重试清理临时材料”，切勿重复导入。`
        : ''
      state.failureStage = result.cleanupError ? 'post_finalize_cleanup' : ''
      state.completionResult = {
        committed: true,
        datasetIdentity: result.descriptor.datasetIdentity,
        totalBusinessRows: result.descriptor.totalBusinessRows,
        tableCount: result.descriptor.tableCount,
        completedAt: Date.now(),
      }
      setPhase('succeeded', 100)
      return true
    } catch (error) {
      if (disposed || myOp !== opSeq) return false
      syncLifecycleFromCoordinator()
      const info = describePortableRestoreError(error)
      state.errorCode = info.code
      state.errorMessage = info.message
      state.retryHint = info.retryHint
      state.failureStage = (error && typeof error === 'object' && 'failureStage' in error && (error.failureStage === 'post_decision' || error.failureStage === 'pre_commit'))
        ? /** @type {'pre_commit' | 'post_decision'} */ (error.failureStage)
        : 'pre_commit'
      if (info.code === 'DURABILITY_UNCONFIRMED') {
        state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNCONFIRMED
        setPhase('unconfirmed', 90)
        await refreshUnconfirmed().catch(() => {})
      } else if (info.code === 'ROLLBACK_FAILED') {
        setPhase('rollback_failed', 0)
      } else if (info.code === 'CANCELLED') {
        setPhase('cancelled', 0)
      } else {
        setPhase('failed', 0)
      }
      return false
    } finally {
      activeCommitInFlight = false
      if (!disposed && myOp === opSeq) state.busy = false
    }
  }

  /**
   * F04: Cancel restore safely.
   * - Before PREPARED_REGISTERED: aborts staging and discards unregistered staging material.
   * - During commit / after PREPARED_REGISTERED / DECIDED / UNCONFIRMED: NEVER deletes any
   *   transaction-referenced material! Surfaces MATERIAL_REFERENCED_BY_TX guidance instead.
   */
  const cancelRestore = async () => {
    if (isCurrentMaterialProtected()) {
      if (!disposed) {
        const info = describePortableRestoreError({ code: 'MATERIAL_REFERENCED_BY_TX' })
        state.errorCode = info.code
        state.errorMessage = info.message
        state.retryHint = info.retryHint
      }
      return { cancelled: false, reason: 'MATERIAL_REFERENCED_BY_TX' }
    }
    opSeq += 1
    if (activeAbortController) {
      activeAbortController.abort()
    }
    const staged = pendingStagedDescriptor
    pendingStagedDescriptor = null
    if (staged && coordinator) {
      const disc = await coordinator.discardStaging(staged).catch(() => ({ discarded: false, reason: 'IO_FAILED' }))
      if (disc && disc.reason === 'MATERIAL_REFERENCED_BY_TX') {
        pendingStagedDescriptor = staged
        if (!disposed) {
          const info = describePortableRestoreError({ code: 'MATERIAL_REFERENCED_BY_TX' })
          state.errorCode = info.code
          state.errorMessage = info.message
          state.retryHint = info.retryHint
        }
        return { cancelled: false, reason: 'MATERIAL_REFERENCED_BY_TX' }
      }
    }
    if (!disposed) {
      state.busy = false
      state.stagedSummary = null
      state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.UNREGISTERED_STAGING
      state.errorCode = 'CANCELLED'
      state.errorMessage = PORTABLE_ERROR_CATALOG.CANCELLED.message
      state.retryHint = PORTABLE_ERROR_CATALOG.CANCELLED.retryHint
      setPhase('cancelled', 0)
    }
    return { cancelled: true, reason: 'CANCELLED' }
  }

  const retrySync = async () => {
    if (disposed || !coordinator) return
    await coordinator.retrySynchronization()
    if (!disposed) state.syncError = ''
  }

  const retryCleanup = async () => {
    if (disposed || !coordinator || typeof coordinator.retryPostCommitCleanup !== 'function') return false
    const res = await coordinator.retryPostCommitCleanup()
    if (!disposed) {
      state.cleanupError = res.cleaned
        ? ''
        : `临时材料清理暂未完成（${res.cleanupError}），业务数据保持已提交状态，可稍后重试。`
      state.failureStage = res.cleaned ? (state.failureStage === 'post_finalize_cleanup' ? '' : state.failureStage) : 'post_finalize_cleanup'
    }
    return Boolean(res.cleaned)
  }

  /**
   * Recover an interrupted durable restore through the real RestoreCoordinator (never bypassing coordinator).
   * @param {{ localMasterPassword: string }} params
   */
  const recoverInterrupted = async ({ localMasterPassword }) => {
    if (disposed || state.busy || !coordinator) return null
    clearErrors()
    state.busy = true
    try {
      const res = await coordinator.recover(localMasterPassword)
      if (!disposed && res?.recovered && !res.blocked) {
        pendingStagedDescriptor = null
        state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.FINALIZED
        state.syncError = res.syncError || ''
        setPhase('succeeded', 100)
      }
      return res
    } catch (error) {
      if (!disposed) {
        const info = describePortableRestoreError(error)
        state.errorCode = info.code
        state.errorMessage = info.message
        state.retryHint = info.retryHint
        setPhase('failed', 0)
      }
      throw error
    } finally {
      if (!disposed) state.busy = false
    }
  }

  /** @param {string} taskId */
  const reverifyUnconfirmed = async taskId => {
    if (disposed || !coordinator || state.unconfirmedBusy) return null
    state.unconfirmedBusy = true
    state.unconfirmedMessage = ''
    try {
      const res = await coordinator.reverifyUnconfirmed(taskId)
      await refreshUnconfirmed()
      if (!disposed) {
        state.unconfirmedMessage = res.resolved
          ? `任务 ${taskId} 已通过核验（${res.outcome}）。`
          : `任务 ${taskId} 暂无法证明安全（${res.reason}），已保持保护状态。`
        if (state.unconfirmedItems.length === 0 && (state.phase === 'unconfirmed' || state.phase === 'manual_verification_required')) {
          state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.FINALIZED
          setPhase('idle', 0)
        }
      }
      return res
    } finally {
      if (!disposed) state.unconfirmedBusy = false
    }
  }

  /**
   * @param {string} taskId
   * @param {{ confirmed: boolean }} options
   */
  const manualCleanupUnconfirmed = async (taskId, { confirmed }) => {
    if (disposed || !coordinator || state.unconfirmedBusy) return null
    state.unconfirmedBusy = true
    state.unconfirmedMessage = ''
    try {
      const res = await coordinator.manualCleanupUnconfirmed(taskId, { confirmed })
      await refreshUnconfirmed()
      if (!disposed) {
        state.unconfirmedMessage = res.resolved
          ? `任务 ${taskId} 已安全确认并清理（${res.outcome}）。`
          : `安全门禁已阻止清理任务 ${taskId}（${res.reason}），原材料保留。`
        if (state.unconfirmedItems.length === 0 && (state.phase === 'unconfirmed' || state.phase === 'manual_verification_required')) {
          state.materialLifecycle = RESTORE_MATERIAL_LIFECYCLE.FINALIZED
          setPhase('idle', 0)
        }
      }
      return res
    } finally {
      if (!disposed) state.unconfirmedBusy = false
    }
  }

  /**
   * F04: UI unmount/dispose safety.
   * - Aborts in-flight UNREGISTERED staging only.
   * - If commit is in flight or material has entered PREPARED_REGISTERED/DECIDED/UNCONFIRMED,
   *   NEVER calls destroyStaging! Leaves durable materials untouched for authoritative control layer.
   */
  const dispose = () => {
    disposed = true
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
    const staged = pendingStagedDescriptor
    pendingStagedDescriptor = null
    selectedFile = null
    if (staged && coordinator && !isProtectedTransactionLifecycle(state.materialLifecycle) && !activeCommitInFlight) {
      void coordinator.discardStaging(staged).catch(() => {})
    }
    onDisposed?.()
  }

  return {
    state,
    refreshCapability,
    refreshUnconfirmed,
    selectBackupFile,
    startStaging,
    confirmCommitRestore,
    cancelRestore,
    retrySync,
    retryCleanup,
    recoverInterrupted,
    reverifyUnconfirmed,
    manualCleanupUnconfirmed,
    dispose,
  }
}
