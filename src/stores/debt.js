import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { preferenceStorage as Preferences } from '../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { reorderDebtRecords } from '../services/debtOrdering.js'

export const useDebtStore = defineStore('debt', () => {
  const savedDebts = ref([])
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
  const assign = records => {
    silent = true
    savedDebts.value = records
    silent = false
    revision++
  }

  const loadDebts = async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEYS.debtRecords })
      if (value) {
        assign(JSON.parse(value))
      }
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
  }

  const restoreDebts = async (newList) => {
    assign(newList)
    const value = JSON.stringify(newList)
    await enqueue(() => write(value))
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
    isDataLoaded,
    isReordering,
    reorderDebts,
    loadDebts,
    addDebt,
    updateDebts,
    restoreDebts,
    deleteDebt,
    getDebtById,
    totalSaved
  }
})
