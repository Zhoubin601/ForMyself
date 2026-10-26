import { syncScheduleNotifications } from '../features/schedule/scheduleNotificationService.js'
import { syncChatProactiveNotifications } from '../features/chat/chatProactive.js'
import { syncChatFollowupNotifications } from '../features/chat/chatFollowup.js'
import { normalizeDebtGroups } from '../services/debtOrdering.js'
import { buildMoodBackupSnapshot, normalizeMoodBackupSnapshot } from '../features/mood/moodRecords.js'
import { buildChatBackupSnapshot } from '../features/chat/chatRecords.js'
import { buildTodoBackup } from '../features/todo/todoCore.js'
import { normalizeScheduleData } from '../features/schedule/scheduleCore.js'

export function backupParticipants({ debtStore: debt, weightStore: weight, moodStore: mood, vaultStore: vault, scheduleStore: schedule, todoStore: todo, chatStore: chat, settingsStore: settings }) {
  const base = (id, store, load, flush = () => store.flush()) => ({ id, ready: () => store.isDataLoaded && !store.loadError, flush, initialize: () => store.isDataLoaded || load?.() })
  return [
    { ...base('savings', debt, () => debt.loadDebts()), export: () => ({ data: debt.savedDebts, metadata: { groups: debt.debtGroups } }),
      restore: part => debt.restoreDebts(part.data, part.metadata.groups), singleExport: () => ({ records: debt.savedDebts, groups: debt.debtGroups }),
      import: (data, { overwrite }) => {
        const records = overwrite ? data.records : [...debt.savedDebts, ...data.records]
        const groups = overwrite ? data.groups : normalizeDebtGroups([...debt.debtGroups, ...data.groups], records)
        return debt.restoreDebts(records, groups)
      } },
    { ...base('weight', weight, () => weight.loadWeightRecords()), export: () => ({ data: weight.weightRecords }), restore: part => weight.restoreWeightRecords(part.data),
      import: (data, { overwrite }) => weight.restoreWeightRecords(overwrite ? data : [...weight.weightRecords, ...data]) },
    { ...base('mood', mood, () => mood.loadMoodRecords()), export: () => ({ data: mood.moodRecords, metadata: { trackingStartDate: mood.trackingStartDate, customTags: mood.customTags,
      builtInTags: mood.builtInTags, defaultTags: mood.defaultTags, definitions: mood.moodDefinitions } }),
      restore: part => mood.restoreMoodBackup(part.data, part.metadata),
      singleExport: () => buildMoodBackupSnapshot({ records: mood.moodRecords, trackingStartDate: mood.trackingStartDate, customTags: mood.customTags, builtInTags: mood.builtInTags, defaultTags: mood.defaultTags, definitions: mood.moodDefinitions }),
      import: (data, { overwrite }) => {
        const value = normalizeMoodBackupSnapshot(data, mood.moodDefinitions)
        return overwrite ? mood.restoreMoodBackup(value.data.records, value.metadata) : mood.mergeMoodBackup(value.data.records, value.metadata)
      } },
    { ...base('passwords', vault), export: () => ({ data: vault.records, metadata: { categories: vault.categories } }),
      restore: part => vault.restoreRecords(part.data, part.metadata),
      import: async (data, { overwrite }) => { if (overwrite) vault.replaceRecords(data); else vault.appendRecords(data); await vault.flush() } },
    { ...base('schedules', schedule, () => schedule.loadSchedules()), synchronize: () => syncScheduleNotifications(schedule.snapshot), export: () => ({ data: schedule.snapshot }), restore: part => schedule.restoreScheduleData(part.data),
      import: (value, { overwrite }) => {
        const data = normalizeScheduleData(value)
        return schedule.restoreScheduleData(overwrite ? data : normalizeScheduleData({ series: [...schedule.series, ...data.series], occurrences: [...schedule.occurrences, ...data.occurrences], categories: [...schedule.categories, ...data.categories] }))
      } },
    { ...base('todos', todo, () => todo.load()), synchronize: () => todo.syncReminders(), optional: true, export: () => ({ data: todo.snapshot }), restore: part => todo.restore(part.data),
      singleExport: () => buildTodoBackup(todo.snapshot), import: data => todo.restore(data) },
    { ...base('chat', chat), synchronize: async () => {
      chat.materializeDueProactive(Date.now()); chat.materializeDueFollowups(Date.now())
      const options = { isFeatureEnabled: () => settings.warmHomeEnabled, requestPermission: false, now: new Date() }
      await Promise.all([syncChatProactiveNotifications(chat.proactiveOutbox, chat.proactiveSettings, options), syncChatFollowupNotifications(chat.followupOutbox, chat.realismSettings, options)])
      await chat.flush()
    }, export: () => ({ data: chat.snapshot }), restore: part => chat.restoreChatData(part.data), singleExport: () => buildChatBackupSnapshot(chat.snapshot),
      import: (data, { overwrite }) => overwrite ? chat.replaceChatData(data) : chat.mergeChatSnapshot(data) },
    { ...base('settings', settings, () => settings.loadSettings(), () => settings.flushPendingSettingsWrites()), export: () => ({ data: settings.getBackupSnapshot() }), restore: part => settings.restoreBackupSnapshot(part.data) }
  ]
}
