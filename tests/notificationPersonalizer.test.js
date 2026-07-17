import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshPersonalizedReminderContentCore as refreshPersonalizedReminderContent } from '../src/services/notificationPersonalizerCore.js'

const moodSettings = {
  mood: { enabled: true, time: '21:00', useAI: true },
  weight: { enabled: false, time: '08:00', useAI: false },
  savings: { enabled: false, time: '20:00', useAI: false }
}

const moodData = {
  moodRecords: [{ date: '2026-07-18', mood: 'bad', note: '今天工作有点累' }]
}

test('AI 开启时使用真实摘要生成并缓存关怀文案', async () => {
  let calls = 0
  const result = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: {},
    data: moodData,
    hasApiKey: true,
    ask: async prompt => {
      calls++
      assert.match(prompt, /今天工作有点累/)
      return '“辛苦啦，今晚也给自己的感受留一点空间。”'
    }
  })
  assert.equal(calls, 1)
  assert.equal(result.generated, 1)
  assert.equal(result.bodies.mood, '辛苦啦，今晚也给自己的感受留一点空间。')
  assert.ok(result.cache.mood.fingerprint)
})

test('数据指纹未变化时复用缓存且不调用 API', async () => {
  const first = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: {},
    data: moodData,
    hasApiKey: true,
    ask: async () => '记得照顾自己的心情。'
  })
  const second = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: first.cache,
    data: moodData,
    hasApiKey: true,
    ask: async () => { throw new Error('不应再次调用') }
  })
  assert.equal(second.generated, 0)
  assert.equal(second.errors.length, 0)
  assert.equal(second.bodies.mood, '记得照顾自己的心情。')
})

test('缺少 API Key 时报告错误并允许通知层回退默认文案', async () => {
  const result = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: {},
    data: moodData,
    hasApiKey: false,
    ask: async () => '不应调用'
  })
  assert.equal(result.generated, 0)
  assert.deepEqual(result.bodies, {})
  assert.deepEqual(result.errors, [{ type: 'mood', code: 'MISSING_KEY' }])
})

test('数据变化后重新调用 AI 并更新缓存', async () => {
  let calls = 0
  const ask = async () => `关怀文案${++calls}`
  const first = await refreshPersonalizedReminderContent({ settings: moodSettings, cache: {}, data: moodData, hasApiKey: true, ask })
  const second = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: first.cache,
    data: { moodRecords: [{ date: '2026-07-19', mood: 'good', note: '今天轻松了一些' }] },
    hasApiKey: true,
    ask
  })
  assert.equal(calls, 2)
  assert.equal(second.bodies.mood, '关怀文案2')
  assert.notEqual(first.cache.mood.fingerprint, second.cache.mood.fingerprint)
})
