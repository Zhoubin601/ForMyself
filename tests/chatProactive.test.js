import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSpecificOpenLoopFollowup,
  buildProactivePrompt,
  buildProactiveSlots,
  generateProactiveOutbox,
  shouldCreateSmartEntry,
  syncChatProactiveNotifications
} from '../src/services/chatProactive.js'

const at = value => new Date(value).getTime()

test('六小时内反复进入不重复说话，跨日或久别才生成智能主动消息', () => {
  const now = new Date('2026-07-27T20:00:00+08:00')
  assert.equal(shouldCreateSmartEntry({
    messages: [{ role: 'assistant', content: '刚聊完', createdAt: at('2026-07-27T18:30:00+08:00') }],
    now
  }), false)
  assert.equal(shouldCreateSmartEntry({
    messages: [{ role: 'assistant', content: '隔了很久', createdAt: at('2026-07-27T12:00:00+08:00') }],
    now
  }), true)
  assert.equal(shouldCreateSmartEntry({
    messages: [{ role: 'assistant', content: '昨天聊过', createdAt: at('2026-07-26T23:50:00+08:00') }],
    now: new Date('2026-07-27T00:10:00+08:00')
  }), true)
})

test('表情回应也属于近期聊天活动，会抑制两小时内主动打扰', () => {
  const now = new Date('2026-07-27T20:00:00+08:00')
  assert.equal(shouldCreateSmartEntry({
    messages: [{
      role: 'assistant',
      content: '在这里',
      createdAt: at('2026-07-27T12:00:00+08:00'),
      reactions: [{ actor: 'user', emoji: '❤️', createdAt: at('2026-07-27T19:00:00+08:00') }]
    }],
    now
  }), false)
})

test('第一条未回应时当天不追发，刚聊过两小时内也不安排', () => {
  const now = new Date('2026-07-27T12:00:00+08:00')
  const firstAt = at('2026-07-27T10:00:00+08:00')
  const slots = buildProactiveSlots({
    settings: { enabled: true, dailyMin: 2, dailyMax: 2, activeStart: '09:00', activeEnd: '23:00' },
    messages: [{
      id: 'p1',
      role: 'assistant',
      origin: 'proactive',
      proactiveId: 'proactive-2026-07-27-1',
      content: '想你啦',
      createdAt: firstAt
    }],
    openLoops: [{ key: 'later', content: '晚点继续聊' }],
    now,
    days: 1
  })

  assert.equal(slots.some(item => item.sequence === 2), false)
  assert.ok(slots.every(item => item.scheduledAt >= firstAt + 2 * 60 * 60 * 1000))
})

test('哥哥回应过第一条且仍有未完话题时才允许当天第二条', () => {
  const slots = buildProactiveSlots({
    settings: { enabled: true, dailyMin: 2, dailyMax: 2, activeStart: '09:00', activeEnd: '23:00' },
    messages: [
      {
        id: 'p1',
        role: 'assistant',
        origin: 'proactive',
        proactiveId: 'proactive-2026-07-27-1',
        content: '想你啦',
        createdAt: at('2026-07-27T10:00:00+08:00')
      },
      { id: 'u1', role: 'user', content: '我也想你', createdAt: at('2026-07-27T10:30:00+08:00') }
    ],
    openLoops: [{ key: 'later', content: '晚点继续聊' }],
    now: new Date('2026-07-27T12:00:00+08:00'),
    days: 1
  })

  assert.equal(slots.filter(item => item.sequence === 2).length, 1)
})

test('未来七天多数第一条主动联系以想哥哥为原因', () => {
  const slots = buildProactiveSlots({
    settings: { enabled: true, dailyMin: 1, dailyMax: 1, activeStart: '09:00', activeEnd: '23:00' },
    now: new Date('2026-07-27T09:00:00+08:00'),
    days: 7
  })
  const primary = slots.filter(item => item.sequence === 1)
  const missingYou = primary.filter(item => item.reason === 'missing-you')

  assert.equal(primary.length, 7)
  assert.ok(missingYou.length >= 4)
  assert.match(buildProactivePrompt({ slots }), /reason=missing-you/)
  assert.match(buildProactivePrompt({ slots }), /约六成/)
  assert.match(buildProactivePrompt({ slots }), /约一半自然带一个/)
  assert.match(buildProactivePrompt({ slots }), /偶尔用一个简短颜文字替代 emoji/)
})

test('想念原因离线兜底会直接表达想哥哥且不制造回复压力', async () => {
  const outbox = await generateProactiveOutbox({
    slots: [{
      slotKey: '2026-07-28:1',
      dayKey: '2026-07-28',
      sequence: 1,
      reason: 'missing-you',
      scheduledAt: at('2026-07-28T15:00:00+08:00'),
      notificationId: 820000102
    }],
    companionName: '小暖',
    now: new Date('2026-07-27T12:00:00+08:00'),
    ask: async () => { throw new Error('offline') }
  })

  assert.match(outbox[0].content, /想|黏/)
  assert.match(outbox[0].content, /[🥺💕❤️]/u)
  assert.doesNotMatch(outbox[0].content, /为什么不理|必须回|不爱我/)
})

test('主动文案生成失败会使用本地短消息，且通知正文限制为 35 字', async () => {
  const now = new Date('2026-07-27T12:00:00+08:00')
  const slots = [{
    slotKey: '2026-07-27:1',
    dayKey: '2026-07-27',
    sequence: 1,
    reason: 'daily',
    scheduledAt: at('2026-07-27T15:00:00+08:00'),
    notificationId: 820000101
  }]
  const outbox = await generateProactiveOutbox({
    slots,
    companionName: '小暖',
    state: { mood: '想念', currentThought: '想听哥哥说说今天发生的事情' },
    now,
    ask: async () => { throw new Error('offline') }
  })
  const scheduled = []
  const plugin = {
    getPending: async () => ({ notifications: [] }),
    checkPermissions: async () => ({ display: 'granted' }),
    createChannel: async () => {},
    schedule: async ({ notifications }) => {
      scheduled.push(...notifications)
      return { notifications }
    },
    cancel: async () => {}
  }

  const result = await syncChatProactiveNotifications(outbox, { enabled: true }, {
    notificationPlugin: plugin,
    platform: 'android',
    now
  })

  assert.equal(result.scheduled, 1)
  assert.ok(Array.from(scheduled[0].body).length <= 35)
  assert.match(scheduled[0].extra.url, /formyself:\/\/open\/chat/)
})

test('第二条主动消息必须点明未完话题，模糊话题直接跳过', async () => {
  assert.equal(buildSpecificOpenLoopFollowup({ content: '那件事' }), '')
  assert.match(
    buildSpecificOpenLoopFollowup({ content: '哥哥还没回答周末要不要一起看电影。' }),
    /周末要不要一起看电影/
  )

  const outbox = await generateProactiveOutbox({
    slots: [{
      slotKey: '2026-07-29:2',
      dayKey: '2026-07-29',
      sequence: 2,
      reason: 'follow-up',
      scheduledAt: at('2026-07-29T20:00:00+08:00'),
      notificationId: 820000202
    }],
    openLoops: [{ content: '那件事' }],
    ask: async () => ({ messages: [] }),
    now: new Date('2026-07-29T12:00:00+08:00')
  })

  assert.deepEqual(outbox, [])
})
