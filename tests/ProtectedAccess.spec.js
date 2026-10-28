import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  preferences: new Map(), get: vi.fn(), set: vi.fn(), prompt: vi.fn(), choose: vi.fn(),
  chatLoad: vi.fn(), chatSave: vi.fn(), alert: vi.fn(), secureGet: vi.fn()
}))
vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: {
  get: args => mocks.get(args), set: args => mocks.set(args),
  remove: async ({ key }) => { mocks.preferences.delete(key) }, flush: async () => {}
} }))
vi.mock('../src/services/uiFeedback.js', () => ({
  appPrompt: (...args) => mocks.prompt(...args), appChoose: (...args) => mocks.choose(...args),
  appAlert: (...args) => mocks.alert(...args), appToast: vi.fn(), resolveFeedbackDialog: vi.fn()
}))
vi.mock('../src/features/chat/chatStorage.js', async importOriginal => ({ ...await importOriginal(), createChatStorage: () => ({
  load: (...args) => mocks.chatLoad(...args), save: (...args) => mocks.chatSave(...args),
  saveEncrypted: (...args) => mocks.chatSave(...args)
}) }))
vi.mock('../src/platform/security/secureCredentials.js', () => ({ secureCredentials: {
  getMasterPassword: (...args) => mocks.secureGet(...args), hasMasterPassword: async () => false
} }))
// These scenarios explicitly exercise the retained v4 chat, not the new Kanata product runtime.
vi.mock('../src/application/protectedModules.js', async importOriginal => {
  const original = await importOriginal()
  return { ...original, protectedModules: original.createProtectedModuleRegistry([
    { id: 'passwords', resolve: async () => (await import('../src/stores/passwordVault.js')).usePasswordVaultStore(), load: (store, password) => store.loadRecords(password) },
    { id: 'chat', resolve: async () => (await import('../src/features/chat/chatStore.js')).useChatStore(), load: (store, password) => store.loadChatData(password) }
  ]) }
})

import { useAuthStore } from '../src/stores/auth.js'
import { useSettingsStore } from '../src/stores/settings.js'
import { useProtectedAccessStore } from '../src/stores/protectedAccess.js'
import { usePasswordVaultStore } from '../src/stores/passwordVault.js'
import { useChatStore } from '../src/features/chat/chatStore.js'
import { normalizeChatData } from '../src/features/chat/chatRecords.js'
import { STORAGE_KEYS } from '../src/platform/storage/keys.js'
import { buildFullBackupSnapshot, normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'

describe('历史旧聊天兼容回归：受保护会话与独立加载（非Kanata产品验收）', () => {
  let auth, access
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto)
    vi.clearAllMocks()
    mocks.preferences.clear()
    mocks.get.mockImplementation(async ({ key }) => ({ value: mocks.preferences.get(key) ?? null }))
    mocks.set.mockImplementation(async ({ key, value }) => { mocks.preferences.set(key, value) })
    mocks.prompt.mockResolvedValue('Synthetic-QA-2026')
    mocks.choose.mockResolvedValue('password')
    mocks.chatLoad.mockResolvedValue({ data: normalizeChatData(), recovered: false })
    mocks.chatSave.mockResolvedValue(undefined)
    setActivePinia(createPinia())
    auth = useAuthStore()
    await auth.setMasterPassword('Synthetic-QA-2026')
    access = useProtectedAccessStore()
  })

  it('仅打开密码库不会解密聊天，重复调用复用加载任务', async () => {
    const vault = usePasswordVaultStore()
    const load = vi.spyOn(vault, 'loadRecords')
    expect(await Promise.all([access.ensureModule('passwords'), access.ensureModule('passwords')])).toEqual([true, true])
    expect(load).toHaveBeenCalledTimes(1)
    expect(mocks.chatLoad).not.toHaveBeenCalled()
    expect(access.status).toEqual({ passwords: 'ready', chat: 'idle' })
    expect(await access.ensureModule('passwords')).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('统一解锁可以并行加载两个模块，不弹额外入口验证', async () => {
    expect(await access.ensureModules()).toBe(true)
    expect(access.status).toEqual({ passwords: 'ready', chat: 'ready' })
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('免进入验证不等于有解密权限；一次有效会话复用认证', async () => {
    auth.expireSession({ lockApp: false })
    expect(auth.isLocked).toBe(false)
    expect(access.authenticated).toBe(false)
    expect(await access.ensureModule('chat')).toBe(true)
    expect(access.status.passwords).toBe('idle')
    expect(await access.ensureModule('passwords')).toBe(true)
    expect(mocks.prompt).toHaveBeenCalledTimes(1)
  })

  it('取消或错误密码不解密，随后允许重试', async () => {
    auth.expireSession({ lockApp: false })
    mocks.prompt.mockResolvedValueOnce(null).mockResolvedValueOnce('wrong')
    expect(await access.ensureModule('chat')).toBe(false)
    expect(await access.ensureModule('chat')).toBe(false)
    expect(mocks.chatLoad).not.toHaveBeenCalled()
    expect(await access.ensureModule('chat')).toBe(true)
  })

  it('后台会话失效清空敏感数据而保留普通页面访问', async () => {
    await access.ensureModules()
    const vault = usePasswordVaultStore(), chat = useChatStore()
    vault.addRecord({ appName: 'Synthetic', account: 'test', password: 'fake' })
    chat.appendMessage('user', 'synthetic message')
    auth.expireSession({ lockApp: false })
    await nextTick()
    expect(auth.savedMasterPwd).toBe('')
    expect(auth.isLocked).toBe(false)
    expect(vault.records).toEqual([])
    expect(chat.messages).toEqual([])
    expect(access.status).toEqual({ passwords: 'idle', chat: 'idle' })
  })

  it('解密途中锁定阻止异步结果重新填入聊天数据', async () => {
    let resolve
    mocks.chatLoad.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const task = access.ensureModule('chat')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    auth.lockApp()
    resolve({ data: normalizeChatData({ messages: [{ id: 'late', role: 'user', content: 'late' }] }), recovered: false })
    expect(await task).toBe(false)
    expect(useChatStore().messages).toEqual([])
    expect(access.status.chat).toBe('idle')
  })

  it('解密失败不写入空数据，保留密文并允许重试', async () => {
    mocks.preferences.set(STORAGE_KEYS.passwordVault, 'corrupt synthetic ciphertext')
    const original = mocks.preferences.get(STORAGE_KEYS.passwordVault)
    expect(await access.ensureModule('passwords')).toBe(false)
    usePasswordVaultStore().addCategory('do not persist')
    await nextTick()
    expect(mocks.preferences.get(STORAGE_KEYS.passwordVault)).toBe(original)
    expect(access.status.passwords).toBe('error')
    mocks.preferences.delete(STORAGE_KEYS.passwordVault)
    expect(await access.ensureModule('passwords')).toBe(true)
  })

  it('锁定途中已开始的写事务使用原密码完成后才释放数据', async () => {
    await access.ensureModules()
    let finish, started
    const ready = new Promise(r => { started = r })
    const task = access.runOperation([], async password => {
      started()
      await new Promise(r => { finish = r })
      expect(password).toBe('Synthetic-QA-2026')
      expect(useChatStore().isDataLoaded).toBe(true)
      return true
    })
    await ready
    auth.lockApp()
    expect(access.authenticated).toBe(false)
    finish()
    expect(await task).toBe(true)
    await vi.waitFor(() => expect(useChatStore().isDataLoaded).toBe(false))
  })

  it('过期的指纹结果不能恢复会话', async () => {
    let resolve
    auth.hasBiometric = true
    auth.biometricCredentialReady = true
    mocks.secureGet.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const task = auth.unlockWithBiometric()
    auth.lockApp()
    resolve('Synthetic-QA-2026')
    expect(await task).toBe(false)
    expect(auth.savedMasterPwd).toBe('')
    expect(auth.isLocked).toBe(true)
  })

  it('启动偏好默认开启，损坏时也保持开启', async () => {
    const settings = useSettingsStore()
    await settings.loadSecuritySettings()
    expect(settings.requireAppUnlock).toBe(true)
    setActivePinia(createPinia())
    mocks.preferences.set(STORAGE_KEYS.securitySettings, 'bad json')
    const restored = useSettingsStore()
    await restored.loadSecuritySettings()
    expect(restored.requireAppUnlock).toBe(true)
  })

  it('保存开关失败保留内存和持久化旧值', async () => {
    const settings = useSettingsStore()
    await settings.loadSecuritySettings()
    mocks.set.mockRejectedValueOnce(new Error('synthetic write failure'))
    await expect(settings.updateRequireAppUnlock(false)).rejects.toThrow()
    expect(settings.requireAppUnlock).toBe(true)
    expect(JSON.parse(mocks.preferences.get(STORAGE_KEYS.securitySettings)).requireAppUnlock).toBe(true)
    await settings.updateRequireAppUnlock(false)
    expect(settings.requireAppUnlock).toBe(false)
  })

  it('v12备份保存开关，v11缺少字段默认开启', () => {
    const snapshot = buildFullBackupSnapshot({ settings: { requireAppUnlock: false } })
    expect(snapshot.version).toBe(12)
    expect(normalizeFullBackupSnapshot(snapshot).settings.requireAppUnlock).toBe(false)
    delete snapshot.settings.requireAppUnlock
    expect(normalizeFullBackupSnapshot({ ...snapshot, version: 11 }).settings.requireAppUnlock).toBe(true)
  })
})
