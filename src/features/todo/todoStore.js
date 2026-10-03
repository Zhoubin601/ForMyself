import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { todoRepository } from './todoRepository.js'
import { formatLocalDate, getTodoDay, newTodoId, normalizeTodoData, todoProgress } from './todoCore.js'
import { syncTodoNotifications } from './todoNotificationService.js'

export const useTodoStore = defineStore('todo', () => {
  const snapshot = ref(normalizeTodoData())
  const today = ref(formatLocalDate())
  const isDataLoaded = ref(false)
  const loadError = ref('')
  const reminderError = ref('')
  const todayItems = computed(() => getTodoDay(snapshot.value, today.value))
  const progress = computed(() => todoProgress(todayItems.value))
  let reminders = Promise.resolve()
  const syncReminders = (requestPermission = false) => {
    const result = reminders.catch(() => {}).then(async () => {
      try { await syncTodoNotifications(await todoRepository.read(), requestPermission); reminderError.value = '' }
      catch (e) { reminderError.value = e.message; if (requestPermission) throw e }
    })
    reminders = result.catch(() => {})
    return result
  }
  const load = async () => {
    today.value = formatLocalDate()
    try {
      const data = await todoRepository.read()
      if (!isDataLoaded.value || data.revision >= snapshot.value.revision) snapshot.value = data
      loadError.value = ''; isDataLoaded.value = true
    }
    catch (e) { loadError.value = e.message; isDataLoaded.value = false }
  }
  const apply = async command => {
    if (!isDataLoaded.value) throw new Error('待办尚未加载，请重试')
    const saved = await todoRepository.apply(command)
    if (saved.revision >= snapshot.value.revision) snapshot.value = saved
    void syncReminders()
    return snapshot.value
  }
  const add = task => apply({ type: 'add', task: { ...task, id: newTodoId() } })
  const edit = (taskId, date, changes, scope) => apply({ type: 'edit', taskId, date, changes, scope, newId: newTodoId() })
  const remove = (taskId, date, scope) => apply({ type: 'delete', taskId, date, scope })
  const complete = (taskId, date, completed) => apply({ type: 'complete', taskId, date, completed })
  const restore = async data => { await load(); if (!isDataLoaded.value) throw new Error(loadError.value); return apply({ type: 'restore', data }) }
  return { snapshot, today, isDataLoaded, loadError, reminderError, todayItems, progress, load, apply, add, edit, remove, complete, restore, syncReminders, flush: () => todoRepository.flush() }
})
