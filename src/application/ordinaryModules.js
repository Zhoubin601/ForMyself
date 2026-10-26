// Application composition: domain stores own their rules; the shell invokes common lifecycle hooks.
export function ordinaryModuleRuntimes({ debtStore, weightStore, moodStore, scheduleStore, todoStore, settingsStore, onLifeChange, onScheduleChange }) {
  const lifeSubscribe = store => () => store.$subscribe(() => onLifeChange())
  return [
    { id: 'settings', initialize: () => settingsStore.loadSettings(), flush: () => settingsStore.flushPendingSettingsWrites() },
    { id: 'debts', store: debtStore, initialize: () => debtStore.loadDebts(), flush: () => debtStore.isDataLoaded && debtStore.flush(), subscribe: lifeSubscribe(debtStore) },
    { id: 'weight', store: weightStore, initialize: () => weightStore.loadWeightRecords(), flush: () => weightStore.isDataLoaded && weightStore.flush(), subscribe: lifeSubscribe(weightStore) },
    { id: 'mood', store: moodStore, initialize: () => moodStore.loadMoodRecords(), flush: () => moodStore.isDataLoaded && moodStore.flush(), subscribe: lifeSubscribe(moodStore), resume: () => moodStore.isDataLoaded && moodStore.autoFillMissingDays() },
    { id: 'schedule', store: scheduleStore, initialize: () => scheduleStore.loadSchedules(), flush: () => scheduleStore.isDataLoaded && scheduleStore.flush(), subscribe: () => scheduleStore.$subscribe(onScheduleChange), resume: onScheduleChange },
    { id: 'todo', store: todoStore, initialize: () => todoStore.load(), flush: () => todoStore.flush(), resume: () => todoStore.load().then(() => todoStore.syncReminders()) }
  ]
}
