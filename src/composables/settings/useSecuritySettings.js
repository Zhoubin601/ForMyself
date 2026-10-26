import { onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings.js'
import { useProtectedAccessStore } from '../../stores/protectedAccess.js'
import { appAlert, appToast } from '../../services/uiFeedback'
import { changeMasterPasswordTransaction } from '../../services/masterPasswordChange.js'

export function useSecuritySettings() {

  const authStore = useAuthStore()
  const settingsStore = useSettingsStore()
  const protectedAccess = useProtectedAccessStore()
  const isUpdatingEntryVerification = ref(false)
  const updateEntryVerification = async event => {
    const requested = event.target.checked
    event.target.checked = settingsStore.requireAppUnlock
    if (isUpdatingEntryVerification.value) return
    isUpdatingEntryVerification.value = true
    try {
      if (!requested && !await protectedAccess.authenticate({ force: true })) return
      await settingsStore.updateRequireAppUnlock(requested)
      appToast(requested ? '已开启进入应用验证' : '已关闭进入应用验证，密码库与聊天仍需验证')
    } catch {
      void appAlert('安全设置保存失败，已保留原设置。')
    } finally {
      event.target.checked = settingsStore.requireAppUnlock
      isUpdatingEntryVerification.value = false
    }
  }

  const isChangingPwd = ref(false)
  const isChangingPwdBio = ref(false)

  const oldPwdInput = ref('')
  const newPwdInput = ref('')
  const confirmNewPwdInput = ref('')

  // --- 安全 ---
  const passwordChangeBusy = ref(false)
  const applyPasswordChange = async () => {
    if (passwordChangeBusy.value) return false
    passwordChangeBusy.value = true
    const requestedPassword = newPwdInput.value
    try {
      return await protectedAccess.runOperation(protectedAccess.moduleIds, async (currentPassword, session) => {
        const result = await changeMasterPasswordTransaction({
          currentPassword,
          newPassword: requestedPassword,
          reencryptors: await protectedAccess.reencryptors(),
          commit: password => authStore.commitPasswordChange(password, session)
        })
        if (result.biometricAttempted && !result.biometricReady) {
          appToast('主密码已更新；生物快捷解锁未启用，请下次用主密码解锁', { duration: 3600 })
        } else {
          appToast('主密码已重设', { tone: 'success' })
        }
        return true
      })
    } catch (error) {
      const suffix = error.rollbackFailed ? '，且部分数据回滚失败，请立即保留现有应用数据并联系维护者' : ''
      appAlert(`主密码修改失败${suffix}`)
      return false
    } finally {
      passwordChangeBusy.value = false
    }
  }

  const clearPasswordInputs = () => {
    oldPwdInput.value = ''; newPwdInput.value = ''; confirmNewPwdInput.value = ''
    isChangingPwd.value = false; isChangingPwdBio.value = false
  }
  watch(() => authStore.sessionRevision, clearPasswordInputs, { flush: 'sync' })
  onBeforeUnmount(clearPasswordInputs)

  const changeMasterPassword = async () => {
    if (passwordChangeBusy.value) return
    if (!await authStore.unlockWithPassword(oldPwdInput.value, { unlockApp: false })) return appAlert('原密码错误')
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
    if (!await protectedAccess.authenticate()) return
    if (await authStore.enableBiometricUnlock()) {
      appToast('指纹快捷解锁已启用', { tone: 'success' })
    } else {
      appAlert('未能启用指纹快捷解锁，请确认系统已录入指纹')
    }
  }

  return {
    authStore,
    settingsStore,
    isUpdatingEntryVerification,
    updateEntryVerification,
    isChangingPwd,
    isChangingPwdBio,
    oldPwdInput,
    newPwdInput,
    confirmNewPwdInput,
    passwordChangeBusy,
    changeMasterPassword,
    triggerBioChangePwd,
    changeMasterPasswordBio,
    enableBiometricUnlock,
    lockApp
  }
}
