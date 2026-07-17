import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMoodReminderContext,
  buildReminderContexts,
  buildReminderPrompt,
  buildSavingsReminderContext,
  buildWeightReminderContext,
  getReminderContextFingerprint
} from '../src/services/reminderContext.js'

test('心情摘要只取最近三条并保留日记文字', () => {
  const context = buildMoodReminderContext([
    { date: '2026-07-15', mood: 'normal', note: '一般' },
    { date: '2026-07-18', mood: 'bad', note: '今天工作有点累' },
    { date: '2026-07-17', mood: 'good', note: '和朋友吃饭了' },
    { date: '2026-07-16', mood: 'great', note: '完成了一件重要的事' }
  ])
  assert.equal(context.length, 3)
  assert.deepEqual(context[0], { date: '2026-07-18', mood: '低落', note: '今天工作有点累' })
  assert.equal(context[2].date, '2026-07-16')
})

test('体重摘要过滤无效值并按日期倒序', () => {
  const context = buildWeightReminderContext([
    { date: '2026-07-16', weight: 65.2 },
    { date: '2026-07-18', weight: '64.8', note: '早起测量' },
    { date: '2026-07-17', weight: 'invalid' }
  ])
  assert.deepEqual(context, [
    { date: '2026-07-18', weight: 64.8, note: '早起测量' },
    { date: '2026-07-16', weight: 65.2, note: '' }
  ])
})

test('省钱摘要优先未完成和最近有记录的计划', () => {
  const context = buildSavingsReminderContext([
    { name: '旅行', totalAmount: 1000, records: [{ date: '2026-07-18', amount: 250, note: '少点外卖' }] },
    { name: '电脑', totalAmount: 5000, isCleared: true, records: [{ date: '2026-07-19', amount: 5000 }] }
  ])
  assert.equal(context[0].name, '旅行')
  assert.equal(context[0].saved, 250)
  assert.equal(context[0].progress, 25)
  assert.equal(context[1].completed, true)
})

test('上下文指纹只在相关数据变化时变化', () => {
  const first = buildReminderContexts({ moodRecords: [{ date: '2026-07-18', mood: 'good', note: '不错' }] })
  const second = buildReminderContexts({ moodRecords: [{ date: '2026-07-18', mood: 'bad', note: '有点累' }] })
  assert.notEqual(getReminderContextFingerprint(first.mood), getReminderContextFingerprint(second.mood))
})

test('提示词明确关怀边界并包含真实上下文', () => {
  const prompt = buildReminderPrompt('mood', [{ date: '2026-07-18', mood: '低落', note: '工作有点累' }])
  assert.match(prompt, /工作有点累/)
  assert.match(prompt, /不要诊断心理疾病/)
  assert.match(prompt, /35字以内/)
})
