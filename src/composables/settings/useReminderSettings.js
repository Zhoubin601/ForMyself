import { computed, onMounted, ref } from 'vue'
import { askAI } from '../../services/aiEngine'
import { getReminderNotificationStatus, requestExactReminderPermission, sendReminderSetupConfirmation, sendReminderTestNotification, syncReminderNotifications } from '../../services/notificationService'
import { refreshPersonalizedReminderContent } from '../../services/notificationPersonalizer'
import { getPersonalizedReminderBodies } from '../../services/reminderSchedule'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'

export function useReminderSettings() {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  // --- AI BYOK 配置测试 ---
  const isTestingAI = ref(false)
  const isSavingReminders = ref(false)
  const isTestingNotification = ref(false)
  const isRequestingExactAlarm = ref(false)
  const reminderStatus = ref({ permission: 'unknown', pending: [], exactAlarm: 'unknown' })
  const reminderFeedback = ref('')

  const reminderStatusText = computed(() => {
    if (reminderStatus.value.permission === 'denied') return '通知权限已被拒绝，请到系统设置中开启。'
    if (reminderStatus.value.permission !== 'granted') return '尚未取得通知权限。'
    const count = reminderStatus.value.pending.length
    if (!count) return '通知权限正常，当前没有已排入系统的每日提醒。'
    const delayHint = reminderStatus.value.exactAlarm === 'denied'
      ? '；“准时提醒”权限未开启，Android 可能延迟数分钟到一小时'
      : ''
    return `通知权限正常，系统已保留 ${count} 项每日提醒${delayHint}。`
  })

  const refreshReminderStatus = async () => {
    try {
      reminderStatus.value = await getReminderNotificationStatus()
    } catch (error) {
      reminderStatus.value = { permission: 'unknown', pending: [], exactAlarm: 'unknown' }
      reminderFeedback.value = `无法读取系统通知状态：${error.message}`
    }
  }

  onMounted(refreshReminderStatus)

  const enableExactReminders = async () => {
    isRequestingExactAlarm.value = true
    reminderFeedback.value = ''
    try {
      const permission = await requestExactReminderPermission()
      if (permission.exactAlarm !== 'granted') {
        reminderFeedback.value = '准时提醒权限尚未开启；提醒仍会保留，但 Android 可能延迟投递。'
        return false
      }
      await syncReminderNotifications(settingsStore.notificationSettings, {
        personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
      })
      reminderFeedback.value = '准时提醒权限已开启，所有每日提醒已按当前时间重新安排。'
      return true
    } catch (error) {
      reminderFeedback.value = `准时提醒权限设置失败：${error.message}`
      return false
    } finally {
      await refreshReminderStatus()
      isRequestingExactAlarm.value = false
    }
  }

  const saveReminderSettings = async () => {
    isSavingReminders.value = true
    reminderFeedback.value = ''
    try {
      const personalization = await refreshPersonalizedReminderContent({
        settings: settingsStore.notificationSettings,
        cache: settingsStore.notificationAiContent,
        data: {
          moodRecords: moodStore.moodRecords,
          moodDefinitions: moodStore.moodDefinitions,
          weightRecords: weightStore.weightRecords,
          savedDebts: debtStore.savedDebts
        },
        hasApiKey: !!settingsStore.aiApiKey?.trim()
      })
      settingsStore.notificationAiContent = personalization.cache

      const result = await syncReminderNotifications(settingsStore.notificationSettings, {
        requestPermission: true,
        personalizedBodies: personalization.bodies
      })
      if (result.scheduled > 0) {
        await sendReminderSetupConfirmation(settingsStore.notificationSettings)
      }
      await refreshReminderStatus()
      if (result.scheduled > 0 && reminderStatus.value.exactAlarm === 'denied') {
        const shouldEnableExactAlarm = await appConfirm(
          '每日提醒已保存，但 Android 尚未允许 ForMyself 使用准时闹钟，到点通知可能延迟数分钟到一小时。',
          { title: '开启准时提醒？', confirmText: '前往系统设置' }
        )
        if (shouldEnableExactAlarm) await enableExactReminders()
      }

      if (result.scheduled === 0) appToast('所有通知提醒已关闭')
      else if (personalization.errors.length) {
        appAlert(`已安排 ${result.scheduled} 项每日提醒。部分 AI 文案生成失败，已使用默认关怀文案；请检查 API Key 和网络。`)
      } else if (personalization.generated > 0) {
        appToast(`已安排 ${result.scheduled} 项提醒，生成 ${personalization.generated} 条 AI 文案`, { tone: 'success', duration: 3200 })
      } else {
        appToast(`已保存并安排 ${result.scheduled} 项每日提醒`, { tone: 'success' })
      }
    } catch (error) {
      if (error.code === 'NOTIFICATION_PERMISSION_DENIED') {
        appAlert('通知权限未开启，请在系统设置中允许 ForMyself 发送通知')
      } else {
        appAlert('通知提醒设置失败：' + error.message)
      }
      await refreshReminderStatus()
    } finally {
      isSavingReminders.value = false
    }
  }

  const testNotification = async () => {
    isTestingNotification.value = true
    reminderFeedback.value = ''
    try {
      await sendReminderTestNotification({ requestPermission: true })
      reminderFeedback.value = '测试通知已发送，请下拉通知栏确认“ForMyself 通知测试”。'
      await refreshReminderStatus()
    } catch (error) {
      reminderFeedback.value = error.code === 'NOTIFICATION_PERMISSION_DENIED'
        ? '测试失败：通知权限未开启，请到系统设置中允许通知。'
        : `测试通知发送失败：${error.message}`
    } finally {
      isTestingNotification.value = false
    }
  }
  const testAIConnection = async () => {
    if (!settingsStore.aiApiKey) return appAlert('请先填写 API Key')
    isTestingAI.value = true
    try {
      const res = await askAI('请回复"连接成功！"这四个字，不要其他内容。')
      appAlert(res, { title: 'AI 握手成功', tone: 'success' })
    } catch (e) {
      appAlert('连接失败：' + e.message)
    } finally {
      isTestingAI.value = false
    }
  }

  return {
    askAI,
    getReminderNotificationStatus,
    requestExactReminderPermission,
    sendReminderSetupConfirmation,
    sendReminderTestNotification,
    syncReminderNotifications,
    refreshPersonalizedReminderContent,
    getPersonalizedReminderBodies,
    appAlert,
    appConfirm,
    appToast,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    isTestingAI,
    isSavingReminders,
    isTestingNotification,
    isRequestingExactAlarm,
    reminderStatus,
    reminderFeedback,
    reminderStatusText,
    refreshReminderStatus,
    enableExactReminders,
    saveReminderSettings,
    testNotification,
    testAIConnection
  }
}
