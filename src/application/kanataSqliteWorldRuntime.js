// @ts-check
import { validateId } from '../features/chat/domain/kanataValidation.js'
import { readKanataRoleLore } from '../features/chat/lorebook/kanataRoleLore.js'

/** @typedef {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataSqliteDomains} Domains */
/** @typedef {Pick<ReturnType<typeof import('./kanataSqliteCandidate.js').createKanataSqliteCandidate>,'withDomains'>} Candidate */

/** Candidate composition for the world, knowledge and activity surfaces. A page owner
 * binds asynchronous commands to its selected world before a lease is requested.
 * @param {{candidate:Candidate,clock?:()=>number,sessionGeneration?:()=>number,isAvailable?:()=>boolean, onGrantChanged?:()=>Promise<void>}} options */
export function createKanataSqliteWorldRuntime({ candidate, clock = Date.now, sessionGeneration = () => 0, isAvailable = () => true, onGrantChanged = async () => {} }) {
  let generation = 0
  let disposed = false
  let selected = ''
  return {
    /** @param {number} [cursor] @param {()=>void} [assertRequest] */
    async listWorlds(cursor, assertRequest = () => {}) {
      const session = sessionGeneration()
      const assertOwner = () => {
        assertRequest()
        if (disposed || !isAvailable() || sessionGeneration() !== session) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
      }
      const result = await candidate.withDomains({ assertOwner }, domains => domains.managementView.worlds(cursor))
      assertOwner()
      return result
    },
    /** @param {Parameters<Domains['worlds']['createForDataset']>[0]} fields
     * @param {Parameters<Domains['worlds']['createForDataset']>[1]} options @param {()=>void} guard */
    async createWorld(fields,options,guard) {
      const session=sessionGeneration(), selectedGeneration=generation
      const assertOwner=()=>{
        guard()
        if(disposed||!isAvailable()||sessionGeneration()!==session||selectedGeneration!==generation||selected) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
      }
      assertOwner()
      const result=await candidate.withDomains({assertOwner},domains=>domains.worlds.createForDataset(fields,options))
      assertOwner()
      return result.world.id
    },
    openCards() {
      const session = sessionGeneration()
      let active = true
      /** @template T @param {()=>void} guard @param {(domains:Domains)=>Promise<T>} action */
      const run = async (guard, action) => {
        const assertOwner = () => {
          if (!active || disposed || !isAvailable() || sessionGeneration() !== session) throw new Error('KANATA_CARD_OWNER_EXPIRED')
          guard()
        }
        const result = await candidate.withDomains({ assertOwner }, action)
        assertOwner()
        return result
      }
      /** @param {string} key */
      const options = key => ({ key, now: clock(), timeZone: 'UTC', idFactory: (/** @type {string} */ kind) => kind + '-' + crypto.randomUUID() })
      return {
        /** @param {string|undefined} cursor @param {()=>void} guard */
        list: (cursor, guard) => run(guard, domains => domains.characters.summaries(cursor)),
        /** @param {string} id @param {string|undefined} versionId @param {()=>void} guard */
        read: (id, versionId, guard) => run(guard, domains => domains.characters.definition(id, versionId)),
        /** @param {string} id @param {number|undefined} cursor @param {()=>void} guard */
        versions: (id, cursor, guard) => run(guard, domains => domains.characters.versionHeaders(id, cursor)),
        /** @param {Parameters<Domains['characters']['importCard']>[0]} value @param {string} key @param {()=>void} guard */
        importCard: (value, key, guard) => run(guard, async domains => (await domains.characters.importCard(value, options(key))).card.id),
        /** @param {string} id @param {Parameters<Domains['characters']['publish']>[1]} definition @param {string} expected
         * @param {string} key @param {()=>void} guard */
        publish: (id, definition, expected, key, guard) => run(guard, async domains =>
          (await domains.characters.publish(id, definition, expected, options(key))).id),
        /** @param {string} id @param {string} expected @param {boolean} archived @param {()=>void} guard */
        archive: (id, expected, archived, guard) => run(guard, domains => domains.characters.archiveCard(id, expected, archived, !archived)),
        dispose() { active = false },
      }
    },
    openBindings() {
      const session = sessionGeneration()
      let active = true
      /** @template T @param {()=>void} guard @param {(domains:Domains)=>Promise<T>} action */
      const run = async (guard, action) => {
        const assertOwner = () => {
          if (!active || disposed || !isAvailable() || sessionGeneration() !== session) throw new Error('KANATA_BINDING_OWNER_EXPIRED')
          guard()
        }
        const result = await candidate.withDomains({ assertOwner }, action)
        assertOwner()
        return result
      }
      return {
        /** @param {()=>void} guard */
        read: guard => run(guard, domains => domains.roleBindings.read()),
        /** @param {number|undefined} cursor @param {()=>void} guard */
        worlds: (cursor, guard) => run(guard, domains => domains.managementView.worlds(cursor)),
        /** @param {string} worldId @param {string|undefined} cursor @param {()=>void} guard */
        actors: (worldId, cursor, guard) => run(guard, domains => domains.managementView.list(worldId, 'actors', cursor)),
        /** @param {Parameters<Domains['roleBindings']['set']>[0]} scope
         * @param {Parameters<Domains['roleBindings']['set']>[1]} selection @param {number} revision @param {()=>void} guard */
        async set(scope, selection, revision, guard) {
          const result = await run(guard, domains => domains.roleBindings.set(scope, selection, revision))
          await onGrantChanged()
          return result
        },
        dispose() { active = false },
      }
    },
    /** @param {string} worldId */
    select(worldId) {
      validateId(worldId, 'worldId')
      if (disposed || !isAvailable()) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
      selected = worldId
      const ownGeneration = ++generation
      const session = sessionGeneration()
      const assertCurrent = () => {
        if (disposed || !isAvailable() || sessionGeneration() !== session || generation !== ownGeneration || selected !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
      }
      /** @template T @param {(domains:Domains)=>Promise<T>} action @param {()=>void} [assertRequest] */
      const run = async (action, assertRequest = () => {}) => {
        const assertOwner = () => { assertCurrent(); assertRequest() }
        assertOwner()
        const result = await candidate.withDomains({ assertOwner }, action)
        assertOwner()
        return result
      }
      return {
        worldId, assertCurrent,
        /** @param {()=>void} [assertRequest] */
        read: (assertRequest) => run(domains => domains.worlds.get(worldId), assertRequest),
        overview: () => run(domains => domains.managementView.world(worldId)),
        /** @param {Parameters<Domains['managementView']['list']>[1]} section @param {string} [cursor] @param {()=>void} [assertRequest] */
        list: (section, cursor, assertRequest) => run(domains => domains.managementView.list(worldId, section, cursor), assertRequest),
        /** @param {string} actor @param {()=>void} [assertRequest] */
        grants: (actor, assertRequest) => run(domains => domains.autonomy.grantsForActor(worldId, actor), assertRequest),
        /** @param {string} actor @param {Parameters<Domains['autonomy']['setGrant']>[2]} moduleId
         * @param {number|null} revision @param {Parameters<Domains['autonomy']['setGrant']>[4]} flags */
        async setGrant(actor, moduleId, revision, flags) {
          const saved = await run(domains => domains.autonomy.setGrant(worldId, actor, moduleId, revision, flags))
          if (saved.revision !== revision) await onGrantChanged()
          return saved
        },
        /** @param {Parameters<Domains['conversations']['createGroup']>[1]} fields
         * @param {Parameters<Domains['conversations']['createGroup']>[2]} options @param {()=>void} assertRequest */
        createGroup: (fields, options, assertRequest) => run(domains => domains.conversations.createGroup(worldId, fields, options), assertRequest),
        /** @param {string} id @param {()=>void} guard */
        groupEdit: (id, guard) => run(domains => domains.conversations.groupEdit({ worldId, conversationId:id }), guard),
        /** @param {string} id @param {number} revision @param {number|undefined} cursor @param {()=>void} guard */
        groupMemberPage: (id, revision, cursor, guard) => run(domains =>
          domains.conversations.groupMemberPage({ worldId, conversationId:id }, revision, cursor), guard),
        /** @param {string} id @param {import('./contracts').KanataGroupMemberEdit} input @param {()=>void} guard */
        editGroupMembers: (id, input, guard) => run(domains =>
          domains.conversations.editGroupMembers({ worldId, conversationId:id }, input), guard),
        /** @param {string} actor @param {string} text @param {number} offset @param {()=>void} guard */
        previewLore: (actor,text,offset,guard) => run(async domains => {
          if (typeof text!=='string'||text.length>4000||!Number.isSafeInteger(offset)||offset<0||offset%50!==0) throw new Error('INVALID_LORE_PREVIEW')
          const results = await readKanataRoleLore(domains.lorebook,worldId,actor,text)
          return { entries:results.slice(offset,offset+50), hasMore:offset+50<results.length }
        },guard),
        /** @param {string} id @param {()=>void} [assertRequest] */
        lore: (id, assertRequest) => run(domains => domains.lorebook.getManaged(worldId, id), assertRequest),
        /** @param {Parameters<Domains['lorebook']['save']>[0]} entry @param {number|null} revision @param {()=>void} assertRequest */
        saveLore: (entry, revision, assertRequest) => run(domains => {
          if (entry.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.lorebook.save(entry, revision)
        }, assertRequest),
        /** @param {string} id @param {number} revision @param {()=>void} assertRequest */
        deleteLore: (id, revision, assertRequest) => run(domains => domains.lorebook.delete(worldId, id, revision), assertRequest),
        /** @param {string} id @param {string} instanceId @param {()=>void} assertRequest */
        memoryDetail: (id, instanceId, assertRequest) => run(domains => domains.memories.managedDetailFor({ worldId, instanceId }, id), assertRequest),
        /** @param {string} id @param {string} instanceId @param {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataMemorySourceCursor|undefined} cursor
         * @param {()=>void} assertRequest */
        memorySources: (id, instanceId, cursor, assertRequest) => run(domains => domains.memories.sourcePage({ worldId, instanceId }, id, cursor, true), assertRequest),
        /** @param {string} id @param {string} instanceId @param {Parameters<Domains['memories']['resolveSource']>[2]} source
         * @param {()=>void} assertRequest */
        memorySource: (id, instanceId, source, assertRequest) => run(domains => domains.memories.resolveSource({ worldId, instanceId }, id, source, true), assertRequest),
        /** @param {string} id @param {string} instanceId @param {import('./contracts').KanataMemoryConflictCursor|undefined} cursor @param {()=>void} guard */
        memoryConflicts: (id,instanceId,cursor,guard) =>
          run(domains=>domains.memories.previewConflicts({worldId,instanceId},id,cursor),guard),
        /** @param {string} instanceId @param {import('./contracts').KanataMemoryConflictPlan} plan @param {string} key @param {()=>void} guard */
        confirmMemoryConflicts: (instanceId,plan,key,guard) =>
          run(domains=>domains.memories.confirmConflicts({worldId,instanceId},plan,key),guard),
        /** @param {string} id @param {'cause'|'consequence'} direction
         * @param {import('../features/chat/storage/sqlite/kanataDomainTypes').KanataEventGraphCursor|undefined} cursor @param {()=>void} assertRequest */
        eventGraph: (id, direction, cursor, assertRequest) => run(domains => domains.events.graphPage(worldId, id, direction, cursor), assertRequest),
        /** @param {number} revision @param {Parameters<Domains['worlds']['updateIdentity']>[2]} fields @param {()=>void} [assertRequest] */
        updateIdentity: (revision, fields, assertRequest) => run(domains => domains.worlds.updateIdentity(worldId, revision, fields), assertRequest),
        /** @param {string} name @param {number} revision */
        rename: (name, revision) => run(domains => domains.worlds.rename(worldId, revision, name)),
        /** @param {boolean} archived @param {number} revision */
        archive: (archived, revision) => run(domains => domains.worlds.archive(worldId, revision, archived)),
        /** @param {Parameters<Domains['autonomy']['configure']>[2]} fields @param {number} revision */
        configure: (fields, revision) => run(domains => domains.autonomy.configure(worldId, revision, fields, clock())),
        /** @param {Parameters<Domains['autonomy']['setActivity']>[2]} flags @param {number} revision */
        setActivity: (flags, revision) => run(domains => domains.autonomy.setActivity(worldId, revision, flags, clock())),
        async advance() {
          const now = clock()
          let windows = 0, skippedMs = 0
          while (windows < 6) {
            const plan = await run(domains => domains.autonomy.plan(worldId, now))
            if (!plan) break
            await run(domains => domains.autonomy.completeWindow(plan, now))
            windows++
            skippedMs += plan.skippedMs
          }
          return { windows, skippedMs }
        },
        /** @param {string} id @param {()=>void} guard */
        eventDetail: (id,guard) => run(domains=>domains.events.managedEvent(worldId,id),guard),
        /** @param {string} id @param {import('./contracts').KanataEventRevocationCursor|undefined} cursor @param {()=>void} guard */
        openRevocation: (id,cursor,guard) => run(domains=>domains.events.openRevocation(worldId,id,cursor),guard),
        /** @param {import('./contracts').KanataEventRevocationPlan} plan
         * @param {import('./contracts').KanataEventRevocationDecision|undefined} decision @param {string} key @param {()=>void} guard */
        confirmRevocation: (plan,decision,key,guard) => run(domains=>{
          if(plan.worldId!==worldId)throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.events.confirmRevocation(plan,decision,key)
        },guard),
        /** @param {string} id @param {string|undefined} after @param {()=>void} guard */
        revocationAudits: (id,after,guard) => run(domains=>domains.events.revocationAudits(worldId,id,after),guard),
        /** @param {Parameters<Domains['events']['propose']>[0]} fields @param {string} commandId @param {()=>void} [guard] */
        proposeEvent: (fields, commandId, guard) => run(domains => {
          if (fields.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.events.propose(fields, commandId)
        },guard),
        /** @param {string} eventId @param {number} revision @param {()=>void} [guard] */
        commitEvent: (eventId, revision, guard) => run(domains => domains.events.commit(worldId, eventId, revision),guard),
        /** @param {string} eventId */
        previewRevoke: eventId => run(domains => domains.events.preview(worldId, eventId)),
        /** @param {Parameters<Domains['events']['revoke']>[0]} plan @param {Parameters<Domains['events']['revoke']>[1]} decision */
        revokeEvent: (plan, decision) => run(domains => {
          if (plan.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.events.revoke(plan, decision)
        }),
        /** @param {Parameters<Domains['events']['correct']>[0]} plan @param {Parameters<Domains['events']['correct']>[1]} decision @param {string} summary */
        correctEvent: (plan, decision, summary) => run(domains => {
          if (plan.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.events.correct(plan, decision, summary)
        }),
        /** @param {Parameters<Domains['memories']['save']>[0]} memory @param {number|null} revision */
        saveMemory: (memory, revision) => run(domains => {
          if (memory.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.memories.save(memory, revision)
        }),
        /** @param {string} instanceId @param {string} id @param {number} revision @param {string} recipientId
         * @param {string} key @param {()=>void} guard */
        shareManagedMemory: (instanceId,id,revision,recipientId,key,guard) =>
          run(domains=>domains.memories.shareManaged({worldId,instanceId},id,revision,recipientId,key),guard),
        /** @param {string} instanceId @param {string} id @param {number} revision @param {string} key @param {()=>void} guard */
        removeOwnedMemory: (instanceId,id,revision,key,guard) =>
          run(domains=>domains.memories.removeOwned({worldId,instanceId},id,revision,key),guard),
        /** @param {string} instanceId @param {string} memoryId @param {string} recipientId @param {string} commandId */
        shareMemory: (instanceId, memoryId, recipientId, commandId) => run(domains =>
          domains.memories.share({ worldId, instanceId }, memoryId, recipientId, commandId)),
        /** @param {string} instanceId @param {string} memoryId @param {Parameters<Domains['memories']['resolveSource']>[2]} source @param {string} [conversationId] */
        resolveSource: (instanceId, memoryId, source, conversationId) => run(domains => domains.memories.resolveSource({
          worldId, instanceId, ...(conversationId && { conversationId }),
        }, memoryId, source)),
      }
    },
    clearSelection() { selected = ''; generation++ },
    dispose() { disposed = true; selected = ''; generation++ },
  }
}
