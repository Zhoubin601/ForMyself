export const SCHEDULE_STORAGE_KEY = 'my_schedule_data_v2'
export const SCHEDULE_WIDGET_SNAPSHOT_KEY = 'my_schedule_widget_snapshot'

export const BUILT_IN_SCHEDULE_CATEGORIES = Object.freeze([
  { id: 'study', name: '学习', color: '#ff4d55', builtIn: true }
])

const DAY_MS = 24 * 60 * 60 * 1000
const VALID_RECURRENCES = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'])
const VALID_OFFSETS = new Set([null, 0, 10, 60, 1440])
const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max)
const cloneJson = value => JSON.parse(JSON.stringify(value))

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return formatLocalDate(date) === value ? date : null
}

export function addDays(value, amount) {
  const date = parseLocalDate(value)
  if (!date) return value
  date.setDate(date.getDate() + amount)
  return formatLocalDate(date)
}

function daysBetween(start, end) {
  const a = parseLocalDate(start)
  const b = parseLocalDate(end)
  if (!a || !b) return 0
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS)
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function normalizeTime(value, fallback = '09:00') {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fallback
  return `${match[1]}:${match[2]}`
}

function normalizeDate(value, fallback = formatLocalDate()) {
  return parseLocalDate(value) ? value : fallback
}

function stableId(prefix = 'schedule') {
  const random = Math.random().toString(36).slice(2, 9)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function normalizeScheduleCategory(value, index = 0) {
  const fallback = { name: `分类${index + 1}`, color: '#ff4d55' }
  const name = cleanText(value?.name, 12)
  return {
    id: cleanText(value?.id, 48) || stableId('category'),
    name: name || fallback.name,
    color: /^#[0-9a-f]{6}$/i.test(value?.color || '') ? value.color : fallback.color,
    builtIn: value?.id === 'study'
  }
}

export function normalizeScheduleSeries(value, now = new Date()) {
  const startDate = normalizeDate(value?.startDate, formatLocalDate(now))
  const allDay = value?.allDay === true
  const startTime = normalizeTime(value?.startTime, '09:00')
  const fallbackEndDate = startDate
  let endDate = normalizeDate(value?.endDate, fallbackEndDate)
  if (endDate < startDate) endDate = startDate
  let endTime = normalizeTime(value?.endTime, '10:00')
  if (!allDay && endDate === startDate && endTime <= startTime) {
    const start = new Date(`${startDate}T${startTime}:00`)
    start.setHours(start.getHours() + 1)
    endDate = formatLocalDate(start)
    endTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
  }
  const recurrenceType = VALID_RECURRENCES.has(value?.recurrence?.type)
    ? value.recurrence.type
    : 'none'
  const weekdays = [...new Set((Array.isArray(value?.recurrence?.weekdays)
    ? value.recurrence.weekdays
    : [parseLocalDate(startDate)?.getDay()])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]

  return {
    id: cleanText(value?.id, 80) || stableId(),
    type: value?.type === 'task' ? 'task' : 'event',
    title: cleanText(value?.title, 80) || '未命名日程',
    categoryId: cleanText(value?.categoryId, 48) || 'study',
    allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    lunar: false,
    timeZone: 'Asia/Shanghai',
    location: cleanText(value?.location, 120),
    note: cleanText(value?.note, 1000),
    reminderOffset: VALID_OFFSETS.has(value?.reminderOffset) ? value.reminderOffset : null,
    // v2 备份中可能仍包含 alarm；新版本统一迁移为普通通知提醒。
    reminderMode: 'notification',
    recurrence: {
      type: recurrenceType,
      weekdays: recurrenceType === 'weekly' && weekdays.length ? weekdays : [],
      intervalDays: Math.min(365, Math.max(1, Math.round(Number(value?.recurrence?.intervalDays) || 2)))
    },
    endsOn: parseLocalDate(value?.endsOn) ? value.endsOn : '',
    createdAt: Number(value?.createdAt) || Date.now(),
    updatedAt: Number(value?.updatedAt) || Date.now()
  }
}

export function normalizeOccurrenceState(value) {
  return {
    key: cleanText(value?.key, 180),
    seriesId: cleanText(value?.seriesId, 80),
    originalDate: normalizeDate(value?.originalDate),
    status: ['completed', 'cancelled'].includes(value?.status) ? value.status : 'override',
    completedAt: Number(value?.completedAt) || 0,
    override: value?.override && typeof value.override === 'object' ? cloneJson(value.override) : {},
    updatedAt: Number(value?.updatedAt) || Date.now()
  }
}

export function normalizeScheduleData(value = {}) {
  const builtIns = BUILT_IN_SCHEDULE_CATEGORIES.map(item => ({ ...item }))
  const customCategories = (Array.isArray(value?.categories) ? value.categories : [])
    .filter(item => !(item?.builtIn === true && item?.id !== 'study'))
    .map(normalizeScheduleCategory)
    .filter(item => !BUILT_IN_SCHEDULE_CATEGORIES.some(builtIn => builtIn.id === item.id))
  return {
    series: (Array.isArray(value?.series) ? value.series : []).map(item => normalizeScheduleSeries(item)),
    occurrences: (Array.isArray(value?.occurrences) ? value.occurrences : [])
      .map(normalizeOccurrenceState)
      .filter(item => item.key && item.seriesId),
    categories: [...builtIns, ...customCategories]
  }
}

export function countScheduleCategoryUsage(data = {}, categoryId = '') {
  if (!categoryId) return 0
  const seriesUsage = (Array.isArray(data?.series) ? data.series : [])
    .filter(item => item?.categoryId === categoryId)
    .length
  const overrideUsage = (Array.isArray(data?.occurrences) ? data.occurrences : [])
    .filter(item =>
      item?.status === 'override' &&
      item?.override?.categoryId === categoryId
    )
    .length
  return seriesUsage + overrideUsage
}

function matchesRecurrence(series, candidate) {
  if (candidate < series.startDate || (series.endsOn && candidate > series.endsOn)) return false
  if (series.recurrence.type === 'none') return candidate === series.startDate
  if (series.recurrence.type === 'daily') return true
  const date = parseLocalDate(candidate)
  const anchor = parseLocalDate(series.startDate)
  if (!date || !anchor) return false
  if (series.recurrence.type === 'custom') {
    return daysBetween(series.startDate, candidate) % series.recurrence.intervalDays === 0
  }
  if (series.recurrence.type === 'weekly') {
    return series.recurrence.weekdays.includes(date.getDay())
  }
  if (series.recurrence.type === 'monthly') {
    return date.getDate() === Math.min(anchor.getDate(), daysInMonth(date.getFullYear(), date.getMonth()))
  }
  if (series.recurrence.type === 'yearly') {
    const targetDay = Math.min(anchor.getDate(), daysInMonth(date.getFullYear(), anchor.getMonth()))
    return date.getMonth() === anchor.getMonth() && date.getDate() === targetDay
  }
  return false
}

export function getOccurrenceKey(seriesId, date) {
  return `${seriesId}@${date}`
}

function occurrenceTimestamp(date, time, allDay, endOfDay = false) {
  if (allDay) return new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime()
  return new Date(`${date}T${time}:00`).getTime()
}

export function generateOccurrences(data, fromDate, toDate, now = new Date()) {
  const normalized = normalizeScheduleData(data)
  const start = normalizeDate(fromDate)
  const end = normalizeDate(toDate, start)
  if (end < start) return []
  const states = new Map(normalized.occurrences.map(item => [item.key, item]))
  const result = []

  for (const series of normalized.series) {
    const first = series.startDate > start ? series.startDate : start
    for (let date = first, guard = 0; date <= end && guard < 800; date = addDays(date, 1), guard++) {
      if (!matchesRecurrence(series, date)) continue
      const key = getOccurrenceKey(series.id, date)
      const state = states.get(key)
      if (state?.status === 'cancelled') continue
      const merged = state?.override ? normalizeScheduleSeries({
        ...series,
        ...state.override,
        id: series.id,
        startDate: state.override.startDate || date
      }) : series
      const occurrenceDate = state?.override?.startDate || date
      const durationDays = Math.max(0, daysBetween(series.startDate, series.endDate))
      const occurrenceEndDate = state?.override?.endDate || addDays(occurrenceDate, durationDays)
      const startAt = occurrenceTimestamp(occurrenceDate, merged.startTime, merged.allDay)
      const endAt = occurrenceTimestamp(occurrenceEndDate, merged.endTime, merged.allDay, true)
      const completed = state?.status === 'completed'
      const historical = completed || endAt < now.getTime()
      result.push({
        ...merged,
        key,
        seriesId: series.id,
        originalDate: date,
        occurrenceDate,
        occurrenceEndDate,
        startAt,
        endAt,
        completed,
        completedAt: state?.completedAt || 0,
        expired: !completed && endAt < now.getTime(),
        historical
      })
    }
  }

  return result.sort((a, b) => a.startAt - b.startAt || a.title.localeCompare(b.title, 'zh-CN'))
}

export function getWeekdayLabel(value) {
  const date = typeof value === 'string' ? parseLocalDate(value) : value
  return date ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] : ''
}

export function createScheduleSeries(input, now = new Date()) {
  return normalizeScheduleSeries({
    ...input,
    id: stableId(),
    createdAt: now.getTime(),
    updatedAt: now.getTime()
  }, now)
}

export function upsertOccurrenceState(states, nextState) {
  const normalized = normalizeOccurrenceState(nextState)
  return [
    ...states.filter(item => item.key !== normalized.key),
    normalized
  ]
}

export function splitSeriesAt(series, occurrenceDate, changes = {}, now = new Date()) {
  const previous = normalizeScheduleSeries({
    ...series,
    endsOn: addDays(occurrenceDate, -1),
    updatedAt: now.getTime()
  })
  const successor = createScheduleSeries({
    ...series,
    ...changes,
    startDate: changes.startDate || occurrenceDate,
    endDate: changes.endDate || addDays(occurrenceDate, Math.max(0, daysBetween(series.startDate, series.endDate))),
    createdAt: now.getTime()
  }, now)
  return { previous, successor }
}

export function hashNotificationId(value) {
  let hash = 2166136261
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return 300000000 + (Math.abs(hash) % 500000000)
}

export function buildScheduleNotifications(data, now = new Date(), horizonDays = 60, limit = 96) {
  const nowMs = now.getTime()
  const from = formatLocalDate(now)
  const to = addDays(from, horizonDays)
  return generateOccurrences(data, from, to, now)
    .filter(item => !item.historical && item.reminderOffset !== null)
    .map(item => {
      const reminderAt = item.startAt - item.reminderOffset * 60 * 1000
      return { item, reminderAt }
    })
    // 只调度未来提醒。应用启动或恢复时会重新校准任务，若在这里补发刚刚
    // 到点的提醒，会让已由系统送达的通知再次出现。
    .filter(entry => entry.reminderAt > nowMs)
    .sort((a, b) => a.reminderAt - b.reminderAt)
    .slice(0, limit)
    .map(({ item, reminderAt }) => ({
      id: hashNotificationId(item.key),
      title: item.type === 'task' ? `待办 · ${item.title}` : item.title,
      body: [
        item.allDay ? '全天' : item.startTime,
        item.location
      ].filter(Boolean).join(' · ') || '日程即将开始',
      channelId: 'formyself-schedule-notification-v1',
      autoCancel: true,
      schedule: {
        at: new Date(reminderAt),
        allowWhileIdle: true
      },
      extra: {
        reminderType: 'schedule',
        seriesId: item.seriesId,
        occurrenceKey: item.key,
        url: `formyself://open/schedule?item=${encodeURIComponent(item.seriesId)}&occurrence=${encodeURIComponent(item.key)}`
      }
    }))
}

export function buildScheduleWidgetSnapshot(data, now = new Date(), horizonDays = 30) {
  const normalized = normalizeScheduleData(data)
  const categories = new Map(normalized.categories.map(item => [item.id, item]))
  const from = formatLocalDate(now)
  const occurrences = generateOccurrences(normalized, from, addDays(from, horizonDays), now)
    .filter(item => !item.historical)
    .slice(0, 64)
    .map(item => {
      const category = categories.get(item.categoryId)
      return {
        key: item.key,
        seriesId: item.seriesId,
        title: item.title,
        date: item.occurrenceDate,
        time: item.allDay ? '全天' : item.startTime,
        startAt: item.startAt,
        endAt: item.endAt,
        color: category?.color || '#ff4d55'
      }
    })
  return {
    generatedAt: now.getTime(),
    today: from,
    occurrences
  }
}
