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
import { preferenceStorage } from '../platform/storage/preferences.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { restoreJournal } from '../platform/storage/restoreJournal.js'
import { createRestoreCoordinator } from './restoreCoordinator.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../services/fullBackup.js'
import { syncReminderNotifications } from '../services/notificationService.js'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule.js'
import { syncScheduleNotifications } from '../features/schedule/scheduleNotificationService.js'
import { syncChatProactiveNotifications } from '../features/chat/chatProactive.js'
import { syncChatFollowupNotifications } from '../features/chat/chatFollowup.js'

export function createFullBackupRuntime() {
  const debtStore = useDebtStore(), weightStore = useWeightStore(), moodStore = useMoodStore()
  const scheduleStore = useScheduleStore(), todoStore = useTodoStore(), chatStore = useChatStore()
  const vaultStore = usePasswordVaultStore(), settingsStore = useSettingsStore(), protectedAccess = useProtectedAccessStore()
  const createFullBackupSnapshot = () => buildFullBackupSnapshot({
    savings: debtStore.savedDebts,
    savingsMetadata: { groups: debtStore.debtGroups },
    weight: weightStore.weightRecords,
    mood: moodStore.moodRecords,
    passwords: vaultStore.records,
    schedules: scheduleStore.snapshot,
    todos: todoStore.snapshot,
    chat: chatStore.snapshot,
    moodMetadata: {
      trackingStartDate: moodStore.trackingStartDate,
      customTags: moodStore.customTags,
      builtInTags: moodStore.builtInTags,
      defaultTags: moodStore.defaultTags,
      definitions: moodStore.moodDefinitions
    },
    vaultMetadata: {
      categories: vaultStore.categories
    },
    settings: settingsStore.getBackupSnapshot()
  })

  const applyFullBackupSnapshot = async (snapshot) => {
    const results = await Promise.allSettled([
      debtStore.restoreDebts(snapshot.data.savings, snapshot.metadata.savings.groups),
      weightStore.restoreWeightRecords(snapshot.data.weight),
      moodStore.restoreMoodBackup(snapshot.data.mood, snapshot.metadata.mood),
      vaultStore.restoreRecords(snapshot.data.passwords, snapshot.metadata.vault),
      scheduleStore.restoreScheduleData(snapshot.data.schedules),
      ...(Object.hasOwn(snapshot.data, 'todos') ? [todoStore.restore(snapshot.data.todos)] : []),
      chatStore.restoreChatData(snapshot.data.chat),
      settingsStore.restoreBackupSnapshot(snapshot.settings)
    ])
    const settledWrites = await Promise.allSettled([
      ...[debtStore, weightStore, moodStore, scheduleStore].map(store => store.flush()),
      chatStore.flush(), settingsStore.flushPendingSettingsWrites(), preferenceStorage.flush()
    ])
    const failure = [...results, ...settledWrites].find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  const prepare = async ({ recovering = false } = {}) => {
    await nextTick() // Unmount editors and cancel view-owned requests before snapshotting.
    if (!settingsStore.isDataLoaded) await settingsStore.loadSettings()
    await Promise.all([
      debtStore.isDataLoaded || debtStore.loadDebts(), weightStore.isDataLoaded || weightStore.loadWeightRecords(),
      moodStore.isDataLoaded || moodStore.loadMoodRecords(), scheduleStore.isDataLoaded || scheduleStore.loadSchedules(),
      todoStore.load()
    ])
    if ([debtStore, weightStore, moodStore, scheduleStore, todoStore].some(store => !store.isDataLoaded)) throw new Error('BACKUP_DATA_NOT_LOADED')
    const ready = recovering ? await protectedAccess.prepareRecovery() : await protectedAccess.ensureModules()
    if (!ready) throw new Error('BACKUP_AUTHENTICATION_REQUIRED')
    await Promise.all([debtStore.flush(), weightStore.flush(), moodStore.flush(), scheduleStore.flush(),
      todoStore.flush(), chatStore.flush(), settingsStore.flushPendingSettingsWrites(), preferenceStorage.flush()])
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
  return { ...coordinator, createFullBackupSnapshot, applyFullBackupSnapshot }
}
