export const HOME_WIDGET_SNAPSHOT_VERSION = 1

const localDate = date => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const latestByDate = records => [...records].sort((left, right) => {
  const date = String(right?.date || '').localeCompare(String(left?.date || ''))
  if (date) return date
  return Number(right?.createdAt || right?.id || 0) - Number(left?.createdAt || left?.id || 0)
})[0]

export function buildHomeWidgetSnapshot({
  moodRecords = [],
  moodDefinitions = [],
  weightRecords = [],
  savedDebts = []
} = {}, now = new Date()) {
  const today = localDate(now)
  const todayMoods = moodRecords.filter(record => record?.date === today && !record?.autoFilled)
  const currentMood = latestByDate(todayMoods)
  const moodDefinition = moodDefinitions.find(item => item?.id === currentMood?.mood)
  const currentWeight = latestByDate(weightRecords.filter(record => Number.isFinite(Number(record?.weight))))
  const activeDebts = savedDebts.filter(item => !item?.isCleared)
  const savingsProgress = activeDebts.map(item => {
    const saved = (Array.isArray(item?.records) ? item.records : [])
      .reduce((sum, record) => sum + (Number(record?.amount) || 0), 0)
    const total = Number(item?.totalAmount) || 0
    return total > 0 ? Math.round(Math.min(100, saved / total * 100)) : 0
  })
  const savingsLoggedToday = savedDebts.some(item => (
    Array.isArray(item?.records) && item.records.some(record => record?.date === today)
  ))
  const weightLoggedToday = currentWeight?.date === today
  const todayCount = Number(Boolean(currentMood)) + Number(weightLoggedToday) + Number(savingsLoggedToday)

  return {
    version: HOME_WIDGET_SNAPSHOT_VERSION,
    generatedAt: now.getTime(),
    today,
    moodText: currentMood ? String(moodDefinition?.label || '一般') : '未记录',
    weightText: currentWeight ? `${Number(currentWeight.weight).toFixed(1).replace(/\.0$/, '')} kg` : '暂无',
    savingsText: savingsProgress.length ? `${Math.max(...savingsProgress)}%` : '暂无',
    todayCount
  }
}
