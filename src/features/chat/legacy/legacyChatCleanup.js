// @ts-check
import { Directory } from '@capacitor/filesystem'
import { CHAT_DATA_PATH, CHAT_TEMP_PATH, CHAT_BACKUP_PATH } from '../chatStorage.js'
import { STORAGE_KEYS } from '../../../platform/storage/keys.js'
import { CHAT_PROACTIVE_CHANNEL_ID, CHAT_PROACTIVE_NOTIFICATION_MIN, CHAT_PROACTIVE_NOTIFICATION_MAX } from '../chatProactive.js'
import { CHAT_FOLLOWUP_NOTIFICATION_MIN, CHAT_FOLLOWUP_NOTIFICATION_MAX } from '../chatFollowup.js'

export const LEGACY_CHAT_CLEANUP_KEY = 'my_kanata_legacy_cleanup_v1'
export const LEGACY_CHAT_FILES = Object.freeze([CHAT_DATA_PATH, CHAT_TEMP_PATH, CHAT_BACKUP_PATH])
export const LEGACY_CHAT_RECOVERY_KEY = STORAGE_KEYS.chatRecovery
export const LEGACY_CHAT_CLEANUP_WARNING = '旧温馨小家的聊天、记忆、关系、虚拟事件及待发消息将永久删除，无法撤销。其他ForMyself模块、主密码、AI配置及新彼方数据不会清理。应用外的旧备份文件需由你自行处理。'

/** @typedef {{ version: 1, phase: 'prepared'|'quiesced'|'files'|'preference'|'done', completedFiles: string[], notificationsCleared: boolean, recoveryKeyRemoved: boolean }} CleanupCheckpoint */
/** @typedef {{status: 'cancelled'}|{status: 'complete', checkpoint: CleanupCheckpoint}} CleanupResult */
/**
 * @typedef {object} LegacyCleanupOptions
 * @property {{stat(options:{path:string,directory:import('@capacitor/filesystem').Directory}):Promise<unknown>,deleteFile(options:{path:string,directory:import('@capacitor/filesystem').Directory}):Promise<unknown>}} filesystem
 * @property {{get(options:{key:string}):Promise<{value:string|null}>,set(options:{key:string,value:string}):Promise<unknown>,remove(options:{key:string}):Promise<unknown>}} preferences
 * @property {{getPending():Promise<{notifications:{id:number}[]}>,cancel(options:{notifications:{id:number}[]}):Promise<unknown>,listChannels():Promise<{channels:{id:string}[]}>,deleteChannel(options:{id:string}):Promise<unknown>}} notifications
 * @property {{runOperation(modules:string[], action:(password:string,sessionRevision:number)=>Promise<CleanupResult>):Promise<CleanupResult|false>}} protectedAccess
 * @property {{blocked:boolean,busy:boolean}} restoreState
 * @property {()=>Promise<unknown>} inspectRestoreJournal
 * @property {{stop:()=>Promise<unknown>,assertStopped:()=>boolean|Promise<boolean>}} legacyRuntime
 * @property {()=>number} getSessionRevision
 * @property {()=>boolean} isAuthenticated
 */
/** Stable structural error code, without private data or raw checkpoint values. */
export class LegacyChatCleanupError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.name = 'LegacyChatCleanupError'; this.code = code }
}
/** @param {unknown} condition @param {string} code */
const requireCleanup = (condition, code) => { if (!condition) throw new LegacyChatCleanupError(code) }
/** Only explicit platform missing-file states are safe to treat as absence. @param {unknown} value */
const missingFile = value => {
  const error = /** @type {{code?:unknown,message?:unknown}} */(value || {})
  if (error.code !== undefined) return error.code === 'ENOENT' || error.code === 'OS-PLUG-FILE-0008'
  return error.message === 'File does not exist.' || error.message === 'Entry does not exist.'
}
/** @param {number} id */
const legacyNotification = id => Number.isInteger(id) && (
  (id >= CHAT_PROACTIVE_NOTIFICATION_MIN && id < CHAT_PROACTIVE_NOTIFICATION_MAX) ||
  (id >= CHAT_FOLLOWUP_NOTIFICATION_MIN && id < CHAT_FOLLOWUP_NOTIFICATION_MAX)
)
/** Runtime wiring must stop legacy subscriptions, timers and in-flight persistence before returning stop().
 * No default real-device drivers: the application composition root must supply each protected adapter.
 * @param {LegacyCleanupOptions} options
 */
export function createLegacyChatCleanup({ filesystem, preferences, notifications, protectedAccess, restoreState, inspectRestoreJournal, legacyRuntime, getSessionRevision, isAuthenticated }) {
  let busy = false
  /** @param {string} path */
  const exists = async path => {
    try { await filesystem.stat({ path, directory: Directory.Data }); return true }
    catch (error) { if (missingFile(error)) return false; throw new LegacyChatCleanupError('LEGACY_FILE_READ_FAILED') }
  }
  /** @returns {Promise<CleanupCheckpoint|null>} */
  const readCheckpoint = async () => {
    const { value } = await preferences.get({ key: LEGACY_CHAT_CLEANUP_KEY })
    if (value === null) return null
    /** @type {CleanupCheckpoint} */
    let parsed
    try { parsed = JSON.parse(value) } catch { throw new LegacyChatCleanupError('LEGACY_CHECKPOINT_CORRUPTED') }
    requireCleanup(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'LEGACY_CHECKPOINT_CORRUPTED')
    requireCleanup(parsed.version === 1, 'UNSUPPORTED_LEGACY_CHECKPOINT')
    requireCleanup(['prepared', 'quiesced', 'files', 'preference', 'done'].includes(parsed.phase), 'LEGACY_CHECKPOINT_CORRUPTED')
    requireCleanup(Array.isArray(parsed.completedFiles) && parsed.completedFiles.every(path => LEGACY_CHAT_FILES.includes(path)) &&
      new Set(parsed.completedFiles).size === parsed.completedFiles.length &&
      typeof parsed.notificationsCleared === 'boolean' && typeof parsed.recoveryKeyRemoved === 'boolean', 'LEGACY_CHECKPOINT_CORRUPTED')
    requireCleanup(parsed.phase !== 'done' || (parsed.completedFiles.length === LEGACY_CHAT_FILES.length && parsed.notificationsCleared && parsed.recoveryKeyRemoved), 'LEGACY_CHECKPOINT_CORRUPTED')
    return { version: 1, phase: parsed.phase, completedFiles: [...parsed.completedFiles], notificationsCleared: parsed.notificationsCleared, recoveryKeyRemoved: parsed.recoveryKeyRemoved }
  }
  /** Write/read confirmation is required before the first irreversible step. @param {CleanupCheckpoint} checkpoint */
  const writeCheckpoint = async checkpoint => {
    const value = JSON.stringify(checkpoint)
    await preferences.set({ key: LEGACY_CHAT_CLEANUP_KEY, value })
    requireCleanup((await preferences.get({ key: LEGACY_CHAT_CLEANUP_KEY })).value === value, 'LEGACY_CHECKPOINT_WRITE_UNVERIFIED')
  }
  const assertRecoverySafe = async () => {
    requireCleanup(!restoreState.blocked && !restoreState.busy, 'LEGACY_CLEANUP_RESTORE_BLOCKED')
    requireCleanup(!await inspectRestoreJournal(), 'LEGACY_CLEANUP_RESTORE_PENDING')
    requireCleanup(!restoreState.blocked && !restoreState.busy, 'LEGACY_CLEANUP_RESTORE_BLOCKED')
  }
  /** @param {number} revision */
  const assertSession = revision => requireCleanup(isAuthenticated() && revision === getSessionRevision(), 'LEGACY_CLEANUP_SESSION_EXPIRED')
  /** @param {number} revision */
  const assertQuiesced = async revision => {
    assertSession(revision); await assertRecoverySafe()
    requireCleanup(await legacyRuntime.assertStopped() === true, 'LEGACY_RUNTIME_NOT_STOPPED')
    assertSession(revision)
  }
  const cancelLegacyNotifications = async () => {
    const pending = await notifications.getPending()
    requireCleanup(pending && Array.isArray(pending.notifications) && pending.notifications.every(n => n && Number.isInteger(n.id)), 'LEGACY_NOTIFICATION_STATE_INVALID')
    const legacy = pending.notifications.filter(n => legacyNotification(n.id)).map(n => ({ id: n.id }))
    if (legacy.length) await notifications.cancel({ notifications: legacy })
    const after = await notifications.getPending()
    requireCleanup(after && Array.isArray(after.notifications) && after.notifications.every(n => n && Number.isInteger(n.id)) &&
      !after.notifications.some(n => legacyNotification(n.id)), 'LEGACY_NOTIFICATION_CANCEL_UNVERIFIED')
    const channels = await notifications.listChannels()
    requireCleanup(channels && Array.isArray(channels.channels) && channels.channels.every(c => c && typeof c.id === 'string'), 'LEGACY_NOTIFICATION_STATE_INVALID')
    if (channels.channels.some(c => c.id === CHAT_PROACTIVE_CHANNEL_ID)) {
      await notifications.deleteChannel({ id: CHAT_PROACTIVE_CHANNEL_ID })
      const remaining = await notifications.listChannels()
      requireCleanup(remaining && Array.isArray(remaining.channels) && !remaining.channels.some(c => c.id === CHAT_PROACTIVE_CHANNEL_ID), 'LEGACY_CHANNEL_DELETE_UNVERIFIED')
    }
  }
  /** Callback is invoked fresh for every attempt/resume, inside the current protected session.
   * It is not a durable authorization token and a persisted checkpoint never substitutes for consent.
   * @param {{confirm:(preview:Readonly<{warning:string,files:readonly string[],recoveryKey:string,previousPhase:string|null}>)=>boolean|Promise<boolean>}} request
   * @returns {Promise<CleanupResult|false>}
   */
  const run = async request => {
    requireCleanup(request && typeof request.confirm === 'function', 'LEGACY_CONFIRMATION_REQUIRED')
    requireCleanup(!busy, 'LEGACY_CLEANUP_BUSY')
    busy = true
    try {
      await assertRecoverySafe()
      return await protectedAccess.runOperation([], async (_password, revision) => {
        assertSession(revision); await assertRecoverySafe()
        let checkpoint = await readCheckpoint()
        const requestConfirmation = request.confirm
        const confirmed = await requestConfirmation(Object.freeze({
          warning: LEGACY_CHAT_CLEANUP_WARNING, files: LEGACY_CHAT_FILES,
          recoveryKey: LEGACY_CHAT_RECOVERY_KEY, previousPhase: checkpoint?.phase || null
        }))
        // Only literal true grants this attempt, and it is consumed by this invocation.
        if (confirmed !== true) return { status: 'cancelled' }
        assertSession(revision); await assertRecoverySafe()
        checkpoint ||= { version: 1, phase: 'prepared', completedFiles: [], notificationsCleared: false, recoveryKeyRemoved: false }
        await writeCheckpoint(checkpoint)
        await legacyRuntime.stop()
        await assertQuiesced(revision)
        await cancelLegacyNotifications()
        await assertQuiesced(revision)
        // Preflight all reads before any file/key deletion. Errors are never treated as absence.
        for (const path of LEGACY_CHAT_FILES) await exists(path)
        await preferences.get({ key: LEGACY_CHAT_RECOVERY_KEY })
        checkpoint = { ...checkpoint, phase: 'quiesced', notificationsCleared: true }
        await writeCheckpoint(checkpoint)
        for (const path of LEGACY_CHAT_FILES) {
          await assertQuiesced(revision)
          if (await exists(path)) {
            try { await filesystem.deleteFile({ path, directory: Directory.Data }) }
            catch (error) {
              if (!missingFile(error)) throw new LegacyChatCleanupError('LEGACY_FILE_DELETE_FAILED')
            }
          }
          requireCleanup(!await exists(path), 'LEGACY_FILE_DELETE_UNVERIFIED')
          checkpoint = { ...checkpoint, phase: 'files', completedFiles: [...new Set([...checkpoint.completedFiles, path])] }
          await writeCheckpoint(checkpoint)
        }
        await assertQuiesced(revision)
        if ((await preferences.get({ key: LEGACY_CHAT_RECOVERY_KEY })).value !== null) await preferences.remove({ key: LEGACY_CHAT_RECOVERY_KEY })
        requireCleanup((await preferences.get({ key: LEGACY_CHAT_RECOVERY_KEY })).value === null, 'LEGACY_RECOVERY_KEY_DELETE_UNVERIFIED')
        checkpoint = { ...checkpoint, phase: 'preference', recoveryKeyRemoved: true }
        await writeCheckpoint(checkpoint)
        await assertQuiesced(revision)
        for (const path of LEGACY_CHAT_FILES) requireCleanup(!await exists(path), 'LEGACY_FILE_REAPPEARED')
        requireCleanup((await preferences.get({ key: LEGACY_CHAT_RECOVERY_KEY })).value === null, 'LEGACY_RECOVERY_KEY_REAPPEARED')
        checkpoint = { ...checkpoint, phase: 'done' }
        await writeCheckpoint(checkpoint)
        return { status: 'complete', checkpoint }
      })
    } finally { busy = false }
  }
  return {
    run,
    async probe() {
      const checkpoint = await readCheckpoint()
      let hasLegacy = false
      for (const path of LEGACY_CHAT_FILES) if (await exists(path)) hasLegacy = true
      if ((await preferences.get({ key: LEGACY_CHAT_RECOVERY_KEY })).value !== null) hasLegacy = true
      return { pending: Boolean(checkpoint && checkpoint.phase !== 'done'), checkpoint, hasLegacy }
    },
    get busy() { return busy }
  }
}
