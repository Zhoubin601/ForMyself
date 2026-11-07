import test from 'node:test'
import assert from 'node:assert/strict'
import {buildFieldMapping} from '../docs/qa/kanata-sqlite-m1-r/field-mapping.mjs'
import {schemaHarness} from './helpers/kanataSqliteHarness.js'
import {migrateKanataSchema} from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {kanataFixtureCommands} from './helpers/kanataSqliteFixture.js'
import {readFileSync} from 'node:fs'
test('R5 字段规格由实际类型生成，所有声明目标列存在，生成文档无遗漏/过期',async t=>{
 const h=schemaHarness();t.after(h.close);await migrateKanataSchema(h.connection)
 const mapping=buildFieldMapping(),saved=JSON.parse(readFileSync(new URL('../docs/qa/kanata-sqlite-m1-r/generated/field-mapping.json',import.meta.url)))
 assert.deepEqual(saved,mapping)
 assert.equal(new Set(mapping.map(r=>r.field)).size,mapping.length)
 for(const row of mapping)for(const target of row.targets){
  const [table,column]=target.split('.'),cols=h.db.prepare(`PRAGMA table_info(${table})`).all()
  assert.ok(cols.some(c=>c.name===column),row.field+' -> '+target)
 }
 for(const name of ['Message.revision','CharacterInstance.state.location','WorldEvent.action.location','BackgroundTask.deferredReply.sourceRevision','CompletionAttempt.usage','KanataData.messageArchives'])assert.ok(mapping.some(r=>r.field===name),name)
 const doc=readFileSync(new URL('../docs/20261107-kanata-sqlite-m1-r-field-mapping-v1.md',import.meta.url),'utf8')
 for(const row of mapping)assert.ok(doc.includes('| '+row.field+' |'),row.field)
})
test('R5 JSON能区别未知null/false、字段缺省与空数组，保真提示不能代替关系约束',async t=>{
 const h=schemaHarness();t.after(h.close);await migrateKanataSchema(h.connection)
 await h.connection.transaction(async tx=>{for(const s of kanataFixtureCommands())await tx.execute(s.sql,s.parameters)})
 for(const value of [{unknown:null},{unknown:false},{knownBy:[]},{}]){
  h.db.prepare('UPDATE memories SET extensions_json=?').run(JSON.stringify(value))
  assert.deepEqual(JSON.parse(h.db.prepare('SELECT extensions_json FROM memories').get().extensions_json),value)
 }
 assert.throws(()=>h.db.prepare("INSERT INTO memory_known_by VALUES(?,?,?)").run(h.db.prepare('SELECT world_id FROM memories').get().world_id,'memory-one','missing'),/FOREIGN KEY/)
})
