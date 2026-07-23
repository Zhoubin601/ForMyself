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
