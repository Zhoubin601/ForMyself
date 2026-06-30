import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'

export const useMoodStore = defineStore('mood', () => {
  const moodRecords = ref([])
  const isDataLoaded = ref(false)

  const STORAGE_KEY = 'my_mood_records_data'

  const loadMoodRecords = async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY })
      if (value) {
        moodRecords.value = JSON.parse(value)
      }
      // 数据加载完成后立即检查补齐缺失日期
      autoFillMissingDays()
    } catch (e) {
      console.error('读取心情数据失败', e)
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(
    moodRecords,
    async (newVal) => {
      if (isDataLoaded.value) {
        await Preferences.set({
          key: STORAGE_KEY,
          value: JSON.stringify(newVal)
        })
      }
    },
    { deep: true }
  )

  // --- 自动补齐缺失日期的逻辑 ---
  const autoFillMissingDays = () => {
    if (moodRecords.value.length === 0) return

    // 找到所有记录中最后的日期
    const dates = moodRecords.value.map(r => r.date).sort()
    const lastRecordDateStr = dates[dates.length - 1]
    const lastDate = new Date(lastRecordDateStr)

    // 计算"昨天"的日期（今天留给用户自己填）
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // 从最后记录日期的第二天开始，一直检查到昨天
    const checkDate = new Date(lastDate)
    checkDate.setDate(checkDate.getDate() + 1)

    let needSave = false

    while (checkDate <= yesterday) {
      const year = checkDate.getFullYear()
      const month = String(checkDate.getMonth() + 1).padStart(2, '0')
      const day = String(checkDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      if (!moodRecords.value.find(r => r.date === dateStr)) {
        moodRecords.value.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          date: dateStr,
          mood: 'normal',
          note: ''
        })
        needSave = true
      }
      checkDate.setDate(checkDate.getDate() + 1)
    }

    // 由 watch 自动持久化
  }

  const addRecord = (date, mood = 'normal', note = '') => {
    // 如果该日期已有记录，则覆盖更新
    const existing = moodRecords.value.findIndex(r => r.date === date)
    if (existing !== -1) {
      moodRecords.value[existing] = { ...moodRecords.value[existing], mood, note }
    } else {
      moodRecords.value.push({
        id: Date.now().toString(),
        date,
        mood,
        note
      })
    }
  }

  const updateRecord = (id, updates) => {
    const idx = moodRecords.value.findIndex(r => r.id === id)
    if (idx !== -1) {
      moodRecords.value[idx] = { ...moodRecords.value[idx], ...updates }
    }
  }

  const deleteRecord = (id) => {
    moodRecords.value = moodRecords.value.filter(r => r.id !== id)
  }

  const updateMoodRecords = (newList) => {
    moodRecords.value = newList
  }

  const getRecordByDate = (date) => {
    return moodRecords.value.find(r => r.date === date)
  }

  const getMonthStats = (year, month) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const monthRecs = moodRecords.value.filter(r => r.date.startsWith(prefix))
    const stats = { great: 0, good: 0, normal: 0, bad: 0, terrible: 0, total: monthRecs.length }
    monthRecs.forEach(r => {
      if (stats[r.mood] !== undefined) stats[r.mood]++
    })
    return stats
  }

  return {
    moodRecords,
    isDataLoaded,
    loadMoodRecords,
    autoFillMissingDays,
    addRecord,
    updateRecord,
    deleteRecord,
    updateMoodRecords,
    getRecordByDate,
    getMonthStats
  }
})
