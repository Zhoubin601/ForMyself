export const AUTO_LOCK_DISABLED = -1

export function normalizeAutoLockDelay(value) {
  const parsed = Number(value)
  return [-1, 0, 60, 300, 600].includes(parsed) ? parsed : 0
}

export function shouldLockOnBackground(delaySeconds) {
  return normalizeAutoLockDelay(delaySeconds) === 0
}

export function shouldLockOnResume(delaySeconds, backgroundedAt, resumedAt = Date.now()) {
  const delay = normalizeAutoLockDelay(delaySeconds)
  if (delay === AUTO_LOCK_DISABLED || delay === 0) return false
  if (!Number.isFinite(backgroundedAt) || !Number.isFinite(resumedAt)) return false
  if (resumedAt < backgroundedAt) return false
  return resumedAt - backgroundedAt >= delay * 1000
}
