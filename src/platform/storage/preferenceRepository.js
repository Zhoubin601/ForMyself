// @ts-check
import { preferenceStorage } from './preferences.js'

// A narrow, injectable legacy-format repository. Storage keys remain stable across driver changes.
/**
 * @param {readonly string[]} keys
 * @param {import('../../application/contracts').PreferenceDriver} [driver]
 * @returns {import('../../application/contracts').PreferenceRepository}
 */
export function createPreferenceRepository(keys, driver = preferenceStorage) {
  const allowed = new Set(keys)
  const check = (/** @type {string} */ key) => { if (!allowed.has(key)) throw new Error('UNKNOWN_REPOSITORY_KEY') }
  return Object.freeze({
    async get(/** @type {{key: string}} */ options) { check(options.key); return driver.get(options) },
    async set(/** @type {{key: string, value: string}} */ options) { check(options.key); return driver.set(options) },
    async remove(/** @type {{key: string}} */ options) { check(options.key); if (!driver.remove) throw new Error('REMOVE_NOT_SUPPORTED'); return driver.remove(options) },
    async flush() { if (driver.flush) await driver.flush() }
  })
}
