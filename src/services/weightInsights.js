export const DEFAULT_HEALTH_SETTINGS = {
  heightCm: null,
  targetWeight: null,
  weightChangeReminderEnabled: true,
  weightChangeThreshold: 1
}

const round = (value, digits = 1) => Number(Number(value).toFixed(digits))

const normalizeOptionalNumber = (value, min, max) => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export function normalizeHealthSettings(value = {}) {
  const threshold = Number(value.weightChangeThreshold)
  return {
    heightCm: normalizeOptionalNumber(value.heightCm, 80, 250),
    targetWeight: normalizeOptionalNumber(value.targetWeight, 20, 300),
    weightChangeReminderEnabled: value.weightChangeReminderEnabled !== false,
    weightChangeThreshold: Number.isFinite(threshold) && threshold >= 0.1 && threshold <= 20
      ? round(threshold)
      : DEFAULT_HEALTH_SETTINGS.weightChangeThreshold
  }
}

export function calculateBmi(weight, heightCm) {
  const parsedWeight = Number(weight)
  const parsedHeight = Number(heightCm)
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || !Number.isFinite(parsedHeight) || parsedHeight < 80 || parsedHeight > 250) return null
  const value = round(parsedWeight / ((parsedHeight / 100) ** 2))
  let label = '正常范围'
  if (value < 18.5) label = '偏低'
  else if (value >= 24 && value < 28) label = '偏高'
  else if (value >= 28) label = '较高'
  return { value, label }
}

const parseDate = date => {
  const input = String(date || '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1 || parsed.getUTCDate() !== Number(match[3])) return null
  return parsed
}

const formatUtcDate = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

export function getWeekStart(date) {
  const parsed = parseDate(date)
  if (!parsed) return ''
  const weekday = parsed.getUTCDay() || 7
  parsed.setUTCDate(parsed.getUTCDate() - weekday + 1)
  return formatUtcDate(parsed)
}

export function calculateWeeklyAverages(records = []) {
  const dailyWeights = new Map()
  records.forEach(record => {
    const date = String(record?.date || '')
    const weight = Number(record?.weight)
    if (!parseDate(date) || !Number.isFinite(weight) || weight < 20 || weight > 300) return
    const day = dailyWeights.get(date) || []
    day.push(weight)
    dailyWeights.set(date, day)
  })

  const weeks = new Map()
  dailyWeights.forEach((weights, date) => {
    const weekStart = getWeekStart(date)
    const dailyAverage = weights.reduce((sum, weight) => sum + weight, 0) / weights.length
    const week = weeks.get(weekStart) || []
    week.push(dailyAverage)
    weeks.set(weekStart, week)
  })

  const result = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, weights]) => {
      const weekEndDate = parseDate(weekStart)
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
      return {
        weekStart,
        weekEnd: formatUtcDate(weekEndDate),
        average: round(weights.reduce((sum, weight) => sum + weight, 0) / weights.length),
        days: weights.length
      }
    })

  return result.map((item, index) => ({
    ...item,
    change: index > 0 ? round(item.average - result[index - 1].average) : null
  }))
}

export function calculateWeightChangeNotice(records = [], newRecord, threshold = 1) {
  const weight = Number(newRecord?.weight)
  const date = String(newRecord?.date || '')
  if (!Number.isFinite(weight) || !parseDate(date)) return null
  const previous = sortWeightRecords(records.filter(record =>
    (!newRecord?.id || record?.id !== newRecord.id) && record?.date && Number.isFinite(Number(record.weight))
    && compareWeightRecordsNewestFirst(record, newRecord) >= 0
  ))[0]
  if (!previous) return null

  const diff = round(weight - Number(previous.weight))
  const safeThreshold = normalizeHealthSettings({ weightChangeThreshold: threshold }).weightChangeThreshold
  if (Math.abs(diff) < safeThreshold) return null
  const direction = diff > 0 ? '上升' : '下降'
  return {
    previousDate: previous.date,
    diff,
    direction,
    title: '体重变化提醒',
    body: `本次比上一条${direction} ${Math.abs(diff)} kg。单次变化可能受水分和测量时间影响，更建议观察周平均趋势。`
  }
}

export function buildWeightChangeNotification(notice, at = new Date(Date.now() + 1000)) {
  if (!notice?.body) return null
  return {
    id: 2201,
    title: notice.title || '体重变化提醒',
    body: String(notice.body).slice(0, 100),
    schedule: { at },
    extra: { reminderType: 'weight-change' }
  }
}

export function normalizeWeightTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : ''
}
export function compareWeightRecordsNewestFirst(a, b) {
  return String(b?.date || '').localeCompare(String(a?.date || ''))
    || normalizeWeightTime(b?.time).localeCompare(normalizeWeightTime(a?.time))
}
export function sortWeightRecords(records = []) {
  return records.map((record, index) => ({ record, index }))
    .sort((a, b) => compareWeightRecordsNewestFirst(a.record, b.record) || b.index - a.index)
    .map(item => item.record)
}
export function localWeightDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function filterWeightRange(records, days, now = new Date()) {
  if (!days) return records
  const start = new Date(now); start.setDate(start.getDate() - Number(days) + 1)
  const from = localWeightDate(start), through = localWeightDate(now)
  return records.filter(record => record.date >= from && record.date <= through)
}
export function calculateDailyAverages(records = []) {
  const days = new Map()
  records.forEach(record => {
    const weight = Number(record.weight)
    if (!parseDate(record.date) || !Number.isFinite(weight) || weight < 20 || weight > 300) return
    const day = days.get(record.date) || { sum: 0, count: 0 }
    day.sum += weight; day.count++
    days.set(record.date, day)
  })
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, weight: round(day.sum / day.count), count: day.count }))
}
