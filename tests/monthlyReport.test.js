import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMonthlyReport,
  buildMonthlySummaryPrompt,
  calculateMoodMonthlyStats,
  calculateSavingsMonthlyStats,
  calculateWeightMonthlyStats
} from '../src/services/monthlyReport.js'

test('心情统计计算分布、百分比和本月最长连续天数', () => {
  const stats = calculateMoodMonthlyStats([
    { date: '2026-07-01', mood: 'good' },
    { date: '2026-07-02', mood: 'normal' },
    { date: '2026-07-03', mood: 'bad' },
    { date: '2026-07-05', mood: 'good' },
    { date: '2026-06-30', mood: 'great' }
  ], 2026, 7)
  assert.equal(stats.total, 4)
  assert.equal(stats.distribution.good, 2)
  assert.equal(stats.percentages.good, 50)
  assert.equal(stats.longestStreak, 3)
})

test('重复日期不会虚增连续记录天数', () => {
  const stats = calculateMoodMonthlyStats([
    { date: '2026-07-01', mood: 'good' },
    { date: '2026-07-01', mood: 'bad' },
    { date: '2026-07-02', mood: 'normal' }
  ], 2026, 7)
  assert.equal(stats.longestStreak, 2)
})

test('体重统计计算月平均、首末变化和目标差距', () => {
  const stats = calculateWeightMonthlyStats([
    { date: '2026-07-01', weight: 66 },
    { date: '2026-07-10', weight: 65.5 },
    { date: '2026-07-18', weight: 65 },
    { date: '2026-06-30', weight: 70 }
  ], 2026, 7, 63)
  assert.equal(stats.count, 3)
  assert.equal(stats.average, 65.5)
  assert.equal(stats.change, -1)
  assert.equal(stats.trend, 'down')
  assert.equal(stats.targetGap, 2)
})

test('没有体重记录时返回可安全展示的空统计', () => {
  assert.deepEqual(calculateWeightMonthlyStats([], 2026, 7, 60), {
    count: 0,
    average: null,
    first: null,
    latest: null,
    change: null,
    trend: 'none',
    targetGap: null
  })
})

test('省钱统计计算月存款、当前月日均和预计完成天数', () => {
  const stats = calculateSavingsMonthlyStats([
    {
      name: '旅行',
      totalAmount: 1000,
      records: [
        { date: '2026-07-02', amount: 100 },
        { date: '2026-07-10', amount: 200 },
        { date: '2026-06-20', amount: 100 }
      ]
    }
  ], 2026, 7, new Date(2026, 6, 15))
  assert.equal(stats.monthlySaved, 300)
  assert.equal(stats.dailyAverage, 20)
  assert.equal(stats.closestPlan.remaining, 600)
  assert.equal(stats.estimatedDays, 30)
})

test('历史月份按完整自然月计算日均速度', () => {
  const stats = calculateSavingsMonthlyStats([
    { name: '目标', totalAmount: 1000, records: [{ date: '2026-06-10', amount: 300 }] }
  ], 2026, 6, new Date(2026, 6, 18))
  assert.equal(stats.elapsedDays, 30)
  assert.equal(stats.dailyAverage, 10)
})

test('完整月报聚合三类数据且 AI 提示词禁止编造和焦虑表达', () => {
  const report = buildMonthlyReport({
    moodRecords: [{ date: '2026-07-01', mood: 'good' }],
    weightRecords: [{ date: '2026-07-01', weight: 65 }],
    savedDebts: []
  }, 2026, 7, { targetWeight: 63, now: new Date(2026, 6, 18) })
  assert.equal(report.month, '2026-07')
  assert.equal(report.mood.total, 1)
  assert.equal(report.weight.targetGap, 2)

  const prompt = buildMonthlySummaryPrompt(report)
  assert.match(prompt, /不要诊断心理或身体疾病/)
  assert.match(prompt, /不制造财务焦虑/)
  assert.match(prompt, /不编造数据/)
})
