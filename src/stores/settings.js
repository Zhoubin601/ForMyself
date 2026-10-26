import { restoreState } from '../platform/storage/restoreState.js'
import { normalizeCommonNotes } from '../services/commonNotes.js'
import { normalizeBackgroundEffects } from '../services/backgroundSettings.js'
import { buildComponentCssVariables, decodeBackground, normalizeComponentTransparency } from '../services/componentAppearance.js'
import { appToast } from '../services/uiFeedback.js'
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { preferenceStorage as Preferences } from '../platform/storage/preferences.js'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { secureCredentials } from '../platform/security/secureCredentials.js'
import { normalizeAutoLockDelay } from '../services/autoLockPolicy.js'
import { normalizeSecuritySettings } from '../services/securitySettings.js'
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
  const commonNotes = ref(normalizeCommonNotes())
  const customBg = ref('')
  const backgroundEffects = ref(normalizeBackgroundEffects())
  const componentTransparency = ref(normalizeComponentTransparency())
  const componentCssVariables = computed(() => buildComponentCssVariables(componentTransparency.value))
  const warmHomeEnabled = ref(true)
  const warmHomePausedAt = ref(0)
  const themeSettings = ref(normalizeThemeSettings())
  const themeCssVariables = computed(() => buildThemeCssVariables(themeSettings.value))
  const currentView = ref('home')
  const settingsScope = ref('general')
  const settingsSection = ref('')
  const settingsReturnView = ref('home')
  const todoTarget = ref({ item: '', date: '' })
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
  const apiKeyStorageStatus = ref('loading')
  let applyingApiKey = false
  let aiSettingsReady = false
  let aiProviderLoaded = false
  let aiSettingsLoadPromise = null
  const autoLockDelaySeconds = ref(0)
  const requireAppUnlock = ref(true)
  let securityLoadPromise = null
  const loadSecuritySettings = () => {
    if (!securityLoadPromise) securityLoadPromise = (async () => {
      try {
        const result = await Preferences.get({ key: STORAGE_KEYS.securitySettings })
        const value = JSON.parse(result.value || '{}')
        requireAppUnlock.value = normalizeSecuritySettings(value).requireAppUnlock
        autoLockDelaySeconds.value = normalizeAutoLockDelay(value.autoLockDelaySeconds)
      } catch {
        requireAppUnlock.value = true
        autoLockDelaySeconds.value = 0
      }
    })()
    return securityLoadPromise
  }
  const notificationSettings = ref(normalizeReminderSettings(DEFAULT_REMINDER_SETTINGS))
  const notificationAiContent = ref(normalizeNotificationAiCache(EMPTY_NOTIFICATION_AI_CACHE))
  const targetWeight = ref(null)
  const heightCm = ref(null)
  const weightChangeReminderEnabled = ref(true)
  const weightChangeThreshold = ref(1)
  const pendingPreferenceWrites = new Map()
  const pendingPreferenceTimers = new Map()
  let pendingApiKey = null
  let apiKeyWritePromise = null
  let apiKeyRevision = 0

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
    if (!isDataLoaded.value || restoreState.blocked) return
    pendingPreferenceWrites.set(key, value)
    const previous = pendingPreferenceTimers.get(key)
    if (previous) globalThis.clearTimeout(previous)
    pendingPreferenceTimers.set(key, globalThis.setTimeout(() => {
      flushPreferenceWrite(key).catch(error => console.warn(`保存设置 ${key} 失败`, error))
    }, delay))
  }
  const flushApiKeyWrite = async () => {
    if (apiKeyWritePromise) {
      await apiKeyWritePromise
      if (pendingApiKey !== null) await flushApiKeyWrite()
      return
    }
    if (pendingApiKey === null || !Capacitor.isNativePlatform()) return
    apiKeyStorageStatus.value = 'saving'
    apiKeyWritePromise = (async () => {
      while (pendingApiKey !== null) {
        const value = pendingApiKey
        const revision = apiKeyRevision
        try {
          await secureCredentials.storeApiKey(value)
        } catch {
          // A newer edit supersedes this failed write; keep saving the latest value.
          if (revision !== apiKeyRevision) continue
          apiKeyStorageStatus.value = 'save-error'
          appToast('API Key 保存失败，请重试保存，成功前请勿关闭应用', { tone: 'danger', duration: 5000 })
          throw new Error('API Key 保存失败，请重试保存')
        }
        if (revision === apiKeyRevision) pendingApiKey = null
      }
      apiKeyStorageStatus.value = aiApiKey.value ? 'saved' : 'empty'
    })().finally(() => { apiKeyWritePromise = null })
    await apiKeyWritePromise
    if (pendingApiKey !== null) await flushApiKeyWrite()
  }
  const flushPendingSettingsWrites = async () => {
    // Unrelated preference failures must not prevent the credential from flushing.
    await Promise.all([
      flushApiKeyWrite(),
      ...[...pendingPreferenceWrites.keys()].map(flushPreferenceWrite)
    ])
  }
  const queueApiKeyWrite = value => {
    if (!isDataLoaded.value || restoreState.blocked || !Capacitor.isNativePlatform()) return
    pendingApiKey = String(value || '')
    apiKeyRevision += 1
    apiKeyStorageStatus.value = 'saving'
    // Begin native storage immediately; the queue coalesces edits during an active write.
    void flushApiKeyWrite().catch(() => {})
  }
  const applyLoadedApiKey = value => {
    applyingApiKey = true
    try { aiApiKey.value = value } finally { applyingApiKey = false }
  }
  const queueAiProviderWrite = () => {
    // Preserve legacy credentials until native migration/readback succeeds.
    if (!aiSettingsReady) return
    const value = { url: aiProviderUrl.value, model: aiModel.value }
    if (!Capacitor.isNativePlatform()) value.key = aiApiKey.value
    queuePreferenceWrite(STORAGE_KEYS.aiProviderSettings, JSON.stringify(value))
  }
  const loadAiSettings = () => {
    if (aiSettingsLoadPromise) return aiSettingsLoadPromise
    aiSettingsReady = false
    apiKeyStorageStatus.value = 'loading'
    aiSettingsLoadPromise = (async () => {
      try {
        const [aiRes, legacyRes] = await Promise.all([
          Preferences.get({ key: STORAGE_KEYS.aiProviderSettings }),
          Preferences.get({ key: STORAGE_KEYS.legacyAiSettings })
        ])
        const current = JSON.parse(aiRes.value || '{}')
        const legacy = JSON.parse(legacyRes.value || '{}')
        if (!aiProviderLoaded) {
          aiProviderUrl.value = current.url || legacy.url || aiProviderUrl.value
          aiModel.value = current.model || legacy.model || aiModel.value
          aiProviderLoaded = true
        }
        let key = current.key || legacy.key || ''
        if (Capacitor.isNativePlatform()) {
          const storedKey = await secureCredentials.getApiKey()
          if (!storedKey && key) await secureCredentials.storeApiKey(key)
          else key = storedKey
          // Never discard the legacy copy before a successful read or verified migration.
          await Preferences.set({
            key: STORAGE_KEYS.aiProviderSettings,
            value: JSON.stringify({ url: aiProviderUrl.value, model: aiModel.value })
          })
          if (legacyRes.value) await Preferences.remove({ key: STORAGE_KEYS.legacyAiSettings })
        }
        applyLoadedApiKey(key)
        aiSettingsReady = true
        apiKeyStorageStatus.value = Capacitor.isNativePlatform() ? (key ? 'saved' : 'empty') : 'ready'
        return true
      } catch {
        apiKeyStorageStatus.value = 'load-error'
        appToast('API Key 读取失败，原配置已保留，请在 AI 服务中重试', { tone: 'danger', duration: 5000 })
        return false
      }
    })().finally(() => { aiSettingsLoadPromise = null })
    return aiSettingsLoadPromise
  }
  const saveAiSettings = async () => {
    if (aiSettingsLoadPromise) await aiSettingsLoadPromise
    if (!aiSettingsReady) throw new Error('API Key 读取失败，请先重试读取')
    await flushApiKeyWrite()
    queueAiProviderWrite()
    await flushPreferenceWrite(STORAGE_KEYS.aiProviderSettings)
  }
  const retryApiKeyStorage = async () => {
    if (apiKeyStorageStatus.value === 'load-error' || apiKeyStorageStatus.value === 'loading') return loadAiSettings()
    try {
      await saveAiSettings()
      return true
    } catch {
      return false
    }
  }

  const viewLabels = {
    home: '首页总览',
    reports: '月度报告',
    debts: '我的省钱计划',
    weight: '体重记录',
    mood: '心情日记',
    chat: '温馨小家',
    schedule: '日程提醒',
    todo: '每日待办',
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
    todoTarget: todoTarget.value,
    scrollTop: routeScrollTop.value
  }))
  const currentRouteKey = computed(() => appRouteKey(currentRoute.value))
  const canGoBack = computed(() => navigationStack.value.length > 0)

  let appearanceLoadPromise = null
  const loadAppearanceSettings = () => {
    if (appearanceLoadPromise) return appearanceLoadPromise
    appearanceLoadPromise = (async () => {
      const [bgRes, effectsRes, transparencyRes, themeRes] = await Promise.all([
        Preferences.get({ key: STORAGE_KEYS.customBackground }),
        Preferences.get({ key: STORAGE_KEYS.backgroundEffects }),
        Preferences.get({ key: STORAGE_KEYS.componentTransparency }),
        Preferences.get({ key: STORAGE_KEYS.themeSettings })
      ])
      const parse = (value, fallback) => {
        try { return value == null ? fallback : JSON.parse(value) } catch { return fallback }
      }
      backgroundEffects.value = normalizeBackgroundEffects(parse(effectsRes.value, {}))
      componentTransparency.value = normalizeComponentTransparency(parse(transparencyRes.value, undefined))
      themeSettings.value = normalizeThemeSettings(parse(themeRes.value, {}))
      if (bgRes.value) {
        try {
          await decodeBackground(bgRes.value)
          customBg.value = bgRes.value
        } catch (error) {
          console.warn('背景图片无法解码，使用默认背景', error)
        }
      }
    })().catch(error => { console.warn('读取外观设置失败，使用默认外观', error) })
    return appearanceLoadPromise
  }

  const loadSettings = async () => {
    try {
      await loadAppearanceSettings()
      const warmHomeRes = await Preferences.get({ key: STORAGE_KEYS.warmHomeEnabled })
      const warmHomeState = warmHomeRes.value ? JSON.parse(warmHomeRes.value) : true
      warmHomePausedAt.value = Math.max(0, Number(warmHomeState?.pausedAt) || 0)
      warmHomeEnabled.value = warmHomeState !== false && warmHomeState?.enabled !== false
      const bannerRes = await Preferences.get({ key: STORAGE_KEYS.bannerSettings })
      if (bannerRes.value) bannerSettings.value = JSON.parse(bannerRes.value)
      await loadAiSettings()
      await loadSecuritySettings()
      const notificationRes = await Preferences.get({ key: STORAGE_KEYS.notificationSettings })
      if (notificationRes.value) {
        notificationSettings.value = normalizeReminderSettings(JSON.parse(notificationRes.value))
      }
      const notificationAiRes = await Preferences.get({ key: STORAGE_KEYS.notificationAiContent })
      if (notificationAiRes.value) {
        notificationAiContent.value = normalizeNotificationAiCache(JSON.parse(notificationAiRes.value))
      }
      const notesResult = await Preferences.get({ key: STORAGE_KEYS.commonNotes })
      commonNotes.value = normalizeCommonNotes(notesResult.value ? JSON.parse(notesResult.value) : {})
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
  watch(backgroundEffects, value => queuePreferenceWrite(STORAGE_KEYS.backgroundEffects, JSON.stringify(normalizeBackgroundEffects(value))), { deep: true })
  watch(componentTransparency, value => queuePreferenceWrite(STORAGE_KEYS.componentTransparency, JSON.stringify(normalizeComponentTransparency(value))))
  watch(themeSettings, value => {
    queuePreferenceWrite(STORAGE_KEYS.themeSettings, JSON.stringify(normalizeThemeSettings(value)))
  }, { deep: true })
  watch([aiProviderUrl, aiModel], queueAiProviderWrite, { flush: 'sync' })
  watch(aiApiKey, value => {
    if (applyingApiKey || !aiSettingsReady) return
    if (Capacitor.isNativePlatform()) queueApiKeyWrite(value)
    else queueAiProviderWrite()
  }, { flush: 'sync' })
  watch(autoLockDelaySeconds, value => {
    queuePreferenceWrite(STORAGE_KEYS.securitySettings, JSON.stringify({ requireAppUnlock: requireAppUnlock.value, autoLockDelaySeconds: normalizeAutoLockDelay(value) }))
  })
  const updateRequireAppUnlock = async value => {
    const previous = requireAppUnlock.value
    await flushPreferenceWrite(STORAGE_KEYS.securitySettings)
    const serialize = required => JSON.stringify({ requireAppUnlock: required, autoLockDelaySeconds: autoLockDelaySeconds.value })
    try {
      await Preferences.set({ key: STORAGE_KEYS.securitySettings, value: serialize(value !== false) })
      const stored = await Preferences.get({ key: STORAGE_KEYS.securitySettings })
      if (JSON.parse(stored.value || '{}').requireAppUnlock !== (value !== false)) throw new Error('SECURITY_SETTINGS_WRITE_FAILED')
      requireAppUnlock.value = value !== false
    } catch (error) {
      await Preferences.set({ key: STORAGE_KEYS.securitySettings, value: serialize(previous) }).catch(() => {})
      throw error
    }
  }
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
    let route = normalizeAppRoute(value, currentView.value)
    if (!warmHomeEnabled.value && (route.view === 'chat' || (route.view === 'settings' && route.settingsScope === 'chat'))) {
      appToast('温馨小家入口已关闭，可在设置中重新开启')
      route = normalizeAppRoute({ view: 'settings', settingsScope: 'general', settingsSection: 'appearance' })
    }
    currentView.value = route.view
    settingsScope.value = route.settingsScope
    settingsSection.value = route.settingsSection
    scheduleTarget.value = route.scheduleTarget
    todoTarget.value = route.todoTarget
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
  const updateBg = async b => {
    if (b) await Preferences.set({ key: STORAGE_KEYS.customBackground, value: b })
    else await Preferences.remove({ key: STORAGE_KEYS.customBackground })
    customBg.value = b
  }
  const updateWarmHomeEnabled = async enabled => {
    const pausedAt = enabled ? warmHomePausedAt.value : Date.now()
    await Preferences.set({ key: STORAGE_KEYS.warmHomeEnabled, value: JSON.stringify({ enabled: Boolean(enabled), pausedAt }) })
    warmHomePausedAt.value = pausedAt
    warmHomeEnabled.value = Boolean(enabled)
  }
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

  watch(commonNotes, value => queuePreferenceWrite(STORAGE_KEYS.commonNotes, JSON.stringify(value), 0), { deep: true })

  const getBackupSnapshot = () => {
    if (!aiSettingsReady) throw new Error('AI 配置尚未读取成功，请重试后再备份')
    return {
      commonNotes: normalizeCommonNotes(commonNotes.value),
      banner: { ...bannerSettings.value },
      customBg: customBg.value,
      backgroundEffects: normalizeBackgroundEffects(backgroundEffects.value),
      componentTransparency: normalizeComponentTransparency(componentTransparency.value),
      warmHomeEnabled: warmHomeEnabled.value,
      warmHomePausedAt: warmHomePausedAt.value,
      theme: { ...themeSettings.value },
      ai: {
        url: aiProviderUrl.value,
        key: aiApiKey.value,
        model: aiModel.value
      },
      autoLockDelaySeconds: autoLockDelaySeconds.value,
      requireAppUnlock: requireAppUnlock.value,
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
    }
  }

  const restoreBackupSnapshot = async (value) => {
    const backup = normalizeFullBackupSettings(value)
    if (aiSettingsLoadPromise) await aiSettingsLoadPromise
    if (Capacitor.isNativePlatform()) {
      await flushApiKeyWrite()
      await secureCredentials.storeApiKey(backup.ai.key)
    }
    commonNotes.value = backup.commonNotes
    bannerSettings.value = backup.banner
    customBg.value = backup.customBg
    backgroundEffects.value = backup.backgroundEffects
    componentTransparency.value = backup.componentTransparency
    warmHomePausedAt.value = backup.warmHomePausedAt
    warmHomeEnabled.value = backup.warmHomeEnabled
    themeSettings.value = backup.theme
    aiProviderUrl.value = backup.ai.url
    applyLoadedApiKey(backup.ai.key)
    aiSettingsReady = true
    apiKeyStorageStatus.value = Capacitor.isNativePlatform() ? (backup.ai.key ? 'saved' : 'empty') : 'ready'
    aiModel.value = backup.ai.model
    autoLockDelaySeconds.value = backup.autoLockDelaySeconds
    requireAppUnlock.value = backup.requireAppUnlock
    notificationSettings.value = backup.notificationSettings
    notificationAiContent.value = backup.notificationAiContent
    updateHealthSettings(backup.health)
    cachedQuote.value = backup.homeCache.cachedQuote
    dataFingerprint.value = backup.homeCache.dataFingerprint
    lastEncouragement.value = backup.homeCache.lastEncouragement

    const writes = [
      Preferences.set({ key: STORAGE_KEYS.backgroundEffects, value: JSON.stringify(backup.backgroundEffects) }),
      Preferences.set({ key: STORAGE_KEYS.componentTransparency, value: JSON.stringify(backup.componentTransparency) }),
      Preferences.set({ key: STORAGE_KEYS.warmHomeEnabled, value: JSON.stringify({ enabled: backup.warmHomeEnabled, pausedAt: backup.warmHomePausedAt }) }),
      Preferences.set({ key: STORAGE_KEYS.commonNotes, value: JSON.stringify(backup.commonNotes) }),
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
        value: JSON.stringify({ requireAppUnlock: backup.requireAppUnlock, autoLockDelaySeconds: backup.autoLockDelaySeconds })
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
      await Preferences.remove({ key: STORAGE_KEYS.legacyAiSettings })
    }
    return backup
  }

  return { apiKeyStorageStatus, saveAiSettings, retryApiKeyStorage, requireAppUnlock, loadSecuritySettings, updateRequireAppUnlock, componentTransparency, componentCssVariables, loadAppearanceSettings, backgroundEffects, warmHomePausedAt, warmHomeEnabled, updateWarmHomeEnabled, todoTarget, commonNotes, bannerSettings, customBg, themeSettings, themeCssVariables, currentView, settingsScope, settingsSection, settingsReturnView, scheduleTarget, isDrawerOpen, navigationStack, navigationRevision, currentRoute, currentRouteKey, canGoBack, isDataLoaded, viewTitle, cachedQuote, dataFingerprint, lastEncouragement, aiProviderUrl, aiApiKey, aiModel, autoLockDelaySeconds, notificationSettings, notificationAiContent, targetWeight, heightCm, weightChangeReminderEnabled, weightChangeThreshold, loadSettings, flushPendingSettingsWrites, navigate, replaceRoute, goBack, updateLastHistoryScroll, updateCurrentRouteScroll, switchView, openGeneralSettingsSection, closeGeneralSettingsSection, openModuleSettings, closeModuleSettings, openScheduleTarget, updateBanner, updateBg, updateThemeSettings, updateHealthSettings, getBackupSnapshot, restoreBackupSnapshot }
})
