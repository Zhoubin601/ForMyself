// @ts-check
import { openRestoreRecord } from '../platform/storage/restoreJournal.js'

// Runtime adapters are the same participants used by the product, not a second transaction implementation.
/** @template Snapshot @param {import('./contracts').RestoreCoordinatorOptions<Snapshot>} options */
export function createRestoreCoordinator({ journal, state, prepare, capture, apply, validate, synchronize = async () => {} }) {
  const block = (/** @type {string} */ message) => { state.blocked = true; state.message = message }
  const synchronizeSafely = async () => {
    try { await synchronize(); state.syncError = '' }
    catch { state.syncError = '数据已恢复，提醒或桌面组件同步失败，请重试同步' }
  }
  const finish = async () => {
    await journal.clear()
    state.blocked = false; state.message = ''
  }
  const execute = async (/** @type {() => Promise<unknown>} */ action) => {
    if (state.busy) throw new Error('RESTORE_BUSY')
    state.busy = true; block('正在安全恢复数据，请稍候…')
    try { return await action() }
    catch (error) { if (state.blocked) block('恢复尚未完成，原恢复材料已保留，请验证身份后重试；请勿卸载应用。'); throw error }
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
        try {
          await prepare()
          const previous = validate(capture())
          await journal.prepare({ version: 1, previous, target }, password)
          recorded = true
          try { await apply(target) }
          catch (error) {
            try { await apply(previous); await finish() }
            catch {
              if (error instanceof Error) Object.assign(error, { rollbackFailed: true })
              else throw Object.assign(new Error('RESTORE_ROLLBACK_FAILED'), { rollbackFailed: true })
            }
            throw error
          }
          await journal.commit()
          await finish()
        } catch (error) {
          if (!recorded) {
            try { if (!await journal.inspect()) { state.blocked = false; state.message = '' } } catch { /* retain barrier */ }
          }
          throw error
        }
        await synchronizeSafely()
      })
    },
    recover(/** @type {string} */ password) {
      return execute(async () => {
        const record = await journal.inspect()
        if (!record) { await finish(); return }
        const snapshots = await openRestoreRecord(record.encrypted, password)
        if (snapshots.version !== 1) throw new Error('UNSUPPORTED_RESTORE_RECORD')
        const target = validate(record.committed ? snapshots.target : snapshots.previous)
        await prepare({ recovering: true })
        await apply(target)
        await finish()
        await synchronizeSafely()
      })
    },
    retrySynchronization: synchronizeSafely
  }
}
