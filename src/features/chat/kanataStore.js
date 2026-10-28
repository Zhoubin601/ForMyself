// @ts-check
import { computed, readonly, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { assertOrdinaryWriteAllowed } from '../../platform/storage/restoreState.js'
import { createEmptyKanataData } from './domain/kanataCore.js'
import { instantiateWorldPreset } from './domain/presetCore.js'
import { isKanataInitializationAllowed } from './domain/initializationGate.js'
import { validateKanataData } from './domain/kanataValidation.js'
import { createKanataRepository } from './storage/kanataRepository.js'

/** @typedef {import('./domain/kanataTypes').KanataData} KanataData */
/** @typedef {ReturnType<typeof createKanataRepository>} KanataRepository */
const failure = (code) => Object.assign(new Error(code), { code })
const safeErrorCode = (error, fallback) => (
  typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code) ? error.code : fallback
)

/**
 * Session-owned plaintext facade. The repository retains only ciphertext between operations.
 * Initialization is an internal composition capability; production must supply a guard backed by
 * the protected cleanup coordinator, never a page-only flag.
 * @param {KanataRepository} repository
 * @param {string} [id]
 * @param {{ userId?: string, canInitialize?: () => boolean }} [options]
 */
export function createKanataStore(repository, id = 'kanata', { userId = 'user-local', canInitialize = () => false } = {}) {
  return defineStore(id, () => {
    /** @type {import('vue').ShallowRef<KanataData | null>} */
    const data = shallowRef(null)
    const isDataLoaded = ref(false)
    const loadStatus = ref('idle')
    const loadError = ref('')
    const saveStatus = ref('saved')
    const saveError = ref('')
    const hasPendingSave = ref(false)
    const needsInitialization = ref(false)
    const recoveredFromBackup = ref(false)
    const snapshot = computed(() => data.value === null ? null : readonly(data.value))
    let password = ''
    let revision = 0
    let persistenceSuspended = false
    let reencrypting = false
    let reencryptRecoveryRequired = false
    let writeError = ''
    let activeWrites = 0
    /** @type {Promise<boolean> | null} */
    let loading = null
    let releasing = Promise.resolve()

    const syncPersistence = () => {
      const state = repository.getState()
      hasPendingSave.value = state.hasPendingSave || activeWrites > 0
      saveError.value = state.saveError || writeError || (reencryptRecoveryRequired ? 'KANATA_REENCRYPT_RECOVERY_REQUIRED' : '')
      saveStatus.value = saveError.value ? 'error' : hasPendingSave.value ? 'saving' : 'saved'
    }
    const assertLoaded = () => {
      if (!isDataLoaded.value || data.value === null || !password) throw failure('KANATA_NOT_LOADED')
    }
    const assertReady = () => {
      assertLoaded()
      assertOrdinaryWriteAllowed()
      if (persistenceSuspended) throw failure('KANATA_PERSISTENCE_SUSPENDED')
      if (reencrypting) throw failure('KANATA_REENCRYPT_IN_PROGRESS')
      if (reencryptRecoveryRequired) throw failure('KANATA_REENCRYPT_RECOVERY_REQUIRED')
    }
    /** @param {KanataData} value */
    const commitDraft = value => {
      data.value = value
      needsInitialization.value = value.worlds.length === 0
    }
    /** Encrypt before any asynchronous wait; never capture the password in deferred work.
     * @param {KanataData} value
     */
    const persist = value => {
      activeWrites += 1
      hasPendingSave.value = true
      saveStatus.value = 'saving'
      let task
      try { task = repository.write(value, password) }
      catch (error) { task = Promise.reject(error) }
      return Promise.resolve(task).then(() => {
        writeError = ''
      }).catch(error => {
        writeError = safeErrorCode(error, 'KANATA_SAVE_FAILED')
        saveError.value = writeError
        throw error
      }).finally(() => {
        activeWrites -= 1
        syncPersistence()
        if (saveError.value) saveStatus.value = 'error'
      })
    }

    /** Successful read+validation only; a missing namespace is not permission to seed or write.
     * @param {string} nextPassword
     * @returns {Promise<boolean>}
     */
    const load = nextPassword => {
      if (loading) return loading
      const session = ++revision
      isDataLoaded.value = false
      loadStatus.value = 'loading'
      loadError.value = ''
      const task = (async () => {
        try {
          if (typeof nextPassword !== 'string' || !nextPassword) throw failure('KANATA_PASSWORD_REQUIRED')
          await releasing
          // A reload must never replace an unsaved latest draft with older disk content.
          const persistence = repository.getState()
          if (persistence.loaded && !reencryptRecoveryRequired && (persistence.hasPendingSave || writeError)) {
            if (writeError && !persistence.hasPendingSave && data.value && password) await persist(validateKanataData(data.value))
            await repository.flush()
          }
          if (session !== revision) return false
          const result = await repository.read(nextPassword)
          if (session !== revision) return false
          const value = result.status === 'missing'
            ? createEmptyKanataData(userId)
            : validateKanataData(result.data)
          password = nextPassword
          commitDraft(value)
          recoveredFromBackup.value = result.recovered
          persistenceSuspended = false
          reencryptRecoveryRequired = false
          writeError = ''
          isDataLoaded.value = true
          loadStatus.value = 'ready'
          syncPersistence()
          return true
        } catch (error) {
          if (session !== revision) return false
          password = ''
          isDataLoaded.value = false
          loadStatus.value = 'error'
          loadError.value = safeErrorCode(error, 'KANATA_READ_FAILED')
          syncPersistence()
          return false
        }
      })()
      loading = task
      task.finally(() => { if (loading === task) loading = null }).catch(() => {})
      return task
    }

    /** All ordinary mutation goes through a detached, validated draft.
     * @param {(draft: KanataData) => void} change
     * @returns {Promise<KanataData>}
     */
    const update = async change => {
      assertReady()
      if (needsInitialization.value) throw failure('KANATA_INITIALIZATION_REQUIRED')
      if (typeof change !== 'function') throw failure('KANATA_MUTATOR_REQUIRED')
      const draft = validateKanataData(data.value)
      const outcome = /** @type {unknown} */(change(draft))
      if (outcome && typeof outcome === 'object' && 'then' in outcome) {
        // A rejected async callback must not become an unhandled rejection after we refuse it.
        void Promise.resolve(outcome).catch(() => {})
        throw failure('KANATA_ASYNC_MUTATOR')
      }
      const value = validateKanataData(draft)
      commitDraft(value)
      await persist(value)
      return validateKanataData(value)
    }
    /** Only the protected cleanup runtime may authorize the first seed.
     * @param {import('./domain/kanataTypes').WorldPreset} preset
     * @param {import('./domain/kanataTypes').SeedOptions} seedOptions
     * @returns {Promise<KanataData>}
     */
    const initializePreset = async (preset, seedOptions) => {
      assertReady()
      if (canInitialize() !== true) throw failure('KANATA_CLEANUP_REQUIRED')
      const value = instantiateWorldPreset(/** @type {KanataData} */(data.value), preset, seedOptions)
      // Re-entering after a saved initialization must not schedule another whole-file write.
      if (JSON.stringify(value) === JSON.stringify(data.value) && !needsInitialization.value) {
        await flush()
        return value
      }
      commitDraft(value)
      await persist(value)
      return validateKanataData(value)
    }

    /** Internal only: actual full-backup coordinator supplies its lease and write barrier.
     * Ordinary callers must use update(), not a recovering flag.
     * @param {unknown} input
     */
    const restoreSnapshot = async input => {
      assertLoaded()
      if (persistenceSuspended) throw failure('KANATA_PERSISTENCE_SUSPENDED')
      if (reencrypting) throw failure('KANATA_REENCRYPT_IN_PROGRESS')
      if (reencryptRecoveryRequired) throw failure('KANATA_REENCRYPT_RECOVERY_REQUIRED')
      const value = validateKanataData(input)
      commitDraft(value)
      await persist(value)
      return validateKanataData(value)
    }

    const flush = async () => {
      assertLoaded()
      if (persistenceSuspended) throw failure('KANATA_PERSISTENCE_SUSPENDED')
      if (reencryptRecoveryRequired) throw failure('KANATA_REENCRYPT_RECOVERY_REQUIRED')
      try {
        if (writeError && !repository.getState().hasPendingSave) await persist(validateKanataData(data.value))
        await repository.flush()
        writeError = ''
      }
      catch (error) {
        syncPersistence()
        saveError.value ||= safeErrorCode(error, 'KANATA_SAVE_FAILED')
        saveStatus.value = 'error'
        throw error
      }
      syncPersistence()
    }
    const release = () => {
      const unqueuedSaveFailure = Boolean(writeError && !repository.getState().hasPendingSave)
      revision += 1
      loading = null
      password = ''
      data.value = null
      isDataLoaded.value = false
      loadStatus.value = 'idle'
      loadError.value = ''
      needsInitialization.value = false
      recoveredFromBackup.value = false
      // release() invalidates a repository read before returning its awaitable work.
      const task = repository.release().then(() => {
        if (unqueuedSaveFailure) throw failure('KANATA_PENDING_SAVE')
      })
      releasing = task.catch(() => {})
      return task.finally(syncPersistence)
    }
    /** This internal capability intentionally permits compensation after an earlier failed reencrypt.
     * @param {string} nextPassword
     */
    const reencrypt = async nextPassword => {
      assertLoaded()
      if (persistenceSuspended) throw failure('KANATA_PERSISTENCE_SUSPENDED')
      if (reencrypting) throw failure('KANATA_REENCRYPT_IN_PROGRESS')
      if (typeof nextPassword !== 'string' || !nextPassword) throw failure('KANATA_PASSWORD_REQUIRED')
      const session = revision
      reencrypting = true
      saveStatus.value = 'saving'
      try {
        await repository.reencrypt(validateKanataData(data.value), nextPassword)
        if (session === revision) {
          password = nextPassword
          reencryptRecoveryRequired = false
          writeError = ''
        }
      } catch (error) {
        if (session === revision) reencryptRecoveryRequired = true
        throw error
      } finally {
        reencrypting = false
        syncPersistence()
      }
    }
    const suspendPersistence = () => {
      persistenceSuspended = true
      loadError.value = 'KANATA_PERSISTENCE_SUSPENDED'
    }

    return {
      snapshot, isDataLoaded, loadStatus, loadError, saveStatus, saveError, hasPendingSave,
      needsInitialization, recoveredFromBackup,
      load, loadChatData: load, initializePreset, update, restoreSnapshot, restoreChatData: restoreSnapshot,
      flush, retrySave: flush, release, reencrypt, suspendPersistence
    }
  })
}

export const useKanataStore = createKanataStore(createKanataRepository(), 'kanata', { canInitialize: isKanataInitializationAllowed })
