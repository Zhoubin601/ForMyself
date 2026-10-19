export const DEFAULT_COMPONENT_TRANSPARENCY = 40

export function normalizeComponentTransparency(value) {
  if (value == null || value === '' || typeof value === 'boolean') return DEFAULT_COMPONENT_TRANSPARENCY
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number))) : DEFAULT_COMPONENT_TRANSPARENCY
}

export function buildComponentCssVariables(value) {
  return { '--component-opacity': String((100 - normalizeComponentTransparency(value)) / 100) }
}

export async function decodeBackground(source) {
  if (!source || typeof Image === 'undefined') return
  const image = new Image()
  image.src = source
  await image.decode()
}
