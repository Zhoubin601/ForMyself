// @ts-check
import { computed, readonly, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { assertOrdinaryWriteAllowed } from '../../platform/storage/restoreState.js'
import { createEmptyKanataData } from './domain/kanataCore.js'
import { instantiateWorldPreset } from './domain/presetCore.js'
import { isKanataInitializationAllowed } from './domain/initializationGate.js'
import { validateKanataData, assertKanataData } from './domain/kanataValidation.js'
import { createKanataRepository } from './storage/kanataRepository.js'
import { createMessageArchiveRepository } from './storage/messageArchiveRepository.js'
import { planMessageArchive, messageOrder } from './storage/messageArchiveCore.js'
import {mapInBatches} from '../../shared/async/mapInBatches.js'
import {kanataRestoreDraft} from './domain/kanataOwnedImage.js'

/** @typedef {import('./domain/kanataTypes').KanataData} KanataData */
/** @typedef {ReturnType<typeof createKanataRepository>} KanataRepository */
/** @param {string} code */
const failure = (code) => Object.assign(new Error(code), { code })
/** @param {unknown} error @param {string} fallback */
const safeErrorCode = (error, fallback) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : fallback
}

/**
 * Session-owned plaintext facade. The repository retains only ciphertext between operations.
 * Initialization is an internal composition capability; production must supply a guard backed by
 * the protected cleanup coordinator, never a page-only flag.
 * @param {KanataRepository} repository
 * @param {string} [id]
 * @param {{ userId?: string, canInitialize?: () => boolean, archives?: ReturnType<typeof createMessageArchiveRepository> }} [options]
 */
export function createKanataStore(repository, id = 'kanata', { userId = 'user-local', canInitialize = () => false, archives = repository.archives ?? createMessageArchiveRepository() } = {}) {
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
    let archiveBusy = false
    let dataGeneration = 0
    const archiveError = ref('')
    /** @type {KanataData | null} */
    let preparedBackup = null
    /** @type {import('./domain/kanataTypes').MessageArchiveDescriptor[]} */
    let retiredArchives = []
    /** @type {Promise<boolean> | null} */
    let loading = null
    let releasing = Promise.resolve()
    /** @param {unknown} error */
    const noteArchiveFailure = error => {
      const code = safeErrorCode(error, 'KANATA_ARCHIVE_READ_FAILED')
      if (['KANATA_ARCHIVE_READ_FAILED','KANATA_ARCHIVE_VERIFY_FAILED','KANATA_ARCHIVE_DECRYPT_FAILED','KANATA_ARCHIVE_INDEX_MISMATCH','KANATA_ARCHIVE_INVALID','UNSUPPORTED_KANATA_ARCHIVE_VERSION'].includes(code)) archiveError.value = code
    }

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
      if (archiveBusy) throw failure('KANATA_ARCHIVE_BUSY')
      if (archiveError.value) throw failure(archiveError.value)
    }
    /** @param {KanataData} value */
    const commitDraft = value => {
      data.value = value
      ++dataGeneration
      preparedBackup = null
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
          await archives.inspectAll(value.messageArchives ?? [])
          if (session !== revision) return false
          password = nextPassword
          commitDraft(value)
          recoveredFromBackup.value = result.recovered
          persistenceSuspended = false
          reencryptRecoveryRequired = false
          writeError = ''
          archiveError.value = ''
          isDataLoaded.value = true
          loadStatus.value = 'ready'
          syncPersistence()
          return true
        } catch (error) {
          if (session !== revision) return false
          password = ''
          data.value = null
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
      if (archiveBusy) throw failure('KANATA_ARCHIVE_BUSY')
      const value = kanataRestoreDraft(input)
      if (value.messageArchives?.length) throw failure('KANATA_ARCHIVE_BACKUP_NOT_HYDRATED')
      const owner=revision,captured=data.value
      const assertCurrent=()=>{assertLoaded();if(owner!==revision||captured!==data.value)throw failure('KANATA_ARCHIVE_SESSION_CHANGED')}
      archiveBusy=true
      try {
        // Large portable imports enter bounded files directly. Never encrypt a second giant monolith first.
        const counts=new Map()
        for(const message of value.messages)counts.set(message.conversationId,(counts.get(message.conversationId)||0)+1)
        for(const conversation of value.conversations)if((counts.get(conversation.id)||0)>1000){
          const scope={worldId:conversation.worldId,conversationId:conversation.id}
          const plan=planMessageArchive(value,{...scope,keepRecent:200})
          const pages=await mapInBatches(plan.pages,messages=>archives.write(messages,password,scope,assertCurrent))
          value.messages=plan.remaining
          if(pages.length){value.messageArchives=[...(value.messageArchives??[]),...pages];value.version=2}
        }
        assertCurrent()
        // `value` is the detached import draft. Page planning/writes do not share caller objects.
        const packed=assertKanataData(value)
        // Old files remain encrypted until successful rekey retires them. No deletion on restore.
        retiredArchives.push(...(captured?.messageArchives ?? []))
        commitDraft(packed)
        await persist(packed)
        archiveError.value = ''
        return validateKanataData(packed)
      } finally {archiveBusy=false}
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
      preparedBackup = null
      archiveError.value = ''
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
      if (archiveBusy) throw failure('KANATA_ARCHIVE_BUSY')
      if (typeof nextPassword !== 'string' || !nextPassword) throw failure('KANATA_PASSWORD_REQUIRED')
      const session = revision
      reencrypting = true
      saveStatus.value = 'saving'
      try {
        const captured = data.value
        const previousPages = [...(captured?.messageArchives ?? []), ...retiredArchives]
        const assertCurrent = () => {
          assertLoaded()
          if (session !== revision || captured !== data.value) throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
        }
        const value = validateKanataData(captured)
        // Copy-on-write page rekey: retain all old files until both canonical copies reference verified new pages.
        const nextPages = await mapInBatches(value.messageArchives ?? [],page=>archives.reencrypt(page,password,nextPassword,page,assertCurrent))
        if (value.messageArchives) value.messageArchives = nextPages
        assertCurrent()
        await repository.reencrypt(value, nextPassword)
        if (session === revision) {
          commitDraft(value)
          password = nextPassword
          retiredArchives = previousPages
          await archives.retire(retiredArchives)
          // Also retire verified-unreferenced files left by an interrupted conversion or an older restore.
          await repository.retireArchives?.(nextPages.map(page=>page.key))
          retiredArchives = []
          reencryptRecoveryRequired = false
          writeError = ''
        } else throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
      } catch (error) {
        if (session === revision) reencryptRecoveryRequired = true
        throw error
      } finally {
        reencrypting = false
        syncPersistence()
      }
    }
    const hydrateSnapshot = async () => {
      assertLoaded()
      const owner = revision, captured = data.value
      const assertCurrent = () => {
        assertLoaded()
        if (owner !== revision || captured !== data.value) throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
      }
      const value = validateKanataData(captured)
      try {
        const pages=await mapInBatches(value.messageArchives ?? [],descriptor=>archives.read(descriptor,password,descriptor,assertCurrent))
        for(const messages of pages)value.messages.push(...messages)
      } catch (error) { if(owner===revision)noteArchiveFailure(error);throw error }
      value.messages.sort(messageOrder)
      delete value.messageArchives
      value.version = 1
      assertCurrent()
      // The header was privately cloned, and read() returns detached verified page DTOs.
      return assertKanataData(value)
    }
    const prepareBackup = async () => {
      assertLoaded()
      if (!data.value?.messageArchives?.length) { preparedBackup = null; return }
      const owner = revision, captured = data.value
      const result = await hydrateSnapshot()
      assertLoaded()
      if (owner !== revision || captured !== data.value) throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
      preparedBackup = result
    }
    const backupSnapshot = () => {
      assertLoaded()
      if (data.value?.messageArchives?.length && !preparedBackup) throw failure('KANATA_ARCHIVE_BACKUP_NOT_PREPARED')
      // Transfer ownership of the private prepared image, never of the live Store graph.
      const result = preparedBackup ? assertKanataData(preparedBackup) : validateKanataData(data.value)
      preparedBackup = null
      return result
    }
    /** Explicit conversion, protected by the same Store gates as every mutation.
     * @param {{worldId:string,conversationId:string,keepRecent?:number}} options
     */
    const archiveHistory = async options => {
      assertReady()
      if (needsInitialization.value) throw failure('KANATA_INITIALIZATION_REQUIRED')
      await flush()
      assertReady()
      const captured = data.value, owner = revision
      const assertCurrent = () => {
        assertLoaded()
        if (owner !== revision || captured !== data.value) throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
        assertOrdinaryWriteAllowed()
        if (persistenceSuspended) throw failure('KANATA_PERSISTENCE_SUSPENDED')
      }
      const draft = validateKanataData(captured), plan = planMessageArchive(draft, options)
      if (draft.worlds.find(w=>w.id===options.worldId)?.archived) throw failure('KANATA_WORLD_ARCHIVED')
      if (!plan.archivedCount) return { archivedCount: 0, pages: 0 }
      archiveBusy = true
      try {
        const pages=await mapInBatches(plan.pages,messages=>archives.write(messages,password,options,assertCurrent))
        assertCurrent()
        draft.messages = plan.remaining
        draft.messageArchives = [...(draft.messageArchives ?? []), ...pages]
        draft.version = 2
        const value = validateKanataData(draft)
        commitDraft(value)
        await persist(value)
        return { archivedCount: plan.archivedCount, pages: pages.length }
      } finally { archiveBusy = false }
    }
    /** No unrequested historical bodies enter the snapshot or a retained cache.
     * @param {import('./domain/kanataTypes').MessageHistoryRequest} request
     */
    const readHistory = async request => {
      assertReady()
      const captured = data.value, owner = revision, generation = dataGeneration
      if (!captured?.conversations.some(c => c.id === request.conversationId && c.worldId === request.worldId)) throw failure('KANATA_ARCHIVE_SCOPE_DENIED')
      const text = request.text ?? '', cursor = request.cursor
      if (cursor && (cursor.worldId !== request.worldId || cursor.conversationId !== request.conversationId || cursor.text !== text || cursor.generation !== generation)) throw failure('KANATA_ARCHIVE_CURSOR_EXPIRED')
      const assertCurrent = () => {
        assertReady()
        if (owner !== revision || captured !== data.value) throw failure('KANATA_ARCHIVE_SESSION_CHANGED')
      }
      try {
        const result = await archives.query(captured.messageArchives ?? [], captured.messages, password, { ...request, text, before: cursor?.before ?? null }, assertCurrent)
        const last = result.messages.at(-1)
        return { ...result, cursor: result.hasMore && last ? { worldId:request.worldId, conversationId:request.conversationId, text, generation, before:{id:last.id,createdAt:last.createdAt} } : null }
      } catch (error) {
        if (owner === revision) noteArchiveFailure(error)
        throw error
      }
    }
    /** Restore one complete archive page to the active graph before a revision/deletion.
     * The old encrypted file stays available to the previous canonical backup.
     * @param {{worldId:string,conversationId:string,messageId:string}} request
     */
    const activateHistoryMessage = async request => {
      assertReady()
      const captured = data.value, owner = revision
      if (!captured?.worlds.some(w=>w.id===request.worldId&&!w.archived)) throw failure('KANATA_ARCHIVE_SCOPE_DENIED')
      const page=captured.messageArchives?.find(p=>p.worldId===request.worldId&&p.conversationId===request.conversationId&&p.messages.some(m=>m.id===request.messageId))
      if (!page) {
        if (!captured.messages.some(m=>m.id===request.messageId&&m.worldId===request.worldId&&m.conversationId===request.conversationId)) throw failure('KANATA_ARCHIVE_SCOPE_DENIED')
        return
      }
      const assertCurrent=()=>{assertReady();if(owner!==revision||captured!==data.value)throw failure('KANATA_ARCHIVE_SESSION_CHANGED')}
      let messages
      try { messages=await archives.read(page,password,request,assertCurrent) }
      catch (error) {if(owner===revision)noteArchiveFailure(error);throw error}
      assertCurrent()
      const draft=validateKanataData(captured)
      draft.messages.push(...messages);draft.messages.sort(messageOrder)
      draft.messageArchives=draft.messageArchives?.filter(p=>p.key!==page.key)
      if (!draft.messageArchives?.length) {delete draft.messageArchives;draft.version=1}
      const value=validateKanataData(draft)
      retiredArchives.push(page)
      commitDraft(value)
      await persist(value)
    }
    const suspendPersistence = () => {
      persistenceSuspended = true
      loadError.value = 'KANATA_PERSISTENCE_SUSPENDED'
    }

    return {
      snapshot, isDataLoaded, loadStatus, loadError, saveStatus, saveError, hasPendingSave,
      needsInitialization, recoveredFromBackup, archiveError,
      load, loadChatData: load, initializePreset, update, restoreSnapshot, restoreChatData: restoreSnapshot,
      flush, retrySave: flush, release, reencrypt, suspendPersistence,
      archiveHistory, readHistory, activateHistoryMessage, prepareBackup, backupSnapshot
    }
  })
}

export const useKanataStore = createKanataStore(createKanataRepository(), 'kanata', { canInitialize: isKanataInitializationAllowed })
