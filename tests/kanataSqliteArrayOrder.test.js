import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Text } from '../src/shared/crypto/sha256Text.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../src/features/chat/storage/sqlite/kanataSchema.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { KANATA_ARRAY_TABLES } from '../src/features/chat/storage/sqlite/kanataSchemaArrayOrder.js'
import { assertDomainArrayOrder, domainArrayOrderPage } from '../src/features/chat/storage/sqlite/kanataArrayOrder.js'
import { createKanataSqliteDomains } from '../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { schemaHarness } from './helpers/kanataSqliteHarness.js'
import { installLegacySchema } from './helpers/kanataSqliteLegacy.js'
import { m2Fixture, m2FixtureCommands } from './helpers/kanataSqliteM2Fixture.js'
import { eventCompatFixture } from './helpers/kanataEventCompatFixture.js'

const before = db => KANATA_ARRAY_TABLES.map(({ entity, order }) => [
  db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all(),
  db.prepare(`SELECT * FROM ${order} ORDER BY world_id,ordinal`).all(),
])
const operation = h => ({ transaction: action => h.connection.transaction(tx => action({
  query: tx.query, execute: async (sql, args) => {
    await tx.execute(sql, args)
    return { affectedRows: h.db.prepare('SELECT changes() AS n').get().n }
  },
})) })
const tools = { id: () => 'order-test-' + crypto.randomUUID(), clock: () => 1800000 }

test('005 freezes 001–004 checksums and never backfills a populated v4', async t => {
  const baseline = JSON.parse(readFileSync('docs/qa/kanata-sqlite-m3/evidence/schema-fingerprints.json'))
  for (const migration of KANATA_SCHEMA_MIGRATIONS.slice(0, 4)) {
    assert.equal(sha256Text(JSON.stringify([migration.version, migration.name, migration.statements])), baseline[migration.version - 1].checksum)
  }
  const h = schemaHarness(); t.after(h.close)
  await installLegacySchema(h, 4)
  const old = KANATA_ARRAY_TABLES.map(({ entity }) => h.db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all())
  assert.deepEqual(await migrateKanataSchema(h.connection), { version: 5, appliedVersions: [5] })
  const w = old[0][0].world_id
  for (const [index, { entity, order }] of KANATA_ARRAY_TABLES.entries()) {
    assert.deepEqual(h.db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all(), old[index])
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${order}`).get().n, 0)
    const row = old[index][0]
    assert.throws(() => h.db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(row.world_id, row.id, 0), /ORDER_IMMUTABLE/)
    assert.throws(() => h.db.prepare(`UPDATE ${entity} SET id=id WHERE id=?`).run(row.id), /ORDER_REQUIRED/)
  }
  const domains = createKanataSqliteDomains(operation(h), tools)
  await assert.rejects(domains.events.list(w), /ORDER_REQUIRED/)
  await assert.rejects(domains.events.managedEvent(w, old[0][0].id), /ORDER_REQUIRED/)
  await assert.rejects(domains.events.openRevocation(w, old[0][0].id), /ORDER_REQUIRED/)
  await assert.rejects(domains.events.proposeAcknowledged({ worldId: w }, 'legacy-must-not-write'), /ORDER_REQUIRED/)
  assert.deepEqual(KANATA_ARRAY_TABLES.map(({ entity }) => h.db.prepare(`SELECT * FROM ${entity} ORDER BY id`).all()), old)
  // Reopen remains structurally valid, while business readiness stays closed.
  assert.deepEqual(await migrateKanataSchema(h.connection), { version: 5, appliedVersions: [] })
  await assert.rejects(operation(h).transaction(tx => assertDomainArrayOrder(tx, w)), /ORDER_REQUIRED/)
})

test('005 persists original non-ID/non-time array order; rowid changes cannot change it', async t => {
  const h = schemaHarness(); t.after(h.close)
  await migrateKanataSchema(h.connection)
  const data = m2Fixture()
  data.events.reverse(); data.effects.reverse(); data.effectBaselines.reverse()
  await h.connection.transaction(async tx => {
    await tx.execute('PRAGMA defer_foreign_keys=ON')
    for (const command of m2FixtureCommands(data)) await tx.execute(command.sql, command.parameters)
  })
  for (const [index, key] of ['events', 'effects', 'effectBaselines'].entries()) {
    const { entity, order } = KANATA_ARRAY_TABLES[index]
    const world = data.events[0].worldId
    const expected = data[key].filter(row => row.worldId === world).map(row => row.id)
    const read = () => h.db.prepare(`SELECT entity_id FROM ${order} WHERE world_id=? ORDER BY ordinal`).all(world).map(row => row.entity_id)
    assert.deepEqual(read(), expected)
    h.db.prepare(`UPDATE ${entity} SET rowid=(SELECT max(rowid)+1 FROM ${entity}) WHERE id=?`).run(expected[0])
    assert.deepEqual(read(), expected)
    const [sql] = h.db.prepare(`EXPLAIN QUERY PLAN SELECT entity_id FROM ${order} WHERE world_id=? AND ordinal>? ORDER BY ordinal LIMIT ?`).all(world, -1, 50)
    assert.match(sql.detail, /INDEX/)
  }
})

test('005 rejects ordinary updates/deletes, replace/ignore, orphan/cross-world and invalid ordinals', async t => {
  const h = await eventCompatFixture(); t.after(h.close)
  for (const { entity, order } of KANATA_ARRAY_TABLES) {
    const row = h.db.prepare(`SELECT * FROM ${order} LIMIT 1`).get()
    const snapshot = before(h.db)
    for (const sql of [`UPDATE ${order} SET ordinal=ordinal+1`, `UPDATE OR REPLACE ${order} SET entity_id=entity_id`, `DELETE FROM ${order}`]) {
      assert.throws(() => h.db.exec(sql), /ORDER_IMMUTABLE/)
    }
    for (const conflict of ['', 'OR REPLACE ', 'OR IGNORE ']) {
      assert.throws(() => h.db.prepare(`INSERT ${conflict}INTO ${order} VALUES(?,?,?)`).run(row.world_id, row.entity_id, row.ordinal), /ORDER_IMMUTABLE/)
    }
    for (const ordinal of [-1, 0.5, 9007199254740992]) {
      assert.throws(() => h.db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(row.world_id, 'bad-ordinal', ordinal), /CHECK|INTEGER|IMMUTABLE/)
    }
    const foreign = h.fixture.worlds.find(world => world.id !== row.world_id).id
    assert.throws(() => h.db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(foreign, row.entity_id, 999), /IMMUTABLE/)
    assert.throws(() => h.db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(row.world_id, 'orphan-order', 999), /FOREIGN KEY/)
    assert.throws(() => h.db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(row.entity_id), /FOREIGN KEY/)
    assert.deepEqual(before(h.db), snapshot)
  }
})

test('005 full Repository coverage check rejects a partially damaged mapping before reads or writes', async t => {
  const h = await eventCompatFixture(); t.after(h.close)
  // Fault setup only: remove a guard, damage one mapping and restore the EXACT
  // DDL. This is not an ordinary repair/write path and is never in the catalog.
  const ddl = KANATA_SCHEMA_MIGRATIONS[4].statements.find(sql => sql.startsWith('CREATE TRIGGER event_array_order_no_delete '))
  h.db.exec('DROP TRIGGER event_array_order_no_delete')
  h.db.prepare('DELETE FROM event_array_order WHERE entity_id=?').run(h.fixture.events[0].id)
  h.db.exec(ddl)
  const original = before(h.db)
  await assert.rejects(h.domains.events.list(h.worldId), /ORDER_REQUIRED/)
  await assert.rejects(h.domains.events.openRevocation(h.worldId, h.fixture.events[0].id), /ORDER_REQUIRED/)
  await assert.rejects(h.domains.events.proposeAcknowledged(h.fields, 'partial-mapping'), /ORDER_REQUIRED/)
  await assert.rejects(h.domains.events.commitAcknowledged(h.worldId, h.fixture.events[0].id, 1), /ORDER_REQUIRED/)
  assert.deepEqual(before(h.db), original)
})

test('005 covers normal/legacy commit and both correction writers, Effects/Baselines and rollback/idempotency', async t => {
  const h = await eventCompatFixture(); t.after(h.close)
  const { events } = h.domains
  const move = { ...h.fields, kind: 'move', action: { instanceId: h.instanceId, location: '顺序合成位置' } }
  const a = await events.proposeAcknowledged(move, 'order-move')
  await events.commitAcknowledged(h.worldId, a.id, 1)
  const corrected = await events.correctConfirmed((await events.openRevocation(h.worldId, a.id)).plan, undefined, 'order-correct', '修正')
  const b = await events.proposeAcknowledged(h.fields, 'order-legacy-action')
  h.db.prepare("UPDATE world_events SET extensions_json=json_set(extensions_json,'$.action','ab') WHERE id=?").run(b.id)
  await events.commitAcknowledged(h.worldId, b.id, 1)
  const legacyCorrected = await events.correctConfirmed((await events.openRevocation(h.worldId, b.id)).plan, undefined, 'order-correct-legacy', '旧 action 修正')
  const stored = h.db.prepare('SELECT entity_id FROM event_array_order WHERE world_id=? ORDER BY ordinal').all(h.worldId).map(row => row.entity_id)
  assert.deepEqual(stored.slice(-4), [a.id, corrected.id, b.id, legacyCorrected.id])
  for (const { entity, order } of KANATA_ARRAY_TABLES) {
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${entity}`).get().n, h.db.prepare(`SELECT count(*) AS n FROM ${order}`).get().n)
  }
  const original = before(h.db)
  const repeat = await events.proposeAcknowledged(move, 'order-move')
  assert.equal(repeat.id, a.id)
  assert.deepEqual(before(h.db), original)
  await assert.rejects(h.operation.transaction(async tx => {
    const source = h.db.prepare('SELECT * FROM world_events WHERE id=?').get(a.id)
    const columns = Object.keys(source)
    await tx.execute(`INSERT INTO world_events(${columns.join(',')}) VALUES(${columns.map(() => '?')})`, Object.values({ ...source, id: 'rollback-order-new' }))
    throw Error('AFTER_ENTITY_AND_ORDINAL')
  }), /AFTER_ENTITY_AND_ORDINAL/)
  assert.deepEqual(before(h.db), original)
})

test('005 v4 migration failures and COMMIT failure preserve disk; cold retry installs no backfill', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kanata-order-v5-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const failAt of [1, 7, 20, 'commit']) {
    const file = join(dir, 'case-' + failAt + '.db')
    const initial = schemaHarness(file); await installLegacySchema(initial, 4); initial.close()
    const original = readFileSync(file)
    let writes = 0
    const h = schemaHarness(file, { beforeExecute() { if (++writes === failAt) throw Error('DDL_FAULT') }, beforeCommit() { if (failAt === 'commit') throw Error('COMMIT_FAULT') } })
    await assert.rejects(migrateKanataSchema(h.connection), /MIGRATION_FAILED/); h.close()
    assert.deepEqual(readFileSync(file), original)
    const reopen = schemaHarness(file)
    assert.deepEqual(await migrateKanataSchema(reopen.connection), { version: 5, appliedVersions: [5] })
    assert.equal(reopen.db.prepare('SELECT count(*) AS n FROM event_array_order').get().n, 0)
    reopen.close()
  }
})

test('005 ordinal keyset stays at 50 rows with 1k/10k synthetic appends', async t => {
  for (const size of [1000, 10000]) {
    const h = await eventCompatFixture(); t.after(h.close)
    const seed = h.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision)
      SELECT 'order-growth-'||printf('%05d',?-i),?,'candidate','private','合成顺序',1000,1000,1 FROM n`)
    const count = h.db.prepare('SELECT count(*) AS n FROM event_array_order WHERE world_id=?').get(h.worldId).n
    const started = performance.now()
    h.db.exec('BEGIN IMMEDIATE'); seed.run(size, size, h.worldId); h.db.exec('COMMIT')
    assert.equal((await domainArrayOrderPage(h.tx, 'events', h.worldId, count - 1, 1))[0].id,
      'order-growth-' + String(size - 1).padStart(5, '0'))
    let after = -1, total = 0, maxRows = 0
    for (;;) {
      const page = await domainArrayOrderPage(h.tx, 'events', h.worldId, after)
      maxRows = Math.max(maxRows, page.length); total += page.length
      if (!page.length) break
      after = page.at(-1).ordinal
    }
    assert.equal(total, count + size); assert.equal(maxRows, 50)
    await assert.rejects(domainArrayOrderPage(h.tx, 'events', h.worldId, -1, 51), /LIMIT_INVALID/)
    t.diagnostic(JSON.stringify({ size, maxRows, elapsedMs: Math.round(performance.now() - started) }))
  }
})
