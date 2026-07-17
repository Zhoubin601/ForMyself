import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'

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

  const viewTitle = computed(() => ({ home: '首页总览', debts: '我的省钱计划', weight: '体重记录', mood: '心情日记', passwords: '我的密码库', settings: '通用配置' })[currentView.value])

  const loadSettings = async () => {
    try {
      const bgRes = await Preferences.get({ key: 'my_custom_bg' })
      if (bgRes.value) customBg.value = bgRes.value
      const bannerRes = await Preferences.get({ key: 'my_banner_settings' })
      if (bannerRes.value) bannerSettings.value = JSON.parse(bannerRes.value)
      const aiRes = await Preferences.get({ key: 'my_ai_settings' })
      if (aiRes.value) { const c = JSON.parse(aiRes.value); if (c.url) aiProviderUrl.value = c.url; if (c.key) aiApiKey.value = c.key; if (c.model) aiModel.value = c.model }

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

  watch(cachedQuote, () => persistHomeCache(), { deep: true })
  watch(dataFingerprint, () => persistHomeCache())
  watch(lastEncouragement, () => persistHomeCache())

  const switchView = (view) => { currentView.value = view; isDrawerOpen.value = false }
  const updateBanner = async (v) => { bannerSettings.value = v; await Preferences.set({ key: 'my_banner_settings', value: JSON.stringify(v) }) }
  const updateBg = async (b) => { customBg.value = b; if (b) await Preferences.set({ key: 'my_custom_bg', value: b }); else await Preferences.remove({ key: 'my_custom_bg' }) }

  return { bannerSettings, customBg, currentView, isDrawerOpen, isDataLoaded, viewTitle, cachedQuote, dataFingerprint, lastEncouragement, aiProviderUrl, aiApiKey, aiModel, loadSettings, switchView, updateBanner, updateBg }
})
