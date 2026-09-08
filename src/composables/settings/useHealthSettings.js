import { ref, watch } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appToast } from '../../services/uiFeedback'

export function useHealthSettings({ settingsScope, isGeneralSection }) {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  const moduleHealthForm = ref({
    heightCm: settingsStore.heightCm ?? '',
    targetWeight: settingsStore.targetWeight ?? '',
    weightChangeReminderEnabled: settingsStore.weightChangeReminderEnabled,
    weightChangeThreshold: settingsStore.weightChangeThreshold
  })

  watch(() => [
    settingsStore.heightCm,
    settingsStore.targetWeight,
    settingsStore.weightChangeReminderEnabled,
    settingsStore.weightChangeThreshold,
    settingsScope.value
  ], () => {
    if (settingsScope.value !== 'weight' && !isGeneralSection('health')) return
    moduleHealthForm.value = {
      heightCm: settingsStore.heightCm ?? '',
      targetWeight: settingsStore.targetWeight ?? '',
      weightChangeReminderEnabled: settingsStore.weightChangeReminderEnabled,
      weightChangeThreshold: settingsStore.weightChangeThreshold
    }
  }, { immediate: true })

  const saveModuleHealthSettings = () => {
    const raw = moduleHealthForm.value
    const height = Number(raw.heightCm)
    const target = Number(raw.targetWeight)
    const threshold = Number(raw.weightChangeThreshold)
    if (raw.heightCm !== '' && (!Number.isFinite(height) || height < 80 || height > 250)) return appAlert('身高请输入 80—250 cm')
    if (raw.targetWeight !== '' && (!Number.isFinite(target) || target < 20 || target > 300)) return appAlert('目标体重请输入 20—300 kg')
    if (raw.weightChangeReminderEnabled && (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 20)) return appAlert('变化提醒阈值请输入 0.1—20 kg')
    settingsStore.updateHealthSettings(raw)
    appToast('体重记录设置已保存', { tone: 'success' })
  }

  return {
    appAlert,
    appToast,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    moduleHealthForm,
    saveModuleHealthSettings
  }
}
