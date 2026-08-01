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
import { beginNativeActivityGuard } from '../services/nativeActivityGuard'
import {
  buildFullBackupSnapshot,
  getFullBackupCounts,
  normalizeFullBackupSnapshot
} from '../services/fullBackup'
import {
  buildChatBackupSnapshot,
  CHAT_MEMORY_CATEGORIES,
  CHAT_MEMORY_SCOPES,
  normalizeChatBackupSnapshot
} from '../services/chatRecords'
import { prepareCompanionAvatar } from '../services/chatAvatar'
import {
  generateDailyCompanionWorld,
  localDailyCompanionWorld
} from '../services/chatRelationship'
import {
  buildProactiveSlots,
  generateProactiveOutbox,
  syncChatProactiveNotifications
} from '../services/chatProactive'
import { syncChatFollowupNotifications } from '../services/chatFollowup'
import { generateCompanionWorldDraft } from '../services/chatRealism'

import { useAuthStore } from '../stores/auth'
import { useDebtStore } from '../stores/debt'
import { useWeightStore } from '../stores/weight'
import { useMoodStore } from '../stores/mood'
import { useSettingsStore } from '../stores/settings'
import { usePasswordVaultStore } from '../stores/passwordVault'
import { useScheduleStore } from '../stores/schedule'
import { useChatStore } from '../stores/chat'
import { syncScheduleNotifications } from '../services/scheduleNotificationService'
import { normalizeScheduleData } from '../services/scheduleCore'
import { appAlert, appConfirm, appPrompt, appToast } from '../services/uiFeedback'
import {
  THEME_PRESETS,
  getThemePrimary,
  normalizeHexColor
} from '../services/themeSystem'
import AppTimeField from './AppTimeField.vue'

const authStore = useAuthStore()
const debtStore = useDebtStore()
const weightStore = useWeightStore()
const moodStore = useMoodStore()
const settingsStore = useSettingsStore()
const vaultStore = usePasswordVaultStore()
const scheduleStore = useScheduleStore()
const chatStore = useChatStore()
const settingsScope = computed(() => settingsStore.settingsScope || 'general')
const scopeMeta = computed(() => ({
  debts: { icon: '◎', title: '省钱计划设置', description: '管理省钱看板文案、目标回顾提醒与个性化鼓励。' },
  weight: { icon: '◇', title: '体重记录设置', description: '管理健康参数、变化提醒与每日记录提醒。' },
  mood: { icon: '♡', title: '心情日记设置', description: '管理自定义标签与每日关怀提醒。' },
  schedule: { icon: '□', title: '日程提醒设置', description: '管理日程标签、颜色和分类规则。' },
  passwords: { icon: '⌑', title: '密码库设置', description: '管理密码分类；主密码仍在通用配置中管理。' },
  chat: { icon: '⌂', title: '温馨小家设置', description: '管理女朋友名字、记忆和聊天数据。' }
})[settingsScope.value] || null)

const isChangingPwd = ref(false)
const isChangingPwdBio = ref(false)

const oldPwdInput = ref('')
const newPwdInput = ref('')
const confirmNewPwdInput = ref('')
const fileInputRef = ref(null)
const bgInputRef = ref(null)
const companionAvatarInputRef = ref(null)

const exportDataType = ref('full')
const backupPickerOpen = ref(false)
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
const newVaultCategory = ref('')
const newScheduleCategory = ref('')
const companionNameInput = ref(chatStore.profile.companionName)
const newMemoryContent = ref('')
const newMemoryCategory = ref('偏好')
const newMemoryScope = ref('user')
const memoryScopeFilter = ref('user')
const memoryPage = ref(1)
const isProcessingCompanionAvatar = ref(false)
const isRegeneratingCompanionState = ref(false)
const isSavingChatProactive = ref(false)
const isWorldExpanded = ref(false)
const isGeneratingWorldDraft = ref(false)
const worldDraft = ref(null)
const proactiveForm = ref({
  enabled: chatStore.proactiveSettings.enabled,
  dailyMin: chatStore.proactiveSettings.dailyMin,
  dailyMax: chatStore.proactiveSettings.dailyMax,
  activeStart: chatStore.proactiveSettings.activeStart,
  activeEnd: chatStore.proactiveSettings.activeEnd
})
const MEMORY_PAGE_SIZE = 3
const memoryScopeMeta = {
  user: { label: '哥哥', description: '哥哥的信息' },
  companion: { label: '她', description: '她的虚拟设定' },
  relationship: { label: '我们', description: '两人的共同经历' }
}
const memoryScopeOptions = CHAT_MEMORY_SCOPES.map(value => ({ value, ...memoryScopeMeta[value] }))
const scopedChatMemories = computed(() => (
  chatStore.memories.filter(memory => memory.scope === memoryScopeFilter.value)
))
const memoryPageCount = computed(() => Math.max(1, Math.ceil(scopedChatMemories.value.length / MEMORY_PAGE_SIZE)))
const pagedChatMemories = computed(() => {
  const start = (memoryPage.value - 1) * MEMORY_PAGE_SIZE
  return scopedChatMemories.value.slice(start, start + MEMORY_PAGE_SIZE)
})
const memoryRangeLabel = computed(() => {
  if (!scopedChatMemories.value.length) return ''
  const start = (memoryPage.value - 1) * MEMORY_PAGE_SIZE + 1
  const end = Math.min(start + MEMORY_PAGE_SIZE - 1, scopedChatMemories.value.length)
  return `${start}–${end} / ${scopedChatMemories.value.length}`
})
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
const themePresets = Object.values(THEME_PRESETS)
const themeColorHue = ref(210)
const themeColorSaturation = ref(66)
const themeColorValue = ref(85)
const themeColorBoardRef = ref(null)

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

const syncThemePickerFromSettings = () => {
  const color = hexToHsv(getThemePrimary(settingsStore.themeSettings))
  if (!color) return
  themeColorHue.value = color.hue
  themeColorSaturation.value = color.saturation
  themeColorValue.value = color.value
}

watch(() => settingsStore.themeSettings, syncThemePickerFromSettings, {
  deep: true,
  immediate: true
})

const selectThemePreset = presetId => {
  settingsStore.updateThemeSettings({
    ...settingsStore.themeSettings,
    mode: 'preset',
    presetId
  })
  appToast(`已切换为${THEME_PRESETS[presetId].name}主题`, { tone: 'success' })
}

const activateCustomTheme = () => {
  const currentPrimary = getThemePrimary(settingsStore.themeSettings)
  const color = hexToHsv(currentPrimary)
  if (color) {
    themeColorHue.value = color.hue
    themeColorSaturation.value = color.saturation
    themeColorValue.value = color.value
  }
  settingsStore.updateThemeSettings({
    ...settingsStore.themeSettings,
    mode: 'custom',
    customPrimary: currentPrimary
  })
}

const applyThemePickerColor = () => {
  settingsStore.themeSettings = {
    ...settingsStore.themeSettings,
    mode: 'custom',
    customPrimary: hsvToHex(
      themeColorHue.value,
      themeColorSaturation.value,
      themeColorValue.value
    )
  }
}

const updateThemeColorFromBoard = event => {
  const board = themeColorBoardRef.value
  if (!board) return
  const rect = board.getBoundingClientRect()
  themeColorSaturation.value = Math.round(clampColorValue(
    ((event.clientX - rect.left) / rect.width) * 100
  ))
  themeColorValue.value = Math.round(clampColorValue(
    100 - ((event.clientY - rect.top) / rect.height) * 100
  ))
  if (event.type === 'pointerdown') board.setPointerCapture?.(event.pointerId)
  applyThemePickerColor()
}

const updateThemeColorFromHex = event => {
  const normalized = normalizeHexColor(event.target.value, getThemePrimary(settingsStore.themeSettings))
  const color = hexToHsv(normalized)
  if (!color) return
  themeColorHue.value = color.hue
  themeColorSaturation.value = color.saturation
  themeColorValue.value = color.value
  settingsStore.themeSettings = {
    ...settingsStore.themeSettings,
    mode: 'custom',
    customPrimary: normalized
  }
}

const themeColorBoardStyle = computed(() => ({
  background: [
    'linear-gradient(to top, #000, transparent)',
    `linear-gradient(to right, #fff, hsl(${themeColorHue.value} 100% 50%))`
  ].join(', ')
}))

const themeColorCursorStyle = computed(() => ({
  left: `${themeColorSaturation.value}%`,
  top: `${100 - themeColorValue.value}%`,
  background: getThemePrimary(settingsStore.themeSettings)
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

watch(() => chatStore.profile.companionName, value => {
  if (settingsScope.value === 'chat') companionNameInput.value = value
}, { immediate: true })

watch(memoryPageCount, count => {
  if (memoryPage.value > count) memoryPage.value = count
})

watch(memoryScopeFilter, scope => {
  memoryPage.value = 1
  newMemoryScope.value = scope
})

watch(() => chatStore.proactiveSettings, value => {
  proactiveForm.value = { ...value }
}, { deep: true, immediate: true })

const triggerCompanionAvatarUpload = () => companionAvatarInputRef.value?.click()

const handleCompanionAvatarUpload = async event => {
  const input = event.target
  const file = input?.files?.[0]
  if (!file) return
  isProcessingCompanionAvatar.value = true
  try {
    const avatar = await prepareCompanionAvatar(file)
    chatStore.setCompanionAvatar(avatar)
    appToast('女朋友头像已经换好啦', { tone: 'success' })
  } catch (error) {
    if (error?.message === 'AVATAR_FILE_TOO_LARGE') {
      appAlert('图片不能超过 5MB，请换一张小一点的图片')
    } else if (error?.message === 'AVATAR_INVALID_TYPE') {
      appAlert('请选择 JPG、PNG 或 WebP 图片')
    } else {
      appAlert('这张图片暂时无法读取，请换一张再试')
    }
  } finally {
    isProcessingCompanionAvatar.value = false
    if (input) input.value = ''
  }
}

const clearCompanionAvatar = async () => {
  if (!chatStore.profile.companionAvatar) return
  if (!await appConfirm('将恢复为温馨小家的默认爱心头像。', {
    title: '移除自定义头像？',
    destructive: true
  })) return
  chatStore.setCompanionAvatar('')
  appToast('已经恢复默认头像')
}

const saveCompanionName = () => {
  const name = String(companionNameInput.value || '').trim()
  if (!name) return appAlert('请输入女朋友的名字')
  if (name.length > 20) return appAlert('名字请控制在 20 个字以内')
  chatStore.setCompanionName(name)
  companionNameInput.value = chatStore.profile.companionName
  appToast(`以后就叫她“${chatStore.profile.companionName}”啦`, { tone: 'success' })
}

const addChatMemory = () => {
  const content = String(newMemoryContent.value || '').trim()
  if (!content) return appAlert('请先写下想让她记住的内容')
  const memory = chatStore.addMemory({
    scope: newMemoryScope.value,
    category: newMemoryCategory.value,
    key: `${newMemoryScope.value}:${newMemoryCategory.value}:${content}`,
    content
  })
  if (!memory) return appAlert('这条内容可能包含账号、密码或密钥，不能保存为长期记忆')
  newMemoryContent.value = ''
  memoryScopeFilter.value = newMemoryScope.value
  memoryPage.value = 1
  appToast('长期记忆已添加', { tone: 'success' })
}

const editChatMemory = async memory => {
  const content = await appPrompt('修改这条长期记忆：', memory.content, {
    title: '编辑长期记忆',
    placeholder: '她以后需要记住的事情'
  })
  if (content === null) return
  const updated = chatStore.updateMemory(memory.id, {
    key: `${memory.scope}:${memory.category}:${String(content).trim()}`,
    content
  })
  if (!updated) return appAlert('记忆不能为空，也不能包含账号、密码或密钥')
  appToast('长期记忆已更新', { tone: 'success' })
}

const deleteChatMemory = async memory => {
  if (!await appConfirm(`将删除这条记忆：\n${memory.content}`, {
    title: '删除长期记忆？',
    destructive: true
  })) return
  chatStore.deleteMemory(memory.id)
  memoryPage.value = Math.min(memoryPage.value, memoryPageCount.value)
  appToast('长期记忆已删除')
}

const selfProfileSections = [
  { field: 'interests', label: '喜欢' },
  { field: 'dislikes', label: '不喜欢' },
  { field: 'opinions', label: '自己的看法' },
  { field: 'habits', label: '习惯' }
]

const editSelfSummary = async () => {
  const value = await appPrompt('写一小段她稳定的自我介绍。', chatStore.selfProfile.summary, {
    title: '编辑她的自我简介',
    placeholder: '例如：有点黏人，也喜欢认真听哥哥讲烦恼'
  })
  if (value === null) return
  chatStore.setSelfProfile({ summary: value })
  appToast('她的自我简介已更新', { tone: 'success' })
}

const editSelfProfileList = async section => {
  const current = chatStore.selfProfile[section.field] || []
  const value = await appPrompt('用逗号分隔多项；留空可清空这一栏。', current.join('，'), {
    title: `编辑${section.label}`,
    placeholder: '每项尽量具体、简短'
  })
  if (value === null) return
  chatStore.setSelfProfile({
    [section.field]: String(value).split(/[，,\n]/).map(item => item.trim()).filter(Boolean)
  })
  appToast(`“${section.label}”已更新`, { tone: 'success' })
}

const addSocialCharacter = async () => {
  if (chatStore.socialCast.length >= 3) return appAlert('固定人物最多保留 3 个')
  const name = await appPrompt('只添加明确存在于温馨小家虚拟世界中的人物。', '', {
    title: '添加固定人物',
    placeholder: '人物名字'
  })
  if (name === null || !String(name).trim()) return
  const relationship = await appPrompt('她和这个人物是什么关系？', '', {
    title: '设置人物关系',
    placeholder: '例如：一起做手账的朋友'
  })
  if (relationship === null || !String(relationship).trim()) return
  const before = chatStore.socialCast.length
  chatStore.setSocialCast([...chatStore.socialCast, { name, relationship, traits: [], notes: '' }])
  if (chatStore.socialCast.length === before) return appAlert('人物信息不完整或包含不能保存的敏感内容')
  appToast('固定人物已添加', { tone: 'success' })
}

const editSocialCharacter = async character => {
  const relationship = await appPrompt('修改她和这个人物的关系。', character.relationship, {
    title: `编辑 ${character.name}`,
    placeholder: '人物关系'
  })
  if (relationship === null) return
  const notes = await appPrompt('可以写性格或需要保持一致的备注。', character.notes, {
    title: `补充 ${character.name} 的设定`,
    placeholder: '人物性格与备注'
  })
  if (notes === null) return
  chatStore.setSocialCast(chatStore.socialCast.map(item => (
    item.id === character.id ? { ...item, relationship, notes, updatedAt: Date.now() } : item
  )))
  appToast('人物设定已更新', { tone: 'success' })
}

const deleteSocialCharacter = async character => {
  if (!await appConfirm(`删除固定人物“${character.name}”后，之后的聊天不会再引用她。`, {
    title: '删除固定人物？',
    destructive: true
  })) return
  chatStore.setSocialCast(chatStore.socialCast.filter(item => item.id !== character.id))
  chatStore.setVirtualEvents(chatStore.virtualEvents.map(event => ({
    ...event,
    characterIds: event.characterIds.filter(id => id !== character.id)
  })))
  appToast('固定人物已删除')
}

const deleteVirtualEvent = async event => {
  if (!await appConfirm(`删除虚拟事件“${event.title}”？`, { title: '删除近期事件？', destructive: true })) return
  chatStore.setVirtualEvents(chatStore.virtualEvents.filter(item => item.id !== event.id))
  appToast('近期事件已删除')
}

const revertEvolution = async entry => {
  if (!await appConfirm(`撤销她后来形成的“${entry.nextValue}”？`, { title: '撤销这次变化？' })) return
  if (chatStore.revertEvolution(entry.id)) appToast('这次变化已撤销', { tone: 'success' })
}

const resetCompanionWorld = async () => {
  if (!await appConfirm('只重置她的自我档案、固定人物、虚拟事件和变化记录；聊天与长期记忆会保留。', {
    title: '重置她的世界？',
    confirmText: '重置世界',
    destructive: true
  })) return
  chatStore.setSelfProfile({ summary: '', interests: [], dislikes: [], opinions: [], habits: [], updatedAt: Date.now() })
  chatStore.setSocialCast([])
  chatStore.setVirtualEvents([])
  chatStore.setEvolutionState({ candidates: [], log: [] })
  worldDraft.value = null
  appToast('她的世界已重置')
}

const buildCompanionWorldFromHistory = async () => {
  if (!await appConfirm('为建立草案，最近 200 个合并角色消息和现有长期记忆将发送给当前配置的 AI 服务商。不会读取密码库、主密码、API Key 或账号凭据；只有你最终确认后才会保存。', {
    title: '根据已有聊天建立她的自我？',
    confirmText: '同意并生成'
  })) return
  isGeneratingWorldDraft.value = true
  worldDraft.value = null
  try {
    worldDraft.value = await generateCompanionWorldDraft({
      companionName: chatStore.profile.companionName,
      messages: chatStore.messages,
      memories: chatStore.memories
    })
    isWorldExpanded.value = true
    if (worldDraft.value.generationMeta?.usedLocalFallback) {
      appToast('部分分析格式异常，已整理为可编辑草案，请确认后再保存', { tone: 'warning', duration: 4200 })
    } else if (worldDraft.value.generationMeta?.failedChunks) {
      appToast(`草案已生成；${worldDraft.value.generationMeta.failedChunks} 个分块已自动跳过`, { tone: 'warning', duration: 4200 })
    } else {
      appToast('草案生成好了，请确认后再保存', { tone: 'success' })
    }
  } catch (error) {
    console.error('根据历史建立她的世界失败', error)
    const message = error?.code === 'MISSING_KEY' || error?.message === 'MISSING_KEY'
      ? '尚未配置可用的 API Key。请先到通用配置完成 AI 设置和连接测试，再回来生成草案。'
      : '当前 AI 服务没有完成任何可用的历史分析。请检查网络与 AI 连接后重试；现有档案没有被修改。'
    appAlert(message, { title: '草案生成失败', tone: 'danger' })
  } finally {
    isGeneratingWorldDraft.value = false
  }
}

const editWorldDraftSummary = async () => {
  const value = await appPrompt('这是草案，不会在最终确认前写入。', worldDraft.value?.selfProfile?.summary || '', {
    title: '修改草案简介',
    placeholder: '她稳定的自我介绍'
  })
  if (value === null || !worldDraft.value) return
  worldDraft.value = {
    ...worldDraft.value,
    selfProfile: { ...worldDraft.value.selfProfile, summary: String(value).trim() }
  }
}

const editWorldDraftList = async section => {
  if (!worldDraft.value) return
  const current = worldDraft.value.selfProfile?.[section.field] || []
  const value = await appPrompt('用逗号分隔多项；留空可清空这一栏。', current.join('，'), {
    title: `修改草案·${section.label}`,
    placeholder: '每项尽量具体、简短'
  })
  if (value === null) return
  worldDraft.value = {
    ...worldDraft.value,
    selfProfile: {
      ...worldDraft.value.selfProfile,
      [section.field]: String(value).split(/[，,\n]/).map(item => item.trim()).filter(Boolean)
    }
  }
}

const removeWorldDraftCharacter = id => {
  if (!worldDraft.value) return
  worldDraft.value = {
    ...worldDraft.value,
    socialCast: worldDraft.value.socialCast.filter(item => item.id !== id),
    virtualEvents: worldDraft.value.virtualEvents.map(event => ({
      ...event,
      characterIds: event.characterIds.filter(characterId => characterId !== id)
    }))
  }
}

const editWorldDraftCharacter = async character => {
  if (!worldDraft.value) return
  const relationship = await appPrompt('这是草案，确认前不会写入。', character.relationship, {
    title: `修改 ${character.name} 的关系`,
    placeholder: '人物关系'
  })
  if (relationship === null) return
  worldDraft.value = {
    ...worldDraft.value,
    socialCast: worldDraft.value.socialCast.map(item => (
      item.id === character.id ? { ...item, relationship: String(relationship).trim() } : item
    ))
  }
}

const removeWorldDraftEvent = id => {
  if (!worldDraft.value) return
  worldDraft.value = {
    ...worldDraft.value,
    virtualEvents: worldDraft.value.virtualEvents.filter(item => item.id !== id)
  }
}

const editWorldDraftEvent = async event => {
  if (!worldDraft.value) return
  const detail = await appPrompt('修改这个虚拟生活事件的具体内容。', event.detail, {
    title: `修改 ${event.title}`,
    placeholder: '明确发生在温馨小家中的虚拟事件'
  })
  if (detail === null) return
  worldDraft.value = {
    ...worldDraft.value,
    virtualEvents: worldDraft.value.virtualEvents.map(item => (
      item.id === event.id ? { ...item, detail: String(detail).trim() } : item
    ))
  }
}

const confirmWorldDraft = async () => {
  if (!worldDraft.value) return
  if (!await appConfirm('确认后将写入她的自我档案、固定人物和初始虚拟事件，并用于之后的聊天。', {
    title: '启用这份世界草案？',
    confirmText: '确认启用'
  })) return
  chatStore.setSelfProfile(worldDraft.value.selfProfile)
  chatStore.setSocialCast(worldDraft.value.socialCast)
  chatStore.setVirtualEvents(worldDraft.value.virtualEvents)
  worldDraft.value = null
  appToast('她的世界已经启用', { tone: 'success' })
}

const setDailyMinimum = value => {
  proactiveForm.value.dailyMin = Math.max(0, Math.min(5, Number(value)))
  if (proactiveForm.value.dailyMin > proactiveForm.value.dailyMax) {
    proactiveForm.value.dailyMax = proactiveForm.value.dailyMin
  }
}

const setDailyMaximum = value => {
  proactiveForm.value.dailyMax = Math.max(0, Math.min(5, Number(value)))
  if (proactiveForm.value.dailyMax < proactiveForm.value.dailyMin) {
    proactiveForm.value.dailyMin = proactiveForm.value.dailyMax
  }
}

const setFollowupEnabled = async value => {
  const settings = chatStore.setRealismSettings({ followupEnabled: value })
  if (!settings.followupEnabled) chatStore.setFollowupOutbox([])
  await syncChatFollowupNotifications(chatStore.followupOutbox, settings, {
    requestPermission: false,
    now: new Date()
  }).catch(error => console.warn('刷新延迟补话通知失败', error))
  appToast(settings.followupEnabled ? '延迟补话已开启' : '延迟补话已关闭')
}

const regenerateCompanionState = async () => {
  isRegeneratingCompanionState.value = true
  try {
    let world
    try {
      world = await generateDailyCompanionWorld({
        companionName: chatStore.profile.companionName,
        now: new Date(),
        previousState: chatStore.companionState,
        memories: chatStore.memories,
        openLoops: chatStore.openLoops,
        recentMessages: chatStore.messages.slice(-30),
        selfProfile: chatStore.selfProfile,
        socialCast: chatStore.socialCast,
        recentVirtualEvents: chatStore.virtualEvents.slice(0, 12)
      })
    } catch (error) {
      console.warn('重新生成女朋友状态失败，已使用本地状态', error)
      world = localDailyCompanionWorld()
    }
    chatStore.setCompanionState(world.state)
    if (world.virtualEvent && !chatStore.virtualEvents.some(item => item.date === world.virtualEvent.date)) {
      chatStore.addVirtualEvent(world.virtualEvent)
    }
    appToast('她今天的状态已经更新', { tone: 'success' })
  } finally {
    isRegeneratingCompanionState.value = false
  }
}

const saveChatProactiveSettings = async () => {
  isSavingChatProactive.value = true
  try {
    const settings = chatStore.setProactiveSettings(proactiveForm.value)
    const now = new Date()
    const slots = buildProactiveSlots({
      settings,
      messages: chatStore.messages,
      openLoops: chatStore.openLoops,
      existingOutbox: [],
      now,
      days: 7
    })
    const outbox = await generateProactiveOutbox({
      slots,
      companionName: chatStore.profile.companionName,
      state: chatStore.companionState,
      memories: chatStore.memories,
      openLoops: chatStore.openLoops,
      recentMessages: chatStore.messages.slice(-30),
      selfProfile: chatStore.selfProfile,
      socialCast: chatStore.socialCast,
      virtualEvents: chatStore.virtualEvents.slice(0, 12),
      now
    })
    chatStore.setProactiveOutbox(outbox)
    const result = await syncChatProactiveNotifications(outbox, settings, {
      requestPermission: settings.enabled,
      now
    })
    await syncChatFollowupNotifications(
      chatStore.followupOutbox,
      chatStore.realismSettings,
      { requestPermission: false, now }
    )
    if (settings.enabled && result.permission !== 'granted') {
      appToast('主动联系已保存，但系统还没有通知权限', { tone: 'warning', duration: 3500 })
    } else {
      appToast(settings.enabled ? '主动联系时间已经安排好啦' : '主动联系已关闭', { tone: 'success' })
    }
  } catch (error) {
    if (error?.code === 'NOTIFICATION_PERMISSION_DENIED') {
      appToast('设置已保存；允许系统通知后，她才能在应用外来找你', {
        tone: 'warning',
        duration: 3800
      })
      return
    }
    console.error('保存温馨小家主动联系设置失败', error)
    appAlert('主动联系设置暂时没有保存成功，请稍后再试')
  } finally {
    isSavingChatProactive.value = false
  }
}

const cancelStoredChatProactive = async () => {
  chatStore.setProactiveOutbox([])
  chatStore.setFollowupOutbox([])
  await syncChatProactiveNotifications([], { ...chatStore.proactiveSettings, enabled: false }, {
    requestPermission: false,
    now: new Date()
  }).catch(error => console.warn('清理温馨小家主动通知失败', error))
  await syncChatFollowupNotifications([], { followupEnabled: false }, {
    requestPermission: false,
    now: new Date()
  }).catch(error => console.warn('清理温馨小家补话通知失败', error))
}

const clearChatMessages = async () => {
  if (!await appConfirm('将永久删除全部聊天消息，但保留女朋友名字、头像和长期记忆。', {
    title: '清空聊天记录？',
    confirmText: '清空聊天',
    destructive: true
  })) return
  chatStore.clearMessages()
  chatStore.replaceOpenLoops([])
  await cancelStoredChatProactive()
  appToast('聊天记录已清空')
}

const clearChatMemories = async () => {
  if (!await appConfirm('将永久删除全部长期记忆，但保留聊天记录。', {
    title: '清空长期记忆？',
    confirmText: '清空记忆',
    destructive: true
  })) return
  chatStore.clearMemories()
  await cancelStoredChatProactive()
  memoryPage.value = 1
  appToast('长期记忆已清空')
}

const resetChatHome = async () => {
  if (!await appConfirm('将永久删除温馨小家的名字、头像、全部聊天和长期记忆，无法撤销。', {
    title: '重置温馨小家？',
    confirmText: '全部重置',
    destructive: true
  })) return
  chatStore.resetAll()
  await cancelStoredChatProactive()
  companionNameInput.value = chatStore.profile.companionName
  memoryPage.value = 1
  appToast('温馨小家已重置')
}

// --- 安全 ---
const changeMasterPassword = async () => {
  const err = await authStore.updatePassword(oldPwdInput.value, newPwdInput.value, confirmNewPwdInput.value)
  if (err) return appAlert(err)
  await Promise.all([
    vaultStore.reencrypt(newPwdInput.value),
    chatStore.reencrypt(newPwdInput.value)
  ])
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
  await Promise.all([
    vaultStore.reencrypt(newPwdInput.value),
    chatStore.reencrypt(newPwdInput.value)
  ])
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
  if (exportDataType.value === 'chat') return buildChatBackupSnapshot(chatStore.snapshot)
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
  } else if (exportDataType.value === 'chat') {
    if (overwrite) await chatStore.replaceChatData(data)
    else await chatStore.mergeChatSnapshot(data)
    chatStore.materializeDueProactive(Date.now())
    chatStore.materializeDueFollowups(Date.now())
    await syncChatProactiveNotifications(
      chatStore.proactiveOutbox,
      chatStore.proactiveSettings,
      { requestPermission: false, now: new Date() }
    ).catch(error => console.warn('导入温馨小家后刷新主动联系失败', error))
    await syncChatFollowupNotifications(
      chatStore.followupOutbox,
      chatStore.realismSettings,
      { requestPermission: false, now: new Date() }
    ).catch(error => console.warn('导入温馨小家后刷新补话失败', error))
  } else {
    moodStore.updateMoodRecords(overwrite ? data : [...moodStore.moodRecords, ...data])
  }
}

const getFilePrefix = () => {
  return { full: 'Full', savings: 'Savings', weight: 'Weight', mood: 'Mood', passwords: 'Passwords', schedules: 'Schedules', chat: 'WarmHome' }[exportDataType.value]
}

const createFullBackupSnapshot = () => buildFullBackupSnapshot({
  savings: debtStore.savedDebts,
  weight: weightStore.weightRecords,
  mood: moodStore.moodRecords,
  passwords: vaultStore.records,
  schedules: scheduleStore.snapshot,
  chat: chatStore.snapshot,
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
    chatStore.restoreChatData(snapshot.data.chat),
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
    chatStore.materializeDueProactive(Date.now())
    chatStore.materializeDueFollowups(Date.now())
    await syncChatProactiveNotifications(
      chatStore.proactiveOutbox,
      chatStore.proactiveSettings,
      { requestPermission: false, now: new Date() }
    )
    await syncChatFollowupNotifications(
      chatStore.followupOutbox,
      chatStore.realismSettings,
      { requestPermission: false, now: new Date() }
    )
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
    : exportDataType.value === 'chat'
      ? !data.data.messages.length && !data.data.memories.length
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
        beginNativeActivityGuard()
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

const triggerImport = () => {
  if (!fileInputRef.value) return
  beginNativeActivityGuard()
  fileInputRef.value.click()
}

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
      `完整备份包含：\n省钱 ${counts.savings} 项、体重 ${counts.weight} 条、心情 ${counts.mood} 条、密码 ${counts.passwords} 项、日程 ${counts.schedules} 项、聊天 ${counts.chatMessages} 条、长期记忆 ${counts.chatMemories} 条，以及女朋友头像。\n\n继续将覆盖以上全部数据和应用设置。主密码与设备生物识别凭据不会改变。`,
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

      if (exportDataType.value === 'chat') {
        const snapshot = normalizeChatBackupSnapshot(importedData)
        const overwrite = await appConfirm(
      `成功解密出 ${snapshot.data.messages.length} 条聊天和 ${snapshot.data.memories.length} 条长期记忆。\n选择“覆盖”会替换名字、头像、聊天和记忆；取消则合并数据并保留当前名字与头像。`,
          { title: '恢复温馨小家', confirmText: '覆盖当前数据', cancelText: '合并数据' }
        )
        await setDataArray(snapshot.data, overwrite)
        appToast('温馨小家数据恢复成功', { tone: 'success' })
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

    <div v-if="settingsScope === 'chat'" class="setting-section chat-settings-section">
      <h3 class="caption body-muted section-title">陪伴档案</h3>
      <div class="store-utility-card chat-profile-card">
        <div class="chat-stat-row">
          <div><strong>{{ chatStore.messages.length }}</strong><span>聊天消息</span></div>
          <div><strong>{{ chatStore.memories.length }}</strong><span>长期记忆</span></div>
        </div>
        <div class="companion-avatar-setting">
          <div class="companion-avatar-preview" aria-hidden="true">
            <img
              v-if="chatStore.profile.companionAvatar"
              :src="chatStore.profile.companionAvatar"
              alt=""
            />
            <span v-else>♡</span>
          </div>
          <div class="companion-avatar-copy">
            <strong>女朋友头像</strong>
            <span>选择图片后会自动居中裁剪，聊天与备份都会保留。</span>
          </div>
          <button
            class="avatar-upload-button"
            type="button"
            :disabled="isProcessingCompanionAvatar"
            @click="triggerCompanionAvatarUpload"
          >{{ isProcessingCompanionAvatar ? '处理中…' : '上传' }}</button>
          <button
            v-if="chatStore.profile.companionAvatar"
            class="avatar-clear-button"
            type="button"
            aria-label="恢复默认头像"
            @click="clearCompanionAvatar"
          >恢复默认</button>
          <input
            ref="companionAvatarInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style="display: none"
            @change="handleCompanionAvatarUpload"
          />
        </div>
        <label class="input-group chat-name-field">
          <span class="caption">女朋友名字</span>
          <input
            v-model="companionNameInput"
            class="apple-input"
            maxlength="20"
            placeholder="例如：小暖"
            @keyup.enter="saveCompanionName"
          />
        </label>
        <button class="button-primary full-width" @click="saveCompanionName">保存名字</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">她今天的状态</h3>
      <div class="store-utility-card companion-state-card">
        <div class="companion-state-heading">
          <div>
            <span>{{ chatStore.companionState.mood || '安静' }}</span>
            <strong>{{ chatStore.companionState.statusText || '陪着你' }}</strong>
          </div>
          <em>精力 {{ chatStore.companionState.energy || '平稳' }}</em>
        </div>
        <p>{{ chatStore.companionState.currentThought || '想等哥哥来温馨小家说说话。' }}</p>
        <p class="companion-virtual-moment">{{ chatStore.companionState.virtualMoment || '在温馨小家里安静待着。' }}</p>
        <div v-if="chatStore.openLoops.length" class="open-loop-summary">
          <strong>还惦记着</strong>
          <span v-for="loop in chatStore.openLoops.slice(0, 3)" :key="loop.id">{{ loop.content }}</span>
        </div>
        <button
          class="button-secondary-pill full-width"
          type="button"
          :disabled="isRegeneratingCompanionState"
          @click="regenerateCompanionState"
        >{{ isRegeneratingCompanionState ? '正在换个心情…' : '重新生成今天状态' }}</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">她的世界</h3>
      <div class="store-utility-card companion-world-card">
        <button class="world-disclosure-button" type="button" @click="isWorldExpanded = !isWorldExpanded">
          <span>
            <strong>{{ chatStore.selfProfile.summary || '还没有建立稳定的自我档案' }}</strong>
            <small>{{ chatStore.socialCast.length }} 个固定人物 · {{ chatStore.virtualEvents.length }} 个近期事件</small>
          </span>
          <b :class="{ expanded: isWorldExpanded }">⌄</b>
        </button>

        <div v-if="isWorldExpanded" class="world-content">
          <section class="world-block">
            <header><strong>自我档案</strong><button class="text-link" type="button" @click="editSelfSummary">编辑简介</button></header>
            <p class="world-summary">{{ chatStore.selfProfile.summary || '可以手动编辑，也可以根据已有聊天先生成一份草案。' }}</p>
            <div class="world-profile-grid">
              <button
                v-for="section in selfProfileSections"
                :key="section.field"
                type="button"
                @click="editSelfProfileList(section)"
              >
                <strong>{{ section.label }}</strong>
                <span>{{ chatStore.selfProfile[section.field]?.join('、') || '点此补充' }}</span>
              </button>
            </div>
          </section>

          <section class="world-block">
            <header>
              <strong>固定虚拟人物（1–3 个）</strong>
              <button class="text-link" type="button" :disabled="chatStore.socialCast.length >= 3" @click="addSocialCharacter">添加</button>
            </header>
            <p v-if="!chatStore.socialCast.length" class="world-empty">尚未启用固定人物；AI 不会临时创造名单外人物。</p>
            <article v-for="character in chatStore.socialCast" :key="character.id" class="world-list-item">
              <div><strong>{{ character.name }}</strong><span>{{ character.relationship }}</span><small v-if="character.notes">{{ character.notes }}</small></div>
              <aside><button class="text-link" type="button" @click="editSocialCharacter(character)">编辑</button><button class="text-link danger-text" type="button" @click="deleteSocialCharacter(character)">删除</button></aside>
            </article>
          </section>

          <section class="world-block">
            <header><strong>近期虚拟事件</strong><small>每天最多 1 个</small></header>
            <p v-if="!chatStore.virtualEvents.length" class="world-empty">聊天后会逐日形成温馨小家里的生活事件。</p>
            <article v-for="event in chatStore.virtualEvents.slice(0, 8)" :key="event.id" class="world-list-item">
              <div><strong>{{ event.title }}</strong><span>{{ event.detail }}</span><small>{{ event.date }}</small></div>
              <aside><button class="text-link danger-text" type="button" @click="deleteVirtualEvent(event)">删除</button></aside>
            </article>
          </section>

          <section class="world-block">
            <header><strong>自我变化</strong><small>至少 3 轮、跨 2 天才生效</small></header>
            <p v-if="!chatStore.evolutionLog.length" class="world-empty">还没有达到生效条件的变化。</p>
            <article v-for="entry in chatStore.evolutionLog.slice(0, 8)" :key="entry.id" class="world-list-item">
              <div><strong>{{ entry.nextValue }}</strong><span>{{ entry.reason || '来自多轮一致表现' }}</span></div>
              <aside><span v-if="entry.revertedAt" class="world-reverted">已撤销</span><button v-else class="text-link" type="button" @click="revertEvolution(entry)">撤销</button></aside>
            </article>
          </section>

          <div class="proactive-toggle-row followup-toggle-row">
            <div><strong>允许偶尔延迟补一句</strong><span>合适轮次约占 10–20%；你插话后旧补话会取消并重新判断。</span></div>
            <label class="switch-control"><input :checked="chatStore.realismSettings.followupEnabled" type="checkbox" @change="setFollowupEnabled($event.target.checked)" /><span></span></label>
          </div>

          <div class="world-actions">
            <button class="button-secondary-pill" type="button" :disabled="isGeneratingWorldDraft" @click="buildCompanionWorldFromHistory">{{ isGeneratingWorldDraft ? '正在分块分析…' : '根据已有聊天建立她的自我' }}</button>
            <button class="text-link danger-text" type="button" @click="resetCompanionWorld">重置她的世界</button>
          </div>
        </div>
      </div>

      <div v-if="worldDraft" class="store-utility-card world-draft-card">
        <header><div><strong>待确认的世界草案</strong><span>尚未写入聊天数据</span></div><button class="text-link" type="button" @click="worldDraft = null">取消</button></header>
        <button class="world-draft-summary" type="button" @click="editWorldDraftSummary">{{ worldDraft.selfProfile.summary || '点此补充她的自我简介' }}</button>
        <div class="world-profile-grid">
          <button v-for="section in selfProfileSections" :key="section.field" type="button" @click="editWorldDraftList(section)"><strong>{{ section.label }}</strong><span>{{ worldDraft.selfProfile[section.field]?.join('、') || '空' }}</span></button>
        </div>
        <div class="draft-chip-list"><span v-for="character in worldDraft.socialCast" :key="character.id">{{ character.name }} · {{ character.relationship }}<button type="button" aria-label="编辑草案人物" @click="editWorldDraftCharacter(character)">编辑</button><button type="button" aria-label="从草案移除人物" @click="removeWorldDraftCharacter(character.id)">×</button></span></div>
        <div class="draft-event-list"><p v-for="event in worldDraft.virtualEvents" :key="event.id"><span>{{ event.date }} · {{ event.title }}</span><aside><button type="button" @click="editWorldDraftEvent(event)">编辑</button><button type="button" @click="removeWorldDraftEvent(event.id)">移除</button></aside></p></div>
        <button class="button-primary full-width" type="button" @click="confirmWorldDraft">确认并启用草案</button>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">主动联系</h3>
      <div class="store-utility-card chat-proactive-card">
        <div class="proactive-toggle-row">
          <div>
            <strong>让她偶尔主动来找你</strong>
            <span>没有回应时当天不会追问，也不会在刚聊完后打扰。</span>
          </div>
          <label class="switch-control">
            <input v-model="proactiveForm.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>
        <div class="proactive-range-grid">
          <label>
            <span class="caption">每天期望最少 <b>{{ proactiveForm.dailyMin }} 条</b></span>
            <input :value="proactiveForm.dailyMin" type="range" min="0" max="5" step="1" :disabled="!proactiveForm.enabled" @input="setDailyMinimum($event.target.value)" />
          </label>
          <label>
            <span class="caption">每天期望最多 <b>{{ proactiveForm.dailyMax }} 条</b></span>
            <input :value="proactiveForm.dailyMax" type="range" min="0" max="5" step="1" :disabled="!proactiveForm.enabled" @input="setDailyMaximum($event.target.value)" />
          </label>
        </div>
        <p class="caption body-muted proactive-expectation-note">这是期望范围；未回复、刚聊完、安全抑制或通知权限不足时，实际次数可能更少。</p>
        <div class="proactive-time-grid">
          <label>
            <span class="caption">开始时间</span>
            <AppTimeField
              v-model="proactiveForm.activeStart"
              class="proactive-time-field"
              :disabled="!proactiveForm.enabled"
            />
          </label>
          <label>
            <span class="caption">结束时间</span>
            <AppTimeField
              v-model="proactiveForm.activeEnd"
              class="proactive-time-field"
              :disabled="!proactiveForm.enabled"
            />
          </label>
        </div>
        <button
          class="button-primary full-width"
          type="button"
          :disabled="isSavingChatProactive"
          @click="saveChatProactiveSettings"
        >{{ isSavingChatProactive ? '正在安排…' : '保存主动联系设置' }}</button>
        <p class="caption body-muted virtual-role-note">小暖是“温馨小家”中的虚拟女朋友角色。她可以有连续的小情绪和想法，但不会冒充现实真人。</p>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">长期记忆</h3>
      <div class="store-utility-card chat-memory-card">
        <p class="caption body-muted chat-memory-note">可手动补充她要记住的事情。账号、密码、密钥和验证码不会保存。</p>
        <div class="memory-scope-tabs" aria-label="长期记忆归属">
          <button
            v-for="scope in memoryScopeOptions"
            :key="scope.value"
            type="button"
            :class="{ active: memoryScopeFilter === scope.value }"
            @click="memoryScopeFilter = scope.value"
          >
            <strong>{{ scope.label }}</strong>
            <span>{{ scope.description }}</span>
          </button>
        </div>
        <div class="memory-category-grid" aria-label="长期记忆分类">
          <button
            v-for="category in CHAT_MEMORY_CATEGORIES"
            :key="category"
            :class="{ active: newMemoryCategory === category }"
            @click="newMemoryCategory = category"
          >{{ category }}</button>
        </div>
        <div class="taxonomy-add-row">
          <input
            v-model="newMemoryContent"
            class="apple-input"
            maxlength="500"
            placeholder="例如：哥哥不喜欢太甜的咖啡"
            @keyup.enter="addChatMemory"
          />
          <button class="button-primary taxonomy-add-button" @click="addChatMemory">添加</button>
        </div>
        <div v-if="scopedChatMemories.length" class="chat-memory-list">
          <article v-for="memory in pagedChatMemories" :key="memory.id" class="chat-memory-row">
            <div>
              <span class="memory-category">{{ memory.category }}</span>
              <p>{{ memory.content }}</p>
            </div>
            <div class="chat-memory-actions">
              <button class="text-link" @click="editChatMemory(memory)">编辑</button>
              <button class="text-link danger-text" @click="deleteChatMemory(memory)">删除</button>
            </div>
          </article>
          <nav v-if="memoryPageCount > 1" class="chat-memory-pagination" aria-label="长期记忆分页">
            <button
              type="button"
              :disabled="memoryPage <= 1"
              aria-label="上一页"
              @click="memoryPage -= 1"
            >‹</button>
            <span>第 {{ memoryPage }} / {{ memoryPageCount }} 页 · {{ memoryRangeLabel }}</span>
            <button
              type="button"
              :disabled="memoryPage >= memoryPageCount"
              aria-label="下一页"
              @click="memoryPage += 1"
            >›</button>
          </nav>
        </div>
        <p v-else class="caption body-muted taxonomy-empty">这一栏还没有长期记忆。完整对话结束后，她会把真正值得记住的内容放到合适的归属中。</p>
      </div>
    </div>

    <div v-if="settingsScope === 'chat'" class="setting-section">
      <h3 class="caption body-muted section-title">数据清理</h3>
      <div class="ios-list">
        <button class="list-item text-link destructive" style="text-align: left;" @click="clearChatMessages">清空聊天记录</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="clearChatMemories">清空长期记忆</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="resetChatHome">全部重置温馨小家</button>
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
      <h3 class="caption body-muted section-title">外观与主题</h3>
      <div class="store-utility-card theme-settings-card">
        <div class="theme-heading">
          <div>
            <strong class="body-strong">治愈主题色</strong>
            <p class="caption body-muted">主题会同步应用到按钮、卡片、柔光和强调信息。</p>
          </div>
          <span class="theme-live-swatch" aria-hidden="true"></span>
        </div>

        <div class="theme-preset-grid" aria-label="选择主题预设">
          <button
            v-for="preset in themePresets"
            :key="preset.id"
            class="theme-preset"
            :class="{ active: settingsStore.themeSettings.mode === 'preset' && settingsStore.themeSettings.presetId === preset.id }"
            @click="selectThemePreset(preset.id)"
          >
            <span class="theme-preset-color" :style="{ background: preset.primary }"></span>
            <span>{{ preset.name }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 12.5 3 3 6-7" /></svg>
          </button>
          <button
            class="theme-preset theme-custom-trigger"
            :class="{ active: settingsStore.themeSettings.mode === 'custom' }"
            @click="activateCustomTheme"
          >
            <span class="theme-preset-color custom-color-preview"></span>
            <span>自定义</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 12.5 3 3 6-7" /></svg>
          </button>
        </div>

        <div v-if="settingsStore.themeSettings.mode === 'custom'" class="theme-color-picker">
          <div
            ref="themeColorBoardRef"
            class="theme-color-board"
            :style="themeColorBoardStyle"
            @pointerdown="updateThemeColorFromBoard"
            @pointermove.prevent="event => event.buttons && updateThemeColorFromBoard(event)"
          >
            <span class="theme-color-cursor" :style="themeColorCursorStyle"></span>
          </div>
          <input
            v-model.number="themeColorHue"
            class="theme-hue-slider"
            type="range"
            min="0"
            max="359"
            aria-label="主题颜色色相"
            @input="applyThemePickerColor"
          />
          <label class="theme-hex-field">
            <span>HEX</span>
            <input
              :value="settingsStore.themeSettings.customPrimary"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
              @change="updateThemeColorFromHex"
            />
          </label>
        </div>
      </div>

      <h3 class="caption body-muted section-title theme-background-title">环境背景</h3>
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
          <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">完整备份包含省钱、体重、心情、密码库、日程、温馨小家的头像、全部聊天与长期记忆，以及应用设置和 API Key，并由当前主密码进行 AES 加密；不会包含主密码或设备生物识别凭据。仍可选择单项备份。</p>
    </div>

    <!-- AI 情绪陪伴引擎 -->
    <div v-if="settingsScope === 'general'" class="setting-section">
      <h3 class="caption body-muted section-title">🤖 AI 情绪陪伴 (BYOK)</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <p class="caption body-muted" style="margin: 0 0 16px 0;">自备 Key 接入，兼容 DeepSeek / OpenAI / 通义千问等标准 API。使用 AI 时，所选聊天与生活上下文会发送给这里配置的服务商；密码库、主密码、API Key 和其他安全凭据绝不会作为聊天上下文发送。</p>
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
.settings-container { display: flex; min-width: 0; flex-direction: column; gap: 24px; }
.setting-section { display: flex; flex-direction: column; }
.section-title { padding: 0 12px; margin-bottom: 8px; font-weight: 650; letter-spacing: .02em; }
.module-settings-intro {
  display: flex; align-items: center; gap: 14px; padding: 18px;
  border: 1px solid rgba(255,255,255,.82); border-radius: 22px;
  background: linear-gradient(145deg, rgba(236,246,255,.94), rgba(255,255,255,.88));
  box-shadow: 0 10px 30px rgba(35,68,104,.08);
}
.module-settings-intro > span {
  display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 auto;
  border-radius: 16px; background: linear-gradient(145deg, var(--theme-gradient-start), var(--theme-gradient-end));
  color: var(--theme-on-primary); font-size: 24px; box-shadow: 0 8px 18px rgba(var(--theme-primary-strong-rgb),.18);
}
.module-settings-intro > div { flex: 1; min-width: 0; }
.module-settings-intro strong { display: block; color: var(--ink); font-size: 18px; }
.module-settings-intro p {
  margin: 5px 0 0; color: var(--body-muted); font-size: 13px; line-height: 1.45;
  word-break: normal; overflow-wrap: break-word; text-wrap: pretty;
}

.theme-settings-card { padding: 18px; border-color: var(--theme-border); background: linear-gradient(145deg, var(--theme-surface-tint), rgba(255,255,255,.94)); }
.theme-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.theme-heading p { margin: 5px 0 0; line-height: 1.5; }
.theme-live-swatch {
  width: 42px; height: 42px; flex: 0 0 auto; border: 5px solid rgba(255,255,255,.9); border-radius: 15px;
  background: var(--theme-primary); box-shadow: 0 7px 18px rgba(var(--theme-primary-rgb),.25);
}
.theme-preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px; margin-top: 17px; }
.theme-preset {
  display: grid; grid-template-columns: 27px minmax(0,1fr) 17px; align-items: center; gap: 9px;
  min-height: 48px; padding: 8px 10px; border: 1px solid #e5e8ee; border-radius: 15px;
  background: rgba(255,255,255,.76); color: #535b68; text-align: left; font-size: 13px; font-weight: 620;
}
.theme-preset.active { border-color: var(--theme-primary); background: var(--theme-primary-soft); color: var(--primary); box-shadow: 0 7px 18px rgba(var(--theme-primary-rgb),.1); }
.theme-preset-color { width: 27px; height: 27px; border: 3px solid rgba(255,255,255,.9); border-radius: 10px; box-shadow: 0 3px 9px rgba(35,49,70,.14); }
.custom-color-preview { background: conic-gradient(from 25deg, #ff8d9d, #ffc46d, #75cba8, #65a7e7, #9a7bd1, #ff8d9d); }
.theme-custom-trigger.active .custom-color-preview { background: var(--theme-primary); }
.theme-preset svg { width: 17px; fill: none; stroke: transparent; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.theme-preset.active svg { stroke: var(--primary); }
.theme-color-picker { display: grid; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(var(--theme-primary-rgb),.12); }
.theme-color-board { position: relative; height: 128px; border-radius: 16px; box-shadow: inset 0 0 0 1px rgba(22,32,51,.08); touch-action: none; }
.theme-color-cursor {
  position: absolute; width: 21px; height: 21px; border: 3px solid #fff; border-radius: 50%;
  transform: translate(-50%,-50%); box-shadow: 0 2px 8px rgba(0,0,0,.28); pointer-events: none;
}
.theme-hue-slider {
  width: 100%; height: 13px; margin: 0; border: 0; border-radius: 999px; appearance: none;
  background: linear-gradient(to right, #f33, #ff0, #3f3, #3ff, #33f, #f3f, #f33);
}
.theme-hue-slider::-webkit-slider-thumb {
  width: 24px; height: 24px; appearance: none; border: 3px solid #fff; border-radius: 50%;
  background: #fff; box-shadow: 0 2px 9px rgba(0,0,0,.25);
}
.theme-hex-field {
  display: grid; grid-template-columns: 44px 1fr; align-items: center; overflow: hidden;
  border: 1px solid #e1e5ec; border-radius: 14px; background: rgba(255,255,255,.85);
}
.theme-hex-field span { padding-left: 13px; color: #8b929e; font-size: 11px; font-weight: 750; letter-spacing: .08em; }
.theme-hex-field input { min-width: 0; padding: 11px 13px; border: 0; outline: 0; background: transparent; color: var(--ink); font: 650 14px/1.2 ui-monospace, SFMono-Regular, monospace; text-transform: uppercase; }
.theme-background-title { margin-top: 19px; }

.ios-list { background: var(--canvas); border-radius: var(--radius-card); border: 1px solid var(--hairline); overflow: hidden; display: flex; flex-direction: column;}
.list-item { padding: 16px; background: transparent; border: none; border-bottom: 1px solid var(--divider-soft); font-size: 17px; cursor: pointer; color: var(--ink); width: 100%;}
.list-item:last-child { border-bottom: none; }
.list-item:active { background: var(--surface-pearl); }

.text-link.destructive { color: #ff3b30; }
.danger-text { color: #d92d20; }
.input-group { margin-bottom: 12px; }
.store-utility-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-top: 8px; }
.chat-profile-card, .chat-memory-card, .companion-state-card, .chat-proactive-card,
.companion-world-card, .world-draft-card {
  background: linear-gradient(145deg, var(--theme-surface-tint), var(--canvas));
}
.chat-stat-row {
  display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-bottom: 20px;
}
.chat-stat-row > div { padding: 15px; border-radius: 16px; background: rgba(255,255,255,.72); text-align: center; }
.chat-stat-row strong { display: block; color: var(--primary); font-size: 24px; line-height: 1.1; }
.chat-stat-row span { display: block; margin-top: 5px; color: var(--body-muted); font-size: 12px; }
.companion-avatar-setting {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin-bottom: 20px;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: 16px;
  background: rgba(255,255,255,.72);
}
.companion-avatar-preview {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  overflow: hidden;
  border-radius: 18px;
  color: white;
  background: var(--theme-gradient);
  box-shadow: 0 7px 18px rgba(var(--theme-primary-rgb), .2);
  font-size: 28px;
}
.companion-avatar-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.companion-avatar-copy { min-width: 0; }
.companion-avatar-copy strong, .companion-avatar-copy span { display: block; }
.companion-avatar-copy strong { color: var(--ink); font-size: 14px; }
.companion-avatar-copy span { margin-top: 4px; color: var(--body-muted); font-size: 11px; line-height: 1.45; }
.avatar-upload-button, .avatar-clear-button {
  border: 1px solid var(--theme-border);
  border-radius: 999px;
  color: var(--primary);
  background: var(--theme-soft);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.avatar-upload-button { min-height: 36px; padding: 0 13px; font-weight: 650; }
.avatar-upload-button:disabled { opacity: .5; }
.avatar-clear-button {
  grid-column: 2 / 4;
  justify-self: start;
  padding: 5px 10px;
  border-color: transparent;
  background: transparent;
}
.chat-name-field { display: block; margin-bottom: 18px; }
.chat-name-field span { display: block; margin-bottom: 8px; }
.chat-settings-section .full-width { width: 100%; }
.companion-state-heading {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 13px;
}
.companion-state-heading div { min-width: 0; }
.companion-state-heading span {
  display: inline-block; margin-bottom: 5px; padding: 4px 8px; border-radius: 999px;
  color: var(--primary); background: var(--theme-primary-soft); font-size: 11px; font-weight: 700;
}
.companion-state-heading strong { display: block; font-size: 18px; }
.companion-state-heading em { flex: 0 0 auto; color: var(--body-muted); font-size: 11px; font-style: normal; }
.companion-state-card > p { margin: 0 0 9px; color: var(--ink); font-size: 14px; line-height: 1.6; }
.companion-state-card > p.companion-virtual-moment { color: var(--body-muted); font-size: 12px; }
.open-loop-summary {
  display: grid; gap: 6px; margin: 14px 0; padding: 12px; border-radius: 14px;
  color: var(--body-muted); background: rgba(255,255,255,.7);
}
.open-loop-summary strong { color: var(--primary); font-size: 11px; }
.open-loop-summary span { font-size: 12px; line-height: 1.45; }
.companion-world-card { padding: 0; overflow: hidden; }
.world-disclosure-button {
  display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 12px;
  padding: 18px; border: 0; color: var(--ink); background: transparent; font: inherit; text-align: left;
}
.world-disclosure-button > span { min-width: 0; }
.world-disclosure-button strong, .world-disclosure-button small { display: block; overflow-wrap: anywhere; }
.world-disclosure-button strong { font-size: 15px; line-height: 1.45; }
.world-disclosure-button small { margin-top: 5px; color: var(--body-muted); font-size: 11px; }
.world-disclosure-button > b { flex: 0 0 auto; color: var(--primary); font-size: 23px; transition: transform .2s; }
.world-disclosure-button > b.expanded { transform: rotate(180deg); }
.world-content { display: grid; gap: 12px; padding: 0 18px 18px; }
.world-block { min-width: 0; padding: 14px; border: 1px solid var(--hairline); border-radius: 15px; background: rgba(255,255,255,.68); }
.world-block > header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.world-block > header strong { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.world-block > header small { color: var(--body-muted); font-size: 10px; text-align: right; }
.world-block button, .world-actions button { font: inherit; }
.world-summary, .world-empty { margin: 0; color: var(--body-muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.world-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 11px; }
.world-profile-grid > button {
  min-width: 0; min-height: 70px; padding: 10px; border: 1px solid var(--hairline); border-radius: 12px;
  color: var(--ink); background: rgba(255,255,255,.78); font: inherit; text-align: left;
}
.world-profile-grid strong, .world-profile-grid span { display: block; }
.world-profile-grid strong { color: var(--primary); font-size: 11px; }
.world-profile-grid span { margin-top: 5px; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.world-list-item { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--divider-soft); }
.world-list-item:first-of-type { border-top: 0; }
.world-list-item > div { min-width: 0; }
.world-list-item strong, .world-list-item span, .world-list-item small { display: block; overflow-wrap: anywhere; }
.world-list-item strong { font-size: 12px; }
.world-list-item span { margin-top: 4px; color: var(--body-muted); font-size: 11px; line-height: 1.45; }
.world-list-item small { margin-top: 4px; color: var(--body-muted); font-size: 9px; }
.world-list-item aside { display: flex; flex: 0 0 auto; gap: 7px; }
.world-list-item aside button { padding: 2px; border: 0; background: transparent; }
.world-reverted { color: var(--body-muted); font-size: 10px; }
.followup-toggle-row { margin: 0; border: 1px solid var(--hairline); }
.world-actions { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; }
.world-actions .button-secondary-pill { min-width: 0; white-space: normal; }
.world-actions .text-link { flex: 0 0 auto; border: 0; background: transparent; }
.world-draft-card { margin-top: 10px; }
.world-draft-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.world-draft-card > header div { min-width: 0; }
.world-draft-card > header strong, .world-draft-card > header span { display: block; }
.world-draft-card > header strong { font-size: 15px; }
.world-draft-card > header span { margin-top: 4px; color: var(--body-muted); font-size: 10px; }
.world-draft-summary { width: 100%; margin-top: 13px; padding: 12px; border: 1px solid var(--hairline); border-radius: 13px; color: var(--ink); background: rgba(255,255,255,.75); font: inherit; font-size: 12px; line-height: 1.55; text-align: left; overflow-wrap: anywhere; }
.draft-chip-list { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.draft-chip-list > span { display: inline-flex; max-width: 100%; align-items: center; gap: 5px; padding: 6px 9px; border-radius: 999px; color: var(--primary); background: var(--theme-primary-soft); font-size: 10px; overflow-wrap: anywhere; }
.draft-chip-list button, .draft-event-list button { border: 0; color: inherit; background: transparent; font: inherit; }
.draft-event-list { margin: 11px 0; }
.draft-event-list p { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin: 0; padding: 8px 0; border-top: 1px solid var(--divider-soft); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.draft-event-list p > span { min-width: 0; overflow-wrap: anywhere; }
.draft-event-list aside { display: flex; flex: 0 0 auto; gap: 4px; }
.draft-event-list button { flex: 0 0 auto; color: var(--primary); }
.draft-event-list button:last-child { color: #d92d20; }
.world-draft-card .full-width { width: 100%; }
.companion-state-card .full-width, .chat-proactive-card .full-width { width: 100%; margin-top: 13px; }
.proactive-toggle-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 52px; align-items: center; gap: 12px;
  margin-bottom: 16px; padding: 13px; border-radius: 15px; background: rgba(255,255,255,.72);
}
.proactive-toggle-row > div { min-width: 0; }
.proactive-toggle-row > .switch-control {
  justify-self: end;
  margin-right: -13px;
}
.proactive-toggle-row > div strong, .proactive-toggle-row > div span { display: block; }
.proactive-toggle-row > div strong { font-size: 14px; }
.proactive-toggle-row > div span { margin-top: 4px; color: var(--body-muted); font-size: 11px; line-height: 1.45; }
.chat-proactive-card .input-group > span, .proactive-time-grid label > span {
  display: block; margin-bottom: 7px;
}
.chat-proactive-card select { width: 100%; appearance: auto; }
.proactive-range-grid { display: grid; gap: 13px; margin-bottom: 12px; }
.proactive-range-grid label { min-width: 0; }
.proactive-range-grid .caption { display: flex; justify-content: space-between; gap: 8px; }
.proactive-range-grid .caption b { color: var(--primary); font-weight: 700; }
.proactive-range-grid input { width: 100%; margin: 8px 0 0; accent-color: var(--primary); }
.proactive-range-grid input:disabled { opacity: .45; }
.proactive-expectation-note { margin: -2px 0 13px; line-height: 1.5; }
.proactive-time-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.proactive-time-grid label { min-width: 0; }
:global(.proactive-time-field) {
  width: 100%; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 14px;
  color: var(--ink); background: rgba(255,255,255,.82); box-sizing: border-box;
}
.virtual-role-note { margin: 13px 0 0; line-height: 1.55; }
.chat-memory-note { margin: 0 0 14px; line-height: 1.55; }
.memory-scope-tabs {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-bottom: 14px;
}
.memory-scope-tabs button {
  min-width: 0; padding: 9px 5px; border: 1px solid var(--hairline); border-radius: 13px;
  color: var(--body-muted); background: rgba(255,255,255,.72); font: inherit;
}
.memory-scope-tabs strong, .memory-scope-tabs span { display: block; }
.memory-scope-tabs strong { font-size: 13px; }
.memory-scope-tabs span { margin-top: 3px; overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.memory-scope-tabs button.active {
  border-color: var(--theme-primary); color: var(--primary); background: var(--theme-primary-soft);
}
.memory-category-grid { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 13px; }
.memory-category-grid button {
  min-height: 34px; padding: 0 13px; border: 1px solid var(--hairline); border-radius: 999px;
  background: rgba(255,255,255,.78); color: var(--body-muted); font: inherit; font-size: 13px;
}
.memory-category-grid button.active { border-color: var(--theme-primary); background: var(--theme-primary-soft); color: var(--primary); font-weight: 650; }
.chat-memory-list { display: grid; gap: 9px; margin-top: 12px; }
.chat-memory-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 13px; border: 1px solid var(--hairline); border-radius: 14px; background: rgba(255,255,255,.72);
}
.chat-memory-row > div:first-child { min-width: 0; }
.chat-memory-row p { margin: 6px 0 0; color: var(--ink); font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.memory-category { color: var(--primary); font-size: 11px; font-weight: 720; }
.chat-memory-actions { display: flex; flex: 0 0 auto; gap: 9px; }
.chat-memory-actions button { padding: 2px; border: 0; background: transparent; }
.chat-memory-pagination {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 38px;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}
.chat-memory-pagination button {
  width: 38px;
  height: 36px;
  border: 1px solid var(--theme-border);
  border-radius: 12px;
  color: var(--primary);
  background: var(--theme-soft);
  font: inherit;
  font-size: 24px;
  line-height: 1;
}
.chat-memory-pagination button:disabled { opacity: .35; }
.chat-memory-pagination span { color: var(--body-muted); font-size: 11px; text-align: center; }
.health-setting-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
.health-setting-grid .input-group span, .threshold-field span { display: block; margin-bottom: 8px; }
.health-reminder-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 4px 0 16px; padding: 15px; border-radius: 15px; background: var(--surface-pearl); }
.health-reminder-toggle strong, .health-reminder-toggle small { display: block; }
.health-reminder-toggle strong { font-size: 15px; }
.health-reminder-toggle small { margin-top: 4px; color: var(--body-muted); font-size: 11px; line-height: 1.4; }
.health-reminder-toggle .switch-control i { position: absolute; inset: 2px; border-radius: 999px; background: #d1d1d6; transition: background .2s; pointer-events: none; }
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
.switch-control { position: relative; display: block; width: 52px; height: 32px; margin: 0; align-self: center; justify-self: center; }
.switch-control input { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.switch-control span { position: absolute; inset: 2px; border-radius: 999px; background: #d1d1d6; transition: background .2s; pointer-events: none; }
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
  .settings-container { gap: 18px; }
  .module-settings-intro { gap: 11px; padding: 15px; border-radius: 19px; }
  .module-settings-intro > span { width: 44px; height: 44px; border-radius: 14px; font-size: 21px; }
  .module-settings-intro strong { font-size: 17px; }
  .module-settings-intro p { margin-top: 3px; font-size: 12px; line-height: 1.45; }
  .chat-settings-section .store-utility-card,
  .chat-memory-card,
  .companion-state-card,
  .chat-proactive-card,
  .world-draft-card { padding: 18px; }
  .companion-world-card { padding: 0; }
  .world-actions { align-items: stretch; flex-direction: column; }
  .world-actions .text-link { align-self: center; }
  .chat-stat-row { margin-bottom: 16px; }
  .chat-memory-note { font-size: 12px; line-height: 1.5; }
  .memory-category-grid button { min-height: 32px; padding-inline: 12px; font-size: 12px; }
  .chat-memory-card .taxonomy-add-row { display: grid; grid-template-columns: 1fr; gap: 9px; }
  .chat-memory-card .taxonomy-add-button { width: 100%; min-height: 44px; }
  .reminder-row { gap: 8px; }
  .reminder-time { width: 82px; font-size: 14px; }
  .health-setting-grid { grid-template-columns: 1fr; gap: 0; }
  .chat-memory-row { flex-direction: column; }
  .chat-memory-actions { align-self: flex-end; }
}
</style>
