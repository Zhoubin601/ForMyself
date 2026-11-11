// Reviewable storage experiment only. Never imported by src, catalog or Android.
// No migration 005 is implemented or registered here.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateKanataSchema } from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { previewKanataEventRevoke } from '../../../../../../src/features/chat/experience/kanataEvents.js'
import { validateKanataData } from '../../../../../../src/features/chat/domain/kanataValidation.js'
import { m2Fixture, m2FixtureCommands } from '../../../../../../tests/helpers/kanataSqliteM2Fixture.js'

const collections = [
  ['events', 'world_events', 'qa_event_array_order'],
  ['effects', 'world_effects', 'qa_effect_array_order'],
  ['effectBaselines', 'effect_baselines', 'qa_baseline_array_order'],
]
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const first = m2Fixture()
const root = first.events[0]
first.events.push({ ...root, id: 'event-order-sibling', sourceRefs: [], causedByEventIds: [root.id] })
validateKanataData(first)
const second = structuredClone(first)
second.events = [first.events[0], first.events[3], first.events[4], first.events[1], first.events[2]]
second.effects.reverse()
second.effectBaselines.reverse()
validateKanataData(second)

const directory = mkdtempSync(join(tmpdir(), 'kanata-order-review-'))
const files = []
const databases = []
const results = []
try {
  for (const [label, data] of [['A', first], ['B', second]]) {
    const file = join(directory, label + '.sqlite')
    files.push(file)
    let db = new DatabaseSync(file)
    databases.push(db)
    db.exec('PRAGMA foreign_keys=ON')
    await migrateKanataSchema({ transaction: async action => {
      db.exec('BEGIN IMMEDIATE')
      try {
        await action({ query: async (sql, args = []) => db.prepare(sql).all(...args),
          execute: async (sql, args = []) => { db.prepare(sql).run(...args) } })
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    } }, { now: () => 1800000 })
    db.exec('BEGIN IMMEDIATE')
    // A valid domain array need not be topologically ordered. Check all FKs at
    // commit rather than making the fixture writer impose a product ordering.
    db.exec('PRAGMA defer_foreign_keys=ON')
    for (const { sql, parameters } of m2FixtureCommands(data)) db.prepare(sql).run(...parameters)
    db.exec('COMMIT')
    const snapshot = () => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row)).sort()])
    const originalSnapshot = snapshot()
    const originalDigest = sha(originalSnapshot)
    const ddl = collections.map(([, table, order]) => `CREATE TABLE ${order} (
      world_id TEXT NOT NULL, entity_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY(world_id,entity_id), UNIQUE(world_id,ordinal),
      FOREIGN KEY(world_id,entity_id) REFERENCES ${table}(world_id,id)
    ) STRICT, WITHOUT ROWID`)
    // A failed additive DDL transaction leaves every old table/row unchanged.
    db.exec('BEGIN IMMEDIATE')
    db.exec(ddl[0])
    db.prepare('INSERT INTO qa_event_array_order VALUES(?,?,?)').run(root.worldId, root.id, 0)
    db.exec('ROLLBACK')
    assert.deepEqual(snapshot(), originalSnapshot)

    // Kill a separate process after real DDL + a row write, before COMMIT.
    // It receives only this experiment's newly created synthetic temp database.
    db.close()
    databases.pop()
    const crash = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db=new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
      db.exec(${JSON.stringify(ddl[0])});
      db.prepare('INSERT INTO qa_event_array_order VALUES(?,?,?)').run(${JSON.stringify(root.worldId)},${JSON.stringify(root.id)},0);
      process.stdout.write('ORDER_DDL_AND_ROW_WRITTEN_BEFORE_KILL\\n');
      process.kill(process.pid,'SIGKILL');
    `, file], { encoding: 'utf8', timeout: 10000 })
    assert.equal(crash.error, undefined)
    assert.match(crash.stdout, /ORDER_DDL_AND_ROW_WRITTEN_BEFORE_KILL/)
    assert.ok(crash.status !== 0 || crash.signal)
    db = new DatabaseSync(file)
    databases.push(db)
    db.exec('PRAGMA foreign_keys=ON')
    assert.deepEqual(snapshot(), originalSnapshot)

    // This opt-in sandbox mapping receives the original array; it never infers it.
    db.exec('BEGIN IMMEDIATE')
    for (let i = 0; i < collections.length; i++) {
      const [key, , order] = collections[i]
      db.exec(ddl[i])
      for (const [ordinal, entity] of data[key].entries()) {
        db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(entity.worldId, entity.id, ordinal)
      }
    }
    db.exec('COMMIT')
    db.close()
    databases.pop()
    db = new DatabaseSync(file)
    databases.push(db)
    db.exec('PRAGMA foreign_keys=ON')
    const recovered = structuredClone(data)
    for (const [key, table, order] of collections) {
      const readOrder = () => {
        const missing = db.prepare(`SELECT 1 FROM ${table} e LEFT JOIN ${order} o
          ON o.world_id=e.world_id AND o.entity_id=e.id WHERE o.entity_id IS NULL LIMIT 1`).get()
        if (missing) throw Error('DOMAIN_ARRAY_ORDER_UNPROVEN')
        // Full gathering is deliberate test-only Oracle code, never a product API.
        return db.prepare(`SELECT entity_id FROM ${order} ORDER BY ordinal`).all().map(row => row.entity_id)
      }
      const ids = readOrder()
      assert.deepEqual(ids, data[key].map(entity => entity.id))
      recovered[key] = ids.map(id => data[key].find(entity => entity.id === id))
      const entity = data[key][0]
      assert.throws(() => db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(entity.worldId, entity.id, 100000), /UNIQUE/)
      const nextEntity = data[key].find(row => row.id !== entity.id && row.worldId === entity.worldId)
      assert.ok(nextEntity)
      const ordinal = db.prepare(`SELECT ordinal FROM ${order} WHERE entity_id=?`).get(entity.id).ordinal
      assert.throws(() => db.prepare(`UPDATE ${order} SET ordinal=? WHERE entity_id=?`).run(ordinal, nextEntity.id), /UNIQUE/)
      assert.throws(() => db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(entity.worldId, 'missing-synthetic', 100000), /FOREIGN KEY/)
      const otherWorld = data.worlds.find(world => world.id !== entity.worldId)
      assert.ok(otherWorld)
      assert.throws(() => db.prepare(`INSERT INTO ${order} VALUES(?,?,?)`).run(otherWorld.id, entity.id, 100000), /FOREIGN KEY/)
      db.exec('BEGIN IMMEDIATE')
      db.prepare(`DELETE FROM ${order} WHERE entity_id=?`).run(entity.id)
      assert.throws(readOrder, /DOMAIN_ARRAY_ORDER_UNPROVEN/)
      db.exec('ROLLBACK')
      assert.deepEqual(readOrder(), ids)
    }
    assert.deepEqual(previewKanataEventRevoke(recovered, root.id), previewKanataEventRevoke(data, root.id))
    // Order metadata must not rewrite unknown JSON or any declared legacy column.
    const oldTables = snapshot().filter(([name]) => !name.startsWith('qa_'))
    assert.deepEqual(oldTables, originalSnapshot)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4)
    results.push({ label, logicalV4Digest: originalDigest,
      originalOrder: Object.fromEntries(collections.map(([key]) => [key, data[key].map(entity => entity.id)])),
      revokeIds: previewKanataEventRevoke(recovered, root.id).revokeIds,
      signatureDigest: sha(previewKanataEventRevoke(recovered, root.id).signature),
      sandbox: { originalArrayRoundTrip: true, coldReopen: true, ddlRollback: true,
        killedBeforeCommitRollback: true, crashExit: crash.status, crashSignal: crash.signal,
        missingOrderFailClosed: true, duplicateAndCrossWorldRejected: true, oldRowsUnchanged: true,
        userVersion: 4, registeredMigration005: false } })
    db.close()
    databases.pop()
  }
  assert.equal(results[0].logicalV4Digest, results[1].logicalV4Digest)
  assert.notDeepEqual(results[0].revokeIds, results[1].revokeIds)
  assert.notEqual(results[0].signatureDigest, results[1].signatureDigest)
  console.log(JSON.stringify({ status: 'BLOCKED', experimentAssertions: 'PASS',
    sqliteVersion: process.versions.sqlite, results,
    conclusion: 'The current declared v4 rows are identical for two valid arrays with different required previews. Proposed QA-only side tables round-trip a supplied original order, but cannot reconstruct missing historical order. No production migration or Android validation performed.' }, null, 2))
  process.exitCode = 1
} finally {
  for (const db of databases) db.close()
  // Remove only files created by this experiment in its exclusive new temp dir.
  for (const file of files) unlinkSync(file)
  rmdirSync(directory)
}
