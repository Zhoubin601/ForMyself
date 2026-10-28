// @ts-check
import { createBackupRegistry } from './backupRegistry.js'
import { createRestoreCoordinator } from './restoreCoordinator.js'
import { validateKanataData } from '../features/chat/domain/kanataValidation.js'
import {
  buildKanataFullBackupSnapshot, captureKanataRestoreSnapshot, prepareKanataFullRestore,
  validateKanataRestoreSnapshot, kanataRestoreParts
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
    validate(part) { validateKanataData(part.data); p.validate?.(part) }
  })
  const registry = createBackupRegistry(adapted)
  const capture = () => captureKanataRestoreSnapshot(registry.exportAll())
  const apply = input => registry.restoreAll(kanataRestoreParts(input))
  const coordinator = createRestoreCoordinator({
    journal, state, prepare: async options => {
      await prepare(options)
      await registry.initialize()
      await registry.flush()
    },
    capture, apply, validate: validateKanataRestoreSnapshot,
    validateRecovery: input => {
      const value = /** @type {{type?:unknown,version?:unknown}} */(input)
      return value?.type === 'formyself-full-backup' && Number.isInteger(value.version) && Number(value.version) <= 12
        ? prepareKanataFullRestore(input, { legacyChat: 'discard' })
        : validateKanataRestoreSnapshot(input)
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
      return buildKanataFullBackupSnapshot(registry.exportAll())
    },
    restore(input, password, options = {}) {
      // Parses and validates every graph before the coordinator can block or write any storage.
      const target = prepareKanataFullRestore(input, options)
      return coordinator.restore(target, password)
    }
  }
}
