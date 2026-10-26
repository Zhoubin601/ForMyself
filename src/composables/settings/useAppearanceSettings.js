import { clampColorValue, hsvToHex, hexToHsv } from '../../services/colorPicker.js'
import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'
import { THEME_PRESETS, getThemePrimary, normalizeHexColor } from '../../services/themeSystem'
import { backgroundEffectStyle, DEFAULT_BACKGROUND_EFFECT } from '../../services/backgroundSettings.js'
import { DEFAULT_COMPONENT_TRANSPARENCY, normalizeComponentTransparency } from '../../services/componentAppearance.js'
import { beginNativeActivityGuard } from '../../services/nativeActivityGuard.js'

export function useAppearanceSettings() {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  const bgInputRef = ref(null)
  const backgroundScope = ref('pages')
  const isUploadingBackground = ref(false)
  const pendingBackground = ref('')
  const isSavingBackground = ref(false)
  const isSavingWarmHome = ref(false)
  const backgroundEffect = computed(() => settingsStore.backgroundEffects[backgroundScope.value])
  const backgroundPreviewEffect = computed(() => backgroundEffectStyle(backgroundEffect.value))
  const updateComponentTransparency = value => {
    settingsStore.componentTransparency = normalizeComponentTransparency(value)
  }
  const saveComponentTransparency = async () => {
    try {
      await nextTick()
      await settingsStore.flushPendingSettingsWrites()
    } catch {
      appToast('组件透明度保存失败，请重试', { tone: 'danger' })
    }
  }
  const resetComponentTransparency = async () => {
    updateComponentTransparency(DEFAULT_COMPONENT_TRANSPARENCY)
    await saveComponentTransparency()
  }
  const updateBackgroundEffect = (key, value) => {
    settingsStore.backgroundEffects = {
      ...settingsStore.backgroundEffects,
      [backgroundScope.value]: { ...backgroundEffect.value, [key]: Number(value) }
    }
  }
  const saveBackgroundEffects = async () => {
    try {
      await nextTick()
      await settingsStore.flushPendingSettingsWrites()
    } catch {
      appToast('背景效果保存失败，请重试', { tone: 'danger' })
    }
  }
  const resetBackgroundEffects = async () => {
    settingsStore.backgroundEffects = {
      ...settingsStore.backgroundEffects,
      [backgroundScope.value]: { ...DEFAULT_BACKGROUND_EFFECT }
    }
    await saveBackgroundEffects()
  }
  const toggleWarmHome = async event => {
    if (isSavingWarmHome.value) return
    isSavingWarmHome.value = true
    try {
      await settingsStore.updateWarmHomeEnabled(event.target.checked)
    } catch {
      appToast('温馨小家开关保存失败，请重试', { tone: 'danger' })
    } finally {
      event.target.checked = settingsStore.warmHomeEnabled
      isSavingWarmHome.value = false
    }
  }

  const newScheduleCategoryColor = ref('#4fd5d7')
  const scheduleColorHue = ref(181)
  const scheduleColorSaturation = ref(64)
  const scheduleColorValue = ref(84)
  const scheduleColorBoardRef = ref(null)
  const themePresets = Object.values(THEME_PRESETS)
  const themeColorHue = ref(210)
  const themeColorSaturation = ref(66)
  const themeColorValue = ref(85)
  const themeColorBoardRef = ref(null)

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

  const triggerBgUpload = () => {
    beginNativeActivityGuard()
    bgInputRef.value.click()
  }
  const handleBgUpload = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isUploadingBackground.value) return
    if (file.size > 5 * 1024 * 1024) return appAlert('请使用 5MB 以内的图像文件')
    if (!file.type.startsWith('image/')) return appAlert('请选择可用的图片文件')
    isUploadingBackground.value = true
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'))
        reader.onabort = () => reject(new Error('IMAGE_READ_ABORTED'))
        reader.readAsDataURL(file)
      })
      await new Promise((resolve, reject) => {
        const picture = new Image()
        picture.onload = resolve
        picture.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
        picture.src = dataUrl
      })
      pendingBackground.value = dataUrl
    } catch {
      appToast('图片无法读取或保存，请换一张图片重试', { tone: 'danger' })
    } finally {
      isUploadingBackground.value = false
    }
  }
  const cancelBackgroundCrop = () => {
    if (!isSavingBackground.value) pendingBackground.value = ''
  }
  const confirmBackgroundCrop = async dataUrl => {
    if (!pendingBackground.value || isSavingBackground.value) return
    isSavingBackground.value = true
    try {
      await settingsStore.updateBg(dataUrl)
      pendingBackground.value = ''
      appToast('背景图片已更新', { tone: 'success' })
    } catch {
      appToast('背景保存失败，请重试，原壁纸已保留', { tone: 'danger' })
    } finally {
      isSavingBackground.value = false
    }
  }
  const clearBg = async () => {
    if (await appConfirm('当前自定义壁纸将被移除。', { title: '恢复默认背景？' })) {
      try {
        await settingsStore.updateBg('')
        appToast('已恢复默认背景', { tone: 'success' })
      } catch {
        appToast('背景恢复失败，请重试', { tone: 'danger' })
      }
    }
  }

  return {
    pendingBackground,
    isSavingBackground,
    cancelBackgroundCrop,
    confirmBackgroundCrop,
    updateComponentTransparency,
    saveComponentTransparency,
    resetComponentTransparency,
    backgroundScope,
    backgroundEffect,
    backgroundPreviewEffect,
    isUploadingBackground,
    isSavingWarmHome,
    updateBackgroundEffect,
    saveBackgroundEffects,
    resetBackgroundEffects,
    toggleWarmHome,
    appAlert,
    appConfirm,
    appToast,
    THEME_PRESETS,
    getThemePrimary,
    normalizeHexColor,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    bgInputRef,
    newScheduleCategoryColor,
    scheduleColorHue,
    scheduleColorSaturation,
    scheduleColorValue,
    scheduleColorBoardRef,
    themePresets,
    themeColorHue,
    themeColorSaturation,
    themeColorValue,
    themeColorBoardRef,
    clampColorValue,
    hsvToHex,
    hexToHsv,
    applySchedulePickerColor,
    updateScheduleColorFromBoard,
    updateScheduleColorFromHex,
    scheduleColorBoardStyle,
    scheduleColorCursorStyle,
    syncThemePickerFromSettings,
    selectThemePreset,
    activateCustomTheme,
    applyThemePickerColor,
    updateThemeColorFromBoard,
    updateThemeColorFromHex,
    themeColorBoardStyle,
    themeColorCursorStyle,
    triggerBgUpload,
    handleBgUpload,
    clearBg
  }
}
