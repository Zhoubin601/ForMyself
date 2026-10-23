import { webcrypto } from 'node:crypto'
import CryptoJS from 'crypto-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const mocks = vi.hoisted(() => ({ preferences: new Map(), failCategories: false, chatDisk: null, failChatWrites: false, writes: [] }))
vi.mock('../../../src/platform/storage/preferences.js', () => ({ preferenceStorage: {
  get: async ({ key }) => ({ value: mocks.preferences.get(key) ?? null }),
  set: async ({ key, value }) => {
    if (mocks.failCategories && key === 'my_password_vault_categories_encrypted') {
      mocks.failCategories = false
      throw new Error('SYNTHETIC_CATEGORY_WRITE_FAILURE')
    }
    mocks.preferences.set(key, value)
  },
  remove: async ({ key }) => mocks.preferences.delete(key), flush: async () => {}
} }))
vi.mock('../../../src/features/chat/chatStorage.js', async importOriginal => {
  const original = await importOriginal()
  const { normalizeChatData } = await import('../../../src/features/chat/chatRecords.js')
  return { ...original, createChatStorage: () => ({
    load: async () => ({ data: normalizeChatData(mocks.chatDisk || {}), recovered: false,
      fingerprint: mocks.writes.filter(x=>x.saved).at(-1)?.fingerprint || '' }),
    save: async (data, password) => {
      mocks.writes.push({ data: JSON.parse(JSON.stringify(data)), password })
      if (mocks.failChatWrites) throw new Error('SYNTHETIC_DISK_FAILURE')
      mocks.chatDisk = JSON.parse(JSON.stringify(data))
    },
    saveEncrypted: async ciphertext => {
      const data = original.decryptChatData(ciphertext, 'Synthetic-Review-Old')
      mocks.writes.push({ data, fingerprint: original.chatCiphertextFingerprint(ciphertext), saved: !mocks.failChatWrites })
      if (mocks.failChatWrites) throw new Error('SYNTHETIC_DISK_FAILURE')
      mocks.chatDisk = JSON.parse(JSON.stringify(data))
    }
  }) }
})
vi.mock('../../../src/services/uiFeedback.js', () => ({
  appPrompt: vi.fn(), appChoose: vi.fn(), appAlert: vi.fn(), appToast: vi.fn(), resolveFeedbackDialog: vi.fn()
}))

import { useAuthStore } from '../../../src/stores/auth.js'
import { useProtectedAccessStore } from '../../../src/stores/protectedAccess.js'
import { usePasswordVaultStore } from '../../../src/stores/passwordVault.js'
import { useChatStore } from '../../../src/features/chat/chatStore.js'
import { changeMasterPasswordTransaction } from '../../../src/services/masterPasswordChange.js'
import { STORAGE_KEYS } from '../../../src/platform/storage/keys.js'

const oldPassword = 'Synthetic-Review-Old', nextPassword = 'Synthetic-Review-New'
const decrypt = (value, password) => {
  try { return JSON.parse(CryptoJS.AES.decrypt(value, password).toString(CryptoJS.enc.Utf8)) } catch { return null }
}

describe('交付记录独立复核：实际业务函数的异常路径', () => {
  let auth, access
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto)
    mocks.preferences.clear(); mocks.failCategories = false
    mocks.chatDisk = null; mocks.failChatWrites = false; mocks.writes = []
    setActivePinia(createPinia())
    auth = useAuthStore()
    await auth.setMasterPassword(oldPassword)
    access = useProtectedAccessStore()
  })

  it('密码库两份密文只写成功一份时，真实改密事务应将其回滚至旧密码', async () => {
    await access.ensureModules()
    const vault = usePasswordVaultStore(), chat = useChatStore()
    vault.addRecord({ appName: 'Synthetic rollback record', password: 'fake', category: 'QA' })
    await nextTick()
    mocks.failCategories = true
    await expect(access.runOperation(['passwords', 'chat'], () => changeMasterPasswordTransaction({
      currentPassword: oldPassword, newPassword: nextPassword,
      reencryptors: [vault.reencrypt, chat.reencrypt], commit: auth.commitPasswordChange
    }))).rejects.toThrow('SYNTHETIC_CATEGORY_WRITE_FAILURE')
    const cipher = mocks.preferences.get(STORAGE_KEYS.passwordVault)
    const categories = mocks.preferences.get(STORAGE_KEYS.passwordVaultCategories)
    console.log('PARTIAL_WRITE', JSON.stringify({
      oldPasswordAcceptsVerifier: await auth.unlockWithPassword(oldPassword),
      oldPasswordDecryptsRecords: !!decrypt(cipher, oldPassword),
      newPasswordDecryptsRecords: !!decrypt(cipher, nextPassword),
      oldPasswordDecryptsCategories: !!decrypt(categories, oldPassword)
    }))
    expect(decrypt(cipher, oldPassword)?.[0]?.appName).toBe('Synthetic rollback record')
  })

  it('持久化失败后锁定再恢复，应仍能找回尚未保存的聊天消息', async () => {
    await access.ensureModule('chat')
    const chat = useChatStore()
    chat.appendMessage('user', 'Synthetic previously saved message')
    await chat.flush()
    mocks.failChatWrites = true
    chat.appendMessage('user', 'Synthetic unsaved message')
    await expect(chat.flush()).rejects.toThrow('SYNTHETIC_DISK_FAILURE')
    auth.expireSession({ lockApp: false })
    await nextTick()
    mocks.failChatWrites = false
    await auth.unlockWithPassword(oldPassword, { unlockApp: false })
    await access.ensureModule('chat')
    console.log('FAILED_SAVE', JSON.stringify({ messagesAfterReunlock: chat.messages.map(x => x.content), loadError: chat.loadError }))
    expect(chat.messages.some(x => x.content === 'Synthetic unsaved message')).toBe(true)
  })
})
