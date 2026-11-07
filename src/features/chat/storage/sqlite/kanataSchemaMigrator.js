// @ts-check
import {sha256Text} from '../../../../shared/crypto/sha256Text.js'
import {KANATA_SCHEMA_APPLICATION_ID, KANATA_SCHEMA_MIGRATIONS, KANATA_SCHEMA_VERSION, KANATA_REGISTRY_VALIDATION_QUERIES} from './kanataSchema.js'
import {KANATA_AUDIT_VALIDATION_QUERIES} from './kanataSchemaHardening.js'

export class KanataSchemaError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.name = 'KanataSchemaError'; this.code = code }
}
/** @param {unknown} condition @param {string} code */
const need = (condition, code) => { if (!condition) throw new KanataSchemaError(code) }
/** @param {import('./kanataSchemaTypes').KanataSchemaMigration} migration */
const checksum = migration => sha256Text(JSON.stringify([migration.version, migration.name, migration.statements]))
/** @param {string} sql */
const canonical = sql => sql.trim().replace(/;$/, '')
/** @param {number} version */
const objectsAt = version => KANATA_SCHEMA_MIGRATIONS.filter(m => m.version <= version).flatMap(m => m.statements).map(sql => {
  const match = /^CREATE (?:UNIQUE )?(TABLE|TRIGGER|INDEX) ([a-z_]+)\b/.exec(sql)
  if (!match) throw new KanataSchemaError('KANATA_SCHEMA_DEFINITION_INVALID')
  return {type: match[1].toLowerCase(), name: match[2], sql: canonical(sql)}
})

/** Fail closed before any DDL on a future, unrelated, partial or modified database.
 * No plugin, file path, key or production Store is accessible from this module.
 * @param {import('./kanataSchemaTypes').KanataSchemaConnection} connection
 * @param {import('./kanataSchemaTypes').KanataSchemaMigrationOptions} [options]
 * @returns {Promise<import('./kanataSchemaTypes').KanataSchemaResult>}
 */
export async function migrateKanataSchema(connection, {now = Date.now} = {}) {
  try {
    return await connection.transaction(async tx => {
      /** @param {string} sql @param {string} key */
      const scalar = async (sql, key) => {
        const rows = await tx.query(sql)
        need(rows.length === 1 && Number.isSafeInteger(rows[0][key]), 'KANATA_SCHEMA_METADATA_INVALID')
        return Number(rows[0][key])
      }
      const version = await scalar('PRAGMA user_version', 'user_version')
      need(version >= 0, 'KANATA_SCHEMA_METADATA_INVALID')
      need(version <= KANATA_SCHEMA_VERSION, 'KANATA_SCHEMA_FUTURE_VERSION')
      need(await scalar('PRAGMA foreign_keys', 'foreign_keys') === 1, 'KANATA_SCHEMA_FOREIGN_KEYS_REQUIRED')
      const applicationId = await scalar('PRAGMA application_id', 'application_id')
      /** @param {number} current */
      const verifyObjects = async current => {
        const expected = objectsAt(current)
        const actual = await tx.query("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name LIMIT 1025")
        need(actual.length === expected.length && actual.length <= 1024, 'KANATA_SCHEMA_STRUCTURE_MISMATCH')
        const byName = new Map(actual.map(row => [row.name, row]))
        for (const object of expected) {
          const found = byName.get(object.name)
          need(found?.type === object.type && typeof found.sql === 'string' && canonical(found.sql) === object.sql, 'KANATA_SCHEMA_STRUCTURE_MISMATCH')
        }
      }
      if (version === 0) {
        need(applicationId === 0, 'KANATA_SCHEMA_WRONG_DATABASE')
        await verifyObjects(0)
      } else {
        need(applicationId === KANATA_SCHEMA_APPLICATION_ID, 'KANATA_SCHEMA_WRONG_DATABASE')
        await verifyObjects(version)
        const journal = await tx.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version LIMIT 1025')
        need(journal.length === version, 'KANATA_SCHEMA_JOURNAL_MISMATCH')
        for (let i = 0; i < version; i++) {
          const migration = KANATA_SCHEMA_MIGRATIONS[i], record = journal[i]
          need(record.version === migration.version && record.name === migration.name && record.checksum === checksum(migration), 'KANATA_SCHEMA_JOURNAL_MISMATCH')
        }
      }
      if(version >= 3){
        const times=await tx.query('SELECT version,applied_at,time_source FROM schema_migration_applications ORDER BY version LIMIT 1025')
        need(times.length===version, 'KANATA_SCHEMA_TIME_JOURNAL_MISMATCH')
        for(let i=0;i<times.length;i++){
          const row=times[i]
          need(row.version===i+1 && (row.time_source==='legacy-unrecorded'
            ? row.applied_at===null && i<2
            : row.time_source==='js-wall-clock-utc-ms' && Number.isSafeInteger(row.applied_at) && Number(row.applied_at)>=0), 'KANATA_SCHEMA_TIME_JOURNAL_MISMATCH')
        }
      }
      // Fail atomically on malformed legacy history. Never delete/deduplicate or
      // synthesize missing revisions merely to make an old DB fit new constraints.
      if(version>0 && version<3)for(const sql of KANATA_AUDIT_VALIDATION_QUERIES){
        need((await tx.query(sql)).length===0,'KANATA_SCHEMA_AUDIT_CONFLICT')
      }
      if(version>0 && version<3)for(const sql of KANATA_REGISTRY_VALIDATION_QUERIES){
        need((await tx.query(sql)).length===0,'KANATA_SCHEMA_ENTITY_REGISTRY_CONFLICT')
      }
      const appliedVersions = []
      /** @type {Map<number,number>} */
      const observedTimes = new Map()
      for (const migration of KANATA_SCHEMA_MIGRATIONS) {
        if (migration.version <= version) continue
        for (const statement of migration.statements) await tx.execute(statement)
        const at=now()
        need(Number.isSafeInteger(at) && at>=0,'KANATA_SCHEMA_CLOCK_INVALID')
        observedTimes.set(migration.version,at)
        await tx.execute('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)', [migration.version, migration.name, checksum(migration)])
        await tx.execute(`PRAGMA user_version = ${migration.version}`)
        appliedVersions.push(migration.version)
      }
      if (version === 0) await tx.execute(`PRAGMA application_id = ${KANATA_SCHEMA_APPLICATION_ID}`)
      if(version<3){
        for(const migration of KANATA_SCHEMA_MIGRATIONS){
          await tx.execute('INSERT INTO schema_migration_applications(version,applied_at,time_source) VALUES(?,?,?)',[
            migration.version,observedTimes.get(migration.version)??null,observedTimes.has(migration.version)?'js-wall-clock-utc-ms':'legacy-unrecorded'
          ])
        }
      }else for(const applied of appliedVersions){
        await tx.execute('INSERT INTO schema_migration_applications(version,applied_at,time_source) VALUES(?,?,?)',[applied,observedTimes.get(applied)??null,'js-wall-clock-utc-ms'])
      }
      await verifyObjects(KANATA_SCHEMA_VERSION)
      need((await tx.query('SELECT * FROM pragma_foreign_key_check LIMIT 1')).length === 0, 'KANATA_SCHEMA_FOREIGN_KEY_VIOLATION')
      return Object.freeze({version: KANATA_SCHEMA_VERSION, appliedVersions: Object.freeze(appliedVersions)})
    })
  } catch (error) {
    // Never echo native SQL, bound values or driver error bodies to the UI/log.
    if (error instanceof KanataSchemaError) throw error
    throw new KanataSchemaError('KANATA_SCHEMA_MIGRATION_FAILED')
  }
}
