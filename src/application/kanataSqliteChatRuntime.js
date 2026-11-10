// @ts-check
import { shallowRef, watch } from 'vue'
import { createKanataChatViewModel } from '../features/chat/kanataChatViewModel.js'
import { buildKanataConversationContext, createKanataSpeakerSelection, splitKanataBubbles } from '../features/chat/domain/kanataConversation.js'
import { resolveKanataCharacter } from '../features/chat/domain/kanataManagementCore.js'
import { kanataReplyLimits } from '../features/chat/domain/groupReplyLimits.js'
import { kanataMemoryPolicy, kanataMemoryRanker } from '../features/chat/experience/kanataKnowledge.js'
import { estimateKanataContextTokens, expandKanataCharacterText } from '../features/chat/lorebook/kanataLorebook.js'
import { readKanataRoleLore } from '../features/chat/lorebook/kanataRoleLore.js'
import { createKanataBudgetSelection } from '../features/chat/domain/kanataBudgetSelection.js'
import { collectKanataLifeContext } from './kanataLifeContext.js'

/** @typedef {import('../features/chat/domain/kanataTypes').Message} Message */
/** @typedef {import('../features/chat/domain/kanataTypes').Conversation} Conversation */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageRepository} Repository */
/** @typedef {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataReplyProvenance} Provenance */
/** @typedef {ReturnType<typeof import('./kanataSqliteCandidate.js').createKanataSqliteCandidate>} Candidate */
/** @typedef {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataSqliteDomains} Domains */
/** @typedef {{prompt: ReturnType<typeof buildKanataConversationContext>, done: Awaited<ReturnType<Repository['completedReplies']>>, lifeSignature: string, name: string, provenance: Provenance}} ReplyContext */
/** @typedef {{text?:string,retryMessageId?:string,replyToMessageId?:string,replyToRevision?:number,stream?:boolean,delayMs?:number,
 * persistDelay?:boolean,timing?:'configured'|'immediate',
 * onDelta?:(value:{instanceId:string,name:string,content:string})=>void}} SendOptions */

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

/** @template T @param {(afterId:string)=>Promise<{entries:T[],cursor:string|null}>} read */
async function* knowledgeEntries(read) {
  let cursor = ''
  for (;;) {
    const page = await read(cursor)
    yield* page.entries
    if (page.cursor === null) return
    cursor = page.cursor
  }
}

/** @param {Domains} domains @param {Scope & {instanceId:string}} scope @param {string} text @param {number} contextBudget */
async function readPromptKnowledge(domains, scope, text, contextBudget) {
  const score = kanataMemoryRanker(text)
  const rank = createKanataBudgetSelection(4000,
    (/** @type {{id:string,score:number}} */ a, /** @type {{id:string,score:number}} */ b) =>
      b.score - a.score || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  for await (const entry of knowledgeEntries(afterId => domains.memories.promptCandidates(scope, afterId))) {
    rank.offer({ id: entry.id, score: score(entry) }, estimateKanataContextTokens(entry.content) + 16)
  }
  const memories = []
  let remainingBytes = contextBudget - 2
  for (const { id } of rank.finish()) {
    if (memories.length) remainingBytes--
    const memory = await domains.memories.readPrompt(scope, id, remainingBytes)
    remainingBytes -= memory.promptBytes
    memories.push(memory)
  }
  return { memories, lorebook: await readKanataRoleLore(domains.lorebook, scope.worldId, scope.instanceId, text) }
}
/** @param {Domains['chatView']} view @param {Scope} scope @param {Conversation['type']} type
 * @param {string} displayName @param {string} text @param {number} maxSpeakers @param {string} [previous] */
async function selectSpeakers(view, scope, type, displayName, text, maxSpeakers, previous) {
  const selection = createKanataSpeakerSelection(text, maxSpeakers, previous)
  let cursor = -1
  for (;;) {
    const page = await view.profiles(scope, cursor)
    if (type === 'private') {
      const [only] = page.entries
      requireCurrent(only && page.entries.length === 1 && page.cursor === null, 'CONVERSATION_UNAVAILABLE')
      return [only.id]
    }
    for (const profile of page.entries) {
      /** @param {string} value */
      const expand = value => expandKanataCharacterText(value, displayName, profile.name)
      selection.offer(profile.id, { name: expand(profile.name), aliases: profile.aliases.map(expand), interests: profile.interests.map(expand) })
    }
    if (page.cursor === null) return selection.finish()
    cursor = page.cursor
  }
}

/** Synthetic application composition for the message slice. The production composition
 * continues using its existing runtime and task/usage/backup participants.
 * @param {{
 * candidate: Candidate, completion: typeof import('./aiClient.js').completeChat,
 * auth: Pick<ReturnType<typeof import('../stores/auth.js').useAuthStore>,'isLocked'|'sessionRevision'>,
 * lifeReaders?: Parameters<typeof collectKanataLifeContext>[2],
 * onAttempt?: (attempt: import('../platform/ai/completionTypes').CompletionAttempt & Scope & {instanceId:string,turnId:string}) => Promise<unknown>,
 * releaseOnDispose?: boolean, clock?: () => number, id?: () => string
 * }} options */
export function createKanataSqliteChatRuntime({ candidate, completion, auth, lifeReaders = {}, onAttempt, releaseOnDispose = true, clock = Date.now, id = () => crypto.randomUUID() }) {
  const revision = shallowRef(0)
  const isAvailable = () => !disposed && candidate.isAvailable()
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
    if (scope && isAvailable()) schedulePoll(0)
  }
  const stopInvalidation = watch(candidate.generation, clear, { flush: 'sync' })
  const stopAvailability = watch(candidate.isAvailable, available => {
    if (available && selected) schedulePoll(0)
  })
  /** @param {string} conversationId */
  function owner(conversationId) {
    const scope = selected, generation = revision.value, session = auth.sessionRevision
    if (!scope || scope.conversationId !== conversationId) throw new Error('KANATA_SQLITE_SESSION_CHANGED')
    return {
      scope,
      assertOwner() {
        requireCurrent(isAvailable() && revision.value === generation && auth.sessionRevision === session
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
    if (!isAvailable() || !selected || processingDue) return
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
      const turn = await candidate.withRepositories({ assertOwner }, async (messages, _conversations, _deferred, domains) => {
        const overview = await domains.chatView.summary(scope)
        if (!overview || overview.conversation.type === 'character' || overview.world.archived) throw new Error('CONVERSATION_UNAVAILABLE')
        const { conversation } = overview
        const world = await domains.worlds.get(scope.worldId)
        if (!world || world.world.archived) throw new Error('CONVERSATION_UNAVAILABLE')
        const { identity } = world
        const latest = await messages.latestState(scope, 'user')
        const retry = options.retryMessageId ? await messages.get(scope, options.retryMessageId, 'transcript') : null
        if (options.retryMessageId) requireCurrent(retry && latest?.id === retry.id
          && retry.senderId === identity.id && !retry.deleted && retry.status === 'complete', 'RETRY_SOURCE_UNAVAILABLE')
        const text = retry?.content ?? String(options.text ?? '').trim()
        requireCurrent(text && text.length <= 8000, 'INVALID_MESSAGE')
        const previousSpeaker = await messages.latestState(scope, 'assistant')
        const speakers = await selectSpeakers(domains.chatView, scope, conversation.type, identity.displayName, text,
          kanataReplyLimits(conversation).maxSpeakers, previousSpeaker?.senderId)
        const replyTo = options.replyToMessageId ? await messages.state(scope, options.replyToMessageId) : null
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
        const prior = retry ? await messages.completedReplies(scope, source.id) : []
        const needsReply = prior.length < kanataReplyLimits(conversation).maxMessages &&
          speakers.some(speaker => !prior.some(message => message.senderId === speaker))
        const timing = conversation.replyTiming
        const activityWait = options.timing !== 'immediate' && needsReply && timing?.enabled && world.world.autonomyEnabled
          && await domains.autonomy.anySpeakerBusy(scope.worldId, speakers, clock(), world.world.timeZone) ? timing.waitMs : 0
        const wait = options.timing === 'immediate' || !needsReply ? 0 : manualWait || activityWait
        const activityDelayed = Boolean(activityWait && !manualWait)
        const shouldDefer = Boolean(wait && (options.persistDelay || activityWait))
        const now = clock()
        const pending = await domains.turns.save(scope, {
          source, retry: Boolean(retry), conversationRevision: conversation.revision,
          ...(shouldDefer && { deferred: {
            id: 'deferred-' + id(), sourceId: source.id, sourceRevision: source.revision,
            notBefore: now + wait, expiresAt: now + 2 * 3600000, activityDelay: activityDelayed,
          } }),
        })
        sourceSaved = true
        assertOwner()
        if (!retry) messageRevision.value++
        pendingReply.value = pending
        if (shouldDefer) {
          schedulePoll(wait)
          return { source, speakers, conversation, wait: 0, deferred: true, activityDelayed }
        }
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
            options.onDelta?.({ instanceId, name: context.name, content })
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
        await candidate.withRepositories({ assertOwner }, async (messages, _conversations, _deferred, domains) => {
          const current = await readContext(messages, instanceId, domains)
          requireCurrent(current.prompt.knowledgeSignature === context.prompt.knowledgeSignature
            && current.lifeSignature === context.lifeSignature
            && JSON.stringify(current.prompt.messages) === JSON.stringify(context.prompt.messages)
            && JSON.stringify(current.done.map(item => [item.id, item.revision])) === JSON.stringify(context.done.map(item => [item.id, item.revision])),
          'STALE_CONTEXT')
          const latest = await messages.latestState(scope)
          const batchId = 'batch-' + id()
          const createdAt = Math.max(clock(), (latest?.createdAt ?? -1) + 1)
          const batch = splitKanataBubbles(response.content, current.prompt.mode, bubbleLimit).map((content, ordinal) =>
            /** @type {Message} */ ({
              ...scope, id: 'message-' + batchId + '-' + ordinal, senderId: instanceId, senderNameSnapshot: current.name,
              senderType: 'character', role: 'assistant', content, createdAt, revision: 1, status: 'complete', batchId,
              turnId: turn.source.turnId, replyToMessageId: turn.source.id, replyToRevision: turn.source.revision,
            }))
          await messages.insertReplyBatch(scope, {
            sourceId: turn.source.id, sourceRevision: turn.source.revision, conversationRevision: turn.conversation.revision,
            speakerId: instanceId, speakerRevision: Number(context.prompt.instanceRevision),
          }, batch, current.provenance)
        })
        assertOwner()
        messageRevision.value++
      }
      return { messageId: turn.source.id, turnId: turn.source.turnId }

      /** @param {string} instanceId @returns {Promise<ReplyContext>} */
      async function replyContext(instanceId) {
        return candidate.withRepositories({ assertOwner }, async (messages, _conversations, _deferred, domains) =>
          readContext(messages, instanceId, domains))
      }

      /** @param {Repository} messages @param {string} instanceId @param {Domains} domains @returns {Promise<ReplyContext>} */
      async function readContext(messages, instanceId, domains) {
        const overview = await domains.chatView.summary(scope)
        const conversation = overview && { ...overview.conversation, worldId: scope.worldId, lastReadAt: overview.lastReadAt,
          participantIds: [instanceId] }
        if (!await domains.chatView.hasSpeaker(scope, instanceId)) throw new Error('SPEAKER_ACCESS_DENIED')
        if (!conversation || conversation.revision !== turn.conversation.revision) throw new Error('STALE_CONTEXT')
        const latest = await messages.latestState(scope, 'user')
        requireCurrent(latest && latest.id === turn.source.id && latest.revision === turn.source.revision && !latest.deleted, 'STALE_TURN')
        const done = await messages.completedReplies(scope, turn.source.id)
        const savedPolicy = await domains.memories.policy(scope.worldId)
        const memoryPolicies = savedPolicy ? [savedPolicy] : []
        const policy = kanataMemoryPolicy({ memoryPolicies }, scope.worldId)
        const history = [...await messages.historyForSpeaker(scope, instanceId, policy.recentMessages, 'transcript')].reverse()
        const world = await domains.worlds.get(scope.worldId)
        if (!world || world.world.archived) throw new Error('CONVERSATION_UNAVAILABLE')
        const group = conversation.type === 'group'
        const actorScope = { instanceId, group }
        const verified = await domains.events.context(scope.worldId, actorScope, [instanceId])
        const relations = await domains.events.relationshipContext(scope.worldId, actorScope, policy.contextBudget)
        const actors = await domains.characters.promptActor(scope.worldId, instanceId, verified.hiddenTargetIds.has(instanceId))
        const text = history.slice(-3).map(message => message.content).join('\n')
        const knowledge = await readPromptKnowledge(domains, { ...scope, instanceId }, text, policy.contextBudget)
        const lifeGrants = await domains.autonomy.grantsForActor(scope.worldId, instanceId)
        const data = {
          ...actors, worlds: [world.world], identities: [world.identity], messages: history,
          conversations: [conversation], memoryPolicies, lifeGrants, relationships: relations.relationships,
          events: [], effects: [], memories: [], lorebookEntries: [],
        }
        const life = await collectKanataLifeContext(data, { worldId: scope.worldId, instanceId, group }, lifeReaders, assertOwner)
        assertOwner()
        const prompt = buildKanataConversationContext(data, conversationId, instanceId, {
          repositoryHistory: true, lifeEntries: life.entries, lifeSources: life.lifeSources,
          repositoryKnowledge: { ...knowledge, events: verified.events,
            hiddenTargetIds: new Set([...verified.hiddenTargetIds, ...relations.hiddenTargetIds]) },
        })
        /** @param {{id:string,revision:number}} entry */
        const reference = ({ id, revision }) => ({ id, revision })
        const provenance = { recentMessages: policy.recentMessages, history: history.map(reference),
          memories: knowledge.memories.map(reference), events: verified.events.map(reference), life: life.lifeSources }
        return { prompt, done, lifeSignature: life.signature, name: resolveKanataCharacter(data, instanceId).name, provenance }
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
    return candidate.withRepositories(request, async (_messages, conversations, _deferred, domains) => {
      await conversations.updateChatSettings(request.scope, expectedRevision, changes, clock())
      const overview = await domains.chatView.summary(request.scope)
      if (!overview) throw new Error('CONVERSATION_UNAVAILABLE')
      if (changes.replyTiming?.enabled === false) schedulePoll(0)
      return overview.conversation
    })
  }
  return {
    revision, messageRevision, pendingReply, activate, owner, send, cancel, reviseMessage, runDue,
    isAvailable,
    createViewModel: () => createKanataChatViewModel({ revision, owner, read: candidate.withRepositories,
      load: candidate.loadConversationView, readMembers: candidate.readConversationMembers,
      readUsage: (request, cursor) => candidate.withDomains(request, domains => domains.usage.forConversation(request.scope, cursor)),
    }),
    /** @param {string} conversationId @param {()=>void} guard */
    previewArchive(conversationId,guard){
      const request=owner(conversationId)
      return candidate.withRepositories({assertOwner(){request.assertOwner();guard()}},messages=>messages.previewArchive(request.scope))
    },
    /** @param {string} conversationId @param {import('./contracts').KanataHistoryArchivePlan} plan @param {string} key @param {()=>void} guard */
    confirmArchive(conversationId,plan,key,guard){
      const request=owner(conversationId)
      cancel()
      return candidate.withRepositories({assertOwner(){request.assertOwner();guard()}},messages=>messages.confirmArchive(request.scope,plan,key))
    },
    /** @param {string} conversationId @param {string} text
     * @param {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataHistoryCursor|undefined} cursor
     * @param {()=>void} assertSearch */
    searchHistory(conversationId, text, cursor, assertSearch) {
      const request = owner(conversationId)
      return candidate.withRepositories({ assertOwner() { request.assertOwner(); assertSearch() } },
        messages => messages.searchHistory(request.scope, text, cursor))
    },
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
      stopInvalidation()
      stopAvailability()
      if (releaseOnDispose) await candidate.release()
    },
  }
}
