// @ts-check
import { registerPlugin } from '@capacitor/core'
import { sha256Text } from '../../shared/crypto/sha256Text.js'

/** @typedef {import('./kanataSqliteTypes').KanataSqliteBridge} Bridge */
/** @typedef {import('./kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('./kanataSqliteTypes').KanataSqliteTransaction} Transaction */
/** @typedef {import('./kanataSqliteTypes').KanataSqliteContext} Context */
/** @typedef {import('./kanataSqliteTypes').KanataSqliteOwner} Owner */

const plugin = registerPlugin('KanataSqlite')
const nativeCodes = new Set([
  'NOT_ACTIVATED', 'STATE_UNKNOWN', 'LEGACY_PRESENT', 'INCOMPLETE_CREATION',
  'UNLOCK_FAILED', 'CHALLENGE_INVALID', 'LEASE_REVOKED', 'TRANSACTION_BUSY',
  'TRANSACTION_FAILED', 'ROLLBACK_FAILED', 'CLOSE_FAILED', 'INTEGRITY_FAILED',
  'STATEMENT_DENIED', 'DATABASE_ABSENT',
].map(code => 'KANATA_SQLITE_' + code))
for (const code of ['FUTURE_VERSION', 'METADATA_INVALID', 'WRONG_DATABASE', 'STRUCTURE_MISMATCH',
  'JOURNAL_MISMATCH', 'TIME_JOURNAL_MISMATCH', 'AUDIT_CONFLICT', 'ENTITY_REGISTRY_CONFLICT']) {
  nativeCodes.add('KANATA_SCHEMA_' + code)
}

/** @param {string} code */
function sqliteError(code) {
  return Object.assign(new Error(code), { code, rollbackFailed: /_(ROLLBACK|CLOSE)_FAILED$/.test(code) })
}

/** @template T @param {Promise<T>} request @returns {Promise<T>} */
async function native(request) {
  try { return await request }
  catch (error) {
    const code = /** @type {{code?: string} | null} */ (error)?.code
    throw sqliteError(code && nativeCodes.has(code) ? code : 'KANATA_SQLITE_BRIDGE_FAILED')
  }
}

/** No password or database handle is retained across protected operations.
 * @param {{ initialize(operation: Operation): Promise<void>, bridge?: Bridge }} options
 * @returns {import('./kanataSqliteTypes').KanataSqliteDriver} */
export function createAndroidKanataSqliteDriver({ initialize, bridge = /** @type {Bridge} */ (plugin) }) {
  let generation = 0
  let occupied = false
  let poisoned = false
  /** @type {Promise<void> | undefined} */
  let closing
  const release = () => {
    generation++
    occupied = false
    if (closing) return closing
    const close = native(bridge.close()).catch(() => {
      poisoned = true
      throw sqliteError('KANATA_SQLITE_CLOSE_FAILED')
    })
    closing = close
    void close.finally(() => { if (closing === close) closing = undefined }).catch(() => {})
    return close
  }

  /** @param {Context['assertCurrent']} assertCurrent @param {number} opened @param {Owner} owner @returns {Operation} */
  function operation(assertCurrent, opened, owner) {
    let busy = false
    const current = () => {
      if (opened !== generation || poisoned) throw sqliteError('KANATA_SQLITE_LEASE_REVOKED')
      assertCurrent()
    }
    /** @type {Operation['transaction']} */
    const transaction = async action => {
      current()
      if (busy) throw sqliteError('KANATA_SQLITE_TRANSACTION_BUSY')
      busy = true
      /** @type {import('./kanataSqliteTypes').KanataSqliteCommand | undefined} */
      let command
      let live = true
      let failed = false
      /** @type {Promise<unknown> | undefined} */
      let inFlight
      /** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
      const statement = async run => {
        current()
        if (!live || inFlight || failed) {
          failed = true
          throw sqliteError('KANATA_SQLITE_TRANSACTION_BUSY')
        }
        const pending = native(run())
        inFlight = pending
        try {
          const value = await pending
          current()
          return value
        } catch (error) {
          failed = true
          throw error
        } finally { inFlight = undefined }
      }
      try {
        command = { ...owner, ...await native(bridge.begin(owner)) }
        current()
        const base = command
        /** @type {Transaction} */
        const tx = {
          query: async (sql, parameters = []) => (await statement(() => bridge.query({
            ...base, statement: sha256Text(sql), parameters,
          }))).rows,
          execute: (sql, parameters = []) => statement(() => bridge.execute({
            ...base, statement: sha256Text(sql), parameters,
          })),
        }
        const result = await action(tx)
        live = false
        if (inFlight || failed) throw sqliteError('KANATA_SQLITE_TRANSACTION_FAILED')
        current()
        try { await native(bridge.commit(base)) }
        catch (error) {
          // Native COMMIT owns its rollback once it has accepted the transaction.
          if (/** @type {{rollbackFailed?: boolean}} */ (error)?.rollbackFailed) poisoned = true
          if (/** @type {{code?: string}} */ (error)?.code === 'KANATA_SQLITE_TRANSACTION_FAILED') command = undefined
          throw error
        }
        command = undefined
        current()
        return result
      } catch (error) {
        live = false
        await inFlight?.catch(() => {})
        if (command && opened === generation && !poisoned) {
          try { await native(bridge.rollback(command)) }
          catch (rollbackError) {
            if (/** @type {{code?: string}} */ (rollbackError)?.code !== 'KANATA_SQLITE_LEASE_REVOKED') {
              poisoned = true
              await release().catch(() => {})
              throw sqliteError('KANATA_SQLITE_ROLLBACK_FAILED')
            }
          }
        }
        throw error
      } finally { busy = false }
    }
    return {
      transaction,
      async health() {
        current()
        if (busy) throw sqliteError('KANATA_SQLITE_TRANSACTION_BUSY')
        const result = await native(bridge.health(owner))
        current()
        return result
      },
    }
  }

  return {
    release,
    async open(context, { create }) {
      if (occupied) throw sqliteError('KANATA_SQLITE_TRANSACTION_BUSY')
      const opened = ++generation
      occupied = true
      const current = () => {
        if (generation !== opened || poisoned) throw sqliteError('KANATA_SQLITE_LEASE_REVOKED')
        context.assertCurrent()
      }
      try {
        await closing
        current()
        const owner = { sessionRevision: context.sessionRevision, ownerGeneration: context.ownerGeneration }
        const { token, salt } = await native(bridge.prepare({ ...owner, create }))
        current()
        const bytes = await context.deriveKey(salt)
        /** @type {string} */
        let lease
        try {
          current()
          if (bytes.length !== 32) throw sqliteError('KANATA_SQLITE_UNLOCK_FAILED')
          const kek = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
          ;({ lease } = await native(bridge.unlock({ ...owner, token, kek })))
        } finally { bytes.fill(0) }
        current()
        const bound = operation(context.assertCurrent, opened, { ...owner, lease })
        await initialize(bound)
        current()
        await native(bridge.completeOpen({ ...owner, lease }))
        current()
        return bound
      } catch (error) {
        if (opened === generation) await release()
        throw error
      }
    },
  }
}
