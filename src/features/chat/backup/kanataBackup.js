// @ts-check
import { buildFullBackupFromParts, fullBackupParts, normalizeFullBackupSnapshot, FULL_BACKUP_TYPE } from '../../../services/fullBackup.js'
import { cloneKanataJson, validateKanataData, assertKanataData } from '../domain/kanataValidation.js'
import { assertKanataJson } from '../domain/kanataJson.js'

/** @typedef {import('../domain/kanataTypes').KanataData} KanataData */
/** @typedef {import('../../../application/contracts').BackupPart} BackupPart */
/** @typedef {import('../../../application/contracts').FullBackupDTO} FullBackupDTO */
/** @typedef {{type: 'kanata-chat-backup', version: 1, createdAt: string, taskPolicy: 'pause-sending-v1', data: KanataData}} KanataChatBackup */
/** @typedef {Omit<FullBackupDTO, 'version' | 'data'> & {version: 13, taskPolicy: 'pause-sending-v1', data: Omit<FullBackupDTO['data'], 'chat'> & {chat: KanataData}}} KanataFullBackup */
/** @typedef {{type: 'kanata-restore-snapshot', version: 1, mode: 'replace' | 'preserve', backup: FullBackupDTO, kanata: KanataData | null}} KanataRestoreSnapshot */

export const KANATA_CHAT_BACKUP_TYPE = 'kanata-chat-backup'
export const KANATA_CHAT_BACKUP_VERSION = 1
export const KANATA_FULL_BACKUP_VERSION = 13
const RESTORE_TYPE = 'kanata-restore-snapshot'
const TASK_POLICY = 'pause-sending-v1'

/** Stable errors never include private input or provider messages.
 * @param {unknown} condition @param {string} code
 */
const requireValue = (condition, code) => { if (!condition) throw new Error(code) }
/** @param {unknown} input @param {string} code @returns {Record<string, any>} */
const record = (input, code) => {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), code)
  return /** @type {Record<string, any>} */(input)
}
/** @param {unknown} value @returns {string} */
const date = value => {
  requireValue(typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)), 'INVALID_KANATA_BACKUP_DATE')
  return /** @type {string} */(value)
}
/** @param {unknown} input @returns {KanataData} */
const portableKanataData = input => {
  const data = validateKanataData(input)
  requireValue(!(data.messageArchives?.length), 'KANATA_ARCHIVE_BACKUP_NOT_HYDRATED')
  return data
}
/** Only for descendants of a private clone created inside this adapter.
 * @param {unknown} input @returns {KanataData} */
const ownedPortableData = input => {
  const data=assertKanataData(input)
  requireValue(!(data.messageArchives?.length), 'KANATA_ARCHIVE_BACKUP_NOT_HYDRATED')
  return data
}
/** Export/import policy is intentionally separate from internal rollback snapshots.
 * Pending/running/failed sending tasks are retained for audit as cancelled, never silently resent.
 * Other interrupted tasks become pending with their lease cleared; their owning runtime must recheck permissions.
 * @param {unknown} input @returns {KanataData}
 */
export function prepareKanataBackupData(input) {
  const data = portableKanataData(input)
  return pauseOwnedSending(data)
}
/** @param {KanataData} data @returns {KanataData} */
function pauseOwnedSending(data) {
  data.tasks = data.tasks.map(task => ({
    ...task,
    leaseUntil: 0,
    state: ['reply', 'proactive', 'followup'].includes(task.kind) && ['pending', 'running', 'failed'].includes(task.state)
      ? 'cancelled' : task.state === 'running' ? 'pending' : task.state
  }))
  return assertKanataData(data)
}

/** @param {unknown} input @param {string} [createdAt] @returns {KanataChatBackup} */
export function buildKanataChatBackupSnapshot(input, createdAt = new Date().toISOString()) {
  return { type: KANATA_CHAT_BACKUP_TYPE, version: 1, createdAt: date(createdAt), taskPolicy: TASK_POLICY, data: prepareKanataBackupData(input) }
}
/** @param {unknown} input @returns {KanataChatBackup} */
export function readKanataChatBackupSnapshot(input) {
  const value = record(cloneKanataJson(input), 'INVALID_KANATA_CHAT_BACKUP')
  requireValue(value.type !== 'formyself-chat-backup', 'LEGACY_CHAT_BACKUP_UNSUPPORTED')
  requireValue(value.type === KANATA_CHAT_BACKUP_TYPE, 'INVALID_KANATA_CHAT_BACKUP_TYPE')
  requireValue(value.version === KANATA_CHAT_BACKUP_VERSION, 'UNSUPPORTED_KANATA_CHAT_BACKUP_VERSION')
  if (value.taskPolicy !== undefined) requireValue(value.taskPolicy === TASK_POLICY, 'UNSUPPORTED_KANATA_TASK_POLICY')
  return {type:KANATA_CHAT_BACKUP_TYPE,version:1,createdAt:date(value.createdAt),taskPolicy:TASK_POLICY,data:pauseOwnedSending(ownedPortableData(value.data))}
}

/** Remove legacy chat before calling the legacy normalizer. It never sees Kanata data or legacy content.
 * @param {unknown} input @returns {FullBackupDTO}
 */
function legacyShell(input) {
  const value = record(cloneKanataJson(input), 'INVALID_FULL_BACKUP')
  requireValue(value.type === FULL_BACKUP_TYPE, 'INVALID_FULL_BACKUP_TYPE')
  requireValue(Number.isInteger(value.version) && value.version >= 1 && value.version <= 12, 'UNSUPPORTED_FULL_BACKUP_VERSION')
  const data = record(value.data, 'INVALID_FULL_BACKUP_DATA')
  const shell = normalizeFullBackupSnapshot({ ...value, data: { ...data, chat: {} } })
  // Empty sentinel is not a v4 default character and is never restored as chat.
  shell.data.chat = {}
  return shell
}

/** @param {Record<string, BackupPart>} input @param {string} [createdAt] */
function shellFromParts(input, createdAt) {
  const parts = record(cloneKanataJson(input), 'INVALID_BACKUP_PARTS')
  return shellFromOwnedParts(parts,createdAt)
}
/** Only freshly detached parts from the actual registry's export contract.
 * @param {Record<string, BackupPart>} parts @param {string} [createdAt] */
function shellFromOwnedParts(parts,createdAt) {
  assertKanataJson(parts)
  const known = ['savings', 'weight', 'mood', 'passwords', 'schedules', 'todos', 'chat', 'settings']
  requireValue(Object.keys(parts).every(key => known.includes(key)), 'UNSUPPORTED_BACKUP_FORMAT_PART')
  for (const key of known) {
    if (key === 'todos' && !Object.hasOwn(parts, key)) continue
    requireValue(Object.hasOwn(parts, key), 'MISSING_BACKUP_PARTICIPANT:' + key)
    record(parts[key], 'INVALID_BACKUP_PART:' + key)
    requireValue(Object.hasOwn(parts[key], 'data'), 'MISSING_BACKUP_DATA:' + key)
  }
  const kanata = ownedPortableData(parts.chat.data)
  const backup = buildFullBackupFromParts({ ...parts, chat: { data: {} } })
  const shell = legacyShell({ ...backup, createdAt: date(createdAt ?? backup.createdAt) })
  return { shell, kanata }
}

/** Export the new wire format. Do not use it to capture a rollback image: use captureKanataRestoreSnapshot.
 * @param {Record<string, BackupPart>} parts @param {string} [createdAt] @returns {KanataFullBackup}
 */
export function buildKanataFullBackupSnapshot(parts, createdAt) {
  const { shell, kanata } = shellFromParts(parts, createdAt)
  return { ...shell, version: 13, taskPolicy: TASK_POLICY, data: { ...shell.data, chat: pauseOwnedSending(kanata) } }
}

/** Internal capture preserves all new entities, including task state/leases, for exact compensation.
 * @param {Record<string, BackupPart>} parts @param {string} [createdAt] @returns {KanataRestoreSnapshot}
 */
export function captureKanataRestoreSnapshot(parts, createdAt) {
  const { shell, kanata } = shellFromParts(parts, createdAt)
  return { type: RESTORE_TYPE, version: 1, mode: 'replace', backup: shell, kanata }
}

/** Internal composition capability: its producer must return fresh detached registry exports.
 * No wire/import input or caller-provided trust flag is accepted by the returned methods.
 * Public builders above still detach arbitrary inputs. Both paths perform all graph validation.
 * @param {() => Record<string, BackupPart>} exportParts
 */
export function createKanataBackupImageAdapter(exportParts) {
  return {
    /** @returns {KanataFullBackup} */
    exportFull() {
      const {shell,kanata}=shellFromOwnedParts(exportParts())
      return {...shell,version:13,taskPolicy:TASK_POLICY,data:{...shell.data,chat:pauseOwnedSending(kanata)}}
    },
    /** @returns {KanataRestoreSnapshot} */
    capture() {
      const {shell,kanata}=shellFromOwnedParts(exportParts())
      return {type:RESTORE_TYPE,version:1,mode:'replace',backup:shell,kanata}
    }
  }
}

/** Parse imported wire data into the actual coordinator's canonical operation.
 * Older backups require explicit discard acknowledgement even if they predate the chat field.
 * @param {unknown} input @param {{legacyChat?: 'discard'}} [options] @returns {KanataRestoreSnapshot}
 */
export function prepareKanataFullRestore(input, { legacyChat } = {}) {
  const value = record(cloneKanataJson(input), 'INVALID_FULL_BACKUP')
  requireValue(value.type === FULL_BACKUP_TYPE, 'INVALID_FULL_BACKUP_TYPE')
  if (value.version === KANATA_FULL_BACKUP_VERSION) {
    if (value.taskPolicy !== undefined) requireValue(value.taskPolicy === TASK_POLICY, 'UNSUPPORTED_KANATA_TASK_POLICY')
    const data = record(value.data, 'INVALID_FULL_BACKUP_DATA')
    const kanata = pauseOwnedSending(ownedPortableData(data.chat))
    const shell = legacyShell({ ...value, version: 12, data: { ...data, chat: {} } })
    return { type: RESTORE_TYPE, version: 1, mode: 'replace', backup: shell, kanata }
  }
  requireValue(Number.isInteger(value.version) && value.version >= 1 && value.version <= 12, 'UNSUPPORTED_FULL_BACKUP_VERSION')
  requireValue(legacyChat === 'discard', 'LEGACY_CHAT_DISCARD_CONFIRMATION_REQUIRED')
  return { type: RESTORE_TYPE, version: 1, mode: 'preserve', backup: legacyShell(value), kanata: null }
}

/** Validate already-canonical journal data. No export policy is applied during compensation/recovery.
 * @param {unknown} input @returns {KanataRestoreSnapshot}
 */
export function validateKanataRestoreSnapshot(input) {
  const value = record(cloneKanataJson(input), 'INVALID_KANATA_RESTORE_SNAPSHOT')
  requireValue(value.type === RESTORE_TYPE && value.version === 1, 'UNSUPPORTED_KANATA_RESTORE_SNAPSHOT')
  requireValue(value.mode === 'replace' || value.mode === 'preserve', 'INVALID_KANATA_RESTORE_MODE')
  const backup = record(value.backup, 'INVALID_FULL_BACKUP')
  requireValue(backup.version === 12, 'INVALID_CANONICAL_BACKUP_VERSION')
  const backupData = record(backup.data, 'INVALID_FULL_BACKUP_DATA')
  const chat = record(backupData.chat, 'INVALID_CANONICAL_CHAT_SENTINEL')
  requireValue(Object.keys(chat).length === 0, 'RESTORE_SNAPSHOT_CONTAINS_LEGACY_CHAT')
  requireValue(value.mode !== 'preserve' || value.kanata === null, 'INVALID_PRESERVE_KANATA_DATA')
  return {
    type: RESTORE_TYPE, version: 1, mode: value.mode,
    backup: legacyShell(backup),
    kanata: value.mode === 'replace' ? ownedPortableData(value.kanata) : null
  }
}

/** Uniform parts used by the product registry: preserve deliberately omits chat, replace supplies only new data.
 * Registry policy must allow chat omission for a preserve operation; it must not substitute empty chat.
 * @param {unknown} input @returns {Record<string, BackupPart>}
 */
export function kanataRestoreParts(input) {
  const snapshot = validateKanataRestoreSnapshot(input)
  /** @type {Record<string, BackupPart>} */
  const parts = fullBackupParts(snapshot.backup)
  delete parts.chat
  if (snapshot.mode === 'replace') parts.chat = { data: snapshot.kanata }
  return parts
}

/** Preview only structural counts; never return legacy chat content.
 * @param {unknown} input
 */
export function describeLegacyChatDiscard(input) {
  const value = record(cloneKanataJson(input), 'INVALID_FULL_BACKUP')
  requireValue(value.type === FULL_BACKUP_TYPE && Number.isInteger(value.version) && value.version >= 1 && value.version <= 12, 'UNSUPPORTED_FULL_BACKUP_VERSION')
  const data = record(value.data, 'INVALID_FULL_BACKUP_DATA')
  const chat = data.chat && typeof data.chat === 'object' && !Array.isArray(data.chat) ? data.chat : {}
  return {
    present: Object.hasOwn(data, 'chat'),
    messages: Array.isArray(chat.messages) ? chat.messages.length : 0,
    memories: Array.isArray(chat.memories) ? chat.memories.length : 0
  }
}
