import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getReminderNotificationStatus,
  sendReminderSetupConfirmation,
  sendReminderTestNotification,
  syncReminderNotifications
} from '../src/services/notificationService.js'
import {
  REMINDER_CHANNEL_ID,
  REMINDER_SETUP_NOTIFICATION_ID,
  REMINDER_TEST_NOTIFICATION_ID
} from '../src/services/reminderSchedule.js'

function createNotificationPlugin({ permission = 'granted' } = {}) {
  let displayPermission = permission
  let pending = []
  const calls = []
  return {
    calls,
    async checkPermissions() { calls.push('checkPermissions'); return { display: displayPermission } },
    async requestPermissions() { calls.push('requestPermissions'); displayPermission = 'granted'; return { display: displayPermission } },
    async createChannel(channel) { calls.push(['createChannel', channel]); },
    async schedule({ notifications }) {
      calls.push(['schedule', notifications])
      for (const notification of notifications) {
        pending = [...pending.filter(item => item.id !== notification.id), notification]
      }
      return { notifications: notifications.map(item => ({ id: item.id })) }
    },
    async cancel({ notifications }) {
      calls.push(['cancel', notifications])
      const ids = new Set(notifications.map(item => item.id))
      pending = pending.filter(item => !ids.has(item.id))
    },
    async getPending() { calls.push('getPending'); return { notifications: pending } },
    async checkExactNotificationSetting() { return { exact_alarm: 'denied' } }
  }
}

test('每日提醒会先申请权限、创建 Android 渠道并校验系统待处理任务', async () => {
  const plugin = createNotificationPlugin({ permission: 'prompt' })
  const result = await syncReminderNotifications({
    mood: { enabled: true, time: '21:00' },
    weight: { enabled: false, time: '08:00' },
    savings: { enabled: true, time: '20:30' }
  }, { requestPermission: true, notificationPlugin: plugin, platform: 'android' })

  assert.equal(result.scheduled, 2)
  assert.equal(result.pending, 2)
  assert.ok(plugin.calls.includes('requestPermissions'))
  const channel = plugin.calls.find(item => Array.isArray(item) && item[0] === 'createChannel')[1]
  assert.equal(channel.id, REMINDER_CHANNEL_ID)
  assert.equal(channel.importance, 4)
})

test('权限被拒绝时不会先删除原有提醒', async () => {
  const plugin = createNotificationPlugin({ permission: 'denied' })
  await assert.rejects(
    syncReminderNotifications({ mood: { enabled: true, time: '21:00' } }, {
      requestPermission: false,
      notificationPlugin: plugin,
      platform: 'android'
    }),
    error => error.code === 'NOTIFICATION_PERMISSION_DENIED'
  )
  assert.equal(plugin.calls.some(item => Array.isArray(item) && item[0] === 'cancel'), false)
})

test('立即测试通知使用独立 ID 且真实调用通知插件', async () => {
  const plugin = createNotificationPlugin({ permission: 'granted' })
  const result = await sendReminderTestNotification({ notificationPlugin: plugin, platform: 'android' })
  assert.equal(result.sent, true)
  const scheduled = plugin.calls.find(item => Array.isArray(item) && item[0] === 'schedule')[1]
  assert.equal(scheduled[0].id, REMINDER_TEST_NOTIFICATION_ID)
  assert.equal(scheduled[0].schedule, undefined)
})

test('每日提醒设置成功后立即发送确认通知', async () => {
  const plugin = createNotificationPlugin({ permission: 'granted' })
  const result = await sendReminderSetupConfirmation({
    mood: { enabled: true, time: '21:00' },
    weight: { enabled: true, time: '08:00' }
  }, { notificationPlugin: plugin, platform: 'android' })
  assert.equal(result.sent, true)
  const scheduled = plugin.calls.find(item => Array.isArray(item) && item[0] === 'schedule')[1]
  assert.equal(scheduled[0].id, REMINDER_SETUP_NOTIFICATION_ID)
  assert.match(scheduled[0].body, /已开启 2 项提醒/)
})

test('通知状态返回权限、系统待处理任务和精确闹钟状态', async () => {
  const plugin = createNotificationPlugin({ permission: 'granted' })
  await syncReminderNotifications({ weight: { enabled: true, time: '08:05' } }, {
    notificationPlugin: plugin,
    platform: 'android'
  })
  const status = await getReminderNotificationStatus({ notificationPlugin: plugin, platform: 'android' })
  assert.equal(status.permission, 'granted')
  assert.equal(status.pending.length, 1)
  assert.equal(status.exactAlarm, 'denied')
})
