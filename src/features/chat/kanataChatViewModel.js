// @ts-check
import { shallowRef, watch } from 'vue'
import { useKanataMessageWindow } from './useKanataMessageWindow.js'

/** @typedef {ReturnType<typeof import('../../application/kanataSqliteCandidate.js').createKanataSqliteCandidate>} Candidate */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {{scope:Scope,assertOwner():void}} Request */
/** @typedef {NonNullable<Awaited<ReturnType<Candidate['loadConversationView']>>>} Overview */

/** @param {{
 * revision:import('vue').Ref<number>, owner:(conversationId:string)=>Request, read:Candidate['withRepositories'],
 * load:Candidate['loadConversationView'], readMembers:Candidate['readConversationMembers'],
 * readUsage:(request:Request, cursor?:{startedAt:number,id:string})=>ReturnType<import('./storage/sqlite/kanataDomainTypes').KanataSqliteDomains['usage']['forConversation']>
 * }} options */
export function createKanataChatViewModel({ revision, owner, read, load, readMembers, readUsage }) {
  const window = useKanataMessageWindow({ owner, read })
  const overview = shallowRef(/** @type {Overview|null} */ (null))
  const error = shallowRef('')
  const loading = shallowRef(false)
  const membersLoading = shallowRef(false)
  const usage = shallowRef(/** @type {Awaited<ReturnType<typeof readUsage>>|null} */ (null))
  const usageLoading = shallowRef(false)
  const usageError = shallowRef(false)
  let usageGeneration = 0
  function clearUsage() {
    usageGeneration++
    usage.value = null
    usageLoading.value = usageError.value = false
  }
  /** @type {Request|null} */
  let request = null

  function reset() {
    request = null
    overview.value = null
    error.value = ''
    loading.value = membersLoading.value = false
    window.reset()
    clearUsage()
  }
  const stopInvalidation = watch(revision, reset, { flush: 'sync' })
  /** @param {Request} target */
  function isCurrent(target) {
    if (target !== request) return false
    try { target.assertOwner(); return true } catch { return false }
  }
  /** @param {string} conversationId */
  async function open(conversationId) {
    reset()
    const target = owner(conversationId)
    request = target
    loading.value = true
    try {
      const result = await load({ ...target.scope, assertOwner: target.assertOwner })
      if (!isCurrent(target)) return
      if (!result) { error.value = 'CONVERSATION_UNAVAILABLE'; return }
      overview.value = result
      await window.activate(conversationId)
    } catch {
      if (isCurrent(target)) error.value = 'CONVERSATION_LOAD_FAILED'
    } finally {
      if (request === target) loading.value = false
    }
  }
  /** @param {number} cursor */
  async function loadMembers(cursor) {
    const target = request
    if (!target || membersLoading.value || !overview.value) return
    membersLoading.value = true
    error.value = ''
    try {
      const members = await readMembers({ ...target.scope, assertOwner: target.assertOwner }, cursor)
      if (isCurrent(target) && overview.value) overview.value = { ...overview.value, members }
    } catch {
      if (isCurrent(target)) error.value = 'MEMBER_LOAD_FAILED'
    } finally {
      if (request === target) membersLoading.value = false
    }
  }
  /** @param {{startedAt:number,id:string}} [cursor] */
  async function loadUsage(cursor) {
    const target = request
    if (!target || usageLoading.value || !overview.value) return
    const generation = usageGeneration
    usageLoading.value = true
    usageError.value = false
    const assertOwner = () => {
      target.assertOwner()
      if (generation !== usageGeneration) throw new Error('KANATA_SQLITE_SESSION_CHANGED')
    }
    try {
      const result = await readUsage({ scope: target.scope, assertOwner }, cursor)
      if (isCurrent(target) && generation === usageGeneration) usage.value = result
    } catch {
      if (isCurrent(target) && generation === usageGeneration) usageError.value = true
    } finally {
      if (generation === usageGeneration) usageLoading.value = false
    }
  }
  /** @param {Overview['conversation']} conversation */
  function publishConversation(conversation) {
    if (request && isCurrent(request) && overview.value?.conversation.id === conversation.id) {
      overview.value = { ...overview.value, conversation }
    }
  }
  return { window, overview, error, loading, membersLoading, open, reset, loadMembers, publishConversation, usage, usageError, usageLoading, loadUsage, clearUsage, dispose() { stopInvalidation(); reset() } }
}
