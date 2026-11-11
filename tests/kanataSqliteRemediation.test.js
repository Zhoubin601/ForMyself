import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {schemaHarness} from './helpers/kanataSqliteHarness.js'
import {installLegacySchema} from './helpers/kanataSqliteLegacy.js'
import {kanataFixtureCommands,kanataSqliteFixture,insertSql} from './helpers/kanataSqliteFixture.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
import {KANATA_SCHEMA_MIGRATIONS as migrations,KANATA_SCHEMA_VERSION as currentVersion} from '../src/features/chat/storage/sqlite/kanataSchema.js'
import {migrateKanataSchema} from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {sha256Text} from '../src/shared/crypto/sha256Text.js'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
const q=(h,sql,...p)=>h.db.prepare(sql).all(...p)
const run=(h,sql,...p)=>h.db.prepare(sql).run(...p)
const put=(h,table,row)=>{const s=insertSql(table,row);return run(h,s.sql,...s.parameters)}
async function fixture(t){const h=schemaHarness();t.after(h.close);await migrateKanataSchema(h.connection);await h.connection.transaction(async tx=>{for(const s of kanataFixtureCommands())await tx.execute(s.sql,s.parameters)});return h}
const code=c=>e=>e.code===c

test('R1-01 成功版本保存真实注入UTC毫秒，回拨不伪造单调时间，幂等不重写',async t=>{
 const h=schemaHarness();t.after(h.close);const epoch=Date.UTC(2026,10,7,1,2,3,456),times=[epoch,epoch-1000,epoch+500,epoch+2000,epoch+3000]
 let i=0;await migrateKanataSchema(h.connection,{now:()=>times[i++]})
 assert.deepEqual(q(h,'SELECT applied_at FROM schema_migration_applications ORDER BY version').map(r=>r.applied_at),times)
 assert.equal(i,currentVersion);h.writes.length=0
 await migrateKanataSchema(h.connection,{now:()=>{throw Error('no resampling on no-op')}})
 assert.deepEqual(h.writes,[])
 for(const tz of ['Pacific/Kiritimati','America/Los_Angeles']){
  const other=schemaHarness(),old=process.env.TZ;process.env.TZ=tz
  try{await migrateKanataSchema(other.connection,{now:()=>epoch});assert.ok(q(other,'SELECT applied_at FROM schema_migration_applications').every(r=>r.applied_at===epoch))}
  finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;other.close()}
 }
})
test('R1-02 001/002原checksum保持，有数据旧库未知旧时间不回填，新增版本使用本次真实时间',async t=>{
 const archived=JSON.parse(readFileSync(new URL('../docs/qa/kanata-sqlite-m1/evidence/schema-catalog.json',import.meta.url)))
 for(const m of migrations.slice(0,2))assert.equal(sha256Text(JSON.stringify([m.version,m.name,m.statements])),archived.migrations[m.version-1].checksum)
 for(const version of [1,2]){
  const h=schemaHarness();t.after(h.close);await installLegacySchema(h,version)
  const before=q(h,'SELECT * FROM message_audits'),now=1700000000000
  await migrateKanataSchema(h.connection,{now:()=>now})
  const records=q(h,'SELECT * FROM schema_migration_applications ORDER BY version')
  assert.equal(records.length,currentVersion)
  for(const row of records)assert.deepEqual([row.applied_at,row.time_source],row.version<=version?[null,'legacy-unrecorded']:[now,'js-wall-clock-utc-ms'])
  assert.deepEqual(q(h,'SELECT * FROM message_audits'),before)
 }
})
test('R1-03 时钟非法/抛错、提交失败不能留下成功时间，重启可重试',async t=>{
 for(const now of [()=>NaN,()=>-1,()=>0.1,()=>{throw Error('synthetic-sensitive-clock')}]){
  const h=schemaHarness();t.after(h.close)
  await assert.rejects(migrateKanataSchema(h.connection,{now}),e=>!String(e.stack).includes('sensitive-clock'))
  assert.equal(q(h,'SELECT count(*) n FROM sqlite_schema')[0].n,0)
 }
 const h=schemaHarness(':memory:',{beforeCommit:()=>{throw Error('commit failure')}});t.after(h.close)
 await assert.rejects(migrateKanataSchema(h.connection));assert.equal(q(h,'SELECT count(*) n FROM sqlite_schema')[0].n,0)
})
test('R1-04 已应用日志和时间不可普通改删/替换；缺失时间记录拒绝恢复写入',async t=>{
 const h=await fixture(t)
 for(const table of ['schema_migrations','schema_migration_applications']){
  for(const sql of [`UPDATE ${table} SET version=version`,`DELETE FROM ${table}`,`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`])assert.throws(()=>run(h,sql),/KANATA_SCHEMA_JOURNAL_IMMUTABLE/)
 }
 const partial=schemaHarness();t.after(partial.close)
 await partial.connection.transaction(async tx=>{
  for(const m of migrations.slice(0,3)){for(const sql of m.statements)await tx.execute(sql);await tx.execute('INSERT INTO schema_migrations VALUES(?,?,?)',[m.version,m.name,sha256Text(JSON.stringify([m.version,m.name,m.statements]))])}
  await tx.execute('PRAGMA user_version=3');await tx.execute('PRAGMA application_id=1263424577')
 })
 partial.writes.length=0;await assert.rejects(migrateKanataSchema(partial.connection),code('KANATA_SCHEMA_TIME_JOURNAL_MISMATCH'));assert.deepEqual(partial.writes,[])
})
test('R2 NOT-A-DEFECT：实例空地点可往返；NULL/缺失拒绝，日程和事件位置分别按领域处理',async t=>{
 const data=kanataSqliteFixture();for(const i of data.instances)i.state.location=''
 assert.doesNotThrow(()=>validateKanataData(data))
 for(const bad of [null,undefined]){const copy=structuredClone(data);if(bad===undefined)delete copy.instances[0].state.location;else copy.instances[0].state.location=bad;assert.throws(()=>validateKanataData(copy),/INVALID_TEXT/)}
 const h=await fixture(t)
 for(const value of ['', '普通合成地点',' ', '地'.repeat(2000)]){
  run(h,'UPDATE character_instances SET location=?',value)
  assert.equal(q(h,'SELECT location FROM character_instances LIMIT 1')[0].location,value)
 }
 assert.throws(()=>run(h,'UPDATE character_instances SET location=NULL'),/NOT NULL/)
 const row={...q(h,'SELECT * FROM character_instances LIMIT 1')[0],id:'missing-location'};delete row.location
 assert.throws(()=>put(h,'character_instances',row),/NOT NULL/)
 assert.throws(()=>run(h,"UPDATE virtual_schedules SET location=''"),/CHECK/)
 run(h,"UPDATE world_events SET action_location=''");run(h,'UPDATE world_events SET action_location=NULL')
 assert.throws(()=>run(h,'UPDATE world_events SET action_location=?','x'.repeat(201)),/CHECK/)
 run(h,"UPDATE character_instances SET location=''");await migrateKanataSchema(h.connection);await migrateKanataSchema(h.connection)
 assert.equal(q(h,'SELECT location FROM character_instances LIMIT 1')[0].location,'')
})
test('R3-01 连续和有缺口的真实快照可表达；同世界错误会话/发言角色/非文本内容拒绝',async t=>{
 const h=await fixture(t),d=kanataSqliteFixture(),audit=q(h,'SELECT * FROM message_audits')[0]
 run(h,"UPDATE messages SET content='修订三',revision=3 WHERE id='message-one'")
 const other=d.conversations.find(c=>c.worldId===d.worlds[0].id&&c.id!==d.conversations[0].id&&c.participantIds.includes(d.identities[0].id)).id
 for(const patch of [{conversationId:other},{role:'assistant'},{content:23},{deleted:null},{senderId:d.instances[0].id,senderType:'character',role:'assistant'}]){
  const row={...audit,id:'bad-snapshot',previous_revision:2,next_revision:3,
   previous_json:JSON.stringify({...JSON.parse(audit.next_json),...patch}),next_json:JSON.stringify({...JSON.parse(audit.next_json),revision:3,content:'修订三'})}
  assert.throws(()=>put(h,'message_audits',row),/KANATA_AUDIT_SNAPSHOT_INVALID/)
 }
 const original=audit.previous_json
 run(h,"UPDATE messages SET content='修订三',revision=3 WHERE id='message-one'")
 const prev=JSON.parse(audit.next_json),next={...prev,content:'修订三',revision:3}
 put(h,'message_audits',{...audit,id:'audit-three',previous_revision:2,next_revision:3,previous_json:JSON.stringify(prev),next_json:JSON.stringify(next)})
 assert.equal(q(h,'SELECT previous_json FROM message_audits WHERE id=?',audit.id)[0].previous_json,original)
 run(h,"UPDATE messages SET content='旧资料仅保留修订六',revision=6 WHERE id='message-one'")
 put(h,'message_audits',{...audit,id:'audit-six',previous_revision:5,next_revision:6,previous_json:JSON.stringify({...next,revision:5}),next_json:JSON.stringify({...next,revision:6})})
 assert.equal(q(h,'SELECT count(*) n FROM message_audits')[0].n,3)
})
test('R4-01 审计已提交后普通UPDATE/DELETE及OR REPLACE/IGNORE均不得篡改或重复',async t=>{
 const h=await fixture(t)
 for(const table of ['message_audits','event_audits']){
  const before=q(h,`SELECT * FROM ${table}`),row=before[0]
  assert.throws(()=>run(h,`UPDATE ${table} SET at=at+1`),/KANATA_AUDIT_IMMUTABLE/)
  assert.throws(()=>run(h,`DELETE FROM ${table}`),/KANATA_AUDIT_IMMUTABLE/)
  for(const mode of ['', 'OR REPLACE ', 'OR IGNORE ']){
   const s=insertSql(table,{...row,id:'duplicate-'+table})
   assert.throws(()=>run(h,s.sql.replace('INSERT INTO','INSERT '+mode+'INTO'),...s.parameters),/KANATA_AUDIT_REVISION_CONFLICT/)
  }
  assert.deepEqual(q(h,`SELECT * FROM ${table}`),before)
 }
})
test('R4-02 保留已有删除隐私语义：仅允许当前已删除记录的确定性不可逆正文脱敏',async t=>{
 const h=await fixture(t),before=q(h,'SELECT * FROM message_audits')[0]
 const redact="UPDATE message_audits SET previous_json=json_set(previous_json,'$.content','（已删除的原始记录）','$.deleted',json('true')),next_json=json_set(next_json,'$.content','（已删除的原始记录）','$.deleted',json('true'))"
 assert.throws(()=>run(h,redact),/KANATA_AUDIT_IMMUTABLE/)
 run(h,"UPDATE messages SET deleted=1,revision=3 WHERE id='message-one'")
 assert.throws(()=>run(h,redact),/KANATA_AUDIT_IMMUTABLE/)
 run(h,"UPDATE messages SET revision=4,content='（已删除的原始记录）' WHERE id='message-one'")
 run(h,redact)
 const after=q(h,'SELECT * FROM message_audits')[0]
 assert.equal(after.at,before.at);assert.equal(after.next_revision,before.next_revision)
 assert.equal(JSON.parse(after.previous_json).deleted,true)
 assert.equal(JSON.parse(after.next_json).content,'（已删除的原始记录）')
 assert.throws(()=>run(h,'UPDATE message_audits SET previous_json=?',before.previous_json),/KANATA_AUDIT_IMMUTABLE/)
 assert.throws(()=>run(h,redact+',at=at+1'),/KANATA_AUDIT_IMMUTABLE/)
})
test('R4-03 有真实前后快照时可乱序写入缺口，不能形成重叠分叉或跨世界事件审计',async t=>{
 const h=await fixture(t),a=q(h,'SELECT * FROM event_audits')[0],snapshot=JSON.parse(a.next_json)
 run(h,"UPDATE world_events SET revision=4 WHERE id='event-one'")
 const record=(id,prev,next)=>({...a,id,previous_revision:prev,next_revision:next,previous_json:JSON.stringify({...snapshot,revision:prev}),next_json:JSON.stringify({...snapshot,revision:next})})
 put(h,'event_audits',record('event-audit-four',3,4))
 assert.throws(()=>put(h,'event_audits',record('overlapping-history',1,3)),/KANATA_AUDIT_REVISION_CONFLICT/)
 put(h,'event_audits',record('event-audit-three',2,3))
 assert.deepEqual(q(h,'SELECT next_revision FROM event_audits ORDER BY next_revision').map(r=>r.next_revision),[2,3,4])
 const wrong=record('cross-world-event-audit',4,5),w2=kanataSqliteFixture().worlds[1].id
 wrong.world_id=w2;wrong.previous_json=JSON.stringify({...snapshot,worldId:w2,revision:4});wrong.next_json=JSON.stringify({...snapshot,worldId:w2,revision:5})
 assert.throws(()=>put(h,'event_audits',wrong),/FOREIGN KEY/)
})
test('R3/R4 v1无访问索引的长审计历史采用窗口验证，不能二次相关扫描或补造缺号',async t=>{
 const h=schemaHarness();t.after(h.close);await installLegacySchema(h,1)
 const a=q(h,'SELECT * FROM message_audits')[0],snapshot=JSON.parse(a.next_json)
 run(h,"UPDATE messages SET content='合成最新版本',revision=1002 WHERE id='message-one'")
 await h.connection.transaction(async()=>{for(let rev=2;rev<=1001;rev++)put(h,'message_audits',{...a,id:'history-'+rev,previous_revision:rev,next_revision:rev+1,previous_json:JSON.stringify({...snapshot,revision:rev}),next_json:JSON.stringify({...snapshot,revision:rev+1})})})
 await migrateKanataSchema(h.connection)
 assert.equal(q(h,'SELECT count(*) n FROM message_audits')[0].n,1001)
 assert.deepEqual(q(h,'PRAGMA foreign_key_check'),[])
})
test('R3/R4 旧库有冲突必须零修改拒绝，不自动合并/补造历史',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kanata-r-legacy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 for(const kind of ['duplicate','wrong-conversation']){
  const file=join(dir,kind+'.db'),h=schemaHarness(file);await installLegacySchema(h,2)
  const row={...q(h,'SELECT * FROM message_audits')[0],id:'bad-legacy'}
  if(kind==='wrong-conversation')row.previous_json=JSON.stringify({...JSON.parse(row.previous_json),conversationId:'missing'})
  // Existing v2 rejects a nonexistent conversation already; use a real different one.
  if(kind==='wrong-conversation'){
   const d=kanataSqliteFixture(),other=d.conversations.find(c=>c.worldId===d.worlds[0].id&&c.id!==d.conversations[0].id&&c.participantIds.includes(d.identities[0].id)).id
   row.previous_json=JSON.stringify({...JSON.parse(row.previous_json),conversationId:other})
  }
  put(h,'message_audits',row);h.close();const bytes=readFileSync(file)
  const next=schemaHarness(file);await assert.rejects(migrateKanataSchema(next.connection),code('KANATA_SCHEMA_AUDIT_CONFLICT'));next.close()
  assert.deepEqual(readFileSync(file),bytes)
 }
})
test('R4 业务值与审计同事务回滚；显式缺少审计的业务命令责任仍属于M2/M3',async t=>{
 const h=await fixture(t),old=q(h,"SELECT * FROM messages WHERE id='message-one'")[0],a=q(h,'SELECT * FROM message_audits')[0]
 await assert.rejects(h.connection.transaction(async()=>{
  run(h,"UPDATE messages SET content='回滚',revision=3 WHERE id='message-one'")
  put(h,'message_audits',{...a,id:'rollback-audit',previous_revision:2,next_revision:3,previous_json:a.next_json,next_json:JSON.stringify({...JSON.parse(a.next_json),revision:3,content:'回滚'})})
  throw Error('injected after both writes')
 }))
 assert.deepEqual(q(h,"SELECT * FROM messages WHERE id='message-one'")[0],old)
 assert.equal(q(h,"SELECT count(*) n FROM message_audits WHERE id='rollback-audit'")[0].n,0)
})
test('R6 NOT-A-DEFECT：NO ACTION保留引用，未引用叶子可删，延迟FK与回滚不留悬挂',async t=>{
 const h=await fixture(t)
 const tables=q(h,"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'")
 for(const table of tables)for(const fk of q(h,`PRAGMA foreign_key_list(${table.name})`))assert.equal(fk.on_delete,'NO ACTION')
 const saved=JSON.parse(readFileSync(new URL('../docs/qa/kanata-sqlite-m1-r/generated/foreign-keys.json',import.meta.url)))
 const actual=tables.flatMap(table=>{const groups=new Map();for(const fk of q(h,`PRAGMA foreign_key_list(${table.name})`)){if(!groups.has(fk.id))groups.set(fk.id,[]);groups.get(fk.id).push(fk)}
  return [...groups].map(([id,rows])=>{rows.sort((a,b)=>a.seq-b.seq);return{parent:rows[0].table,child:table.name,id,columns:rows.map(r=>r.from),targetColumns:rows.map(r=>r.to),onDelete:rows[0].on_delete,onUpdate:rows[0].on_update}})})
 assert.deepEqual(actual, [
   ...saved.map(({parent,child,id,columns,targetColumns,onDelete,onUpdate})=>({parent,child,id,columns,targetColumns,onDelete,onUpdate})),
   {parent:'messages',child:'archived_message_marks',id:0,columns:['world_id','conversation_id','message_id'],
     targetColumns:['world_id','conversation_id','id'],onDelete:'NO ACTION',onUpdate:'NO ACTION'},
   ...[['world_events','event_array_order'],['world_effects','effect_array_order'],['effect_baselines','baseline_array_order']].map(([parent,child])=>({
     parent,child,id:0,columns:['world_id','entity_id'],targetColumns:['world_id','id'],onDelete:'NO ACTION',onUpdate:'NO ACTION'
   }))
 ])

 for(const sql of ["DELETE FROM worlds WHERE id=(SELECT world_id FROM messages LIMIT 1)","DELETE FROM messages WHERE id='message-one'","DELETE FROM world_events WHERE id='event-one'","DELETE FROM conversations WHERE id=(SELECT conversation_id FROM messages LIMIT 1)"]){assert.throws(()=>run(h,sql),/FOREIGN KEY/)}
 run(h,"DELETE FROM messages WHERE id='message-two'")
 assert.equal(q(h,"SELECT count(*) n FROM messages WHERE id='message-two'")[0].n,0)
 assert.deepEqual(q(h,'PRAGMA foreign_key_check'),[]);assert.equal(q(h,'PRAGMA integrity_check')[0].integrity_check,'ok')
 await assert.rejects(h.connection.transaction(async()=>{run(h,'DELETE FROM virtual_schedule_days');run(h,'DELETE FROM virtual_schedules');throw Error('rollback owned details')}))
 assert.equal(q(h,'SELECT count(*) n FROM virtual_schedules')[0].n,1)
 await h.connection.transaction(async()=>{run(h,'DELETE FROM virtual_schedule_days');run(h,'DELETE FROM virtual_schedules')})
 assert.deepEqual(q(h,'PRAGMA foreign_key_check'),[])
})
test('R1/R4 真正SIGKILL覆盖003时间写入与业务/审计同事务，重启无伪成功历史',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kanata-r-kill-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 for(const mode of ['time','audit']){
  const file=join(dir,mode+'.db'),h=schemaHarness(file);h.db.exec('PRAGMA journal_mode=WAL')
  if(mode==='time')await installLegacySchema(h,2)
  else {await migrateKanataSchema(h.connection);await h.connection.transaction(async tx=>{for(const s of kanataFixtureCommands())await tx.execute(s.sql,s.parameters)})}
  h.close()
  const script=`import {schemaHarness} from './tests/helpers/kanataSqliteHarness.js';import {migrateKanataSchema} from './src/features/chat/storage/sqlite/kanataSchemaMigrator.js';
  const ready=()=>{process.stdout.write('READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)};
  const h=schemaHarness(process.argv[1],{beforeExecute(sql,p){if(process.argv[2]==='time'&&sql.startsWith('INSERT INTO schema_migration_applications')&&p[0]===3)ready()}});
  if(process.argv[2]==='time')await migrateKanataSchema(h.connection);else await h.connection.transaction(async()=>{
   h.db.exec("UPDATE messages SET content='uncommitted',revision=3 WHERE id='message-one'");
   const a=h.db.prepare('SELECT * FROM message_audits').get();
   h.db.prepare('INSERT INTO message_audits(id,world_id,message_id,at,previous_revision,next_revision,previous_json,next_json) VALUES(?,?,?,?,?,?,?,?)').run('kill-audit',a.world_id,a.message_id,1001,2,3,a.next_json,JSON.stringify({...JSON.parse(a.next_json),revision:3,content:'uncommitted'}));ready()});`
  const child=spawn(process.execPath,['--input-type=module','-e',script,file,mode],{stdio:['ignore','pipe','pipe']})
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')})
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('timeout'))},15000);child.stdout.once('data',d=>{clearTimeout(timer);assert.match(String(d),/READY/);resolve()});child.once('exit',()=>{clearTimeout(timer);reject(Error('early child exit'))})})
  const done=once(child,'exit');child.kill('SIGKILL');assert.equal((await done)[1],'SIGKILL')
  const reopened=schemaHarness(file)
  assert.equal(q(reopened,'PRAGMA user_version')[0].user_version,mode==='time'?2:currentVersion)
  assert.equal(q(reopened,"SELECT revision FROM messages WHERE id='message-one'")[0].revision,2)
  if(mode==='time')assert.equal(q(reopened,"SELECT count(*) n FROM sqlite_schema WHERE name='schema_migration_applications'")[0].n,0)
  else assert.equal(q(reopened,"SELECT count(*) n FROM message_audits WHERE id='kill-audit'")[0].n,0)
  await migrateKanataSchema(reopened.connection)
  assert.deepEqual(q(reopened,'PRAGMA foreign_key_check'),[]);assert.equal(q(reopened,'PRAGMA integrity_check')[0].integrity_check,'ok');reopened.close()
 }
})

test('R3/R4 全局ID登记不可直接改删/伪造/替换；实体正常登记注销继续有效',async t=>{
 const h=await fixture(t)
 for(const sql of ["DELETE FROM entity_ids WHERE id='message-audit-one'","UPDATE entity_ids SET table_name='memories' WHERE id='message-audit-one'","INSERT OR REPLACE INTO entity_ids VALUES('message-audit-one','memories')","INSERT OR IGNORE INTO entity_ids VALUES('message-audit-one','message_audits')","INSERT INTO entity_ids VALUES('orphan','memories')"])
  assert.throws(()=>run(h,sql),/KANATA_ENTITY_REGISTRY_OWNED/)
 const row={...q(h,'SELECT * FROM memories')[0],id:'message-audit-one'}
 assert.throws(()=>put(h,'memories',row),/KANATA_DUPLICATE_ENTITY_ID/)
 run(h,"DELETE FROM messages WHERE id='message-two'")
 assert.equal(q(h,"SELECT * FROM entity_ids WHERE id='message-two'").length,0)
 const message={...q(h,"SELECT * FROM messages WHERE id='message-one'")[0],id:'registry-leaf'}
 put(h,'messages',message);assert.equal(q(h,"SELECT table_name FROM entity_ids WHERE id='registry-leaf'")[0].table_name,'messages')
 run(h,"DELETE FROM messages WHERE id='registry-leaf'");assert.equal(q(h,"SELECT * FROM entity_ids WHERE id='registry-leaf'").length,0)
 assert.deepEqual(q(h,'PRAGMA foreign_key_check'),[])
})
test('R3/R4 已损坏的旧全局ID登记零修改拒绝，不能自动修复冒充原始归属',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kanata-r-registry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 for(const sql of ["DELETE FROM entity_ids WHERE id='message-audit-one'","INSERT INTO entity_ids VALUES('orphan','memories')"]){
  const file=join(dir,'legacy.db'),h=schemaHarness(file);await installLegacySchema(h,2);run(h,sql);h.close()
  const before=readFileSync(file),next=schemaHarness(file)
  await assert.rejects(migrateKanataSchema(next.connection),code('KANATA_SCHEMA_ENTITY_REGISTRY_CONFLICT'));next.close()
  assert.deepEqual(readFileSync(file),before);rmSync(file)
 }
})

test('R1/R4 既有v2追加003每个写入点及提交失败保留原文件，新连接可安全重试',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kanata-r-v2-fault-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const base=join(dir,'base.db'),h=schemaHarness(base);await installLegacySchema(h,2);h.close();const bytes=readFileSync(base)
 const writes=migrations[2].statements.length+2+migrations.length
 for(const fault of [...Array.from({length:writes},(_,i)=>i+1),'commit']){
  const file=join(dir,'failure-'+fault+'.db');writeFileSync(file,bytes)
  let n=0;const broken=schemaHarness(file,{beforeExecute:()=>{if(++n===fault)throw Error('injected')},beforeCommit:()=>{if(fault==='commit')throw Error('injected')}})
  await assert.rejects(migrateKanataSchema(broken.connection),code('KANATA_SCHEMA_MIGRATION_FAILED'));broken.close()
  assert.deepEqual(readFileSync(file),bytes)
  const next=schemaHarness(file);assert.equal((await migrateKanataSchema(next.connection)).version,currentVersion)
  assert.equal(q(next,'SELECT count(*) n FROM message_audits')[0].n,1);assert.equal(q(next,'SELECT count(*) n FROM schema_migration_applications')[0].n,currentVersion)
  assert.deepEqual(q(next,'PRAGMA foreign_key_check'),[]);assert.equal(q(next,'PRAGMA integrity_check')[0].integrity_check,'ok');next.close()
 }
})
