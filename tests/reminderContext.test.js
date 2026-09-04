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

test('心情摘要保留近 30 天全部真实记录并按日期分组', () => {
  const context = buildMoodReminderContext([
    { id: 'old', date: '2026-06-18', mood: 'great', note: '超过窗口' },
    { date: '2026-07-15', mood: 'normal', note: '一般' },
    { date: '2026-07-18', mood: 'bad', note: '今天工作有点累' },
    { date: '2026-07-17', mood: 'good', note: '和朋友吃饭了' },
    { date: '2026-07-16', mood: 'great', note: '完成了一件重要的事' },
    { date: '2026-07-14', mood: 'normal', note: '', autoFilled: true }
  ], '2026-07-18')
  assert.equal(context.length, 4)
  assert.equal(context[0].date, '2026-07-15')
  assert.deepEqual(context.at(-1).events[0], {
    mood: '低落',
    moodScale: '4/5（1 最积极，5 最低落）',
    tags: ['学习'],
    note: '今天工作有点累'
  })
  assert.doesNotMatch(JSON.stringify(context), /超过窗口/)
})

test('体重摘要过滤无效值并按日期正序保留完整备注', () => {
  const context = buildWeightReminderContext([
    { date: '2026-07-16', weight: 65.2 },
    { date: '2026-07-18', weight: '64.8', note: '早起测量' },
    { date: '2026-07-17', weight: 'invalid' }
  ], '2026-07-18')
  assert.deepEqual(context, [
    { date: '2026-07-16', weight: 65.2, note: '' },
    { date: '2026-07-18', weight: 64.8, note: '早起测量' }
  ])
})

test('省钱摘要优先未完成和最近有记录的计划', () => {
  const context = buildSavingsReminderContext([
    { name: '旅行', totalAmount: 1000, records: [{ date: '2026-07-18', amount: 250, note: '少点外卖' }] },
    { name: '电脑', totalAmount: 5000, isCleared: true, records: [{ date: '2026-07-19', amount: 5000 }] }
  ], '2026-07-19')
  assert.equal(context[0].name, '旅行')
  assert.equal(context[0].saved, 250)
  assert.equal(context[0].progress, 25)
  assert.equal(context[0].recentRecords[0].note, '少点外卖')
  assert.equal(context[1].completed, true)
})

test('上下文指纹只在相关数据变化时变化', () => {
  const first = buildReminderContexts({ moodRecords: [{ date: '2026-07-18', mood: 'good', note: '不错' }] }, '2026-07-18')
  const second = buildReminderContexts({ moodRecords: [{ date: '2026-07-18', mood: 'bad', note: '有点累' }] }, '2026-07-18')
  assert.notEqual(getReminderContextFingerprint(first.mood), getReminderContextFingerprint(second.mood))
})

test('提示词包含女朋友式称呼、完整上下文和关怀边界', () => {
  const prompt = buildReminderPrompt('mood', [{ date: '2026-07-18', mood: '低落', note: '工作有点累' }])
  assert.match(prompt, /工作有点累/)
  assert.match(prompt, /宝宝/)
  assert.match(prompt, /哥哥/)
  assert.match(prompt, /不诊断心理或身体疾病/)
  assert.match(prompt, /绝对不超过 35 个中文字符/)
})
