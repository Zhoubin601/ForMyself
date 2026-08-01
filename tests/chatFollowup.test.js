import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_FOLLOWUP_NOTIFICATION_MIN,
  createDelayedFollowup,
  syncChatFollowupNotifications
} from '../src/services/chatFollowup.js'

test('延迟补话限制在10至90秒并过滤敏感凭据', () => {
  const now = 1_800_000_000_000
  const early = createDelayedFollowup({ sourceMessageId: 'u1', content: '对了，记得告诉我结果。', delaySeconds: 1, now })
  const late = createDelayedFollowup({ sourceMessageId: 'u2', content: '突然又想到一件小事。', delaySeconds: 999, now })
  const unsafe = createDelayedFollowup({ sourceMessageId: 'u3', content: '你的 API Key 是 sk-secret', now })

  assert.equal(early.scheduledAt, now + 10_000)
  assert.equal(late.scheduledAt, now + 90_000)
  assert.ok(early.notificationId >= CHAT_FOLLOWUP_NOTIFICATION_MIN)
  assert.equal(unsafe, null)
})

test('补话通知会取消旧任务、按深链安排，关闭后不再调度', async () => {
  const now = new Date('2026-08-01T10:00:00Z')
  const followup = createDelayedFollowup({
    sourceMessageId: 'u1',
    content: '对了，刚才那句我还想补一下。',
    delaySeconds: 30,
    now: now.getTime()
  })
  const scheduled = []
  const cancelled = []
  const plugin = {
    getPending: async () => ({ notifications: [{ id: CHAT_FOLLOWUP_NOTIFICATION_MIN + 5 }] }),
    cancel: async ({ notifications }) => cancelled.push(...notifications),
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    createChannel: async () => {},
    schedule: async ({ notifications }) => {
      scheduled.push(...notifications)
      return { notifications }
    }
  }

  const result = await syncChatFollowupNotifications([followup], { followupEnabled: true }, {
    notificationPlugin: plugin,
    platform: 'android',
    now
  })
  assert.equal(cancelled.length, 1)
  assert.equal(result.scheduled, 1)
  assert.match(scheduled[0].extra.url, /formyself:\/\/open\/chat\?proactive=followup-/)

  scheduled.length = 0
  const disabled = await syncChatFollowupNotifications([followup], { followupEnabled: false }, {
    notificationPlugin: plugin,
    platform: 'android',
    now
  })
  assert.equal(disabled.scheduled, 0)
  assert.equal(scheduled.length, 0)
})
