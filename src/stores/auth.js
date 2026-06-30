import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Preferences } from '@capacitor/preferences'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'

export const useAuthStore = defineStore('auth', () => {
  const isLocked = ref(true)
  const hasMasterPassword = ref(false)
  const savedMasterPwd = ref('')
  const hasBiometric = ref(false)
  const isDataLoaded = ref(false)

  const loadAuthData = async () => {
    try {
      const pwdRes = await Preferences.get({ key: 'my_master_password' })
      if (pwdRes.value) {
        savedMasterPwd.value = pwdRes.value
        hasMasterPassword.value = true
      }

      try {
        const biometricAuth = await NativeBiometric.isAvailable()
        hasBiometric.value = biometricAuth.isAvailable
      } catch (e) {
        console.warn('不支持生物识别')
      }
    } catch (e) {
      console.error('读取授权数据失败', e)
    } finally {
      isDataLoaded.value = true
    }
  }

  const unlockWithPassword = (inputPwd) => {
    if (inputPwd === savedMasterPwd.value) {
      isLocked.value = false
      return true
    }
    return false
  }

  const unlockWithBiometric = async () => {
    try {
      await NativeBiometric.verifyIdentity({
        reason: '验证指纹以解锁空间',
        title: '指纹解锁'
      })
      isLocked.value = false
      return true
    } catch (error) {
      console.log('指纹验证取消')
      return false
    }
  }

  const setMasterPassword = async (newPwd) => {
    if (newPwd.length < 4) return false
    await Preferences.set({ key: 'my_master_password', value: newPwd })
    savedMasterPwd.value = newPwd
    hasMasterPassword.value = true
    isLocked.value = false
    return true
  }

  const updatePassword = async (oldPwd, newPwd, confirmNewPwd) => {
    if (oldPwd && oldPwd !== savedMasterPwd.value) return '原密码错误'
    if (newPwd.length < 4) return '新密码至少为 4 位'
    if (newPwd !== confirmNewPwd) return '两次输入的密码不一致'
    await Preferences.set({ key: 'my_master_password', value: newPwd })
    savedMasterPwd.value = newPwd
    return null // null = success
  }

  const lockApp = () => {
    isLocked.value = true
  }

  return {
    isLocked,
    hasMasterPassword,
    savedMasterPwd,
    hasBiometric,
    isDataLoaded,
    loadAuthData,
    unlockWithPassword,
    unlockWithBiometric,
    setMasterPassword,
    updatePassword,
    lockApp
  }
})
