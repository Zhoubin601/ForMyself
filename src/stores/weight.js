import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'

export const useWeightStore = defineStore('weight', () => {
  const weightRecords = ref([])
  const isDataLoaded = ref(false)

  const loadWeightRecords = async () => {
    try {
      const { value } = await Preferences.get({ key: 'my_weight_records_data' })
      if (value) {
        weightRecords.value = JSON.parse(value)
      }
    } catch (e) {
      console.error('读取体重数据失败', e)
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(
    weightRecords,
    async (newRecords) => {
      if (isDataLoaded.value) {
        await Preferences.set({
          key: 'my_weight_records_data',
          value: JSON.stringify(newRecords)
        })
      }
    },
    { deep: true }
  )

  const addRecord = (record) => {
    weightRecords.value.push(record)
  }

  const updateWeightRecords = (newList) => {
    weightRecords.value = newList
  }

  const deleteRecord = (id) => {
    weightRecords.value = weightRecords.value.filter(r => r.id !== id)
  }

  return {
    weightRecords,
    isDataLoaded,
    loadWeightRecords,
    addRecord,
    updateWeightRecords,
    deleteRecord
  }
})
