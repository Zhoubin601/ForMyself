const DEFAULT_NATIVE_ACTIVITY_TTL_MS = 5 * 60 * 1000

let guardedUntil = 0

export function beginNativeActivityGuard(
  now = Date.now(),
  ttlMs = DEFAULT_NATIVE_ACTIVITY_TTL_MS
) {
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0
    ? ttlMs
    : DEFAULT_NATIVE_ACTIVITY_TTL_MS
  guardedUntil = safeNow + safeTtl
}

export function isNativeActivityGuardActive(now = Date.now()) {
  return Number.isFinite(now) && guardedUntil > now
}

export function consumeNativeActivityGuard(now = Date.now()) {
  const active = isNativeActivityGuardActive(now)
  guardedUntil = 0
  return active
}

export function resetNativeActivityGuard() {
  guardedUntil = 0
}
