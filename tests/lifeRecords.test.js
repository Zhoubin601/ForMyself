import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { sortWeightRecords, filterWeightRange, calculateDailyAverages, calculateWeeklyAverages, calculateWeightChangeNotice } from '../src/services/weightInsights.js'
import { useWeightStore } from '../src/stores/weight.js'
import { useMoodStore } from '../src/features/mood/moodStore.js'
import { buildMoodBackupSnapshot, normalizeMoodBackupSnapshot, normalizeMoodDefinitions } from '../src/features/mood/moodRecords.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'
import { buildHomeWidgetSnapshot } from '../src/services/homeWidgetSnapshot.js'
import { calculateWeightMonthlyStats } from '../src/services/monthlyReport.js'
import { buildWeightReminderContext } from '../src/services/reminderContext.js'
import { normalizeCommonNotes } from '../src/services/commonNotes.js'

const weights = [
  { id: 'late', date: '2026-09-08', time: '20:00', weight: 65 },
  { id: 'early', date: '2026-09-08', time: '08:00', weight: 64 },
  { id: 'old', date: '2026-09-08', weight: 63 },
  { id: 'old2', date: '2026-09-08', weight: 62 }
]
test('默认优先级迁移一次且保留自定义和主动清零', () => {
  const legacy = normalizeMoodDefinitions().map(({ priorityDefaultsVersion: _version, ...item }) => ({ ...item, displayPriority: 0 }))
  assert.deepEqual(normalizeMoodDefinitions(legacy).map(d => d.displayPriority), [50, 40, 30, 20, 10])
  legacy[0].displayPriority = 88
  assert.deepEqual(normalizeMoodDefinitions(legacy).map(d => d.displayPriority), [88, 0, 0, 0, 0])
  const cleared = normalizeMoodDefinitions().map(item => ({ ...item, displayPriority: 0 }))
  assert.deepEqual(normalizeMoodDefinitions(cleared).map(d => d.displayPriority), [0, 0, 0, 0, 0])
})
test('体重多次记录统一使用日期、有效时间及原数组顺序', () => {
  assert.deepEqual(sortWeightRecords(weights).map(r => r.id), ['late', 'early', 'old2', 'old'])
  assert.equal(buildHomeWidgetSnapshot({ weightRecords: weights }).weightText, '65 kg')
  assert.equal(calculateWeightMonthlyStats(weights, 2026, 9).latest.weight, 65)
  assert.equal(buildWeightReminderContext(weights, new Date(2026, 8, 9)).at(-1).weight, 65)
  assert.equal(calculateWeightChangeNotice(weights, { id: 'mid', date: '2026-09-08', time: '12:00', weight: 66 }).diff, 2)
})
test('体重跨月范围使用本地日期，周均先平均每天', () => {
  const records = [{ date: '2026-08-31', weight: 60 }, { date: '2026-09-01', weight: 66 }, { date: '2026-09-01', weight: 68 }]
  assert.equal(filterWeightRange(records, 1, new Date(2026, 8, 1, 0, 1)).length, 2)
  assert.equal(filterWeightRange(records, 7, new Date(2026, 8, 1)).length, 3)
  assert.deepEqual(calculateDailyAverages(records).map(r => [r.weight, r.count]), [[60, 1], [67, 2]])
  assert.equal(calculateWeeklyAverages(records)[0].average, 63.5)
})
test('体重按 ID 编辑保留其他记录，清空时间后按旧记录显示', () => {
  setActivePinia(createPinia()); const store = useWeightStore()
  store.updateWeightRecords(weights.map(r => ({ ...r })))
  store.updateRecord('late', { date: '2026-08-31', time: '', note: '补录' })
  assert.equal(store.weightRecords.length, 4)
  assert.equal(sortWeightRecords(store.weightRecords)[0].id, 'early')
  assert.equal(store.updateRecord('missing', {}), false)
})
test('心情显示优先级独立于等级，手动优先且同级最新在前', () => {
  setActivePinia(createPinia()); const store = useMoodStore()
  store.updateMoodRecords([
    { id: 'auto', date: '2026-09-08', mood: 'normal', createdAt: 999, autoFilled: true },
    { id: 'a', date: '2026-09-08', mood: 'bad', createdAt: 1 },
    { id: 'b', date: '2026-09-08', mood: 'good', createdAt: 3 },
    { id: 'c', date: '2026-09-08', mood: 'bad', createdAt: 2 }
  ])
  const definition = store.getMoodDefinition('bad')
  store.updateMoodDefinition('bad', { ...definition, displayPriority: 90 })
  assert.deepEqual(store.getDayDisplayRecords('2026-09-08').map(r => r.id), ['c', 'a', 'b', 'auto'])
  assert.equal(store.getMoodDefinition('bad').order, definition.order)
  assert.equal(store.updateMoodDefinition('bad', { ...definition, displayPriority: 1.5 }).ok, false)
  store.updateRecord('a', { note: '编辑不改变时间' })
  assert.equal(store.moodRecords.find(r => r.id === 'a').createdAt, 1)
  store.deleteRecord('c')
  assert.equal(store.getDayDisplayRecords('2026-09-08')[0].id, 'a')
  assert.deepEqual(normalizeMoodDefinitions().map(d => d.displayPriority), [50, 40, 30, 20, 10])
})
test('预设改名同步历史和默认勾选，清空默认不改旧日记', () => {
  setActivePinia(createPinia()); const store = useMoodStore()
  store.addRecord('2026-09-08', 'normal', '正文保持')
  assert.equal(store.renameTag('学习', '成长'), true)
  assert.deepEqual(store.defaultTags, ['成长'])
  assert.deepEqual(store.moodRecords[0].tags, ['成长'])
  assert.equal(store.moodRecords[0].note, '正文保持')
  assert.equal(store.renameTag('成长', '工作'), false)
  store.setDefaultTags([])
  assert.deepEqual(store.addRecord('2026-09-09').tags, [])
  assert.deepEqual(store.moodRecords[0].tags, ['成长'])
  assert.ok(!store.builtInTags.includes('学习'))
})
test('新版全量及心情备份保留空默认、改名目录、优先级与体重时间', () => {
  const definitions = normalizeMoodDefinitions().map(d => ({ ...d, displayPriority: 12 }))
  const metadata = { builtInTags: ['成长'], defaultTags: [], definitions }
  const mood = [{ id: 'a', date: '2026-09-08', mood: 'normal', tags: [] }]
  const full = normalizeFullBackupSnapshot(buildFullBackupSnapshot({ weight: weights, mood, moodMetadata: metadata, settings: { commonNotes: { weight: [' 空腹 ', '空腹'], savings: ['少喝奶茶'] } } }))
  assert.equal(full.version, 8)
  assert.deepEqual(full.metadata.mood.defaultTags, [])
  assert.deepEqual(full.metadata.mood.builtInTags, ['成长'])
  assert.deepEqual(full.data.mood[0].tags, [])
  assert.equal(full.data.weight[0].time, '20:00')
  assert.deepEqual(full.settings.commonNotes.weight, ['空腹'])
  const single = normalizeMoodBackupSnapshot(buildMoodBackupSnapshot({ records: mood, ...metadata }))
  assert.equal(single.version, 2)
  assert.equal(single.metadata.definitions[0].displayPriority, 12)
  assert.deepEqual(single.metadata.defaultTags, [])
  const legacy = { ...single, version: 1, metadata: {} }
  assert.deepEqual(normalizeMoodBackupSnapshot(legacy).metadata.defaultTags, ['学习'])
  assert.equal(normalizeFullBackupSnapshot({ ...full, version: 7 }).version, 8)
  assert.deepEqual(normalizeCommonNotes(), { weight: [], savings: [] })
})
