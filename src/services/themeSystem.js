export const THEME_PRESETS = Object.freeze({
  cloud: Object.freeze({ id: 'cloud', name: '云朵蓝', primary: '#4A8FD8' }),
  peach: Object.freeze({ id: 'peach', name: '蜜桃粉', primary: '#E4778F' }),
  mint: Object.freeze({ id: 'mint', name: '薄荷绿', primary: '#479B84' }),
  lavender: Object.freeze({ id: 'lavender', name: '晚霞紫', primary: '#8878C4' })
})

export const DEFAULT_THEME_SETTINGS = Object.freeze({
  mode: 'preset',
  presetId: 'cloud',
  customPrimary: THEME_PRESETS.cloud.primary
})

const clamp = (value, min = 0, max = 255) => Math.min(max, Math.max(min, value))

export function normalizeHexColor(value, fallback = THEME_PRESETS.cloud.primary) {
  const input = String(value || '').trim()
  const shortMatch = input.match(/^#([0-9a-f]{3})$/i)
  if (shortMatch) {
    const [red, green, blue] = shortMatch[1].split('')
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase()
  }
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toUpperCase()
  return String(fallback || THEME_PRESETS.cloud.primary).toUpperCase()
}

export function hexToRgb(value) {
  const hex = normalizeHexColor(value)
  return {
    red: parseInt(hex.slice(1, 3), 16),
    green: parseInt(hex.slice(3, 5), 16),
    blue: parseInt(hex.slice(5, 7), 16)
  }
}

const rgbToHex = ({ red, green, blue }) => `#${[red, green, blue]
  .map(channel => Math.round(clamp(channel)).toString(16).padStart(2, '0'))
  .join('')
  .toUpperCase()}`

export function mixHex(first, second, secondWeight = 0.5) {
  const weight = Math.min(1, Math.max(0, Number(secondWeight) || 0))
  const a = hexToRgb(first)
  const b = hexToRgb(second)
  return rgbToHex({
    red: a.red * (1 - weight) + b.red * weight,
    green: a.green * (1 - weight) + b.green * weight,
    blue: a.blue * (1 - weight) + b.blue * weight
  })
}

const linearChannel = value => {
  const channel = value / 255
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(value) {
  const { red, green, blue } = hexToRgb(value)
  return (0.2126 * linearChannel(red)) +
    (0.7152 * linearChannel(green)) +
    (0.0722 * linearChannel(blue))
}

export function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function ensureWhiteTextContrast(value, minimum = 4.5) {
  const color = normalizeHexColor(value)
  if (contrastRatio(color, '#FFFFFF') >= minimum) return color
  for (let step = 1; step <= 12; step += 1) {
    const candidate = mixHex(color, '#000000', step * 0.055)
    if (contrastRatio(candidate, '#FFFFFF') >= minimum) return candidate
  }
  return '#31526F'
}

export function normalizeThemeSettings(value = {}) {
  const presetId = Object.hasOwn(THEME_PRESETS, value?.presetId)
    ? value.presetId
    : DEFAULT_THEME_SETTINGS.presetId
  return {
    mode: value?.mode === 'custom' ? 'custom' : 'preset',
    presetId,
    customPrimary: normalizeHexColor(value?.customPrimary, THEME_PRESETS[presetId].primary)
  }
}

export function getThemePrimary(value = {}) {
  const normalized = normalizeThemeSettings(value)
  return normalized.mode === 'custom'
    ? normalized.customPrimary
    : THEME_PRESETS[normalized.presetId].primary
}

export function buildThemeCssVariables(value = {}) {
  const primary = getThemePrimary(value)
  const strong = ensureWhiteTextContrast(primary)
  const primaryRgb = hexToRgb(primary)
  const strongRgb = hexToRgb(strong)
  const soft = mixHex(primary, '#FFFFFF', 0.86)
  const surface = mixHex(primary, '#FFFFFF', 0.94)
  const gradientStart = mixHex(strong, '#FFFFFF', 0.08)
  const gradientEnd = mixHex(strong, '#000000', 0.12)
  return {
    '--theme-primary': primary,
    '--theme-primary-rgb': `${primaryRgb.red}, ${primaryRgb.green}, ${primaryRgb.blue}`,
    '--theme-primary-strong': strong,
    '--theme-primary-strong-rgb': `${strongRgb.red}, ${strongRgb.green}, ${strongRgb.blue}`,
    '--theme-on-primary': '#FFFFFF',
    '--theme-primary-soft': soft,
    '--theme-primary-soft-strong': mixHex(primary, '#FFFFFF', 0.72),
    '--theme-surface-tint': surface,
    '--theme-border': mixHex(primary, '#FFFFFF', 0.78),
    '--theme-gradient-start': gradientStart,
    '--theme-gradient-end': gradientEnd,
    '--theme-soft': soft,
    '--theme-surface': surface,
    '--theme-gradient': `linear-gradient(145deg, ${gradientStart}, ${gradientEnd})`,
    '--primary': strong,
    '--primary-focus': mixHex(strong, '#000000', 0.1)
  }
}
