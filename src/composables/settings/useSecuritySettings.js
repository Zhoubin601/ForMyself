import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appToast } from '../../services/uiFeedback'
import { changeMasterPasswordTransaction } from '../../services/masterPasswordChange.js'

export function useSecuritySettings() {

  const authStore = useAuthStore()
  const vaultStore = usePasswordVaultStore()
  const chatStore = useChatStore()

  const isChangingPwd = ref(false)
  const isChangingPwdBio = ref(false)

  const oldPwdInput = ref('')
  const newPwdInput = ref('')
  const confirmNewPwdInput = ref('')

  // --- 安全 ---
  const applyPasswordChange = async () => {
    const currentPassword = authStore.savedMasterPwd
    try {
      const result = await changeMasterPasswordTransaction({
        currentPassword,
        newPassword: newPwdInput.value,
        reencryptors: [vaultStore.reencrypt, chatStore.reencrypt],
        commit: authStore.commitPasswordChange
      })
      if (result.biometricAttempted && !result.biometricReady) {
        appToast('主密码已更新；生物快捷解锁未启用，请下次用主密码解锁', { duration: 3600 })
      } else {
        appToast('主密码已重设', { tone: 'success' })
      }
      return true
    } catch (error) {
      const suffix = error.rollbackFailed ? '，且部分数据回滚失败，请立即保留现有应用数据并联系维护者' : ''
      appAlert(`主密码修改失败${suffix}`)
      return false
    }
  }

  const changeMasterPassword = async () => {
    const err = await authStore.validatePasswordChange(oldPwdInput.value, newPwdInput.value, confirmNewPwdInput.value)
    if (err) return appAlert(err)
    if (!await applyPasswordChange()) return
    oldPwdInput.value = ''; newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwd.value = false
  }

  const triggerBioChangePwd = async () => {
    if (await authStore.authorizeBiometricPasswordChange()) {
      isChangingPwd.value = false; isChangingPwdBio.value = true; newPwdInput.value = ''; confirmNewPwdInput.value = ''
    } else {
      appAlert('身份验证已取消或安全凭据已失效')
    }
  }

  const changeMasterPasswordBio = async () => {
    const err = authStore.validateBiometricPasswordChange(newPwdInput.value, confirmNewPwdInput.value)
    if (err) return appAlert(err)
    if (!await applyPasswordChange()) return
    newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwdBio.value = false
  }


  const lockApp = () => { authStore.lockApp() }

  const enableBiometricUnlock = async () => {
    if (await authStore.enableBiometricUnlock()) {
      appToast('指纹快捷解锁已启用', { tone: 'success' })
    } else {
      appAlert('未能启用指纹快捷解锁，请确认系统已录入指纹')
    }
  }

  return {
    authStore,
    isChangingPwd,
    isChangingPwdBio,
    oldPwdInput,
    newPwdInput,
    confirmNewPwdInput,
    changeMasterPassword,
    triggerBioChangePwd,
    changeMasterPasswordBio,
    enableBiometricUnlock,
    lockApp
  }
}
