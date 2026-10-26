// Review probes: passing means the unsafe behavior was reproduced, not fixed.
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { STORAGE_KEYS } from '../../../src/platform/storage/keys.js'

const driver = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../../../src/platform/storage/preferences.js', () => ({ preferenceStorage: driver }))
import { useScheduleStore } from '../../../src/features/schedule/scheduleStore.js'
import { useWeightStore } from '../../../src/stores/weight.js'

let values
beforeEach(() => {
  setActivePinia(createPinia())
  values = new Map()
  driver.get.mockReset()
  driver.set.mockReset().mockImplementation(async ({ key, value }) => { values.set(key, value) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('review reproduction: a schedule read failure is followed by overwriting stored series with empty data', async () => {
  values.set(STORAGE_KEYS.scheduleData, JSON.stringify({ series: [{ id: 'synthetic-existing-series' }], occurrences: [], categories: [] }))
  driver.get.mockRejectedValueOnce(new Error('synthetic transient read failure'))
  const store = useScheduleStore()
  await store.loadSchedules()
  expect(store.isDataLoaded).toBe(true)
  expect(driver.set).toHaveBeenCalledWith(expect.objectContaining({ key: STORAGE_KEYS.scheduleData }))
  expect(JSON.parse(values.get(STORAGE_KEYS.scheduleData)).series).toEqual([])
  store.$dispose()
})

test('review reproduction: after a weight read failure, adding a record replaces previously stored records', async () => {
  const previous = { id: 'synthetic-old', weight: 65, date: '2026-10-25' }
  const added = { id: 'synthetic-new', weight: 64, date: '2026-10-26' }
  values.set(STORAGE_KEYS.weightRecords, JSON.stringify([previous]))
  driver.get.mockRejectedValueOnce(new Error('synthetic transient read failure'))
  const store = useWeightStore()
  await store.loadWeightRecords()
  expect(store.isDataLoaded).toBe(true)
  store.addRecord(added)
  await nextTick()
  expect(JSON.parse(values.get(STORAGE_KEYS.weightRecords))).toEqual([added])
  store.$dispose()
})
