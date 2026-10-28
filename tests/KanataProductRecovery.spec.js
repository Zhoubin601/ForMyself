import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { webcrypto } from 'node:crypto'

const driver = vi.hoisted(() => ({
  preferences: new Map(), files: new Map(), calls: [],
  failNextPreference: null, alwaysFailPreference: null, failFiles: false, failNextFile: null
}))
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }) => ({ value: driver.preferences.get(key) ?? null }),
  set: async ({ key, value }) => {
    driver.calls.push(['set', key])
    if (driver.alwaysFailPreference === key) throw new Error('SYNTHETIC_PERSISTENT_WRITE_FAILURE')
    if (driver.failNextPreference === key) { driver.failNextPreference = null; throw new Error('SYNTHETIC_WRITE_FAILURE') }
    driver.preferences.set(key, value)
  },
  remove: async ({ key }) => { driver.calls.push(['remove', key]); driver.preferences.delete(key) }
} }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Data: 'DATA', Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
  stat: async ({ path }) => { if (!driver.files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return {} },
  readFile: async ({ path }) => { if (!driver.files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { data: driver.files.get(path) } },
  mkdir: async () => {},
  writeFile: async ({ path, data }) => {
    driver.calls.push(['writeFile', path])
    if (driver.failNextFile === path) { driver.failNextFile = null; throw new Error('SYNTHETIC_ONCE_FILE_FAILURE') }
    if (driver.failFiles) throw new Error('SYNTHETIC_FILE_WRITE_FAILURE')
    driver.files.set(path, data)
  },
  deleteFile: async ({ path }) => { driver.calls.push(['deleteFile', path]); driver.files.delete(path) },
  rename: async ({ from, to }) => {
    if (!driver.files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    driver.calls.push(['rename', from, to]); driver.files.set(to, driver.files.get(from)); driver.files.delete(from)
  }
} }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  getPending: async () => ({ notifications: [] }), cancel: async () => {},
  listChannels: async () => ({ channels: [] }), deleteChannel: async () => {},
  checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
  schedule: async ({ notifications }) => ({ notifications }), createChannel: async () => {}
} }))
vi.mock('../src/services/uiFeedback.js', () => ({
  appPrompt: vi.fn(), appChoose: vi.fn(), appAlert: vi.fn(), appConfirm: vi.fn(), appToast: vi.fn(), resolveFeedbackDialog: vi.fn()
}))

import { createFullBackupRuntime } from '../src/application/fullBackupRuntime.js'
import { createKanataRuntime } from '../src/application/kanataRuntime.js'
import { useAuthStore } from '../src/stores/auth.js'
import { useProtectedAccessStore } from '../src/stores/protectedAccess.js'
import { useKanataStore } from '../src/features/chat/kanataStore.js'
import { useWeightStore } from '../src/stores/weight.js'
import { usePasswordVaultStore } from '../src/stores/passwordVault.js'
import { useSettingsStore } from '../src/stores/settings.js'
import { preferenceStorage } from '../src/platform/storage/preferences.js'
import { STORAGE_KEYS } from '../src/platform/storage/keys.js'
import { restoreState } from '../src/platform/storage/restoreState.js'
import { restoreJournal, RESTORE_PATH } from '../src/platform/storage/restoreJournal.js'
import { KANATA_DATA_PATH, decryptKanataData } from '../src/features/chat/storage/kanataRepository.js'
import { CHAT_DATA_PATH } from '../src/features/chat/chatStorage.js'
import { buildFullBackupSnapshot } from '../src/services/fullBackup.js'
import { changeMasterPasswordTransaction } from '../src/services/masterPasswordChange.js'
import { useBackupSettings } from '../src/composables/settings/useBackupSettings.js'
import { appConfirm, appAlert, appToast } from '../src/services/uiFeedback.js'
import { buildKanataChatBackupSnapshot } from '../src/features/chat/backup/kanataBackup.js'
import CryptoJS from 'crypto-js'

const original = 'Synthetic-Kanata-original', changed = 'Synthetic-Kanata-changed'
const clone = value => JSON.parse(JSON.stringify(value))
const oldBackup = (weightId, message) => buildFullBackupSnapshot({
  weight: [{ id: weightId, weight: 70, date: '2026-01-01' }],
  chat: { messages: [{ id: 'legacy-only', role: 'user', content: message, createdAt: 1 }] },
  settings: { ai: { url: 'https://api.deepseek.com', key: 'synthetic-config-only', model: 'deepseek-chat' } }
}, '2026-01-01T00:00:00Z')

describe('Kanata P2 product runtime: actual stores, encrypted files and restore journal', () => {
  let auth, access, chat
  beforeEach(async () => {
    await preferenceStorage.flush()
    driver.preferences.clear(); driver.files.clear(); driver.calls.length = 0
    driver.failNextPreference = null; driver.alwaysFailPreference = null; driver.failFiles = false; driver.failNextFile = null
    Object.assign(restoreState, { blocked: false, busy: false, message: '', syncError: '' })
    vi.stubGlobal('crypto', webcrypto)
    vi.clearAllMocks()
    setActivePinia(createPinia())
    auth = useAuthStore(); await auth.setMasterPassword(original)
    access = useProtectedAccessStore()
    expect(await access.ensureModules()).toBe(true)
    const initialized = await createKanataRuntime().initialize({ confirm: async () => true })
    expect(initialized.status).toBe('initialized')
    chat = useKanataStore()
    expect(chat.snapshot.instances).toHaveLength(5)
    const weight = useWeightStore(); await weight.loadWeightRecords()
    weight.addRecord({ id: 'previous-weight', date: '2026-01-01', weight: 60 }); await weight.flush()
  })
  afterEach(async () => {
    driver.failNextPreference = null; driver.alwaysFailPreference = null; driver.failFiles = false; driver.failNextFile = null
    await preferenceStorage.flush()
    vi.unstubAllGlobals()
  })

  it('exports v13 from the product and rejects direct internal apply outside the coordinator', async () => {
    const runtime = createFullBackupRuntime(), backup = await runtime.exportFull()
    expect(backup.version).toBe(13)
    expect(backup.data.chat.worlds).toHaveLength(1); expect(backup.data.chat.instances).toHaveLength(5)
    expect(backup.data.chat.messages).toEqual([])
    expect(() => runtime.applyFullBackupSnapshot(backup)).toThrow('RESTORE_COORDINATOR_REQUIRED')
    expect(driver.files.has(KANATA_DATA_PATH)).toBe(true)
    expect(driver.files.has(CHAT_DATA_PATH)).toBe(false)
    auth.expireSession({ lockApp: false })
    await vi.waitFor(() => expect(chat.snapshot).toBe(null))
    expect(await auth.unlockWithPassword(original, { unlockApp: false })).toBe(true)
    expect(await access.ensureModule('chat')).toBe(true)
    expect(chat.snapshot.instances).toHaveLength(5)
  })

  it.each(Array.from({length: 12}, (_, i) => i + 1))('legacy v%s explicitly restores nonchat modules and AI config, without any legacy chat write', async version => {
    const runtime = createFullBackupRuntime()
    const before = clone(chat.snapshot), source = oldBackup('target-weight', 'synthetic old private content')
    source.version = version
    const callsBefore = driver.calls.length
    expect(() => runtime.restore(source, original)).toThrow('LEGACY_CHAT_DISCARD_CONFIRMATION_REQUIRED')
    expect(driver.calls.length).toBe(callsBefore)
    await runtime.restore(source, original, { legacyChat: 'discard' })
    expect(useWeightStore().weightRecords[0].id).toBe('target-weight')
    expect(useSettingsStore().aiApiKey).toBe('synthetic-config-only')
    expect(chat.snapshot).toEqual(before)
    expect(driver.files.has(CHAT_DATA_PATH)).toBe(false)
    expect(driver.calls.filter(([action, path]) => ['writeFile', 'rename'].includes(action) && String(path).includes('warm-home'))).toEqual([])
    expect(restoreState.blocked).toBe(false); expect(driver.files.has(RESTORE_PATH)).toBe(false)
  })

  const importThroughSettings = async (settings, input) => {
    let complete
    const finished = new Promise(resolve => { complete = resolve })
    vi.stubGlobal('FileReader', class {
      readAsText() {
        const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(input), original).toString()
        Promise.resolve(this.onload({ target: { result: ciphertext } })).then(complete, complete)
      }
    })
    settings.handleFileUpload({ target: { files: [{}], value: 'synthetic-file' } })
    await finished
  }

  it('settings file import previews legacy exclusion; cancellation writes nothing and confirmation uses the coordinator', async () => {
    await createFullBackupRuntime().exportFull()
    const settings = useBackupSettings(), before = clone(chat.snapshot)
    appConfirm.mockResolvedValueOnce(false)
    const firstCall = driver.calls.length
    await importThroughSettings(settings, oldBackup('target-from-settings', 'synthetic old chat'))
    expect(driver.calls.slice(firstCall)).toEqual([])
    expect(appConfirm.mock.calls[0][0]).toContain('旧温馨小家的聊天、记忆、关系和事件不会导入彼方')
    expect(appToast).not.toHaveBeenCalled()
    appConfirm.mockResolvedValueOnce(true)
    await importThroughSettings(settings, oldBackup('target-from-settings', 'synthetic old chat'))
    expect(useWeightStore().weightRecords[0].id).toBe('target-from-settings')
    expect(chat.snapshot).toEqual(before)
    expect(appToast).toHaveBeenCalledWith('完整数据恢复成功', expect.any(Object))
    expect(driver.files.has(CHAT_DATA_PATH)).toBe(false)
    expect(driver.files.has(RESTORE_PATH)).toBe(false)
  })

  it('settings rejects old single chat before asking and does not turn cancellation into a graph merge', async () => {
    await createFullBackupRuntime().exportFull()
    const settings = useBackupSettings(), before = clone(chat.snapshot)
    settings.exportDataType.value = 'chat'
    const callsBefore = driver.calls.length
    await importThroughSettings(settings, {type: 'formyself-chat-backup', version: 4, data: {messages: []}})
    expect(appConfirm).not.toHaveBeenCalled()
    expect(appAlert).toHaveBeenCalled()
    expect(driver.calls.length).toBe(callsBefore)
    appConfirm.mockResolvedValueOnce(false)
    const target = clone(before); target.worlds[0].name = 'synthetic new import'
    await importThroughSettings(settings, buildKanataChatBackupSnapshot(target))
    expect(chat.snapshot).toEqual(before)
    expect(driver.calls.length).toBe(callsBefore)
    expect(appToast).not.toHaveBeenCalled()
    appConfirm.mockResolvedValueOnce(true)
    await importThroughSettings(settings, buildKanataChatBackupSnapshot(target))
    expect(chat.snapshot.worlds[0].name).toBe('synthetic new import')
    expect(appToast).toHaveBeenCalledWith('彼方资料恢复成功', expect.any(Object))
  })

  it('single-import adapters also pause untrusted raw-domain sending tasks rather than relying on UI parsing', async () => {
    const runtime = createFullBackupRuntime(), incoming = clone(chat.snapshot)
    incoming.tasks.push({ id: 'import-pending-send', worldId: incoming.worlds[0].id, kind: 'proactive', state: 'pending',
      idempotencyKey: 'raw-import-send', sourceRefs: [], sourceRevision: 1, attempt: 0, notBefore: 1000, leaseUntil: 2000,
      instanceId: incoming.instances[0].id, conversationId: incoming.conversations[0].id, resultEventIds: [] })
    await runtime.registry.singleImport('chat', incoming, { overwrite: true })
    expect(chat.snapshot.tasks[0].state).toBe('cancelled')
    expect(chat.snapshot.tasks[0].leaseUntil).toBe(0)
    expect(incoming.tasks[0].state).toBe('pending')
  })

  it('target participant failure compensates actual stores and the complete encrypted Kanata graph', async () => {
    const runtime = createFullBackupRuntime(), target = await runtime.exportFull(), before = clone(chat.snapshot)
    target.data.weight = [{ id: 'target-weight', date: '2026-01-02', weight: 70 }]
    target.data.chat.worlds[0].name = 'synthetic failed target world'
    driver.failNextPreference = STORAGE_KEYS.debtGroups
    await expect(runtime.restore(target, original)).rejects.toThrow('SYNTHETIC_WRITE_FAILURE')
    expect(useWeightStore().weightRecords[0].id).toBe('previous-weight')
    expect(chat.snapshot).toEqual(before)
    expect(decryptKanataData(driver.files.get(KANATA_DATA_PATH), original)).toEqual(before)
    expect(restoreState.blocked).toBe(false); expect(driver.files.has(RESTORE_PATH)).toBe(false)
  }, 15000)

  it('rollback failure keeps the real encrypted journal and barrier, then recovers after the fault is fixed', async () => {
    const runtime = createFullBackupRuntime(), target = await runtime.exportFull(), before = clone(chat.snapshot)
    target.data.weight = [{ id: 'target-weight', date: '2026-01-02', weight: 70 }]
    target.data.chat.worlds[0].name = 'synthetic blocked world'
    driver.alwaysFailPreference = STORAGE_KEYS.debtGroups
    await expect(runtime.restore(target, original)).rejects.toHaveProperty('rollbackFailed', true)
    expect(restoreState.blocked).toBe(true); expect(driver.files.has(RESTORE_PATH)).toBe(true)
    const encrypted = driver.files.get(RESTORE_PATH)
    expect(encrypted).not.toContain(original); expect(encrypted).not.toContain('previous-weight')
    await expect(runtime.recover('synthetic-wrong-password')).rejects.toThrow()
    expect(restoreState.blocked).toBe(true); expect(driver.files.get(RESTORE_PATH)).toBe(encrypted)
    driver.alwaysFailPreference = null
    await runtime.recover(original)
    expect(useWeightStore().weightRecords[0].id).toBe('previous-weight')
    expect(chat.snapshot).toEqual(before)
    expect(restoreState.blocked).toBe(false); expect(driver.files.has(RESTORE_PATH)).toBe(false)
  }, 15000)

  it.each([false, true])('old encrypted journal committed=%s restores only its chosen nonchat snapshot', async committed => {
    const before = clone(chat.snapshot), runtime = createFullBackupRuntime()
    const previous = oldBackup('old-journal-previous', 'legacy journal previous private content')
    const target = oldBackup('old-journal-target', 'legacy journal target private content')
    await restoreJournal.prepare({ version: 1, previous, target }, original)
    if (committed) await restoreJournal.commit()
    restoreState.blocked = true
    await runtime.recover(original)
    expect(useWeightStore().weightRecords[0].id).toBe(committed ? 'old-journal-target' : 'old-journal-previous')
    expect(chat.snapshot).toEqual(before)
    expect(driver.files.has(CHAT_DATA_PATH)).toBe(false); expect(driver.files.has(RESTORE_PATH)).toBe(false)
    expect(restoreState.blocked).toBe(false)
  }, 15000)

  it('master password transaction reencrypts actual new Kanata and vault stores and releases plaintext on expiry', async () => {
    const vault = usePasswordVaultStore()
    vault.addRecord({ id: 'vault-synthetic', appName: 'Synthetic vault', password: 'synthetic-fake' }); await vault.flush()
    const before = clone(chat.snapshot)
    await access.runOperation(['passwords', 'chat'], async () => changeMasterPasswordTransaction({
      currentPassword: original, newPassword: changed, reencryptors: await access.reencryptors(), commit: auth.commitPasswordChange
    }))
    expect(decryptKanataData(driver.files.get(KANATA_DATA_PATH), changed)).toEqual(before)
    expect(() => decryptKanataData(driver.files.get(KANATA_DATA_PATH), original)).toThrow('KANATA_DECRYPT_FAILED')
    auth.expireSession({ lockApp: false })
    await vi.waitFor(() => expect(chat.snapshot).toBe(null))
    expect(await auth.unlockWithPassword(changed, { unlockApp: false })).toBe(true)
    expect(await access.ensureModules()).toBe(true)
    expect(chat.snapshot).toEqual(before)
    expect(usePasswordVaultStore().records[0].id).toBe('vault-synthetic')
  }, 15000)

  it.each(['vault', 'kanata'])('master password failure in actual %s participant compensates both modules and remains reloadable', async participant => {
    const vault = usePasswordVaultStore()
    vault.addRecord({ id:'vault-compensation', appName:'Synthetic compensation', password:'synthetic-fake' })
    await vault.flush()
    const before = clone(chat.snapshot)
    if (participant === 'vault') driver.failNextPreference = STORAGE_KEYS.passwordVaultCategories
    else driver.failNextFile = 'formyself/kanata-v1.tmp'
    let failure
    try {
      await access.runOperation(['passwords','chat'], async () => changeMasterPasswordTransaction({
        currentPassword:original, newPassword:changed, reencryptors:await access.reencryptors(), commit:auth.commitPasswordChange
      }))
    } catch (error) { failure = error }
    expect(failure).toBeDefined()
    expect(failure.rollbackFailed).not.toBe(true)
    expect(auth.savedMasterPwd).toBe(original)
    expect(decryptKanataData(driver.files.get(KANATA_DATA_PATH), original)).toEqual(before)
    expect(() => decryptKanataData(driver.files.get(KANATA_DATA_PATH), changed)).toThrow()
    auth.expireSession({ lockApp:false })
    await vi.waitFor(() => expect(chat.snapshot).toBe(null))
    expect(await auth.unlockWithPassword(original,{unlockApp:false})).toBe(true)
    expect(await access.ensureModules()).toBe(true)
    expect(chat.snapshot).toEqual(before)
    expect(vault.records[0].id).toBe('vault-compensation')
  }, 15000)
})
