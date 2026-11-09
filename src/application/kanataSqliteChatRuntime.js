// @ts-check
import { App } from '@capacitor/app'
import { shallowRef, watch } from 'vue'
import { buildKanataConversationContext, decideKanataSpeakers, kanataConversation, splitKanataBubbles } from '../features/chat/domain/kanataConversation.js'
import { resolveKanataCharacter } from '../features/chat/domain/kanataManagementCore.js'
import { kanataReplyLimits } from '../features/chat/domain/groupReplyLimits.js'
import { kanataMemoryPolicy } from '../features/chat/experience/kanataKnowledge.js'
import { planKanataReplyDelay } from '../features/chat/autonomy/kanataReplyTiming.js'
import { collectKanataLifeContext } from './kanataLifeContext.js'

/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {import('../features/chat/domain/kanataTypes').Message} Message */
/** @typedef {import('../features/chat/domain/kanataTypes').Conversation} Conversation */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageRepository} Repository */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageProvenance} Provenance */
/** @typedef {ReturnType<typeof import('./kanataSqliteCandidate.js').createKanataSqliteCandidate>} Candidate */
/** @typedef {Omit<Data,'messages'>} Metadata */
/** @typedef {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataSqliteDomains} Domains */
/** @typedef {{prompt: ReturnType<typeof buildKanataConversationContext>, done: Message[], lifeSignature: string, name: string}} ReplyContext */
/** @typedef {{text?:string,retryMessageId?:string,replyToMessageId?:string,replyToRevision?:number,stream?:boolean,delayMs?:number,
 * persistDelay?:boolean,timing?:'configured'|'immediate',
 * onDelta?:(value:{instanceId:string,content:string})=>void}} SendOptions */

/** @param {unknown} condition @param {string} code */
function requireCurrent(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code })
}

/** @param {number} ms @param {AbortSignal} signal */
function waitForReply(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('ABORTED')); return }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(undefined) }, ms)
    function abort() { clearTimeout(timer); reject(new Error('ABORTED')) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Fetch only metadata for old or cross-conversation sources needed by the existing permission rules.
 * @param {Repository} repository @param {Data} data @param {string} worldId */
async function fetchProvenance(repository, data, worldId) {
  const visible = new Set(data.messages.map(message => message.id))
  const ids = new Set(data.messages.map(message => message.replyToMessageId).filter(id => id !== undefined))
  for (const event of data.events) if (event.worldId === worldId && event.status === 'committed') {
    for (const source of event.sourceRefs) ids.add(source.messageId)
  }
  for (const memory of data.memories) if (memory.worldId === worldId && memory.status === 'active') {
    for (const source of memory.sourceRefs) ids.add(source.messageId)
  }
  /** @type {Provenance[]} */
  const provenance = []
  for (const id of ids) {
    if (visible.has(id)) continue
    const source = await repository.provenance(worldId, id)
    if (source) {
      provenance.push(source)
      if (source.replyToMessageId) ids.add(source.replyToMessageId)
    }
  }
  return provenance
}

/** @template T @param {(afterId:string)=>Promise<{entries:T[],cursor:string|null}>} read */
async function readKnowledgePages(read) {
  const entries = []
  let cursor = ''
  for (;;) {
    const page = await read(cursor)
    entries.push(...page.entries)
    if (page.cursor === null) return entries
    cursor = page.cursor
  }
}

/** @param {Repository} repository @param {Scope} scope @param {string} id */
async function completedReplies(repository, scope, id) {
  /** @type {Message[]} */
  const result = []
  let page = await repository.replies(scope, id)
  for (;;) {
    result.push(...page.messages.filter(message => message.role === 'assistant' && message.status === 'complete' && !message.deleted))
    if (!page.cursor || result.length >= 32) return result.slice(0, 32)
    page = await repository.replies(scope, id, page.cursor)
  }
}

/** Synthetic application composition for the message slice. The production composition
 * continues using its existing runtime and task/usage/backup participants.
 * @param {{
 * candidate: Candidate, metadata: () => Metadata, completion: typeof import('./aiClient.js').completeChat,
 * auth: Pick<ReturnType<typeof import('../stores/auth.js').useAuthStore>,'isLocked'|'sessionRevision'>,
 * lifeReaders?: Parameters<typeof collectKanataLifeContext>[2],
 * onAttempt?: (attempt: import('../platform/ai/completionTypes').CompletionAttempt & Scope & {instanceId:string,turnId:string}) => Promise<unknown>,
 * clock?: () => number, id?: () => string
 * }} options */
export function createKanataSqliteChatRuntime({ candidate, metadata, completion, auth, lifeReaders = {}, onAttempt, clock = Date.now, id = () => crypto.randomUUID() }) {
  const revision = shallowRef(0)
  const foreground = shallowRef(true)
  const messageRevision = shallowRef(0)
  const pendingReply = shallowRef(/** @type {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataDeferredReply|null} */ (null))
  /** @type {Scope | null} */
  let selected = null
  /** @type {AbortController | undefined} */
  let controller
  let disposed = false
  /** @type {ReturnType<typeof owner>|undefined} */
  let processingDue
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  const cancel = () => {
    controller?.abort()
    controller = undefined
  }
  const clear = () => {
    revision.value++
    cancel()
    clearTimeout(timer)
    pendingReply.value = null
    processingDue = undefined
  }
  /** @param {Scope | null} scope */
  const activate = scope => {
    if (scope?.worldId === selected?.worldId && scope?.conversationId === selected?.conversationId) return
    selected = scope && Object.freeze({ ...scope })
    clear()
    if (scope && foreground.value && !auth.isLocked) schedulePoll(0)
  }
  const unwatch = watch(() => [auth.sessionRevision, auth.isLocked], () => {
    clear()
    if (!auth.isLocked && selected && foreground.value) schedulePoll(0)
  }, { flush: 'sync' })
  const appListener = App.addListener('appStateChange', ({ isActive }) => {
    foreground.value = isActive
    if (!isActive) clear()
    else if (selected && !auth.isLocked) schedulePoll(0)
  }).catch(() => undefined)

  /** @param {string} conversationId */
  function owner(conversationId) {
    const scope = selected, generation = revision.value, session = auth.sessionRevision
    if (!scope || scope.conversationId !== conversationId) throw new Error('KANATA_SQLITE_SESSION_CHANGED')
    return {
      scope,
      assertOwner() {
        requireCurrent(!disposed && foreground.value && !auth.isLocked && revision.value === generation && auth.sessionRevision === session
          && scope === selected, 'KANATA_SQLITE_SESSION_CHANGED')
      },
    }
  }
  /** @param {number} ms */
  function schedulePoll(ms) {
    clearTimeout(timer)
    timer = setTimeout(() => { void runDue().catch(() => {}) }, ms)
  }

  async function runDue() {
    if (disposed || auth.isLocked || !foreground.value || !selected || processingDue) return
    const request = owner(selected.conversationId)
    const { scope } = request
    if (controller) { schedulePoll(30000); return }
    processingDue = request
    try {
      const task = await candidate.withRepositories(request, (_messages, _conversations, deferred) =>
        deferred.claim(scope, clock()))
      if (task) {
        let success = false
        try {
          await send(scope.conversationId, { retryMessageId: task.sourceId, timing: 'immediate', stream: false })
          success = true
        } finally {
          request.assertOwner()
          await candidate.withRepositories(request, (_messages, _conversations, deferred) =>
            deferred.finish(scope, task.id, success))
        }
      }
    } finally {
      if (processingDue === request) {
        processingDue = undefined
        request.assertOwner()
        const task = await candidate.withRepositories(request, (_messages, _conversations, deferred) => deferred.pending(scope))
        request.assertOwner()
        pendingReply.value = task
        schedulePoll(task ? Math.min(30000, Math.max(200, task.notBefore - clock())) : 30000)
      }
    }
  }

  /** @param {string} conversationId @param {SendOptions} options */
  async function send(conversationId, options) {
    requireCurrent(!controller, 'KANATA_REPLY_BUSY')
    const request = owner(conversationId)
    const abort = new AbortController()
    controller = abort
    const { scope } = request
    const assertOwner = () => {
      request.assertOwner()
      requireCurrent(!abort.signal.aborted, 'ABORTED')
    }
    let sourceSaved = false
    try {
      const manualWait = options.delayMs ?? 0
      requireCurrent(Number.isSafeInteger(manualWait) && manualWait >= 0 && manualWait <= 30000, 'INVALID_REPLY_DELAY')
      const turn = await candidate.withRepositories({ assertOwner }, async (messages, conversations, deferred, domains) => {
        const conversation = await conversations.get(scope)
        if (!conversation || conversation.type === 'character') throw new Error('CONVERSATION_UNAVAILABLE')
        const world = await domains.worlds.get(scope.worldId)
        if (!world || world.world.archived) throw new Error('CONVERSATION_UNAVAILABLE')
        const actors = await domains.characters.conversationActors(scope.worldId, conversation.participantIds)
        const data = { ...metadata(), ...actors, worlds: [world.world], identities: [world.identity], conversations: [conversation], messages: [] }
        kanataConversation(data, conversationId)
        const identity = data.identities.find(row => row.worldId === scope.worldId)
        if (!identity) throw new Error('WORLD_IDENTITY_REQUIRED')
        const latest = await messages.latest(scope, 'user')
        const retry = options.retryMessageId ? await messages.get(scope, options.retryMessageId) : null
        if (options.retryMessageId) requireCurrent(retry && latest?.id === retry.id
          && retry.senderId === identity.id && !retry.deleted && retry.status === 'complete', 'RETRY_SOURCE_UNAVAILABLE')
        const text = retry?.content ?? String(options.text ?? '').trim()
        requireCurrent(text && text.length <= 8000, 'INVALID_MESSAGE')
        const previousSpeaker = await messages.latest(scope, 'assistant')
        const speakers = decideKanataSpeakers({ ...data, messages: previousSpeaker ? [previousSpeaker] : [] }, conversationId, text)
        const replyTo = options.replyToMessageId ? await messages.get(scope, options.replyToMessageId) : null
        if (options.replyToMessageId) requireCurrent(replyTo && !replyTo.deleted && replyTo.status === 'complete'
          && replyTo.revision === options.replyToRevision, 'RETRY_SOURCE_UNAVAILABLE')
        const turnId = 'turn-' + id()
        /** @type {Message} */
        const source = retry ?? {
          id: 'message-' + id(), ...scope, role: 'user', senderType: 'user', senderId: identity.id,
          senderNameSnapshot: identity.displayName, content: text,
          createdAt: Math.max(clock(), (latest?.createdAt ?? -1) + 1, (previousSpeaker?.createdAt ?? -1) + 1),
          revision: 1, status: 'complete', turnId, batchId: turnId,
          ...(replyTo && { replyToMessageId: replyTo.id, replyToRevision: replyTo.revision }),
        }
        if (!retry) {
          await messages.insert(source)
          assertOwner()
          messageRevision.value++
        }
        sourceSaved = true
        const prior = retry ? await completedReplies(messages, scope, source.id) : []
        const needsReply = prior.length < kanataReplyLimits(conversation).maxMessages &&
          speakers.some(speaker => !prior.some(message => message.senderId === speaker))
        const activityWait = options.timing === 'immediate' || !needsReply ? 0 : planKanataReplyDelay(data, conversation, speakers, clock())
        const wait = options.timing === 'immediate' || !needsReply ? 0 : manualWait || activityWait
        const activityDelayed = Boolean(activityWait && !manualWait)
        if (wait && (options.persistDelay || activityWait)) {
          const now = clock()
          await deferred.schedule(scope, {
            id: 'deferred-' + id(), sourceId: source.id, sourceRevision: source.revision,
            notBefore: now + wait, expiresAt: now + 2 * 3600000, activityDelay: activityDelayed,
          }, Boolean(retry))
          const pending = await deferred.pending(scope)
          assertOwner()
          pendingReply.value = pending
          schedulePoll(wait)
          return { source, speakers, conversation, wait: 0, deferred: true, activityDelayed }
        }
        await deferred.cancel(scope)
        assertOwner()
        pendingReply.value = null
        return { source, speakers, conversation, wait, deferred: false, activityDelayed: false }
      })
      if (turn.deferred) {
        return { messageId: turn.source.id, turnId: turn.source.turnId, deferred: true, activityDelayed: turn.activityDelayed }
      }
      if (turn.wait) await waitForReply(turn.wait, abort.signal)
      const limits = kanataReplyLimits(turn.conversation)
      for (const [index, instanceId] of turn.speakers.entries()) {
        const context = await replyContext(instanceId)
        if (context.done.some(message => message.senderId === instanceId)) continue
        const remaining = limits.maxMessages - context.done.length
        if (remaining <= 0) break
        const bubbleLimit = Math.min(4, remaining - Math.min(turn.speakers.length - index - 1, remaining - 1))
        const response = await completion({
          messages: context.prompt.messages, signal: abort.signal, stream: options.stream !== false,
          onDelta(content) {
            if (abort.signal.aborted) return
            try { assertOwner() } catch { return }
            options.onDelta?.({ instanceId, content })
          },
          async onAttempt(attempt) {
            assertOwner()
            const usage = { ...attempt, ...scope, instanceId, turnId: turn.source.turnId, purpose: /** @type {const} */ ('chat') }
            if (onAttempt) await onAttempt(usage)
            else await candidate.withDomains({ assertOwner }, domains => domains.usage.record(usage))
            assertOwner()
          },
        })
        assertOwner()
        await candidate.withRepositories({ assertOwner }, async (messages, conversations, _deferred, domains) => {
          const current = await readContext(messages, await conversations.get(scope), instanceId, domains)
          requireCurrent(current.prompt.knowledgeSignature === context.prompt.knowledgeSignature
            && current.lifeSignature === context.lifeSignature
            && JSON.stringify(current.prompt.messages) === JSON.stringify(context.prompt.messages)
            && JSON.stringify(current.done.map(item => [item.id, item.revision])) === JSON.stringify(context.done.map(item => [item.id, item.revision])),
          'STALE_CONTEXT')
          const latest = (await messages.recent(scope, 1)).messages[0]
          const batchId = 'batch-' + id()
          const createdAt = Math.max(clock(), (latest?.createdAt ?? -1) + 1)
          const batch = splitKanataBubbles(response.content, current.prompt.mode, bubbleLimit).map((content, ordinal) =>
            /** @type {Message} */ ({
              ...scope, id: 'message-' + batchId + '-' + ordinal, senderId: instanceId, senderNameSnapshot: current.name,
              senderType: 'character', role: 'assistant', content, createdAt, revision: 1, status: 'complete', batchId,
              turnId: turn.source.turnId, replyToMessageId: turn.source.id, replyToRevision: turn.source.revision, lifeSources: current.prompt.lifeSources,
            }))
          await messages.insertReplyBatch(scope, {
            sourceId: turn.source.id, sourceRevision: turn.source.revision, conversationRevision: turn.conversation.revision,
            speakerId: instanceId, speakerRevision: Number(context.prompt.instanceRevision),
          }, batch)
        })
        assertOwner()
        messageRevision.value++
      }
      return { messageId: turn.source.id, turnId: turn.source.turnId }

      /** @param {string} instanceId @returns {Promise<ReplyContext>} */
      async function replyContext(instanceId) {
        return candidate.withRepositories({ assertOwner }, async (messages, conversations, _deferred, domains) =>
          readContext(messages, await conversations.get(scope), instanceId, domains))
      }

      /** @param {Repository} messages @param {Conversation|null} conversation @param {string} instanceId @param {Domains} domains @returns {Promise<ReplyContext>} */
      async function readContext(messages, conversation, instanceId, domains) {
        if (!conversation || conversation.revision !== turn.conversation.revision) throw new Error('STALE_CONTEXT')
        const latest = await messages.latest(scope, 'user')
        requireCurrent(latest && latest.id === turn.source.id && latest.revision === turn.source.revision && !latest.deleted, 'STALE_TURN')
        const done = await completedReplies(messages, scope, turn.source.id)
        const meta = metadata()
        const history = await messages.historyForSpeaker(scope, instanceId, kanataMemoryPolicy({ ...meta, messages: [] }, scope.worldId).recentMessages)
        const relevant = meta.relationships.filter(row => row.worldId === scope.worldId && row.fromId === instanceId)
        const world = await domains.worlds.get(scope.worldId)
        if (!world || world.world.archived) throw new Error('CONVERSATION_UNAVAILABLE')
        const group = conversation.type === 'group'
        const verified = await domains.events.context(scope.worldId, { instanceId, group }, [instanceId, ...relevant.map(row => row.id)])
        const actors = await domains.characters.conversationActors(scope.worldId, [instanceId], verified.hiddenTargetIds)
        const grants = await domains.autonomy.grants(scope.worldId)
        const memories = await readKnowledgePages(afterId => domains.memories.listFor({ ...scope, instanceId }, afterId))
        const lorebook = await readKnowledgePages(afterId => domains.lorebook.list(scope.worldId, afterId, 50, instanceId))
        const relationships = []
        for (const row of relevant) {
          if (verified.hiddenTargetIds.has(row.id)) relationships.push(row)
          else {
            const current = await domains.events.relationship(scope.worldId, row.id)
            if (current) relationships.push(current)
          }
        }
        const data = {
          ...meta, ...actors, worlds: [world.world], identities: [world.identity], messages: [...history].reverse(),
          conversations: [conversation],
          events: verified.events, memories, lorebookEntries: lorebook, lifeGrants: grants, relationships,
        }
        const provenance = await fetchProvenance(messages, data, scope.worldId)
        const life = await collectKanataLifeContext(data, { worldId: scope.worldId, instanceId, group: conversation.type === 'group' }, lifeReaders)
        assertOwner()
        const prompt = buildKanataConversationContext(data, conversationId, instanceId, {
          provenance, lifeEntries: life.entries, lifeSources: life.lifeSources,
          repositoryKnowledge: { ...verified, memories },
        })
        return { prompt, done, lifeSignature: life.signature, name: resolveKanataCharacter(data, instanceId).name }
      }
    } catch (failure) {
      const error = /** @type {Error & {code?:string}} */ (failure)
      throw Object.assign(new Error(error.code ?? error.message), { code: error.code ?? error.message, sourceSaved })
    } finally { if (controller === abort) controller = undefined }
  }

  /** @param {string} messageId @param {number} expectedRevision @param {{content:string,deleted:boolean}} change */
  const reviseMessage = async (messageId, expectedRevision, change) => {
    const request = owner(selected?.conversationId ?? '')
    const revised = await candidate.withRepositories(request, messages => messages.revise(request.scope, messageId, expectedRevision, change))
    request.assertOwner()
    schedulePoll(0)
    return revised
  }
  /** @param {string} conversationId @param {number | undefined} expectedRevision
   * @param {Partial<Pick<Conversation,'mode'|'replyLimits'|'replyTiming'>>} changes */
  function changeConversation(conversationId, expectedRevision, changes) {
    cancel()
    const request = owner(conversationId)
    return candidate.withRepositories(request, async (_messages, conversations, deferred) => {
      const current = await conversations.get(request.scope)
      if (!current || current.type === 'character') throw new Error('CONVERSATION_UNAVAILABLE')
      const saved = await conversations.update(request.scope, expectedRevision ?? current.revision, { ...current, ...changes })
      if (changes.replyTiming?.enabled === false) {
        await deferred.accelerate(request.scope, clock())
        schedulePoll(0)
      }
      return saved
    })
  }
  return {
    revision, messageRevision, pendingReply, activate, owner, send, cancel, reviseMessage, runDue,
    isAvailable: () => foreground.value && !auth.isLocked && !disposed,
    /** @param {string} conversationId @param {'daily'|'roleplay'} mode */
    setMode: (conversationId, mode) => changeConversation(conversationId, undefined, { mode }),
    /** @param {string} conversationId @param {number} expected @param {NonNullable<Conversation['replyLimits']>} replyLimits */
    setGroupLimits: (conversationId, expected, replyLimits) => changeConversation(conversationId, expected, { replyLimits }),
    /** @param {string} conversationId @param {number} expected @param {NonNullable<Conversation['replyTiming']>} replyTiming */
    setReplyTiming: (conversationId, expected, replyTiming) => changeConversation(conversationId, expected, { replyTiming }),
    /** @param {string} conversationId */
    async cancelDeferred(conversationId) {
      const request = owner(conversationId)
      await candidate.withRepositories(request, (_messages, _conversations, deferred) => deferred.cancel(request.scope))
      request.assertOwner()
      pendingReply.value = null
    },
    async dispose() {
      disposed = true
      activate(null)
      unwatch()
      try { await candidate.release() }
      finally { await (await appListener)?.remove() }
    },
  }
}
