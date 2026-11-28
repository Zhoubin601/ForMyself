// @ts-check
import { openRestoreRecord } from '../platform/storage/restoreJournal.js'

// Runtime adapters are the same participants used by the product, not a second transaction implementation.
/** @template Snapshot @param {import('./contracts').RestoreCoordinatorOptions<Snapshot>} options */
export function createRestoreCoordinator({
  journal,
  state,
  prepare,
  capture,
  apply,
  validate,
  validateRecovery = validate,
  synchronize = async () => {},
  journalRollback = false,
  commitStrategy = 'apply_then_commit',
  assertSession,
  onPhase,
}) {
  if(typeof journalRollback!=='boolean')throw new Error('INVALID_JOURNAL_ROLLBACK_OPTION')
  if(commitStrategy!=='apply_then_commit'&&commitStrategy!=='decision_then_apply')throw new Error('INVALID_COMMIT_STRATEGY')
  const checkSession = () => { assertSession?.() }
  const reportPhase = (/** @type {import('./contracts').RestoreCoordinatorPhase} */ phase) => {
    try { onPhase?.(phase) } catch { /* phase observers must never disrupt transaction control */ }
  }
  const isDurabilityUnconfirmed = (/** @type {unknown} */ error) => Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'DURABILITY_UNCONFIRMED'
  )
  const tagFailureStage = (/** @type {unknown} */ error, /** @type {'pre_commit' | 'post_decision'} */ failureStage) => {
    if (error instanceof Error) {
      Object.assign(error, { failureStage, postDecision: failureStage === 'post_decision' })
      return error
    }
    return Object.assign(new Error(String(error || 'RESTORE_FAILED')), {
      failureStage,
      postDecision: failureStage === 'post_decision',
    })
  }
  // This helper returns no snapshot in journal mode. Its capture cannot stay in the
  // long-lived apply closure after the complete authenticated journal has been persisted.
  const prepareRollback=async (/** @type {Snapshot} */ target,/** @type {string} */ password)=>{
    const previous=validate(await capture())
    checkSession()
    reportPhase('journal_persisting')
    const prepared=await journal.prepare({version:1,previous,target},password)
    checkSession()
    if(journalRollback){
      if(!prepared||!/^[a-f0-9]{64}$/.test(prepared.digest))throw new Error('RESTORE_ROLLBACK_DIGEST_REQUIRED')
      return{retained:null,digest:prepared.digest}
    }
    return{retained:{previous},digest:prepared&&typeof prepared.digest==='string'?prepared.digest:''}
  }
  const readRollback=async (/** @type {string} */ digest,/** @type {string} */ password)=>{
    const record=await journal.inspect()
    checkSession()
    if(!record||record.committed||record.digest!==digest)throw new Error('RESTORE_ROLLBACK_RECORD_CHANGED')
    const snapshots=await openRestoreRecord(record.encrypted,password)
    checkSession()
    if(snapshots.version!==1)throw new Error('UNSUPPORTED_RESTORE_RECORD')
    return validateRecovery(snapshots.previous)
  }
  const block = (/** @type {string} */ message) => { state.blocked = true; state.message = message }
  const synchronizeSafely = async () => {
    reportPhase('synchronizing')
    try { await synchronize(); state.syncError = '' }
    catch { state.syncError = '数据已恢复，提醒或桌面组件同步失败，请重试同步' }
  }
  const finish = async () => {
    reportPhase('clearing_journal')
    await journal.clear()
    state.blocked = false; state.message = ''
  }
  const execute = async (/** @type {() => Promise<unknown>} */ action) => {
    if (state.busy) throw new Error('RESTORE_BUSY')
    state.busy = true; block('正在安全恢复数据，请稍候…')
    try { return await action() }
    catch (error) {
      if (isDurabilityUnconfirmed(error)) {
        block('恢复提交持久性待确认，原恢复材料已保留，请先进行人工核验；请勿卸载应用。')
        reportPhase('unconfirmed')
      } else if (state.blocked) {
        block('恢复尚未完成，原恢复材料已保留，请验证身份后重试；请勿卸载应用。')
      }
      throw error
    }
    finally { state.busy = false }
  }
  return {
    async probe() {
      try {
        state.blocked = Boolean(await journal.inspect())
        state.message = state.blocked ? '检测到未完成的数据恢复，请验证身份后继续。' : ''
      } catch { block('恢复记录无法读取，请保留应用数据并重试。') }
    },
    restore(/** @type {unknown} */ input, /** @type {string} */ password) {
      if (state.blocked) return Promise.reject(new Error('RESTORE_RECOVERY_REQUIRED'))
      const target = validate(input) // Invalid input causes no journal or business writes.
      return execute(async () => {
        let recorded = false
        let decided = false
        let preDecisionAborted = false
        let preparedDigest = ''
        try {
          checkSession()
          reportPhase('coordinator_prepare')
          await prepare()
          checkSession()
          const {retained,digest} = await prepareRollback(target,password)
          recorded = true
          preparedDigest = digest
          if(journalRollback){
            const record=await journal.inspect()
            checkSession()
            if(!record||record.committed||record.digest!==digest)throw new Error('RESTORE_ROLLBACK_RECORD_CHANGED')
          }
          if (commitStrategy === 'decision_then_apply') {
            // Native durable generation protocol (R01 / G-04):
            // 1) Persist irreversible DECISION(target) first (sole linearization point).
            // 2) Verify & publish the selected generation under DECISION state.
            // 3) Advance DECISION -> FINALIZED only after selected generation verification passes.
            // Pre-decision failure may abort to previous; post-decision failure NEVER reverses direction.
            reportPhase('committing')
            try {
              if (digest) await journal.commit(digest)
              else await journal.commit()
              decided = true
            } catch (commitError) {
              if (isDurabilityUnconfirmed(commitError)) throw commitError
              if (typeof journal.abortPrepared === 'function') {
                reportPhase('rolling_back')
                try {
                  await journal.abortPrepared(preparedDigest, password)
                  preDecisionAborted = true
                  state.blocked = false; state.message = ''
                  reportPhase('failed')
                } catch {
                  preDecisionAborted = true
                  reportPhase('rollback_failed')
                  const tagged = tagFailureStage(commitError, 'pre_commit')
                  Object.assign(tagged, { rollbackFailed: true })
                  throw tagged
                }
              }
              throw tagFailureStage(commitError, 'pre_commit')
            }
            reportPhase('applying')
            try {
              await apply(target)
            } catch (postDecisionError) {
              // Direction is irreversible once DECISION(target) is durable: keep barrier active, NEVER revert to previous.
              if (!isDurabilityUnconfirmed(postDecisionError)) {
                reportPhase('failed')
              }
              throw tagFailureStage(postDecisionError, 'post_decision')
            }
            try {
              await finish()
            } catch (finalizeError) {
              if (!isDurabilityUnconfirmed(finalizeError)) {
                reportPhase('failed')
              }
              throw tagFailureStage(finalizeError, 'post_decision')
            }
          } else {
            reportPhase('applying')
            try {
              await apply(target)
              checkSession()
            } catch (error) {
              if (isDurabilityUnconfirmed(error)) {
                // Post-rename durability could not be proven: keep barrier & journal intact for manual verification.
                throw error
              }
              reportPhase('rolling_back')
              try {
                await apply(retained?retained.previous:await readRollback(digest,password))
                await finish()
                reportPhase('failed')
              } catch {
                reportPhase('rollback_failed')
                if (error instanceof Error) Object.assign(error, { rollbackFailed: true })
                else throw Object.assign(new Error('RESTORE_ROLLBACK_FAILED'), { rollbackFailed: true })
              }
              throw tagFailureStage(error, 'pre_commit')
            }
            reportPhase('committing')
            if (digest) await journal.commit(digest)
            else await journal.commit()
            decided = true
            checkSession()
            await finish()
          }
        } catch (error) {
          if (!recorded) {
            if (commitStrategy === 'decision_then_apply' && typeof journal.abortPrepared === 'function') {
              try {
                const pending = await journal.inspect()
                if (pending && !pending.committed) {
                  await journal.abortPrepared('', password)
                }
              } catch { /* retain barrier if abort fails */ }
            }
            try { if (!await journal.inspect()) { state.blocked = false; state.message = '' } } catch { /* retain barrier */ }
            if (!isDurabilityUnconfirmed(error)) reportPhase('failed')
          } else if (
            commitStrategy === 'decision_then_apply' &&
            !decided &&
            !preDecisionAborted &&
            !isDurabilityUnconfirmed(error) &&
            typeof journal.abortPrepared === 'function'
          ) {
            reportPhase('rolling_back')
            try {
              await journal.abortPrepared(preparedDigest, password)
              state.blocked = false; state.message = ''
              reportPhase('failed')
            } catch {
              reportPhase('rollback_failed')
              const tagged = tagFailureStage(error, 'pre_commit')
              Object.assign(tagged, { rollbackFailed: true })
              throw tagged
            }
          }
          if (!decided && error && typeof error === 'object' && !('failureStage' in error)) {
            tagFailureStage(error, 'pre_commit')
          }
          throw error
        }
        await synchronizeSafely()
        reportPhase('succeeded')
      })
    },
    recover(/** @type {string} */ password) {
      return execute(async () => {
        checkSession()
        if (typeof journal.resolveRecovery === 'function') {
          // Native durable control recovery (R01.7): NEVER calls legacy openRestoreRecord()!
          reportPhase('coordinator_prepare')
          const plan = await journal.resolveRecovery(password)
          checkSession()
          if (plan?.alreadyFinalized) {
            state.blocked = false; state.message = ''
            await synchronizeSafely()
            reportPhase('succeeded')
            return
          }
          if (!plan || !plan.snapshot) {
            throw new Error('RESTORE_RECOVERY_PLAN_INVALID')
          }
          const selected = validateRecovery(plan.snapshot)
          reportPhase('applying')
          await apply(selected)
          checkSession()
          await finish()
          await synchronizeSafely()
          reportPhase('succeeded')
          return
        }
        const record = await journal.inspect()
        checkSession()
        if (!record) { await finish(); reportPhase('succeeded'); return }
        const snapshots = await openRestoreRecord(record.encrypted, password)
        checkSession()
        if (snapshots.version !== 1) throw new Error('UNSUPPORTED_RESTORE_RECORD')
        const target = validateRecovery(record.committed ? snapshots.target : snapshots.previous)
        reportPhase('coordinator_prepare')
        await prepare({ recovering: true })
        checkSession()
        reportPhase('applying')
        await apply(target)
        checkSession()
        await finish()
        await synchronizeSafely()
        reportPhase('succeeded')
      })
    },
    retrySynchronization: synchronizeSafely
  }
}
