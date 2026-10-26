import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { STORAGE_KEYS as K } from '../src/platform/storage/keys.js'
import { createStorePersistence } from '../src/platform/storage/storePersistence.js'
import DataStatusBanner from '../src/components/DataStatusBanner.vue'
const driver = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: driver }))
import { useWeightStore } from '../src/stores/weight.js'
import { useScheduleStore } from '../src/features/schedule/scheduleStore.js'
import { useDebtStore } from '../src/stores/debt.js'
import { useMoodStore } from '../src/features/mood/moodStore.js'
let values
beforeEach(() => {
  setActivePinia(createPinia()); values = new Map()
  driver.get.mockReset().mockImplementation(async ({ key }) => ({ value: values.get(key) ?? null }))
  driver.set.mockReset().mockImplementation(async ({ key, value }) => { values.set(key, value) })
})
afterEach(() => vi.restoreAllMocks())
const cases = [
  { name: 'weight', key: K.weightRecords, use: useWeightStore, load: 'loadWeightRecords', add: s => s.addRecord({ id: 'new' }), old: [{ id: 'old' }] },
  { name: 'schedule', key: K.scheduleData, use: useScheduleStore, load: 'loadSchedules', add: s => s.addSeries({ title: 'new' }), old: { series: [{ id: 'old', title: 'old' }], occurrences: [] } },
  { name: 'debt', key: K.debtRecords, use: useDebtStore, load: 'loadDebts', add: s => s.addDebt({ id: 'new' }), old: [{ id: 'old' }] },
  { name: 'mood', key: K.moodRecords, use: useMoodStore, load: 'loadMoodRecords', add: s => s.addRecord('2026-10-26'), old: [{ id: 'old', date: '2026-10-26', mood: 'normal' }] }
]
it.each(cases)('$name: read failure never overwrites old data; retry loads original records', async c => {
  const original = JSON.stringify(c.old); values.set(c.key, original)
  driver.get.mockRejectedValueOnce(new Error('transient read failure'))
  const s = c.use(); expect(await s[c.load]()).toBe(false)
  expect(s.isDataLoaded).toBe(false); expect(s.loadError).toBeTruthy()
  expect(() => c.add(s)).toThrow('尚未安全加载')
  expect(driver.set).not.toHaveBeenCalled(); expect(values.get(c.key)).toBe(original)
  await s[c.load](); expect(s.isDataLoaded).toBe(true)
  const stored = JSON.parse(values.get(c.key))
  expect(Array.isArray(stored) ? stored.some(r => r.id === 'old') : stored.series.some(r => r.id === 'old')).toBe(true)
  s.$dispose()
})
it.each(cases)('$name: invalid JSON and wrong top-level type are preserved', async c => {
  for (const text of ['{broken', c.name === 'schedule' ? '[]' : '{}', c.name === 'schedule' ? '{"version":999,"series":[]}' : '[null]']) {
    values.set(c.key, text); driver.set.mockClear()
    const s = c.use(); await s[c.load]()
    expect(s.isDataLoaded).toBe(false); expect(values.get(c.key)).toBe(text); expect(driver.set).not.toHaveBeenCalled()
    s.$dispose(); setActivePinia(createPinia())
  }
})
it.each([{ use: useDebtStore, load: 'loadDebts', key: K.debtGroups }, { use: useMoodStore, load: 'loadMoodRecords', key: K.moodTagSettings }])('multi-key load validates all keys before writeback', async c => {
  driver.get.mockImplementation(async ({ key }) => ({ value: key === c.key ? '{broken' : null }))
  const s = c.use(); await s[c.load]()
  expect(s.isDataLoaded).toBe(false); expect(driver.set).not.toHaveBeenCalled(); s.$dispose()
})
it('write failure keeps newest edit; reload cannot discard draft; retry and new store recover it', async () => {
  const s = useWeightStore(); await s.loadWeightRecords()
  driver.set.mockRejectedValue(new Error('disk full'))
  s.addRecord({ id: 'a' }); await nextTick(); await vi.waitFor(() => expect(s.saveStatus).toBe('error'))
  s.addRecord({ id: 'b' }); await expect(s.flush()).rejects.toThrow()
  await expect(s.loadWeightRecords()).rejects.toThrow(); expect(s.weightRecords.map(r => r.id)).toEqual(['a', 'b'])
  driver.set.mockImplementation(async ({ key, value }) => { values.set(key, value) })
  await s.retrySave(); expect(s.saveError).toBe(''); s.$dispose(); setActivePinia(createPinia())
  const reloaded = useWeightStore(); await reloaded.loadWeightRecords()
  expect(reloaded.weightRecords.map(r => r.id)).toEqual(['a', 'b']); reloaded.$dispose()
})
it('an older delayed write cannot win over a later edit', async () => {
  let unblock
  driver.set.mockImplementationOnce(({ key, value }) => new Promise(resolve => { unblock = () => { values.set(key, value); resolve() } }))
  const s = useWeightStore(); await s.loadWeightRecords(); s.addRecord({ id: 'first' })
  await vi.waitFor(() => expect(unblock).toBeTypeOf('function'))
  s.addRecord({ id: 'last' }); unblock(); await s.flush()
  expect(JSON.parse(values.get(K.weightRecords)).map(r => r.id)).toEqual(['first', 'last']); s.$dispose()
})
it('persistence refuses flush before a successful load', async () => {
  const state = createStorePersistence(ref(false), driver)
  await expect(state.expose.flush()).rejects.toThrow('尚未安全加载')
  expect(driver.set).not.toHaveBeenCalled()
})
it('visible retry calls the real failing store and restores usability', async () => {
  driver.get.mockRejectedValueOnce(new Error('read failure')); const s = useWeightStore(); await s.loadWeightRecords()
  const wrapper = mount(DataStatusBanner, { props: { issues: [{ id: 'weight', title: '体重', message: s.loadError, action: '重试读取', retry: () => s.loadWeightRecords() }] } })
  expect(wrapper.get('[role="alert"]').text()).toContain('读取失败'); await wrapper.get('button').trigger('click'); await flushPromises()
  expect(s.isDataLoaded).toBe(true); s.addRecord({ id: 'ok' }); await s.flush(); expect(values.get(K.weightRecords)).toContain('ok')
  wrapper.unmount(); s.$dispose()
})
