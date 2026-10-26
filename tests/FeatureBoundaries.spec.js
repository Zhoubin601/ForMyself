import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createPreferenceStorage } from '../src/platform/storage/preferences.js'
import { createPreferenceRepository } from '../src/platform/storage/preferenceRepository.js'
import { createWeightRepository } from '../src/features/weight/weightRepository.js'
import { createMoodRepository } from '../src/features/mood/moodRepository.js'
import { createSavingsRepository } from '../src/features/savings/savingsRepository.js'
import { createScheduleRepository } from '../src/features/schedule/scheduleRepository.js'
import { createAIClient } from '../src/platform/ai/client.js'
import { projectSettingsModel } from '../src/application/settingsModels.js'
import { STORAGE_KEYS as K } from '../src/platform/storage/keys.js'
import ChatComposer from '../src/features/chat/ChatComposer.vue'
import ChatTimeline from '../src/features/chat/ChatTimeline.vue'
import HomeTodayCards from '../src/components/HomeTodayCards.vue'
import SettingsView from '../src/components/SettingsView.vue'
import { useSettingsStore } from '../src/stores/settings.js'
vi.mock('../src/platform/storage/preferences.js', async original => ({ ...await original(), preferenceStorage: {
  get: async () => ({ value: null }), set: async () => {}, remove: async () => {}, flush: async () => {}
} }))
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
const createDriver = () => {
  const values = new Map()
  return { get: vi.fn(async ({ key }) => ({ value: values.get(key) ?? null })), set: vi.fn(async ({ key, value }) => values.set(key, value)), remove: vi.fn(async ({ key }) => values.delete(key)) }
}
it.each([{ create: createWeightRepository, key: K.weightRecords }, { create: createMoodRepository, key: K.moodRecords },
  { create: createSavingsRepository, key: K.debtRecords }, { create: createScheduleRepository, key: K.scheduleData }])('injected repository keeps legacy bytes and propagates read/write failures', async c => {
  const driver = createDriver(), repository = c.create(driver)
  const value = JSON.stringify([{ id: 'synthetic' }]); await repository.set({ key: c.key, value })
  expect((await repository.get({ key: c.key })).value).toBe(value)
  driver.get.mockRejectedValueOnce(new Error('read failed')); await expect(repository.get({ key: c.key })).rejects.toThrow('read failed')
  driver.set.mockRejectedValueOnce(new Error('write failed')); await expect(repository.set({ key: c.key, value: 'new' })).rejects.toThrow('write failed')
  expect((await repository.get({ key: c.key })).value).toBe(value)
  await expect(repository.set({ key: 'foreign-module', value })).rejects.toThrow('UNKNOWN_REPOSITORY_KEY')
})
it('the same repository contract works with the platform Preferences adapter', async () => {
  const repository = createPreferenceRepository(['synthetic'], createPreferenceStorage(createDriver()))
  await repository.set({ key: 'synthetic', value: '[]' }); expect((await repository.get({ key: 'synthetic' })).value).toBe('[]')
  await repository.flush()
})
it('AI transport works using explicit configuration without any active Pinia store', async () => {
  setActivePinia(undefined)
  const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic response' } }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const client = createAIClient(() => ({ aiProviderUrl: 'https://synthetic.invalid/v1', aiApiKey: 'synthetic-only', aiModel: 'model' }))
  expect(await client.askAI('synthetic prompt')).toBe('synthetic response')
  expect(fetch.mock.calls[0][0]).toBe('https://synthetic.invalid/v1/chat/completions')
})
it('settings projections expose only requested fields and reject missing or colliding fields', () => {
  const shared = {}, providers = [{ store: shared, privateField: true }, { store: shared, action: vi.fn() }]
  expect(Object.keys(projectSettingsModel(providers, ['store', 'action']))).toEqual(['store', 'action'])
  expect(() => projectSettingsModel(providers, ['missing'])).toThrow('MISSING_SETTINGS_FIELD')
  expect(() => projectSettingsModel([{ value: 1 }, { value: 2 }], ['value'])).toThrow('AMBIGUOUS_SETTINGS_FIELD')
})
it('actual SettingsView composes every section model and preserves AI editing state', async () => {
  const settings = useSettingsStore(); await settings.loadSettings(); settings.currentView = 'settings'; settings.settingsSection = 'ai'
  const wrapper = mount(SettingsView, { attachTo: document.body }); await flushPromises()
  expect(wrapper.text()).toContain('API')
  const model = wrapper.findComponent({ name: 'SettingsAi' }).props('model')
  expect(model.settingsStore).toBe(settings); expect(Object.keys(model)).toEqual(['isGeneralSection', 'isTestingAI', 'settingsStore', 'testAIConnection'])
  wrapper.unmount()
})
it('extracted composer sends, cancels quote and emits the draft without changing the message', async () => {
  const send = vi.fn(), stop = vi.fn()
  const wrapper = mount(ChatComposer, { props: { draft: 'hello', hasApiKey: true, openAiSettings: vi.fn(), replyTarget: { content: 'quoted' }, quotedSpeaker: () => '我', sendMessage: send, isGenerating: true, stopReply: stop } })
  await wrapper.get('textarea').setValue('updated'); expect(wrapper.emitted('update:draft')[0]).toEqual(['updated'])
  await wrapper.get('[aria-label="发送消息"]').trigger('click'); expect(send).toHaveBeenCalledTimes(1)
  await wrapper.get('[aria-label="停止生成"]').trigger('click'); expect(stop).toHaveBeenCalledTimes(1)
  await wrapper.get('[aria-label="取消引用"]').trigger('click'); expect(wrapper.emitted('cancel-quote')).toHaveLength(1)
  wrapper.unmount()
})
it('timeline emits its actual DOM anchors and load-older action', async () => {
  const props = { timelineReady: true, hasOlderMessages: true, timelineItems: [], companionName: 'synthetic', companionAvatar: '', firstUnreadMessageId: '', highlightedMessageId: '', swipingMessageId: '', swipeOffset: 0, retryMessageId: '', isGenerating: false }
  for (const key of ['handleTimelineScroll', 'isNewDay', 'formatDay', 'isGroupStart', 'isGroupEnd', 'handleCompanionAvatarTap', 'startMessageGesture', 'moveMessageGesture', 'finishMessageGesture', 'cancelMessageGesture', 'openMessageActions', 'scrollToQuotedMessage', 'quotedSpeaker', 'formatTime', 'retryLastReply']) props[key] = vi.fn()
  const wrapper = mount(ChatTimeline, { props })
  expect(wrapper.emitted('element')[0][0]).toBe(wrapper.get('main').element)
  expect(wrapper.emitted('bottom')[0][0]).toBe(wrapper.get('.chat-bottom-anchor').element)
  await wrapper.get('.load-older').trigger('click'); expect(wrapper.emitted('load-older')).toHaveLength(1)
  wrapper.unmount()
})
it('home cards emit navigation targets while keeping the supplied record counts', async () => {
  const wrapper = mount(HomeTodayCards, { props: { todayRecordCount: 1, todayTasks: [{ key: 'weight', view: 'weight', label: '体重', done: true }] } })
  expect(wrapper.text()).toContain('1/3'); await wrapper.get('button').trigger('click'); expect(wrapper.emitted('open')[0]).toEqual(['weight']); wrapper.unmount()
})
