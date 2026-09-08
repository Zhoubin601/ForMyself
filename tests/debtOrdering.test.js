import test from 'node:test'
import assert from 'node:assert/strict'
import { reorderDebtRecords, getSavingsProgress } from '../src/services/debtOrdering.js'

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
