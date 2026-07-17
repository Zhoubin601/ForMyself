const MOOD_KEYS = ['great', 'good', 'normal', 'bad', 'terrible']

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

const parseLocalDate = value => new Date(`${value}T00:00:00`)

const longestDateStreak = dates => {
  const uniqueDates = [...new Set(dates)].sort()
  let longest = 0
  let current = 0
  let previous = null

  for (const value of uniqueDates) {
    const date = parseLocalDate(value)
    if (Number.isNaN(date.getTime())) continue
    if (!previous) current = 1
    else {
      const dayDiff = Math.round((date - previous) / 86400000)
      current = dayDiff === 1 ? current + 1 : 1
    }
    longest = Math.max(longest, current)
    previous = date
  }
  return longest
}

export function calculateMoodMonthlyStats(records = [], year, month) {
  const prefix = getMonthKey(year, month)
  const monthRecords = records.filter(item => item?.date?.startsWith(prefix))
  const distribution = Object.fromEntries(MOOD_KEYS.map(key => [key, 0]))
  monthRecords.forEach(item => {
    if (distribution[item.mood] !== undefined) distribution[item.mood]++
  })
  const totalEvents = monthRecords.length
  const recordedDays = new Set(monthRecords.map(item => item.date)).size
  return {
    total: totalEvents,
    totalEvents,
    recordedDays,
    distribution,
    percentages: Object.fromEntries(MOOD_KEYS.map(key => [
      key,
      totalEvents ? Math.round((distribution[key] / totalEvents) * 100) : 0
    ])),
    longestStreak: longestDateStreak(monthRecords.map(item => item.date))
  }
}

export function calculateWeightMonthlyStats(records = [], year, month, targetWeight = null) {
  const prefix = getMonthKey(year, month)
  const monthRecords = records
    .filter(item => item?.date?.startsWith(prefix) && Number.isFinite(Number(item.weight)))
    .map(item => ({ ...item, weight: Number(item.weight) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!monthRecords.length) {
    return { count: 0, average: null, first: null, latest: null, change: null, trend: 'none', targetGap: null }
  }

  const first = monthRecords[0]
  const latest = monthRecords[monthRecords.length - 1]
  const average = monthRecords.reduce((sum, item) => sum + item.weight, 0) / monthRecords.length
  const change = latest.weight - first.weight
  const target = Number(targetWeight)

  return {
    count: monthRecords.length,
    average: Number(average.toFixed(1)),
    first: { date: first.date, weight: first.weight },
    latest: { date: latest.date, weight: latest.weight },
    change: Number(change.toFixed(1)),
    trend: Math.abs(change) < 0.05 ? 'stable' : change > 0 ? 'up' : 'down',
    targetGap: Number.isFinite(target) && target > 0
      ? Number((latest.weight - target).toFixed(1))
      : null
  }
}

const getElapsedDaysInMonth = (year, month, now) => {
  const selectedStart = new Date(year, month - 1, 1)
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
  if (selectedStart > currentStart) return 0
  if (selectedStart < currentStart) return new Date(year, month, 0).getDate()
  return now.getDate()
}

export function calculateSavingsMonthlyStats(plans = [], year, month, now = new Date()) {
  const prefix = getMonthKey(year, month)
  const monthlyRecords = plans.flatMap(plan =>
    (Array.isArray(plan.records) ? plan.records : [])
      .filter(item => item?.date?.startsWith(prefix))
      .map(item => ({ ...item, planName: plan.name || '未命名目标', amount: Number(item.amount) || 0 }))
  )
  const monthlySaved = monthlyRecords.reduce((sum, item) => sum + item.amount, 0)
  const elapsedDays = getElapsedDaysInMonth(year, month, now)
  const dailyAverage = elapsedDays > 0 ? monthlySaved / elapsedDays : 0

  const activePlans = plans
    .filter(plan => !plan.isCleared)
    .map(plan => {
      const total = Number(plan.totalAmount) || 0
      const saved = (Array.isArray(plan.records) ? plan.records : [])
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
      return {
        name: plan.name || '未命名目标',
        total,
        saved,
        remaining: Math.max(0, total - saved),
        progress: total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0
      }
    })
    .sort((a, b) => a.remaining - b.remaining)

  const closestPlan = activePlans[0] || null
  const estimatedDays = closestPlan && dailyAverage > 0
    ? Math.ceil(closestPlan.remaining / dailyAverage)
    : null

  return {
    recordCount: monthlyRecords.length,
    monthlySaved: Number(monthlySaved.toFixed(2)),
    elapsedDays,
    dailyAverage: Number(dailyAverage.toFixed(2)),
    closestPlan,
    estimatedDays
  }
}

export function buildMonthlyReport({ moodRecords = [], weightRecords = [], savedDebts = [] }, year, month, options = {}) {
  return {
    month: getMonthKey(year, month),
    mood: calculateMoodMonthlyStats(moodRecords, year, month),
    weight: calculateWeightMonthlyStats(weightRecords, year, month, options.targetWeight),
    savings: calculateSavingsMonthlyStats(savedDebts, year, month, options.now || new Date())
  }
}

export function buildMonthlySummaryPrompt(report) {
  return `你是一个温柔、可靠的个人生活陪伴者。请根据以下月度数据，写一段120字以内的中文总结：${JSON.stringify(report)}\n要求：先看见用户的努力，再客观描述心情、体重和省钱变化，最后给一个轻柔可执行的小建议。资料缺失时明确说本月记录较少。不要诊断心理或身体疾病，不评价身材，不制造财务焦虑，不编造数据。只输出总结正文。`
}
