import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dispatchBackAction,
  registerBackHandler,
  resetBackHandlersForTests
} from '../src/services/backNavigation.js'

test('返回处理优先关闭最高层且只执行一个处理器', async () => {
  resetBackHandlersForTests()
  const calls = []
  registerBackHandler(() => { calls.push('page'); return true }, { priority: 10 })
  registerBackHandler(() => { calls.push('dialog'); return true }, { priority: 100 })
  assert.equal(await dispatchBackAction(), true)
  assert.deepEqual(calls, ['dialog'])
})

test('未激活或拒绝处理时继续寻找下一层', async () => {
  resetBackHandlersForTests()
  const calls = []
  registerBackHandler(() => { calls.push('inactive'); return true }, {
    priority: 100,
    isActive: () => false
  })
  registerBackHandler(() => { calls.push('pass'); return false }, { priority: 80 })
  registerBackHandler(() => { calls.push('handled'); return true }, { priority: 20 })
  assert.equal(await dispatchBackAction(), true)
  assert.deepEqual(calls, ['pass', 'handled'])
})

test('注销处理器后不再拦截返回', async () => {
  resetBackHandlersForTests()
  const unregister = registerBackHandler(() => true)
  unregister()
  assert.equal(await dispatchBackAction(), false)
})
