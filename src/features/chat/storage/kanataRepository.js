import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { encryptPassphraseAes, decryptPassphraseAes } from '../../../shared/crypto/passphraseAes.js'
import { sha256Text } from '../../../shared/crypto/sha256Text.js'
import { preferenceStorage } from '../../../platform/storage/preferences.js'
import { assertKanataData } from '../domain/kanataValidation.js'
import { createMessageArchiveRepository } from './messageArchiveRepository.js'

export const KANATA_DATA_DIRECTORY = 'formyself'
export const KANATA_DATA_PATH = KANATA_DATA_DIRECTORY + '/kanata-v1.enc'
export const KANATA_TEMP_PATH = KANATA_DATA_DIRECTORY + '/kanata-v1.tmp'
export const KANATA_BACKUP_PATH = KANATA_DATA_DIRECTORY + '/kanata-v1.bak'
export const KANATA_RECOVERY_KEY = 'my_kanata_recovery_encrypted_v1'
const PATHS = Object.freeze([KANATA_DATA_PATH, KANATA_BACKUP_PATH, KANATA_TEMP_PATH])
const fingerprintOf = value => value ? sha256Text(value) : ''
const missing = error => error?.code !== undefined
  ? ['ENOENT', 'OS-PLUG-FILE-0008'].includes(error.code)
  : ['File does not exist.', 'Entry does not exist.'].includes(error?.message)
const alreadyExists = error => error?.code !== undefined
  ? ['EEXIST', 'OS-PLUG-FILE-0010'].includes(error.code)
  : error?.message === 'Current directory does already exist.' || /^(?:Directory|File).*(?:already exists|exists)/i.test(String(error?.message || ''))

export class KanataRepositoryError extends Error {
  constructor(code, failureCodes = []) {
    super(code); this.name = 'KanataRepositoryError'; this.code = code
    this.failureCodes = [...failureCodes]
  }
}
const errorCode = error => typeof error?.code === 'string' ? error.code : 'KANATA_DRIVER_FAILED'
const problem = (code, failures = []) => new KanataRepositoryError(code, failures)

/** Same CryptoJS passphrase AES wire protocol as the existing app, with a distinct validated payload. */
/** @param {import('../domain/kanataTypes').KanataData} value @param {string} password */
export function encryptKanataData(value, password) {
  if (typeof password !== 'string' || !password) throw problem('KANATA_PASSWORD_REQUIRED')
  // Synchronous serialization does not retain or return the input. Validate every field/reference
  // without allocating another full header; ordinary Store mutations still own detached drafts.
  const data = assertKanataData(value)
  return encryptPassphraseAes(JSON.stringify(data), password)
}
/** @param {string} ciphertext @param {string} password @returns {import('../domain/kanataTypes').KanataData} */
export function decryptKanataData(ciphertext, password) {
  if (typeof password !== 'string' || !password) throw problem('KANATA_PASSWORD_REQUIRED')
  let plaintext
  try { plaintext = decryptPassphraseAes(ciphertext, password) }
  catch { throw problem('KANATA_DECRYPT_FAILED') }
  if (!plaintext) throw problem('KANATA_DECRYPT_FAILED')
  let value
  try { value = JSON.parse(plaintext) } catch { throw problem('KANATA_DATA_CORRUPTED') }
  // Preserve the domain's future-version/shape codes. Never try a legacy normalizer.
  // JSON.parse already created a private inert graph; do not clone it before returning ownership.
  return assertKanataData(value)
}

/**
 * No plaintext or password is held by this repository. Callers own session/write leases.
 * read() is read-only; pending encrypted work wins over older disk data.
 * @param {{filesystem?: import('./kanataRepositoryTypes').KanataFilesystem, journal?: import('./kanataRepositoryTypes').KanataJournal, directory?: string}} [options]
 */
export function createKanataRepository({ filesystem = Filesystem, journal = preferenceStorage, directory = Directory.Data } = {}) {
  const archives = createMessageArchiveRepository({ filesystem, directory })
  let loaded = false, loadError = '', saveError = '', fingerprint = '', recoveryAvailable = false, reencrypting = false, loadRevision = 0
  let pending = null
  /** @type {Promise<void>} */
  let chain = Promise.resolve()
  const state = () => ({ loaded, loadError, saveError, hasPendingSave: Boolean(pending), recoveryAvailable })
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  const enqueue = operation => {
    const task = chain.catch(() => {}).then(operation)
    // The serialization tail must never retain a fulfilled read's plaintext graph.
    // Only the caller receives its result; queue bookkeeping retains an empty settlement.
    chain = task.then(() => undefined, () => undefined)
    return task
  }
  const fileOptions = path => ({ path, directory, encoding: Encoding.UTF8 })
  const exists = async path => {
    try { await filesystem.stat({ path, directory }); return true }
    catch (error) { if (missing(error)) return false; throw problem('KANATA_FILE_READ_FAILED', [errorCode(error)]) }
  }
  const readEncrypted = async path => {
    try {
      const result = await filesystem.readFile(fileOptions(path))
      if (typeof result.data !== 'string' || !result.data) throw problem('KANATA_EMPTY_CIPHERTEXT')
      return result.data
    } catch (error) {
      if (error instanceof KanataRepositoryError) throw error
      throw problem('KANATA_FILE_READ_FAILED', [errorCode(error)])
    }
  }
  const removeIfPresent = async path => {
    if (await exists(path)) await filesystem.deleteFile({ path, directory })
  }
  const writeVerified = async (path, ciphertext) => {
    await filesystem.writeFile({ ...fileOptions(path), data: ciphertext })
    if (await readEncrypted(path) !== ciphertext) throw problem('KANATA_FILE_VERIFY_FAILED')
  }
  const saveEncrypted = async ciphertext => {
    try { await filesystem.mkdir({ path: KANATA_DATA_DIRECTORY, directory, recursive: true }) }
    catch (error) { if (!alreadyExists(error)) throw error }
    await writeVerified(KANATA_TEMP_PATH, ciphertext)
    const hadPrimary = await exists(KANATA_DATA_PATH)
    if (hadPrimary) {
      await removeIfPresent(KANATA_BACKUP_PATH)
      await filesystem.rename({ from: KANATA_DATA_PATH, to: KANATA_BACKUP_PATH, directory, toDirectory: directory })
    }
    try {
      await filesystem.rename({ from: KANATA_TEMP_PATH, to: KANATA_DATA_PATH, directory, toDirectory: directory })
      if (await readEncrypted(KANATA_DATA_PATH) !== ciphertext) throw problem('KANATA_FILE_VERIFY_FAILED')
    } catch (error) {
      // Never discard a backup if rollback fails. A later read reports the actual available copy.
      if (hadPrimary && await exists(KANATA_BACKUP_PATH) && !await exists(KANATA_DATA_PATH)) {
        try { await filesystem.rename({ from: KANATA_BACKUP_PATH, to: KANATA_DATA_PATH, directory, toDirectory: directory }) }
        catch { throw problem('KANATA_FILE_ROLLBACK_FAILED', [errorCode(error)]) }
      }
      throw error
    }
    fingerprint = fingerprintOf(ciphertext)
  }
  const readRecovery = async () => {
    let result
    try { result = await journal.get({ key: KANATA_RECOVERY_KEY }) }
    catch (error) { throw problem('KANATA_RECOVERY_READ_FAILED', [errorCode(error)]) }
    if (result.value === null) return null
    if (typeof result.value !== 'string') throw problem('KANATA_RECOVERY_CORRUPTED')
    let record
    try { record = JSON.parse(result.value) } catch { throw problem('KANATA_RECOVERY_CORRUPTED') }
    if (record?.type !== 'kanata-recovery') throw problem('KANATA_RECOVERY_CORRUPTED')
    if (record.version !== 1) throw problem('UNSUPPORTED_KANATA_RECOVERY_VERSION')
    if (typeof record.ciphertext !== 'string' || !record.ciphertext || typeof record.baseFingerprint !== 'string' ||
      !/^(?:[a-f0-9]{64})?$/.test(record.baseFingerprint)) throw problem('KANATA_RECOVERY_CORRUPTED')
    if (record.reencrypt !== undefined && typeof record.reencrypt !== 'boolean') throw problem('KANATA_RECOVERY_CORRUPTED')
    return { type: 'kanata-recovery', version: 1, ciphertext: record.ciphertext, baseFingerprint: record.baseFingerprint, reencrypt: record.reencrypt === true }
  }
  const persistLatest = async () => {
    if (!pending) return
    const candidate = pending
    candidate.baseFingerprint = fingerprint
    let journalFailure = ''
    recoveryAvailable = false
    try {
      const value = JSON.stringify(candidate)
      await journal.set({ key: KANATA_RECOVERY_KEY, value })
      if ((await journal.get({ key: KANATA_RECOVERY_KEY })).value !== value) throw problem('KANATA_RECOVERY_VERIFY_FAILED')
      recoveryAvailable = true
    } catch (error) { journalFailure = errorCode(error) }
    try {
      await saveEncrypted(candidate.ciphertext)
      if (candidate.reencrypt) await writeVerified(KANATA_BACKUP_PATH, candidate.ciphertext)
    }
    catch (error) {
      saveError = 'KANATA_SAVE_FAILED'
      throw problem(saveError, [errorCode(error), ...(journalFailure ? [journalFailure] : [])])
    }
    if (pending === candidate) pending = null
    else if (pending) pending.baseFingerprint = fingerprint
    // Failed removal cannot make an older record override this newer verified primary.
    try { await journal.remove({ key: KANATA_RECOVERY_KEY }); recoveryAvailable = false } catch { /* stale encrypted recovery remains */ }
    if (!pending) saveError = ''
  }
  const queueCiphertext = ciphertext => {
    pending = { type: 'kanata-recovery', version: 1, baseFingerprint: fingerprint, ciphertext, reencrypt: false }
    return enqueue(persistLatest)
  }
  /** @param {string} password @returns {Promise<import('./kanataRepositoryTypes').KanataReadResult>} */
  const read = password => {
    const revision = ++loadRevision
    loaded = false; loadError = ''
    if (typeof password !== 'string' || !password) { loadError = 'KANATA_PASSWORD_REQUIRED'; return Promise.reject(problem(loadError)) }
    const assertCurrent = () => { if (revision !== loadRevision) throw problem('KANATA_READ_CANCELLED') }
    return enqueue(async () => {
    try {
      const inMemory = pending
      const record = inMemory || await readRecovery()
      let primaryFingerprint = '', selected = null
      const failures = []
      for (const path of PATHS) {
        if (!await exists(path)) continue
        let ciphertext
        try { ciphertext = await readEncrypted(path) }
        catch (error) {
          // A permission/read-driver failure is not permission to initialize or fall back silently.
          if (error.code !== 'KANATA_EMPTY_CIPHERTEXT') throw error
          failures.push(error.code); continue
        }
        if (path === KANATA_DATA_PATH) primaryFingerprint = fingerprintOf(ciphertext)
        try {
          const data = decryptKanataData(ciphertext, password)
          selected = { data, ciphertext, path }
          break
        } catch (error) {
          if (['UNSUPPORTED_KANATA_VERSION','UNSUPPORTED_KANATA_ARCHIVE_VERSION','KANATA_PASSWORD_REQUIRED'].includes(error.code)) throw error
          failures.push(errorCode(error))
        }
      }
      assertCurrent()
      const primaryValid = selected?.path === KANATA_DATA_PATH
      fingerprint = primaryFingerprint
      if (record && (inMemory || !primaryValid || record.baseFingerprint === primaryFingerprint || fingerprintOf(record.ciphertext) === primaryFingerprint)) {
        const data = decryptKanataData(record.ciphertext, password)
        if (fingerprintOf(record.ciphertext) === primaryFingerprint && primaryValid && !record.reencrypt) {
          pending = null; recoveryAvailable = true; saveError = ''
          loaded = true
          return { status: 'ready', data, fingerprint, recovered: false }
        }
        pending = record; saveError = 'KANATA_PENDING_RECOVERY'; recoveryAvailable = !inMemory || recoveryAvailable
        loaded = true
        return { status: 'recovered', data, fingerprint, recovered: true }
      }
      // A stale journal is ignored read-only, not deleted or replayed onto a newer primary.
      if (selected) {
        loaded = true; saveError = ''
        return { status: primaryValid ? 'ready' : 'recovered', data: selected.data, fingerprint, recovered: !primaryValid }
      }
      if (failures.length) throw problem(failures.length === 1 ? failures[0] : 'KANATA_ALL_COPIES_INVALID', failures)
      loaded = true
      return { status: 'missing', data: null, fingerprint: '', recovered: false }
    } catch (error) {
      if (revision === loadRevision) loadError = errorCode(error)
      throw error instanceof KanataRepositoryError || error?.code ? error : problem('KANATA_READ_FAILED')
    }
    })
  }
  /** @param {import('../domain/kanataTypes').KanataData} value @param {string} password */
  const write = (value, password) => {
    if (!loaded) return Promise.reject(problem('KANATA_NOT_LOADED'))
    if (reencrypting) return Promise.reject(problem('KANATA_REENCRYPT_IN_PROGRESS'))
    // Validation/encryption is synchronous. Only ciphertext is captured by asynchronous work.
    return queueCiphertext(encryptKanataData(value, password))
  }
  const retry = () => {
    if (!loaded || loadError) return Promise.reject(problem('KANATA_NOT_LOADED'))
    return enqueue(persistLatest)
  }
  const flush = async () => {
    await chain.catch(() => {})
    if (!loaded || loadError) throw problem('KANATA_NOT_LOADED')
    if (pending) await retry()
    if (pending || saveError) throw problem(saveError || 'KANATA_PENDING_SAVE')
  }
  const scheduleReencrypt = ciphertext => {
    reencrypting = true
    const task = enqueue(async () => {
      await persistLatest()
      pending = { type: 'kanata-recovery', version: 1, baseFingerprint: fingerprint, ciphertext, reencrypt: true }
      await persistLatest()
    })
    task.finally(() => { reencrypting = false }).catch(() => {})
    return task
  }
  /** @param {import('../domain/kanataTypes').KanataData} value @param {string} password */
  const reencrypt = (value, password) => {
    if (!loaded) return Promise.reject(problem('KANATA_NOT_LOADED'))
    if (reencrypting) return Promise.reject(problem('KANATA_REENCRYPT_IN_PROGRESS'))
    return scheduleReencrypt(encryptKanataData(value, password))
  }
  const release = async () => {
    // No password/plaintext was retained. Outstanding authorized ciphertext writes may finish.
    ++loadRevision; loaded = false
    await chain.catch(() => {})
    if (pending) throw problem('KANATA_PENDING_SAVE')
  }
  return { read, write, retry, flush, reencrypt, release, archives,
    retireArchives: (/** @type {string[]} */ keepKeys) => archives.retireExcept(keepKeys), wait: () => chain.catch(() => {}), getState: state }
}
