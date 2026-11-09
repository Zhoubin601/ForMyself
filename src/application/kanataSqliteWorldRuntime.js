// @ts-check
import { validateId } from '../features/chat/domain/kanataValidation.js'

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
      /** @template T @param {(domains:Domains)=>Promise<T>} action */
      const run = async (action, assertRequest = () => {}) => {
        const assertOwner = () => { assertCurrent(); assertRequest() }
        assertOwner()
        const result = await candidate.withDomains({ assertOwner }, action)
        assertOwner()
        return result
      }
      return {
        worldId, assertCurrent,
        read: () => run(domains => domains.worlds.get(worldId)),
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
        /** @param {number} revision @param {Parameters<Domains['worlds']['updateIdentity']>[2]} fields */
        updateIdentity: (revision, fields) => run(domains => domains.worlds.updateIdentity(worldId, revision, fields)),
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
        /** @param {Parameters<Domains['events']['propose']>[0]} fields @param {string} commandId */
        proposeEvent: (fields, commandId) => run(domains => {
          if (fields.worldId !== worldId) throw new Error('KANATA_WORLD_OWNER_EXPIRED')
          return domains.events.propose(fields, commandId)
        }),
        /** @param {string} eventId @param {number} revision */
        commitEvent: (eventId, revision) => run(domains => domains.events.commit(worldId, eventId, revision)),
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
