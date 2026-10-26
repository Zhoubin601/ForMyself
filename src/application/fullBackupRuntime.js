import { backupParticipants } from './backupParticipants.js'
import { createBackupRegistry } from './backupRegistry.js'
import { nextTick } from 'vue'
import { useDebtStore } from '../stores/debt.js'
import { useWeightStore } from '../stores/weight.js'
import { useMoodStore } from '../features/mood/moodStore.js'
import { useScheduleStore } from '../features/schedule/scheduleStore.js'
import { useTodoStore } from '../features/todo/todoStore.js'
import { useChatStore } from '../features/chat/chatStore.js'
import { usePasswordVaultStore } from '../stores/passwordVault.js'
import { useSettingsStore } from '../stores/settings.js'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { restoreJournal } from '../platform/storage/restoreJournal.js'
import { createRestoreCoordinator } from './restoreCoordinator.js'
import { buildFullBackupFromParts, fullBackupParts, normalizeFullBackupSnapshot } from '../services/fullBackup.js'
import { syncReminderNotifications } from '../services/notificationService.js'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule.js'
import { syncScheduleNotifications } from '../features/schedule/scheduleNotificationService.js'
import { syncChatProactiveNotifications } from '../features/chat/chatProactive.js'
import { syncChatFollowupNotifications } from '../features/chat/chatFollowup.js'

export function createFullBackupRuntime() {
  const debtStore = useDebtStore(), weightStore = useWeightStore(), moodStore = useMoodStore()
  const scheduleStore = useScheduleStore(), todoStore = useTodoStore(), chatStore = useChatStore()
  const vaultStore = usePasswordVaultStore(), settingsStore = useSettingsStore(), protectedAccess = useProtectedAccessStore()
  const registry = createBackupRegistry(backupParticipants({ debtStore, weightStore, moodStore, scheduleStore, todoStore, chatStore, vaultStore, settingsStore }))
  const createFullBackupSnapshot = () => buildFullBackupFromParts(registry.exportAll())
  const applyFullBackupSnapshot = snapshot => registry.restoreAll(fullBackupParts(snapshot))

  const prepare = async ({ recovering = false } = {}) => {
    await nextTick() // Unmount editors and cancel view-owned requests before snapshotting.
    const ready = recovering ? await protectedAccess.prepareRecovery() : await protectedAccess.ensureModules()
    if (!ready) throw new Error('BACKUP_AUTHENTICATION_REQUIRED')
    await registry.initialize()
    await registry.flush()
  }
  const synchronize = async () => {
      await syncReminderNotifications(settingsStore.notificationSettings, {
        personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
      })
      await todoStore.syncReminders()
      await syncScheduleNotifications(scheduleStore.snapshot)
      chatStore.materializeDueProactive(Date.now())
      chatStore.materializeDueFollowups(Date.now())
      await syncChatProactiveNotifications(
        chatStore.proactiveOutbox,
        chatStore.proactiveSettings,
        { isFeatureEnabled: () => settingsStore.warmHomeEnabled, requestPermission: false, now: new Date() }
      )
      await syncChatFollowupNotifications(
        chatStore.followupOutbox,
        chatStore.realismSettings,
        { isFeatureEnabled: () => settingsStore.warmHomeEnabled, requestPermission: false, now: new Date() }
      )
  }
  const coordinator = createRestoreCoordinator({ journal: restoreJournal, state: restoreState, prepare, capture: createFullBackupSnapshot, apply: applyFullBackupSnapshot, validate: normalizeFullBackupSnapshot, synchronize })
  return { ...coordinator, registry, synchronize, createFullBackupSnapshot, applyFullBackupSnapshot }
}
