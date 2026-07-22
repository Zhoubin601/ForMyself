import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReminderNotifications,
  buildReminderSetupNotification,
  buildReminderTestNotification,
  getReminderIds,
  normalizeReminderSettings,
  normalizeReminderTime,
  REMINDER_CHANNEL_ID,
  REMINDER_SETUP_NOTIFICATION_ID,
  REMINDER_TEST_NOTIFICATION_ID
} from '../src/services/reminderSchedule.js'

test('提醒时间只接受有效的 24 小时时间', () => {
  assert.equal(normalizeReminderTime('08:05'), '08:05')
  assert.equal(normalizeReminderTime('23:59'), '23:59')
  assert.equal(normalizeReminderTime('24:00', '21:00'), '21:00')
  assert.equal(normalizeReminderTime('8:30', '21:00'), '21:00')
  assert.equal(normalizeReminderTime('', '21:00'), '21:00')
})

test('缺失或异常配置会恢复为安全默认值', () => {
  const normalized = normalizeReminderSettings({
    mood: { enabled: true, time: '25:00' },
    weight: { enabled: 'yes', time: '09:15' }
  })
  assert.deepEqual(normalized.mood, { enabled: true, time: '21:00', useAI: false })
  assert.deepEqual(normalized.weight, { enabled: false, time: '09:15', useAI: false })
  assert.deepEqual(normalized.savings, { enabled: false, time: '20:00', useAI: false })
})

test('只为已启用的类型生成每日本地通知', () => {
  const notifications = buildReminderNotifications({
    mood: { enabled: true, time: '21:30' },
    weight: { enabled: false, time: '08:00' },
    savings: { enabled: true, time: '19:45' }
  })
  assert.equal(notifications.length, 2)
  assert.deepEqual(notifications.map(item => item.id), [2101, 2103])
  assert.deepEqual(notifications[0].schedule.on, { hour: 21, minute: 30 })
  assert.deepEqual(notifications[1].schedule.on, { hour: 19, minute: 45 })
  assert.equal(notifications.every(item => item.schedule.allowWhileIdle), true)
  assert.equal(notifications.every(item => item.channelId === REMINDER_CHANNEL_ID), true)
  assert.equal(notifications.every(item => item.autoCancel === true), true)
})

test('全部关闭时不生成通知', () => {
  assert.deepEqual(buildReminderNotifications({}), [])
})

test('通知 ID 固定且互不重复，便于安全取消和重排', () => {
  const ids = getReminderIds().map(item => item.id)
  assert.deepEqual(ids, [2101, 2102, 2103])
  assert.equal(new Set(ids).size, ids.length)
})

test('只在对应 AI 开关开启且有缓存时使用个性化正文', () => {
  const notifications = buildReminderNotifications({
    mood: { enabled: true, time: '21:00', useAI: true },
    weight: { enabled: true, time: '08:00', useAI: false }
  }, {
    mood: '看见你最近有些疲惫，今晚也记得照顾自己的感受。',
    weight: '这条不应被使用'
  })
  assert.equal(notifications[0].body, '看见你最近有些疲惫，今晚也记得照顾自己的感受。')
  assert.equal(notifications[1].body, '保持相同时间记录，趋势会更有参考价值。')
})

test('测试通知使用独立 ID、通知渠道并立即投递', () => {
  const notification = buildReminderTestNotification()
  assert.equal(notification.id, REMINDER_TEST_NOTIFICATION_ID)
  assert.equal(notification.channelId, REMINDER_CHANNEL_ID)
  assert.equal(notification.schedule, undefined)
  assert.equal(notification.extra.reminderType, 'test')
})

test('保存成功通知会列出已开启的提醒和时间', () => {
  const notification = buildReminderSetupNotification({
    mood: { enabled: true, time: '21:15' },
    savings: { enabled: true, time: '20:30' }
  })
  assert.equal(notification.id, REMINDER_SETUP_NOTIFICATION_ID)
  assert.equal(notification.channelId, REMINDER_CHANNEL_ID)
  assert.match(notification.body, /心情 21:15/)
  assert.match(notification.body, /省钱 20:30/)
  assert.equal(notification.schedule, undefined)
})
