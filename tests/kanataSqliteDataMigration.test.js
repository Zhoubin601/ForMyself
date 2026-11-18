import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { sha256Text } from '../src/shared/crypto/sha256Text.js'
import { createArchiveIndex, validateArchivePage } from '../src/features/chat/storage/messageArchiveCore.js'
import { validateKanataData } from '../src/features/chat/domain/kanataValidation.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { createKanataDataMigrator } from '../src/features/chat/storage/sqlite/kanataDataMigrator.js'
import { KANATA_MIGRATION_TABLES } from '../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'
import { kanataSqliteFixture } from './helpers/kanataSqliteFixture.js'

function targetHarness(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=50')
  const control = { failMessageAt: 0, messageInserts: 0 }
  const operation = {
    async transaction(action) {
      db.exec('BEGIN IMMEDIATE')
      const tx = {
        query: async (sql, parameters = []) => db.prepare(sql).all(...parameters),
        execute: async (sql, parameters = []) => {
          if (sql.startsWith('INSERT INTO messages(')) {
            control.messageInserts++
            if (control.failMessageAt && control.messageInserts === control.failMessageAt) {
              control.failMessageAt = 0
              throw new Error('synthetic batch interruption')
            }
          }
          return { affectedRows: Number(db.prepare(sql).run(...parameters).changes) }
        },
      }
      try {
        const result = await action(tx)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  t.after(() => db.close())
  return { db, operation, control }
}

function syntheticSource(options = {}) {
  const base = kanataSqliteFixture()
  const worldId = base.worlds[0].id
  const conversationId = base.conversations[0].id
  const archiveMessages = [1, 2, 3].map(index => ({
    ...base.messages[0],
    id: 'archive-message-' + index,
    createdAt: 100 + index,
    revision: 1,
    content: '合成历史消息-' + index,
    turnId: 'archive-turn-' + index,
    batchId: 'archive-batch-' + index,
  }))
  const archiveCiphertext = 'synthetic-archive-ciphertext'
  const descriptor = {
    version: 1,
    key: sha256Text(archiveCiphertext),
    worldId,
    conversationId,
    bytes: archiveCiphertext.length,
    index: createArchiveIndex(archiveMessages),
    messages: archiveMessages.map(({ id, revision, createdAt }) => ({ id, revision, createdAt })),
  }
  const page = { type: 'kanata-message-page', version: 1, worldId, conversationId, messages: archiveMessages }
  base.version = 2
  base.messageArchives = [descriptor]
  base.worlds[0].m5SyntheticExtension = { nested: ['preserve-world-extension'] }
  base.messages[0].m5SyntheticExtension = 'preserve-active-message-extension'
  base.memories[0].m5SyntheticExtension = { preserve: true }
  const data = validateKanataData(base)
  const before = JSON.stringify(data)
  let primaryFingerprint = sha256Text('synthetic-primary-ciphertext')
  const calls = { read: 0, inspect: 0, archive: 0, password: [] }
  const source = {
    async read(password) {
      calls.read++
      calls.password.push(password)
      return {
        status: options.status ?? 'ready',
        data,
        fingerprint: primaryFingerprint,
        recovered: options.recovered ?? false,
        hasPendingSave: false,
        saveError: '',
      }
    },
    async inspectArchives(descriptors) {
      calls.inspect++
      assert.equal(descriptors.length, 1)
      assert.equal(descriptors[0].key, descriptor.key)
    },
    async readArchive(actual, password, assertCurrent) {
      calls.archive++
      assert.equal(sha256Text(archiveCiphertext), actual.key)
      assert.equal(archiveCiphertext.length, actual.bytes)
      assert.equal(actual.key, descriptor.key)
      assert.equal(password, 'synthetic-only-password')
      assertCurrent()
      return validateArchivePage(page, actual)
    },
  }
  return {
    data, descriptor, archiveMessages, before, calls, source,
    changeFingerprint(value) { primaryFingerprint = sha256Text(value) },
  }
}

async function migrateSchema(operation) {
  await migrateKanataSchema(operation)
}

const count = (db, table) => Number(db.prepare('SELECT count(*) AS count FROM ' + table).get().count)
const code = expected => error => error?.code === expected

test('M5-01 synthetic archive migration is read-only at source, batched, journaled, and fully verified', async t => {
  const target = targetHarness(t)
  await migrateSchema(target.operation)
  const fixture = syntheticSource()
  const migrator = createKanataDataMigrator({
    operation: target.operation, source: fixture.source, syntheticOnly: true, batchSize: 2,
  })

  const result = await migrator.migrate('synthetic-only-password')
  assert.equal(result.status, 'complete')
  assert.equal(result.verifiedTableCount, KANATA_MIGRATION_TABLES.length)
  assert.equal(result.counts.worlds, fixture.data.worlds.length)
  assert.equal(result.counts.messages, fixture.data.messages.length + fixture.archiveMessages.length)
  assert.equal(result.counts.archived_message_marks, fixture.archiveMessages.length)
  assert.equal(result.counts.message_life_sources, 1 + fixture.archiveMessages.length)
  assert.equal(count(target.db, 'data_migrations'), result.collections + 1)
  assert.equal(count(target.db, 'messages'), 5)
  assert.equal(count(target.db, 'archived_message_marks'), 3)
  assert.equal(count(target.db, 'message_life_sources'), 4)
  assert.deepEqual(target.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(target.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')

  const worldExtra = JSON.parse(target.db.prepare('SELECT extensions_json FROM worlds WHERE id=?').get(fixture.data.worlds[0].id).extensions_json)
  const messageExtra = JSON.parse(target.db.prepare("SELECT extensions_json FROM messages WHERE id='message-one'").get().extensions_json)
  const memoryExtra = JSON.parse(target.db.prepare("SELECT extensions_json FROM memories WHERE id='memory-one'").get().extensions_json)
  assert.deepEqual(worldExtra.m5SyntheticExtension, { nested: ['preserve-world-extension'] })
  assert.equal(messageExtra.m5SyntheticExtension, 'preserve-active-message-extension')
  assert.deepEqual(memoryExtra.m5SyntheticExtension, { preserve: true })
  assert.equal(target.db.prepare("SELECT count(*) AS count FROM archived_message_marks WHERE message_id LIKE 'archive-message-%'").get().count, 3)

  const journal = target.db.prepare('SELECT state FROM data_migrations').all()
  assert.ok(journal.every(row => row.state === 'complete'))
  const archiveJournal = target.db.prepare("SELECT extensions_json FROM data_migrations WHERE collection='messages.archive'").get()
  assert.deepEqual(JSON.parse(archiveJournal.extensions_json).targetTables,
    ['messages','message_life_sources','archived_message_marks','entity_ids'])
  const manifest = target.db.prepare("SELECT extensions_json FROM data_migrations WHERE collection='__manifest__'").get()
  assert.ok(JSON.parse(manifest.extensions_json).targetTables.includes('event_array_order'))
  assert.equal(JSON.stringify(fixture.data), fixture.before)
  assert.equal(fixture.calls.read, 1)
  assert.equal(fixture.calls.inspect, 1)
  assert.equal(fixture.calls.archive, 1, 'three archive rows are imported in two bounded batches from one decrypted page')
  assert.deepEqual(fixture.calls.password, ['synthetic-only-password'])

  const beforeCounts = KANATA_MIGRATION_TABLES.map(table => count(target.db, table))
  const again = await migrator.migrate('synthetic-only-password')
  assert.equal(again.status, 'already-complete')
  assert.deepEqual(KANATA_MIGRATION_TABLES.map(table => count(target.db, table)), beforeCounts)
  assert.equal(fixture.calls.archive, 1, 'completed archive pages are not decrypted again')
  assert.equal(JSON.stringify(fixture.data), fixture.before)
})

test('M5-02 failed batch rolls back every row and resumes from the last committed cursor', async t => {
  const target = targetHarness(t)
  await migrateSchema(target.operation)
  const fixture = syntheticSource()
  const migrator = createKanataDataMigrator({
    operation: target.operation, source: fixture.source, syntheticOnly: true, batchSize: 2,
  })
  target.control.failMessageAt = 2
  await assert.rejects(migrator.migrate('synthetic-only-password'), error => error.message === 'synthetic batch interruption')
  assert.equal(count(target.db, 'messages'), 0)
  assert.equal(count(target.db, 'archived_message_marks'), 0)
  assert.equal(count(target.db, 'message_life_sources'), 0)
  const failed = target.db.prepare("SELECT cursor_json,imported_count,state FROM data_migrations WHERE collection='messages.archive'").get()
  assert.equal(failed.state, 'failed')
  assert.equal(failed.imported_count, 0)
  assert.deepEqual(JSON.parse(failed.cursor_json), { archiveIndex: 0, messageOffset: 0 })

  fixture.changeFingerprint('changed-primary-ciphertext')
  await assert.rejects(migrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_SOURCE_CHANGED'))
  assert.equal(count(target.db, 'messages'), 0)

  fixture.changeFingerprint('synthetic-primary-ciphertext')
  const resumed = await migrator.migrate('synthetic-only-password')
  assert.equal(resumed.status, 'complete')
  assert.equal(count(target.db, 'messages'), 5)
  assert.equal(count(target.db, 'archived_message_marks'), 3)
  assert.ok(target.db.prepare('SELECT state FROM data_migrations').all().every(row => row.state === 'complete'))
  assert.equal(JSON.stringify(fixture.data), fixture.before)
})

test('M5-03a pending or failed encrypted source snapshots are rejected before target journal creation', async t => {
  const target = targetHarness(t)
  await migrateSchema(target.operation)
  const fixture = syntheticSource()
  const source = {
    async read() {
      return {
        status: 'ready', data: fixture.data, fingerprint: sha256Text('pending-source'),
        recovered: false, hasPendingSave: true, saveError: '',
      }
    },
  }
  const migrator = createKanataDataMigrator({
    operation: target.operation, source, syntheticOnly: true,
  })
  await assert.rejects(migrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_SOURCE_PENDING_SAVE'))
  assert.equal(count(target.db, 'data_migrations'), 0)
})

test('M5-03 recovered/missing sources and non-empty targets fail closed before import', async t => {
  const recoveredTarget = targetHarness(t)
  await migrateSchema(recoveredTarget.operation)
  const recovered = syntheticSource({ status: 'recovered', recovered: true })
  const recoveredMigrator = createKanataDataMigrator({
    operation: recoveredTarget.operation, source: recovered.source, syntheticOnly: true,
  })
  await assert.rejects(recoveredMigrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'))
  assert.equal(count(recoveredTarget.db, 'data_migrations'), 0)

  const missingTarget = targetHarness(t)
  await migrateSchema(missingTarget.operation)
  const missing = syntheticSource({ status: 'missing', recovered: false })
  const missingMigrator = createKanataDataMigrator({
    operation: missingTarget.operation, source: missing.source, syntheticOnly: true,
  })
  await assert.rejects(missingMigrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_SOURCE_MISSING'))
  assert.equal(count(missingTarget.db, 'data_migrations'), 0)

  const occupiedTarget = targetHarness(t)
  await migrateSchema(occupiedTarget.operation)
  await occupiedTarget.operation.transaction(tx => tx.execute(
    "INSERT INTO dataset_metadata(singleton,user_id,data_version,extensions_json) VALUES(1,'occupied-synthetic-user',1,'{}')",
  ))
  const emptySource = syntheticSource()
  const occupiedMigrator = createKanataDataMigrator({
    operation: occupiedTarget.operation, source: emptySource.source, syntheticOnly: true,
  })
  await assert.rejects(occupiedMigrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_TARGET_NOT_EMPTY'))
  assert.equal(count(occupiedTarget.db, 'data_migrations'), 0)
})

test('M5-03b wrong SQLite application identity is rejected before journal creation', async t => {
  const target = targetHarness(t)
  await migrateSchema(target.operation)
  await target.operation.transaction(tx => tx.execute('PRAGMA application_id=1'))
  const fixture = syntheticSource()
  const migrator = createKanataDataMigrator({ operation: target.operation, source: fixture.source, syntheticOnly: true })
  await assert.rejects(migrator.migrate('synthetic-only-password'), code('KANATA_MIGRATION_WRONG_DATABASE'))
  assert.equal(count(target.db, 'data_migrations'), 0)
})

test('M5-04 archive page verification failure stops before importing that page', async t => {
  const target = targetHarness(t)
  await migrateSchema(target.operation)
  const fixture = syntheticSource()
  fixture.source.readArchive = async () => {
    const tampered = [...fixture.archiveMessages]
    tampered[0] = { ...tampered[0], content: 'tampered-after-index' }
    return tampered
  }
  const migrator = createKanataDataMigrator({
    operation: target.operation, source: fixture.source, syntheticOnly: true, batchSize: 2,
  })
  await assert.rejects(migrator.migrate('synthetic-only-password'))
  assert.equal(count(target.db, 'messages'), 0)
  assert.equal(count(target.db, 'archived_message_marks'), 0)
  const failed = target.db.prepare("SELECT state,imported_count FROM data_migrations WHERE collection='messages.archive'").get()
  assert.equal(failed.state, 'failed')
  assert.equal(failed.imported_count, 0)
  assert.equal(JSON.stringify(fixture.data), fixture.before)
})
