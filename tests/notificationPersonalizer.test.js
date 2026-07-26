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
const referenceDate = '2026-07-18'

test('AI 开启时使用真实摘要生成并缓存关怀文案', async () => {
  let calls = 0
  const result = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: {},
    data: moodData,
    hasApiKey: true,
    referenceDate,
    ask: async prompt => {
      calls++
      assert.match(prompt, /今天工作有点累/)
      assert.match(prompt, /宝宝/)
      assert.match(prompt, /哥哥/)
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
    referenceDate,
    ask: async () => '记得照顾自己的心情。'
  })
  const second = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: first.cache,
    data: moodData,
    hasApiKey: true,
    referenceDate,
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
    referenceDate,
    ask: async () => '不应调用'
  })
  assert.equal(result.generated, 0)
  assert.deepEqual(result.bodies, {})
  assert.deepEqual(result.errors, [{ type: 'mood', code: 'MISSING_KEY' }])
})

test('数据变化后重新调用 AI 并更新缓存', async () => {
  let calls = 0
  const ask = async () => `关怀文案${++calls}`
  const first = await refreshPersonalizedReminderContent({ settings: moodSettings, cache: {}, data: moodData, hasApiKey: true, referenceDate, ask })
  const second = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: first.cache,
    data: { moodRecords: [{ date: '2026-07-19', mood: 'good', note: '今天轻松了一些' }] },
    hasApiKey: true,
    referenceDate: '2026-07-19',
    ask
  })
  assert.equal(calls, 2)
  assert.equal(second.bodies.mood, '关怀文案2')
  assert.notEqual(first.cache.mood.fingerprint, second.cache.mood.fingerprint)
})

test('个性化通知正文执行 35 字硬上限', async () => {
  const result = await refreshPersonalizedReminderContent({
    settings: moodSettings,
    cache: {},
    data: moodData,
    hasApiKey: true,
    referenceDate,
    ask: async () => '宝宝，今天也要记得认真照顾自己的感受呀，我会一直在这里陪着哥哥慢慢记录每一个心情变化。'
  })
  assert.ok(Array.from(result.bodies.mood).length <= 35)
})
