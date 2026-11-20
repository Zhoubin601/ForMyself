// Dedicated QA adapter for native WebView Playwright verification (M6-QA-01).
// Pure property-based inspection: never invokes unrelated module exports.

/**
 * Resolve the deterministic createFullBackupRuntime factory from either a raw
 * module or a Vite/Rollup chunk namespace wrapper without invoking any export.
 * @param {Record<string, unknown> | null | undefined} mod
 * @returns {() => { createFullBackupSnapshot: Function, restore: Function, registry: { list: unknown[], get: Function } }}
 */
export function resolveFullBackupRuntimeFactory(mod) {
  if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) {
    throw new Error('Invalid fullBackupRuntime module')
  }
  if (typeof mod.createFullBackupRuntime === 'function') {
    return /** @type {any} */ (mod.createFullBackupRuntime)
  }
  const factories = new Set()
  for (const value of Object.values(mod)) {
    if (!value || typeof value !== 'object') continue
    if (typeof (/** @type {Record<string, unknown>} */ (value)).createFullBackupRuntime === 'function') {
      factories.add((/** @type {Record<string, unknown>} */ (value)).createFullBackupRuntime)
    }
  }
  if (factories.size === 1) {
    return /** @type {any} */ ([...factories][0])
  }
  if (factories.size > 1) {
    throw new Error('Ambiguous createFullBackupRuntime exports')
  }
  throw new Error('Missing createFullBackupRuntime export')
}

/**
 * Locate the reactive restoreState object by own property shape without calling functions.
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function resolveRestoreState(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid restoreState module')
  if (
    entry.restoreState &&
    typeof entry.restoreState === 'object' &&
    Object.hasOwn(entry.restoreState, 'blocked') &&
    Object.hasOwn(entry.restoreState, 'busy') &&
    Object.hasOwn(entry.restoreState, 'syncError')
  ) {
    return entry.restoreState
  }
  const matches = Object.values(entry).filter(
    value =>
      value &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'blocked') &&
      Object.hasOwn(value, 'busy') &&
      Object.hasOwn(value, 'syncError')
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error('Ambiguous actual restore state')
  throw new Error('Missing actual restore state')
}

/**
 * Locate the restoreJournal instance by property/method shape without invoking any method.
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function resolveRestoreJournal(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid journal module')
  const isJournal = value =>
    Boolean(
      value &&
      typeof value === 'object' &&
      typeof value.inspect === 'function' &&
      typeof value.commit === 'function' &&
      typeof value.prepare === 'function'
    )
  if (isJournal(entry.restoreJournal)) return entry.restoreJournal
  const matches = Object.values(entry).filter(isJournal)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error('Ambiguous actual journal')
  throw new Error('Missing actual journal')
}

/**
 * Compute chatSendReply strictly from executed send + assistant reply assertions.
 * View mount or module load alone must never yield true.
 * @param {{ chatModuleLoaded?: boolean, chatViewReady?: boolean, chatUserMessageSent?: boolean, chatAssistantReplied?: boolean }} state
 */
export function computeChatSendReply(state) {
  return Boolean(
    state?.chatModuleLoaded === true &&
    state?.chatViewReady === true &&
    state?.chatUserMessageSent === true &&
    state?.chatAssistantReplied === true
  )
}

/**
 * Verify that Kanata snapshot retains the exact synthetic world, conversation,
 * user message, and assistant reply by stable ID and content after password change.
 * @param {any} snapshot
 * @param {{
 *   worldId: string,
 *   worldName: string,
 *   conversationId: string,
 *   userMessageId: string,
 *   userMessageContent: string,
 *   assistantMessageId: string,
 *   assistantMessageContent: string
 * } | null | undefined} expected
 */
export function verifyKanataPreservedData(snapshot, expected) {
  if (!snapshot || typeof snapshot !== 'object' || !expected || !expected.worldId || !expected.conversationId || !expected.userMessageId || !expected.assistantMessageId) {
    return {
      ok: false,
      worldFound: false,
      conversationFound: false,
      userMessageMatched: false,
      assistantMessageMatched: false
    }
  }
  const world = Array.isArray(snapshot.worlds)
    ? snapshot.worlds.find(w => w.id === expected.worldId)
    : null
  const worldFound = Boolean(world && world.name === expected.worldName)

  const conversation = Array.isArray(snapshot.conversations)
    ? snapshot.conversations.find(c => c.id === expected.conversationId && c.worldId === expected.worldId)
    : null
  const conversationFound = Boolean(conversation)

  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : []
  const userMessage = messages.find(m => m.id === expected.userMessageId && m.conversationId === expected.conversationId)
  const userMessageMatched = Boolean(
    userMessage &&
    userMessage.role === 'user' &&
    userMessage.status === 'complete' &&
    userMessage.content === expected.userMessageContent
  )

  const assistantMessage = messages.find(m => m.id === expected.assistantMessageId && m.conversationId === expected.conversationId)
  const assistantMessageMatched = Boolean(
    assistantMessage &&
    assistantMessage.role === 'assistant' &&
    assistantMessage.status === 'complete' &&
    assistantMessage.replyToMessageId === expected.userMessageId &&
    assistantMessage.content === expected.assistantMessageContent
  )

  return {
    ok: worldFound && conversationFound && userMessageMatched && assistantMessageMatched,
    worldFound,
    conversationFound,
    userMessageMatched,
    assistantMessageMatched
  }
}
