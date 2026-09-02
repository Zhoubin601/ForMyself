import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appRouteKey,
  normalizeAppRoute,
  popAppRoute,
  pushAppRoute
} from '../src/services/navigationHistory.js'

test('导航历史保留页面来源、设置分类、日程目标和滚动位置', () => {
  const home = normalizeAppRoute({ view: 'home', scrollTop: 428 })
  const weightSettings = normalizeAppRoute({ view: 'settings', settingsScope: 'weight' })
  const stack = pushAppRoute([], home, weightSettings)
  assert.equal(stack.length, 1)
  assert.equal(stack[0].view, 'home')
  assert.equal(stack[0].scrollTop, 428)

  const popped = popAppRoute(stack)
  assert.equal(appRouteKey(popped.route), appRouteKey(home))
  assert.deepEqual(popped.stack, [])
})

test('相同页面不重复入栈且历史只保留最近三十项', () => {
  const home = normalizeAppRoute('home')
  assert.deepEqual(pushAppRoute([], home, home), [])

  let stack = []
  let current = home
  const views = ['weight', 'mood', 'debts', 'reports']
  for (let index = 0; index < 40; index += 1) {
    const target = normalizeAppRoute(views[index % views.length])
    stack = pushAppRoute(stack, current, target)
    current = target
  }
  assert.equal(stack.length, 30)
})

test('设置分类和日程 occurrence 属于不同历史地址', () => {
  assert.notEqual(
    appRouteKey({ view: 'settings', settingsSection: 'appearance' }),
    appRouteKey({ view: 'settings', settingsSection: 'security' })
  )
  assert.notEqual(
    appRouteKey({ view: 'schedule', scheduleTarget: { item: 'a', occurrence: '2026-08-31' } }),
    appRouteKey({ view: 'schedule', scheduleTarget: { item: 'a', occurrence: '2026-09-01' } })
  )
})
