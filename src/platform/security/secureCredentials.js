import { Capacitor } from '@capacitor/core'
import { withNativeActivityGuard } from '../../services/nativeActivityGuard.js'
import {
  AccessControl,
  NativeBiometric
} from '@capgo/capacitor-native-biometric'

export const MASTER_PASSWORD_CREDENTIAL = 'com.yubin.formyself.master-password.v1'
export const API_KEY_CREDENTIAL = 'com.yubin.formyself.ai-api-key.v1'
const USERNAME = 'formyself'

export function createSecureCredentials({
  biometric = NativeBiometric,
  isNative = () => Capacitor.isNativePlatform()
} = {}) {
  const nativeOnly = () => {
    if (!isNative()) throw new Error('SECURE_CREDENTIALS_NATIVE_ONLY')
  }
  const isSaved = async server => {
    if (!isNative()) return false
    try {
      return Boolean((await biometric.isCredentialsSaved({ server })).isSaved)
    } catch {
      return false
    }
  }

  return {
    isNative,
    async storeMasterPassword(password) {
      nativeOnly()
      await biometric.setCredentials({
        username: USERNAME,
        password,
        server: MASTER_PASSWORD_CREDENTIAL,
        accessControl: AccessControl.BIOMETRY_CURRENT_SET
      })
    },
    async getMasterPassword(options = {}) {
      nativeOnly()
      const credentials = await withNativeActivityGuard(() => biometric.getSecureCredentials({
        server: MASTER_PASSWORD_CREDENTIAL,
        title: options.title || '解锁 ForMyself',
        reason: options.reason || '验证生物信息以解锁私人空间',
        negativeButtonText: '取消'
      }))
      if (credentials?.username !== USERNAME || !credentials.password) {
        throw new Error('INVALID_MASTER_PASSWORD_CREDENTIAL')
      }
      return credentials.password
    },
    hasMasterPassword: () => isSaved(MASTER_PASSWORD_CREDENTIAL),
    async storeApiKey(apiKey) {
      nativeOnly()
      const value = String(apiKey || '')
      await biometric.setCredentials({
        username: USERNAME,
        password: value,
        server: API_KEY_CREDENTIAL,
        accessControl: AccessControl.NONE
      })
      const stored = await biometric.getCredentials({ server: API_KEY_CREDENTIAL })
      if (stored?.username !== USERNAME || stored.password !== value) {
        throw new Error('API_KEY_WRITE_VERIFICATION_FAILED')
      }
    },
    async getApiKey() {
      nativeOnly()
      // A failed existence check is a read failure, not an absent credential.
      if (!(await biometric.isCredentialsSaved({ server: API_KEY_CREDENTIAL })).isSaved) return ''
      const credentials = await biometric.getCredentials({ server: API_KEY_CREDENTIAL })
      if (credentials?.username !== USERNAME || typeof credentials.password !== 'string') {
        throw new Error('INVALID_API_KEY_CREDENTIAL')
      }
      return credentials.password
    },
    hasApiKey: () => isSaved(API_KEY_CREDENTIAL)
  }
}

export const secureCredentials = createSecureCredentials()
