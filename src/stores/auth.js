import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { STORAGE_KEYS } from '../platform/storage/keys.js'
import { preferenceStorage } from '../platform/storage/preferences.js'
import { secureCredentials } from '../platform/security/secureCredentials.js'
import {
  createMasterPasswordVerifier,
  masterPasswordVerifierEquals,
  normalizeMasterPasswordVerifier,
  validateNewMasterPassword,
  verifyMasterPassword
} from '../services/masterPasswordSecurity.js'

export const useAuthStore = defineStore('auth', () => {
  const isLocked = ref(true)
  const hasMasterPassword = ref(false)
  const savedMasterPwd = ref('')
  const hasBiometric = ref(false)
  const biometricCredentialReady = ref(false)
  const isLegacyPasswordPending = ref(false)
  const isDataLoaded = ref(false)
  const loadError = ref('')
  const verifierRecord = ref(null)
  let legacyPassword = ''
  let biometricBinding = ''
  let biometricChangeAuthorizedUntil = 0

  const canUnlockWithBiometric = computed(() => (
    hasBiometric.value && (biometricCredentialReady.value || isLegacyPasswordPending.value)
  ))
  const needsBiometricSetup = computed(() => (
    hasBiometric.value && hasMasterPassword.value && !biometricCredentialReady.value
  ))

  const saveVerifier = async password => {
    const verifier = await createMasterPasswordVerifier(password)
    const previous = verifierRecord.value
    try {
      await preferenceStorage.set({
        key: STORAGE_KEYS.masterPasswordVerifier,
        value: JSON.stringify(verifier)
      })
      const stored = await preferenceStorage.get({ key: STORAGE_KEYS.masterPasswordVerifier })
      const normalized = normalizeMasterPasswordVerifier(JSON.parse(stored.value || 'null'))
      if (!masterPasswordVerifierEquals(verifier, normalized)) throw new Error('MASTER_PASSWORD_VERIFIER_WRITE_FAILED')
      verifierRecord.value = normalized
      return normalized
    } catch (error) {
      try {
        if (previous) {
          await preferenceStorage.set({
            key: STORAGE_KEYS.masterPasswordVerifier,
            value: JSON.stringify(previous)
          })
        } else {
          await preferenceStorage.remove({ key: STORAGE_KEYS.masterPasswordVerifier })
        }
      } catch {
        error.rollbackFailed = true
      }
      throw error
    }
  }

  const refreshBiometricAvailability = async () => {
    if (!Capacitor.isNativePlatform()) {
      hasBiometric.value = false
      biometricCredentialReady.value = false
      return
    }
    try {
      const result = await NativeBiometric.isAvailable()
      hasBiometric.value = Boolean(result.isAvailable && result.strongBiometryIsAvailable !== false)
      biometricCredentialReady.value = Boolean(
        hasBiometric.value
        && verifierRecord.value
        && biometricBinding === verifierRecord.value.verifier
        && await secureCredentials.hasMasterPassword()
      )
    } catch {
      hasBiometric.value = false
      biometricCredentialReady.value = false
    }
  }

  const loadAuthData = async (options = {}) => {
    loadError.value = ''
    try {
      const [verifierResult, legacyResult, bindingResult] = await Promise.all([
        preferenceStorage.get({ key: STORAGE_KEYS.masterPasswordVerifier }),
        preferenceStorage.get({ key: STORAGE_KEYS.legacyMasterPassword }),
        preferenceStorage.get({ key: STORAGE_KEYS.masterPasswordBiometricBinding })
      ])
      if (verifierResult.value) {
        verifierRecord.value = normalizeMasterPasswordVerifier(JSON.parse(verifierResult.value))
        if (!verifierRecord.value) throw new Error('INVALID_MASTER_PASSWORD_VERIFIER')
      }
      legacyPassword = String(legacyResult.value || '')
      biometricBinding = String(bindingResult.value || '')
      isLegacyPasswordPending.value = Boolean(legacyPassword)
      hasMasterPassword.value = Boolean(verifierRecord.value || legacyPassword)
      if (options.checkBiometric !== false) await refreshBiometricAvailability()
    } catch (error) {
      console.error('读取授权数据失败', error)
      loadError.value = '安全设置读取失败，请勿卸载应用'
    } finally {
      isDataLoaded.value = true
    }
  }

  const provisionBiometricCredential = async password => {
    if (!hasBiometric.value || !Capacitor.isNativePlatform() || !verifierRecord.value) {
      biometricCredentialReady.value = false
      return false
    }
    try {
      await secureCredentials.storeMasterPassword(password)
      biometricBinding = verifierRecord.value.verifier
      await preferenceStorage.set({
        key: STORAGE_KEYS.masterPasswordBiometricBinding,
        value: biometricBinding
      })
      biometricCredentialReady.value = await secureCredentials.hasMasterPassword()
      return biometricCredentialReady.value
    } catch {
      biometricBinding = ''
      await preferenceStorage.remove({ key: STORAGE_KEYS.masterPasswordBiometricBinding }).catch(() => {})
      biometricCredentialReady.value = false
      return false
    }
  }

  const unlockWithPassword = async inputPassword => {
    const password = String(inputPassword || '')
    const valid = verifierRecord.value
      ? await verifyMasterPassword(password, verifierRecord.value)
      : Boolean(legacyPassword) && password === legacyPassword
    if (!valid) return false

    if (!verifierRecord.value) await saveVerifier(password)
    savedMasterPwd.value = password
    isLocked.value = false
    return true
  }

  const unlockWithBiometric = async () => {
    try {
      let password
      if (biometricCredentialReady.value) {
        password = await secureCredentials.getMasterPassword()
      } else if (isLegacyPasswordPending.value && legacyPassword) {
        if (!verifierRecord.value) await saveVerifier(legacyPassword)
        if (!await provisionBiometricCredential(legacyPassword)) return false
        password = legacyPassword
      } else {
        return false
      }
      if (verifierRecord.value && !await verifyMasterPassword(password, verifierRecord.value)) {
        biometricBinding = ''
        await preferenceStorage.remove({ key: STORAGE_KEYS.masterPasswordBiometricBinding }).catch(() => {})
        biometricCredentialReady.value = false
        return false
      }
      savedMasterPwd.value = password
      isLocked.value = false
      return true
    } catch (error) {
      const retryableCodes = new Set(['10', '11', '15', '16', '17'])
      if (!retryableCodes.has(String(error?.code || ''))) biometricCredentialReady.value = false
      return false
    }
  }

  const finalizeLegacyMigration = async () => {
    if (!isLegacyPasswordPending.value || !savedMasterPwd.value || !verifierRecord.value) return false
    if (!await verifyMasterPassword(savedMasterPwd.value, verifierRecord.value)) return false
    await preferenceStorage.remove({ key: STORAGE_KEYS.legacyMasterPassword })
    legacyPassword = ''
    isLegacyPasswordPending.value = false
    return true
  }

  const setMasterPassword = async newPassword => {
    if (String(newPassword || '').length < 4) return false
    await saveVerifier(newPassword)
    savedMasterPwd.value = newPassword
    hasMasterPassword.value = true
    isLocked.value = false
    return true
  }

  const validatePasswordChange = async (oldPassword, newPassword, confirmation) => {
    const nextError = validateNewMasterPassword(newPassword, confirmation)
    if (nextError) return nextError
    if (!savedMasterPwd.value || oldPassword !== savedMasterPwd.value) return '原密码错误'
    return null
  }

  const authorizeBiometricPasswordChange = async () => {
    if (!biometricCredentialReady.value) return false
    try {
      const password = await secureCredentials.getMasterPassword({
        title: '安全认证',
        reason: '验证生物信息以重设主密码'
      })
      const valid = verifierRecord.value && await verifyMasterPassword(password, verifierRecord.value)
      if (!valid) return false
      biometricChangeAuthorizedUntil = Date.now() + 2 * 60 * 1000
      return true
    } catch {
      return false
    }
  }

  const validateBiometricPasswordChange = (newPassword, confirmation) => {
    const nextError = validateNewMasterPassword(newPassword, confirmation)
    if (nextError) return nextError
    if (Date.now() > biometricChangeAuthorizedUntil) return '生物认证已过期，请重新验证'
    biometricChangeAuthorizedUntil = 0
    return null
  }

  const commitPasswordChange = async newPassword => {
    const shouldRefreshBiometric = biometricCredentialReady.value
    await saveVerifier(newPassword)
    savedMasterPwd.value = newPassword
    legacyPassword = ''
    isLegacyPasswordPending.value = false
    await preferenceStorage.remove({ key: STORAGE_KEYS.legacyMasterPassword }).catch(() => {})
    const biometricReady = shouldRefreshBiometric
      ? await provisionBiometricCredential(newPassword)
      : false
    return { biometricReady, biometricAttempted: shouldRefreshBiometric }
  }

  const enableBiometricUnlock = async () => {
    if (!savedMasterPwd.value || !needsBiometricSetup.value) return false
    return provisionBiometricCredential(savedMasterPwd.value)
  }

  const lockApp = () => {
    isLocked.value = true
    savedMasterPwd.value = ''
    biometricChangeAuthorizedUntil = 0
  }

  return {
    isLocked,
    hasMasterPassword,
    savedMasterPwd,
    hasBiometric,
    biometricCredentialReady,
    canUnlockWithBiometric,
    needsBiometricSetup,
    isLegacyPasswordPending,
    isDataLoaded,
    loadError,
    loadAuthData,
    refreshBiometricAvailability,
    enableBiometricUnlock,
    unlockWithPassword,
    unlockWithBiometric,
    finalizeLegacyMigration,
    setMasterPassword,
    validatePasswordChange,
    authorizeBiometricPasswordChange,
    validateBiometricPasswordChange,
    commitPasswordChange,
    lockApp
  }
})
