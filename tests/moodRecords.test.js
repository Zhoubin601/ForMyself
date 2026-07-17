import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  BUILT_IN_MOOD_TAGS,
  DEFAULT_MOOD_TAG,
  getCustomMoodTags,
  normalizeMoodRecord,
  normalizeMoodRecords,
  normalizeMoodTags
} from '../src/services/moodRecords.js'
import { useMoodStore } from '../src/stores/mood.js'

test('旧心情记录导入时自动补上学习标签且保留原字段', () => {
  const oldRecord = { id: '1782124966217', date: '2026-06-22', mood: 'bad', note: '旧记录' }
  assert.deepEqual(normalizeMoodRecord(oldRecord, () => 'unused'), {
    ...oldRecord,
    tags: [DEFAULT_MOOD_TAG]
  })
})

test('兼容单个 tag 字段并规范为可多选 tags 数组', () => {
  const record = normalizeMoodRecord({ id: '1', date: '2026-07-18', mood: 'good', tag: ' 工作 ' })
  assert.deepEqual(record.tags, ['工作'])
  assert.equal('tag' in record, false)
})

test('标签去空白、去重，空标签默认学习', () => {
  assert.deepEqual(normalizeMoodTags([' 家庭 ', '家庭', '', '睡眠']), ['家庭', '睡眠'])
  assert.deepEqual(normalizeMoodTags([]), ['学习'])
})

test('同一天的多个事件在规范化时全部保留', () => {
  const records = normalizeMoodRecords([
    { id: 'a', date: '2026-07-18', mood: 'good', note: '上午', tags: ['学习'] },
    { id: 'b', date: '2026-07-18', mood: 'bad', note: '晚上', tags: ['家庭'] }
  ])
  assert.equal(records.length, 2)
  assert.equal(records.filter(item => item.date === '2026-07-18').length, 2)
  assert.deepEqual(records.map(item => item.tags), [['学习'], ['家庭']])
})

test('自定义标签从导入记录和已保存列表合并且不混入内置标签', () => {
  const tags = getCustomMoodTags([
    { tags: ['工作', '运动'] },
    { tags: ['阅读', '运动'] }
  ], ['旅行'])
  assert.deepEqual(tags, ['旅行', '阅读', '运动'].sort((a, b) => a.localeCompare(b, 'zh-CN')))
  assert.ok(BUILT_IN_MOOD_TAGS.includes('学习'))
})

test('Store 在同一天连续新增时保留两条独立事件', () => {
  setActivePinia(createPinia())
  const store = useMoodStore()
  store.addRecord('2026-07-18', 'good', '上午', ['学习'])
  store.addRecord('2026-07-18', 'bad', '晚上', ['家庭'])

  const sameDay = store.getRecordsByDate('2026-07-18')
  assert.equal(sameDay.length, 2)
  assert.deepEqual(new Set(sameDay.map(item => item.note)), new Set(['上午', '晚上']))
})

test('用户补写真实事件时替换自动补记占位而不重复计数', () => {
  setActivePinia(createPinia())
  const store = useMoodStore()
  store.updateMoodRecords([{
    id: 'auto',
    date: '2026-07-17',
    mood: 'normal',
    note: '',
    tags: ['学习'],
    autoFilled: true
  }])
  store.addRecord('2026-07-17', 'great', '后来补写', ['工作'])

  const sameDay = store.getRecordsByDate('2026-07-17')
  assert.equal(sameDay.length, 1)
  assert.equal(sameDay[0].autoFilled, false)
  assert.equal(sameDay[0].note, '后来补写')
})
