import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScheduleNotifications,
  buildScheduleWidgetSnapshot,
  countScheduleCategoryUsage,
  generateOccurrences,
  normalizeScheduleData
} from '../src/services/scheduleCore.js'

const now = new Date('2026-07-24T08:00:00')

test('常用重复规则生成稳定 occurrence，月末自动落在最后一天', () => {
  const data = normalizeScheduleData({
    series: [
      {
        id: 'monthly',
        title: '月末复盘',
        startDate: '2026-01-31',
        startTime: '20:00',
        endDate: '2026-01-31',
        endTime: '21:00',
        recurrence: { type: 'monthly' }
      },
      {
        id: 'weekly',
        title: '周例会',
        startDate: '2026-07-20',
        recurrence: { type: 'weekly', weekdays: [1, 5] }
      }
    ]
  })
  const monthEnd = generateOccurrences(data, '2026-02-01', '2026-02-28', new Date('2026-02-01T00:00:00'))
  assert.equal(monthEnd.find(item => item.seriesId === 'monthly')?.occurrenceDate, '2026-02-28')
  const weekly = generateOccurrences(data, '2026-07-20', '2026-07-26', new Date('2026-07-20T00:00:00'))
    .filter(item => item.seriesId === 'weekly')
  assert.deepEqual(weekly.map(item => item.occurrenceDate), ['2026-07-20', '2026-07-24'])
})

test('自定义每几天按手动输入的间隔生成日程', () => {
  const data = normalizeScheduleData({
    series: [{
      id: 'custom-days',
      title: '隔三天整理',
      startDate: '2026-07-24',
      recurrence: { type: 'custom', intervalDays: 3 }
    }]
  })
  const items = generateOccurrences(data, '2026-07-24', '2026-08-02', now)
  assert.deepEqual(items.map(item => item.occurrenceDate), [
    '2026-07-24',
    '2026-07-27',
    '2026-07-30',
    '2026-08-02'
  ])
})

test('日程标签只预设学习，其余分类保留用户手动添加项', () => {
  const data = normalizeScheduleData({
    categories: [
      { id: 'life', name: '生活', color: '#4fd5d7', icon: '⌂', builtIn: true },
      { id: 'custom-reading', name: '阅读', color: '#4d8df7', icon: '★', builtIn: false }
    ]
  })
  assert.deepEqual(data.categories.map(item => item.name), ['学习', '阅读'])
  assert.equal(data.categories.some(item => Object.hasOwn(item, 'icon')), false)
})

test('完成状态只影响当前 occurrence，后续重复事项保持待办', () => {
  const data = normalizeScheduleData({
    series: [{
      id: 'daily',
      type: 'task',
      title: '喝水',
      startDate: '2026-07-24',
      startTime: '09:00',
      endTime: '09:30',
      recurrence: { type: 'daily' }
    }],
    occurrences: [{
      key: 'daily@2026-07-24',
      seriesId: 'daily',
      originalDate: '2026-07-24',
      status: 'completed',
      completedAt: now.getTime()
    }]
  })
  const items = generateOccurrences(data, '2026-07-24', '2026-07-25', now)
  assert.equal(items[0].completed, true)
  assert.equal(items[1].completed, false)
})

test('通知和组件快照只包含未过期事项并使用独立稳定 ID', () => {
  const data = normalizeScheduleData({
    series: [{
      id: 'meeting',
      title: '项目沟通',
      startDate: '2026-07-24',
      startTime: '10:00',
      endTime: '11:00',
      reminderOffset: 10,
      reminderMode: 'alarm'
    }]
  })
  const notifications = buildScheduleNotifications(data, now)
  assert.equal(notifications.length, 1)
  assert.ok(notifications[0].id >= 300000000)
  assert.equal(data.series[0].reminderMode, 'notification')
  assert.equal(notifications[0].channelId, 'formyself-schedule-notification-v1')
  assert.equal(notifications[0].extra.occurrenceKey, 'meeting@2026-07-24')

  const snapshot = buildScheduleWidgetSnapshot(data, now)
  assert.equal(snapshot.occurrences[0].title, '项目沟通')
  assert.equal(snapshot.occurrences[0].time, '10:00')
})

test('已到点的提醒不会在应用恢复重校准时再次安排', () => {
  const current = new Date('2026-07-24T10:00:30+08:00')
  const data = normalizeScheduleData({
    series: [{
      id: 'same-minute',
      title: '当前分钟提醒',
      startDate: '2026-07-24',
      startTime: '10:00',
      endTime: '11:00',
      reminderOffset: 0
    }]
  })
  const notifications = buildScheduleNotifications(data, current)
  assert.equal(notifications.length, 0)
})

test('日程标签只有完全未使用时才可删除', () => {
  const data = normalizeScheduleData({
    categories: [{ id: 'work', name: '工作', color: '#009688' }],
    series: [{
      id: 'work-series',
      title: '项目沟通',
      categoryId: 'work',
      startDate: '2026-07-24'
    }],
    occurrences: [{
      key: 'study@2026-07-25',
      seriesId: 'study',
      originalDate: '2026-07-25',
      status: 'override',
      override: { categoryId: 'work' }
    }]
  })
  assert.equal(countScheduleCategoryUsage(data, 'work'), 2)
  assert.equal(countScheduleCategoryUsage(data, 'unused'), 0)
})
