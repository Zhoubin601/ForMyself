import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { preferenceStorage as Preferences } from '../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { arrangeDebtRecords, DEFAULT_DEBT_GROUP, normalizeDebtGroups, reorderDebtRecords } from '../services/debtOrdering.js'

export const useDebtStore = defineStore('debt', () => {
  const savedDebts = ref([])
  const debtGroups = ref([DEFAULT_DEBT_GROUP])
  const isDataLoaded = ref(false)
  const isReordering = ref(false)
  let revision = 0
  let silent = false
  let writeChain = Promise.resolve()
  let automaticWriteQueued = false
  let automaticValue = ''
  const enqueue = operation => {
    const result = writeChain.catch(() => {}).then(operation)
    writeChain = result.catch(() => {})
    return result
  }
  const write = value => Preferences.set({ key: STORAGE_KEYS.debtRecords, value })
  const writeGroups = value => Preferences.set({ key: STORAGE_KEYS.debtGroups, value })
  const assign = records => {
    silent = true
    savedDebts.value = records
    silent = false
    revision++
  }

  const loadDebts = async () => {
    try {
      const [{ value }, groupResult] = await Promise.all([
        Preferences.get({ key: STORAGE_KEYS.debtRecords }),
        Preferences.get({ key: STORAGE_KEYS.debtGroups })
      ])
      if (value) {
        assign(JSON.parse(value))
      }
      debtGroups.value = normalizeDebtGroups(groupResult.value ? JSON.parse(groupResult.value) : [], savedDebts.value)
    } catch (e) {
      console.error('读取省钱数据失败', e)
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(
    savedDebts,
    (newDebts) => {
      if (!silent) revision++
      if (isDataLoaded.value && !silent) {
        automaticValue = JSON.stringify(newDebts)
        if (!automaticWriteQueued) {
          automaticWriteQueued = true
          enqueue(() => {
            automaticWriteQueued = false
            return write(automaticValue)
          }).catch(() => console.error('保存省钱数据失败'))
        }
      }
    },
    { deep: true, flush: 'sync' }
  )

  const addDebt = (newDebt) => {
    savedDebts.value.push(newDebt)
  }

  const updateDebts = (newList) => {
    savedDebts.value = newList
    debtGroups.value = normalizeDebtGroups(debtGroups.value, newList)
    enqueue(() => writeGroups(JSON.stringify(debtGroups.value))).catch(() => console.error('保存省钱分组失败'))
  }

  const restoreDebts = async (newList, groups = []) => {
    assign(newList)
    debtGroups.value = normalizeDebtGroups(groups, newList)
    const value = JSON.stringify(newList)
    await enqueue(async () => {
      await write(value)
      await writeGroups(JSON.stringify(debtGroups.value))
    })
    isDataLoaded.value = true
  }

  const addDebtGroup = async name => {
    const clean = String(name || '').trim().slice(0, 20)
    if (!clean || debtGroups.value.includes(clean) || debtGroups.value.length >= 51) throw new Error('INVALID_DEBT_GROUP')
    const next = [...debtGroups.value, clean]
    await enqueue(() => writeGroups(JSON.stringify(next)))
    debtGroups.value = next
    return clean
  }

  const renameDebtGroup = async (oldName, newName) => {
    const clean = String(newName || '').trim().slice(0, 20)
    if (oldName === DEFAULT_DEBT_GROUP || !debtGroups.value.includes(oldName) || !clean ||
      (clean !== oldName && debtGroups.value.includes(clean))) throw new Error('INVALID_DEBT_GROUP')
    if (clean === oldName) return
    const nextRecords = savedDebts.value.map(item => item.group === oldName ? { ...item, group: clean } : item)
    const nextGroups = debtGroups.value.map(name => name === oldName ? clean : name)
    await enqueue(async () => {
      await write(JSON.stringify(nextRecords))
      await writeGroups(JSON.stringify(nextGroups))
    })
    assign(nextRecords)
    debtGroups.value = nextGroups
  }

  const deleteDebtGroup = async name => {
    if (name === DEFAULT_DEBT_GROUP || !debtGroups.value.includes(name)) throw new Error('INVALID_DEBT_GROUP')
    const nextRecords = savedDebts.value.map(item => item.group === name ? { ...item, group: DEFAULT_DEBT_GROUP } : item)
    const nextGroups = debtGroups.value.filter(group => group !== name)
    await enqueue(async () => {
      await write(JSON.stringify(nextRecords))
      await writeGroups(JSON.stringify(nextGroups))
    })
    assign(nextRecords)
    debtGroups.value = nextGroups
  }

  const reorderDebtGroups = async orderedNames => {
    const before = [...debtGroups.value]
    if (!isDataLoaded.value || !Array.isArray(orderedNames) || orderedNames.length !== before.length ||
      new Set(orderedNames).size !== before.length || orderedNames.some(name => !before.includes(name))) {
      throw new Error('DEBT_GROUP_ORDER_CHANGED')
    }
    if (orderedNames.every((name, index) => name === before[index])) return
    await enqueue(async () => {
      if (debtGroups.value.some((name, index) => name !== before[index])) throw new Error('DEBT_GROUP_ORDER_CHANGED')
      await writeGroups(JSON.stringify(orderedNames))
      debtGroups.value = [...orderedNames]
    })
  }

  const arrangeDebts = async options => {
    if (!isDataLoaded.value || isReordering.value ||
      (options.targetGroup !== null && options.targetGroup !== undefined && !debtGroups.value.includes(options.targetGroup))) {
      throw new Error('DEBT_ORDER_BUSY')
    }
    isReordering.value = true
    try {
      await enqueue(async () => {
        const next = arrangeDebtRecords(savedDebts.value, options)
        const beforeRevision = revision
        await write(JSON.stringify(next))
        if (beforeRevision !== revision) throw new Error('DEBT_ORDER_CHANGED')
        assign(next)
      })
    } finally {
      isReordering.value = false
    }
  }

  const reorderDebts = async options => {
    if (!isDataLoaded.value || isReordering.value) throw new Error('DEBT_ORDER_BUSY')
    isReordering.value = true
    try {
      await enqueue(async () => {
        const next = reorderDebtRecords(savedDebts.value, options)
        const beforeRevision = revision
        await write(JSON.stringify(next))
        // Business updates queued during the write must win over this preview.
        if (beforeRevision !== revision) throw new Error('DEBT_ORDER_CHANGED')
        assign(next)
      })
    } finally {
      isReordering.value = false
    }
  }

  const deleteDebt = (id) => {
    savedDebts.value = savedDebts.value.filter(d => d.id !== id)
  }

  const getDebtById = (id) => {
    return savedDebts.value.find(d => d.id === id)
  }

  const totalSaved = () => {
    return savedDebts.value.reduce((sum, item) => {
      const itemSaved = item.records
        ? item.records.reduce((s, r) => s + r.amount, 0)
        : 0
      return sum + itemSaved
    }, 0)
  }

  return {
    savedDebts,
    debtGroups,
    isDataLoaded,
    isReordering,
    reorderDebts,
    arrangeDebts,
    reorderDebtGroups,
    addDebtGroup,
    renameDebtGroup,
    deleteDebtGroup,
    loadDebts,
    addDebt,
    updateDebts,
    restoreDebts,
    deleteDebt,
    getDebtById,
    totalSaved
  }
})
