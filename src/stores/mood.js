import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'

export const useMoodStore = defineStore('mood', () => {
  const moodRecords = ref([])
  const isDataLoaded = ref(false)
  const trackingStartDate = ref('')

  const STORAGE_KEY = 'my_mood_records_data'
  const START_DATE_KEY = 'my_mood_tracking_start_date'

  const formatLocalDate = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const loadMoodRecords = async () => {
    try {
      const [{ value }, startResult] = await Promise.all([
        Preferences.get({ key: STORAGE_KEY }),
        Preferences.get({ key: START_DATE_KEY })
      ])
      if (value) {
        moodRecords.value = JSON.parse(value)
      }

      if (startResult.value) {
        trackingStartDate.value = startResult.value
      } else {
        const existingDates = moodRecords.value.map(record => record.date).filter(Boolean).sort()
        trackingStartDate.value = existingDates[0] || formatLocalDate(new Date())
        await Preferences.set({ key: START_DATE_KEY, value: trackingStartDate.value })
      }
      // 数据加载完成后立即检查补齐缺失日期
      await autoFillMissingDays()
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
  const autoFillMissingDays = async () => {
    if (!trackingStartDate.value) return

    // 计算"昨天"的日期（今天留给用户自己填）
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // 从开始使用心情追踪的日期起，逐日检查到昨天
    const checkDate = new Date(`${trackingStartDate.value}T00:00:00`)
    if (Number.isNaN(checkDate.getTime())) return

    let needSave = false
    const existingDates = new Set(moodRecords.value.map(record => record.date))

    while (checkDate <= yesterday) {
      const dateStr = formatLocalDate(checkDate)

      if (!existingDates.has(dateStr)) {
        moodRecords.value.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          date: dateStr,
          mood: 'normal',
          note: ''
        })
        existingDates.add(dateStr)
        needSave = true
      }
      checkDate.setDate(checkDate.getDate() + 1)
    }

    // 首次加载时 watch 尚未开放写入，显式保存以确保补记不会丢失
    if (needSave) {
      await Preferences.set({
        key: STORAGE_KEY,
        value: JSON.stringify(moodRecords.value)
      })
    }
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
