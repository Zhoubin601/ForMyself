import test from 'node:test'
import assert from 'node:assert/strict'
import { getRouteFromAppUrl, getViewFromAppUrl } from '../src/services/appDeepLink.js'

test('四格小组件深链映射到应用页面', () => {
  assert.equal(getViewFromAppUrl('formyself://open/home'), 'home')
  assert.equal(getViewFromAppUrl('formyself://open/mood'), 'mood')
  assert.equal(getViewFromAppUrl('formyself://open/weight'), 'weight')
  assert.equal(getViewFromAppUrl('formyself://open/savings'), 'debts')
  assert.equal(getViewFromAppUrl('formyself://open/reports'), 'reports')
  assert.equal(getViewFromAppUrl('formyself://open/schedule'), 'schedule')
})

test('日程深链保留系列和 occurrence 定位参数', () => {
  assert.deepEqual(
    getRouteFromAppUrl('formyself://open/schedule?item=s-1&occurrence=s-1%402026-07-24'),
    { view: 'schedule', item: 's-1', occurrence: 's-1@2026-07-24' }
  )
})

test('忽略未知、错误协议和无效深链', () => {
  assert.equal(getViewFromAppUrl('formyself://open/passwords'), null)
  assert.equal(getViewFromAppUrl('https://open/mood'), null)
  assert.equal(getViewFromAppUrl('not-a-url'), null)
  assert.equal(getViewFromAppUrl(null), null)
})


test('待办深链保留任务、日期及编码参数，协议和主机仍需匹配', () => {
  assert.deepEqual(getRouteFromAppUrl('FORMYSELF://open/todo?item=task%40one&date=2026-10-26'),
    { view: 'todo', item: 'task@one', date: '2026-10-26' })
  assert.equal(getRouteFromAppUrl('formyself://other/todo'), null)
  assert.equal(getRouteFromAppUrl('formyself:open/todo'), null)
  assert.equal(getRouteFromAppUrl('https://open/todo'), null)
})

test('兼容实际 WebView113 将自定义协议 authority 当路径的行为', () => {
  const StandardURL = globalThis.URL
  globalThis.URL = class LegacyWebViewURL extends StandardURL {
    constructor(input, base) {
      super(input, base)
      if (this.protocol === 'formyself:') {
        const path = '//' + this.host + this.pathname
        Object.defineProperties(this, { hostname: { value: '' }, pathname: { value: path } })
      }
    }
  }
  try {
    const observed = new URL('formyself://open/todo')
    assert.equal(observed.hostname, '')
    assert.equal(observed.pathname, '//open/todo')
    assert.deepEqual(getRouteFromAppUrl('formyself://open/todo?item=legacy&date=2026-10-26'),
      { view: 'todo', item: 'legacy', date: '2026-10-26' })
    assert.deepEqual(getRouteFromAppUrl('formyself://open/schedule?item=s1&occurrence=s1%402026-10-26'),
      { view: 'schedule', item: 's1', occurrence: 's1@2026-10-26' })
    assert.equal(getRouteFromAppUrl('formyself://other/todo'), null)
    assert.equal(getRouteFromAppUrl('https://open/todo'), null)
  } finally { globalThis.URL = StandardURL }
})
