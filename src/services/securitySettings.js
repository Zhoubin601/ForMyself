export function normalizeSecuritySettings(value = {}) {
  return { requireAppUnlock: value?.requireAppUnlock !== false }
}
