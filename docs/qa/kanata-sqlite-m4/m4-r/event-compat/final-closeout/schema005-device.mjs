// Synthetic-only JS→Native acceptance. The default APK never registers these SQLs.
import { createAndroidKanataSqliteDriver } from '../../../../../../src/platform/storage/androidKanataSqliteDriver.js'
import { deriveKanataSqliteKek } from '../../../../../../src/platform/security/kanataSqliteKek.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { KANATA_SCHEMA_SQL as schema } from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { arrayOrderQueries, domainArrayOrderPage } from '../../../../../../src/features/chat/storage/sqlite/kanataArrayOrder.js'
import { KANATA_ARRAY_TABLES } from '../../../../../../src/features/chat/storage/sqlite/kanataSchemaArrayOrder.js'
import { sha256Text } from '../../../../../../src/shared/crypto/sha256Text.js'

const countFields = KANATA_ARRAY_TABLES.map(({ entity }, i) => `(SELECT count(*) FROM ${entity},s WHERE world_id=s.w) AS n${i}`)
export const orderLegacyCounts = `/* SYNTHETIC_ORDER_005_LEGACY */ WITH s(w) AS (VALUES(?)) SELECT ${countFields.join(',')}`
export const orderCounts = `/* SYNTHETIC_ORDER_005_COUNTS */ WITH s(w) AS (VALUES(?)) SELECT ${[
  ...countFields, ...KANATA_ARRAY_TABLES.map(({ order }, i) => `(SELECT count(*) FROM ${order},s WHERE world_id=s.w) AS o${i}`),
].join(',')}`
const orphan = "INSERT INTO card_versions(id,card_id,revision,definition_json,raw_data_json,source) VALUES(?,?,1,'{}','{}','synthetic-order-005')"
export const orderSchemaOrphan = '/* SYNTHETIC_ORDER_005_SCHEMA */ ' + orphan
export const orderBusinessOrphan = '/* SYNTHETIC_ORDER_005_BUSINESS */ ' + orphan
export const orderMutations = KANATA_ARRAY_TABLES.flatMap(({ order }) => [
  `UPDATE ${order} SET ordinal=ordinal+1 WHERE world_id=?`,
  `DELETE FROM ${order} WHERE world_id=?`,
  `INSERT OR REPLACE INTO ${order}(world_id,entity_id,ordinal) VALUES(?,?,?)`,
])
export const schema005Fault = { mode: '', phase: 'idle' }
const interruptedDdl = sha256Text(KANATA_SCHEMA_MIGRATIONS[4].statements[1])
export async function schema005AfterExecute(command, result) {
  if (command.statement !== interruptedDdl) return result
  if (schema005Fault.mode === 'migration-ddl') {
    schema005Fault.mode = ''
    throw Error('SYNTHETIC_ORDER_005_DDL_FAILURE')
  }
  if (schema005Fault.mode === 'migration-crash') {
    schema005Fault.phase = 'schema005-ddl-uncommitted'
    return new Promise(() => {})
  }
  return result
}
export async function schema005BeforeCommit(command, bridge) {
  if (schema005Fault.mode === 'migration-commit' || schema005Fault.mode === 'write-commit') {
    const sql = schema005Fault.mode === 'migration-commit' ? orderSchemaOrphan : orderBusinessOrphan
    schema005Fault.mode = ''
    await bridge.execute({ ...command, statement: sha256Text(sql), parameters: ['order-orphan', 'missing-order-card'] })
  } else if (schema005Fault.mode === 'write-crash') {
    schema005Fault.phase = 'schema005-entity-ordinal-uncommitted'
    return new Promise(() => {})
  }
}

function check(value, code) { if (!value) throw Error(code) }
async function denied(action, expected) {
  try { await action() } catch (error) {
    check((error.code ?? error.message) === expected, 'UNEXPECTED_' + (error.code ?? error.message)); return
  }
  throw Error('MISSING_' + expected)
}

export function installSchema005Device({ candidate, bridge, auth, session }) {
  const context = password => {
    const revision = auth.sessionRevision
    return { sessionRevision: revision, ownerGeneration: 1,
      assertCurrent() { check(!auth.isLocked && auth.sessionRevision === revision, 'ORDER_QA_LEASE_EXPIRED') },
      deriveKey: salt => deriveKanataSqliteKek(password, salt) }
  }
  // Executed with the archived, SHA-verified v4 APK. It commits a real encrypted
  // v4, completes the old native open, and seeds only the approved synthetic data.
  window.schema005PrepareV4 = async (password, fixture, commands) => {
    session(password); await candidate.release()
    let observed
    const driver = createAndroidKanataSqliteDriver({ bridge, initialize: op => op.transaction(async tx => {
      for (const migration of KANATA_SCHEMA_MIGRATIONS.slice(0, 4)) {
        for (const sql of migration.statements) await tx.execute(sql)
        await tx.execute(schema.insertJournal, [migration.version, migration.name,
          sha256Text(JSON.stringify([migration.version, migration.name, migration.statements]))])
        await tx.execute(schema.setVersion(migration.version))
      }
      for (let version = 1; version <= 4; version++) await tx.execute(schema.insertTime, [version, 1800000, 'js-wall-clock-utc-ms'])
      await tx.execute(schema.setApplicationId)
      observed = (await tx.query(schema.version))[0].user_version
    }) })
    try {
      const op = await driver.open(context(password), { create: true })
      await op.transaction(async tx => { for (const command of commands) await tx.execute(command.sql, command.parameters) })
      check(observed === 4, 'ORDER_REAL_V4_REQUIRED')
      return { version: observed, health: await op.health(), events: fixture.events.length, effects: fixture.effects.length,
        baselines: fixture.effectBaselines.length }
    } finally { await driver.release() }
  }
  // With v5 APK installed, inspect a failed upgrade without implicitly retrying it.
  const inspectV4 = async (password, worldId) => {
    await candidate.release()
    let state
    const driver = createAndroidKanataSqliteDriver({ bridge, initialize: op => op.transaction(async tx => {
      const objects = await tx.query(schema.objects)
      state = { version: (await tx.query(schema.version))[0].user_version,
        orderTables: objects.filter(row => /^(event|effect|baseline)_array_order$/.test(row.name)).length,
        counts: (await tx.query(orderLegacyCounts, [worldId]))[0] }
      throw Error('ORDER_V4_INSPECTION_DONE')
    }) })
    try { await denied(() => driver.open(context(password), { create: false }), 'ORDER_V4_INSPECTION_DONE') }
    finally { await driver.release() }
    check(state.version === 4 && state.orderTables === 0, 'ORDER_MIGRATION_ROLLBACK')
    return state
  }
  window.schema005MigrationFault = async (password, worldId, fault) => {
    session(password); schema005Fault.mode = fault
    await denied(() => candidate.run({}, op => op.health()), 'KANATA_SCHEMA_MIGRATION_FAILED')
    return inspectV4(password, worldId)
  }
  window.schema005ArmMigration = (password) => {
    session(password); schema005Fault.mode = 'migration-crash'; schema005Fault.phase = 'idle'
    void candidate.run({}, op => op.health()).catch(error => { schema005Fault.phase = error.code ?? error.message })
    return 'armed'
  }
  window.schema005InspectV4 = (password, worldId) => { session(password); return inspectV4(password, worldId) }
  window.schema005State = () => schema005Fault.phase
  const counts = (worldId) => candidate.run({}, op => op.transaction(async tx => (await tx.query(orderCounts, [worldId]))[0]))
  const fields = (worldId, instanceId) => ({ worldId, participantIds: [instanceId], sourceRefs: [], causedByEventIds: [],
    visibility: 'private', summary: '005 隔离顺序事件', effectiveAt: 1500, kind: 'move', action: { instanceId, location: '合成顺序位置' } })
  window.schema005MigrateAndWrite = async (password, fixture) => {
    session(password)
    const health = await candidate.run({}, op => op.health())
    const legacyWorld = fixture.events[0].worldId
    const legacy = await counts(legacyWorld)
    check(legacy.n0 > 0 && legacy.o0 === 0 && legacy.o1 === 0 && legacy.o2 === 0, 'ORDER_LEGACY_NOT_BACKFILLED')
    await denied(() => candidate.withDomains({}, d => d.events.list(legacyWorld)), 'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED')
    await denied(() => candidate.withDomains({}, d => d.events.openRevocation(legacyWorld, fixture.events[0].id)), 'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED')
    const options = { key: 'order-005-world', now: 1800000, timeZone: 'UTC', idFactory: kind => 'order-005-' + kind }
    const { world } = await candidate.withDomains({}, d => d.worlds.create(fixture.userId,
      { name: '005 合成世界', rules: '', displayName: '合成身份', background: '' }, options))
    const actor = await candidate.withDomains({}, d => d.characters.addInstance(world.id, fixture.cards[0].id,
      { key: 'order-005-actor', now: 1800000, idFactory: kind => 'order-005-actor-' + kind }))
    const move = fields(world.id, actor.id)
    const event = await candidate.withDomains({}, d => d.events.proposeAcknowledged(move, 'order-005-first'))
    // A real deferred-FK COMMIT failure must remove BOTH new Effects/Baselines
    // and their order rows, preserving the candidate event/revision and receipt.
    const before = await counts(world.id)
    schema005Fault.mode = 'write-commit'
    await denied(() => candidate.withDomains({}, d => d.events.commitAcknowledged(world.id, event.id, 1)), 'KANATA_SQLITE_TRANSACTION_FAILED')
    check(JSON.stringify(await counts(world.id)) === JSON.stringify(before), 'ORDER_WRITE_COMMIT_ROLLBACK')
    await candidate.withDomains({}, d => d.events.commitAcknowledged(world.id, event.id, 1))
    const committed = await counts(world.id)
    check(committed.n0 === committed.o0 && committed.n1 === committed.o1 && committed.n2 === committed.o2, 'ORDER_PRODUCER_COVERAGE')
    await candidate.run({}, op => op.transaction(async tx => {
      for (let index = 0; index < KANATA_ARRAY_TABLES.length; index++) {
        const page = await domainArrayOrderPage(tx, ['events', 'effects', 'baselines'][index], world.id)
        check(page.length > 0 && page.length <= 50, 'ORDER_PAGE')
      }
    }))
    for (const sql of orderMutations) {
      const index = Math.floor(orderMutations.indexOf(sql) / 3)
      const id = await candidate.run({}, op => op.transaction(async tx =>
        (await domainArrayOrderPage(tx, ['events', 'effects', 'baselines'][index], world.id))[0].id))
      await denied(() => candidate.run({}, op => op.transaction(tx => tx.execute(sql,
        sql.startsWith('INSERT') ? [world.id, id, 0] : [world.id]))), 'KANATA_SQLITE_TRANSACTION_FAILED')
    }
    return { health, legacy, scope: { worldId: world.id, instanceId: actor.id }, eventId: event.id,
      committed, commitFailure: true, immutableMutations: orderMutations.length, realModelCalls: 0 }
  }
  window.schema005ArmWrite = async (password, scope) => {
    session(password)
    const event = await candidate.withDomains({}, d => d.events.proposeAcknowledged({ ...fields(scope.worldId, scope.instanceId),
      kind: 'rest', action: { instanceId: scope.instanceId } }, 'order-005-crash'))
    schema005Fault.mode = 'write-crash'; schema005Fault.phase = 'idle'
    void candidate.withDomains({}, d => d.events.commitAcknowledged(scope.worldId, event.id, 1))
      .catch(error => { schema005Fault.phase = error.code ?? error.message })
    return { eventId: event.id }
  }
  window.schema005RecoverWrite = async (password, scope, eventId) => {
    session(password)
    const original = await counts(scope.worldId)
    const revision = await candidate.withDomains({}, d => d.events.managedEvent(scope.worldId, eventId))
    check(revision.revision === 1, 'ORDER_CRASH_CANDIDATE_REVISION')
    await candidate.withDomains({}, d => d.events.commitAcknowledged(scope.worldId, eventId, 1))
    const committed = await counts(scope.worldId)
    await candidate.withDomains({}, d => d.events.commitAcknowledged(scope.worldId, eventId, 1))
    check(JSON.stringify(await counts(scope.worldId)) === JSON.stringify(committed), 'ORDER_RETRY_IDEMPOTENCY')
    check(committed.n1 === original.n1 + 2 && committed.o1 === original.o1 + 2 &&
      committed.n2 === original.n2 + 2 && committed.o2 === original.o2 + 2, 'ORDER_CRASH_EFFECT_BASELINE_ROLLBACK')
    return { original, committed, retryIdempotent: true }
  }
  window.schema005ColdCheck = async (password, legacyWorld, scope) => {
    session(password)
    const legacy = await counts(legacyWorld)
    await denied(() => candidate.withDomains({}, d => d.events.list(legacyWorld)), 'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED')
    return { legacy, active: await counts(scope.worldId), coldRejectedMissingOrder: true }
  }
}

export { arrayOrderQueries }
