import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../src/stores/settings.js'
import { useChatStore } from '../src/features/chat/chatStore.js'
import { useAppearanceSettings } from '../src/composables/settings/useAppearanceSettings.js'
import SettingsAppearance from '../src/components/settings/SettingsAppearance.vue'
import HomeView from '../src/components/HomeView.vue'
import { appToast } from '../src/services/uiFeedback.js'
import { preferenceStorage } from '../src/platform/storage/preferences.js'

const { preferences } = vi.hoisted(() => ({ preferences: new Map() }))
vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: {
  get: vi.fn(async ({ key }) => ({ value: preferences.get(key) ?? null })),
  set: vi.fn(async ({ key, value }) => { preferences.set(key, value) }),
  remove: vi.fn(async ({ key }) => { preferences.delete(key) })
} }))
vi.mock('../src/services/uiFeedback.js', async importOriginal => ({
  ...await importOriginal(), appToast: vi.fn()
}))

describe('独立背景效果和温馨小家开关', () => {
  beforeEach(() => { preferences.clear(); setActivePinia(createPinia()) })

  const mountAppearance = async () => {
    const settings = useSettingsStore()
    await settings.loadSettings()
    settings.customBg = 'data:image/png;base64,synthetic'
    let model
    const wrapper = mount({
      components: { SettingsAppearance },
      setup() {
        model = reactive({ ...useAppearanceSettings(), isGeneralSection: () => true })
        return { model }
      },
      template: '<SettingsAppearance :model="model" />'
    })
    return { wrapper, settings, model }
  }

  it('切换适用页面时保留各自的滑块值，重建Store后仍独立恢复', async () => {
    const { wrapper, settings } = await mountAppearance()
    const tabs = wrapper.findAll('.background-scope-picker button')
    await tabs[0].trigger('click')
    await wrapper.find('#background-blur').setValue(0)
    await wrapper.find('#background-fade').setValue(0)
    await tabs[1].trigger('click')
    await wrapper.find('#background-blur').setValue(80)
    await wrapper.find('#background-fade').setValue(55)
    await flushPromises()
    await settings.flushPendingSettingsWrites()
    expect(settings.backgroundEffects).toEqual({ lock: { blur: 0, fade: 0 }, pages: { blur: 80, fade: 55 } })
    await tabs[0].trigger('click')
    expect(wrapper.find('#background-blur').element.value).toBe('0')
    expect(wrapper.find('.background-preview-filter').element.style.backdropFilter).toBe('blur(0px)')
    wrapper.unmount()
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.loadSettings()
    expect(reloaded.backgroundEffects).toEqual({ lock: { blur: 0, fade: 0 }, pages: { blur: 80, fade: 55 } })
  })

  it('关闭保留聊天和记忆、清除待发送队列，首页鼓励语仍显示且点击只提示', async () => {
    const settings = useSettingsStore()
    const chat = useChatStore()
    chat.appendMessage('user', '合成测试消息')
    chat.memories = [{ id: 'synthetic-memory', content: '合成测试记忆' }]
    chat.proactiveOutbox = [{ id: 'synthetic-proactive', scheduledAt: Date.now() - 1000 }]
    chat.followupOutbox = [{ id: 'synthetic-followup', scheduledAt: Date.now() - 1000 }]
    const originalMessages = [...chat.messages]
    await settings.updateWarmHomeEnabled(false)
    const pausedAt = settings.warmHomePausedAt
    expect(pausedAt).toBeGreaterThan(0)
    expect(chat.messages).toEqual(originalMessages)
    expect(chat.memories).toHaveLength(1)
    expect(chat.proactiveOutbox).toEqual([])
    expect(chat.followupOutbox).toEqual([])
    expect(chat.materializeDueProactive()).toEqual([])
    settings.cachedQuote = { text: '合成的温馨鼓励语', date: new Date().toLocaleDateString('sv-SE') }
    const wrapper = mount(HomeView, { props: { chatUnreadCount: 5 }, global: { stubs: { TodoProgressCard: true } } })
    expect(wrapper.find('.companion-note').text()).toContain('合成的温馨鼓励语')
    expect(wrapper.find('.companion-unread').exists()).toBe(false)
    await wrapper.find('.companion-note').trigger('click')
    expect(appToast).toHaveBeenCalledWith('温馨小家入口已关闭，可在设置中重新开启')
    expect(settings.currentView).toBe('home')
    settings.switchView('chat')
    expect(settings.currentView).toBe('settings')
    expect(settings.settingsSection).toBe('appearance')
    await settings.updateWarmHomeEnabled(true)
    await nextTick()
    expect(settings.warmHomePausedAt).toBe(pausedAt)
    expect(chat.messages).toEqual(originalMessages)
    wrapper.unmount()
  })

  it('保存背景失败保留旧图，重新选择同一文件仍可触发上传', async () => {
    const { wrapper, settings, model } = await mountAppearance()
    const previous = settings.customBg
    vi.stubGlobal('FileReader', class {
      readAsDataURL() { this.result = 'data:image/png;base64,new-synthetic'; this.onload() }
    })
    vi.stubGlobal('Image', class {
      set src(_value) { this.onload() }
    })
    const event = { target: { files: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })], value: 'synthetic.png' } }
    vi.mocked(preferenceStorage.set).mockRejectedValueOnce(new Error('SYNTHETIC_STORAGE_FULL'))
    try {
      await model.handleBgUpload(event)
      expect(settings.customBg).toBe(previous)
      expect(event.target.value).toBe('')
      expect(appToast).toHaveBeenCalledWith('图片无法读取或保存，请换一张图片重试', { tone: 'danger' })
      await model.handleBgUpload(event)
      expect(settings.customBg).toBe('data:image/png;base64,new-synthetic')
    } finally {
      vi.unstubAllGlobals()
      wrapper.unmount()
    }
  })

  it('无效图片解码失败时保留旧图并结束处理中状态', async () => {
    const { wrapper, settings, model } = await mountAppearance()
    const previous = settings.customBg
    vi.stubGlobal('FileReader', class {
      readAsDataURL() { this.result = 'data:image/png;base64,invalid'; this.onload() }
    })
    vi.stubGlobal('Image', class {
      set src(_value) { this.onerror() }
    })
    try {
      await model.handleBgUpload({ target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })], value: 'bad.png' } })
      expect(settings.customBg).toBe(previous)
      expect(model.isUploadingBackground).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      wrapper.unmount()
    }
  })

  it('恢复当前页面默认效果不修改另一组参数', async () => {
    const { wrapper, settings, model } = await mountAppearance()
    settings.backgroundEffects = { lock: { blur: 0, fade: 0 }, pages: { blur: 90, fade: 70 } }
    model.backgroundScope = 'pages'
    await wrapper.find('.background-reset-effect').trigger('click')
    await flushPromises()
    expect(settings.backgroundEffects).toEqual({ lock: { blur: 0, fade: 0 }, pages: { blur: 20, fade: 20 } })
    wrapper.unmount()
  })
})
