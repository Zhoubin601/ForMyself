// @ts-check
import { watch } from 'vue'
import { buildKanataConversationContext } from '../features/chat/domain/kanataConversation.js'
import { resolveKanataCharacter } from '../features/chat/domain/kanataManagementCore.js'
import { createKanataBudgetSelection } from '../features/chat/domain/kanataBudgetSelection.js'
import { canUseKanataLifeSources, kanataMemoryRanker } from '../features/chat/experience/kanataKnowledge.js'
import { estimateKanataContextTokens } from '../features/chat/lorebook/kanataLorebook.js'
import { readKanataRoleLore } from '../features/chat/lorebook/kanataRoleLore.js'
import { completeChat } from './aiClient.js'
import { collectKanataLifeContext, createKanataLifeReaders } from './kanataLifeContext.js'

/** @typedef {Pick<ReturnType<typeof import('./kanataSqliteCandidate.js').createKanataSqliteCandidate>,'withDomains'>
 * & {withRepositories?:ReturnType<typeof import('./kanataSqliteCandidate.js').createKanataSqliteCandidate>['withRepositories'],
 *   ensureAccess?:()=>Promise<boolean>,
 *   isAvailable?:()=>boolean,
 *   generation?:import('vue').Ref<number>}} Candidate */
/** @typedef {import('../features/chat/domain/kanataTypes').LifeModule} LifeModule */
/** @typedef {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataSqliteDomains} Domains */

/** @param {string} code */
const fail = code => Object.assign(new Error(code), { code })

/** @param {{
 * candidate: Candidate,
 * auth: { sessionRevision: number, isLocked?: boolean },
 * completion?: typeof completeChat,
 * readers?: ReturnType<typeof createKanataLifeReaders>,
 * clock?: () => number,
 * idFactory?: () => string,
 * onRelease?: () => void,
 * }} options */
export function createKanataSqliteLifeCompanion({
  candidate, auth, completion = completeChat, readers = createKanataLifeReaders(),
  clock = Date.now, idFactory = () => crypto.randomUUID(), onRelease = () => {},
}) {
  let disposed = false
  let generation = 0
  /** @type {AbortController | null} */
  let controller = null

  const cancel = () => {
    controller?.abort()
    controller = null
  }
  const invalidate = () => {
    generation++
    cancel()
    onRelease()
  }
  const isAvailable = () => candidate.isAvailable ? candidate.isAvailable() : true
  const stopGeneration = candidate.generation ? watch(candidate.generation, invalidate, { flush: 'sync' }) : () => {}
  const stopAvailability = candidate.isAvailable ? watch(candidate.isAvailable, available => {
    if (!available) invalidate()
  }) : () => {}

  /** @param {Domains} domains @param {string} worldId @param {string} conversationId @param {string} instanceId
   * @param {LifeModule} moduleId @param {string} task */
  const readContextKnowledge = async (domains, worldId, conversationId, instanceId, moduleId, task) => {
    const actors = await domains.characters.promptActor(worldId, instanceId, false)
    const verified = await domains.events.context(worldId, { instanceId, group: false }, [instanceId])
    const relations = await domains.events.relationshipContext(worldId, { instanceId, group: false }, 24000)
    const lorebook = await readKanataRoleLore(domains.lorebook, worldId, instanceId, task)
    const score = kanataMemoryRanker(task)
    const rank = createKanataBudgetSelection(4000,
      (/** @type {{id:string,score:number}} */ a, /** @type {{id:string,score:number}} */ b) =>
        b.score - a.score || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    for (let cursor = ''; ;) {
      const page = await domains.memories.promptCandidates({ worldId, conversationId, instanceId }, cursor, 50, moduleId)
      for (const item of page.entries) rank.offer({ id: item.id, score: score(item) }, estimateKanataContextTokens(item.content) + 16)
      if (page.cursor === null) break
      cursor = page.cursor
    }
    const memories = []
    let remaining = 20000
    for (const { id } of rank.finish()) {
      if (remaining <= 64) break
      try {
        const memory = await domains.memories.readPrompt({ worldId, conversationId, instanceId }, id, remaining)
        remaining -= memory.promptBytes
        memories.push(memory)
      } catch (error) {
        if ((/** @type {{code?:string}} */ (error)).code === 'CONTEXT_BUDGET_EXCEEDED') break
        throw error
      }
    }
    return { actors, verified, relations, lorebook, memories }
  }

  /** @param {LifeModule} moduleId @param {string} task @param {{allowPrompt?:boolean}} [options] */
  const request = async (moduleId, task, options = {}) => {
    if (disposed || controller) throw fail('LIFE_REQUEST_UNAVAILABLE')
    if (!isAvailable()) return { status: /** @type {const} */ ('requires-unlock'), text: '' }
    if (auth.isLocked) {
      if (!options.allowPrompt || !candidate.ensureAccess) return { status: /** @type {const} */ ('requires-unlock'), text: '' }
      const unlocked = await candidate.ensureAccess()
      if (!unlocked) return { status: /** @type {const} */ ('cancelled'), text: '' }
      if (disposed || !isAvailable() || auth.isLocked) return { status: /** @type {const} */ ('requires-unlock'), text: '' }
    }
    if (typeof task !== 'string' || !task.trim() || task.length > 2000) throw fail('INVALID_LIFE_TASK')
    const ownerSession = auth.sessionRevision
    const ownGeneration = generation
    const owned = new AbortController()
    controller = owned
    const assert = () => {
      if (disposed || !isAvailable() || auth.isLocked || auth.sessionRevision !== ownerSession
        || generation !== ownGeneration || owned.signal.aborted) throw fail('KANATA_SESSION_EXPIRED')
    }
    try {
      const pre = await candidate.withDomains({ assertOwner: assert }, async domains => {
        const resolved = await domains.roleBindings.resolve(moduleId)
        if (resolved.status !== 'ready' || !resolved.binding) return { status: resolved.status }
        const { worldId, instanceId } = resolved.binding
        const grant = await domains.autonomy.getGrant(worldId, instanceId, moduleId)
        if (!grant?.read) return { status: /** @type {const} */ ('permission-required') }
        const allGrants = await domains.autonomy.grantsForActor(worldId, instanceId)
        const conversationId = await domains.autonomy.actorPrivateConversation(worldId, instanceId)
        if (!conversationId) throw fail('LIFE_CONVERSATION_UNAVAILABLE')
        const worldRecord = await domains.worlds.get(worldId)
        const conv = await domains.conversations.get({ worldId, conversationId })
        if (!worldRecord || worldRecord.world.archived || !conv) throw fail('LIFE_CONVERSATION_UNAVAILABLE')
        const knowledge = await readContextKnowledge(domains, worldId, conversationId, instanceId, moduleId, task)
        return {
          status: /** @type {const} */ ('ready'), resolved, grant, allGrants, conversationId, worldRecord, conv,
          ...knowledge,
        }
      })
      if (pre.status !== 'ready') return { status: pre.status, text: '' }
      assert()
      const { worldId, instanceId } = pre.resolved.binding
      const history = candidate.withRepositories
        ? await candidate.withRepositories({ assertOwner: assert }, messages =>
          messages.historyForSpeaker({ worldId, conversationId: pre.conversationId }, instanceId, 12))
        : /** @type {import('../features/chat/domain/kanataTypes').Message[]} */ ([])
      assert()
      const lifeScope = { worldId, instanceId, group: false, moduleId }
      const life = await collectKanataLifeContext({
        worlds: [pre.worldRecord.world], instances: pre.actors.instances, lifeGrants: pre.allGrants,
      }, lifeScope, readers, assert)
      assert()
      const postRead = await candidate.withDomains({ assertOwner: assert }, async domains => ({
        resolved: await domains.roleBindings.resolve(moduleId),
        grant: await domains.autonomy.getGrant(worldId, instanceId, moduleId),
        allGrants: await domains.autonomy.grantsForActor(worldId, instanceId),
      }))
      if (JSON.stringify(postRead.resolved) !== JSON.stringify(pre.resolved)
        || postRead.grant?.revision !== pre.grant.revision || !postRead.grant.read
        || !canUseKanataLifeSources({ lifeGrants: postRead.allGrants }, life.lifeSources, { worldId, instanceId, group: false })) {
        throw fail('LIFE_PERMISSION_REVISED')
      }
      const ownSource = { grantId: pre.grant.id, revision: pre.grant.revision, moduleId, instanceId, fingerprint: life.signature }
      const lifeSources = [...life.lifeSources, ownSource]
      const turnId = 'life-' + idFactory()
      const virtual = {
        id: turnId, worldId, conversationId: pre.conversationId, role: /** @type {const} */ ('user'),
        senderType: /** @type {const} */ ('user'), senderId: pre.worldRecord.identity.id,
        senderNameSnapshot: pre.worldRecord.identity.displayName, content: '生活模块任务：' + task,
        createdAt: clock(), revision: 1, status: /** @type {const} */ ('complete'), turnId, batchId: turnId,
      }
      const promptData = {
        ...pre.actors, worlds: [pre.worldRecord.world], identities: [pre.worldRecord.identity],
        messages: [...history, virtual], conversations: [pre.conv], memoryPolicies: [], lifeGrants: pre.allGrants,
        relationships: pre.relations.relationships, events: [], effects: [], memories: [], lorebookEntries: [],
      }
      const context = buildKanataConversationContext(promptData, pre.conversationId, instanceId, {
        lifeEntries: life.entries, lifeSources, repositoryHistory: true,
        historyMessageIds: [...history.map((/** @type {import('../features/chat/domain/kanataTypes').Message} */ m) => m.id), virtual.id],
        repositoryKnowledge: {
          memories: pre.memories, lorebook: pre.lorebook, events: pre.verified.events,
          hiddenTargetIds: new Set([...pre.verified.hiddenTargetIds, ...pre.relations.hiddenTargetIds]),
        },
      })
      const response = await completion({
        messages: context.messages, stream: false, maxTokens: 512, signal: owned.signal,
        async onAttempt(attempt) {
          assert()
          await candidate.withDomains({ assertOwner: assert }, domains => domains.usage.record({
            ...attempt, worldId, conversationId: pre.conversationId, instanceId, turnId, purpose: 'life',
          }))
          assert()
        },
      })
      assert()
      if (owned.signal.aborted) throw fail('ABORTED')
      const freshGrantsSnapshot = await candidate.withDomains({ assertOwner: assert }, domains =>
        domains.autonomy.grantsForActor(worldId, instanceId))
      const afterLife = await collectKanataLifeContext({
        worlds: [pre.worldRecord.world], instances: pre.actors.instances, lifeGrants: freshGrantsSnapshot,
      }, lifeScope, readers, assert)
      assert()
      const freshHistory = candidate.withRepositories
        ? await candidate.withRepositories({ assertOwner: assert }, messages =>
          messages.historyForSpeaker({ worldId, conversationId: pre.conversationId }, instanceId, 12))
        : /** @type {import('../features/chat/domain/kanataTypes').Message[]} */ ([])
      assert()
      await candidate.withDomains({ assertOwner: assert }, async domains => {
        const latestResolved = await domains.roleBindings.resolve(moduleId)
        const latestGrant = await domains.autonomy.getGrant(worldId, instanceId, moduleId)
        const latestAllGrants = await domains.autonomy.grantsForActor(worldId, instanceId)
        const latestWorld = await domains.worlds.get(worldId)
        const latestConv = await domains.conversations.get({ worldId, conversationId: pre.conversationId })
        const actor = await domains.characters.getInstance(worldId, instanceId)
        if (afterLife.signature !== life.signature
          || JSON.stringify(latestResolved) !== JSON.stringify(pre.resolved)
          || !latestGrant || latestGrant.revision !== pre.grant.revision || !latestGrant.read) throw fail('LIFE_PERMISSION_REVISED')
        if (!latestWorld || latestWorld.world.archived || !latestConv || actor?.revision !== context.instanceRevision) throw fail('STALE_CONTEXT')
        const freshKnowledge = await readContextKnowledge(domains, worldId, pre.conversationId, instanceId, moduleId, task)
        const freshPromptData = {
          ...freshKnowledge.actors, worlds: [latestWorld.world], identities: [latestWorld.identity],
          messages: [...freshHistory, virtual], conversations: [latestConv], memoryPolicies: [], lifeGrants: latestAllGrants,
          relationships: freshKnowledge.relations.relationships, events: [], effects: [], memories: [], lorebookEntries: [],
        }
        const freshContext = buildKanataConversationContext(freshPromptData, pre.conversationId, instanceId, {
          lifeEntries: afterLife.entries, lifeSources, repositoryHistory: true,
          historyMessageIds: [...freshHistory.map((/** @type {import('../features/chat/domain/kanataTypes').Message} */ m) => m.id), virtual.id],
          repositoryKnowledge: {
            memories: freshKnowledge.memories, lorebook: freshKnowledge.lorebook, events: freshKnowledge.verified.events,
            hiddenTargetIds: new Set([...freshKnowledge.verified.hiddenTargetIds, ...freshKnowledge.relations.hiddenTargetIds]),
          },
        })
        if (freshContext.knowledgeSignature !== context.knowledgeSignature
          || JSON.stringify(freshContext.messages) !== JSON.stringify(context.messages)) throw fail('STALE_CONTEXT')
        if (latestGrant.remember && canUseKanataLifeSources({ lifeGrants: latestAllGrants }, lifeSources, {
          worldId, instanceId, group: false, remember: true,
        })) {
          await domains.memories.save({
            id: 'memory-' + idFactory(), worldId, ownerType: 'character', ownerId: instanceId, layer: 'L3',
            key: 'life:' + moduleId + ':' + life.signature.slice(0, 16),
            content: response.content.slice(0, 4000), sourceRefs: [], status: 'candidate', revision: 1,
            visibility: 'private', knownBy: [instanceId], lifeSources, confidence: 'inference',
            conversationId: pre.conversationId,
          }, null)
        }
      })
      assert()
      return {
        status: /** @type {const} */ ('succeeded'),
        text: response.content,
        speakerName: resolveKanataCharacter({ ...pre.actors, worlds: [pre.worldRecord.world] }, instanceId).name,
        binding: pre.resolved.binding,
        sessionRevision: ownerSession,
      }
    } finally {
      if (controller === owned) controller = null
    }
  }

  return {
    request, cancel,
    isCurrent: (/** @type {number} */ revision) => !disposed && isAvailable() && !auth.isLocked && auth.sessionRevision === revision,
    dispose() {
      disposed = true
      invalidate()
      stopGeneration()
      stopAvailability()
    },
  }
}
