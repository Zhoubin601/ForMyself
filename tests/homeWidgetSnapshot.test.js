import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HOME_WIDGET_SNAPSHOT_VERSION,
  buildHomeWidgetSnapshot
} from '../src/services/homeWidgetSnapshot.js'

test('桌面组件快照采用版本化、可直接渲染的协议', () => {
  const now = new Date(2026, 8, 4, 12)
  const snapshot = buildHomeWidgetSnapshot({
    moodRecords: [{ mood: 'good', date: '2026-09-04', createdAt: 1 }],
    moodDefinitions: [{ id: 'good', label: '开心' }],
    weightRecords: [{ weight: 62.5, date: '2026-09-04', createdAt: 1 }],
    savedDebts: [{ totalAmount: 2000, records: [{ amount: 1200, date: '2026-09-04' }] }]
  }, now)
  assert.deepEqual(snapshot, {
    version: HOME_WIDGET_SNAPSHOT_VERSION,
    generatedAt: now.getTime(),
    today: '2026-09-04',
    moodText: '开心',
    weightText: '62.5 kg',
    savingsText: '60%',
    todayCount: 3
  })
})

test('桌面组件快照为空数据提供稳定默认值', () => {
  const snapshot = buildHomeWidgetSnapshot({}, new Date(2026, 8, 4, 12))
  assert.equal(snapshot.moodText, '未记录')
  assert.equal(snapshot.weightText, '暂无')
  assert.equal(snapshot.savingsText, '暂无')
  assert.equal(snapshot.todayCount, 0)
})
