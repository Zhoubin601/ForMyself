import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, reactive, ref, computed } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let controller
const moduleUnmounted = vi.hoisted(() => vi.fn())

vi.mock('../src/composables/useAppController.js', () => ({
  useAppController: () => controller
}))

vi.mock('../src/features/chat/KanataView.vue', () => ({ default: {
  name: 'KanataView', props: ['isVisible'], data: () => ({ draft: 'initial' }),
  beforeUnmount() { moduleUnmounted() },
  template: '<section data-test="chat" :data-visible="isVisible"><input v-model="draft" /></section>'
} }))
import App from '../src/App.vue'

describe('解锁反馈', () => {
  beforeEach(() => {
    moduleUnmounted.mockClear()
    controller = {
      appWrapperRef: ref(null),
      authStore: reactive({
        isLocked: true,
        hasMasterPassword: true,
        canUnlockWithBiometric: false
      }),
      chatUnreadCount: ref(0),
      chatUnreadLabel: ref(''),
      dismissBiometricSetup: vi.fn(),
      drawerItems: [],
      enableBiometricUnlock: vi.fn(),
      handleAppScroll: vi.fn(),
      hasEnteredApp: ref(false),
      isEnablingBiometric: ref(false),
      isUnlocking: ref(true),
      moduleSettingsViews: new Set(),
      protectedDataStatus: ref('idle'),
      protectedModule: computed(() => ['passwords', 'chat'].includes(controller.settingsStore.currentView) ? controller.settingsStore.currentView : null),
      protectedAccess: reactive({ status: { passwords: 'idle', chat: 'idle' }, recoveryRequired: false }),
      pwdInput: ref(''),
      setMasterPassword: vi.fn(),
      settingsStore: reactive({
        customBg: '',
        currentView: 'home',
        isDrawerOpen: false,
        viewTitle: '首页总览'
      }),
      showBiometricSetup: ref(false),
      showPassword: ref(false),
      unlockApp: vi.fn(),
      unlockWithBiometric: vi.fn()
    }
  })

  const mountApp = () => mount(App, {
    global: {
      stubs: {
        AppFeedbackHost: true,
        HomeView: {
          props: ['showBiometricSetup'],
          template: '<section data-test="home"><p v-if="showBiometricSetup" data-test="biometric-setup">启用指纹快捷解锁</p></section>'
        }
      }
    }
  })

  it('计算期间立即显示忙碌状态并禁止重复点击', async () => {
    const wrapper = mountApp()
    const unlockButton = wrapper.find('.lock-btn')
    expect(unlockButton.attributes('disabled')).toBeDefined()
    expect(unlockButton.text()).toContain('正在解锁')
    expect(wrapper.find('.unlock-spinner').exists()).toBe(true)

    controller.isUnlocking.value = false
    await nextTick()
    expect(unlockButton.attributes('disabled')).toBeUndefined()
    expect(unlockButton.text()).toContain('解锁进入')
  })

  it('解锁和重新锁定分别使用对应背景参数，不改写另一组', async () => {
    controller.settingsStore.customBg = 'data:image/png;base64,synthetic'
    controller.settingsStore.backgroundEffects = { lock: { blur: 0, fade: 0 }, pages: { blur: 75, fade: 50 } }
    const wrapper = mountApp()
    expect(wrapper.find('.bg-blur-layer').element.style.backdropFilter).toBe('blur(0px)')
    expect(wrapper.find('.bg-blur-layer').element.style.backgroundColor).toBe('rgba(245, 245, 247, 0)')
    controller.authStore.isLocked = false
    await nextTick()
    expect(wrapper.find('.bg-blur-layer').element.style.backdropFilter).toBe('blur(30px)')
    expect(wrapper.find('.bg-blur-layer').element.style.backgroundColor).toBe('rgba(245, 245, 247, 0.5)')
    controller.authStore.isLocked = true
    await nextTick()
    expect(wrapper.find('.bg-blur-layer').element.style.backdropFilter).toBe('blur(0px)')
    wrapper.unmount()
  })

  it('验证通过后首页可以在受保护数据加载期间先显示', async () => {
    controller.authStore.isLocked = false
    controller.hasEnteredApp.value = true
    controller.isUnlocking.value = false
    controller.protectedDataStatus.value = 'loading'
    const wrapper = mountApp()

    expect(wrapper.find('[data-test="home"]').exists()).toBe(true)
    expect(wrapper.find('.protected-data-loading').exists()).toBe(false)
  })

  it.each([
    ['chat', '正在安全载入彼方 · Kanata'],
    ['passwords', '正在安全载入密码库']
  ])('%s 页面等待受保护数据时显示固定加载态', async (view, label) => {
    controller.authStore.isLocked = false
    controller.hasEnteredApp.value = true
    controller.isUnlocking.value = false
    controller.protectedDataStatus.value = 'loading'
    controller.settingsStore.currentView = view
    const wrapper = mountApp()

    const loading = wrapper.find('.protected-data-loading')
    expect(loading.exists()).toBe(true)
    expect(loading.text()).toContain(label)
    expect(loading.find('.unlock-spinner').exists()).toBe(true)
  })

  it('首页显示一次性的非模态生物启用提示', () => {
    controller.authStore.isLocked = false
    controller.hasEnteredApp.value = true
    controller.isUnlocking.value = false
    controller.showBiometricSetup.value = true
    const wrapper = mountApp()

    expect(wrapper.find('[data-test="home"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="biometric-setup"]').text()).toContain('启用指纹快捷解锁')
  })

  it('后台解密失败后重新显示锁屏并隐藏主页', async () => {
    controller.authStore.isLocked = false
    controller.hasEnteredApp.value = true
    controller.isUnlocking.value = false
    const wrapper = mountApp()
    expect(wrapper.find('[data-test="home"]').exists()).toBe(true)

    controller.protectedDataStatus.value = 'error'
    controller.authStore.isLocked = true
    await nextTick()

    expect(wrapper.find('.lock-screen').exists()).toBe(true)
    expect(wrapper.find('.main-app').isVisible()).toBe(false)
  })
  it('彼方离开即卸载，锁定隐藏可见性，失效后不复用敏感页面状态', async () => {
    controller.authStore.isLocked = false; controller.hasEnteredApp.value = true
    controller.settingsStore.currentView = 'chat'; controller.protectedAccess.status.chat = 'ready'
    controller.protectedDataStatus.value = 'ready'
    const wrapper = mountApp(); await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('[data-test="chat"]').exists()).toBe(true))
    await wrapper.find('[data-test="chat"] input').setValue('session draft')
    controller.settingsStore.currentView = 'home'; await nextTick()
    expect(wrapper.find('[data-test="chat"]').exists()).toBe(false)
    expect(moduleUnmounted).toHaveBeenCalledTimes(1)
    controller.settingsStore.currentView = 'chat'; await nextTick()
    expect(wrapper.find('[data-test="chat"] input').element.value).toBe('initial')
    controller.authStore.isLocked = true; await nextTick()
    expect(wrapper.find('[data-test="chat"]').attributes('data-visible')).toBe('false')
    controller.authStore.isLocked = false; controller.protectedAccess.status.chat = 'idle'; controller.protectedDataStatus.value = 'loading'
    await nextTick(); expect(wrapper.find('[data-test="chat"]').exists()).toBe(false)
    controller.protectedAccess.status.chat = 'ready'; controller.protectedDataStatus.value = 'ready'; await nextTick()
    expect(wrapper.find('[data-test="chat"] input').element.value).toBe('initial')
    wrapper.unmount()
  })

})
