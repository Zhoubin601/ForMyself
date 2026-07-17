import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'

export const useDebtStore = defineStore('debt', () => {
  const savedDebts = ref([])
  const isDataLoaded = ref(false)

  const loadDebts = async () => {
    try {
      const { value } = await Preferences.get({ key: 'my_debt_manager_data' })
      if (value) {
        savedDebts.value = JSON.parse(value)
      }
    } catch (e) {
      console.error('读取省钱数据失败', e)
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(
    savedDebts,
    async (newDebts) => {
      if (isDataLoaded.value) {
        await Preferences.set({
          key: 'my_debt_manager_data',
          value: JSON.stringify(newDebts)
        })
      }
    },
    { deep: true }
  )

  const addDebt = (newDebt) => {
    savedDebts.value.push(newDebt)
  }

  const updateDebts = (newList) => {
    savedDebts.value = newList
  }

  const restoreDebts = async (newList) => {
    savedDebts.value = newList
    await Preferences.set({
      key: 'my_debt_manager_data',
      value: JSON.stringify(savedDebts.value)
    })
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
    loadDebts,
    addDebt,
    updateDebts,
    restoreDebts,
    deleteDebt,
    getDebtById,
    totalSaved
  }
})
