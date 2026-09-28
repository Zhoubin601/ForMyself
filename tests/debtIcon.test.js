import assert from 'node:assert/strict'
import test from 'node:test'
import { debtIconGraphemes, normalizeDebtIconLabel } from '../src/services/debtIcon.js'

test('计划图标标签保留组合 emoji，最多显示两个可见字符', () => {
  assert.equal(normalizeDebtIconLabel(' 👨‍👩‍👧‍👦✈️旅行 '), '👨‍👩‍👧‍👦✈️')
  assert.equal(normalizeDebtIconLabel('旅行计划'), '旅行')
  assert.equal(normalizeDebtIconLabel(null), '')
  assert.deepEqual(debtIconGraphemes('🇨🇳🎉'), ['🇨🇳', '🎉'])
})
