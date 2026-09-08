import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { preferenceStorage as Preferences } from '../../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../../platform/storage/keys.js'
import {
  BUILT_IN_MOOD_TAGS,
  DEFAULT_MOOD_DEFINITIONS,
  DEFAULT_MOOD_TAG,
  compareMoodRecordsNewestFirst,
  getDefaultMoodDefinition,
  getCustomMoodTags,
  mergeMoodDefinitions,
  normalizeMoodColor,
  normalizeMoodDefinitions,
  normalizeMoodEmoji,
  normalizeMoodLabel,
  normalizeMoodRecord,
  normalizeMoodRecords,
  normalizeMoodTag,
  normalizeMoodTags,
  resolveMoodDefinition
} from './moodRecords.js'

export const useMoodStore = defineStore('mood', () => {
  const moodRecords = ref([])
  const isDataLoaded = ref(false)
  const trackingStartDate = ref('')
  const customTags = ref([])
  const moodDefinitions = ref(DEFAULT_MOOD_DEFINITIONS.map(item => ({ ...item })))

  const STORAGE_KEY = STORAGE_KEYS.moodRecords
  const START_DATE_KEY = STORAGE_KEYS.moodTrackingStartDate
  const CUSTOM_TAGS_KEY = STORAGE_KEYS.moodCustomTags
  const MOOD_DEFINITIONS_KEY = STORAGE_KEYS.moodDefinitions

  const activeMoodDefinitions = computed(() => moodDefinitions.value.filter(item => !item.archived))
  const defaultMoodDefinition = computed(() => getDefaultMoodDefinition(moodDefinitions.value))

  const formatLocalDate = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const loadMoodRecords = async () => {
    try {
      const [{ value }, startResult, customTagsResult, definitionsResult] = await Promise.all([
        Preferences.get({ key: STORAGE_KEY }),
        Preferences.get({ key: START_DATE_KEY }),
        Preferences.get({ key: CUSTOM_TAGS_KEY }),
        Preferences.get({ key: MOOD_DEFINITIONS_KEY })
      ])
      let parsed = []
      if (value) {
        parsed = JSON.parse(value)
        moodRecords.value = normalizeMoodRecords(parsed)
        if (JSON.stringify(parsed) !== JSON.stringify(moodRecords.value)) {
          await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(moodRecords.value) })
        }
      }

      const savedDefinitions = definitionsResult.value ? JSON.parse(definitionsResult.value) : []
      moodDefinitions.value = normalizeMoodDefinitions(savedDefinitions, moodRecords.value)
      await Preferences.set({ key: MOOD_DEFINITIONS_KEY, value: JSON.stringify(moodDefinitions.value) })

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

  watch(
    moodDefinitions,
    async (newVal) => {
      if (isDataLoaded.value) {
        await Preferences.set({ key: MOOD_DEFINITIONS_KEY, value: JSON.stringify(newVal) })
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
          mood: defaultMoodDefinition.value.id,
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

  const addRecord = (date, mood = defaultMoodDefinition.value.id, note = '', tags = [DEFAULT_MOOD_TAG]) => {
    const record = normalizeMoodRecord({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date,
      mood,
      note,
      tags,
      createdAt: Date.now(),
      autoFilled: false
    }, undefined, defaultMoodDefinition.value.id)

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
      }, undefined, defaultMoodDefinition.value.id)
      syncCustomTagsFromRecords()
    }
  }

  const deleteRecord = (id) => {
    moodRecords.value = moodRecords.value.filter(r => r.id !== id)
  }

  const updateMoodRecords = (newList, definitions = moodDefinitions.value) => {
    const baseDefinitions = normalizeMoodDefinitions(definitions)
    const defaultMoodId = getDefaultMoodDefinition(baseDefinitions).id
    moodRecords.value = normalizeMoodRecords(newList, undefined, defaultMoodId)
    moodDefinitions.value = normalizeMoodDefinitions(baseDefinitions, moodRecords.value)
    syncCustomTagsFromRecords()
  }

  const restoreMoodBackup = async (records, metadata = {}) => {
    const baseDefinitions = normalizeMoodDefinitions(metadata.definitions)
    const defaultMoodId = getDefaultMoodDefinition(baseDefinitions).id
    moodRecords.value = normalizeMoodRecords(records, undefined, defaultMoodId)
    moodDefinitions.value = normalizeMoodDefinitions(baseDefinitions, moodRecords.value)
    customTags.value = getCustomMoodTags(moodRecords.value, metadata.customTags)
    const existingDates = moodRecords.value.map(record => record.date).filter(Boolean).sort()
    trackingStartDate.value = /^\d{4}-\d{2}-\d{2}$/.test(String(metadata.trackingStartDate || ''))
      ? metadata.trackingStartDate
      : existingDates[0] || formatLocalDate(new Date())
    await Preferences.set({ key: START_DATE_KEY, value: trackingStartDate.value })
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(moodRecords.value) })
    await Preferences.set({ key: CUSTOM_TAGS_KEY, value: JSON.stringify(customTags.value) })
    await Preferences.set({ key: MOOD_DEFINITIONS_KEY, value: JSON.stringify(moodDefinitions.value) })
  }

  const mergeMoodBackup = async (records, metadata = {}) => {
    const mergedRecords = normalizeMoodRecords(
      [...moodRecords.value, ...(Array.isArray(records) ? records : [])],
      undefined,
      defaultMoodDefinition.value.id
    )
    moodDefinitions.value = mergeMoodDefinitions(moodDefinitions.value, metadata.definitions, mergedRecords)
    moodRecords.value = mergedRecords
    customTags.value = getCustomMoodTags(moodRecords.value, [...customTags.value, ...(metadata.customTags || [])])
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(moodRecords.value) })
    await Preferences.set({ key: CUSTOM_TAGS_KEY, value: JSON.stringify(customTags.value) })
    await Preferences.set({ key: MOOD_DEFINITIONS_KEY, value: JSON.stringify(moodDefinitions.value) })
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

  const getMoodDefinition = id => resolveMoodDefinition(moodDefinitions.value, id)

  const validateMoodDefinitionInput = (input, excludeId = '') => {
    const label = normalizeMoodLabel(input?.label)
    const emoji = normalizeMoodEmoji(input?.emoji)
    const color = normalizeMoodColor(input?.color, '')
    if (!label) return { ok: false, reason: 'INVALID_LABEL' }
    if (!emoji) return { ok: false, reason: 'INVALID_EMOJI' }
    if (!color) return { ok: false, reason: 'INVALID_COLOR' }
    if (moodDefinitions.value.some(item => item.id !== excludeId && item.label === label)) {
      return { ok: false, reason: 'DUPLICATE_LABEL' }
    }
    return { ok: true, value: { label, emoji, color } }
  }

  const addMoodDefinition = input => {
    const validated = validateMoodDefinitionInput(input)
    if (!validated.ok) return validated
    const id = `mood_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const definition = {
      id,
      ...validated.value,
      order: moodDefinitions.value.length,
      archived: false,
      isDefault: false
    }
    moodDefinitions.value = normalizeMoodDefinitions([...moodDefinitions.value, definition], moodRecords.value)
    return { ok: true, definition: getMoodDefinition(id) }
  }

  const updateMoodDefinition = (id, input) => {
    const existing = moodDefinitions.value.find(item => item.id === id)
    if (!existing) return { ok: false, reason: 'NOT_FOUND' }
    const validated = validateMoodDefinitionInput(input, id)
    if (!validated.ok) return validated
    moodDefinitions.value = normalizeMoodDefinitions(moodDefinitions.value.map(item => (
      item.id === id ? { ...item, ...validated.value } : item
    )), moodRecords.value)
    return { ok: true, definition: getMoodDefinition(id) }
  }

  const reorderMoodDefinitions = orderedActiveIds => {
    const activeIds = activeMoodDefinitions.value.map(item => item.id)
    if (!Array.isArray(orderedActiveIds) || orderedActiveIds.length !== activeIds.length) return false
    if (new Set(orderedActiveIds).size !== activeIds.length || activeIds.some(id => !orderedActiveIds.includes(id))) return false
    const activeById = new Map(activeMoodDefinitions.value.map(item => [item.id, item]))
    const archived = moodDefinitions.value.filter(item => item.archived)
    moodDefinitions.value = normalizeMoodDefinitions([
      ...orderedActiveIds.map((id, order) => ({ ...activeById.get(id), order })),
      ...archived.map((item, index) => ({ ...item, order: orderedActiveIds.length + index }))
    ], moodRecords.value)
    return true
  }

  const setDefaultMoodDefinition = id => {
    const target = moodDefinitions.value.find(item => item.id === id && !item.archived)
    if (!target) return false
    moodDefinitions.value = moodDefinitions.value.map(item => ({ ...item, isDefault: item.id === id }))
    return true
  }

  const archiveMoodDefinition = id => {
    const target = moodDefinitions.value.find(item => item.id === id)
    if (!target) return { ok: false, reason: 'NOT_FOUND' }
    if (target.isDefault) return { ok: false, reason: 'DEFAULT' }
    if (target.archived) return { ok: true }
    if (activeMoodDefinitions.value.length <= 1) return { ok: false, reason: 'LAST_ACTIVE' }
    moodDefinitions.value = normalizeMoodDefinitions(moodDefinitions.value.map(item => (
      item.id === id ? { ...item, archived: true } : item
    )), moodRecords.value)
    return { ok: true }
  }

  const restoreMoodDefinition = id => {
    if (!moodDefinitions.value.some(item => item.id === id)) return false
    moodDefinitions.value = normalizeMoodDefinitions(moodDefinitions.value.map(item => (
      item.id === id ? { ...item, archived: false } : item
    )), moodRecords.value)
    return true
  }

  const deleteMoodDefinition = id => {
    const target = moodDefinitions.value.find(item => item.id === id)
    if (!target) return { ok: false, reason: 'NOT_FOUND' }
    if (target.isDefault) return { ok: false, reason: 'DEFAULT' }
    if (moodRecords.value.some(record => record.mood === id)) return { ok: false, reason: 'IN_USE' }
    if (!target.archived && activeMoodDefinitions.value.length <= 1) return { ok: false, reason: 'LAST_ACTIVE' }
    moodDefinitions.value = normalizeMoodDefinitions(moodDefinitions.value.filter(item => item.id !== id), moodRecords.value)
    return { ok: true }
  }

  const getMonthStats = (year, month) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    const monthRecs = moodRecords.value.filter(r => r.date.startsWith(prefix))
    const stats = Object.fromEntries(moodDefinitions.value.map(item => [item.id, 0]))
    stats.total = monthRecs.length
    monthRecs.forEach(r => {
      if (stats[r.mood] !== undefined) stats[r.mood]++
    })
    return stats
  }

  return {
    moodRecords,
    moodDefinitions,
    activeMoodDefinitions,
    defaultMoodDefinition,
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
    mergeMoodBackup,
    getRecordsByDate,
    getRecordByDate,
    getMonthStats,
    getMoodDefinition,
    addMoodDefinition,
    updateMoodDefinition,
    reorderMoodDefinitions,
    setDefaultMoodDefinition,
    archiveMoodDefinition,
    restoreMoodDefinition,
    deleteMoodDefinition,
    addCustomTag,
    removeCustomTag,
    normalizeTags: normalizeMoodTags
  }
})
