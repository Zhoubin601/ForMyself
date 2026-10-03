import { addDays, formatLocalDate, parseLocalDate } from '../schedule/scheduleCore.js'

export { addDays, formatLocalDate, parseLocalDate }
export const TODO_DATA_VERSION = 1
export const TODO_ANIMATION_ENABLED = true
const types = new Set(['none', 'daily', 'weekly', 'custom'])
const text = (value, max) => String(value ?? '').trim().slice(0, max)
const clone = value => JSON.parse(JSON.stringify(value))
export const newTodoId = () => globalThis.crypto?.randomUUID?.() || `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`
export const todoKey = (id, date) => `${id}@${date}`
const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')
const fail = (code, extra = {}) => { throw Object.assign(new Error(code), { code, ...extra }) }

export function normalizeTodoTask(value = {}) {
  if (!text(value.id, 80) || !parseLocalDate(value.startDate)) fail('INVALID_TODO_TASK')
  const title = text(value.title, 80)
  if (!title) fail('TODO_TITLE_REQUIRED')
  const recurrence = value.recurrence || {}
  const type = types.has(recurrence.type) ? recurrence.type : 'none'
  const weekdays = [...new Set((recurrence.weekdays || []).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort()
  if (type === 'weekly' && !weekdays.length) fail('TODO_WEEKDAY_REQUIRED')
  const intervalDays = Number(recurrence.intervalDays ?? 2)
  if (type === 'custom' && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) fail('TODO_INTERVAL_INVALID')
  if (value.endsOn && (!parseLocalDate(value.endsOn) || value.endsOn < value.startDate)) fail('TODO_DATE_RANGE_INVALID')
  const time = validTime(value.time) ? value.time : ''
  return {
    id: text(value.id, 80), parentTaskId: text(value.parentTaskId, 80) || null,
    title, note: text(value.note, 1000), startDate: value.startDate,
    endsOn: value.endsOn || '', archived: value.archived === true,
    recurrenceAnchorDate: parseLocalDate(value.recurrenceAnchorDate) ? value.recurrenceAnchorDate : value.startDate,
    recurrence: { type, weekdays: type === 'weekly' ? weekdays : [], intervalDays: type === 'custom' ? intervalDays : 2 },
    time, reminder: value.reminder === true && Boolean(time),
    createdAt: Number(value.createdAt) || Date.now(), updatedAt: Number(value.updatedAt) || Date.now()
  }
}

export function normalizeTodoData(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_TODO_DATA')
  if (value.version != null && value.version !== TODO_DATA_VERSION) fail('UNSUPPORTED_TODO_VERSION')
  for (const field of ['tasks', 'overrides', 'completions']) {
    if (value[field] != null && !Array.isArray(value[field])) fail('INVALID_TODO_DATA')
  }
  const tasks = (value.tasks || []).map(normalizeTodoTask)
  const ids = new Set(tasks.map(t => t.id))
  if (ids.size !== tasks.length) fail('DUPLICATE_TODO_ID')
  for (const task of tasks) {
    const visited = new Set([task.id])
    let parent = task.parentTaskId
    while (parent) {
      if (!ids.has(parent) || visited.has(parent)) fail('INVALID_TODO_PARENT')
      visited.add(parent)
      parent = tasks.find(t => t.id === parent).parentTaskId
    }
  }
  const root = task => {
    let item = task
    while (item.parentTaskId) item = tasks.find(t => t.id === item.parentTaskId)
    return item.id
  }
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i], b = tasks[j]
      const end = t => t.recurrence.type === 'none' ? t.startDate : t.endsOn || '9999-12-31'
      if (!a.archived && !b.archived && root(a) === root(b) && a.startDate <= end(b) && b.startDate <= end(a)) fail('TODO_VERSION_OVERLAP')
    }
  }
  const normalizeState = (s, completion) => {
    if (!ids.has(s?.taskId) || !parseLocalDate(s.date)) fail('INVALID_TODO_STATE')
    const base = { taskId: s.taskId, date: s.date, key: todoKey(s.taskId, s.date) }
    if (completion) return { ...base, completedAt: Number(s.completedAt) || Date.now() }
    const changes = {}
    for (const k of ['title', 'note', 'time', 'reminder']) if (Object.hasOwn(s.changes || {}, k)) changes[k] = s.changes[k]
    if (Object.hasOwn(changes, 'title') && !text(changes.title, 80)) fail('TODO_TITLE_REQUIRED')
    if (Object.hasOwn(changes, 'title')) changes.title = text(changes.title, 80)
    if (Object.hasOwn(changes, 'note')) changes.note = text(changes.note, 1000)
    if (Object.hasOwn(changes, 'time')) changes.time = validTime(changes.time) ? changes.time : ''
    if (Object.hasOwn(changes, 'reminder')) changes.reminder = changes.reminder === true
    return { ...base, cancelled: s.cancelled === true, changes }
  }
  const unique = list => {
    const map = new Map(list.map(s => [s.key, s]))
    if (map.size !== list.length) fail('DUPLICATE_TODO_STATE')
    return [...map.values()]
  }
  return { version: TODO_DATA_VERSION, revision: Math.max(0, Number(value.revision) || 0), tasks,
    overrides: unique((value.overrides || []).map(s => normalizeState(s, false))),
    completions: unique((value.completions || []).map(s => normalizeState(s, true))) }
}

export function todoMatchesDate(task, date) {
  if (!parseLocalDate(date) || task.archived || date < task.startDate || (task.endsOn && date > task.endsOn)) return false
  const rule = task.recurrence
  if (rule.type === 'none') return date === task.startDate
  if (rule.type === 'daily') return true
  if (rule.type === 'weekly') return rule.weekdays.includes(parseLocalDate(date).getDay())
  const utc = d => { const p = parseLocalDate(d); return Date.UTC(p.getFullYear(), p.getMonth(), p.getDate()) }
  return (utc(date) - utc(task.recurrenceAnchorDate)) / 86400000 % rule.intervalDays === 0
}

export function getTodoDay(data, date = formatLocalDate()) {
  const completed = new Map(data.completions.map(c => [c.key, c]))
  const overrides = new Map(data.overrides.map(o => [o.key, o]))
  return data.tasks.filter(t => todoMatchesDate(t, date)).flatMap(task => {
    const key = todoKey(task.id, date)
    const override = overrides.get(key)
    if (override?.cancelled) return []
    return [{ ...task, ...override?.changes, taskId: task.id, key, date,
      completed: completed.has(key), completedAt: completed.get(key)?.completedAt || 0 }]
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function todoProgress(items) {
  const done = items.filter(t => t.completed).length
  return { total: items.length, done, ratio: items.length ? done / items.length : 0,
    percent: items.length ? Math.round(done / items.length * 100) : 0 }
}

export function earliestTodoChange(data, taskId) {
  const task = data.tasks.find(t => t.id === taskId)
  const dates = data.completions.filter(c => c.taskId === taskId).map(c => c.date).sort()
  return dates.length ? addDays(dates.at(-1), 1) : task?.startDate || ''
}

export function applyTodoCommand(value, command) {
  const data = normalizeTodoData(clone(value))
  const now = Date.now()
  if (command.type === 'restore') return { ...normalizeTodoData(command.data), revision: data.revision + 1 }
  if (command.type === 'add') {
    if (data.tasks.some(t => t.id === command.task.id)) fail('DUPLICATE_TODO_ID')
    data.tasks.push(normalizeTodoTask({ ...command.task, parentTaskId: null, createdAt: now, updatedAt: now }))
  } else {
    const task = data.tasks.find(t => t.id === command.taskId)
    if (!task) fail('TODO_NOT_FOUND')
    const date = command.date
    if (!parseLocalDate(date) || task.archived || date < task.startDate || (task.endsOn && date > task.endsOn) || ((command.type === 'complete' || command.scope === 'single') && !todoMatchesDate(task, date))) fail('TODO_OCCURRENCE_NOT_FOUND')
    const key = todoKey(task.id, date)
    if (command.type === 'complete') {
      if (data.overrides.some(o => o.key === key && o.cancelled)) fail('TODO_OCCURRENCE_NOT_FOUND')
      if (command.completed && !data.completions.some(c => c.key === key)) data.completions.push({ taskId: task.id, date, key, completedAt: now })
      if (!command.completed) data.completions = data.completions.filter(c => c.key !== key)
    } else if (command.scope === 'single') {
      const old = data.overrides.find(o => o.key === key)
      if (command.type === 'delete' && data.completions.some(c => c.key === key)) fail('TODO_COMPLETION_PROTECTED')
      const changes = command.type === 'edit' ? { ...old?.changes, ...command.changes } : old?.changes || {}
      data.overrides = data.overrides.filter(o => o.key !== key)
      data.overrides.push({ taskId: task.id, date, key, cancelled: command.type === 'delete', changes })
    } else if (['edit', 'delete'].includes(command.type)) {
      const earliestDate = earliestTodoChange(data, task.id)
      if (date < earliestDate) fail('TODO_HISTORY_PROTECTED', { earliestDate })
      const previousEnd = task.endsOn
      task.endsOn = addDays(date, -1)
      task.archived = date === task.startDate
      if (task.archived) task.endsOn = task.startDate
      task.updatedAt = now
      if (command.type === 'edit') {
        if (!command.newId || data.tasks.some(t => t.id === command.newId)) fail('DUPLICATE_TODO_ID')
        const oldRule = task.recurrence
        const nextRule = command.changes.recurrence || oldRule
        const ruleChanged = JSON.stringify(oldRule) !== JSON.stringify(nextRule)
        data.tasks.push(normalizeTodoTask({ ...task, ...command.changes,
          id: command.newId, parentTaskId: task.id, startDate: date,
          endsOn: Object.hasOwn(command.changes, 'endsOn') ? command.changes.endsOn : previousEnd,
          archived: false, recurrenceAnchorDate: ruleChanged ? date : task.recurrenceAnchorDate,
          createdAt: now, updatedAt: now }))
      }
    } else fail('INVALID_TODO_COMMAND')
  }
  data.revision++
  return normalizeTodoData(data)
}

export function buildTodoNotifications(data, now = new Date()) {
  const result = []
  for (let n = 0; n <= 60 && result.length < 96; n++) {
    const date = addDays(formatLocalDate(now), n)
    for (const item of getTodoDay(data, date)) {
      if (item.completed || !item.reminder || !item.time) continue
      const at = new Date(`${date}T${item.time}:00`)
      if (at <= now) continue
      let hash = 0
      for (const c of item.key) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0
      const used = new Set(result.map(t => t.id))
      let id = 800000000 + (Math.abs(hash) % 100000000)
      while (used.has(id)) id = 800000000 + ((id - 800000000 + 1) % 100000000)
      result.push({ id, title: `待办 · ${item.title}`, body: item.note || '今天的小计划，到时间了',
        channelId: 'formyself-todo-v1', schedule: { at, allowWhileIdle: true },
        extra: { url: `formyself://open/todo?item=${encodeURIComponent(item.id)}&date=${date}` } })
    }
  }
  return result.slice(0, 96)
}

export function buildTodoBackup(data) { return { type: 'formyself-todo-backup', version: 1, data: normalizeTodoData(data) } }
export function readTodoBackup(value) {
  if (value?.type !== 'formyself-todo-backup' || value.version !== 1) fail('INVALID_TODO_BACKUP')
  if (!value.data || !['tasks', 'overrides', 'completions'].every(k => Array.isArray(value.data[k]))) fail('INVALID_TODO_BACKUP')
  return normalizeTodoData(value.data)
}
