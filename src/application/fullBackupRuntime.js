import { backupParticipants } from './backupParticipants.js'
import { nextTick } from 'vue'
import { useDebtStore } from '../stores/debt.js'
import { useWeightStore } from '../stores/weight.js'
import { useMoodStore } from '../features/mood/moodStore.js'
import { useScheduleStore } from '../features/schedule/scheduleStore.js'
import { useTodoStore } from '../features/todo/todoStore.js'
import { useKanataStore } from '../features/chat/kanataStore.js'
import { usePasswordVaultStore } from '../stores/passwordVault.js'
import { useSettingsStore } from '../stores/settings.js'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { restoreJournal } from '../platform/storage/restoreJournal.js'
import { createKanataBackupRuntime } from './kanataBackupRuntime.js'
import {
  buildKanataChatBackupSnapshot, readKanataChatBackupSnapshot, buildKanataFullBackupSnapshot,
  validateKanataRestoreSnapshot, kanataRestoreParts, prepareKanataBackupData
} from '../features/chat/backup/kanataBackup.js'
import { validateKanataData } from '../features/chat/domain/kanataValidation.js'
import { syncReminderNotifications } from '../services/notificationService.js'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule.js'
import { syncScheduleNotifications } from '../features/schedule/scheduleNotificationService.js'

/** Product composition root. Old full backups are filtered into a canonical nonchat operation,
 * while capture/rollback preserves the entire new Kanata graph. No legacy outbox is materialized.
 */
export function createFullBackupRuntime() {
  const debtStore = useDebtStore(), weightStore = useWeightStore(), moodStore = useMoodStore()
  const scheduleStore = useScheduleStore(), todoStore = useTodoStore(), chatStore = useKanataStore()
  const vaultStore = usePasswordVaultStore(), settingsStore = useSettingsStore(), protectedAccess = useProtectedAccessStore()

  const participants = backupParticipants({
    debtStore, weightStore, moodStore, scheduleStore, todoStore, chatStore, vaultStore, settingsStore
  }).map(participant => participant.id !== 'chat' ? participant : {
    id: 'chat',
    ready: () => chatStore.isDataLoaded && !chatStore.loadError && chatStore.snapshot !== null,
    initialize: () => chatStore.isDataLoaded,
    validate: part => { validateKanataData(part.data) },
    export: () => ({ data: validateKanataData(chatStore.snapshot) }),
    restore: part => chatStore.restoreSnapshot(part.data),
    flush: () => chatStore.flush(),
    singleExport: () => buildKanataChatBackupSnapshot(chatStore.snapshot),
    import: async (input, { overwrite }) => {
      // World graph merge needs an explicit collision/ID remapping design. Never silently append.
      if (overwrite !== true) throw new Error('KANATA_BACKUP_MERGE_NOT_SUPPORTED')
      const data = input?.type === 'kanata-chat-backup'
        ? readKanataChatBackupSnapshot(input).data : prepareKanataBackupData(input)
      return chatStore.restoreSnapshot(data)
    }
  })

  const prepare = async ({ recovering = false } = {}) => {
    await nextTick() // Unmount editors/cancel view-owned requests before durable capture.
    const ready = recovering ? await protectedAccess.prepareRecovery() : await protectedAccess.ensureModules()
    if (!ready) throw new Error('BACKUP_AUTHENTICATION_REQUIRED')
  }
  const synchronize = async () => {
    await syncReminderNotifications(settingsStore.notificationSettings, {
      personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
    })
    await todoStore.syncReminders()
    await syncScheduleNotifications(scheduleStore.snapshot)
  }
  const runtime = createKanataBackupRuntime({
    participants, journal: restoreJournal, state: restoreState, prepare, synchronize
  })

  // Compatibility read-only entry: caller must have prepared/flushed all participants.
  // Product UI should use await exportFull(), which enforces the complete save barrier.
  const createFullBackupSnapshot = () => buildKanataFullBackupSnapshot(runtime.registry.exportAll())
  // Retained as a controlled internal interface; ordinary UI must use runtime.restore().
  const applyFullBackupSnapshot = snapshot => {
    if (!restoreState.blocked || !restoreState.busy) throw new Error('RESTORE_COORDINATOR_REQUIRED')
    return runtime.registry.restoreAll(kanataRestoreParts(validateKanataRestoreSnapshot(snapshot)))
  }
  return { ...runtime, synchronize, createFullBackupSnapshot, applyFullBackupSnapshot }
}
