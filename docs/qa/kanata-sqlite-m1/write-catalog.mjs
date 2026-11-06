import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {schemaHarness} from '../../../tests/helpers/kanataSqliteHarness.js'
import {KANATA_SCHEMA_MIGRATIONS as migrations} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {migrateKanataSchema} from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
const h=schemaHarness()
try {
  await fs.mkdir('work/m0',{recursive:true})
  await migrateKanataSchema(h.connection)
  const schema=h.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all()
  const tables=schema.filter(r=>r.type==='table').map(r=>({name:r.name,ddl:r.sql,
    columns:h.db.prepare(`PRAGMA table_info(${r.name})`).all(),foreignKeys:h.db.prepare(`PRAGMA foreign_key_list(${r.name})`).all(),
    indexes:h.db.prepare(`PRAGMA index_list(${r.name})`).all().map(i=>({...i,columns:h.db.prepare(`PRAGMA index_xinfo(${i.name})`).all()}))}))
  const dir=await fs.mkdtemp(path.resolve('work/m0/m1-catalog-'))
  const result={schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),node:process.version,
    sqliteVersion:h.db.prepare('SELECT sqlite_version() version').get().version,applicationId:h.db.prepare('PRAGMA application_id').get().application_id,
    version:h.db.prepare('PRAGMA user_version').get().user_version,
    counts:{tables:tables.length,triggers:schema.filter(r=>r.type==='trigger').length,explicitIndexes:schema.filter(r=>r.type==='index').length},
    migrations:h.db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),tables,
    triggers:schema.filter(r=>r.type==='trigger'),indexes:schema.filter(r=>r.type==='index')}
  await fs.writeFile(path.join(dir,'schema-catalog.json'),JSON.stringify(result,null,2)+'\n')
  await fs.writeFile(path.join(dir,'schema.sql'),migrations.flatMap(m=>[`-- migration ${m.version}: ${m.name}`,...m.statements.map(s=>s+';')]).join('\n\n')+'\n')
  console.log(JSON.stringify({dir,counts:result.counts,schemaSha256:result.schemaSha256,sqliteVersion:result.sqliteVersion}))
} finally {h.close()}
