<script setup>
import { Capacitor } from '@capacitor/core'
import { computed, onMounted, ref, watch } from 'vue'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import CryptoJS from 'crypto-js'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { askAI } from '../services/aiEngine'
import {
  getReminderNotificationStatus,
  requestExactReminderPermission,
  sendReminderSetupConfirmation,
  sendReminderTestNotification,
  syncReminderNotifications
} from '../services/notificationService'
import { refreshPersonalizedReminderContent } from '../services/notificationPersonalizer'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule'
import {
  buildFullBackupSnapshot,
  getFullBackupCounts,
  normalizeFullBackupSnapshot
} from '../services/fullBackup'

import { useAuthStore } from '../stores/auth'
import { useDebtStore } from '../stores/debt'
import { useWeightStore } from '../stores/weight'
import { useMoodStore } from '../stores/mood'
import { useSettingsStore } from '../stores/settings'
import { usePasswordVaultStore } from '../stores/passwordVault'
import { useScheduleStore } from '../stores/schedule'
import { syncScheduleNotifications } from '../services/scheduleNotificationService'
import { normalizeScheduleData } from '../services/scheduleCore'
import { appAlert, appConfirm, appToast } from '../services/uiFeedback'
import AppTimeField from './AppTimeField.vue'

const authStore = useAuthStore()
const debtStore = useDebtStore()
const weightStore = useWeightStore()
const moodStore = useMoodStore()
const settingsStore = useSettingsStore()
const vaultStore = usePasswordVaultStore()
const scheduleStore = useScheduleStore()
const settingsScope = computed(() => settingsStore.settingsScope || 'general')
const scopeMeta = computed(() => ({
  debts: { icon: '◎', title: '省钱计划设置', description: '管理省钱看板文案、目标回顾提醒与个性化鼓励。' },
  weight: { icon: '◇', title: '体重记录设置', description: '管理健康参数、变化提醒与每日记录提醒。' },
  mood: { icon: '♡', title: '心情日记设置', description: '管理自定义标签与每日关怀提醒。' },
  schedule: { icon: '□', title: '日程提醒设置', description: '管理日程标签、颜色和分类规则。' },
  passwords: { icon: '⌑', title: '密码库设置', description: '管理密码分类；主密码仍在通用配置中管理。' }
})[settingsScope.value] || null)

const isChangingPwd = ref(false)
const isChangingPwdBio = ref(false)

const oldPwdInput = ref('')
const newPwdInput = ref('')
const confirmNewPwdInput = ref('')
const fileInputRef = ref(null)
const bgInputRef = ref(null)

const exportDataType = ref('full')
const backupPickerOpen = ref(false)
const autoLockPickerOpen = ref(false)
const backupTypeOptions = [
  { value: 'full', label: '完整数据（全部数据与设置）' },
  { value: 'savings', label: '省钱数据' },
  { value: 'weight', label: '体重数据' },
  { value: 'mood', label: '心情数据' },
  { value: 'passwords', label: '密码库数据' },
  { value: 'schedules', label: '日程数据' }
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
const newVaultCategory = ref('')
const newScheduleCategory = ref('')
const newScheduleCategoryColor = ref('#4fd5d7')
const moduleHealthForm = ref({
  heightCm: settingsStore.heightCm ?? '',
  targetWeight: settingsStore.targetWeight ?? '',
  weightChangeReminderEnabled: settingsStore.weightChangeReminderEnabled,
  weightChangeThreshold: settingsStore.weightChangeThreshold
})
const scheduleColorHue = ref(181)
const scheduleColorSaturation = ref(64)
const scheduleColorValue = ref(84)
const scheduleColorBoardRef = ref(null)

watch(() => [
  settingsStore.heightCm,
  settingsStore.targetWeight,
  settingsStore.weightChangeReminderEnabled,
  settingsStore.weightChangeThreshold,
  settingsScope.value
], () => {
  if (settingsScope.value !== 'weight') return
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

const clampColorValue = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number(value) || 0))

const hsvToHex = (hue, saturation, value) => {
  const h = ((Number(hue) % 360) + 360) % 360
  const s = clampColorValue(saturation) / 100
  const v = clampColorValue(value) / 100
  const chroma = v * s
  const section = h / 60
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = v - chroma
  let red = 0
  let green = 0
  let blue = 0

  if (section < 1) [red, green, blue] = [chroma, intermediate, 0]
  else if (section < 2) [red, green, blue] = [intermediate, chroma, 0]
  else if (section < 3) [red, green, blue] = [0, chroma, intermediate]
  else if (section < 4) [red, green, blue] = [0, intermediate, chroma]
  else if (section < 5) [red, green, blue] = [intermediate, 0, chroma]
  else [red, green, blue] = [chroma, 0, intermediate]

  const toHex = channel => Math.round((channel + offset) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

const hexToHsv = hex => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
  const red = parseInt(hex.slice(1, 3), 16) / 255
  const green = parseInt(hex.slice(3, 5), 16) / 255
  const blue = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }

  return {
    hue: Math.round((hue + 360) % 360),
    saturation: Math.round(max ? (delta / max) * 100 : 0),
    value: Math.round(max * 100)
  }
}

const applySchedulePickerColor = () => {
  newScheduleCategoryColor.value = hsvToHex(
    scheduleColorHue.value,
    scheduleColorSaturation.value,
    scheduleColorValue.value
  )
}

const updateScheduleColorFromBoard = event => {
  const board = scheduleColorBoardRef.value
  if (!board) return
  const rect = board.getBoundingClientRect()
  scheduleColorSaturation.value = Math.round(clampColorValue(
    ((event.clientX - rect.left) / rect.width) * 100
  ))
  scheduleColorValue.value = Math.round(clampColorValue(
    100 - ((event.clientY - rect.top) / rect.height) * 100
  ))
  if (event.type === 'pointerdown') board.setPointerCapture?.(event.pointerId)
  applySchedulePickerColor()
}

const updateScheduleColorFromHex = () => {
  const normalized = String(newScheduleCategoryColor.value || '').trim()
  const color = hexToHsv(normalized)
  if (!color) {
    applySchedulePickerColor()
    return
  }
  newScheduleCategoryColor.value = normalized.toLowerCase()
  scheduleColorHue.value = color.hue
  scheduleColorSaturation.value = color.saturation
  scheduleColorValue.value = color.value
}

const scheduleColorBoardStyle = computed(() => ({
  background: [
    'linear-gradient(to top, #000, transparent)',
    `linear-gradient(to right, #fff, hsl(${scheduleColorHue.value} 100% 50%))`
  ].join(', ')
}))

const scheduleColorCursorStyle = computed(() => ({
  left: `${scheduleColorSaturation.value}%`,
  top: `${100 - scheduleColorValue.value}%`,
  background: newScheduleCategoryColor.value
}))

// --- 看板设置 ---
const localBanner = ref({ ...settingsStore.bannerSettings })

watch(() => settingsStore.bannerSettings, (newVal) => {
  if (newVal) localBanner.value = { ...newVal }
}, { deep: true, immediate: true })

const saveBannerSettings = () => {
  settingsStore.updateBanner({ ...localBanner.value })
  appToast('看板配置已保存生效', { tone: 'success' })
}

const deleteMoodTag = async (tag) => {
  if (!await appConfirm(`“${tag}”也会从历史心情记录中移除。`, {
    title: '删除心情标签？',
    destructive: true
  })) return
  if (moodStore.removeCustomTag(tag)) appToast(`已删除心情标签“${tag}”`, { tone: 'success' })
}

const addVaultCategory = () => {
  const result = vaultStore.addCategory(newVaultCategory.value)
  if (!result.ok) {
    if (result.reason === 'EMPTY') return appAlert('请输入分类名称')
    if (result.reason === 'EXISTS') return appAlert('该分类已经存在')
    return
  }
  newVaultCategory.value = ''
  appToast(`已添加密码分类“${result.category}”`, { tone: 'success' })
}

const vaultCategoryUsageCount = category => vaultStore.records.filter(record => record.category === category).length

const deleteVaultCategory = async (category) => {
  const usageCount = vaultCategoryUsageCount(category)
  if (usageCount > 0) return appAlert(`分类“${category}”仍有 ${usageCount} 条密码记录，不能删除`)
  if (!await appConfirm(`将移除密码分类“${category}”。`, {
    title: '删除密码分类？',
    destructive: true
  })) return
  const result = vaultStore.deleteCategory(category)
  if (!result.ok) {
    if (result.reason === 'PROTECTED') appAlert('“未分类”是系统兜底分类，不能删除')
    else if (result.reason === 'IN_USE') appAlert(`分类“${category}”仍有密码记录，不能删除`)
  }
}

const addScheduleCategory = () => {
  const category = scheduleStore.addCategory({
    name: newScheduleCategory.value,
    color: newScheduleCategoryColor.value
  })
  if (!category) return appAlert(newScheduleCategory.value.trim() ? '该日程标签已经存在' : '请输入日程标签名称')
  newScheduleCategory.value = ''
}

const deleteScheduleCategory = async category => {
  if (category.builtIn) return
  const usageCount = scheduleStore.categoryUsageCount(category.id)
  if (usageCount > 0) {
    return appAlert(`标签“${category.name}”仍有 ${usageCount} 条日程内容，不能删除`)
  }
  if (!await appConfirm(`将移除日程标签“${category.name}”。`, {
    title: '删除日程标签？',
    destructive: true
  })) return
  const result = scheduleStore.deleteCategory(category.id)
  if (!result.ok) {
    if (result.reason === 'PROTECTED') appAlert('“学习”是系统保留标签，不能删除')
    else if (result.reason === 'IN_USE') appAlert(`标签“${category.name}”仍有日程内容，不能删除`)
  }
}

// --- 安全 ---
const changeMasterPassword = async () => {
  const err = await authStore.updatePassword(oldPwdInput.value, newPwdInput.value, confirmNewPwdInput.value)
  if (err) return appAlert(err)
  await vaultStore.reencrypt(newPwdInput.value)
  oldPwdInput.value = ''; newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwd.value = false
  appToast('主密码已重设', { tone: 'success' })
}

const triggerBioChangePwd = async () => {
  try {
    await NativeBiometric.verifyIdentity({ reason: '验证指纹以重设主密码', title: '安全认证' })
    isChangingPwd.value = false; isChangingPwdBio.value = true; newPwdInput.value = ''; confirmNewPwdInput.value = ''
  } catch (err) { appAlert('身份验证已取消') }
}

const changeMasterPasswordBio = async () => {
  const err = await authStore.updatePassword(null, newPwdInput.value, confirmNewPwdInput.value)
  if (err) return appAlert(err)
  await vaultStore.reencrypt(newPwdInput.value)
  newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwdBio.value = false
  appToast('主密码已重设', { tone: 'success' })
}

// --- 数据导出/导入 ---
const getDataTypeLabel = () => {
  return backupTypeOptions.find(item => item.value === exportDataType.value)?.label.replace('数据（全部数据与设置）', '数据') || '数据'
}

const getDataArray = () => {
  if (exportDataType.value === 'savings') return debtStore.savedDebts
  if (exportDataType.value === 'weight') return weightStore.weightRecords
  if (exportDataType.value === 'passwords') return vaultStore.records
  if (exportDataType.value === 'schedules') return scheduleStore.snapshot
  return moodStore.moodRecords
}

const setDataArray = async (data, overwrite) => {
  if (exportDataType.value === 'savings') {
    debtStore.updateDebts(overwrite ? data : [...debtStore.savedDebts, ...data])
  } else if (exportDataType.value === 'weight') {
    weightStore.updateWeightRecords(overwrite ? data : [...weightStore.weightRecords, ...data])
  } else if (exportDataType.value === 'passwords') {
    if (overwrite) vaultStore.replaceRecords(data)
    else vaultStore.appendRecords(data)
  } else if (exportDataType.value === 'schedules') {
    const imported = normalizeScheduleData(data)
    const merged = overwrite ? imported : normalizeScheduleData({
      series: [...scheduleStore.series, ...imported.series],
      occurrences: [...scheduleStore.occurrences, ...imported.occurrences],
      categories: [...scheduleStore.categories, ...imported.categories]
    })
    await scheduleStore.restoreScheduleData(merged)
  } else {
    moodStore.updateMoodRecords(overwrite ? data : [...moodStore.moodRecords, ...data])
  }
}

const getFilePrefix = () => {
  return { full: 'Full', savings: 'Savings', weight: 'Weight', mood: 'Mood', passwords: 'Passwords', schedules: 'Schedules' }[exportDataType.value]
}

const createFullBackupSnapshot = () => buildFullBackupSnapshot({
  savings: debtStore.savedDebts,
  weight: weightStore.weightRecords,
  mood: moodStore.moodRecords,
  passwords: vaultStore.records,
  schedules: scheduleStore.snapshot,
  moodMetadata: {
    trackingStartDate: moodStore.trackingStartDate,
    customTags: moodStore.customTags
  },
  vaultMetadata: {
    categories: vaultStore.categories
  },
  settings: settingsStore.getBackupSnapshot()
})

const applyFullBackupSnapshot = async (snapshot) => {
  const results = await Promise.allSettled([
    debtStore.restoreDebts(snapshot.data.savings),
    weightStore.restoreWeightRecords(snapshot.data.weight),
    moodStore.restoreMoodBackup(snapshot.data.mood, snapshot.metadata.mood),
    vaultStore.restoreRecords(snapshot.data.passwords, snapshot.metadata.vault),
    scheduleStore.restoreScheduleData(snapshot.data.schedules),
    settingsStore.restoreBackupSnapshot(snapshot.settings)
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
}

const restoreFullBackup = async (snapshot) => {
  const previousSnapshot = createFullBackupSnapshot()
  try {
    await applyFullBackupSnapshot(snapshot)
  } catch (error) {
    try {
      await applyFullBackupSnapshot(previousSnapshot)
    } catch (rollbackError) {
      console.error('完整备份恢复失败且回滚未完全成功', rollbackError)
    }
    throw error
  }

  try {
    await syncReminderNotifications(settingsStore.notificationSettings, {
      personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
    })
    await syncScheduleNotifications(scheduleStore.snapshot)
  } catch (error) {
    console.warn('恢复完整备份后刷新通知失败', error)
  }
}

const downloadAsFile = (content, filename) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const exportJSON = async () => {
  const label = getDataTypeLabel()
  const isFullBackup = exportDataType.value === 'full'
  const data = isFullBackup ? createFullBackupSnapshot() : getDataArray()

  const isEmpty = exportDataType.value === 'schedules'
    ? !data.series.length
    : Array.isArray(data) && data.length === 0
  if (!isFullBackup && isEmpty) return appAlert(`没有检测到可导出的${label}`)

  try {
    const rawData = JSON.stringify(data)
    const encryptedData = CryptoJS.AES.encrypt(rawData, authStore.savedMasterPwd).toString()
    const date = new Date().toISOString().slice(0, 10)
    const prefix = getFilePrefix()
    const filename = `ForMyself_${prefix}_Backup_${date}.json`

    if (Capacitor.isNativePlatform()) {
      try {
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: encryptedData,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        })
        await Share.share({ title: `导出${label}加密备份`, url: writeResult.uri })
      } catch (e) {
        appAlert('导出失败：' + e.message)
      }
    } else {
      downloadAsFile(encryptedData, filename)
    }
  } catch (error) {
    appAlert('导出错误：' + error.message)
  }
}

const triggerImport = () => fileInputRef.value.click()

const handleFileUpload = (event) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const encryptedContent = e.target.result
      const bytes = CryptoJS.AES.decrypt(encryptedContent, authStore.savedMasterPwd)
      const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
      if (!decryptedData) throw new Error('密码错误')
      const importedData = JSON.parse(decryptedData)
      const label = getDataTypeLabel()

      if (exportDataType.value === 'full') {
        const snapshot = normalizeFullBackupSnapshot(importedData)
        const counts = getFullBackupCounts(snapshot)
        const confirmed = await appConfirm(
          `完整备份包含：\n省钱 ${counts.savings} 项、体重 ${counts.weight} 条、心情 ${counts.mood} 条、密码 ${counts.passwords} 项、日程 ${counts.schedules} 项。\n\n继续将覆盖以上全部数据和应用设置。主密码与设备生物识别凭据不会改变。`,
          { title: '恢复完整备份？', confirmText: '覆盖并恢复', destructive: true }
        )
        if (!confirmed) return
        await restoreFullBackup(snapshot)
        appToast('完整数据恢复成功', { tone: 'success', duration: 3200 })
        return
      }

      if (exportDataType.value === 'schedules') {
        const normalized = normalizeScheduleData(importedData)
        const overwrite = await appConfirm(
          `成功解密出 ${normalized.series.length} 条日程。\n选择“覆盖”会替换当前日程和标签；取消则执行合并。`,
          { title: '选择恢复方式', confirmText: '覆盖当前数据', cancelText: '合并数据' }
        )
        await setDataArray(normalized, overwrite)
        await syncScheduleNotifications(scheduleStore.snapshot)
        appToast('日程数据恢复成功', { tone: 'success' })
        return
      }

      if (!Array.isArray(importedData)) throw new Error('格式错误')

      if (await appConfirm(`成功解密出 ${importedData.length} 条${label}项目。\n选择“覆盖”会替换当前数据；取消则执行追加。`, {
        title: '选择恢复方式',
        confirmText: '覆盖当前数据',
        cancelText: '追加数据'
      })) {
        await setDataArray(importedData, true)
      } else {
        await setDataArray(importedData, false)
      }
      appToast(`${label}数据恢复成功`, { tone: 'success' })
    } catch (err) {
      if (exportDataType.value === 'full') {
        appAlert('完整备份恢复失败：文件损坏、版本不兼容或主密码不匹配')
      } else {
        appAlert('解密失败：主密码与当前备份包不匹配')
      }
    } finally {
      event.target.value = ''
    }
  }
  reader.readAsText(file)
}

const triggerBgUpload = () => bgInputRef.value.click()
const handleBgUpload = (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) return appAlert('请使用 5MB 以内的图像文件')
  const reader = new FileReader()
  reader.onload = (e) => {
    settingsStore.updateBg(e.target.result)
    appToast('背景墙纸已部署', { tone: 'success' })
  }
  reader.readAsDataURL(file)
}
const clearBg = async () => {
  if (await appConfirm('当前自定义壁纸将被移除。', { title: '恢复默认背景？' })) {
    settingsStore.updateBg('')
  }
}

const requestWidgetPin = type => {
  if (!Capacitor.isNativePlatform()) return appAlert('桌面小组件仅在 Android 手机上可用')
  const suffix = type === 'schedule' ? '?type=schedule' : ''
  window.location.href = `formyself://widget/add${suffix}`
}

const lockApp = () => { authStore.lockApp() }

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
</script>

<template>
  <div class="fade-in settings-container">

    <div v-if="scopeMeta" class="module-settings-intro">
      <span>{{ scopeMeta.icon }}</span>
      <div>
        <strong>{{ scopeMeta.title }}</strong>
        <p>{{ scopeMeta.description }}</p>
      </div>
    </div>

    <div v-if="settingsScope === 'debts'" class="setting-section">
      <h3 class="caption body-muted section-title">省钱看板文案</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <div class="input-group">
          <label class="caption">主标题前缀</label>
          <input v-model="localBanner.prefix" class="apple-input" placeholder="例如：你已经省下了" />
        </div>
        <div class="input-group">
          <label class="caption">主标题后缀</label>
          <input v-model="localBanner.suffix" class="apple-input" placeholder="例如：元" />
        </div>
        <div class="input-group">
          <label class="caption">主标题字体大小 (px)</label>
          <input type="number" v-model="localBanner.titleSize" class="apple-input" />
        </div>
        <button class="button-primary full-width" style="margin-top: 16px;" @click="saveBannerSettings">保存看板配置</button>
      </div>
    </div>

    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">界面视觉</h3>
      <div class="ios-list">
        <button class="list-item text-link" style="text-align: left;" @click="triggerBgUpload">更换环境背景图片</button>
        <input type="file" accept="image/*" ref="bgInputRef" style="display: none" @change="handleBgUpload" />
        <button v-if="settingsStore.customBg" class="list-item text-link destructive" style="text-align: left;" @click="clearBg">重置回出厂设定背景</button>
      </div>
    </div>

    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">桌面小组件</h3>
      <div class="ios-list">
        <button class="list-item text-link" style="text-align: left;" @click="requestWidgetPin('info')">
          添加 2×2 今日信息组件
        </button>
        <button class="list-item text-link" style="text-align: left;" @click="requestWidgetPin('schedule')">
          添加 2×2 临近日程组件
        </button>
      </div>
      <p class="caption body-muted" style="padding: 10px 16px 0; margin: 0;">若桌面不支持应用内添加，可长按桌面并从“小组件”列表选择 ForMyself。</p>
    </div>

    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">安全管理</h3>
      <div class="ios-list" v-if="!isChangingPwd && !isChangingPwdBio">
        <button v-if="authStore.hasBiometric" class="list-item text-link" style="text-align: left;" @click="triggerBioChangePwd">指纹生物识别修改密码</button>
        <button class="list-item text-link" style="text-align: left;" @click="isChangingPwd = true">传统密码验证修改</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="lockApp">安全锁定当前空间</button>
      </div>

      <div class="store-utility-card" style="margin-top: 12px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">进入后台后自动锁定</label>
        <button class="backup-type-button" @click="autoLockPickerOpen = true">
          <span>{{ autoLockLabel }}</span>
          <b>›</b>
        </button>
        <p class="caption body-muted" style="margin: 10px 0 0;">超过设定时间返回应用时，需要重新输入主密码或验证指纹。</p>
      </div>

      <div v-if="isChangingPwd || isChangingPwdBio" class="store-utility-card">
        <h4 class="body-strong" style="margin-top:0;">重设空间密码</h4>
        <div v-if="isChangingPwd" class="input-group"><input v-model="oldPwdInput" type="password" placeholder="原主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="newPwdInput" type="password" placeholder="新主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="confirmNewPwdInput" type="password" placeholder="确认新主密码" class="apple-input" /></div>
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button class="button-primary" style="flex:1" @click="isChangingPwdBio ? changeMasterPasswordBio() : changeMasterPassword()">保存</button>
          <button class="button-secondary-pill" style="flex:1" @click="isChangingPwd = false; isChangingPwdBio = false">放弃</button>
        </div>
      </div>
    </div>

    <div v-if="['schedule', 'mood', 'passwords'].includes(settingsScope)" class="setting-section">
      <h3 class="caption body-muted section-title">内容标签与分类</h3>

      <div v-if="settingsScope === 'schedule'" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">日程标签</h4>
        <p class="caption body-muted taxonomy-description">仅保留系统标签“学习”。输入名称并从调色盘选择颜色即可；与密码库分类一致，只有没有日程内容的标签才可删除。</p>
        <div class="taxonomy-add-row">
          <input
            v-model="newScheduleCategory"
            class="apple-input"
            maxlength="12"
            placeholder="输入日程标签名称"
            @keyup.enter="addScheduleCategory"
          />
          <button class="button-primary taxonomy-add-button" @click="addScheduleCategory">添加</button>
        </div>
        <div class="schedule-color-picker">
          <div class="schedule-color-picker-heading">
            <span class="body-strong">标签颜色</span>
            <span class="schedule-color-preview" :style="{ background: newScheduleCategoryColor }"></span>
          </div>
          <div
            ref="scheduleColorBoardRef"
            class="schedule-color-board"
            :style="scheduleColorBoardStyle"
            role="slider"
            aria-label="选择标签颜色的饱和度与亮度"
            :aria-valuetext="newScheduleCategoryColor"
            tabindex="0"
            @pointerdown="updateScheduleColorFromBoard"
            @pointermove="event => event.buttons && updateScheduleColorFromBoard(event)"
          >
            <span class="schedule-color-cursor" :style="scheduleColorCursorStyle"></span>
          </div>
          <input
            v-model.number="scheduleColorHue"
            class="schedule-hue-slider"
            :style="{ '--schedule-hue': scheduleColorHue }"
            type="range"
            min="0"
            max="359"
            aria-label="选择标签颜色的色相"
            @input="applySchedulePickerColor"
          />
          <label class="schedule-color-code">
            <span class="caption body-muted">HEX</span>
            <input
              v-model="newScheduleCategoryColor"
              class="apple-input"
              maxlength="7"
              inputmode="text"
              aria-label="标签颜色十六进制值"
              @change="updateScheduleColorFromHex"
              @blur="updateScheduleColorFromHex"
            />
          </label>
        </div>
        <div class="taxonomy-list">
          <div v-for="category in scheduleStore.categories" :key="category.id" class="taxonomy-row">
            <span class="schedule-category-name">
              <i :style="{ background: category.color }"></i>
              {{ category.name }}
            </span>
            <span class="taxonomy-row-meta">
              <span v-if="scheduleStore.categoryUsageCount(category.id)" class="caption body-muted">已使用 {{ scheduleStore.categoryUsageCount(category.id) }} 条</span>
              <span v-else-if="category.builtIn" class="caption body-muted">系统保留</span>
              <button v-else class="text-link danger-text taxonomy-action" @click="deleteScheduleCategory(category)">删除</button>
            </span>
          </div>
        </div>
      </div>

      <div v-if="settingsScope === 'mood'" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">心情日记自定义标签</h4>
        <p class="caption body-muted taxonomy-description">删除标签时会同时从历史心情记录中移除；内置标签“工作、学习、家庭、睡眠”固定保留。</p>
        <div v-if="moodStore.customTags.length" class="taxonomy-list">
          <div v-for="tag in moodStore.customTags" :key="tag" class="taxonomy-row">
            <span>{{ tag }}</span>
            <button class="text-link danger-text taxonomy-action" @click="deleteMoodTag(tag)">删除</button>
          </div>
        </div>
        <p v-else class="caption body-muted taxonomy-empty">暂无自定义心情标签</p>
      </div>

      <div v-if="settingsScope === 'passwords'" class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">密码库分类</h4>
        <p class="caption body-muted taxonomy-description">可在这里统一添加和删除分类。仍被密码记录使用的分类不能删除，“未分类”固定保留。</p>
        <div class="taxonomy-add-row">
          <input
            v-model="newVaultCategory"
            class="apple-input"
            maxlength="20"
            placeholder="输入新分类名称"
            @keyup.enter="addVaultCategory"
          />
          <button class="button-primary taxonomy-add-button" @click="addVaultCategory">添加</button>
        </div>
        <div class="taxonomy-list">
          <div v-for="category in vaultStore.categories" :key="category" class="taxonomy-row">
            <span>{{ category }}</span>
            <span class="taxonomy-row-meta">
              <span v-if="vaultCategoryUsageCount(category)" class="caption body-muted">已使用 {{ vaultCategoryUsageCount(category) }} 条</span>
              <span v-else-if="category === '未分类'" class="caption body-muted">系统保留</span>
              <button
                v-else
                class="text-link danger-text taxonomy-action"
                @click="deleteVaultCategory(category)"
              >删除</button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="settingsScope === 'weight'" class="setting-section">
      <h3 class="caption body-muted section-title">健康与趋势</h3>
      <div class="store-utility-card health-settings-card">
        <div class="health-setting-grid">
          <label class="input-group">
            <span class="caption">身高（cm）</span>
            <input v-model="moduleHealthForm.heightCm" type="number" min="80" max="250" class="apple-input" placeholder="例如 170" />
          </label>
          <label class="input-group">
            <span class="caption">目标体重（kg）</span>
            <input v-model="moduleHealthForm.targetWeight" type="number" min="20" max="300" step="0.1" class="apple-input" placeholder="例如 65" />
          </label>
        </div>
        <label class="health-reminder-toggle">
          <span>
            <strong>体重变化提醒</strong>
            <small>与上一条记录变化达到阈值时提醒</small>
          </span>
          <span class="switch-control">
            <input v-model="moduleHealthForm.weightChangeReminderEnabled" type="checkbox" />
            <i></i>
          </span>
        </label>
        <label v-if="moduleHealthForm.weightChangeReminderEnabled" class="input-group threshold-field">
          <span class="caption">变化阈值（kg）</span>
          <input v-model="moduleHealthForm.weightChangeThreshold" type="number" min="0.1" max="20" step="0.1" class="apple-input" />
        </label>
        <button class="button-primary full-width" @click="saveModuleHealthSettings">保存健康设置</button>
      </div>
    </div>

    <div v-if="['mood', 'weight', 'debts'].includes(settingsScope)" class="setting-section">
      <h3 class="caption body-muted section-title">通知提醒</h3>
      <div class="store-utility-card reminder-card">
        <div v-if="settingsScope === 'mood'" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">心情日记</span>
            <span class="caption body-muted">提醒记录当天的感受</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.mood.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.mood.enabled" />
              AI 根据最近心情与日记生成关怀文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.mood.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.mood.enabled" aria-label="选择心情提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.mood.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div v-if="settingsScope === 'weight'" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">体重记录</span>
            <span class="caption body-muted">提醒在固定时间记录体重</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.weight.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.weight.enabled" />
              AI 根据最近体重记录生成关怀文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.weight.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.weight.enabled" aria-label="选择体重提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.weight.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div v-if="settingsScope === 'debts'" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">省钱计划</span>
            <span class="caption body-muted">提醒查看目标和记录存款</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.savings.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.savings.enabled" />
              AI 根据最近省钱计划生成鼓励文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.savings.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.savings.enabled" aria-label="选择省钱提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.savings.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <button class="button-primary full-width reminder-save" :disabled="isSavingReminders" @click="saveReminderSettings">
          {{ isSavingReminders ? '正在安排提醒…' : '保存通知提醒' }}
        </button>
        <button class="button-secondary-pill full-width reminder-test" :disabled="isTestingNotification" @click="testNotification">
          {{ isTestingNotification ? '正在发送测试通知…' : '发送一条测试通知' }}
        </button>
        <button
          v-if="reminderStatus.permission === 'granted' && reminderStatus.exactAlarm === 'denied' && reminderStatus.pending.length"
          class="button-secondary-pill full-width reminder-exact"
          :disabled="isRequestingExactAlarm"
          @click="enableExactReminders"
        >
          {{ isRequestingExactAlarm ? '正在打开系统设置…' : '开启准时提醒权限' }}
        </button>
        <div class="reminder-status" :class="{ warning: reminderStatus.permission === 'denied' || reminderStatus.exactAlarm === 'denied' }">
          <strong>系统状态</strong>
          <span>{{ reminderStatusText }}</span>
          <span v-if="reminderFeedback">{{ reminderFeedback }}</span>
        </div>
        <p class="caption body-muted reminder-note">普通提醒完全在设备本地调度。划掉最近任务或重启手机后仍可提醒；但在系统设置中“强制停止”应用会让 Android 删除全部闹钟，需重新打开 ForMyself 恢复。部分品牌手机还需允许自启动和后台运行。开启 AI 后，仅对应模块的最近记录会发送给你配置的 AI 服务。</p>
      </div>
    </div>

    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">数据备份</h3>

      <div class="store-utility-card" style="margin-top: 8px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">选择要操作的数据类型</label>
        <button class="backup-type-button" @click="backupPickerOpen = true">
          <span>{{ backupTypeOptions.find(item => item.value === exportDataType)?.label }}</span>
          <b>›</b>
        </button>
      </div>

      <div class="ios-list" style="margin-top: 8px;">
        <button class="list-item text-link" style="text-align: left;" @click="exportJSON">
          导出{{ getDataTypeLabel() }}加密备份 (.json)
        </button>
        <button class="list-item text-link" style="text-align: left;" @click="triggerImport">
          导入{{ getDataTypeLabel() }}数据还原
        </button>
        <input type="file" accept=".json" ref="fileInputRef" style="display: none" @change="handleFileUpload" />
      </div>
      <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">完整备份包含省钱、体重、心情、密码库、日程及应用设置和 API Key，并由当前主密码进行 AES 加密；不会包含主密码或设备生物识别凭据。仍可选择单项备份并保持原有格式。</p>
    </div>

    <!-- AI 情绪陪伴引擎 -->
    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">🤖 AI 情绪陪伴 (BYOK)</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <p class="caption body-muted" style="margin: 0 0 16px 0;">自备 Key 接入，数据仅限本机流转，绝对隐私。兼容 DeepSeek / OpenAI / 通义千问等标准 API。</p>
        <div class="input-group">
          <label class="caption">API 接口地址</label>
          <input v-model="settingsStore.aiProviderUrl" type="text" class="apple-input" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">API Key</label>
          <input v-model="settingsStore.aiApiKey" type="password" class="apple-input" placeholder="sk-..." autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">模型名称</label>
          <input v-model="settingsStore.aiModel" type="text" class="apple-input" placeholder="deepseek-chat / gpt-4o-mini" autocomplete="off" spellcheck="false" />
        </div>
        <button class="button-primary full-width" style="margin-top: 8px;" :disabled="isTestingAI" @click="testAIConnection">
          {{ isTestingAI ? '⏳ 连接测试中...' : '⚡ 测试 AI 握手' }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="autoLockPickerOpen" class="settings-picker-mask" @click="autoLockPickerOpen = false">
        <div class="settings-picker" @click.stop>
          <div class="settings-picker-handle"></div>
          <header>
            <strong>进入后台后自动锁定</strong>
            <button @click="autoLockPickerOpen = false">取消</button>
          </header>
          <button
            v-for="option in autoLockOptions"
            :key="option.value"
            :class="{ selected: settingsStore.autoLockDelaySeconds === option.value }"
            @click="settingsStore.autoLockDelaySeconds = option.value; autoLockPickerOpen = false"
          >
            <span>{{ option.label }}</span><b>✓</b>
          </button>
        </div>
      </div>
      <div v-if="backupPickerOpen" class="settings-picker-mask" @click="backupPickerOpen = false">
        <div class="settings-picker" @click.stop>
          <div class="settings-picker-handle"></div>
          <header>
            <strong>选择备份数据</strong>
            <button @click="backupPickerOpen = false">取消</button>
          </header>
          <button
            v-for="option in backupTypeOptions"
            :key="option.value"
            :class="{ selected: exportDataType === option.value }"
            @click="exportDataType = option.value; backupPickerOpen = false"
          >
            <span>{{ option.label }}</span><b>✓</b>
          </button>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
.settings-container { display: flex; flex-direction: column; gap: 32px; }
.setting-section { display: flex; flex-direction: column; }
.section-title { padding: 0 16px; margin-bottom: 8px; text-transform: uppercase; }
.module-settings-intro {
  display: flex; align-items: center; gap: 14px; padding: 18px;
  border: 1px solid rgba(255,255,255,.82); border-radius: 22px;
  background: linear-gradient(145deg, rgba(236,246,255,.94), rgba(255,255,255,.88));
  box-shadow: 0 10px 30px rgba(35,68,104,.08);
}
.module-settings-intro > span {
  display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 auto;
  border-radius: 16px; background: linear-gradient(145deg, #2588ee, #0861bc);
  color: #fff; font-size: 24px; box-shadow: 0 8px 18px rgba(0,102,204,.2);
}
.module-settings-intro strong { display: block; color: var(--ink); font-size: 18px; }
.module-settings-intro p { margin: 5px 0 0; color: var(--body-muted); font-size: 13px; line-height: 1.45; }

.ios-list { background: var(--canvas); border-radius: 12px; border: 1px solid var(--hairline); overflow: hidden; display: flex; flex-direction: column;}
.list-item { padding: 16px; background: transparent; border: none; border-bottom: 1px solid var(--divider-soft); font-size: 17px; cursor: pointer; color: var(--ink); width: 100%;}
.list-item:last-child { border-bottom: none; }
.list-item:active { background: var(--surface-pearl); }

.text-link.destructive { color: #ff3b30; }
.danger-text { color: #d92d20; }
.input-group { margin-bottom: 12px; }
.store-utility-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-top: 8px; }
.health-setting-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
.health-setting-grid .input-group span, .threshold-field span { display: block; margin-bottom: 8px; }
.health-reminder-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 4px 0 16px; padding: 15px; border-radius: 15px; background: var(--surface-pearl); }
.health-reminder-toggle strong, .health-reminder-toggle small { display: block; }
.health-reminder-toggle strong { font-size: 15px; }
.health-reminder-toggle small { margin-top: 4px; color: var(--body-muted); font-size: 11px; line-height: 1.4; }
.health-reminder-toggle .switch-control i { position: absolute; inset: 0; border-radius: 999px; background: #d1d1d6; transition: background .2s; }
.health-reminder-toggle .switch-control i::after { content: ''; position: absolute; width: 24px; height: 24px; top: 2px; left: 2px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .2s; }
.health-reminder-toggle .switch-control input:checked + i { background: var(--primary); }
.health-reminder-toggle .switch-control input:checked + i::after { transform: translateX(20px); }
.threshold-field { display: block; margin-bottom: 18px; }
.taxonomy-card + .taxonomy-card { margin-top: 12px; }
.taxonomy-title { margin: 0; }
.taxonomy-description { margin: 8px 0 16px; line-height: 1.55; }
.taxonomy-empty { margin: 0; padding: 12px 0 2px; }
.taxonomy-add-row { display: flex; gap: 10px; margin-bottom: 14px; }
.taxonomy-add-row .apple-input { flex: 1; min-width: 0; }
.taxonomy-add-button { flex-shrink: 0; padding-inline: 18px; }
.taxonomy-list { overflow: hidden; border: 1px solid var(--hairline); border-radius: 12px; }
.taxonomy-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid var(--divider-soft); }
.taxonomy-row:last-child { border-bottom: 0; }
.taxonomy-row-meta { display: flex; align-items: center; gap: 10px; text-align: right; }
.taxonomy-action { flex-shrink: 0; }
.schedule-color-picker {
  margin: 0 0 16px;
  padding: 16px;
  border: 1px solid var(--hairline);
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(255,255,255,.88), rgba(245,247,250,.72));
}
.schedule-color-picker-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.schedule-color-preview {
  width: 34px; height: 34px; border: 4px solid white; border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(22,22,24,.12), 0 5px 15px rgba(22,22,24,.16);
}
.schedule-color-board {
  position: relative; width: 100%; height: 150px; overflow: hidden;
  border: 1px solid rgba(20,20,23,.12); border-radius: 14px;
  touch-action: none; cursor: crosshair;
}
.schedule-color-cursor {
  position: absolute; width: 22px; height: 22px; border: 3px solid white; border-radius: 50%;
  box-shadow: 0 1px 7px rgba(0,0,0,.4); transform: translate(-50%, -50%); pointer-events: none;
}
.schedule-hue-slider {
  width: 100%; height: 22px; margin: 14px 0 10px; padding: 0;
  border: 0; border-radius: 999px; outline: none;
  background: linear-gradient(to right, #f33, #ff0, #3f3, #3ff, #33f, #f3f, #f33);
  appearance: none; -webkit-appearance: none;
}
.schedule-hue-slider::-webkit-slider-thumb {
  width: 24px; height: 24px; border: 4px solid white; border-radius: 50%;
  background: hsl(var(--schedule-hue, 0) 100% 50%);
  box-shadow: 0 1px 7px rgba(0,0,0,.35); appearance: none; -webkit-appearance: none;
}
.schedule-hue-slider::-moz-range-thumb {
  width: 18px; height: 18px; border: 4px solid white; border-radius: 50%;
  box-shadow: 0 1px 7px rgba(0,0,0,.35);
}
.schedule-color-code { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; }
.schedule-color-code .apple-input { min-height: 44px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; text-transform: uppercase; }
.schedule-category-name { display: flex; align-items: center; gap: 9px; }
.schedule-category-name i {
  width: 14px; height: 14px; display: block; border: 3px solid white; border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(20,20,23,.14);
}

.backup-type-button {
  width: 100%; display: flex; justify-content: space-between; align-items: center; min-height: 52px;
  border: 1px solid var(--hairline); border-radius: 14px; padding: 0 16px;
  background: var(--surface-pearl); color: var(--ink); font: inherit; text-align: left;
}
.backup-type-button b { color: var(--body-muted); font-size: 22px; font-weight: 400; }
.settings-picker-mask {
  position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end;
  background: rgba(18,18,22,.28); backdrop-filter: blur(4px);
}
.settings-picker {
  width: 100%; max-height: 72vh; overflow-y: auto; padding: 8px 18px calc(20px + env(safe-area-inset-bottom));
  border-radius: 28px 28px 0 0; background: rgba(250,250,252,.98); box-shadow: 0 -12px 40px rgba(0,0,0,.12);
}
.settings-picker-handle { width: 42px; height: 5px; margin: 2px auto 13px; border-radius: 3px; background: #d1d1d5; }
.settings-picker header { display: flex; justify-content: space-between; align-items: center; padding: 5px 4px 12px; }
.settings-picker header strong { font-size: 20px; }
.settings-picker header button { border: 0; background: none; color: var(--primary); font-size: 16px; }
.settings-picker > button {
  width: 100%; display: flex; justify-content: space-between; align-items: center; min-height: 58px;
  border: 0; border-top: 1px solid var(--divider-soft); background: transparent; color: var(--ink); font-size: 17px; text-align: left;
}
.settings-picker > button b { color: transparent; }
.settings-picker > button.selected { color: var(--primary); font-weight: 650; }
.settings-picker > button.selected b { color: var(--primary); }
.reminder-card { padding: 0; overflow: hidden; }
.reminder-row { display: flex; align-items: center; gap: 12px; min-height: 92px; padding: 14px 16px; border-bottom: 1px solid var(--divider-soft); }
.reminder-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.reminder-time { width: 92px; padding: 8px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-pearl); color: var(--ink); font: inherit; }
.reminder-time:disabled { opacity: .45; }
.ai-reminder-option { display: flex; align-items: flex-start; gap: 6px; margin-top: 3px; color: var(--primary); font-size: 12px; line-height: 1.35; }
.ai-reminder-option input { width: 14px; height: 14px; margin: 1px 0 0; accent-color: var(--primary); flex-shrink: 0; }
.ai-reminder-option:has(input:disabled) { opacity: .45; }
.switch-control { position: relative; width: 48px; height: 28px; flex-shrink: 0; }
.switch-control input { position: absolute; opacity: 0; pointer-events: none; }
.switch-control span { position: absolute; inset: 0; border-radius: 999px; background: #d1d1d6; transition: background .2s; cursor: pointer; }
.switch-control span::after { content: ''; position: absolute; width: 24px; height: 24px; top: 2px; left: 2px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .2s; }
.switch-control input:checked + span { background: var(--primary); }
.switch-control input:checked + span::after { transform: translateX(20px); }
.reminder-save { margin: 16px; width: calc(100% - 32px); }
.reminder-test { margin: 0 16px 12px; width: calc(100% - 32px); }
.reminder-exact { margin: 0 16px 12px; width: calc(100% - 32px); }
.reminder-status { display: flex; flex-direction: column; gap: 4px; margin: 0 16px 12px; padding: 12px; border-radius: 12px; background: var(--surface-pearl); color: var(--ink); font-size: 13px; line-height: 1.45; }
.reminder-status.warning { color: #b42318; background: #fff1f0; }
.reminder-note { margin: 0; padding: 0 16px 16px; text-align: center; }
@media (max-width: 480px) {
  .reminder-row { gap: 8px; }
  .reminder-time { width: 82px; font-size: 14px; }
  .health-setting-grid { grid-template-columns: 1fr; gap: 0; }
}
</style>
