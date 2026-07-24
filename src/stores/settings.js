import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import { normalizeAutoLockDelay } from '../services/autoLockPolicy'
import {
  DEFAULT_REMINDER_SETTINGS,
  EMPTY_NOTIFICATION_AI_CACHE,
  normalizeNotificationAiCache,
  normalizeReminderSettings
} from '../services/reminderSchedule'
import { normalizeHealthSettings } from '../services/weightInsights.js'
import { normalizeFullBackupSettings } from '../services/fullBackup.js'

export const useSettingsStore = defineStore('settings', () => {
  const bannerSettings = ref({ prefix: '你已经省下了', suffix: '元', subtitle: '可喜可贺，继续保持。✨', titleSize: 38 })
  const customBg = ref('')
  const currentView = ref('home')
  const settingsScope = ref('general')
  const settingsReturnView = ref('home')
  const scheduleTarget = ref({ item: '', occurrence: '' })
  const isDrawerOpen = ref(false)
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

  const viewLabels = {
    home: '首页总览',
    reports: '月度报告',
    debts: '我的省钱计划',
    weight: '体重记录',
    mood: '心情日记',
    schedule: '日程提醒',
    passwords: '我的密码库',
    settings: '通用配置'
  }
  const viewTitle = computed(() => {
    if (currentView.value === 'settings' && settingsScope.value !== 'general') {
      return `${viewLabels[settingsScope.value] || '模块'}设置`
    }
    return viewLabels[currentView.value]
  })

  const loadSettings = async () => {
    try {
      const bgRes = await Preferences.get({ key: 'my_custom_bg' })
      if (bgRes.value) customBg.value = bgRes.value
      const bannerRes = await Preferences.get({ key: 'my_banner_settings' })
      if (bannerRes.value) bannerSettings.value = JSON.parse(bannerRes.value)
      const aiRes = await Preferences.get({ key: 'my_ai_settings' })
      if (aiRes.value) { const c = JSON.parse(aiRes.value); if (c.url) aiProviderUrl.value = c.url; if (c.key) aiApiKey.value = c.key; if (c.model) aiModel.value = c.model }
      const securityRes = await Preferences.get({ key: 'my_security_settings' })
      if (securityRes.value) {
        const security = JSON.parse(securityRes.value)
        autoLockDelaySeconds.value = normalizeAutoLockDelay(security.autoLockDelaySeconds)
      }
      const notificationRes = await Preferences.get({ key: 'my_notification_settings' })
      if (notificationRes.value) {
        notificationSettings.value = normalizeReminderSettings(JSON.parse(notificationRes.value))
      }
      const notificationAiRes = await Preferences.get({ key: 'my_notification_ai_content' })
      if (notificationAiRes.value) {
        notificationAiContent.value = normalizeNotificationAiCache(JSON.parse(notificationAiRes.value))
      }
      const healthRes = await Preferences.get({ key: 'my_health_settings' })
      if (healthRes.value) {
        const health = normalizeHealthSettings(JSON.parse(healthRes.value))
        targetWeight.value = health.targetWeight
        heightCm.value = health.heightCm
        weightChangeReminderEnabled.value = health.weightChangeReminderEnabled
        weightChangeThreshold.value = health.weightChangeThreshold
      }

      const cacheRes = await Preferences.get({ key: 'my_home_cache' })
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
      await Preferences.set({
        key: 'my_home_cache',
        value: JSON.stringify({ cachedQuote: cachedQuote.value, dataFingerprint: dataFingerprint.value, lastEncouragement: lastEncouragement.value })
      })
    }
  }

  watch(bannerSettings, async (v) => { if (isDataLoaded.value) await Preferences.set({ key: 'my_banner_settings', value: JSON.stringify(v) }) }, { deep: true })
  watch(() => ({ url: aiProviderUrl.value, key: aiApiKey.value, model: aiModel.value }), async (v) => { if (isDataLoaded.value) await Preferences.set({ key: 'my_ai_settings', value: JSON.stringify(v) }) }, { deep: true })
  watch(autoLockDelaySeconds, async (value) => {
    if (isDataLoaded.value) {
      await Preferences.set({
        key: 'my_security_settings',
        value: JSON.stringify({ autoLockDelaySeconds: normalizeAutoLockDelay(value) })
      })
    }
  })
  watch(notificationSettings, async (value) => {
    if (isDataLoaded.value) {
      await Preferences.set({
        key: 'my_notification_settings',
        value: JSON.stringify(normalizeReminderSettings(value))
      })
    }
  }, { deep: true })
  watch(notificationAiContent, async (value) => {
    if (isDataLoaded.value) {
      await Preferences.set({
        key: 'my_notification_ai_content',
        value: JSON.stringify(normalizeNotificationAiCache(value))
      })
    }
  }, { deep: true })
  watch(() => ({
    targetWeight: targetWeight.value,
    heightCm: heightCm.value,
    weightChangeReminderEnabled: weightChangeReminderEnabled.value,
    weightChangeThreshold: weightChangeThreshold.value
  }), async (value) => {
    if (isDataLoaded.value) {
      await Preferences.set({
        key: 'my_health_settings',
        value: JSON.stringify(normalizeHealthSettings(value))
      })
    }
  }, { deep: true })

  watch(cachedQuote, () => persistHomeCache(), { deep: true })
  watch(dataFingerprint, () => persistHomeCache())
  watch(lastEncouragement, () => persistHomeCache())

  const switchView = (view) => {
    if (view === 'settings') settingsScope.value = 'general'
    currentView.value = view
    isDrawerOpen.value = false
  }
  const openModuleSettings = scope => {
    if (!['debts', 'weight', 'mood', 'schedule', 'passwords'].includes(scope)) return
    settingsReturnView.value = currentView.value
    settingsScope.value = scope
    currentView.value = 'settings'
    isDrawerOpen.value = false
  }
  const closeModuleSettings = () => {
    const target = settingsReturnView.value || settingsScope.value || 'home'
    settingsScope.value = 'general'
    currentView.value = target === 'settings' ? 'home' : target
  }
  const openScheduleTarget = (target = {}) => {
    scheduleTarget.value = {
      item: String(target.item || ''),
      occurrence: String(target.occurrence || '')
    }
    switchView('schedule')
  }
  const updateBanner = async (v) => { bannerSettings.value = v; await Preferences.set({ key: 'my_banner_settings', value: JSON.stringify(v) }) }
  const updateBg = async (b) => { customBg.value = b; if (b) await Preferences.set({ key: 'my_custom_bg', value: b }); else await Preferences.remove({ key: 'my_custom_bg' }) }
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
      Preferences.set({ key: 'my_banner_settings', value: JSON.stringify(backup.banner) }),
      Preferences.set({ key: 'my_ai_settings', value: JSON.stringify(backup.ai) }),
      Preferences.set({
        key: 'my_security_settings',
        value: JSON.stringify({ autoLockDelaySeconds: backup.autoLockDelaySeconds })
      }),
      Preferences.set({ key: 'my_notification_settings', value: JSON.stringify(backup.notificationSettings) }),
      Preferences.set({ key: 'my_notification_ai_content', value: JSON.stringify(backup.notificationAiContent) }),
      Preferences.set({ key: 'my_health_settings', value: JSON.stringify(backup.health) }),
      Preferences.set({ key: 'my_home_cache', value: JSON.stringify(backup.homeCache) })
    ]
    if (backup.customBg) {
      writes.push(Preferences.set({ key: 'my_custom_bg', value: backup.customBg }))
    } else {
      writes.push(Preferences.remove({ key: 'my_custom_bg' }))
    }
    await Promise.all(writes)
    return backup
  }

  return { bannerSettings, customBg, currentView, settingsScope, settingsReturnView, scheduleTarget, isDrawerOpen, isDataLoaded, viewTitle, cachedQuote, dataFingerprint, lastEncouragement, aiProviderUrl, aiApiKey, aiModel, autoLockDelaySeconds, notificationSettings, notificationAiContent, targetWeight, heightCm, weightChangeReminderEnabled, weightChangeThreshold, loadSettings, switchView, openModuleSettings, closeModuleSettings, openScheduleTarget, updateBanner, updateBg, updateHealthSettings, getBackupSnapshot, restoreBackupSnapshot }
})
