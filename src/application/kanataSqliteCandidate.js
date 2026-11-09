// @ts-check
import { computed, shallowRef, watch } from 'vue'
import { App } from '@capacitor/app'
import { assertOrdinaryWriteAllowed, restoreState } from '../platform/storage/restoreState.js'
import { deriveKanataSqliteKek } from '../platform/security/kanataSqliteKek.js'
import { createAndroidKanataSqliteDriver } from '../platform/storage/androidKanataSqliteDriver.js'
import { kanataSchemaAdapter } from '../features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { KanataSchemaError, migrateKanataSchema } from '../features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { createKanataMessageRepository } from '../features/chat/storage/sqlite/kanataMessageRepository.js'
import { createKanataConversationRepository } from '../features/chat/storage/sqlite/kanataConversationRepository.js'
import { createKanataDeferredReplyRepository } from '../features/chat/storage/sqlite/kanataDeferredReplyRepository.js'

import { createKanataChatViewRepository } from '../features/chat/storage/sqlite/kanataChatViewRepository.js'
import { createKanataSqliteWorldRuntime } from './kanataSqliteWorldRuntime.js'
import { createKanataSqliteDomains } from '../features/chat/storage/sqlite/kanataSqliteDomains.js'

/** Production stays on the existing protected legacy repository. */
export const kanataCanonicalStorage = 'legacy'

/** Explicit synthetic composition, outside the production startup and recovery paths.
 * @param {{
 *  syntheticOnly: true,
 *  access: Pick<ReturnType<typeof import('../stores/protectedAccess.js').useProtectedAccessStore>, 'runOperation'>,
 *  auth: Pick<ReturnType<typeof import('../stores/auth.js').useAuthStore>, 'sessionRevision' | 'isLocked'>,
 *  bridge?: import('../platform/storage/kanataSqliteTypes').KanataSqliteBridge,
 * }} options */
export function createKanataSqliteCandidate({ syntheticOnly, access, auth, bridge }) {
  if (syntheticOnly !== true) throw new Error('KANATA_SQLITE_NOT_ACTIVATED')
  const driver = createAndroidKanataSqliteDriver({
    bridge,
    initialize: async operation => {
      await migrateKanataSchema(kanataSchemaAdapter(operation))
    },
  })
  const generation = shallowRef(0)
  const foreground = shallowRef(true)
  let disposed = false

  /** @type {import('../platform/storage/kanataSqliteTypes').KanataSqliteOperation | undefined} */
  let connection
  const release = () => {
    connection = undefined
    generation.value++
    return driver.release()
  }
  const stop = watch(() => [auth.sessionRevision, auth.isLocked, restoreState.blocked, restoreState.busy], () => {
    void release().catch(() => {})
  }, { flush: 'sync' })
  const appListener = App.addListener('appStateChange', ({ isActive }) => {
    if (foreground.value === isActive) return
    foreground.value = isActive
    if (!isActive) void release().catch(() => {})
  }).catch(() => undefined)
  const isAvailable = () => !disposed && foreground.value && !auth.isLocked && !restoreState.blocked && !restoreState.busy
  /** @template T @param {{create?:boolean, assertOwner?: () => void}} options
   * @param {(operation: import('../platform/storage/kanataSqliteTypes').KanataSqliteOperation) => Promise<T>} action */
  async function run({ create = false, assertOwner = () => {} }, action) {
    assertOwner()
    const requestedGeneration = generation.value
    const requestedRevision = auth.sessionRevision
    const result = await access.runOperation(['chat'], async (/** @type {string} */ password, /** @type {number} */ sessionRevision) => {
      if (requestedRevision !== sessionRevision) throw new Error('KANATA_SQLITE_SESSION_CHANGED')
      const assertCurrent = sessionGuard(requestedGeneration, sessionRevision)
      assertCurrent()
      assertOwner()
      let leased = true
      const assertLeased = () => {
        if (!leased) throw new Error('KANATA_SQLITE_LEASE_REVOKED')
        assertCurrent()
        assertOwner()
      }
      try {
        if (create && connection) throw new Error('KANATA_SQLITE_INCOMPLETE_CREATION')
        if (!connection) {
          const opened = await driver.open({
            sessionRevision,
            ownerGeneration: requestedGeneration,
            assertCurrent,
            deriveKey: salt => deriveKanataSqliteKek(password, salt),
          }, { create })
          assertCurrent()
          connection = opened
        }
        const base = connection
        /** @type {import('../platform/storage/kanataSqliteTypes').KanataSqliteOperation} */
        const operation = {
          transaction: async work => {
            assertLeased()
            return base.transaction(async tx => {
              const value = await work({
                async query(sql, parameters) {
                  assertLeased()
                  const rows = await tx.query(sql, parameters)
                  assertLeased()
                  return rows
                },
                async execute(sql, parameters) {
                  assertLeased()
                  const result = await tx.execute(sql, parameters)
                  assertLeased()
                  return result
                },
              })
              assertLeased()
              return value
            })
          },
          health: async () => {
            assertLeased()
            const value = await base.health()
            assertLeased()
            return value
          },
        }
        assertLeased()
        const value = await action(operation)
        assertLeased()
        return { value }
      } catch (error) {
        const code = /** @type {{code?:string}} */ (error)?.code
        if (code === 'KANATA_SQLITE_LEASE_REVOKED' || code === 'KANATA_SQLITE_ROLLBACK_FAILED') {
          await release()
        }
        if (error instanceof KanataSchemaError && (restoreState.blocked || restoreState.busy)) {
          throw new Error('KANATA_SQLITE_STATE_UNKNOWN')
        }
        throw error
      } finally {
        leased = false
      }
    })
    if (!result) throw new Error('KANATA_SQLITE_LEASE_REVOKED')
    if (auth.sessionRevision !== requestedRevision || generation.value !== requestedGeneration || disposed) {
      throw new Error('KANATA_SQLITE_SESSION_CHANGED')
    }
    assertOwner()
    return result.value
  }
  /** Construct the connection guard outside the password-bearing operation callback.
   * @param {number} opened @param {number} revision */
  function sessionGuard(opened, revision) {
    return () => {
      if (disposed || auth.isLocked || auth.sessionRevision !== revision || generation.value !== opened || !foreground.value) {
        throw new Error('KANATA_SQLITE_SESSION_CHANGED')
      }
      assertOrdinaryWriteAllowed()
      if (restoreState.busy) throw new Error('KANATA_SQLITE_STATE_UNKNOWN')
    }
  }
  /** @template T @param {{assertOwner?: () => void}} options
   * @param {(messages:import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageRepository,
   * conversations:import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataConversationRepository,
   * deferred:ReturnType<typeof createKanataDeferredReplyRepository>,
   * domains:ReturnType<typeof createKanataSqliteDomains>) => Promise<T>} action */
  const withRepositories = (options, action) => run(options, operation => action(
    createKanataMessageRepository(operation, { id: () => 'audit-' + crypto.randomUUID(), clock: Date.now }),
    createKanataConversationRepository(operation),
    createKanataDeferredReplyRepository(operation),
    createKanataSqliteDomains(operation, { id: () => crypto.randomUUID(), clock: Date.now }),
  ))
  /** @template T @param {{assertOwner?:()=>void}} options
   * @param {(domains:ReturnType<typeof createKanataSqliteDomains>)=>Promise<T>} action */
  const withDomains = (options, action) => run(options, operation =>
    action(createKanataSqliteDomains(operation, { id: () => crypto.randomUUID(), clock: Date.now })))
  return {
    run,
    withRepositories,
    withDomains,
    isAvailable,
    generation: computed(() => generation.value),
    /** @param {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageScope & {assertOwner():void}} request */
    loadConversationView: request => run(request, operation => createKanataChatViewRepository(operation).load(request)),
    /** @param {import('../features/chat/storage/sqlite/kanataRepositoryTypes').KanataMessageScope & {assertOwner():void}} request @param {number} cursor */
    readConversationMembers: (request, cursor) => run(request, operation => createKanataChatViewRepository(operation).members(request, cursor)),
    /** @param {()=>number} [clock] */
    createWorldRuntime: clock => createKanataSqliteWorldRuntime({ candidate: { withDomains }, clock, sessionGeneration: () => generation.value, isAvailable, onGrantChanged: release }),
    release,
    async dispose() {
      disposed = true
      stop()
      try { await release() }
      finally { await (await appListener)?.remove() }
    },
  }
}
