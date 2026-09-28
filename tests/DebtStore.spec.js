import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDebtStore } from '../src/stores/debt.js'
import { preferenceStorage } from '../src/platform/storage/preferences.js'

vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: { get: vi.fn(), set: vi.fn() } }))
const records = () => [{ id: 'a', records: [] }, { id: 'done', isCleared: true }, { id: 'b', records: [] }]
beforeEach(() => {
  setActivePinia(createPinia())
  preferenceStorage.get.mockResolvedValue({ value: JSON.stringify(records()) })
  preferenceStorage.set.mockReset().mockResolvedValue(undefined)
})

describe('省钱顺序持久化', () => {
  it('一次存入的多处字段变更合并保存最终状态', async () => {
    const store = useDebtStore()
    await store.loadDebts()
    store.savedDebts[0].records.push({ amount: 10 })
    store.savedDebts[0].remainingAmount = 0
    store.savedDebts[0].isCleared = true
    store.savedDebts[0].iconLabel = '🎯'
    await vi.waitFor(() => expect(preferenceStorage.set).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(preferenceStorage.set.mock.calls[0][0].value)[0]
    expect(saved.records).toEqual([{ amount: 10 }])
    expect(saved.isCleared).toBe(true)
    expect(saved.iconLabel).toBe('🎯')
  })
  it('只写一次，成功后提交顺序，可从存储恢复', async () => {
    const store = useDebtStore()
    await store.loadDebts()
    await store.reorderDebts({ orderedIds: ['b', 'a'], isCleared: false })
    expect(preferenceStorage.set).toHaveBeenCalledTimes(1)
    const value = preferenceStorage.set.mock.calls[0][0].value
    expect(store.savedDebts.map(item => item.id)).toEqual(['b', 'done', 'a'])
    preferenceStorage.get.mockResolvedValue({ value })
    setActivePinia(createPinia())
    const restored = useDebtStore()
    await restored.loadDebts()
    expect(restored.savedDebts.map(item => item.id)).toEqual(['b', 'done', 'a'])
  })
  it('写入失败保持旧顺序，并允许重试', async () => {
    const store = useDebtStore()
    await store.loadDebts()
    preferenceStorage.set.mockRejectedValueOnce(new Error('disk'))
    await expect(store.reorderDebts({ orderedIds: ['b', 'a'], isCleared: false })).rejects.toThrow()
    expect(store.savedDebts.map(item => item.id)).toEqual(['a', 'done', 'b'])
    await store.reorderDebts({ orderedIds: ['b', 'a'], isCleared: false })
    expect(store.isReordering).toBe(false)
  })
  it('拒绝并发排序，存入等更新不被待保存的顺序覆盖', async () => {
    const store = useDebtStore()
    await store.loadDebts()
    let release
    preferenceStorage.set.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const result = store.reorderDebts({ orderedIds: ['b', 'a'], isCleared: false })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(store.reorderDebts({ orderedIds: ['a', 'b'], isCleared: false })).rejects.toThrow('BUSY')
    store.addDebt({ id: 'new' })
    release()
    await expect(result).rejects.toThrow('CHANGED')
    await vi.waitFor(() => expect(preferenceStorage.set).toHaveBeenCalledTimes(2))
    expect(store.savedDebts.map(item => item.id)).toEqual(['a', 'done', 'b', 'new'])
    expect(JSON.parse(preferenceStorage.set.mock.calls[1][0].value).at(-1).id).toBe('new')
  })

  it('自定义分组与跨组排序重启后恢复，删除分组将计划安全移到未分组', async () => {
    const storage = new Map([['my_debt_manager_data', JSON.stringify(records())]])
    preferenceStorage.get.mockImplementation(async ({ key }) => ({ value: storage.get(key) ?? null }))
    preferenceStorage.set.mockImplementation(async ({ key, value }) => { storage.set(key, value) })
    const store = useDebtStore()
    await store.loadDebts()
    await store.addDebtGroup('旅行')
    await store.arrangeDebts({ orderedIds: ['b', 'a'], isCleared: false, movedId: 'a', targetGroup: '旅行' })
    await expect(store.reorderDebtGroups(['旅行', '旅行'])).rejects.toThrow('DEBT_GROUP_ORDER_CHANGED')
    await store.reorderDebtGroups(['旅行', '未分组'])
    expect(store.savedDebts.find(item => item.id === 'a').group).toBe('旅行')
    expect(store.savedDebts.map(item => item.id)).toEqual(['b', 'done', 'a'])
    expect(store.debtGroups).toEqual(['旅行', '未分组'])

    setActivePinia(createPinia())
    const restored = useDebtStore()
    await restored.loadDebts()
    expect(restored.debtGroups).toEqual(['旅行', '未分组'])
    expect(restored.savedDebts.find(item => item.id === 'a').group).toBe('旅行')
    await restored.deleteDebtGroup('旅行')
    expect(restored.savedDebts.find(item => item.id === 'a').group).toBe('未分组')
    expect(restored.debtGroups).toEqual(['未分组'])
  })
})
