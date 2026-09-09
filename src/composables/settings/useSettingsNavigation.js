import { Capacitor } from '@capacitor/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert } from '../../services/uiFeedback'
import { registerBackHandler } from '../../services/backNavigation'
import { THEME_PRESETS } from '../../services/themeSystem'

export function useSettingsNavigation() {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  const settingsScope = computed(() => settingsStore.settingsScope || 'general')
  const settingsSection = computed(() => settingsStore.settingsSection || '')
  const isGeneralSection = section => settingsScope.value === 'general' && settingsSection.value === section
  const showGeneralSettingsHome = computed(() => settingsScope.value === 'general' && !settingsSection.value)
  const scopeMeta = computed(() => ({
    debts: { icon: '◎', title: '省钱计划设置', description: '管理目标回顾提醒与 AI 个性化鼓励。' },
    weight: { icon: '◇', title: '体重记录设置', description: '管理健康参数、变化提醒与每日记录提醒。' },
    mood: { icon: '♡', title: '心情日记设置', description: '管理心情等级、自定义标签与每日关怀提醒。' },
    schedule: { icon: '□', title: '日程提醒设置', description: '管理日程标签、颜色和分类规则。' },
    passwords: { icon: '⌑', title: '密码库设置', description: '管理密码分类；主密码仍在通用配置中管理。' },
    chat: { icon: '⌂', title: '温馨小家设置', description: '管理女朋友名字、记忆和聊天数据。' }
  })[settingsScope.value] || null)

  const autoLockPickerOpen = ref(false)
  const backupTypeOptions = [
    { value: 'full', label: '完整数据（全部数据与设置）' },
    { value: 'savings', label: '省钱数据' },
    { value: 'weight', label: '体重数据' },
    { value: 'mood', label: '心情数据' },
    { value: 'passwords', label: '密码库数据' },
    { value: 'schedules', label: '日程数据' },
    { value: 'chat', label: '温馨小家数据' }
  ]
  const autoLockOptions = [
    { value: 0, label: '立即锁定' },
    { value: 60, label: '1 分钟后' },
    { value: 300, label: '5 分钟后' },
    { value: 600, label: '10 分钟后' },
    { value: -1, label: '关闭自动锁定' }
  ]
  const autoLockLabel = computed(() =>
    autoLockOptions.find(option => option.value === settingsStore.autoLockDelaySeconds)?.label || '立即锁定'
  )
  const enabledReminderCount = computed(() => ['mood', 'weight', 'savings']
    .filter(key => settingsStore.notificationSettings[key]?.enabled).length)
  const generalSettingsCategories = computed(() => [
    {
      id: 'appearance', icon: '✦', title: '外观与首页',
      description: settingsStore.themeSettings.mode === 'preset'
        ? `${THEME_PRESETS[settingsStore.themeSettings.presetId]?.name || '云朵蓝'}主题`
        : '自定义主题色'
    },
    {
      id: 'notifications', icon: '◷', title: '通知与提醒',
      description: enabledReminderCount.value ? `已开启 ${enabledReminderCount.value} 项每日提醒` : '当前未开启每日提醒'
    },
    { id: 'security', icon: '⌑', title: '安全与解锁', description: `后台后${autoLockLabel.value}` },
    {
      id: 'labels', icon: '◇', title: '内容标签',
      description: `${scheduleStore.categories.length} 个日程标签 · ${vaultStore.categories.length} 个密码分类`
    },
    {
      id: 'health', icon: '♡', title: '健康与趋势',
      description: settingsStore.targetWeight ? `目标体重 ${settingsStore.targetWeight} kg` : '设置身高、目标体重与变化提醒'
    },
    { id: 'data', icon: '⇅', title: '数据与备份', description: '加密导入、导出与完整恢复' },
    {
      id: 'ai', icon: '◎', title: 'AI 服务',
      description: settingsStore.aiApiKey?.trim() ? `已配置 ${settingsStore.aiModel || '模型'}` : '尚未配置 API Key'
    },
    { id: 'widgets', icon: '▦', title: '桌面小组件', description: '今日信息与临近日程组件' }
  ])
  const openGeneralSettingsCategory = section => settingsStore.openGeneralSettingsSection(section)

  const requestWidgetPin = type => {
    if (!Capacitor.isNativePlatform()) return appAlert('桌面小组件仅在 Android 手机上可用')
    const suffix = type === 'schedule' ? '?type=schedule' : ''
    window.location.href = `formyself://widget/add${suffix}`
  }

  return {
    Capacitor,
    onBeforeUnmount,
    appAlert,
    registerBackHandler,
    THEME_PRESETS,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    settingsScope,
    settingsSection,
    isGeneralSection,
    showGeneralSettingsHome,
    scopeMeta,
    autoLockPickerOpen,
    backupTypeOptions,
    autoLockOptions,
    autoLockLabel,
    enabledReminderCount,
    generalSettingsCategories,
    openGeneralSettingsCategory,
    requestWidgetPin
  }
}
