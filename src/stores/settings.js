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

export const useSettingsStore = defineStore('settings', () => {
  const bannerSettings = ref({ prefix: '你已经省下了', suffix: '元', subtitle: '可喜可贺，继续保持。✨', titleSize: 38 })
  const customBg = ref('')
  const currentView = ref('home')
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

  const viewTitle = computed(() => ({ home: '首页总览', reports: '月度报告', debts: '我的省钱计划', weight: '体重记录', mood: '心情日记', passwords: '我的密码库', settings: '通用配置' })[currentView.value])

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
        const health = JSON.parse(healthRes.value)
        const parsedTarget = Number(health.targetWeight)
        targetWeight.value = Number.isFinite(parsedTarget) && parsedTarget >= 20 && parsedTarget <= 300
          ? parsedTarget
          : null
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
  watch(targetWeight, async (value) => {
    if (isDataLoaded.value) {
      const parsed = Number(value)
      await Preferences.set({
        key: 'my_health_settings',
        value: JSON.stringify({
          targetWeight: Number.isFinite(parsed) && parsed >= 20 && parsed <= 300 ? parsed : null
        })
      })
    }
  })

  watch(cachedQuote, () => persistHomeCache(), { deep: true })
  watch(dataFingerprint, () => persistHomeCache())
  watch(lastEncouragement, () => persistHomeCache())

  const switchView = (view) => { currentView.value = view; isDrawerOpen.value = false }
  const updateBanner = async (v) => { bannerSettings.value = v; await Preferences.set({ key: 'my_banner_settings', value: JSON.stringify(v) }) }
  const updateBg = async (b) => { customBg.value = b; if (b) await Preferences.set({ key: 'my_custom_bg', value: b }); else await Preferences.remove({ key: 'my_custom_bg' }) }

  return { bannerSettings, customBg, currentView, isDrawerOpen, isDataLoaded, viewTitle, cachedQuote, dataFingerprint, lastEncouragement, aiProviderUrl, aiApiKey, aiModel, autoLockDelaySeconds, notificationSettings, notificationAiContent, targetWeight, loadSettings, switchView, updateBanner, updateBg }
})
