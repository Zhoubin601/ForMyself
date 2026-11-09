// @ts-check
import { computed, shallowRef } from 'vue'

/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageCursor} Cursor */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessagePage} Page */
/** @typedef {import('./domain/kanataTypes').Message} Message */
/** @typedef {Pick<Message, 'id'|'content'|'senderNameSnapshot'|'revision'>} Quote */
/** @typedef {import('./storage/sqlite/kanataRepositoryTypes').KanataMessageRepository} Repository */
/** @typedef {{scope:Scope, assertOwner():void}} Request */

/** @param {{owner: (conversationId:string) => Request,
 * read:<T>(request:Request, work:(repository:Repository)=>Promise<T>)=>Promise<T>}} options */
export function useKanataMessageWindow({ owner, read }) {
  const messages = shallowRef(/** @type {readonly Message[]} */ ([]))
  const cursor = shallowRef(/** @type {Cursor|null} */ (null))
  const error = shallowRef('')
  const loading = shallowRef(false)
  const ready = shallowRef(false)
  const browsing = shallowRef(false)
  const newMessages = shallowRef(false)
  const quote = shallowRef(/** @type {Quote|null} */ (null))
  /** @type {Request|null} */
  let request = null
  let generation = 0
  let quoteGeneration = 0

  function reset() {
    generation++
    quoteGeneration++
    request = null
    messages.value = []
    cursor.value = null
    error.value = ''
    loading.value = ready.value = browsing.value = newMessages.value = false
    quote.value = null
  }

  /** @param {Request} target @param {number} version */
  function current(target, version) {
    if (target !== request || version !== generation) return false
    try { target.assertOwner(); return true } catch { return false }
  }

  /** @param {(repository:Repository, scope:Scope)=>Promise<Page|null>} query @param {'replace'|'prepend'|'locate'} action */
  async function load(query, action) {
    const target = request, version = generation
    if (!target || loading.value) return false
    loading.value = true
    error.value = ''
    try {
      const page = await read(target, repository => query(repository, target.scope))
      if (!current(target, version)) return false
      if (!page) { error.value = 'MESSAGE_UNAVAILABLE'; return false }
      const chronological = [...page.messages].reverse()
      if (action === 'prepend') {
        const included = new Set(chronological.map(message => message.id))
        messages.value = [...chronological, ...messages.value.filter(message => !included.has(message.id))].slice(0, 100)
      } else messages.value = chronological
      cursor.value = page.cursor
      ready.value = true
      browsing.value = action !== 'replace'
      if (action === 'replace') newMessages.value = false
      return true
    } catch {
      if (current(target, version)) error.value = 'MESSAGE_LOAD_FAILED'
      return false
    } finally { if (target === request && version === generation) loading.value = false }
  }
  const recent = () => load((repository, scope) => repository.recent(scope), 'replace')
  /** @param {string} conversationId */
  const activate = async conversationId => {
    reset()
    request = owner(conversationId)
    return recent()
  }
  const older = async () => {
    const next = cursor.value
    return next ? load((repository, scope) => repository.older(scope, next), 'prepend') : false
  }
  /** @param {string} id */
  const locate = id => load((repository, scope) => repository.locate(scope, id), 'locate')
  /** @param {string} id */
  const showQuote = async id => {
    const target = request, version = generation, selection = ++quoteGeneration
    quote.value = null
    if (!target) return false
    try {
      const value = await read(target, repository => repository.quote(target.scope, id))
      if (current(target, version) && selection === quoteGeneration) {
        quote.value = value
        if (!value) error.value = 'MESSAGE_UNAVAILABLE'
        return Boolean(value)
      }
    } catch {
      if (current(target, version) && selection === quoteGeneration) error.value = 'MESSAGE_LOAD_FAILED'
    }
    return false
  }
  return {
    messages, ready, loading, error, browsing, newMessages, quote, activate, reset, recent, older, locate, showQuote,
    hasMore: computed(() => cursor.value !== null),
    clearQuote() { quoteGeneration++; quote.value = null },
    async refresh() {
      if (browsing.value) { newMessages.value = true; return false }
      return recent()
    },
  }
}
