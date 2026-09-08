import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { preferenceStorage as Preferences } from '../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { secureCredentials } from '../platform/security/secureCredentials.js'
import { normalizeAutoLockDelay } from '../services/autoLockPolicy.js'
import {
  DEFAULT_REMINDER_SETTINGS,
  EMPTY_NOTIFICATION_AI_CACHE,
  normalizeNotificationAiCache,
  normalizeReminderSettings
} from '../services/reminderSchedule.js'
import { normalizeHealthSettings } from '../services/weightInsights.js'
import { normalizeFullBackupSettings } from '../services/fullBackup.js'
import {
  buildThemeCssVariables,
  normalizeThemeSettings
} from '../services/themeSystem.js'
import {
  appRouteKey,
  isSameAppRoute,
  normalizeAppRoute,
  popAppRoute,
  pushAppRoute
} from '../services/navigationHistory.js'

export const useSettingsStore = defineStore('settings', () => {
  const bannerSettings = ref({ prefix: '你已经省下了', suffix: '元', subtitle: '可喜可贺，继续保持。✨', titleSize: 38 })
  const customBg = ref('')
  const themeSettings = ref(normalizeThemeSettings())
  const themeCssVariables = computed(() => buildThemeCssVariables(themeSettings.value))
  const currentView = ref('home')
  const settingsScope = ref('general')
  const settingsSection = ref('')
  const settingsReturnView = ref('home')
  const scheduleTarget = ref({ item: '', occurrence: '' })
  const isDrawerOpen = ref(false)
  const navigationStack = ref([])
  const navigationRevision = ref(0)
  const routeScrollTop = ref(0)
  const isDataLoaded = ref(false)

  const cachedQuote = ref({ text: '早安！今天又是充满希望的一天，记得记录你的心情哦。', date: '' })
  const dataFingerprint = ref('')
  const lastEncouragement = ref('')
  const aiProviderUrl = ref('https://api.deepseek.com')
  const aiApiKey = ref('')
  const aiModel = ref('deepseek-chat')
  const autoLockDelaySeconds = ref(0)
  const notificationSettings = ref(normalizeReminderSettings(DEFAULT_REMINDER_SETTINGS))
  const notificationAiContent = ref(normalizeNotificationAiCache(EMPTY_NOTIFICATION_AI_CACHE))
  const targetWeight = ref(null)
  const heightCm = ref(null)
  const weightChangeReminderEnabled = ref(true)
  const weightChangeThreshold = ref(1)
  const pendingPreferenceWrites = new Map()
  const pendingPreferenceTimers = new Map()
  let pendingApiKey = null
  let apiKeyWriteTimer = null
  let apiKeyWriteChain = Promise.resolve()

  const flushPreferenceWrite = async key => {
    const pending = pendingPreferenceWrites.get(key)
    if (!pending) return
    const timer = pendingPreferenceTimers.get(key)
    if (timer) globalThis.clearTimeout(timer)
    pendingPreferenceTimers.delete(key)
    pendingPreferenceWrites.delete(key)
    await Preferences.set({ key, value: pending })
  }
  const queuePreferenceWrite = (key, value, delay = 300) => {
    if (!isDataLoaded.value) return
    pendingPreferenceWrites.set(key, value)
    const previous = pendingPreferenceTimers.get(key)
    if (previous) globalThis.clearTimeout(previous)
    pendingPreferenceTimers.set(key, globalThis.setTimeout(() => {
      flushPreferenceWrite(key).catch(error => console.warn(`保存设置 ${key} 失败`, error))
    }, delay))
  }
  const flushApiKeyWrite = () => {
    if (pendingApiKey === null || !Capacitor.isNativePlatform()) return apiKeyWriteChain
    const value = pendingApiKey
    pendingApiKey = null
    apiKeyWriteChain = apiKeyWriteChain.catch(() => {}).then(() => secureCredentials.storeApiKey(value))
    return apiKeyWriteChain
  }
  const flushPendingSettingsWrites = async () => {
    await Promise.all([...pendingPreferenceWrites.keys()].map(flushPreferenceWrite))
    if (apiKeyWriteTimer) globalThis.clearTimeout(apiKeyWriteTimer)
    apiKeyWriteTimer = null
    await flushApiKeyWrite()
    await apiKeyWriteChain
  }
  const queueApiKeyWrite = value => {
    if (!isDataLoaded.value || !Capacitor.isNativePlatform()) return
    pendingApiKey = String(value || '')
    if (apiKeyWriteTimer) globalThis.clearTimeout(apiKeyWriteTimer)
    apiKeyWriteTimer = globalThis.setTimeout(() => {
      apiKeyWriteTimer = null
      flushApiKeyWrite().catch(error => console.warn('安全保存 API Key 失败', error))
    }, 500)
  }

  const viewLabels = {
    home: '首页总览',
    reports: '月度报告',
    debts: '我的省钱计划',
    weight: '体重记录',
    mood: '心情日记',
    chat: '温馨小家',
    schedule: '日程提醒',
    passwords: '我的密码库',
    settings: '通用配置'
  }
  const generalSectionLabels = {
    appearance: '外观与首页',
    notifications: '通知与提醒',
    security: '安全与解锁',
    labels: '内容标签',
    health: '健康与趋势',
    data: '数据与备份',
    ai: 'AI 服务',
    widgets: '桌面小组件'
  }
  const viewTitle = computed(() => {
    if (currentView.value === 'settings' && settingsScope.value === 'general' && settingsSection.value) {
      return generalSectionLabels[settingsSection.value] || '通用配置'
    }
    if (currentView.value === 'settings' && settingsScope.value !== 'general') {
      return `${viewLabels[settingsScope.value] || '模块'}设置`
    }
    return viewLabels[currentView.value]
  })
  const currentRoute = computed(() => normalizeAppRoute({
    view: currentView.value,
    settingsScope: settingsScope.value,
    settingsSection: settingsSection.value,
    scheduleTarget: scheduleTarget.value,
    scrollTop: routeScrollTop.value
  }))
  const currentRouteKey = computed(() => appRouteKey(currentRoute.value))
  const canGoBack = computed(() => navigationStack.value.length > 0)

  const loadSettings = async () => {
    try {
      const bgRes = await Preferences.get({ key: STORAGE_KEYS.customBackground })
      if (bgRes.value) customBg.value = bgRes.value
      const themeRes = await Preferences.get({ key: STORAGE_KEYS.themeSettings })
      if (themeRes.value) themeSettings.value = normalizeThemeSettings(JSON.parse(themeRes.value))
      const bannerRes = await Preferences.get({ key: STORAGE_KEYS.bannerSettings })
      if (bannerRes.value) bannerSettings.value = JSON.parse(bannerRes.value)
      const [aiRes, legacyAiRes] = await Promise.all([
        Preferences.get({ key: STORAGE_KEYS.aiProviderSettings }),
        Preferences.get({ key: STORAGE_KEYS.legacyAiSettings })
      ])
      const c = JSON.parse(aiRes.value || legacyAiRes.value || '{}')
      if (c.url) aiProviderUrl.value = c.url
      if (c.model) aiModel.value = c.model
      if (Capacitor.isNativePlatform()) {
        let secureApiKey = await secureCredentials.getApiKey().catch(() => '')
        if (!secureApiKey && c.key) {
          await secureCredentials.storeApiKey(c.key)
          secureApiKey = await secureCredentials.getApiKey()
        }
        aiApiKey.value = secureApiKey
        await Preferences.set({
          key: STORAGE_KEYS.aiProviderSettings,
          value: JSON.stringify({ url: aiProviderUrl.value, model: aiModel.value })
        })
        if (legacyAiRes.value) await Preferences.remove({ key: STORAGE_KEYS.legacyAiSettings })
      } else if (c.key) {
        aiApiKey.value = c.key
      }
      const securityRes = await Preferences.get({ key: STORAGE_KEYS.securitySettings })
      if (securityRes.value) {
        const security = JSON.parse(securityRes.value)
        autoLockDelaySeconds.value = normalizeAutoLockDelay(security.autoLockDelaySeconds)
      }
      const notificationRes = await Preferences.get({ key: STORAGE_KEYS.notificationSettings })
      if (notificationRes.value) {
        notificationSettings.value = normalizeReminderSettings(JSON.parse(notificationRes.value))
      }
      const notificationAiRes = await Preferences.get({ key: STORAGE_KEYS.notificationAiContent })
      if (notificationAiRes.value) {
        notificationAiContent.value = normalizeNotificationAiCache(JSON.parse(notificationAiRes.value))
      }
      const healthRes = await Preferences.get({ key: STORAGE_KEYS.healthSettings })
      if (healthRes.value) {
        const health = normalizeHealthSettings(JSON.parse(healthRes.value))
        targetWeight.value = health.targetWeight
        heightCm.value = health.heightCm
        weightChangeReminderEnabled.value = health.weightChangeReminderEnabled
        weightChangeThreshold.value = health.weightChangeThreshold
      }

      const cacheRes = await Preferences.get({ key: STORAGE_KEYS.homeCache })
      if (cacheRes.value) {
        const c = JSON.parse(cacheRes.value)
        if (c.cachedQuote) cachedQuote.value = c.cachedQuote
        if (c.dataFingerprint) dataFingerprint.value = c.dataFingerprint
        if (c.lastEncouragement) lastEncouragement.value = c.lastEncouragement
      }
    } catch (e) { console.error('读取设置数据失败', e) } finally { isDataLoaded.value = true }
  }

  const persistHomeCache = async () => {
    if (isDataLoaded.value) {
      queuePreferenceWrite(STORAGE_KEYS.homeCache, JSON.stringify({ cachedQuote: cachedQuote.value, dataFingerprint: dataFingerprint.value, lastEncouragement: lastEncouragement.value }))
    }
  }

  watch(bannerSettings, v => queuePreferenceWrite(STORAGE_KEYS.bannerSettings, JSON.stringify(v)), { deep: true })
  watch(themeSettings, value => {
    queuePreferenceWrite(STORAGE_KEYS.themeSettings, JSON.stringify(normalizeThemeSettings(value)))
  }, { deep: true })
  watch(() => ({ url: aiProviderUrl.value, key: aiApiKey.value, model: aiModel.value }), value => {
    const persisted = Capacitor.isNativePlatform()
      ? { url: value.url, model: value.model }
      : value
    queuePreferenceWrite(STORAGE_KEYS.aiProviderSettings, JSON.stringify(persisted))
    queueApiKeyWrite(value.key)
  }, { deep: true })
  watch(autoLockDelaySeconds, value => {
    queuePreferenceWrite(STORAGE_KEYS.securitySettings, JSON.stringify({ autoLockDelaySeconds: normalizeAutoLockDelay(value) }))
  })
  watch(notificationSettings, value => {
    queuePreferenceWrite(STORAGE_KEYS.notificationSettings, JSON.stringify(normalizeReminderSettings(value)))
  }, { deep: true })
  watch(notificationAiContent, value => {
    queuePreferenceWrite(STORAGE_KEYS.notificationAiContent, JSON.stringify(normalizeNotificationAiCache(value)))
  }, { deep: true })
  watch(() => ({
    targetWeight: targetWeight.value,
    heightCm: heightCm.value,
    weightChangeReminderEnabled: weightChangeReminderEnabled.value,
    weightChangeThreshold: weightChangeThreshold.value
  }), value => {
    queuePreferenceWrite(STORAGE_KEYS.healthSettings, JSON.stringify(normalizeHealthSettings(value)))
  }, { deep: true })

  watch(cachedQuote, () => persistHomeCache(), { deep: true })
  watch(dataFingerprint, () => persistHomeCache())
  watch(lastEncouragement, () => persistHomeCache())

  const applyRoute = value => {
    const route = normalizeAppRoute(value, currentView.value)
    currentView.value = route.view
    settingsScope.value = route.settingsScope
    settingsSection.value = route.settingsSection
    scheduleTarget.value = route.scheduleTarget
    routeScrollTop.value = route.scrollTop
    isDrawerOpen.value = false
    navigationRevision.value += 1
    return route
  }
  const navigate = (value, options = {}) => {
    const target = normalizeAppRoute(value, currentView.value)
    if (isSameAppRoute(currentRoute.value, target)) {
      isDrawerOpen.value = false
      return false
    }
    if (!options.replace) {
      navigationStack.value = pushAppRoute(
        navigationStack.value,
        {
          ...currentRoute.value,
          scrollTop: options.currentScrollTop ?? currentRoute.value.scrollTop
        },
        target
      )
    }
    applyRoute(target)
    return true
  }
  const replaceRoute = value => navigate(value, { replace: true })
  const goBack = () => {
    const popped = popAppRoute(navigationStack.value)
    if (!popped.route) return null
    navigationStack.value = popped.stack
    return applyRoute(popped.route)
  }
  const updateLastHistoryScroll = value => {
    if (!navigationStack.value.length) return
    const index = navigationStack.value.length - 1
    navigationStack.value[index] = {
      ...navigationStack.value[index],
      scrollTop: Math.max(0, Number(value) || 0)
    }
  }
  const updateCurrentRouteScroll = value => {
    routeScrollTop.value = Math.max(0, Number(value) || 0)
  }
  const switchView = view => navigate({ view, settingsScope: view === 'settings' ? 'general' : undefined })
  const openGeneralSettingsSection = section => navigate({
    view: 'settings',
    settingsScope: 'general',
    settingsSection: section
  })
  const closeGeneralSettingsSection = () => {
    if (settingsScope.value !== 'general' || !settingsSection.value) return false
    if (canGoBack.value) return !!goBack()
    return replaceRoute({ view: 'settings', settingsScope: 'general' })
  }
  const openModuleSettings = scope => {
    if (!['debts', 'weight', 'mood', 'schedule', 'passwords', 'chat'].includes(scope)) return
    settingsReturnView.value = currentView.value
    navigate({ view: 'settings', settingsScope: scope })
  }
  const closeModuleSettings = () => {
    if (canGoBack.value) return goBack()
    const target = settingsReturnView.value || settingsScope.value || 'home'
    return replaceRoute({ view: target === 'settings' ? 'home' : target })
  }
  const openScheduleTarget = (target = {}) => {
    const nextTarget = {
      item: String(target.item || ''),
      occurrence: String(target.occurrence || '')
    }
    navigate({ view: 'schedule', scheduleTarget: nextTarget })
  }
  const updateBanner = async (v) => { bannerSettings.value = v; queuePreferenceWrite(STORAGE_KEYS.bannerSettings, JSON.stringify(v)) }
  const updateBg = async (b) => { customBg.value = b; if (b) await Preferences.set({ key: STORAGE_KEYS.customBackground, value: b }); else await Preferences.remove({ key: STORAGE_KEYS.customBackground }) }
  const updateThemeSettings = async value => {
    themeSettings.value = normalizeThemeSettings(value)
    queuePreferenceWrite(STORAGE_KEYS.themeSettings, JSON.stringify(themeSettings.value))
  }
  const updateHealthSettings = (value) => {
    const health = normalizeHealthSettings(value)
    targetWeight.value = health.targetWeight
    heightCm.value = health.heightCm
    weightChangeReminderEnabled.value = health.weightChangeReminderEnabled
    weightChangeThreshold.value = health.weightChangeThreshold
  }

  const getBackupSnapshot = () => ({
    banner: { ...bannerSettings.value },
    customBg: customBg.value,
    theme: { ...themeSettings.value },
    ai: {
      url: aiProviderUrl.value,
      key: aiApiKey.value,
      model: aiModel.value
    },
    autoLockDelaySeconds: autoLockDelaySeconds.value,
    notificationSettings: notificationSettings.value,
    notificationAiContent: notificationAiContent.value,
    health: {
      targetWeight: targetWeight.value,
      heightCm: heightCm.value,
      weightChangeReminderEnabled: weightChangeReminderEnabled.value,
      weightChangeThreshold: weightChangeThreshold.value
    },
    homeCache: {
      cachedQuote: cachedQuote.value,
      dataFingerprint: dataFingerprint.value,
      lastEncouragement: lastEncouragement.value
    }
  })

  const restoreBackupSnapshot = async (value) => {
    const backup = normalizeFullBackupSettings(value)
    bannerSettings.value = backup.banner
    customBg.value = backup.customBg
    themeSettings.value = backup.theme
    aiProviderUrl.value = backup.ai.url
    aiApiKey.value = backup.ai.key
    aiModel.value = backup.ai.model
    autoLockDelaySeconds.value = backup.autoLockDelaySeconds
    notificationSettings.value = backup.notificationSettings
    notificationAiContent.value = backup.notificationAiContent
    updateHealthSettings(backup.health)
    cachedQuote.value = backup.homeCache.cachedQuote
    dataFingerprint.value = backup.homeCache.dataFingerprint
    lastEncouragement.value = backup.homeCache.lastEncouragement

    const writes = [
      Preferences.set({ key: STORAGE_KEYS.bannerSettings, value: JSON.stringify(backup.banner) }),
      Preferences.set({ key: STORAGE_KEYS.themeSettings, value: JSON.stringify(backup.theme) }),
      Preferences.set({
        key: STORAGE_KEYS.aiProviderSettings,
        value: JSON.stringify(Capacitor.isNativePlatform()
          ? { url: backup.ai.url, model: backup.ai.model }
          : backup.ai)
      }),
      Preferences.set({
        key: STORAGE_KEYS.securitySettings,
        value: JSON.stringify({ autoLockDelaySeconds: backup.autoLockDelaySeconds })
      }),
      Preferences.set({ key: STORAGE_KEYS.notificationSettings, value: JSON.stringify(backup.notificationSettings) }),
      Preferences.set({ key: STORAGE_KEYS.notificationAiContent, value: JSON.stringify(backup.notificationAiContent) }),
      Preferences.set({ key: STORAGE_KEYS.healthSettings, value: JSON.stringify(backup.health) }),
      Preferences.set({ key: STORAGE_KEYS.homeCache, value: JSON.stringify(backup.homeCache) })
    ]
    if (backup.customBg) {
      writes.push(Preferences.set({ key: STORAGE_KEYS.customBackground, value: backup.customBg }))
    } else {
      writes.push(Preferences.remove({ key: STORAGE_KEYS.customBackground }))
    }
    await Promise.all(writes)
    if (Capacitor.isNativePlatform()) {
      await secureCredentials.storeApiKey(backup.ai.key)
      await Preferences.remove({ key: STORAGE_KEYS.legacyAiSettings })
    }
    return backup
  }

  return { bannerSettings, customBg, themeSettings, themeCssVariables, currentView, settingsScope, settingsSection, settingsReturnView, scheduleTarget, isDrawerOpen, navigationStack, navigationRevision, currentRoute, currentRouteKey, canGoBack, isDataLoaded, viewTitle, cachedQuote, dataFingerprint, lastEncouragement, aiProviderUrl, aiApiKey, aiModel, autoLockDelaySeconds, notificationSettings, notificationAiContent, targetWeight, heightCm, weightChangeReminderEnabled, weightChangeThreshold, loadSettings, flushPendingSettingsWrites, navigate, replaceRoute, goBack, updateLastHistoryScroll, updateCurrentRouteScroll, switchView, openGeneralSettingsSection, closeGeneralSettingsSection, openModuleSettings, closeModuleSettings, openScheduleTarget, updateBanner, updateBg, updateThemeSettings, updateHealthSettings, getBackupSnapshot, restoreBackupSnapshot }
})
