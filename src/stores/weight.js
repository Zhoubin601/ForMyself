import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { preferenceStorage as driver } from '../platform/storage/preferences.js'
import { createStorePersistence, parseStoredJson } from '../platform/storage/storePersistence.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'

export const useWeightStore = defineStore('weight', () => {
  const weightRecords = ref([])
  const isDataLoaded = ref(false)

  const persistence = createStorePersistence(isDataLoaded, driver)
  const Preferences = persistence.storage
  const loadWeightRecords = () => persistence.load(
    async () => parseStoredJson((await Preferences.get({ key: STORAGE_KEYS.weightRecords })).value, [], 'records'),
    records => { weightRecords.value = records }
  )

  watch(
    weightRecords,
    (newRecords) => {
      if (isDataLoaded.value) {
        void Preferences.set({
          key: STORAGE_KEYS.weightRecords,
          value: JSON.stringify(newRecords)
        }).catch(() => {})
      }
    },
    { deep: true, flush: 'sync' }
  )

  const addRecord = (record) => {
    persistence.assertReady()
    weightRecords.value.push(record)
  }

  const updateRecord = (id, updates) => {
    persistence.assertReady()
    const index = weightRecords.value.findIndex(record => record.id === id)
    if (index < 0) return false
    weightRecords.value[index] = { ...weightRecords.value[index], ...updates, id }
    return true
  }

  const updateWeightRecords = (newList) => {
    persistence.assertReady()
    weightRecords.value = newList
  }

  const restoreWeightRecords = async (newList) => {
    persistence.assertReady()
    weightRecords.value = newList
    await Preferences.set({
      key: STORAGE_KEYS.weightRecords,
      value: JSON.stringify(weightRecords.value)
    })
  }

  const deleteRecord = (id) => {
    persistence.assertReady()
    weightRecords.value = weightRecords.value.filter(r => r.id !== id)
  }

  return {
    ...persistence.expose,
    weightRecords,
    isDataLoaded,
    loadWeightRecords,
    addRecord,
    updateRecord,
    updateWeightRecords,
    restoreWeightRecords,
    deleteRecord
  }
})
