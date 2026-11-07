import {schemaHarness} from '../../../tests/helpers/kanataSqliteHarness.js'
import {kanataSqliteFixture,kanataFixtureCommands,insertSql} from '../../../tests/helpers/kanataSqliteFixture.js'
import {migrateKanataSchema} from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {KANATA_SCHEMA_MIGRATIONS as migrations} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {createHash} from 'node:crypto'
const findings={}
async function probe(name,action){
 const h=schemaHarness(),data=kanataSqliteFixture()
 try{
  await migrateKanataSchema(h.connection)
  await h.connection.transaction(async tx=>{for(const s of kanataFixtureCommands(data))await tx.execute(s.sql,s.parameters)})
  findings[name]=await action(h,data)
 }finally{h.close()}
}
const mutate=(h,sql,parameters=[])=>{try{h.db.prepare(sql).run(...parameters);return 'ALLOWED'}catch{return 'REJECTED'}}
await probe('R1',(h)=>({journalColumns:h.db.prepare('PRAGMA table_info(schema_migrations)').all().map(r=>r.name),applicationTimesTable:!!h.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migration_applications'").get()}))
await probe('R2',(h)=>({empty:mutate(h,"UPDATE character_instances SET location=''"),null:mutate(h,'UPDATE character_instances SET location=NULL'),scheduleEmpty:mutate(h,"UPDATE virtual_schedules SET location=''"),actionEmpty:mutate(h,"UPDATE world_events SET action_location=''"),actionNull:mutate(h,'UPDATE world_events SET action_location=NULL')}))
await probe('R3',(h,d)=>{
 h.db.prepare("UPDATE messages SET revision=3 WHERE id='message-one'").run()
 const row={...h.db.prepare('SELECT * FROM message_audits').get(),id:'wrong-conversation',previous_revision:2,next_revision:3}
 const other=d.conversations.find(c=>c.worldId===d.worlds[0].id&&c.id!==d.conversations[0].id&&c.participantIds.includes(d.identities[0].id)).id
 for(const key of ['previous_json','next_json'])row[key]=JSON.stringify({...JSON.parse(row[key]),conversationId:other,revision:key==='previous_json'?2:3})
 const s=insertSql('message_audits',row)
 return {wrongSameWorldConversation:mutate(h,s.sql,s.parameters)}
})
await probe('R4',(h)=>{
 const row={...h.db.prepare('SELECT * FROM message_audits').get(),id:'duplicate-audit'};const s=insertSql('message_audits',row)
 return{duplicateRevision:mutate(h,s.sql,s.parameters),changeAt:mutate(h,'UPDATE message_audits SET at=at+1'),deleteEventAudit:mutate(h,'DELETE FROM event_audits')}
})
await probe('registry',(h)=>{
 const deleteOwned=mutate(h,"DELETE FROM entity_ids WHERE id='message-audit-one'")
 const clone={...h.db.prepare('SELECT * FROM memories').get(),id:'message-audit-one'},s=insertSql('memories',clone)
 return {deleteOwned,insertAnotherTypeWithAuditId:mutate(h,s.sql,s.parameters),duplicateIdAcrossMemoryAndAudit:h.db.prepare("SELECT (SELECT count(*) FROM memories WHERE id='message-audit-one')+(SELECT count(*) FROM message_audits WHERE id='message-audit-one') n").get().n,insertPhantom:mutate(h,"INSERT INTO entity_ids VALUES('phantom','memories')")}
})
await probe('R6',(h)=>({actions:[...new Set(h.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().flatMap(r=>h.db.prepare(`PRAGMA foreign_key_list(${r.name})`).all().map(f=>f.on_delete)))],referencedMessage:mutate(h,"DELETE FROM messages WHERE id='message-one'"),unreferencedMessage:mutate(h,"DELETE FROM messages WHERE id='message-two'"),foreignKeys:h.db.prepare('PRAGMA foreign_keys').get().foreign_keys,violations:h.db.prepare('PRAGMA foreign_key_check').all()}))
console.log(JSON.stringify({node:process.version,schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),version:migrations.at(-1).version,findings},null,2))
