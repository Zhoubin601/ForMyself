import {KANATA_SCHEMA_MIGRATIONS,KANATA_SCHEMA_APPLICATION_ID} from '../../src/features/chat/storage/sqlite/kanataSchema.js'
import {sha256Text} from '../../src/shared/crypto/sha256Text.js'
import {kanataFixtureCommands} from './kanataSqliteFixture.js'
/** Test-only creation of released 001–003 DBs. */
export async function installLegacySchema(h,version=2,commands=kanataFixtureCommands()) {
  if(![1,2,3].includes(version))throw Error('LEGACY_TEST_VERSION_REQUIRED')
  await h.connection.transaction(async tx=>{
    for(const m of KANATA_SCHEMA_MIGRATIONS.slice(0,version)){
      for(const sql of m.statements)await tx.execute(sql)
      await tx.execute('INSERT INTO schema_migrations VALUES(?,?,?)',[m.version,m.name,sha256Text(JSON.stringify([m.version,m.name,m.statements]))])
      await tx.execute(`PRAGMA user_version=${m.version}`)
    }
    if (version === 3) {
      await tx.execute("INSERT INTO schema_migration_applications(version,applied_at,time_source) VALUES(1,NULL,'legacy-unrecorded'),(2,NULL,'legacy-unrecorded'),(3,1000,'js-wall-clock-utc-ms')")
    }
    await tx.execute(`PRAGMA application_id=${KANATA_SCHEMA_APPLICATION_ID}`)
    for(const c of commands)await tx.execute(c.sql,c.parameters)
  })
}
