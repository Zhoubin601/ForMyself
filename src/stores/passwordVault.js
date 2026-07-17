import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import CryptoJS from 'crypto-js'
import { normalizePasswordVaultRecords } from '../services/passwordVaultRecords.js'

const ENCRYPTED_KEY = 'my_password_vault_encrypted'
const LEGACY_KEY = 'my_password_manager_data'

export const usePasswordVaultStore = defineStore('passwordVault', () => {
  const records = ref([])
  const isDataLoaded = ref(false)
  const encryptionPassword = ref('')
  const loadError = ref('')

  const persistEncrypted = async (password = encryptionPassword.value) => {
    if (!password) return
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(records.value), password).toString()
    await Preferences.set({ key: ENCRYPTED_KEY, value: encrypted })
  }

  const loadRecords = async (masterPassword) => {
    encryptionPassword.value = masterPassword || ''
    loadError.value = ''

    try {
      const encryptedResult = await Preferences.get({ key: ENCRYPTED_KEY })
      if (encryptedResult.value) {
        const bytes = CryptoJS.AES.decrypt(encryptedResult.value, encryptionPassword.value)
        const plaintext = bytes.toString(CryptoJS.enc.Utf8)
        if (!plaintext) throw new Error('DECRYPT_FAILED')
        const parsed = JSON.parse(plaintext)
        records.value = normalizePasswordVaultRecords(parsed)
        if (JSON.stringify(parsed) !== JSON.stringify(records.value)) await persistEncrypted()
        return
      }

      const legacyResult = await Preferences.get({ key: LEGACY_KEY })
      if (legacyResult.value) {
        records.value = normalizePasswordVaultRecords(JSON.parse(legacyResult.value))
        if (encryptionPassword.value) {
          await persistEncrypted()
          await Preferences.remove({ key: LEGACY_KEY })
        }
      }
    } catch (error) {
      console.error('读取密码库失败', error)
      loadError.value = '密码库解密失败，请确认主密码或恢复备份'
      records.value = []
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(records, async () => {
    if (isDataLoaded.value && encryptionPassword.value) await persistEncrypted()
  }, { deep: true })

  const addRecord = (record) => {
    records.value.push(normalizePasswordVaultRecords([record])[0])
  }

  const updateRecord = (id, record) => {
    const index = records.value.findIndex((item) => item.id === id)
    if (index !== -1) records.value[index] = { ...normalizePasswordVaultRecords([record])[0], id }
  }

  const deleteRecord = (id) => {
    records.value = records.value.filter((item) => item.id !== id)
  }

  const replaceRecords = (data) => {
    records.value = normalizePasswordVaultRecords(data)
  }

  const restoreRecords = async (data) => {
    records.value = normalizePasswordVaultRecords(data)
    await persistEncrypted()
  }

  const appendRecords = (data) => {
    records.value = normalizePasswordVaultRecords([...records.value, ...data])
  }

  const toggleFavorite = (id) => {
    const record = records.value.find(item => item.id === id)
    if (record) record.favorite = !record.favorite
  }

  const reencrypt = async (newPassword) => {
    encryptionPassword.value = newPassword
    await persistEncrypted(newPassword)
  }

  return {
    records,
    isDataLoaded,
    loadError,
    loadRecords,
    addRecord,
    updateRecord,
    deleteRecord,
    replaceRecords,
    restoreRecords,
    appendRecords,
    toggleFavorite,
    reencrypt
  }
})
