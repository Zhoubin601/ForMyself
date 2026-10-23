import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({
  preferences: new Map(), credentials: new Map(), native: true,
  readFailure: false, checkFailure: false, writeFailure: false, corruptReadback: false,
  preferenceFailure: '', setCredentials: vi.fn(), getCredentials: vi.fn(), toast: vi.fn(),
  askAI: vi.fn(), alert: vi.fn()
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native } }))
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }) => ({ value: state.preferences.get(key) ?? null }),
  set: async ({ key, value }) => {
    if (state.preferenceFailure === key) throw new Error('Synthetic preference write failure')
    state.preferences.set(key, value)
  },
  remove: async ({ key }) => { state.preferences.delete(key) }
} }))
vi.mock('@capgo/capacitor-native-biometric', () => ({
  AccessControl: { NONE: 0, BIOMETRY_CURRENT_SET: 1 },
  NativeBiometric: {
    isCredentialsSaved: async ({ server }) => {
      if (state.checkFailure) throw new Error('Synthetic credential check failure')
      return { isSaved: state.credentials.has(server) }
    },
    setCredentials: options => state.setCredentials(options),
    getCredentials: options => state.getCredentials(options)
  }
}))
vi.mock('../src/services/uiFeedback.js', () => ({
  appToast: (...args) => state.toast(...args), appAlert: (...args) => state.alert(...args), appConfirm: vi.fn()
}))
vi.mock('../src/services/aiEngine.js', () => ({ askAI: (...args) => state.askAI(...args) }))
vi.mock('../src/services/notificationService.js', async importOriginal => ({
  ...await importOriginal(),
  getReminderNotificationStatus: async () => ({ permission: 'unknown', pending: [], exactAlarm: 'unknown' })
}))

import { useSettingsStore } from '../src/stores/settings.js'
import { API_KEY_CREDENTIAL, createSecureCredentials } from '../src/platform/security/secureCredentials.js'
import { STORAGE_KEYS } from '../src/platform/storage/keys.js'
import SettingsAI from '../src/components/settings/SettingsAi.vue'
import { useReminderSettings } from '../src/composables/settings/useReminderSettings.js'

// Public synthetic fixture; no real credentials are read or used.
const marker = 'SYNTHETIC-CREDENTIAL-NOT-A-REAL-KEY'
let pinia, wrapper
async function boot() {
  if (pinia) disposePinia(pinia)
  vi.clearAllTimers()
  pinia = createPinia()
  setActivePinia(pinia)
  const store = useSettingsStore()
  await store.loadSettings()
  await nextTick()
  return store
}
const storedKey = () => state.credentials.get(API_KEY_CREDENTIAL)?.password
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const seedKey = () => state.credentials.set(API_KEY_CREDENTIAL, { username: 'formyself', password: marker })
const mountSettings = store => {
  wrapper = mount(SettingsAI, { props: { model: reactive({
    settingsStore: store, isGeneralSection: section => section === 'ai',
    isTestingAI: false, testAIConnection: vi.fn()
  }) } })
  return wrapper
}

describe('API Key persistence and recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.preferences.clear()
    state.credentials.clear()
    state.native = true
    state.readFailure = state.checkFailure = state.writeFailure = state.corruptReadback = false
    state.preferenceFailure = ''
    state.askAI.mockResolvedValue('Synthetic connection success')
    state.setCredentials.mockImplementation(async ({ server, username, password }) => {
      if (state.writeFailure) throw new Error('Synthetic keystore write failure')
      state.credentials.set(server, { username, password })
    })
    state.getCredentials.mockImplementation(async ({ server }) => {
      if (state.readFailure) throw new Error('Synthetic keystore read failure')
      if (state.corruptReadback) return { username: 'formyself', password: 'SYNTHETIC-MISMATCH' }
      return state.credentials.get(server)
    })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    if (pinia) disposePinia(pinia)
    pinia = null
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts saving immediately, verifies it, and recovers after a new store', async () => {
    const store = await boot()
    store.aiApiKey = marker
    expect(state.setCredentials).toHaveBeenCalledTimes(1)
    expect(store.apiKeyStorageStatus).toBe('saving')
    await store.saveAiSettings()
    expect(store.apiKeyStorageStatus).toBe('saved')
    expect(storedKey()).toBe(marker)
    expect(state.preferences.get(STORAGE_KEYS.aiProviderSettings)).not.toContain(marker)
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('does not write credentials when only provider/model change, even after a read error', async () => {
    seedKey()
    state.readFailure = true
    const store = await boot()
    store.aiProviderUrl = 'https://example.invalid'
    store.aiModel = 'synthetic-model'
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.setCredentials).not.toHaveBeenCalled()
    expect(storedKey()).toBe(marker)
    state.readFailure = false
    expect(await store.retryApiKeyStorage()).toBe(true)
    expect(store.aiApiKey).toBe(marker)
    expect(store.aiModel).toBe('synthetic-model')
    store.aiModel = 'another-synthetic-model'
    await store.saveAiSettings()
    expect(state.setCredentials).not.toHaveBeenCalled()
  })

  it.each(['readFailure', 'checkFailure'])('%s is visible, does not break other settings, and can retry safely', async failure => {
    seedKey()
    state.preferences.set(STORAGE_KEYS.commonNotes, JSON.stringify({ savings: ['synthetic note'] }))
    state[failure] = true
    const store = await boot()
    expect(store.isDataLoaded).toBe(true)
    expect(store.commonNotes.savings).toEqual(['synthetic note'])
    expect(store.apiKeyStorageStatus).toBe('load-error')
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('读取失败'), expect.anything())
    await expect(store.saveAiSettings()).rejects.toThrow('读取失败')
    expect(() => store.getBackupSnapshot()).toThrow('尚未读取成功')
    expect(state.setCredentials).not.toHaveBeenCalled()
    state[failure] = false
    expect(await store.retryApiKeyStorage()).toBe(true)
    expect(store.aiApiKey).toBe(marker)
    expect(store.apiKeyStorageStatus).toBe('saved')
  })

  it('retains a failed write for retry without retyping, then survives restart', async () => {
    const store = await boot()
    state.writeFailure = true
    store.aiApiKey = marker
    await flushPromises()
    expect(store.apiKeyStorageStatus).toBe('save-error')
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('保存失败'), expect.anything())
    state.writeFailure = false
    expect(await store.retryApiKeyStorage()).toBe(true)
    expect(store.apiKeyStorageStatus).toBe('saved')
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('does not claim success when native storage resolves but readback differs', async () => {
    const store = await boot()
    state.corruptReadback = true
    store.aiApiKey = marker
    await flushPromises()
    expect(store.apiKeyStorageStatus).toBe('save-error')
    state.corruptReadback = false
    expect(await store.retryApiKeyStorage()).toBe(true)
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('serializes rapid edits and keeps only the latest pending value', async () => {
    const store = await boot()
    const gate = deferred()
    state.setCredentials.mockImplementationOnce(async options => {
      await gate.promise
      state.credentials.set(options.server, { username: options.username, password: options.password })
    })
    store.aiApiKey = 'SYNTHETIC-FIRST'
    store.aiApiKey = 'SYNTHETIC-INTERMEDIATE'
    store.aiApiKey = marker
    expect(state.setCredentials).toHaveBeenCalledTimes(1)
    const saved = store.saveAiSettings()
    gate.resolve()
    await saved
    expect(state.setCredentials).toHaveBeenCalledTimes(2)
    expect(storedKey()).toBe(marker)
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('a failed superseded write does not discard a newer edit', async () => {
    const store = await boot()
    const gate = deferred()
    state.setCredentials.mockImplementationOnce(() => gate.promise)
    store.aiApiKey = 'SYNTHETIC-FIRST'
    store.aiApiKey = marker
    gate.reject(new Error('Synthetic earlier failure'))
    await store.saveAiSettings()
    expect(storedKey()).toBe(marker)
    expect(store.apiKeyStorageStatus).toBe('saved')
  })

  it('explicitly clearing an existing key persists without deleting other credentials', async () => {
    seedKey()
    state.credentials.set('OTHER-CREDENTIAL', { password: 'SYNTHETIC-OTHER' })
    const store = await boot()
    store.aiApiKey = ''
    await store.saveAiSettings()
    expect(storedKey()).toBe('')
    expect(state.credentials.has('OTHER-CREDENTIAL')).toBe(true)
    expect((await boot()).apiKeyStorageStatus).toBe('empty')
  })

  it.each([STORAGE_KEYS.legacyAiSettings, STORAGE_KEYS.aiProviderSettings])('migration from %s preserves the original until verified', async storageKey => {
    const legacy = JSON.stringify({ url: 'https://example.invalid', key: marker, model: 'synthetic-model' })
    state.preferences.set(storageKey, legacy)
    state.writeFailure = true
    const store = await boot()
    expect(store.apiKeyStorageStatus).toBe('load-error')
    expect(state.preferences.get(storageKey)).toBe(legacy)
    store.aiModel = 'changed-during-failure'
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.preferences.get(storageKey)).toBe(legacy)
    state.writeFailure = false
    expect(await store.retryApiKeyStorage()).toBe(true)
    expect(storedKey()).toBe(marker)
    expect(state.preferences.has(STORAGE_KEYS.legacyAiSettings)).toBe(false)
    expect(state.preferences.get(STORAGE_KEYS.aiProviderSettings)).not.toContain(marker)
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('can migrate the legacy key even when provider preferences already exist', async () => {
    state.preferences.set(STORAGE_KEYS.aiProviderSettings, JSON.stringify({ model: 'current-model' }))
    state.preferences.set(STORAGE_KEYS.legacyAiSettings, JSON.stringify({ key: marker }))
    const store = await boot()
    expect(store.aiApiKey).toBe(marker)
    expect(store.aiModel).toBe('current-model')
    expect(storedKey()).toBe(marker)
  })

  it('keeps legacy credentials when write verification fails', async () => {
    const original = JSON.stringify({ key: marker })
    state.preferences.set(STORAGE_KEYS.legacyAiSettings, original)
    state.corruptReadback = true
    const store = await boot()
    expect(store.apiKeyStorageStatus).toBe('load-error')
    expect(state.preferences.get(STORAGE_KEYS.legacyAiSettings)).toBe(original)
  })

  it('flushes the credential even when an unrelated preference write fails', async () => {
    const store = await boot()
    state.writeFailure = true
    store.aiApiKey = marker
    await flushPromises()
    store.bannerSettings.prefix = 'synthetic banner'
    await nextTick()
    state.preferenceFailure = STORAGE_KEYS.bannerSettings
    state.writeFailure = false
    await expect(store.flushPendingSettingsWrites()).rejects.toThrow('Synthetic preference')
    await flushPromises()
    expect(storedKey()).toBe(marker)
  })

  it('backup restore waits for earlier writes so they cannot overwrite the restored key', async () => {
    const store = await boot()
    const gate = deferred()
    state.setCredentials.mockImplementationOnce(async options => {
      await gate.promise
      state.credentials.set(options.server, { username: options.username, password: options.password })
    })
    store.aiApiKey = 'SYNTHETIC-OLD'
    const snapshot = store.getBackupSnapshot()
    snapshot.ai.key = marker
    const restoring = store.restoreBackupSnapshot(snapshot)
    gate.resolve()
    await restoring
    await store.flushPendingSettingsWrites()
    expect(storedKey()).toBe(marker)
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('browser provider and key edits retain existing persistence behavior', async () => {
    state.native = false
    const store = await boot()
    store.aiApiKey = marker
    store.aiModel = 'synthetic-web-model'
    await store.saveAiSettings()
    expect(state.setCredentials).not.toHaveBeenCalled()
    const reloaded = await boot()
    expect(reloaded.aiApiKey).toBe(marker)
    expect(reloaded.aiModel).toBe('synthetic-web-model')
  })

  it('API key existence-check failures propagate from the credential adapter', async () => {
    const adapter = createSecureCredentials({ isNative: () => true, biometric: {
      isCredentialsSaved: async () => { throw new Error('Synthetic check failure') }
    } })
    await expect(adapter.getApiKey()).rejects.toThrow('Synthetic check failure')
  })

  it('the settings UI shows a load failure, disables key editing, and recovers through retry', async () => {
    seedKey()
    state.readFailure = true
    const store = await boot()
    const view = mountSettings(store)
    expect(view.get('#ai-api-key').element.disabled).toBe(true)
    expect(view.get('[role="status"]').text()).toContain('读取失败')
    state.readFailure = false
    const retry = view.findAll('button').find(button => button.text().includes('重试读取'))
    await retry.trigger('click')
    await flushPromises()
    expect(view.get('#ai-api-key').element.disabled).toBe(false)
    expect(view.get('[role="status"]').text()).toContain('已安全保存')
  })

  it('the settings UI retries a failed save and hides the retry button after success', async () => {
    const store = await boot()
    const view = mountSettings(store)
    state.writeFailure = true
    await view.get('#ai-api-key').setValue(marker)
    await flushPromises()
    expect(view.get('[role="status"]').text()).toContain('保存失败')
    state.writeFailure = false
    await view.findAll('button').find(button => button.text().includes('重试保存')).trigger('click')
    await flushPromises()
    expect(view.get('[role="status"]').text()).toContain('已安全保存')
    expect(view.text()).not.toContain('重试保存')
  })

  it('connection testing waits for credential persistence and never sends on save failure', async () => {
    const store = await boot()
    let reminder
    wrapper = mount({ setup() { reminder = useReminderSettings(); return () => null } })
    state.writeFailure = true
    store.aiApiKey = marker
    await flushPromises()
    await reminder.testAIConnection()
    expect(state.askAI).not.toHaveBeenCalled()
    expect(state.alert).toHaveBeenCalledWith(expect.stringContaining('保存失败'))
    state.writeFailure = false
    await reminder.testAIConnection()
    expect(state.askAI).toHaveBeenCalledTimes(1)
    expect(store.apiKeyStorageStatus).toBe('saved')
    expect(storedKey()).toBe(marker)
  })
})
