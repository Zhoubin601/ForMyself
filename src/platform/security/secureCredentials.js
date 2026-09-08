import { Capacitor } from '@capacitor/core'
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
      const credentials = await biometric.getSecureCredentials({
        server: MASTER_PASSWORD_CREDENTIAL,
        title: options.title || '解锁 ForMyself',
        reason: options.reason || '验证生物信息以解锁私人空间',
        negativeButtonText: '取消'
      })
      if (credentials?.username !== USERNAME || !credentials.password) {
        throw new Error('INVALID_MASTER_PASSWORD_CREDENTIAL')
      }
      return credentials.password
    },
    hasMasterPassword: () => isSaved(MASTER_PASSWORD_CREDENTIAL),
    async storeApiKey(apiKey) {
      nativeOnly()
      if (!apiKey) {
        await biometric.setCredentials({
          username: USERNAME,
          password: '',
          server: API_KEY_CREDENTIAL,
          accessControl: AccessControl.NONE
        })
        return
      }
      await biometric.setCredentials({
        username: USERNAME,
        password: apiKey,
        server: API_KEY_CREDENTIAL,
        accessControl: AccessControl.NONE
      })
    },
    async getApiKey() {
      nativeOnly()
      if (!await isSaved(API_KEY_CREDENTIAL)) return ''
      const credentials = await biometric.getCredentials({ server: API_KEY_CREDENTIAL })
      return credentials?.username === USERNAME ? String(credentials.password || '') : ''
    },
    hasApiKey: () => isSaved(API_KEY_CREDENTIAL)
  }
}

export const secureCredentials = createSecureCredentials()
