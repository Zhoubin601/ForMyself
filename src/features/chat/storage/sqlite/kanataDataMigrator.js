// @ts-check
import { KANATA_SCHEMA_VERSION } from './kanataSchema.js'
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'

export const KANATA_DATA_MIGRATION_ID = 'kanata-json-import-v1'
export const KANATA_DATA_MIGRATION_MAX_BATCH_SIZE = 128
const MAX_CURSOR_JSON_LENGTH = 16 * 1024
const COMPLETE_COLLECTION = '__complete__'
const fail = code => Object.assign(new Error(code), { code })
const validFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value)

/** Fingerprint the encrypted canonical header and every immutable encrypted archive descriptor.
 * Plaintext, password and archive bodies are deliberately excluded.
 * @param {string} mainCiphertextFingerprint
 * @param {readonly {version:number,key:string,worldId:string,conversationId:string,bytes:number,index:string,messages:readonly {id:string,revision:number,createdAt:number}[]}[]} archives
 */
export function kanataMigrationSourceFingerprint(mainCiphertextFingerprint, archives = []) {
  if (!validFingerprint(mainCiphertextFingerprint) || !Array.isArray(archives)) throw fail('KANATA_MIGRATION_SOURCE_INVALID')
  const pages = archives.map(page => {
    if (!page || page.version !== 1 || !validFingerprint(page.key) ||
      typeof page.worldId !== 'string' || !page.worldId ||
      typeof page.conversationId !== 'string' || !page.conversationId ||
      !Number.isSafeInteger(page.bytes) || page.bytes <= 0 ||
      typeof page.index !== 'string' || !/^[a-f0-9]{1024}$/.test(page.index) ||
      !Array.isArray(page.messages)) throw fail('KANATA_MIGRATION_SOURCE_INVALID')
    const messages = page.messages.map(message => {
      if (!message || typeof message.id !== 'string' || !message.id ||
        !Number.isSafeInteger(message.revision) || message.revision < 1 ||
        !Number.isSafeInteger(message.createdAt) || message.createdAt < 0) {
        throw fail('KANATA_MIGRATION_SOURCE_INVALID')
      }
      return [message.id, message.revision, message.createdAt]
    })
    return [page.version, page.key, page.worldId, page.conversationId, page.bytes, page.index, messages]
  })
  if (new Set(pages.map(page => page[1])).size !== pages.length) throw fail('KANATA_MIGRATION_SOURCE_INVALID')
  return sha256Text(JSON.stringify([KANATA_DATA_MIGRATION_ID, mainCiphertextFingerprint, pages]))
}

function encodeCursor(cursor) {
  let value
  try { value = JSON.stringify(cursor) } catch { throw fail('KANATA_MIGRATION_CURSOR_INVALID') }
  if (typeof value !== 'string' || value.length > MAX_CURSOR_JSON_LENGTH) throw fail('KANATA_MIGRATION_CURSOR_INVALID')
  try { JSON.parse(value) } catch { throw fail('KANATA_MIGRATION_CURSOR_INVALID') }
  return value
}
function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > MAX_CURSOR_JSON_LENGTH) throw fail('KANATA_MIGRATION_JOURNAL_CORRUPTED')
  try { return JSON.parse(value) } catch { throw fail('KANATA_MIGRATION_JOURNAL_CORRUPTED') }
}
function journalId(collection) {
  const id = KANATA_DATA_MIGRATION_ID + ':' + collection
  if (id.length > 200) throw fail('KANATA_MIGRATION_COLLECTION_INVALID')
  return id
}
function validateCollection(collection) {
  if (!collection || typeof collection !== 'object' ||
    typeof collection.name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(collection.name) ||
    typeof collection.readBatch !== 'function' || typeof collection.write !== 'function' ||
    typeof collection.verify !== 'function' ||
    !Number.isSafeInteger(collection.expectedCount) || collection.expectedCount < 0) {
    throw fail('KANATA_MIGRATION_COLLECTION_INVALID')
  }
}
function validateJournal(row, sourceFingerprint, targetSchemaVersion, collection) {
  if (!row || row.source_fingerprint !== sourceFingerprint) throw fail('KANATA_MIGRATION_SOURCE_CHANGED')
  if (Number(row.target_schema_version) !== targetSchemaVersion || row.collection !== collection) {
    throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
  }
  if (!['pending', 'running', 'complete', 'failed'].includes(row.state) ||
    !Number.isSafeInteger(Number(row.imported_count)) || Number(row.imported_count) < 0) {
    throw fail('KANATA_MIGRATION_JOURNAL_CORRUPTED')
  }
  decodeCursor(row.cursor_json)
  return {
    cursorText: row.cursor_json,
    cursor: decodeCursor(row.cursor_json),
    importedCount: Number(row.imported_count),
    state: row.state,
  }
}
async function assertTargetSchema(tx, targetSchemaVersion) {
  const versions = await tx.query('PRAGMA user_version')
  const foreignKeys = await tx.query('PRAGMA foreign_keys')
  if (versions.length !== 1 || Number(versions[0].user_version) !== targetSchemaVersion) {
    throw fail('KANATA_MIGRATION_SCHEMA_VERSION_MISMATCH')
  }
  if (foreignKeys.length !== 1 || Number(foreignKeys[0].foreign_keys) !== 1) {
    throw fail('KANATA_MIGRATION_FOREIGN_KEYS_REQUIRED')
  }
}
async function readJournal(tx, id) {
  const rows = await tx.query(
    'SELECT id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state FROM data_migrations WHERE id=?',
    [id],
  )
  if (rows.length > 1) throw fail('KANATA_MIGRATION_JOURNAL_CORRUPTED')
  return rows[0] ?? null
}
async function ensureJournal(operation, { id, sourceFingerprint, targetSchemaVersion, collection, assertCurrent }) {
  return operation.transaction(async tx => {
    assertCurrent()
    await assertTargetSchema(tx, targetSchemaVersion)
    let row = await readJournal(tx, id)
    if (!row) {
      await tx.execute(
        'INSERT INTO data_migrations(id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state) VALUES(?,?,?,?,?,0,?)',
        [id, targetSchemaVersion, sourceFingerprint, collection, 'null', 'pending'],
      )
      row = await readJournal(tx, id)
    }
    const journal = validateJournal(row, sourceFingerprint, targetSchemaVersion, collection)
    if (journal.state === 'pending' || journal.state === 'failed') {
      await tx.execute(
        "UPDATE data_migrations SET state='running' WHERE id=? AND source_fingerprint=? AND state IN ('pending','failed')",
        [id, sourceFingerprint],
      )
      journal.state = 'running'
    }
    return journal
  })
}
async function markFailed(operation, id, sourceFingerprint, assertCurrent) {
  try {
    assertCurrent()
    await operation.transaction(async tx => {
      assertCurrent()
      await tx.execute(
        "UPDATE data_migrations SET state='failed' WHERE id=? AND source_fingerprint=? AND state<>'failed'",
        [id, sourceFingerprint],
      )
    })
  } catch {
    // A revoked owner must not start a new write merely to record its own cancellation.
  }
}
function migrationError(error) {
  if (validCode(error?.code)) return error
  return fail('KANATA_MIGRATION_FAILED')
}

/**
 * Journaled, synthetic-only migration coordinator.
 * Every batch writes target rows and advances its cursor in the same SQLite transaction.
 * This module is intentionally not connected to the production Store or Android activation gate.
 * @param {{operation:import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation,
 *   targetSchemaVersion?:number,batchSize?:number}} options
 */
export function createKanataDataMigrator({ operation, targetSchemaVersion = KANATA_SCHEMA_VERSION, batchSize = 50 }) {
  if (!operation || typeof operation.transaction !== 'function') throw fail('KANATA_MIGRATION_TARGET_INVALID')
  if (targetSchemaVersion !== KANATA_SCHEMA_VERSION) throw fail('KANATA_MIGRATION_SCHEMA_VERSION_MISMATCH')
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > KANATA_DATA_MIGRATION_MAX_BATCH_SIZE) {
    throw fail('KANATA_MIGRATION_BATCH_SIZE_INVALID')
  }

  /**
   * @param {{syntheticOnly:true,sourceFingerprint:string,collections:readonly any[],
   *   verify:(tx:import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction,context:any)=>Promise<void>|void,
   *   assertCurrent?:()=>void}} request
   */
  async function run(request) {
    if (request?.syntheticOnly !== true) throw fail('KANATA_MIGRATION_SYNTHETIC_ONLY')
    const sourceFingerprint = request.sourceFingerprint
    if (!validFingerprint(sourceFingerprint)) throw fail('KANATA_MIGRATION_SOURCE_INVALID')
    if (!Array.isArray(request.collections) || typeof request.verify !== 'function') {
      throw fail('KANATA_MIGRATION_PLAN_INVALID')
    }
    const assertCurrent = typeof request.assertCurrent === 'function' ? request.assertCurrent : () => {}
    const names = new Set()
    for (const collection of request.collections) {
      validateCollection(collection)
      if (names.has(collection.name)) throw fail('KANATA_MIGRATION_COLLECTION_INVALID')
      names.add(collection.name)
    }

    const results = []
    for (const collection of request.collections) {
      assertCurrent()
      const id = journalId(collection.name)
      let journal = await ensureJournal(operation, {
        id, sourceFingerprint, targetSchemaVersion, collection: collection.name, assertCurrent,
      })
      const resumedFrom = journal.importedCount
      try {
        while (journal.state !== 'complete') {
          assertCurrent()
          const page = await collection.readBatch(journal.cursor, batchSize)
          assertCurrent()
          if (!page || !Array.isArray(page.items) || typeof page.done !== 'boolean' ||
            page.items.length > batchSize || (!page.done && page.items.length === 0)) {
            throw fail('KANATA_MIGRATION_BATCH_INVALID')
          }
          const nextCursorText = encodeCursor(page.nextCursor)
          if (page.items.length > 0 && nextCursorText === journal.cursorText) {
            throw fail('KANATA_MIGRATION_CURSOR_STALLED')
          }
          if (page.items.length === 0 && nextCursorText !== journal.cursorText) {
            throw fail('KANATA_MIGRATION_CURSOR_INVALID')
          }
          if (page.items.length > 0) {
            const nextCount = journal.importedCount + page.items.length
            if (!Number.isSafeInteger(nextCount) || nextCount > collection.expectedCount) {
              throw fail('KANATA_MIGRATION_COUNT_OVERFLOW')
            }
            await operation.transaction(async tx => {
              assertCurrent()
              await assertTargetSchema(tx, targetSchemaVersion)
              const row = await readJournal(tx, id)
              const current = validateJournal(row, sourceFingerprint, targetSchemaVersion, collection.name)
              if (current.cursorText !== journal.cursorText || current.importedCount !== journal.importedCount ||
                current.state === 'complete') throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
              for (const item of page.items) {
                assertCurrent()
                await collection.write(tx, item)
              }
              const result = await tx.execute(
                "UPDATE data_migrations SET cursor_json=?,imported_count=?,state='running' WHERE id=? AND target_schema_version=? AND source_fingerprint=? AND collection=? AND cursor_json=? AND imported_count=? AND state IN ('pending','running','failed')",
                [nextCursorText, nextCount, id, targetSchemaVersion, sourceFingerprint, collection.name, journal.cursorText, journal.importedCount],
              )
              if (result?.affectedRows !== 1) throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
            })
            journal = {
              cursor: page.nextCursor,
              cursorText: nextCursorText,
              importedCount: nextCount,
              state: 'running',
            }
          }
          if (page.done) break
        }

        await operation.transaction(async tx => {
          assertCurrent()
          await assertTargetSchema(tx, targetSchemaVersion)
          const row = await readJournal(tx, id)
          const current = validateJournal(row, sourceFingerprint, targetSchemaVersion, collection.name)
          if (current.cursorText !== journal.cursorText || current.importedCount !== journal.importedCount) {
            throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
          }
          if (current.importedCount !== collection.expectedCount) throw fail('KANATA_MIGRATION_COUNT_MISMATCH')
          await collection.verify(tx, {
            collection: collection.name,
            expectedCount: collection.expectedCount,
            importedCount: current.importedCount,
            sourceFingerprint,
          })
          if (current.state !== 'complete') {
            const result = await tx.execute(
              "UPDATE data_migrations SET state='complete' WHERE id=? AND source_fingerprint=? AND cursor_json=? AND imported_count=? AND state IN ('pending','running','failed')",
              [id, sourceFingerprint, current.cursorText, current.importedCount],
            )
            if (result?.affectedRows !== 1) throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
          }
        })
        results.push({
          collection: collection.name,
          importedCount: journal.importedCount,
          resumed: resumedFrom > 0,
        })
      } catch (error) {
        await markFailed(operation, id, sourceFingerprint, assertCurrent)
        throw migrationError(error)
      }
    }

    const finalId = journalId(COMPLETE_COLLECTION)
    try {
      const finalJournal = await ensureJournal(operation, {
        id: finalId, sourceFingerprint, targetSchemaVersion, collection: COMPLETE_COLLECTION, assertCurrent,
      })
      await operation.transaction(async tx => {
        assertCurrent()
        await assertTargetSchema(tx, targetSchemaVersion)
        const row = await readJournal(tx, finalId)
        const current = validateJournal(row, sourceFingerprint, targetSchemaVersion, COMPLETE_COLLECTION)
        await request.verify(tx, { sourceFingerprint, targetSchemaVersion, collections: results })
        if (current.state !== 'complete') {
          const result = await tx.execute(
            "UPDATE data_migrations SET state='complete' WHERE id=? AND source_fingerprint=? AND state IN ('pending','running','failed')",
            [finalId, sourceFingerprint],
          )
          if (result?.affectedRows !== 1) throw fail('KANATA_MIGRATION_JOURNAL_CONFLICT')
        }
      })
      return Object.freeze({
        state: 'complete',
        sourceFingerprint,
        targetSchemaVersion,
        collections: Object.freeze(results),
        resumed: results.some(result => result.resumed) || finalJournal.importedCount > 0,
      })
    } catch (error) {
      await markFailed(operation, finalId, sourceFingerprint, assertCurrent)
      throw migrationError(error)
    }
  }

  return Object.freeze({ run })
}
