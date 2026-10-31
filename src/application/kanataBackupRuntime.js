// @ts-check
import { createBackupRegistry } from './backupRegistry.js'
import { createRestoreCoordinator } from './restoreCoordinator.js'
import { assertKanataData } from '../features/chat/domain/kanataValidation.js'
import { fullBackupParts } from '../services/fullBackup.js'
import {ownKanataRestoreImage} from '../features/chat/domain/kanataOwnedImage.js'
import {
  createKanataBackupImageAdapter, prepareKanataFullRestore, validateKanataRestoreSnapshot
} from '../features/chat/backup/kanataBackup.js'

/**
 * Reuses the product coordinator and encrypted-journal protocol. It is not another transaction engine.
 * The application must inject its real loaded stores and protected-session prepare adapter.
 * @param {{
 * participants: import('./contracts').BackupParticipant[],
 * journal: import('./contracts').RestoreJournal<import('../features/chat/backup/kanataBackup').KanataRestoreSnapshot>,
 * state: import('./contracts').RestoreState,
 * prepare(options?: {recovering?: boolean}): Promise<unknown>,
 * synchronize?(): Promise<unknown>
 * }} options
 */
export function createKanataBackupRuntime({ participants, journal, state, prepare, synchronize }) {
  if (!participants.some(p => p.id === 'chat')) throw new Error('KANATA_BACKUP_PARTICIPANT_REQUIRED')
  const adapted = participants.map(p => p.id !== 'chat' ? p : {
    ...p,
    // Legacy nonchat restore deliberately omits chat. New full import validates its presence.
    optional: true,
    validate(part) { assertKanataData(part.data); p.validate?.(part) }
  })
  const registry = createBackupRegistry(adapted)
  const images = createKanataBackupImageAdapter(() => registry.exportAll())
  // Only detached, fully validated factory outputs can enter this private identity set.
  // Freeze their descendants before any asynchronous prepare/journal work: a participant or
  // caller cannot change a checked target while the coordinator holds its operation lease.
  // Unknown/recovered objects still pass the complete canonical parser and graph validator.
  /** @typedef {import('../features/chat/backup/kanataBackup').KanataRestoreSnapshot} Snapshot */
  /** @type {WeakSet<object>} */
  const owned = new WeakSet()
  /** @param {Snapshot} value @returns {Snapshot} */
  const own = value => {
    /** @param {unknown} object */
    const freeze = object => {
      if (!object || typeof object !== 'object' || Object.isFrozen(object)) return
      for (const child of Object.values(object)) freeze(child)
      Object.freeze(object)
    }
    freeze(value)
    if(value.kanata)ownKanataRestoreImage(value.kanata)
    owned.add(value)
    return value
  }
  /** @param {unknown} input @returns {Snapshot} */
  const validate = input => input && typeof input==='object' && owned.has(input)
    ? /** @type {Snapshot} */(input) : own(validateKanataRestoreSnapshot(input))
  const capture = () => own(images.capture())
  /** @param {Snapshot} input */
  const apply = input => {
    if (!owned.has(input)) throw new Error('KANATA_CANONICAL_SNAPSHOT_REQUIRED')
    const parts = fullBackupParts(input.backup)
    delete parts.chat
    if (input.mode === 'replace') parts.chat = { data: input.kanata }
    return registry.restoreAll(parts)
  }
  const coordinator = createRestoreCoordinator({
    journal, state, journalRollback:true, prepare: async options => {
      await prepare(options)
      await registry.initialize()
      await registry.flush()
      await registry.prepareExports()
    },
    capture, apply, validate,
    validateRecovery: input => {
      const value = /** @type {{type?:unknown,version?:unknown}} */(input)
      return value?.type === 'formyself-full-backup' && Number.isInteger(value.version) && Number(value.version) <= 12
        ? own(prepareKanataFullRestore(input, { legacyChat: 'discard' }))
        : validate(input)
    },
    synchronize
  })
  return {
    registry,
    probe: coordinator.probe,
    recover: coordinator.recover,
    retrySynchronization: coordinator.retrySynchronization,
    async exportFull() {
      if (state.blocked || state.busy) throw new Error('RESTORE_RECOVERY_REQUIRED')
      await prepare()
      await registry.initialize()
      await registry.flush()
      await registry.prepareExports()
      return images.exportFull()
    },
    restore(input, password, options = {}) {
      // Parses and validates every graph before the coordinator can block or write any storage.
      const target = own(prepareKanataFullRestore(input, options))
      return coordinator.restore(target, password)
    }
  }
}
