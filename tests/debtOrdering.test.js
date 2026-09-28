import test from 'node:test'
import assert from 'node:assert/strict'
import { arrangeDebtRecords, normalizeDebtGroups, reorderDebtRecords, getSavingsProgress } from '../src/services/debtOrdering.js'

test('省钱排序只替换当前分类位置，保留对象及备份顺序', () => {
  const records = [{ id: 'a' }, { id: 'done', isCleared: true }, { id: 'b' }, { id: 'c' }]
  const next = reorderDebtRecords(records, { orderedIds: ['c', 'a', 'b'], isCleared: false })
  assert.deepEqual(next.map(item => item.id), ['c', 'done', 'a', 'b'])
  assert.equal(next[0], records[3])
  assert.equal(next[1], records[1])
  assert.deepEqual(JSON.parse(JSON.stringify(next)).map(item => item.id), ['c', 'done', 'a', 'b'])
  assert.deepEqual(records.map(item => item.id), ['a', 'done', 'b', 'c'])
})

test('省钱排序拒绝缺项、重复、跨分类及过期成员', () => {
  const records = [{ id: 'a' }, { id: 'b' }, { id: 'done', isCleared: true }]
  for (const orderedIds of [['a'], ['a', 'a'], ['done', 'a'], ['a', 'deleted']]) {
    assert.throws(() => reorderDebtRecords(records, { orderedIds, isCleared: false }))
  }
  assert.throws(() => reorderDebtRecords([{ id: 'a' }, { id: 'a' }], { orderedIds: ['a', 'a'], isCleared: false }))
})

test('金额进度来自存入记录，兼容零目标、缺失记录及超额完成', () => {
  assert.deepEqual(getSavingsProgress({ totalAmount: 50, remainingAmount: 99, records: [{ amount: 8 }] }), { saved: 8, target: 50, remaining: 42, percent: 16 })
  assert.deepEqual(getSavingsProgress({ totalAmount: 20, records: [{ amount: 30 }] }), { saved: 30, target: 20, remaining: 0, percent: 100 })
  assert.deepEqual(getSavingsProgress({ totalAmount: 0 }), { saved: 0, target: 0, remaining: 0, percent: 0 })
})

test('跨分组排序只更改目标计划的分组和顺序，金额与完成状态保持原样', () => {
  const records = [
    { id: 'a', group: '未分组', isCleared: false, totalAmount: 100, records: [{ amount: 20 }] },
    { id: 'done', group: '旅行', isCleared: true, totalAmount: 100, records: [{ amount: 100 }] },
    { id: 'b', group: '旅行', isCleared: false, totalAmount: 200, records: [] }
  ]
  const next = arrangeDebtRecords(records, { orderedIds: ['b', 'a'], isCleared: false, movedId: 'a', targetGroup: '旅行' })
  assert.deepEqual(next.map(item => item.id), ['b', 'done', 'a'])
  assert.equal(next[2].group, '旅行')
  assert.equal(next[2].totalAmount, 100)
  assert.deepEqual(next[2].records, [{ amount: 20 }])
  assert.equal(next[1], records[1])
  assert.equal(records[0].group, '未分组')
  assert.deepEqual(normalizeDebtGroups([], next), ['未分组', '旅行'])
})

test('分组规范化保留用户排序，并为旧数据补充未分组', () => {
  assert.deepEqual(normalizeDebtGroups(['旅行', '未分组', '学习']), ['旅行', '未分组', '学习'])
  assert.deepEqual(normalizeDebtGroups(['旅行'], [{ group: '学习' }]), ['未分组', '旅行', '学习'])
})
