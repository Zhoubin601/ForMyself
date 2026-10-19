export const DEFAULT_BACKGROUND_EFFECT = Object.freeze({ blur: 20, fade: 20 })

const percentage = value => {
  if (value === null || value === '' || typeof value === 'boolean') return 20
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number))) : 20
}

export function normalizeBackgroundEffect(value = {}) {
  return { blur: percentage(value?.blur), fade: percentage(value?.fade) }
}

export function normalizeBackgroundEffects(value = {}) {
  return {
    lock: normalizeBackgroundEffect(value?.lock),
    pages: normalizeBackgroundEffect(value?.pages)
  }
}

export function backgroundEffectStyle(value) {
  const effect = normalizeBackgroundEffect(value)
  const filter = `blur(${effect.blur * 0.4}px)`
  return {
    backgroundColor: `rgba(245, 245, 247, ${effect.fade / 100})`,
    backdropFilter: filter,
    WebkitBackdropFilter: filter
  }
}
