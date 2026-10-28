import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'

const mocked = vi.hoisted(() => ({
  store: null,
  probe: vi.fn(),
  initialize: vi.fn(),
  confirm: vi.fn(),
  resolve: vi.fn(),
  mutate: vi.fn(),
  navigate: vi.fn()
}))
vi.mock('../src/features/chat/kanataStore.js', () => ({ useKanataStore: () => mocked.store }))
vi.mock('../src/application/kanataRuntime.js', () => ({
  createKanataRuntime: () => ({ probeLegacy: mocked.probe, initialize: mocked.initialize })
}))
vi.mock('../src/services/uiFeedback.js', () => ({
  appConfirm: (...args) => mocked.confirm(...args), resolveFeedbackDialog: (...args) => mocked.resolve(...args)
}))
vi.mock('../src/stores/settings.js', () => ({ useSettingsStore: () => ({ switchView: mocked.navigate }) }))
import KanataSetupView from '../src/features/chat/KanataSetupView.vue'
import SettingsChat from '../src/components/settings/SettingsChat.vue'
import { moduleRegistry } from '../src/application/moduleRegistry.js'
import { restoreState } from '../src/platform/storage/restoreState.js'

const seeded = () => ({
  worlds: [{ id: 'synthetic-world' }],
  instances: Array.from({ length: 5 }, (_, index) => ({ id: 'character-' + index })),
  conversations: [
    ...Array.from({ length: 5 }, (_, index) => ({ id: 'private-' + index, type: 'private' })),
    { id: 'group-one', type: 'group' }
  ]
})
const mountReady = async (props = {}) => {
  const wrapper = mount(KanataSetupView, { props })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  Object.assign(restoreState, { blocked: false, busy: false, message: '', syncError: '' })
  mocked.store = reactive({ isDataLoaded: true, snapshot: null, loadError: '', saveError: '', hasPendingSave: false, needsInitialization: true })
  mocked.probe.mockReset().mockResolvedValue({ pending: true, checkpoint: null })
  mocked.confirm.mockReset().mockResolvedValue(false)
  mocked.resolve.mockReset()
  mocked.mutate.mockReset()
  mocked.navigate.mockReset()
  mocked.initialize.mockReset().mockImplementation(async ({ confirm }) => {
    if (!await confirm({ pending: true })) return { status: 'cancelled' }
    mocked.mutate()
    mocked.store.snapshot = seeded()
    mocked.store.needsInitialization = false
    return { status: 'initialized' }
  })
})

describe('Kanata protected setup view', () => {
  it('opens read-only, describes empty history and never initializes or confirms automatically', async () => {
    const wrapper = await mountReady()
    expect(mocked.probe).toHaveBeenCalledTimes(1)
    expect(mocked.initialize).not.toHaveBeenCalled()
    expect(mocked.confirm).not.toHaveBeenCalled()
    expect(mocked.mutate).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('不会生成聊天、长期记忆或已发生事件')
    expect(wrapper.text()).toContain('不会发起 AI 请求')
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('declining the destructive confirmation produces no mutations', async () => {
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(mocked.initialize).toHaveBeenCalledTimes(1)
    expect(mocked.mutate).not.toHaveBeenCalled()
    const [message, options] = mocked.confirm.mock.calls[0]
    expect(message).toContain('永久清理，无法撤销')
    expect(message).toContain('若后续准备中断，已经完成的清理也无法恢复')
    expect(message).toContain('日程、待办、心情、体重、储蓄、密码库、全局 AI 配置和主密码会保留')
    expect(message).toContain('应用外自行保存的旧备份不在清理范围内')
    expect(options.destructive).toBe(true)
    expect(wrapper.text()).toContain('已取消本次准备')
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('shows persisted counts only after explicit confirmation and successful initialization', async () => {
    mocked.confirm.mockResolvedValue(true)
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(mocked.mutate).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(true)
    expect(wrapper.findAll('dd').map(item => item.text())).toEqual(['1', '5', '5', '1'])
    expect(wrapper.text()).toContain('聊天功能尚未开放')
    expect(wrapper.text()).toContain('彼方资料已安全准备')
    expect(wrapper.findAll('textarea')).toHaveLength(0)
    wrapper.unmount()
  })
  it('does not offer a second initialization for existing worlds', async () => {
    mocked.store.snapshot = seeded()
    const wrapper = await mountReady()
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(mocked.initialize).not.toHaveBeenCalled()
    expect(mocked.confirm).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('deduplicates clicks while a confirmation is unresolved', async () => {
    let finish
    mocked.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountReady(), button = wrapper.get('button')
    await button.trigger('click'); await flushPromises()
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click'); await flushPromises()
    expect(mocked.initialize).toHaveBeenCalledTimes(1)
    finish(false); await flushPromises()
    expect(button.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
  it('keeps unreadable and unsaved drafts distinct from successful initialization', async () => {
    mocked.store.snapshot = seeded()
    mocked.store.saveError = 'PRIVATE_STORAGE_FAILURE'
    mocked.store.hasPendingSave = true
    const wrapper = await mountReady()
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(false)
    expect(wrapper.get('button').text()).toBe('验证并重试准备')
    expect(wrapper.text()).toContain('资料尚未保存')
    expect(wrapper.text()).not.toContain('PRIVATE_STORAGE_FAILURE')
    mocked.store.snapshot = null; mocked.store.loadError = 'PRIVATE_READ_FAILURE'
    await flushPromises()
    expect(wrapper.text()).toContain('资料尚未安全读取')
    expect(wrapper.text()).not.toContain('PRIVATE_READ_FAILURE')
    wrapper.unmount()
  })
  it('does not report failed initialization as success and allows retry', async () => {
    mocked.initialize.mockRejectedValueOnce(new Error('private-diagnostic'))
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('本次准备尚未完成')
    expect(wrapper.text()).not.toContain('private-diagnostic')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    mocked.confirm.mockResolvedValue(true)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('blocks ordinary setup while restore is blocked, without invoking the runtime', async () => {
    restoreState.blocked = true
    const wrapper = await mountReady()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(mocked.initialize).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先完成尚未结束的数据恢复')
    wrapper.unmount()
  })
  it('cancels a page-owned confirmation on unmount and refuses a late affirmative result', async () => {
    let finish
    mocked.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click'); await flushPromises()
    wrapper.unmount()
    expect(mocked.resolve).toHaveBeenCalledWith(null)
    finish(true); await flushPromises()
    expect(mocked.mutate).not.toHaveBeenCalled()
  })
  it('refuses confirmation after the sensitive view becomes hidden', async () => {
    let finish
    mocked.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click'); await flushPromises()
    await wrapper.setProps({ isVisible: false })
    expect(mocked.resolve).toHaveBeenCalledWith(null)
    finish(true); await flushPromises()
    expect(mocked.mutate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('shows probe errors and interrupted preparation without exposing checkpoint internals', async () => {
    mocked.probe.mockRejectedValueOnce(new Error('private-file-path'))
    const wrapper = await mountReady()
    expect(wrapper.text()).toContain('无法检查现有资料')
    expect(wrapper.text()).not.toContain('private-file-path')
    wrapper.unmount()
    mocked.probe.mockResolvedValue({ pending: true, checkpoint: { phase: 'files', secret: 'never-render' } })
    const interrupted = await mountReady()
    expect(interrupted.text()).toContain('上次准备尚未完成')
    expect(interrupted.text()).not.toContain('never-render')
    interrupted.unmount()
  })
  it('does not treat failed authentication or an unsupported result as initialization success', async () => {
    mocked.initialize.mockResolvedValue(false)
    const wrapper = await mountReady()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('尚未完成身份验证')
    expect(wrapper.find('[data-test="ready"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('retains the chat route and protected unloading policy without exposing the old page', async () => {
    const descriptor = moduleRegistry.get('chat')
    expect(descriptor.title).toBe('彼方 · Kanata')
    expect(descriptor.name).toBe('KanataView')
    expect(descriptor.access).toBe('protected')
    expect(descriptor.cache).toBe(false)
    expect(descriptor.backup).toEqual({ id: 'chat', label: '彼方数据', prefix: 'Kanata' })
    expect(descriptor.bindings({ isVisible: true })).toEqual({ isVisible: true })
  })
  it('old chat settings only navigate to Kanata and never read or invoke legacy actions', async () => {
    const oldAction = vi.fn()
    const model = reactive({ settingsScope: 'chat', regenerateCompanionState: oldAction })
    Object.defineProperty(model, 'chatStore', { get() { throw new Error('legacy state must not be read') } })
    const wrapper = mount(SettingsChat, { props: { model } })
    expect(wrapper.text()).not.toContain('女朋友名字')
    expect(wrapper.text()).not.toContain('重新生成')
    expect(wrapper.findAll('button')).toHaveLength(1)
    await wrapper.get('button').trigger('click')
    expect(mocked.navigate).toHaveBeenCalledWith('chat')
    expect(oldAction).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('review 2: a completed cleanup checkpoint is not an interrupted preparation', async () => {
  mocked.probe.mockResolvedValue({ pending: false, checkpoint: { phase: 'done' }, hasLegacy: false })
  const wrapper = await mountReady()
  expect(wrapper.text()).not.toContain('上次准备尚未完成')
  expect(wrapper.text()).not.toContain('检测到旧温馨小家资料')
  wrapper.unmount()
})
it('review 2: pending cleanup alone does not claim old files were detected', async () => {
  mocked.probe.mockResolvedValue({ pending: true, checkpoint: { phase: 'files' }, hasLegacy: false })
  const wrapper = await mountReady()
  expect(wrapper.text()).toContain('上次准备尚未完成')
  expect(wrapper.text()).not.toContain('检测到旧温馨小家资料')
  wrapper.unmount()
})
