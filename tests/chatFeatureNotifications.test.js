import assert from 'node:assert/strict'
import test from 'node:test'
import { syncChatProactiveNotifications } from '../src/features/chat/chatProactive.js'
import { syncChatFollowupNotifications } from '../src/features/chat/chatFollowup.js'

for (const [label, sync, id] of [
  ['主动联系', syncChatProactiveNotifications, 820000101],
  ['延迟补话', syncChatFollowupNotifications, 823000101]
]) {
  const now = new Date('2026-10-19T10:00:00Z')
  const outbox = [{ id: 'synthetic', notificationId: id, content: '合成测试消息', scheduledAt: now.getTime() + 60000 }]
  const settings = { enabled: true, followupEnabled: true }

  test(`${label}总开关关闭时仅取消已有任务，不请求权限或安排新通知`, async () => {
    const cancelled = []
    const plugin = {
      getPending: async () => ({ notifications: [{ id }, { id: 17 }] }),
      cancel: async ({ notifications }) => cancelled.push(...notifications),
      checkPermissions: async () => { assert.fail('关闭时不应请求权限') },
      schedule: async () => { assert.fail('关闭时不应安排新通知') }
    }
    const result = await sync(outbox, settings, { now, notificationPlugin: plugin, isFeatureEnabled: () => false })
    assert.equal(result.scheduled, 0)
    assert.deepEqual(cancelled, [{ id }])
  })

  test(`${label}等待系统权限期间关闭，不会在异步返回后重新安排通知`, async () => {
    let enabled = true
    const plugin = {
      getPending: async () => ({ notifications: [] }),
      checkPermissions: async () => { enabled = false; return { display: 'granted' } },
      createChannel: async () => {},
      schedule: async () => { assert.fail('不能重新安排通知') }
    }
    const result = await sync(outbox, settings, { now, platform: 'android', notificationPlugin: plugin, isFeatureEnabled: () => enabled })
    assert.equal(result.scheduled, 0)
  })

  test(`${label}排程正在提交时关闭，串行清理等待提交完成后取消`, async () => {
    let releaseSchedule
    let enteredSchedule
    const entered = new Promise(resolve => { enteredSchedule = resolve })
    let pending = []
    const plugin = {
      getPending: async () => ({ notifications: pending }),
      cancel: async () => { pending = [] },
      checkPermissions: async () => ({ display: 'granted' }),
      schedule: async ({ notifications }) => {
        enteredSchedule()
        await new Promise(resolve => { releaseSchedule = resolve })
        pending = notifications
        return { notifications }
      }
    }
    const first = sync(outbox, settings, { now, platform: 'web', notificationPlugin: plugin })
    await entered
    const cancel = sync([], settings, { now, notificationPlugin: plugin, isFeatureEnabled: () => false })
    releaseSchedule()
    await Promise.all([first, cancel])
    assert.deepEqual(pending, [])
  })
}
