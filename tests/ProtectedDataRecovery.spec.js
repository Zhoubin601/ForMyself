import { createFullBackupRuntime } from '../src/application/fullBackupRuntime.js'
import { buildFullBackupSnapshot } from '../src/services/fullBackup.js'
import { restoreState } from '../src/platform/storage/restoreState.js'
import { RESTORE_PATH } from '../src/platform/storage/restoreJournal.js'
import { useWeightStore } from '../src/stores/weight.js'
import { webcrypto } from 'node:crypto'
import CryptoJS from 'crypto-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const mock = vi.hoisted(() => ({ preferences: new Map(), files: new Map(),
  failPreference: null, failJournal: false, failCleanup: false, failFiles: false,
  alwaysFailPreference: null, delayPreference: null, delayFileWrite: null, alert: vi.fn()
}))
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }) => ({ value: mock.preferences.get(key) ?? null }),
  set: async ({ key, value }) => {
    if (mock.alwaysFailPreference === key) throw new Error('INJECTED_PERSISTENT_PREFERENCE_FAILURE')
    if (mock.failPreference === key) { mock.failPreference = null; throw new Error('INJECTED_PREFERENCE_FAILURE') }
    if (mock.failJournal && key === 'my_chat_recovery_encrypted_v1') throw new Error('INJECTED_JOURNAL_FAILURE')
    if (mock.delayPreference?.key === key) await mock.delayPreference.wait
    mock.preferences.set(key, value)
  },
  remove: async ({ key }) => {
    if (mock.failCleanup && key === 'my_chat_recovery_encrypted_v1') throw new Error('INJECTED_CLEANUP_FAILURE')
    mock.preferences.delete(key)
  }
} }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
  stat: async ({ path }) => { if (!mock.files.has(path)) throw new Error('ENOENT'); return {} },
  readFile: async ({ path }) => { if (!mock.files.has(path)) throw new Error('ENOENT'); return { data: mock.files.get(path) } },
  mkdir: async () => {},
  writeFile: async ({ path, data }) => {
    if (mock.failFiles) throw new Error('INJECTED_FILESYSTEM_FAILURE')
    if (mock.delayFileWrite) await mock.delayFileWrite
    mock.files.set(path, data)
  },
  deleteFile: async ({ path }) => { mock.files.delete(path) },
  rename: async ({ from, to }) => { if (!mock.files.has(from)) throw new Error('ENOENT'); mock.files.set(to, mock.files.get(from)); mock.files.delete(from) }
} }))
vi.mock('../src/services/uiFeedback.js', () => ({
  appPrompt: vi.fn(), appChoose: vi.fn(), appAlert: (...args) => mock.alert(...args), appToast: vi.fn(), resolveFeedbackDialog: vi.fn()
}))

import { useAuthStore } from '../src/stores/auth.js'
import { useProtectedAccessStore } from '../src/stores/protectedAccess.js'
import { usePasswordVaultStore } from '../src/stores/passwordVault.js'
import { useChatStore } from '../src/features/chat/chatStore.js'
import { preferenceStorage } from '../src/platform/storage/preferences.js'
import { STORAGE_KEYS } from '../src/platform/storage/keys.js'
import { CHAT_DATA_PATH, createChatStorage, decryptChatData } from '../src/features/chat/chatStorage.js'
import { changeMasterPasswordTransaction } from '../src/services/masterPasswordChange.js'

const original = 'Synthetic-recovery-original', updated = 'Synthetic-recovery-updated'
const decode = (ciphertext, password) => JSON.parse(CryptoJS.AES.decrypt(ciphertext, password).toString(CryptoJS.enc.Utf8))

describe('实际加密存储：改密回滚与失败保存恢复', () => {
  let auth, access
  beforeEach(async () => {
    Object.assign(restoreState, { blocked: false, busy: false, message: '', syncError: '' })
    await preferenceStorage.flush()
    vi.stubGlobal('crypto', webcrypto)
    mock.preferences.clear(); mock.files.clear(); mock.alert.mockClear()
    mock.failPreference = null; mock.delayPreference = null
    mock.alwaysFailPreference = null; mock.delayFileWrite = null
    mock.failJournal = false; mock.failCleanup = false; mock.failFiles = false
    setActivePinia(createPinia())
    auth = useAuthStore()
    await auth.setMasterPassword(original)
    access = useProtectedAccessStore()
  })
  const changePassword = () => access.runOperation(['passwords', 'chat'], () => changeMasterPasswordTransaction({
    currentPassword: original, newPassword: updated,
    reencryptors: [usePasswordVaultStore().reencrypt, useChatStore().reencrypt], commit: auth.commitPasswordChange
  }))
  const prepareVault = async () => {
    await access.ensureModules()
    usePasswordVaultStore().addRecord({ appName: 'Synthetic protected entry', password: 'fake', category: 'QA' })
    await preferenceStorage.flush()
  }
  const expectOriginalVaultReadable = async () => {
    expect(decode(mock.preferences.get(STORAGE_KEYS.passwordVault), original)[0].appName).toBe('Synthetic protected entry')
    expect(decode(mock.preferences.get(STORAGE_KEYS.passwordVaultCategories), original)).toContain('QA')
    auth.expireSession({ lockApp: false })
    await auth.unlockWithPassword(original, { unlockApp: false })
    expect(await access.ensureModule('passwords')).toBe(true)
    expect(usePasswordVaultStore().records[0].appName).toBe('Synthetic protected entry')
  }
  it.each([STORAGE_KEYS.passwordVault, STORAGE_KEYS.passwordVaultCategories])('一份密文写入失败，另一份也回滚且原密码可重载：%s', async key => {
    await prepareVault()
    mock.failPreference = key
    await expect(changePassword()).rejects.toThrow('INJECTED_PREFERENCE_FAILURE')
    await expectOriginalVaultReadable()
  })
  it('失败返回前等待迟到写入完成，防止它在回滚之后覆盖密文', async () => {
    await prepareVault()
    let unblock
    mock.delayPreference = { key: STORAGE_KEYS.passwordVaultCategories, wait: new Promise(resolve => { unblock = resolve }) }
    mock.failPreference = STORAGE_KEYS.passwordVault
    let settled = false
    const task = changePassword().catch(error => { settled = true; return error })
    await nextTick(); await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    unblock(); mock.delayPreference = null
    expect((await task).message).toBe('INJECTED_PREFERENCE_FAILURE')
    await expectOriginalVaultReadable()
  })
  it('重加密过程中有新记录时，最终两份密文都采用新密码并保留新记录', async () => {
    await prepareVault()
    let unblock
    mock.delayPreference = { key: STORAGE_KEYS.passwordVaultCategories, wait: new Promise(resolve => { unblock = resolve }) }
    const task = changePassword()
    await new Promise(resolve => setTimeout(resolve, 20))
    usePasswordVaultStore().addRecord({ appName: 'Synthetic concurrent entry', password: 'also-fake', category: 'New QA' })
    unblock(); mock.delayPreference = null
    await task
    expect(decode(mock.preferences.get(STORAGE_KEYS.passwordVault), updated)).toHaveLength(2)
    expect(decode(mock.preferences.get(STORAGE_KEYS.passwordVaultCategories), updated)).toContain('New QA')
  })
  it('真正回滚失败时标记故障并阻止后续受保护写操作', async () => {
    await prepareVault()
    mock.alwaysFailPreference = STORAGE_KEYS.passwordVaultCategories
    await expect(changePassword()).rejects.toMatchObject({ rollbackFailed: true })
    expect(access.recoveryRequired).toBe(true)
    expect(access.status).toEqual({ passwords: 'error', chat: 'error' })
    const action = vi.fn()
    expect(await access.runOperation(['passwords'], action)).toBe(false)
    expect(action).not.toHaveBeenCalled()
  })
  it('聊天在重加密途中新增消息，所有消息最终用新密码保存', async () => {
    await prepareVault()
    let unblock
    mock.delayFileWrite = new Promise(resolve => { unblock = resolve })
    const task = changePassword()
    await new Promise(resolve => setTimeout(resolve, 20))
    useChatStore().appendMessage('user', 'Synthetic concurrent chat update')
    unblock(); mock.delayFileWrite = null
    await task
    expect(decryptChatData(mock.files.get(CHAT_DATA_PATH), updated).messages.some(x => x.content === 'Synthetic concurrent chat update')).toBe(true)
  })
  const failChatSave = async () => {
    await access.ensureModule('chat')
    const chat = useChatStore()
    chat.appendMessage('user', 'Synthetic saved message'); await chat.flush()
    mock.failFiles = true
    chat.appendMessage('user', 'Synthetic pending message')
    await expect(chat.flush()).rejects.toThrow('INJECTED_FILESYSTEM_FAILURE')
    return chat
  }
  it('保存失败后锁定清除明文和密码，保留加密副本及错误，重新验证后恢复', async () => {
    const chat = await failChatSave()
    auth.expireSession({ lockApp: false })
    await vi.waitFor(() => expect(access.releaseError).not.toBe(''))
    expect(chat.messages).toEqual([]); expect(auth.savedMasterPwd).toBe('')
    const journal = mock.preferences.get(STORAGE_KEYS.chatRecovery)
    expect(journal).not.toContain('Synthetic pending message'); expect(journal).not.toContain(original)
    expect(chat.saveError).not.toBe(''); expect(mock.alert).toHaveBeenCalled()
    mock.failFiles = false
    await auth.unlockWithPassword(original, { unlockApp: false })
    expect(await access.ensureModule('chat')).toBe(true)
    expect(chat.messages.some(x => x.content === 'Synthetic pending message')).toBe(true)
    expect(chat.saveError).toBe(''); expect(access.releaseError).toBe('')
    expect(decryptChatData(mock.files.get(CHAT_DATA_PATH), original).messages).toHaveLength(2)
  })
  it('模拟进程重建，仍能用原密码从持久化恢复副本找回未保存消息', async () => {
    await failChatSave()
    auth.expireSession({ lockApp: false }); await nextTick()
    mock.failFiles = false
    setActivePinia(createPinia())
    auth = useAuthStore(); await auth.loadAuthData({ checkBiometric: false })
    await auth.unlockWithPassword(original)
    access = useProtectedAccessStore()
    expect(await access.ensureModule('chat')).toBe(true)
    expect(useChatStore().messages.some(x => x.content === 'Synthetic pending message')).toBe(true)
  })
  it('两个存储都失败时保留进程内密文，提示勿强退，同进程解锁后可恢复', async () => {
    mock.failJournal = true
    const chat = await failChatSave()
    expect(chat.saveError).toContain('勿强制结束')
    auth.expireSession({ lockApp: false }); await nextTick()
    expect(mock.preferences.has(STORAGE_KEYS.chatRecovery)).toBe(false)
    expect(chat.messages).toEqual([])
    mock.failFiles = false; mock.failJournal = false
    await auth.unlockWithPassword(original, { unlockApp: false })
    expect(await access.ensureModule('chat')).toBe(true)
    expect(chat.messages).toHaveLength(2)
  })
  it('存储仍失败时可恢复消息并继续显示保存警告，手动重试后落盘', async () => {
    const chat = await failChatSave()
    auth.expireSession({ lockApp: false }); await nextTick()
    await auth.unlockWithPassword(original, { unlockApp: false })
    expect(await access.ensureModule('chat')).toBe(true)
    expect(chat.messages).toHaveLength(2); expect(chat.saveError).not.toBe('')
    mock.failFiles = false
    await chat.flush()
    expect(chat.saveError).toBe(''); expect(chat.hasPendingSave).toBe(false)
  })
  it('恢复副本清理及后续副本写入失败，旧副本不能覆盖更新的主文件', async () => {
    await access.ensureModule('chat')
    const chat = useChatStore()
    mock.failCleanup = true
    chat.appendMessage('user', 'Synthetic earlier message'); await chat.flush()
    mock.failJournal = true
    chat.appendMessage('user', 'Synthetic newer message'); await chat.flush()
    setActivePinia(createPinia())
    auth = useAuthStore(); await auth.loadAuthData({ checkBiometric: false }); await auth.unlockWithPassword(original)
    access = useProtectedAccessStore()
    expect(await access.ensureModule('chat')).toBe(true)
    expect(useChatStore().messages.some(x => x.content === 'Synthetic newer message')).toBe(true)
    expect((await createChatStorage().load(original)).data.messages).toHaveLength(2)
  })
  it('产品完整恢复协调器使用实际全部Store，参与者失败后原数据与加密资料均回滚', async () => {
    const weight = useWeightStore(); await weight.loadWeightRecords()
    weight.addRecord({ id: 'original-weight', date: '2026-10-26', weight: 65 }); await weight.flush()
    await prepareVault()
    const runtime = createFullBackupRuntime()
    mock.failPreference = STORAGE_KEYS.debtGroups
    const target = buildFullBackupSnapshot({ weight: [{ id: 'target-weight', weight: 60 }], passwords: [{ id: 'changed', appName: 'target', password: 'fake' }] })
    await expect(runtime.restore(target, original)).rejects.toThrow('INJECTED_PREFERENCE_FAILURE')
    expect(weight.weightRecords[0].id).toBe('original-weight')
    expect(JSON.parse(mock.preferences.get(STORAGE_KEYS.weightRecords))[0].id).toBe('original-weight')
    await expectOriginalVaultReadable()
    expect(restoreState.blocked).toBe(false); expect(mock.files.has(RESTORE_PATH)).toBe(false)
  })

  it('密码库保存持续失败后释放不保留明文，重试解锁先保存待写密文再读取', async () => {
    await prepareVault()
    const vault = usePasswordVaultStore()
    mock.alwaysFailPreference = STORAGE_KEYS.passwordVault
    vault.addRecord({ id: 'pending-vault', appName: 'Synthetic pending vault', password: 'fake' })
    await preferenceStorage.flush()
    await vi.waitFor(() => expect(vault.saveError).toContain('尚未保存'))
    await expect(vault.flush()).rejects.toThrow()
    auth.expireSession({ lockApp: false }); await nextTick()
    await vi.waitFor(() => expect(vault.records).toHaveLength(0))
    mock.alwaysFailPreference = null
    await auth.unlockWithPassword(original, { unlockApp: false })
    expect(await access.ensureModule('passwords')).toBe(true)
    expect(vault.records.some(r => r.appName === 'Synthetic pending vault')).toBe(true)
    expect(decode(mock.preferences.get(STORAGE_KEYS.passwordVault), original).some(r => r.appName === 'Synthetic pending vault')).toBe(true)
    expect(vault.saveError).toBe('')
  })

})
