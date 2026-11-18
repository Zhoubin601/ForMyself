// @ts-check
// M5: isolated, resumable JSON -> SQLite data migration. This module is deliberately
// not wired into the production Store, application lifecycle, or ordinary SQLite activation.
import { assertKanataData } from '../../domain/kanataValidation.js'
import { validateArchivePage } from '../messageArchiveCore.js'
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { KANATA_SCHEMA_APPLICATION_ID, KANATA_SCHEMA_VERSION } from './kanataSchema.js'
import {
  createKanataDataMigrationCollections, kanataMigrationMessageCommands,
  KANATA_MIGRATION_TABLES, KANATA_MIGRATION_ENTITY_TABLES,
} from './kanataDataMigrationRows.js'

const JOURNAL_SELECT = 'SELECT id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state,extensions_json\n  FROM data_migrations WHERE id=?'
const JOURNAL_UPDATE = 'UPDATE data_migrations SET cursor_json=?,imported_count=?,state=?,extensions_json=?\n  WHERE id=? AND source_fingerprint=? AND target_schema_version=? AND cursor_json=? AND imported_count=?'
const MANIFEST_COLLECTION = '__manifest__'
const PLAN_VERSION = 1
const MAX_ARCHIVE_PAGE_SIZE = 50
const TARGET_TABLES_BY_COLLECTION = Object.freeze({
  dataset_metadata: ['dataset_metadata'],
  worlds: ['worlds','world_identities','entity_ids','participants'],
  cards: ['character_cards','card_versions','entity_ids'],
  card_versions: ['card_versions','entity_ids'],
  instances: ['character_instances','entity_ids','participants'],
  conversations: ['conversations','entity_ids'],
  conversation_participants: ['conversation_participants'],
  'messages.active': ['messages','message_life_sources','entity_ids'],
  'messages.archive': ['messages','message_life_sources','archived_message_marks','entity_ids'],
  lorebook_entries: ['lorebook_entries','entity_ids'],
  lorebook_known_by: ['lorebook_known_by'],
  memories: ['memories','entity_ids'],
  memory_known_by: ['memory_known_by'],
  relationships: ['relationships','entity_ids'],
  events: ['world_events','entity_ids','event_array_order'],
  life_grants: ['life_grants','entity_ids'],
  effects: ['world_effects','entity_ids','effect_array_order'],
  effect_baselines: ['effect_baselines','entity_ids','baseline_array_order'],
  'tasks.root': ['background_tasks','entity_ids'],
  'tasks.dependent': ['background_tasks','entity_ids'],
  preset_applications: ['preset_applications','entity_ids'],
  usage_events: ['usage_events','entity_ids'],
  virtual_schedules: ['virtual_schedules','entity_ids'],
  memory_policies: ['memory_policies'],
  autonomy_policies: ['autonomy_policies'],
  role_bindings: ['role_binding_state','role_bindings'],
  message_audits: ['message_audits','entity_ids'],
  event_audits: ['event_audits','entity_ids'],
  virtual_schedule_days: ['virtual_schedule_days'],
  event_participants: ['event_participants'],
  event_causes: ['event_causes'],
  event_replacements: ['world_events'],
  relationship_events: ['relationship_events'],
  memory_events: ['memory_events'],
  memory_links: ['memory_links'],
  memory_sources: ['memory_sources'],
  event_sources: ['event_sources'],
  task_sources: ['task_sources'],
  task_result_events: ['task_result_events'],
  task_result_memories: ['task_result_memories'],
  task_social_participants: ['task_social_participants'],
  memory_life_sources: ['memory_life_sources'],
  event_life_sources: ['event_life_sources'],
})
const fail = code => Object.assign(new Error(code), { code })
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0
const need = (condition, code) => { if (!condition) throw fail(code) }
const safeCode = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)
  ? error.code : 'KANATA_MIGRATION_FAILED'
const idFor = (fingerprint, collection) => fingerprint + ':' + collection
const digestSeed = (table, columns) => sha256Text('kanata-m5-table-v1:' + table + ':' + columns.join(','))
const replacementSeed = () => sha256Text('kanata-m5-event-replacements-v1')
const parseObject = value => {
  let parsed
  try { parsed = JSON.parse(String(value)) } catch { throw fail('KANATA_MIGRATION_JOURNAL_CORRUPTED') }
  need(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'KANATA_MIGRATION_JOURNAL_CORRUPTED')
  return parsed
}
const equalJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const emptyManifest = () => ({
  planVersion: PLAN_VERSION, targetTables: [...KANATA_MIGRATION_TABLES], tables: {}, arrayOrdinals: {},
  replacements: { count: 0, digest: replacementSeed() },
})

/** Hash exact bound SQLite values in deterministic insert order. */
function recordExpectedRow(manifest, table, columns, values) {
  need(KANATA_MIGRATION_TABLES.includes(table), 'KANATA_MIGRATION_TABLE_INVALID')
  let stat = manifest.tables[table]
  if (!stat) {
    stat = { columns: [...columns], count: 0, digest: digestSeed(table, columns) }
    manifest.tables[table] = stat
  }
  need(equalJson(stat.columns, columns), 'KANATA_MIGRATION_COLUMN_DRIFT')
  stat.count += 1
  stat.digest = sha256Text(stat.digest + JSON.stringify(values))
}

/** Account for the immutable side effects created by schema triggers. */
function recordInsertAndEffects(manifest, command) {
  recordExpectedRow(manifest, command.table, command.columns, command.values)
  const row = command.row
  if (KANATA_MIGRATION_ENTITY_TABLES.includes(command.table)) {
    recordExpectedRow(manifest, 'entity_ids', ['id','table_name'], [row.id, command.table])
  }
  if (command.table === 'world_identities' || command.table === 'character_instances') {
    const kind = command.table === 'world_identities' ? 'user' : 'character'
    recordExpectedRow(manifest, 'participants', ['world_id','id','kind','identity_id','instance_id'], [
      row.world_id, row.id, kind, kind === 'user' ? row.id : null, kind === 'character' ? row.id : null,
    ])
  }
  const orderTable = command.table === 'world_events' ? 'event_array_order'
    : command.table === 'world_effects' ? 'effect_array_order'
      : command.table === 'effect_baselines' ? 'baseline_array_order' : null
  if (orderTable) {
    const worldId = row.world_id
    const perWorld = manifest.arrayOrdinals[orderTable] ?? (manifest.arrayOrdinals[orderTable] = {})
    const ordinal = Number(perWorld[worldId] ?? 0)
    recordExpectedRow(manifest, orderTable, ['world_id','entity_id','ordinal'], [worldId, row.id, ordinal])
    perWorld[worldId] = ordinal + 1
  }
}

function recordUpdateEffects(manifest, command) {
  if (command.audit) {
    const replacements = manifest.replacements ?? (manifest.replacements = { count: 0, digest: replacementSeed() })
    replacements.count += 1
    replacements.digest = sha256Text(replacements.digest + JSON.stringify(command.audit))
  }
}

function sortedArchiveDescriptors(descriptors) {
  return [...descriptors].sort((a, b) =>
    compareText(a.worldId, b.worldId) ||
    compareText(a.conversationId, b.conversationId) ||
    (a.messages[0].createdAt - b.messages[0].createdAt) ||
    compareText(a.messages[0].id, b.messages[0].id))
}

function createArchiveMessagesCollection(descriptors, source, password, current) {
  const ordered = sortedArchiveDescriptors(descriptors)
  let cachedIndex = -1
  /** @type {import('../../domain/kanataTypes').Message[]|null} */
  let cachedPage = null
  return {
    name: 'messages.archive',
    expectedCount: ordered.reduce((count, descriptor) => count + descriptor.messages.length, 0),
    initialCursor: { archiveIndex: 0, messageOffset: 0 },
    async readBatch(cursor, limit) {
      let archiveIndex = Number(cursor?.archiveIndex ?? 0)
      let messageOffset = Number(cursor?.messageOffset ?? 0)
      need(Number.isSafeInteger(archiveIndex) && archiveIndex >= 0 && archiveIndex <= ordered.length
        && Number.isSafeInteger(messageOffset) && messageOffset >= 0, 'KANATA_MIGRATION_CURSOR_INVALID')
      if (archiveIndex >= ordered.length) return { items: [], nextCursor: { archiveIndex, messageOffset: 0 }, done: true }
      const descriptor = ordered[archiveIndex]
      if (cachedIndex !== archiveIndex || !cachedPage) {
        current()
        const pageMessages = await source.readArchive(descriptor, password, current)
        current()
        need(Array.isArray(pageMessages) && pageMessages.length === descriptor.messages.length
          && pageMessages.length > 0 && pageMessages.length <= MAX_ARCHIVE_PAGE_SIZE, 'KANATA_MIGRATION_ARCHIVE_PAGE_INVALID')
        cachedPage = validateArchivePage({
          type: 'kanata-message-page', version: 1, worldId: descriptor.worldId,
          conversationId: descriptor.conversationId, messages: pageMessages,
        }, descriptor)
        cachedIndex = archiveIndex
      }
      need(messageOffset <= cachedPage.length, 'KANATA_MIGRATION_CURSOR_INVALID')
      const end = Math.min(cachedPage.length, messageOffset + limit)
      const items = cachedPage.slice(messageOffset, end)
      const nextCursor = end === cachedPage.length
        ? { archiveIndex: archiveIndex + 1, messageOffset: 0 }
        : { archiveIndex, messageOffset: end }
      if (nextCursor.archiveIndex !== archiveIndex) { cachedIndex = -1; cachedPage = null }
      return { items, nextCursor, done: nextCursor.archiveIndex >= ordered.length }
    },
    map(items) { return items.flatMap(message => kanataMigrationMessageCommands(message, true)) },
  }
}

function sourceFingerprint(primaryFingerprint, data) {
  need(typeof primaryFingerprint === 'string' && /^[a-f0-9]{64}$/.test(primaryFingerprint),
    'KANATA_MIGRATION_SOURCE_FINGERPRINT_INVALID')
  const archives = [...(data.messageArchives ?? [])].map(page => ({
    version: page.version, key: page.key, worldId: page.worldId, conversationId: page.conversationId,
    bytes: page.bytes, index: page.index,
    messages: page.messages.map(({ id, revision, createdAt }) => ({ id, revision, createdAt })),
  })).sort((a, b) => compareText(a.key, b.key))
  return sha256Text(JSON.stringify({ format: 'kanata-m5-source-v1', primaryFingerprint, dataVersion: data.version, archives }))
}

async function tableCount(tx, table) {
  need(KANATA_MIGRATION_TABLES.includes(table), 'KANATA_MIGRATION_TABLE_INVALID')
  const rows = await tx.query('SELECT count(*) AS count FROM ' + table)
  need(rows.length === 1 && Number.isSafeInteger(Number(rows[0].count)), 'KANATA_MIGRATION_AUDIT_FAILED')
  return Number(rows[0].count)
}

async function preflight(operation, fingerprint, collections, data) {
  const names = [...collections.map(collection => collection.name), MANIFEST_COLLECTION]
  need(new Set(names).size === names.length, 'KANATA_MIGRATION_PLAN_DUPLICATE')
  for (const collection of collections) {
    need(Array.isArray(TARGET_TABLES_BY_COLLECTION[collection.name])
      && TARGET_TABLES_BY_COLLECTION[collection.name].every(table => KANATA_MIGRATION_TABLES.includes(table)),
    'KANATA_MIGRATION_PLAN_INVALID')
  }
  return operation.transaction(async tx => {
    const versionRows = await tx.query('PRAGMA user_version')
    const applicationRows = await tx.query('PRAGMA application_id')
    const fkRows = await tx.query('PRAGMA foreign_keys')
    need(versionRows.length === 1 && Number(versionRows[0].user_version) === KANATA_SCHEMA_VERSION,
      'KANATA_MIGRATION_SCHEMA_VERSION_UNSUPPORTED')
    need(applicationRows.length === 1 && Number(applicationRows[0].application_id) === KANATA_SCHEMA_APPLICATION_ID,
      'KANATA_MIGRATION_WRONG_DATABASE')
    need(fkRows.length === 1 && Number(fkRows[0].foreign_keys) === 1, 'KANATA_MIGRATION_FOREIGN_KEYS_REQUIRED')
    const journal = await tx.query('SELECT id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state,extensions_json FROM data_migrations ORDER BY id LIMIT 1025')
    need(journal.length <= 1024, 'KANATA_MIGRATION_JOURNAL_LIMIT')
    if (!journal.length) {
      for (const table of KANATA_MIGRATION_TABLES) {
        need(await tableCount(tx, table) === 0, 'KANATA_MIGRATION_TARGET_NOT_EMPTY')
      }
      const [migrationCount] = await tx.query('SELECT count(*) AS count FROM data_migrations')
      need(Number(migrationCount.count) === 0, 'KANATA_MIGRATION_TARGET_NOT_EMPTY')
      const manifest = JSON.stringify(emptyManifest())
      for (const collection of collections) {
        await tx.execute('INSERT INTO data_migrations(id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state,extensions_json) VALUES(?,?,?,?,?,0,\'pending\',?)', [
          idFor(fingerprint, collection.name), KANATA_SCHEMA_VERSION, fingerprint, collection.name,
          JSON.stringify(collection.initialCursor), JSON.stringify({ planVersion: PLAN_VERSION, targetTables: TARGET_TABLES_BY_COLLECTION[collection.name] }),
        ])
      }
      await tx.execute('INSERT INTO data_migrations(id,target_schema_version,source_fingerprint,collection,cursor_json,imported_count,state,extensions_json) VALUES(?,?,?,?,?,0,\'pending\',?)', [
        idFor(fingerprint, MANIFEST_COLLECTION), KANATA_SCHEMA_VERSION, fingerprint, MANIFEST_COLLECTION, '{}', manifest,
      ])
      return { resumed: false, names }
    }
    need(journal.every(row => row.source_fingerprint === fingerprint), 'KANATA_MIGRATION_SOURCE_CHANGED')
    need(journal.every(row => Number(row.target_schema_version) === KANATA_SCHEMA_VERSION), 'KANATA_MIGRATION_SCHEMA_VERSION_UNSUPPORTED')
    need(journal.length === names.length, 'KANATA_MIGRATION_PLAN_MISMATCH')
    const byName = new Map(journal.map(row => [String(row.collection), row]))
    for (const name of names) need(byName.has(name) && byName.get(name).id === idFor(fingerprint, name), 'KANATA_MIGRATION_PLAN_MISMATCH')
    const [dataset] = await tx.query('SELECT user_id,data_version FROM dataset_metadata WHERE singleton=1')
    if (dataset) need(dataset.user_id === data.userId && Number(dataset.data_version) === data.version,
      'KANATA_MIGRATION_TARGET_DATASET_MISMATCH')
    const manifestRow = byName.get(MANIFEST_COLLECTION)
    const manifest = parseObject(manifestRow.extensions_json)
    need(Number(manifest.planVersion) === PLAN_VERSION && manifest.tables && typeof manifest.tables === 'object'
      && equalJson(manifest.targetTables, [...KANATA_MIGRATION_TABLES]),
      'KANATA_MIGRATION_JOURNAL_CORRUPTED')
    for (const collection of collections) {
      const rowExtra = parseObject(byName.get(collection.name).extensions_json)
      need(Number(rowExtra.planVersion) === PLAN_VERSION
        && equalJson(rowExtra.targetTables, TARGET_TABLES_BY_COLLECTION[collection.name]),
      'KANATA_MIGRATION_PLAN_MISMATCH')
    }
    return { resumed: true, names }
  })
}

async function updateFailed(operation, fingerprint, collection, error) {
  try {
    await operation.transaction(async tx => {
      const id = idFor(fingerprint, collection)
      const [row] = await tx.query(JOURNAL_SELECT, [id])
      if (!row || row.state === 'complete') return
      const extra = parseObject(row.extensions_json)
      extra.lastFailureCode = safeCode(error)
      await tx.execute('UPDATE data_migrations SET state=\'failed\',extensions_json=? WHERE id=? AND source_fingerprint=? AND state<>\'complete\'',
        [JSON.stringify(extra), id, fingerprint])
    })
  } catch { /* A revoked/closed lease leaves the last atomic cursor untouched. */ }
}

async function migrateCollection(operation, fingerprint, collection, assertCurrent, batchSize) {
  const id = idFor(fingerprint, collection.name)
  const journal = await operation.transaction(async tx => {
    const [row] = await tx.query(JOURNAL_SELECT, [id])
    need(row && row.source_fingerprint === fingerprint && Number(row.target_schema_version) === KANATA_SCHEMA_VERSION,
      'KANATA_MIGRATION_JOURNAL_MISSING')
    return row
  })
  if (journal.state === 'complete') {
    need(Number(journal.imported_count) === collection.expectedCount, 'KANATA_MIGRATION_COUNT_MISMATCH')
    return
  }
  let cursor = parseObject(journal.cursor_json)
  while (true) {
    assertCurrent()
    const batch = await collection.readBatch(cursor, batchSize)
    need(batch && Array.isArray(batch.items) && batch.items.length <= batchSize
      && batch.nextCursor && typeof batch.done === 'boolean', 'KANATA_MIGRATION_BATCH_INVALID')
    if (!batch.done && batch.items.length === 0) throw fail('KANATA_MIGRATION_BATCH_STALLED')
    const commands = collection.map(batch.items)
    need(Array.isArray(commands), 'KANATA_MIGRATION_BATCH_INVALID')
    assertCurrent()
    await operation.transaction(async tx => {
      const [current] = await tx.query(JOURNAL_SELECT, [id])
      need(current && current.source_fingerprint === fingerprint
        && Number(current.target_schema_version) === KANATA_SCHEMA_VERSION, 'KANATA_MIGRATION_JOURNAL_MISSING')
      const currentCursor = parseObject(current.cursor_json)
      need(equalJson(currentCursor, cursor), 'KANATA_MIGRATION_CONCURRENT')
      need(current.state !== 'complete', 'KANATA_MIGRATION_CONCURRENT')
      const manifestId = idFor(fingerprint, MANIFEST_COLLECTION)
      const [manifestRow] = await tx.query(JOURNAL_SELECT, [manifestId])
      need(manifestRow && manifestRow.source_fingerprint === fingerprint, 'KANATA_MIGRATION_JOURNAL_MISSING')
      const manifest = parseObject(manifestRow.extensions_json)
      for (const command of commands) {
        need(command && typeof command.sql === 'string' && Array.isArray(command.values)
          && typeof command.table === 'string', 'KANATA_MIGRATION_COMMAND_INVALID')
        if (command.kind === 'insert') {
          const result = await tx.execute(command.sql, command.values)
          need(result.affectedRows === 1, 'KANATA_MIGRATION_WRITE_CONFLICT')
          recordInsertAndEffects(manifest, command)
        } else if (command.kind === 'update') {
          const result = await tx.execute(command.sql, command.values)
          need(result.affectedRows === 1, 'KANATA_MIGRATION_WRITE_CONFLICT')
          recordUpdateEffects(manifest, command)
        } else throw fail('KANATA_MIGRATION_COMMAND_INVALID')
      }
      const nextCount = Number(current.imported_count) + batch.items.length
      need(Number.isSafeInteger(nextCount) && (batch.done
        ? nextCount === collection.expectedCount : nextCount <= collection.expectedCount),
      'KANATA_MIGRATION_COUNT_MISMATCH')
      const nextState = batch.done ? 'complete' : 'running'
      const updated = await tx.execute(JOURNAL_UPDATE, [
        JSON.stringify(batch.nextCursor), nextCount, nextState, String(current.extensions_json), id,
        fingerprint, KANATA_SCHEMA_VERSION, String(current.cursor_json), Number(current.imported_count),
      ])
      need(updated.affectedRows === 1, 'KANATA_MIGRATION_CONCURRENT')
      const manifestUpdated = await tx.execute('UPDATE data_migrations SET state=\'running\',imported_count=imported_count+?,extensions_json=? WHERE id=? AND source_fingerprint=? AND state<>\'complete\'', [
        batch.items.length, JSON.stringify(manifest), manifestId, fingerprint,
      ])
      need(manifestUpdated.affectedRows === 1, 'KANATA_MIGRATION_JOURNAL_MISSING')
    })
    assertCurrent()
    cursor = batch.nextCursor
    if (batch.done) return
  }
}

async function verifyTableDigest(tx, table, stat) {
  if (!stat) {
    need(await tableCount(tx, table) === 0, 'KANATA_MIGRATION_TABLE_COUNT_MISMATCH')
    return { count: 0, digest: null }
  }
  need(Array.isArray(stat.columns) && stat.columns.length > 0
    && stat.columns.every(column => typeof column === 'string' && /^[a-z_]+$/.test(column))
    && Number.isSafeInteger(stat.count) && stat.count >= 0
    && typeof stat.digest === 'string' && /^[a-f0-9]{64}$/.test(stat.digest),
  'KANATA_MIGRATION_JOURNAL_CORRUPTED')
  let after = -1, count = 0, digest = digestSeed(table, stat.columns)
  while (true) {
    const rows = await tx.query('SELECT rowid AS __rowid,' + stat.columns.join(',') + ' FROM ' + table
      + ' WHERE rowid>? ORDER BY rowid LIMIT 50', [after])
    for (const row of rows) {
      count++
      digest = sha256Text(digest + JSON.stringify(stat.columns.map(column => row[column])))
      after = Number(row.__rowid)
    }
    if (rows.length < 50) break
  }
  need(count === stat.count && digest === stat.digest, 'KANATA_MIGRATION_TABLE_HASH_MISMATCH')
  return { count, digest }
}

async function verifyTarget(operation, fingerprint, collections, data) {
  return operation.transaction(async tx => {
    const [manifestRow] = await tx.query(JOURNAL_SELECT, [idFor(fingerprint, MANIFEST_COLLECTION)])
    need(manifestRow && manifestRow.source_fingerprint === fingerprint, 'KANATA_MIGRATION_JOURNAL_MISSING')
    const manifest = parseObject(manifestRow.extensions_json)
    need(Number(manifest.planVersion) === PLAN_VERSION && equalJson(manifest.targetTables, [...KANATA_MIGRATION_TABLES]), 'KANATA_MIGRATION_PLAN_MISMATCH')
    const journal = await tx.query('SELECT collection,source_fingerprint,target_schema_version,imported_count,state FROM data_migrations ORDER BY collection LIMIT 1025')
    need(journal.length === collections.length + 1 && journal.every(row =>
      row.source_fingerprint === fingerprint && Number(row.target_schema_version) === KANATA_SCHEMA_VERSION
      && (row.collection === MANIFEST_COLLECTION ? ['pending','running','failed','complete'].includes(row.state) : row.state === 'complete')), 'KANATA_MIGRATION_INCOMPLETE')
    const byName = new Map(collections.map(collection => [collection.name, collection]))
    for (const row of journal) {
      if (row.collection === MANIFEST_COLLECTION) continue
      const collection = byName.get(String(row.collection))
      need(collection && Number(row.imported_count) === collection.expectedCount, 'KANATA_MIGRATION_COUNT_MISMATCH')
    }
    const tableResults = {}
    for (const table of KANATA_MIGRATION_TABLES) {
      tableResults[table] = await verifyTableDigest(tx, table, manifest.tables[table])
    }
    const expectedReplacements = manifest.replacements ?? { count: 0, digest: replacementSeed() }
    let after = -1, count = 0, digest = replacementSeed()
    while (true) {
      const rows = await tx.query('SELECT rowid AS __rowid,world_id,id,replaces_event_id FROM world_events\n        WHERE replaces_event_id IS NOT NULL AND rowid>? ORDER BY rowid LIMIT 50', [after])
      for (const row of rows) {
        count++
        digest = sha256Text(digest + JSON.stringify([row.world_id,row.id,row.replaces_event_id]))
        after = Number(row.__rowid)
      }
      if (rows.length < 50) break
    }
    need(count === expectedReplacements.count && digest === expectedReplacements.digest,
      'KANATA_MIGRATION_EVENT_REPLACEMENT_HASH_MISMATCH')
    const [dataset] = await tx.query('SELECT user_id,data_version FROM dataset_metadata WHERE singleton=1')
    need(dataset && dataset.user_id === data.userId && Number(dataset.data_version) === data.version,
      'KANATA_MIGRATION_TARGET_DATASET_MISMATCH')
    need((await tx.query('PRAGMA foreign_key_check')).length === 0, 'KANATA_MIGRATION_FOREIGN_KEY_VIOLATION')
    const integrity = await tx.query('PRAGMA integrity_check')
    need(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'KANATA_MIGRATION_INTEGRITY_FAILED')
    const [currentManifest] = await tx.query(JOURNAL_SELECT, [idFor(fingerprint, MANIFEST_COLLECTION)])
    const extra = parseObject(currentManifest.extensions_json)
    const updated = await tx.execute('UPDATE data_migrations SET state=\'complete\',extensions_json=? WHERE id=? AND source_fingerprint=?', [
      JSON.stringify(extra), idFor(fingerprint, MANIFEST_COLLECTION), fingerprint,
    ])
    need(updated.affectedRows === 1, 'KANATA_MIGRATION_JOURNAL_MISSING')
    return { verifiedTableCount: KANATA_MIGRATION_TABLES.length, tableResults }
  })
}

/**
 * @param {{operation:import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation,
 * source:{read:(password:string)=>Promise<any>,inspectArchives?:(descriptors:any[])=>Promise<any>,
 * readArchive?:(descriptor:any,password:string,assertCurrent:()=>void)=>Promise<any[]>},
 * syntheticOnly?:boolean,batchSize?:number,assertCurrent?:()=>void}} options
 */
export function createKanataDataMigrator({ operation, source, syntheticOnly, batchSize = 50, assertCurrent = () => {} }) {
  need(syntheticOnly === true, 'KANATA_MIGRATION_SYNTHETIC_ONLY')
  need(operation && typeof operation.transaction === 'function', 'KANATA_MIGRATION_TARGET_INVALID')
  need(source && typeof source.read === 'function', 'KANATA_MIGRATION_SOURCE_INVALID')
  need(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= MAX_ARCHIVE_PAGE_SIZE,
    'KANATA_MIGRATION_BATCH_SIZE_INVALID')
  return {
    /** Password is call-scoped only; no password or plaintext is retained by the factory. */
    async migrate(password) {
      need(typeof password === 'string' && password.length > 0, 'KANATA_PASSWORD_REQUIRED')
      const current = () => assertCurrent()
      current()
      const snapshot = await source.read(password)
      current()
      need(snapshot?.status === 'ready' && snapshot.recovered === false,
        snapshot?.status === 'missing' ? 'KANATA_MIGRATION_SOURCE_MISSING' : 'KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED')
      need(snapshot.hasPendingSave === false && snapshot.saveError === '',
        'KANATA_MIGRATION_SOURCE_PENDING_SAVE')
      const data = assertKanataData(snapshot.data)
      const descriptors = data.messageArchives ?? []
      if (descriptors.length) {
        need(typeof source.inspectArchives === 'function' && typeof source.readArchive === 'function',
          'KANATA_MIGRATION_ARCHIVE_SOURCE_REQUIRED')
        current()
        await source.inspectArchives(descriptors)
        current()
      }
      const fingerprint = sourceFingerprint(snapshot.fingerprint, data)
      const collections = createKanataDataMigrationCollections(data)
      const activeIndex = collections.findIndex(collection => collection.name === 'messages.active')
      need(activeIndex >= 0, 'KANATA_MIGRATION_PLAN_INVALID')
      if (descriptors.length) collections.splice(activeIndex, 0,
        createArchiveMessagesCollection(descriptors, source, password, current))
      const existing = await preflight(operation, fingerprint, collections, data)
      let previousComplete = existing.resumed
      for (const collection of collections) {
        const [row] = await operation.transaction(tx => tx.query(JOURNAL_SELECT, [idFor(fingerprint, collection.name)]))
        if (row?.state === 'complete') continue
        previousComplete = false
        try { await migrateCollection(operation, fingerprint, collection, current, batchSize) }
        catch (error) {
          await updateFailed(operation, fingerprint, collection.name, error)
          throw error
        }
      }
      try {
        current()
        const verification = await verifyTarget(operation, fingerprint, collections, data)
        current()
        return {
          status: previousComplete ? 'already-complete' : 'complete',
          sourceFingerprint: fingerprint,
          collections: collections.length,
          verifiedTableCount: verification.verifiedTableCount,
          counts: Object.fromEntries(Object.entries(verification.tableResults).map(([table, result]) => [table, result.count])),
        }
      } catch (error) {
        await updateFailed(operation, fingerprint, MANIFEST_COLLECTION, error)
        throw error
      }
    },
  }
}
