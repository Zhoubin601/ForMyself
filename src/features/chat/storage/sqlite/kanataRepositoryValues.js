// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'

/** @param {unknown} condition @param {string} code */
export function requireSqliteValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code })
}

/** @param {unknown} value @param {number} [minimum] */
export const safeInteger = (value, minimum = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
/** @param {unknown} value */
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
/** @param {unknown} value */
export const nonemptyText = value => typeof value === 'string' && value.trim().length > 0

/** @param {import('./kanataRepositoryTypes').KanataMessageScope} scope */
export function scopeBindings(scope) {
  validateId(scope?.worldId, 'worldId')
  validateId(scope?.conversationId, 'conversationId')
  return [scope.worldId, scope.conversationId]
}

/** @param {number} value */
export function pageLimit(value) {
  requireSqliteValue(safeInteger(value, 1) && value <= 50, 'KANATA_MESSAGE_LIMIT_INVALID')
  return value
}

/** @param {import('./kanataSchemaTypes').KanataSqlValue} value */
export function extensionObject(value) {
  try {
    const parsed = JSON.parse(String(value))
    requireSqliteValue(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'KANATA_SQLITE_INTEGRITY_FAILED')
    return cloneKanataJson(parsed)
  } catch {
    throw new Error('KANATA_SQLITE_INTEGRITY_FAILED')
  }
}

/** Canonical comparison for idempotency only. Audit JSON retains the original representation.
 * @param {unknown} left @param {unknown} right @returns {boolean} */
export function equalDto(left, right) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = /** @type {Record<string, unknown>} */ (left)
  const b = /** @type {Record<string, unknown>} */ (right)
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalDto(a[key], b[key]))
}
