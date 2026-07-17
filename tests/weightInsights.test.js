import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeightChangeNotification,
  calculateBmi,
  calculateWeeklyAverages,
  calculateWeightChangeNotice,
  normalizeHealthSettings
} from '../src/services/weightInsights.js'

test('旧健康设置只含目标体重时补齐身高和变化提醒默认值', () => {
  assert.deepEqual(normalizeHealthSettings({ targetWeight: 60 }), {
    heightCm: null,
    targetWeight: 60,
    weightChangeReminderEnabled: true,
    weightChangeThreshold: 1
  })
})

test('异常健康设置恢复为安全范围', () => {
  assert.deepEqual(normalizeHealthSettings({
    heightCm: 20,
    targetWeight: 999,
    weightChangeReminderEnabled: false,
    weightChangeThreshold: 0
  }), {
    heightCm: null,
    targetWeight: null,
    weightChangeReminderEnabled: false,
    weightChangeThreshold: 1
  })
})

test('根据最新体重和身高计算 BMI', () => {
  assert.deepEqual(calculateBmi(65, 170), { value: 22.5, label: '正常范围' })
  assert.equal(calculateBmi(65, null), null)
})

test('周平均先合并同一天多次称重，避免重复记录加权', () => {
  const result = calculateWeeklyAverages([
    { date: '2026-07-06', weight: 70 },
    { date: '2026-07-06', weight: 72 },
    { date: '2026-07-08', weight: 69 },
    { date: '2026-07-13', weight: 68 }
  ])
  assert.deepEqual(result, [
    { weekStart: '2026-07-06', weekEnd: '2026-07-12', average: 70, days: 2, change: null },
    { weekStart: '2026-07-13', weekEnd: '2026-07-19', average: 68, days: 1, change: -2 }
  ])
})

test('周平均忽略不存在的日期，变化提醒优先比较同日最后一条记录', () => {
  assert.deepEqual(calculateWeeklyAverages([{ date: '2026-02-31', weight: 70 }]), [])
  const notice = calculateWeightChangeNotice([
    { date: '2026-07-18', weight: 65 },
    { date: '2026-07-18', weight: 66 }
  ], { date: '2026-07-18', weight: 67.2 }, 1)
  assert.equal(notice.diff, 1.2)
})

test('达到阈值才生成温和的体重变化提醒', () => {
  const records = [{ date: '2026-07-17', weight: 65 }]
  assert.equal(calculateWeightChangeNotice(records, { date: '2026-07-18', weight: 65.4 }, 1), null)
  const notice = calculateWeightChangeNotice(records, { date: '2026-07-18', weight: 66.2 }, 1)
  assert.equal(notice.diff, 1.2)
  assert.equal(notice.direction, '上升')
  assert.match(notice.body, /周平均趋势/)
})

test('变化提醒通知使用独立固定 ID 且不包含诊断措辞', () => {
  const at = new Date('2026-07-18T08:00:00Z')
  const notice = calculateWeightChangeNotice(
    [{ date: '2026-07-17', weight: 65 }],
    { date: '2026-07-18', weight: 63.5 },
    1
  )
  const notification = buildWeightChangeNotification(notice, at)
  assert.equal(notification.id, 2201)
  assert.equal(notification.schedule.at, at)
  assert.equal(notification.extra.reminderType, 'weight-change')
  assert.doesNotMatch(notification.body, /疾病|诊断/)
})
