import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAutoLockDelay,
  shouldLockOnBackground,
  shouldLockOnResume
} from '../src/services/autoLockPolicy.js'

test('只接受受支持的自动锁定时间', () => {
  assert.equal(normalizeAutoLockDelay(-1), -1)
  assert.equal(normalizeAutoLockDelay('60'), 60)
  assert.equal(normalizeAutoLockDelay(300), 300)
  assert.equal(normalizeAutoLockDelay(999), 0)
  assert.equal(normalizeAutoLockDelay(undefined), 0)
})

test('立即锁定只在进入后台时触发', () => {
  assert.equal(shouldLockOnBackground(0), true)
  assert.equal(shouldLockOnBackground(60), false)
  assert.equal(shouldLockOnBackground(-1), false)
  assert.equal(shouldLockOnResume(0, 1000, 2000), false)
})

test('延迟锁定在达到边界时触发', () => {
  assert.equal(shouldLockOnResume(60, 1000, 60999), false)
  assert.equal(shouldLockOnResume(60, 1000, 61000), true)
  assert.equal(shouldLockOnResume(300, 1000, 301000), true)
})

test('关闭自动锁定时永不触发', () => {
  assert.equal(shouldLockOnBackground(-1), false)
  assert.equal(shouldLockOnResume(-1, 1000, 999999), false)
})

test('无效时间戳和系统时间倒退不会误锁', () => {
  assert.equal(shouldLockOnResume(60, null, 61000), false)
  assert.equal(shouldLockOnResume(60, Number.NaN, 61000), false)
  assert.equal(shouldLockOnResume(60, 70000, 60000), false)
})
