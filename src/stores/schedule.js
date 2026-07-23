import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { Preferences } from '@capacitor/preferences'
import {
  BUILT_IN_SCHEDULE_CATEGORIES,
  SCHEDULE_STORAGE_KEY,
  SCHEDULE_WIDGET_SNAPSHOT_KEY,
  addDays,
  buildScheduleWidgetSnapshot,
  countScheduleCategoryUsage,
  createScheduleSeries,
  formatLocalDate,
  generateOccurrences,
  getOccurrenceKey,
  normalizeScheduleCategory,
  normalizeScheduleData,
  normalizeScheduleSeries,
  splitSeriesAt,
  upsertOccurrenceState
} from '../services/scheduleCore.js'

export const useScheduleStore = defineStore('schedule', () => {
  const series = ref([])
  const occurrences = ref([])
  const categories = ref(BUILT_IN_SCHEDULE_CATEGORIES.map(item => ({ ...item })))
  const isDataLoaded = ref(false)

  const snapshot = computed(() => ({
    series: series.value,
    occurrences: occurrences.value,
    categories: categories.value
  }))

  const persist = async () => {
    if (!isDataLoaded.value) return
    const data = normalizeScheduleData(snapshot.value)
    await Promise.all([
      Preferences.set({ key: SCHEDULE_STORAGE_KEY, value: JSON.stringify(data) }),
      Preferences.set({
        key: SCHEDULE_WIDGET_SNAPSHOT_KEY,
        value: JSON.stringify(buildScheduleWidgetSnapshot(data))
      })
    ])
  }

  const loadSchedules = async () => {
    try {
      const { value } = await Preferences.get({ key: SCHEDULE_STORAGE_KEY })
      const data = normalizeScheduleData(value ? JSON.parse(value) : {})
      series.value = data.series
      occurrences.value = data.occurrences
      categories.value = data.categories
    } catch (error) {
      console.error('读取日程数据失败', error)
    } finally {
      isDataLoaded.value = true
      await persist()
    }
  }

  watch(snapshot, persist, { deep: true })

  const getOccurrences = (fromDate, toDate, now = new Date()) =>
    generateOccurrences(snapshot.value, fromDate, toDate, now)

  const upcoming = computed(() => {
    const today = formatLocalDate()
    return getOccurrences(today, addDays(today, 30)).filter(item => !item.historical)
  })

  const todayUpcoming = computed(() => {
    const today = formatLocalDate()
    return getOccurrences(today, today).filter(item => !item.historical)
  })

  const addSeries = input => {
    const item = createScheduleSeries(input)
    series.value.push(item)
    return item
  }

  const updateSeries = (seriesId, changes, scope = 'all', occurrenceDate = '') => {
    const index = series.value.findIndex(item => item.id === seriesId)
    if (index < 0) return null
    const current = series.value[index]
    if (scope === 'single' && occurrenceDate) {
      const key = getOccurrenceKey(seriesId, occurrenceDate)
      occurrences.value = upsertOccurrenceState(occurrences.value, {
        key,
        seriesId,
        originalDate: occurrenceDate,
        status: 'override',
        override: changes,
        updatedAt: Date.now()
      })
      return current
    }
    if (scope === 'future' && occurrenceDate && occurrenceDate > current.startDate) {
      const { previous, successor } = splitSeriesAt(current, occurrenceDate, changes)
      series.value.splice(index, 1, previous, successor)
      return successor
    }
    const updated = normalizeScheduleSeries({ ...current, ...changes, id: current.id, updatedAt: Date.now() })
    series.value.splice(index, 1, updated)
    return updated
  }

  const deleteSeries = (seriesId, scope = 'all', occurrenceDate = '') => {
    const index = series.value.findIndex(item => item.id === seriesId)
    if (index < 0) return false
    const current = series.value[index]
    if (scope === 'single' && occurrenceDate) {
      const key = getOccurrenceKey(seriesId, occurrenceDate)
      occurrences.value = upsertOccurrenceState(occurrences.value, {
        key,
        seriesId,
        originalDate: occurrenceDate,
        status: 'cancelled',
        updatedAt: Date.now()
      })
      return true
    }
    if (scope === 'future' && occurrenceDate && occurrenceDate > current.startDate) {
      series.value.splice(index, 1, normalizeScheduleSeries({
        ...current,
        endsOn: addDays(occurrenceDate, -1),
        updatedAt: Date.now()
      }))
      return true
    }
    series.value.splice(index, 1)
    occurrences.value = occurrences.value.filter(item => item.seriesId !== seriesId)
    return true
  }

  const completeOccurrence = occurrence => {
    occurrences.value = upsertOccurrenceState(occurrences.value, {
      key: occurrence.key,
      seriesId: occurrence.seriesId,
      originalDate: occurrence.originalDate,
      status: 'completed',
      completedAt: Date.now(),
      updatedAt: Date.now()
    })
  }

  const reopenOccurrence = occurrence => {
    occurrences.value = occurrences.value.filter(item => item.key !== occurrence.key)
  }

  const addCategory = input => {
    const category = normalizeScheduleCategory({
      ...input,
      id: `custom-${Date.now().toString(36)}`,
      builtIn: false
    })
    if (categories.value.some(item => item.name === category.name)) return null
    categories.value.push(category)
    return category
  }

  const deleteCategory = id => {
    if (BUILT_IN_SCHEDULE_CATEGORIES.some(item => item.id === id)) {
      return { ok: false, reason: 'PROTECTED', usageCount: 0 }
    }
    const usageCount = countScheduleCategoryUsage(snapshot.value, id)
    if (usageCount > 0) return { ok: false, reason: 'IN_USE', usageCount }
    if (!categories.value.some(item => item.id === id)) {
      return { ok: false, reason: 'NOT_FOUND', usageCount: 0 }
    }
    categories.value = categories.value.filter(item => item.id !== id)
    return { ok: true, usageCount: 0 }
  }

  const categoryUsageCount = id => countScheduleCategoryUsage(snapshot.value, id)

  const restoreScheduleData = async value => {
    const data = normalizeScheduleData(value)
    series.value = data.series
    occurrences.value = data.occurrences
    categories.value = data.categories
    isDataLoaded.value = true
    await persist()
    return data
  }

  return {
    series,
    occurrences,
    categories,
    isDataLoaded,
    snapshot,
    upcoming,
    todayUpcoming,
    loadSchedules,
    getOccurrences,
    addSeries,
    updateSeries,
    deleteSeries,
    completeOccurrence,
    reopenOccurrence,
    addCategory,
    categoryUsageCount,
    deleteCategory,
    restoreScheduleData,
    persist
  }
})
