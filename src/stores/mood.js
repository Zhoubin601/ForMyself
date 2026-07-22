import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import {
  BUILT_IN_MOOD_TAGS,
  DEFAULT_MOOD_TAG,
  compareMoodRecordsNewestFirst,
  getCustomMoodTags,
  normalizeMoodRecord,
  normalizeMoodRecords,
  normalizeMoodTag,
  normalizeMoodTags
} from '../services/moodRecords.js'

export const useMoodStore = defineStore('mood', () => {
  const moodRecords = ref([])
  const isDataLoaded = ref(false)
  const trackingStartDate = ref('')
  const customTags = ref([])

  const STORAGE_KEY = 'my_mood_records_data'
  const START_DATE_KEY = 'my_mood_tracking_start_date'
  const CUSTOM_TAGS_KEY = 'my_mood_custom_tags'

  const formatLocalDate = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const loadMoodRecords = async () => {
    try {
      const [{ value }, startResult, customTagsResult] = await Promise.all([
        Preferences.get({ key: STORAGE_KEY }),
        Preferences.get({ key: START_DATE_KEY }),
        Preferences.get({ key: CUSTOM_TAGS_KEY })
      ])
      if (value) {
        const parsed = JSON.parse(value)
        moodRecords.value = normalizeMoodRecords(parsed)
        if (JSON.stringify(parsed) !== JSON.stringify(moodRecords.value)) {
          await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(moodRecords.value) })
        }
      }

      const savedCustomTags = customTagsResult.value ? JSON.parse(customTagsResult.value) : []
      customTags.value = getCustomMoodTags(moodRecords.value, savedCustomTags)

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

  watch(
    customTags,
    async (newVal) => {
      if (isDataLoaded.value) {
        await Preferences.set({ key: CUSTOM_TAGS_KEY, value: JSON.stringify(newVal) })
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
          note: '',
          tags: [DEFAULT_MOOD_TAG],
          autoFilled: true,
          createdAt: Date.now()
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

  const addRecord = (date, mood = 'normal', note = '', tags = [DEFAULT_MOOD_TAG]) => {
    const record = normalizeMoodRecord({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date,
      mood,
      note,
      tags,
      createdAt: Date.now(),
      autoFilled: false
    })

    // 用户首次为自动补记日写真实事件时，用真实事件替换占位记录。
    const placeholderIndex = moodRecords.value.findIndex(r => r.date === date && r.autoFilled === true)
    if (placeholderIndex !== -1) moodRecords.value[placeholderIndex] = record
    else moodRecords.value.push(record)
    syncCustomTagsFromRecords()
    return record
  }

  const updateRecord = (id, updates) => {
    const idx = moodRecords.value.findIndex(r => r.id === id)
    if (idx !== -1) {
      moodRecords.value[idx] = normalizeMoodRecord({
        ...moodRecords.value[idx],
        ...updates,
        autoFilled: false
      })
      syncCustomTagsFromRecords()
    }
  }

  const deleteRecord = (id) => {
    moodRecords.value = moodRecords.value.filter(r => r.id !== id)
  }

  const updateMoodRecords = (newList) => {
    moodRecords.value = normalizeMoodRecords(newList)
    syncCustomTagsFromRecords()
  }

  const restoreMoodBackup = async (records, metadata = {}) => {
    moodRecords.value = normalizeMoodRecords(records)
    customTags.value = getCustomMoodTags(moodRecords.value, metadata.customTags)
    const existingDates = moodRecords.value.map(record => record.date).filter(Boolean).sort()
    trackingStartDate.value = /^\d{4}-\d{2}-\d{2}$/.test(String(metadata.trackingStartDate || ''))
      ? metadata.trackingStartDate
      : existingDates[0] || formatLocalDate(new Date())
    await Preferences.set({ key: START_DATE_KEY, value: trackingStartDate.value })
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(moodRecords.value) })
    await Preferences.set({ key: CUSTOM_TAGS_KEY, value: JSON.stringify(customTags.value) })
  }

  const getRecordsByDate = (date) => {
    return moodRecords.value
      .filter(r => r.date === date)
      .sort(compareMoodRecordsNewestFirst)
  }

  const getRecordByDate = (date) => {
    return getRecordsByDate(date)[0]
  }

  const addCustomTag = (value) => {
    const tag = normalizeMoodTag(value)
    if (!tag || BUILT_IN_MOOD_TAGS.includes(tag) || customTags.value.includes(tag)) return tag
    customTags.value = [...customTags.value, tag].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return tag
  }

  const removeCustomTag = (value) => {
    const tag = normalizeMoodTag(value)
    if (!tag || BUILT_IN_MOOD_TAGS.includes(tag) || !customTags.value.includes(tag)) return false

    moodRecords.value = moodRecords.value.map(record => ({
      ...record,
      tags: normalizeMoodTags(record.tags.filter(item => item !== tag))
    }))
    customTags.value = customTags.value.filter(item => item !== tag)
    return true
  }

  function syncCustomTagsFromRecords() {
    customTags.value = getCustomMoodTags(moodRecords.value, customTags.value)
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
    customTags,
    trackingStartDate,
    builtInTags: BUILT_IN_MOOD_TAGS,
    isDataLoaded,
    loadMoodRecords,
    autoFillMissingDays,
    addRecord,
    updateRecord,
    deleteRecord,
    updateMoodRecords,
    restoreMoodBackup,
    getRecordsByDate,
    getRecordByDate,
    getMonthStats,
    addCustomTag,
    removeCustomTag,
    normalizeTags: normalizeMoodTags
  }
})
