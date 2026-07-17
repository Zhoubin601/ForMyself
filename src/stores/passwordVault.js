import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import CryptoJS from 'crypto-js'

const ENCRYPTED_KEY = 'my_password_vault_encrypted'
const LEGACY_KEY = 'my_password_manager_data'

export const usePasswordVaultStore = defineStore('passwordVault', () => {
  const records = ref([])
  const isDataLoaded = ref(false)
  const encryptionPassword = ref('')
  const loadError = ref('')

  const normalizeRecords = (data) => {
    if (!Array.isArray(data)) throw new Error('INVALID_VAULT_DATA')
    return data.map((item) => ({
      id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      appName: String(item.appName || '').trim(),
      account: String(item.account || ''),
      password: String(item.password || ''),
      extraFields: Array.isArray(item.extraFields)
        ? item.extraFields.map((field) => ({
            fieldName: String(field.fieldName || ''),
            fieldValue: String(field.fieldValue || '')
          }))
        : []
    }))
  }

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
        records.value = normalizeRecords(JSON.parse(plaintext))
        return
      }

      const legacyResult = await Preferences.get({ key: LEGACY_KEY })
      if (legacyResult.value) {
        records.value = normalizeRecords(JSON.parse(legacyResult.value))
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
    records.value.push(normalizeRecords([record])[0])
  }

  const updateRecord = (id, record) => {
    const index = records.value.findIndex((item) => item.id === id)
    if (index !== -1) records.value[index] = { ...normalizeRecords([record])[0], id }
  }

  const deleteRecord = (id) => {
    records.value = records.value.filter((item) => item.id !== id)
  }

  const replaceRecords = (data) => {
    records.value = normalizeRecords(data)
  }

  const appendRecords = (data) => {
    records.value = [...records.value, ...normalizeRecords(data)]
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
    appendRecords,
    reencrypt
  }
})
