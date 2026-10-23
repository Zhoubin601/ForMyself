// Historical pre-fix fault reproducer. Its assertions describe the old broken behavior.
// After the fix, use tests/ApiKeyPersistence.spec.js (included in npm run check).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const state = vi.hoisted(() => ({
  preferences: new Map(), credentials: new Map(), native: true,
  readFailure: false, checkFailure: false, writeFailure: false,
  setCredentials: vi.fn(), getCredentials: vi.fn()
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native } }))
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }) => ({ value: state.preferences.get(key) ?? null }),
  set: async ({ key, value }) => { state.preferences.set(key, value) },
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
vi.mock('../../../src/services/uiFeedback.js', () => ({ appToast: vi.fn() }))

import { useSettingsStore } from '../../../src/stores/settings.js'
import { API_KEY_CREDENTIAL } from '../../../src/platform/security/secureCredentials.js'
import { STORAGE_KEYS } from '../../../src/platform/storage/keys.js'

// Synthetic marker only; never use a real API Key in this investigation.
const marker = 'SYNTHETIC-CREDENTIAL-NOT-A-REAL-KEY'
let pinia
async function boot() {
  if (pinia) disposePinia(pinia)
  vi.clearAllTimers() // A killed process does not run its pending JS timers.
  pinia = createPinia()
  setActivePinia(pinia)
  const store = useSettingsStore()
  await store.loadSettings()
  await nextTick()
  return store
}

describe('Android API Key restart diagnosis against actual settings store and credential adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.preferences.clear()
    state.credentials.clear()
    state.native = true
    state.readFailure = state.checkFailure = state.writeFailure = false
    state.setCredentials.mockImplementation(async ({ server, username, password }) => {
      if (state.writeFailure) throw new Error('Synthetic keystore write failure')
      state.credentials.set(server, { username, password })
    })
    state.getCredentials.mockImplementation(async ({ server }) => {
      if (state.readFailure) throw new Error('Synthetic keystore read failure')
      return state.credentials.get(server)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    if (pinia) disposePinia(pinia)
    pinia = null
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('normal native save survives a new store; preferences omit the credential', async () => {
    const store = await boot()
    store.aiApiKey = marker
    await nextTick()
    await vi.advanceTimersByTimeAsync(501)
    expect(state.credentials.get(API_KEY_CREDENTIAL)?.password).toBe(marker)
    expect(JSON.parse(state.preferences.get(STORAGE_KEYS.aiProviderSettings))).not.toHaveProperty('key')
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('killing before debounce runs loses the entered credential', async () => {
    const store = await boot()
    store.aiApiKey = marker
    await nextTick()
    await vi.advanceTimersByTimeAsync(499)
    expect(state.setCredentials).not.toHaveBeenCalled()
    expect((await boot()).aiApiKey).toBe('')
  })

  it('a failed native save leaves a usable in-memory key but nothing after restart', async () => {
    const store = await boot()
    state.writeFailure = true
    store.aiApiKey = marker
    await nextTick()
    await vi.advanceTimersByTimeAsync(501)
    expect(store.aiApiKey).toBe(marker)
    expect(console.warn).toHaveBeenCalled()
    state.writeFailure = false
    expect((await boot()).aiApiKey).toBe('')
  })

  it.each(['readFailure', 'checkFailure'])('%s presents a saved credential as empty; next successful boot can recover it', async failure => {
    state.credentials.set(API_KEY_CREDENTIAL, { username: 'formyself', password: marker })
    state[failure] = true
    const store = await boot()
    expect(store.isDataLoaded).toBe(true)
    expect(store.aiApiKey).toBe('')
    expect(state.credentials.get(API_KEY_CREDENTIAL)?.password).toBe(marker)
    state[failure] = false
    expect((await boot()).aiApiKey).toBe(marker)
  })

  it('after read failure, changing only the model overwrites the existing key with empty', async () => {
    state.credentials.set(API_KEY_CREDENTIAL, { username: 'formyself', password: marker })
    state.readFailure = true
    const store = await boot()
    state.readFailure = false
    store.aiModel = 'synthetic-model'
    await nextTick()
    await vi.advanceTimersByTimeAsync(501)
    expect(state.credentials.get(API_KEY_CREDENTIAL)?.password).toBe('')
    expect((await boot()).aiApiKey).toBe('')
  })

  it('explicit flush before process shutdown saves a pending key', async () => {
    const store = await boot()
    store.aiApiKey = marker
    await nextTick()
    await store.flushPendingSettingsWrites()
    expect((await boot()).aiApiKey).toBe(marker)
  })
})
