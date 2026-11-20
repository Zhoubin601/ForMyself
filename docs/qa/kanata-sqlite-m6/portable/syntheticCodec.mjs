import { DatabaseSync } from 'node:sqlite'
import { concatBytes, constantTimeEqual } from '../../../../src/features/chat/backup/portable/bytes.js'
import {
  PORTABLE_BUSINESS_TABLES,
  PORTABLE_DERIVED_TABLES,
  PORTABLE_TABLES_BY_NAME,
} from '../../../../src/features/chat/backup/portable/catalog.js'
import {
  PORTABLE_ERROR_CODES,
  PortableBackupError,
  requirePortable,
} from '../../../../src/features/chat/backup/portable/constants.js'
import {
  decodePortableContainer,
  encodePortableContainer,
} from '../../../../src/features/chat/backup/portable/containerCodec.js'
import {
  computeDerivedTableVerifiers,
  projectTaskPauseSendingV1,
} from '../../../../src/features/chat/backup/portable/logicalCodec.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { createNodeCryptoProvider } from './nodeCryptoProvider.mjs'

export const SYNTHETIC_INSTALL_ORDER = Object.freeze([
  'dataset_metadata',
  'worlds',
  'world_identities',
  'character_cards',
  'card_versions',
  'character_instances',
  'role_binding_state',
  'role_bindings',
  'preset_applications',
  'memory_policies',
  'autonomy_policies',
  'conversations',
  'conversation_participants',
  'messages',
  'archived_message_marks',
  'message_audits',
  'lorebook_entries',
  'lorebook_known_by',
  'memories',
  'memory_known_by',
  'memory_links',
  'memory_sources',
  'relationships',
  'world_events',
  'event_audits',
  'event_causes',
  'event_participants',
  'event_sources',
  'relationship_events',
  'memory_events',
  'world_effects',
  'effect_baselines',
  'life_grants',
  'message_life_sources',
  'memory_life_sources',
  'event_life_sources',
  'background_tasks',
  'task_social_participants',
  'task_sources',
  'task_result_events',
  'task_result_memories',
  'usage_events',
  'virtual_schedules',
  'virtual_schedule_days',
  'domain_command_receipts',
])

/**
 * Create an empty 45-table source map helper for tests.
 * @param {Partial<Record<string, readonly Record<string, unknown>[] | { rowCount: number | bigint, rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>> }>>} [overrides]
 */
export function createSyntheticTableSource(overrides = {}) {
  return tableDef => overrides[tableDef.name] ?? []
}

/**
 * Streamingly export a Scheme C synthetic portable backup container.
 * @param {{
 *   password: string,
 *   getTableSource: Parameters<typeof encodePortableContainer>[0]['getTableSource'],
 *   derivedVerifiers: Parameters<typeof encodePortableContainer>[0]['derivedVerifiers'],
 *   cryptoProvider?: import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider,
 *   material?: Parameters<typeof encodePortableContainer>[0]['material'],
 *   signal?: AbortSignal,
 *   applyTaskPolicy?: boolean,
 *   validateJson?: boolean,
 * }} options
 */
export function streamSyntheticPortableBackup({
  cryptoProvider = createNodeCryptoProvider(),
  ...rest
}) {
  return encodePortableContainer({ cryptoProvider, ...rest })
}

/**
 * Export a Scheme C synthetic portable backup into a contiguous Uint8Array (for small/medium test vectors).
 * @param {Parameters<typeof streamSyntheticPortableBackup>[0]} options
 */
export async function exportSyntheticPortableBackup(options) {
  const chunks = []
  const gen = streamSyntheticPortableBackup(options)
  while (true) {
    const step = await gen.next()
    if (step.done) {
      return { bytes: concatBytes(...chunks), footer: step.value }
    }
    chunks.push(step.value)
  }
}

/**
 * Import and verify a Scheme C synthetic portable backup container using a staging sink.
 * @param {{
 *   source: Parameters<typeof decodePortableContainer>[0]['source'],
 *   password: string,
 *   stagingSink: import('../../../../src/features/chat/backup/portable/contracts').PortableStagingSink,
 *   cryptoProvider?: import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider,
 *   signal?: AbortSignal,
 *   validateJson?: boolean,
 * }} options
 */
export function importSyntheticPortableBackup({
  cryptoProvider = createNodeCryptoProvider(),
  ...rest
}) {
  return decodePortableContainer({ cryptoProvider, ...rest })
}

/**
 * Compute expected empty derived verifiers (or from custom derived rows) using Node SHA-256.
 * @param {Partial<Record<string, readonly Record<string, unknown>[]>>} [derivedOverrides]
 * @param {import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider} [cryptoProvider]
 */
export function computeSyntheticDerivedVerifiers(
  derivedOverrides = {},
  cryptoProvider = createNodeCryptoProvider(),
) {
  return computeDerivedTableVerifiers(
    tableDef => derivedOverrides[tableDef.name] ?? [],
    () => cryptoProvider.createSha256(),
  )
}

/**
 * Bounded O(1)-row-memory staging sink for streaming & resource tests.
 * Never buffers all decoded rows in memory unless `captureRows` is explicitly requested for small fixtures.
 */
export function createBoundedCounterStagingSink({
  expectedDerivedVerifiers = null,
  cryptoProvider = createNodeCryptoProvider(),
  captureRows = false,
  onVerify = null,
} = {}) {
  let state = 'open'
  const begunTables = []
  const finishedTables = []
  const tableRowCounts = new Map()
  const captured = captureRows ? new Map() : null
  let totalRows = 0n

  return {
    get state() {
      return state
    },
    get begunTables() {
      return begunTables
    },
    get finishedTables() {
      return finishedTables
    },
    get totalRows() {
      return totalRows
    },
    get tableRowCounts() {
      return tableRowCounts
    },
    get capturedTables() {
      if (state !== 'committed') throw new Error('STAGING_NOT_COMMITTED')
      return captured
    },
    beginTable(table, rowCount) {
      begunTables.push({ tableId: table.tableId, name: table.name, rowCount })
    },
    writeRow(table, row, ordinal) {
      totalRows += 1n
      tableRowCounts.set(table.name, (tableRowCounts.get(table.name) ?? 0n) + 1n)
      if (captured) {
        if (!captured.has(table.name)) captured.set(table.name, [])
        captured.get(table.name).push(table.hasOrdinal ? { ...row, ordinal } : row)
      }
    },
    finishTable(table, rowCount, digest) {
      finishedTables.push({ tableId: table.tableId, name: table.name, rowCount, digest })
    },
    async verify(verifiers, context) {
      const derivedExpected =
        expectedDerivedVerifiers ?? (await computeSyntheticDerivedVerifiers({}, cryptoProvider))
      const byId = new Map(verifiers.map(v => [v.tableId, v]))
      for (const expected of derivedExpected) {
        const actual = byId.get(expected.tableId)
        requirePortable(
          Boolean(actual) &&
            actual.rowCount === expected.rowCount &&
            constantTimeEqual(actual.digest, expected.digest),
          PORTABLE_ERROR_CODES.INVALID_LOGICAL,
          `derived-verifier:${expected.tableId}`,
        )
      }
      if (onVerify) await onVerify(verifiers, context)
    },
    commit() {
      requirePortable(state === 'open', PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'sink-commit-state')
      state = 'committed'
    },
    abort() {
      if (state !== 'committed') {
        state = 'aborted'
        captured?.clear()
      }
    },
  }
}

/**
 * Open a fresh isolated in-memory (or temp path) SQLite DB initialized with Schema 001..005.
 * @param {string} [filename]
 */
export function createIsolatedKanata005Db(filename = ':memory:') {
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON;')
  for (const migration of KANATA_SCHEMA_MIGRATIONS) {
    for (const stmt of migration.statements) {
      db.exec(stmt)
    }
  }
  db.exec(`PRAGMA application_id = 0x4b4e5441;`)
  db.exec(`PRAGMA user_version = 5;`)
  return db
}

/**
 * Read a whole table from an isolated synthetic SQLite DB sorted by canonical wire order
 * (PK or `(world_id, ordinal)` for 005 ordered tables).
 * @param {DatabaseSync} db
 * @param {(typeof PORTABLE_BUSINESS_TABLES)[number] | (typeof PORTABLE_DERIVED_TABLES)[number]} tableDef
 */
export function readCanonicalRowsFromSqlite(db, tableDef) {
  if (tableDef.hasOrdinal) {
    const orderTable =
      tableDef.name === 'world_events'
        ? 'event_array_order'
        : tableDef.name === 'world_effects'
          ? 'effect_array_order'
          : 'baseline_array_order'
    const cols = tableDef.columns.map(c => `e.${c.name}`).join(', ')
    const stmt = db.prepare(
      `SELECT ${cols}, o.ordinal AS __ordinal FROM ${tableDef.name} e JOIN ${orderTable} o ON o.world_id = e.world_id AND o.entity_id = e.id ORDER BY e.world_id COLLATE BINARY ASC, o.ordinal ASC`,
    )
    stmt.setReadBigInts(true)
    return stmt.all().map(r => {
      const ordinal = r.__ordinal
      const row = { ...r }
      delete row.__ordinal
      return { ...row, ordinal }
    })
  }

  const orderBy = tableDef.pkColumns
    .map(col => `${col}${tableDef.columnsByName[col].type === 'TEXT' ? ' COLLATE BINARY' : ''} ASC`)
    .join(', ')
  const cols = tableDef.columns.map(c => c.name).join(', ')
  const stmt = db.prepare(`SELECT ${cols} FROM ${tableDef.name} ORDER BY ${orderBy}`)
  stmt.setReadBigInts(true)
  return stmt.all().map(r => ({ ...r }))
}

/**
 * Export 45 business tables + 5 derived table verifiers from an isolated synthetic Schema 005 SQLite DB.
 * Uses a single read-only snapshot transaction (`BEGIN DEFERRED`).
 * @param {DatabaseSync} db
 * @param {import('../../../../src/features/chat/backup/portable/contracts').PortableCryptoProvider} [cryptoProvider]
 */
export async function readPortableSnapshotFromSqlite(db, cryptoProvider = createNodeCryptoProvider()) {
  const businessRows = {}
  const derivedRows = {}
  db.exec('BEGIN DEFERRED;')
  try {
    for (const tableDef of PORTABLE_BUSINESS_TABLES) {
      let rows = readCanonicalRowsFromSqlite(db, tableDef)
      if (tableDef.name === 'background_tasks') {
        rows = rows.map(projectTaskPauseSendingV1)
      }
      businessRows[tableDef.name] = rows
    }
    for (const tableDef of PORTABLE_DERIVED_TABLES) {
      derivedRows[tableDef.name] = readCanonicalRowsFromSqlite(db, tableDef)
    }
  } finally {
    db.exec('ROLLBACK;')
  }
  const derivedVerifiers = await computeSyntheticDerivedVerifiers(derivedRows, cryptoProvider)
  return {
    getTableSource: createSyntheticTableSource(businessRows),
    derivedVerifiers,
    businessRows,
    derivedRows,
  }
}

/**
 * Isolated synthetic SQLite staging sink: collects streamed rows, verifies full container + EOF,
 * then installs all 45 business tables in topological dependency order with two-pass FK resolution
 * inside a fresh Schema 005 SQLite DB, checks `integrity_check` and `foreign_key_check`,
 * and verifies all 5 trigger-rebuilt derived tables match the Footer verifiers byte-for-byte.
 */
export function createSqliteStagingSink({
  cryptoProvider = createNodeCryptoProvider(),
  targetFilename = ':memory:',
} = {}) {
  let state = 'open'
  const staged = new Map()
  /** @type {DatabaseSync | null} */
  let db = null

  return {
    get state() {
      return state
    },
    get database() {
      if (state !== 'committed' || !db) throw new Error('STAGING_NOT_COMMITTED')
      return db
    },
    beginTable(table) {
      staged.set(table.name, [])
    },
    writeRow(table, row, ordinal) {
      const list = staged.get(table.name)
      if (!list) throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'sink-table')
      list.push(table.hasOrdinal ? { ...row, __ordinal: ordinal } : row)
    },
    finishTable() {},
    async verify(verifiers) {
      db = createIsolatedKanata005Db(targetFilename)
      try {
        db.exec('BEGIN IMMEDIATE;')
        const deferredReplies = []
        const deferredTasks = []

        for (const tableName of SYNTHETIC_INSTALL_ORDER) {
          const tableDef = PORTABLE_TABLES_BY_NAME.get(tableName)
          const rows = staged.get(tableName) ?? []
          if (rows.length === 0) continue

          const colNames = tableDef.columns.map(c => c.name)
          const placeholders = colNames.map(() => '?').join(', ')
          const insertStmt = db.prepare(`INSERT INTO ${tableName}(${colNames.join(', ')}) VALUES(${placeholders})`)

          for (const raw of rows) {
            const values = tableDef.columns.map(col => {
              if (tableName === 'messages' && (col.name === 'reply_to_message_id' || col.name === 'reply_to_revision')) {
                return null
              }
              if (tableName === 'background_tasks' && col.name === 'window_task_id') {
                return null
              }
              return raw[col.name]
            })
            insertStmt.run(...values)
            if (tableName === 'messages' && raw.reply_to_message_id !== null) {
              deferredReplies.push({
                id: raw.id,
                reply_to_message_id: raw.reply_to_message_id,
                reply_to_revision: raw.reply_to_revision,
              })
            }
            if (tableName === 'background_tasks' && raw.window_task_id !== null) {
              deferredTasks.push({ id: raw.id, window_task_id: raw.window_task_id })
            }
          }
        }

        if (deferredReplies.length > 0) {
          const replyStmt = db.prepare(
            'UPDATE messages SET reply_to_message_id = ?, reply_to_revision = ? WHERE id = ?',
          )
          for (const item of deferredReplies) {
            replyStmt.run(item.reply_to_message_id, item.reply_to_revision, item.id)
          }
        }
        if (deferredTasks.length > 0) {
          const taskStmt = db.prepare('UPDATE background_tasks SET window_task_id = ? WHERE id = ?')
          for (const item of deferredTasks) {
            taskStmt.run(item.window_task_id, item.id)
          }
        }

        db.exec('COMMIT;')
      } catch {
        try {
          db.exec('ROLLBACK;')
        } catch {}
        throw new PortableBackupError(PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'sqlite-staging-install')
      }

      const integrity = db.prepare('PRAGMA integrity_check').all()
      requirePortable(
        integrity.length === 1 && integrity[0].integrity_check === 'ok',
        PORTABLE_ERROR_CODES.INVALID_LOGICAL,
        'sqlite-integrity',
      )
      const fkViolations = db.prepare('PRAGMA foreign_key_check').all()
      requirePortable(fkViolations.length === 0, PORTABLE_ERROR_CODES.INVALID_LOGICAL, 'sqlite-fk')

      const rebuiltDerived = {}
      for (const tableDef of PORTABLE_DERIVED_TABLES) {
        rebuiltDerived[tableDef.name] = readCanonicalRowsFromSqlite(db, tableDef)
      }
      const computed = await computeSyntheticDerivedVerifiers(rebuiltDerived, cryptoProvider)
      const footerById = new Map(verifiers.map(v => [v.tableId, v]))
      for (const actual of computed) {
        const expected = footerById.get(actual.tableId)
        requirePortable(
          Boolean(expected) &&
            expected.rowCount === actual.rowCount &&
            constantTimeEqual(expected.digest, actual.digest),
          PORTABLE_ERROR_CODES.INVALID_LOGICAL,
          `derived-mismatch:${actual.tableId}`,
        )
      }
    },
    commit() {
      requirePortable(state === 'open' && db !== null, PORTABLE_ERROR_CODES.INVALID_CONTAINER, 'sqlite-commit')
      state = 'committed'
      staged.clear()
    },
    abort() {
      if (state !== 'committed') {
        state = 'aborted'
        staged.clear()
        try {
          db?.close()
        } catch {}
        db = null
      }
    },
  }
}
