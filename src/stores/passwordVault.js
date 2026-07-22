import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import CryptoJS from 'crypto-js'
import {
  DEFAULT_VAULT_CATEGORY,
  getVaultCategories,
  isVaultCategoryInUse,
  normalizePasswordVaultRecords,
  normalizeVaultCategoryName
} from '../services/passwordVaultRecords.js'

const ENCRYPTED_KEY = 'my_password_vault_encrypted'
const CATEGORIES_ENCRYPTED_KEY = 'my_password_vault_categories_encrypted'
const LEGACY_KEY = 'my_password_manager_data'

export const usePasswordVaultStore = defineStore('passwordVault', () => {
  const records = ref([])
  const categories = ref(getVaultCategories())
  const isDataLoaded = ref(false)
  const encryptionPassword = ref('')
  const loadError = ref('')

  const persistEncrypted = async (password = encryptionPassword.value) => {
    if (!password) return
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(records.value), password).toString()
    await Preferences.set({ key: ENCRYPTED_KEY, value: encrypted })
  }

  const persistCategoriesEncrypted = async (password = encryptionPassword.value) => {
    if (!password) return
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(categories.value), password).toString()
    await Preferences.set({ key: CATEGORIES_ENCRYPTED_KEY, value: encrypted })
  }

  const syncCategoriesFromRecords = () => {
    categories.value = getVaultCategories(records.value, categories.value)
  }

  const loadRecords = async (masterPassword) => {
    encryptionPassword.value = masterPassword || ''
    loadError.value = ''

    try {
      const [encryptedResult, categoriesResult] = await Promise.all([
        Preferences.get({ key: ENCRYPTED_KEY }),
        Preferences.get({ key: CATEGORIES_ENCRYPTED_KEY })
      ])
      if (encryptedResult.value) {
        const bytes = CryptoJS.AES.decrypt(encryptedResult.value, encryptionPassword.value)
        const plaintext = bytes.toString(CryptoJS.enc.Utf8)
        if (!plaintext) throw new Error('DECRYPT_FAILED')
        const parsed = JSON.parse(plaintext)
        records.value = normalizePasswordVaultRecords(parsed)
        if (JSON.stringify(parsed) !== JSON.stringify(records.value)) await persistEncrypted()
      } else {
        const legacyResult = await Preferences.get({ key: LEGACY_KEY })
        if (legacyResult.value) {
          records.value = normalizePasswordVaultRecords(JSON.parse(legacyResult.value))
          if (encryptionPassword.value) {
            await persistEncrypted()
            await Preferences.remove({ key: LEGACY_KEY })
          }
        }
      }

      let savedCategories
      if (categoriesResult.value) {
        const bytes = CryptoJS.AES.decrypt(categoriesResult.value, encryptionPassword.value)
        const plaintext = bytes.toString(CryptoJS.enc.Utf8)
        if (!plaintext) throw new Error('CATEGORY_DECRYPT_FAILED')
        savedCategories = JSON.parse(plaintext)
      }
      categories.value = getVaultCategories(records.value, savedCategories)
      if (!categoriesResult.value && encryptionPassword.value) await persistCategoriesEncrypted()
    } catch (error) {
      console.error('读取密码库失败', error)
      loadError.value = '密码库解密失败，请确认主密码或恢复备份'
      records.value = []
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(records, async () => {
    if (isDataLoaded.value && encryptionPassword.value) {
      syncCategoriesFromRecords()
      await persistEncrypted()
    }
  }, { deep: true })

  watch(categories, async () => {
    if (isDataLoaded.value && encryptionPassword.value) await persistCategoriesEncrypted()
  }, { deep: true })

  const addRecord = (record) => {
    records.value.push(normalizePasswordVaultRecords([record])[0])
    syncCategoriesFromRecords()
  }

  const updateRecord = (id, record) => {
    const index = records.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      records.value[index] = { ...normalizePasswordVaultRecords([record])[0], id }
      syncCategoriesFromRecords()
    }
  }

  const deleteRecord = (id) => {
    records.value = records.value.filter((item) => item.id !== id)
  }

  const replaceRecords = (data) => {
    records.value = normalizePasswordVaultRecords(data)
    syncCategoriesFromRecords()
  }

  const restoreRecords = async (data, metadata = {}) => {
    records.value = normalizePasswordVaultRecords(data)
    categories.value = getVaultCategories(records.value, metadata.categories)
    await Promise.all([persistEncrypted(), persistCategoriesEncrypted()])
  }

  const appendRecords = (data) => {
    records.value = normalizePasswordVaultRecords([...records.value, ...data])
    syncCategoriesFromRecords()
  }

  const addCategory = (value) => {
    const category = normalizeVaultCategoryName(value)
    if (!category) return { ok: false, reason: 'EMPTY' }
    if (categories.value.includes(category)) return { ok: false, reason: 'EXISTS', category }
    categories.value = [...categories.value.filter(item => item !== DEFAULT_VAULT_CATEGORY), category, DEFAULT_VAULT_CATEGORY]
    return { ok: true, category }
  }

  const deleteCategory = (value) => {
    const category = normalizeVaultCategoryName(value)
    if (category === DEFAULT_VAULT_CATEGORY) return { ok: false, reason: 'PROTECTED' }
    if (!categories.value.includes(category)) return { ok: false, reason: 'NOT_FOUND' }
    if (isVaultCategoryInUse(records.value, category)) return { ok: false, reason: 'IN_USE' }
    categories.value = categories.value.filter(item => item !== category)
    return { ok: true, category }
  }

  const toggleFavorite = (id) => {
    const record = records.value.find(item => item.id === id)
    if (record) record.favorite = !record.favorite
  }

  const reencrypt = async (newPassword) => {
    encryptionPassword.value = newPassword
    await Promise.all([persistEncrypted(newPassword), persistCategoriesEncrypted(newPassword)])
  }

  return {
    records,
    categories,
    isDataLoaded,
    loadError,
    loadRecords,
    addRecord,
    updateRecord,
    deleteRecord,
    replaceRecords,
    restoreRecords,
    appendRecords,
    addCategory,
    deleteCategory,
    toggleFavorite,
    reencrypt
  }
})
