import test from 'node:test'
import assert from 'node:assert/strict'
import { schemaHarness } from './helpers/kanataSqliteHarness.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {
  createKanataMigrationCoordinator,
  kanataMigrationSourceFingerprint,
} from '../src/features/chat/storage/sqlite/kanataDataMigrator.js'

function operationFor(h) {
  return {
    transaction: action => h.connection.transaction(tx => action({
      query: tx.query,
      execute: async (sql, parameters = []) => {
        const before = Number(h.db.prepare('SELECT total_changes() AS count').get().count)
        await tx.execute(sql, parameters)
        const after = Number(h.db.prepare('SELECT total_changes() AS count').get().count)
        return { affectedRows: after - before }
      },
    })),
  }
}
async function setup(t) {
  const h = schemaHarness()
  t.after(h.close)
  await migrateKanataSchema(h.connection)
  h.db.exec('CREATE TABLE m5_synthetic_rows(id INTEGER PRIMARY KEY,value TEXT NOT NULL) STRICT')
  return { h, operation: operationFor(h) }
}
function collection(values, state = {}) {
  return {
    name: 'messages',
    expectedCount: values.length,
    async readBatch(cursor, limit) {
      const offset = Number(cursor ?? 0)
      const end = Math.min(values.length, offset + limit)
      state.reads = (state.reads ?? 0) + 1
      return { items: values.slice(offset, end), nextCursor: end, done: end === values.length }
    },
    async write(tx, item) {
      await tx.execute('INSERT INTO m5_synthetic_rows(id,value) VALUES(?,?)', [item.id, item.value])
      if (state.failOn === item.id) throw new Error('injected failure')
    },
    async verify(tx, context) {
      const rows = await tx.query('SELECT id,value FROM m5_synthetic_rows ORDER BY id')
      assert.equal(rows.length, context.expectedCount)
      assert.equal(context.importedCount, context.expectedCount)
      assert.deepEqual(rows.map(row => Number(row.id)), values.map(row => row.id))
      assert.deepEqual(rows.map(row => row.value), values.map(row => row.value))
    },
  }
}
const verifyAll = async (tx, context) => {
  const rows = await tx.query('SELECT count(*) AS count FROM m5_synthetic_rows')
  assert.equal(Number(rows[0].count), context.collections.reduce((sum, row) => sum + row.importedCount, 0))
}

test('M5 每批数据写入与 journal cursor 同事务提交；失败批次整体回滚并可续传', async t => {
  const { h, operation } = await setup(t)
  const values = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, value: 'synthetic-' + (index + 1) }))
  const state = { failOn: 4 }
  const migrator = createKanataMigrationCoordinator({ operation, batchSize: 2 })
  const request = {
    syntheticOnly: true,
    sourceFingerprint: 'a'.repeat(64),
    collections: [collection(values, state)],
    verify: verifyAll,
  }

  await assert.rejects(migrator.run(request), error => error.code === 'KANATA_MIGRATION_FAILED')
  assert.deepEqual(h.db.prepare('SELECT id FROM m5_synthetic_rows ORDER BY id').all().map(row => Number(row.id)), [1, 2])
  const failed = h.db.prepare("SELECT cursor_json,imported_count,state FROM data_migrations WHERE collection='messages'").get()
  assert.equal(failed.cursor_json, '2')
  assert.equal(failed.imported_count, 2)
  assert.equal(failed.state, 'failed')

  state.failOn = 0
  const result = await migrator.run(request)
  assert.equal(result.state, 'complete')
  assert.deepEqual(result.collections, [{ collection: 'messages', importedCount: 5, resumed: true }])
  assert.deepEqual(h.db.prepare('SELECT id FROM m5_synthetic_rows ORDER BY id').all().map(row => Number(row.id)), [1, 2, 3, 4, 5])

  const readsBefore = state.reads
  const again = await migrator.run(request)
  assert.equal(again.state, 'complete')
  assert.equal(state.reads, readsBefore)
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM m5_synthetic_rows').get().count, 5)
})

test('M5 拒绝源指纹变化、非合成运行和超过上限的批次', async t => {
  const { operation } = await setup(t)
  const migrator = createKanataMigrationCoordinator({ operation, batchSize: 2 })
  const values = [{ id: 1, value: 'synthetic' }]
  const source = collection(values)
  const request = { syntheticOnly: true, sourceFingerprint: 'b'.repeat(64), collections: [source], verify: verifyAll }
  await migrator.run(request)
  await assert.rejects(migrator.run({ ...request, sourceFingerprint: 'c'.repeat(64) }),
    error => error.code === 'KANATA_MIGRATION_SOURCE_CHANGED')
  await assert.rejects(migrator.run({ ...request, syntheticOnly: false }),
    error => error.code === 'KANATA_MIGRATION_SYNTHETIC_ONLY')
  assert.throws(() => createKanataMigrationCoordinator({ operation, batchSize: 129 }),
    error => error.code === 'KANATA_MIGRATION_BATCH_SIZE_INVALID')
})

test('M5 拒绝空的非终止页与未完成的目标 Schema', async t => {
  const { operation } = await setup(t)
  const migrator = createKanataMigrationCoordinator({ operation, batchSize: 2 })
  const broken = {
    name: 'broken',
    expectedCount: 1,
    async readBatch(cursor) { return { items: [], nextCursor: cursor, done: false } },
    async write() {},
    async verify() {},
  }
  await assert.rejects(migrator.run({
    syntheticOnly: true,
    sourceFingerprint: 'd'.repeat(64),
    collections: [broken],
    verify: verifyAll,
  }), error => error.code === 'KANATA_MIGRATION_BATCH_INVALID')

  const h = schemaHarness()
  t.after(h.close)
  const notMigrated = createKanataMigrationCoordinator({ operation: operationFor(h) })
  await assert.rejects(notMigrated.run({
    syntheticOnly: true,
    sourceFingerprint: 'e'.repeat(64),
    collections: [],
    verify: async () => {},
  }), error => error.code === 'KANATA_MIGRATION_SCHEMA_VERSION_MISMATCH')
})

test('M5 源指纹覆盖主密文与归档描述符，且不接受重复归档 key', () => {
  const descriptor = {
    version: 1, key: 'f'.repeat(64), worldId: 'world-one', conversationId: 'conversation-one',
    bytes: 128, index: 'a'.repeat(1024), messages: [{ id: 'message-one', revision: 2, createdAt: 100 }],
  }
  const first = kanataMigrationSourceFingerprint('1'.repeat(64), [descriptor])
  assert.equal(first, kanataMigrationSourceFingerprint('1'.repeat(64), [descriptor]))
  assert.notEqual(first, kanataMigrationSourceFingerprint('2'.repeat(64), [descriptor]))
  assert.throws(() => kanataMigrationSourceFingerprint('1'.repeat(64), [descriptor, descriptor]),
    error => error.code === 'KANATA_MIGRATION_SOURCE_INVALID')
})
