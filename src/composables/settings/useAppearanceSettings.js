import { computed, ref, watch } from 'vue'
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

  return {
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
    moduleHealthForm,
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
    localBanner,
    saveBannerSettings,
    triggerBgUpload,
    handleBgUpload,
    clearBg
  }
}
