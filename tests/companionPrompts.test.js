import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  COMPANION_PERSONA_PROMPT,
  buildHomeCompanionContext,
  buildHomeCompanionPrompt,
  buildMoodEchoContext,
  buildMoodEchoPrompt,
  buildMoodHistory,
  getCompanionContextFingerprint,
  normalizeCompanionReply,
  shouldGenerateHomeCompanion
} from '../src/features/chat/companionPrompts.js'

test('近 30 天心情历史保留全部真实记录、分组同日事件并排除自动补记', () => {
  const history = buildMoodHistory([
    { id: 'outside', date: '2026-06-30', mood: 'good', note: '窗口外' },
    { id: 'inside', date: '2026-07-01', mood: 'good', note: '窗口首日' },
    { id: 'auto', date: '2026-07-20', mood: 'normal', note: '', autoFilled: true },
    { id: 'a', date: '2026-07-25', mood: 'bad', note: '上午有点累', createdAt: 1 },
    { id: 'b', date: '2026-07-25', mood: 'good', note: '晚上放松了', createdAt: 2 }
  ], '2026-07-30')

  assert.equal(history.length, 2)
  assert.equal(history[0].date, '2026-07-01')
  assert.equal(history[1].events.length, 2)
  assert.match(JSON.stringify(history), /上午有点累/)
  assert.doesNotMatch(JSON.stringify(history), /窗口外|auto/)
})

test('心情回音明确区分本次记录并排除历史中的自身重复项', () => {
  const current = { id: 'current', date: '2026-07-26', mood: 'bad', tags: ['工作'], note: '今天开会很累' }
  const context = buildMoodEchoContext([
    { id: 'past', date: '2026-07-24', mood: 'good', tags: ['工作'], note: '顺利完成方案' },
    current
  ], current)

  assert.equal(context.currentRecord.note, '今天开会很累')
  assert.equal(context.recentMoodDays.length, 1)
  assert.equal(context.recentMoodDays[0].events[0].note, '顺利完成方案')

  const prompt = buildMoodEchoPrompt(context)
  assert.match(prompt, /本次记录/)
  assert.match(prompt, /近 30 天/)
  assert.match(prompt, /今天开会很累/)
  assert.match(prompt, /绝对不超过 200 个字符/)
})

test('完整人设包含称呼切换、情绪链、跨日证据和正反边界', () => {
  assert.match(COMPANION_PERSONA_PROMPT, /女朋友式亲密感/)
  assert.match(COMPANION_PERSONA_PROMPT, /宝宝/)
  assert.match(COMPANION_PERSONA_PROMPT, /哥哥/)
  assert.match(COMPANION_PERSONA_PROMPT, /至少两个不同日期/)
  assert.match(COMPANION_PERSONA_PROMPT, /禁止照抄/)
  assert.match(COMPANION_PERSONA_PROMPT, /绝不强行积极/)
})

test('首页上下文包含三类 30 天轨迹且日期参与指纹', () => {
  const data = {
    moodRecords: [{ id: 'm1', date: '2026-07-25', mood: 'good', note: '散步很开心' }],
    weightRecords: [{ id: 'w1', date: '2026-07-24', weight: 65.2, note: '晨起' }],
    savedDebts: [{
      name: '旅行',
      totalAmount: 1000,
      records: [{ id: 's1', date: '2026-07-23', amount: 100, note: '少点外卖' }]
    }]
  }
  const first = buildHomeCompanionContext(data, '2026-07-26')
  const nextDay = buildHomeCompanionContext(data, '2026-07-27')
  assert.match(JSON.stringify(first), /散步很开心/)
  assert.match(JSON.stringify(first), /晨起/)
  assert.match(JSON.stringify(first), /少点外卖/)
  assert.notEqual(getCompanionContextFingerprint(first), getCompanionContextFingerprint(nextDay))

  const prompt = buildHomeCompanionPrompt(first)
  assert.match(prompt, /80–120 个中文字符/)
  assert.match(prompt, /不.*逐项播报/)
})

test('首页首次、跨日和历史变化时生成，同日相同上下文复用缓存', () => {
  const base = {
    cachedQuote: { text: '今天也陪着哥哥。', date: '2026-07-26' },
    storedFingerprint: 'same',
    nextFingerprint: 'same',
    referenceDate: '2026-07-26'
  }
  assert.equal(shouldGenerateHomeCompanion(base), false)
  assert.equal(shouldGenerateHomeCompanion({ ...base, cachedQuote: { text: '', date: '' } }), true)
  assert.equal(shouldGenerateHomeCompanion({ ...base, referenceDate: '2026-07-27' }), true)
  assert.equal(shouldGenerateHomeCompanion({ ...base, nextFingerprint: 'changed' }), true)
})

test('回复清理器去除引号并执行不同场景的字符硬上限', () => {
  assert.equal(normalizeCompanionReply('“宝宝，抱抱你。”', 20), '宝宝，抱抱你。')
  const clipped = normalizeCompanionReply('哥哥今天辛苦啦，我会一直认真陪着你，把每一次开心和难过都好好接住。', 18)
  assert.ok(Array.from(clipped).length <= 18)
})

test('心情界面不再使用闺蜜文案并接入共享提示词', async () => {
  const source = await readFile(new URL('../src/features/mood/MoodView.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /闺蜜正在感知/)
  assert.match(source, /buildMoodEchoContext/)
  assert.match(source, /normalizeCompanionReply\(echoText, 200\)/)
})
