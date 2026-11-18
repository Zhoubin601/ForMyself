import { DatabaseSync } from 'node:sqlite'
import { createKanataDataMigrator } from '../../../src/features/chat/storage/sqlite/kanataDataMigrator.js'
import { migrateKanataSchema } from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSqliteFixture } from '../../../tests/helpers/kanataSqliteFixture.js'
import { encryptedFixture, inspectSql, nativeQuery } from './fixture.mjs'

/** Record the statements that the real importer issues for the QA dataset. The
 * catalog still accepts only fixed SQL hashes and never a runtime-supplied statement. */
export async function m5Catalog() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  const statements = { queries: new Set(Object.values(inspectSql)), writes: new Set() }
  let record = false, injected = false
  const rollbackProbe = new Error('M5_CATALOG_ROLLBACK_PROBE')
  const operation = {
    async transaction(action) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await action({
          async query(sql, params = []) {
            if (record) statements.queries.add(nativeQuery(sql))
            return db.prepare(sql).all(...params)
          },
          async execute(sql, params = []) {
            if (record) statements.writes.add(sql)
            if (record && !injected && sql.startsWith('INSERT INTO messages(')) {
              injected = true
              throw rollbackProbe
            }
            return { affectedRows: db.prepare(sql).run(...params).changes }
          },
        })
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  const password = 'm5-catalog-synthetic'
  const { legacy } = await encryptedFixture(kanataSqliteFixture(), 55, password)
  const assertReadOnly = legacy.seal()
  try {
    await migrateKanataSchema(operation)
    const migrator = createKanataDataMigrator({ operation, source: legacy.source, syntheticOnly: true })
    record = true
    await migrator.migrate(password).then(() => { throw Error('M5_CATALOG_PROBE_NOT_REACHED') }, error => {
      if (error !== rollbackProbe) throw error
    })
    const result = await migrator.migrate(password)
    assertReadOnly()
    return { ...statements, oracle: JSON.parse(db.prepare(inspectSql.manifest).get().extensions_json), counts: result.counts }
  } finally {
    await legacy.release()
    db.close()
  }
}
