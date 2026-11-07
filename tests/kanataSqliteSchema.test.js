import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync,rmSync,readFileSync,copyFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {sha256Text} from '../src/shared/crypto/sha256Text.js'
import {KANATA_SCHEMA_MIGRATIONS as migrations,KANATA_SCHEMA_APPLICATION_ID as appId,KANATA_SCHEMA_VERSION as version} from '../src/features/chat/storage/sqlite/kanataSchema.js'
import {migrateKanataSchema} from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {schemaHarness} from './helpers/kanataSqliteHarness.js'
import {kanataSqliteFixture,kanataFixtureCommands,insertSql} from './helpers/kanataSqliteFixture.js'
import {installLegacySchema} from './helpers/kanataSqliteLegacy.js'

const code=expected=>error=>error.code===expected
const rows=(h,sql,...parameters)=>h.db.prepare(sql).all(...parameters)
const run=(h,sql,...parameters)=>h.db.prepare(sql).run(...parameters)
const insert=(h,table,row)=>{const s=insertSql(table,row);return run(h,s.sql,...s.parameters)}
const snapshot=h=>JSON.stringify([rows(h,'PRAGMA user_version'),rows(h,'PRAGMA application_id'),rows(h,'SELECT * FROM sqlite_schema ORDER BY name'),
  ...rows(h,"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").map(r=>rows(h,`SELECT * FROM ${r.name} ORDER BY rowid`))])
async function openFixture(t) {
  const h=schemaHarness();t.after(h.close)
  await migrateKanataSchema(h.connection)
  const data=kanataSqliteFixture()
  await h.connection.transaction(async tx=>{for(const s of kanataFixtureCommands(data))await tx.execute(s.sql,s.parameters)})
  return {...h,data,w:data.worlds[0].id,w2:data.worlds[1].id,c:data.conversations[0].id,i:data.instances[0].id,i2:data.instances.find(r=>r.worldId===data.worlds[1].id).id}
}

test('M1-01 空库逐版升级、迁移日志与重复打开；全部真实领域集合可插入',async t=>{
  const h=await openFixture(t)
  assert.deepEqual(rows(h,'SELECT version FROM schema_migrations').map(r=>r.version),migrations.map(m=>m.version))
  assert.deepEqual(await migrateKanataSchema(h.connection),{version,appliedVersions:[]})
  assert.deepEqual(rows(h,'PRAGMA foreign_key_check'),[])
  assert.equal(rows(h,'PRAGMA integrity_check')[0].integrity_check,'ok')
  assert.equal(rows(h,'SELECT count(*) n FROM worlds')[0].n,2)
  assert.equal(rows(h,'SELECT count(*) n FROM messages')[0].n,2)
  const d=rows(h,'SELECT raw_data_json FROM card_versions LIMIT 1')[0]
  assert.deepEqual(JSON.parse(d.raw_data_json),h.data.cardVersions[0].rawData)
  assert.equal(rows(h,"SELECT instance_id FROM role_bindings WHERE scope='mood'")[0].instance_id,'retired-instance')
  assert.equal(rows(h,'SELECT can_share FROM life_grants')[0].can_share,0)
  assert.equal(rows(h,"SELECT deleted FROM messages WHERE id='message-one'")[0].deleted,null)
  assert.equal(rows(h,'SELECT archived FROM worlds LIMIT 1')[0].archived,null)
})

test('M1-02 有数据v1逐版升级保留原记录；日志指纹固定且重复升级零DDL',async t=>{
  const h=schemaHarness();t.after(h.close)
  const m=migrations[0]
  await h.connection.transaction(async tx=>{
    for(const sql of m.statements)await tx.execute(sql)
    await tx.execute('INSERT INTO schema_migrations VALUES(?,?,?)',[m.version,m.name,sha256Text(JSON.stringify([m.version,m.name,m.statements]))])
    await tx.execute('PRAGMA user_version=1');await tx.execute(`PRAGMA application_id=${appId}`)
    for(const s of kanataFixtureCommands())await tx.execute(s.sql,s.parameters)
  })
  const before=rows(h,'SELECT * FROM messages')
  assert.deepEqual(await migrateKanataSchema(h.connection),{version,appliedVersions:[2,3]})
  assert.deepEqual(rows(h,'SELECT * FROM messages'),before)
  h.writes.length=0
  await migrateKanataSchema(h.connection)
  assert.deepEqual(h.writes,[])
})

test('M1-03 未来版本、不相关库、未完成结构、篡改日志和缺索引均拒绝；数据零改动',async t=>{
  for(const [setup,expected] of [
    [h=>h.db.exec('PRAGMA user_version=999'),'KANATA_SCHEMA_FUTURE_VERSION'],
    [h=>h.db.exec('PRAGMA application_id=5'),'KANATA_SCHEMA_WRONG_DATABASE'],
    [h=>h.db.exec('CREATE TABLE other(value TEXT)'),'KANATA_SCHEMA_STRUCTURE_MISMATCH'],
    [h=>h.db.exec('CREATE TABLE android_metadata(locale TEXT)'),'KANATA_SCHEMA_STRUCTURE_MISMATCH'],
    [async h=>{await installLegacySchema(h,2);h.db.exec("UPDATE schema_migrations SET checksum='"+'0'.repeat(64)+"'")},'KANATA_SCHEMA_JOURNAL_MISMATCH'],
    [async h=>{await migrateKanataSchema(h.connection);h.db.exec('DROP INDEX messages_scope_time')},'KANATA_SCHEMA_STRUCTURE_MISMATCH']
  ]){
    const h=schemaHarness();t.after(h.close)
    await setup(h);const before=snapshot(h);h.writes.length=0
    await assert.rejects(migrateKanataSchema(h.connection),code(expected))
    assert.equal(snapshot(h),before);assert.equal(h.writes.length,0)
  }
})

test('M1-04 未开启外键拒绝；原生执行错误不向外泄漏SQL和参数',async t=>{
  const h=schemaHarness();t.after(h.close);h.db.exec('PRAGMA foreign_keys=OFF')
  await assert.rejects(migrateKanataSchema(h.connection),code('KANATA_SCHEMA_FOREIGN_KEYS_REQUIRED'))
  assert.equal(h.writes.length,0)
  const bad=schemaHarness(':memory:',{beforeExecute:()=>{throw Error('synthetic-sensitive-driver-body')}});t.after(bad.close)
  await assert.rejects(migrateKanataSchema(bad.connection),e=>e.code==='KANATA_SCHEMA_MIGRATION_FAILED'&&!String(e.stack).includes('sensitive-driver-body')&&!e.cause)
})

test('M1-05 任意DDL/日志写入失败整事务回滚，新连接安全重试',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kanata-m1-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const statements=migrations.reduce((n,m)=>n+m.statements.length+2,0)+1+migrations.length
  for(let failAt=1;failAt<=statements;failAt++){
    let n=0;const path=join(dir,`failure-${failAt}.db`)
    const h=schemaHarness(path,{beforeExecute:()=>{if(++n===failAt)throw Error('injected')}})
    await assert.rejects(migrateKanataSchema(h.connection),code('KANATA_SCHEMA_MIGRATION_FAILED'))
    assert.equal(rows(h,'PRAGMA user_version')[0].user_version,0)
    assert.equal(rows(h,'SELECT count(*) n FROM sqlite_schema')[0].n,0);h.close()
    const next=schemaHarness(path)
    assert.equal((await migrateKanataSchema(next.connection)).version,version);next.close()
  }
})

test('M1-06 COMMIT失败必须回滚，不能提前报告升级成功',async t=>{
  const h=schemaHarness(':memory:',{beforeCommit:db=>db.exec("INSERT INTO worlds(id,name,rules,revision,time_zone,created_at,last_simulated_at,autonomy_enabled,proactive_enabled,notifications_enabled,default_chat_mode,identity_id) VALUES('orphan','synthetic','',1,'UTC',0,0,0,0,0,'daily','missing')")})
  t.after(h.close)
  await assert.rejects(migrateKanataSchema(h.connection),code('KANATA_SCHEMA_MIGRATION_FAILED'))
  assert.equal(rows(h,'PRAGMA user_version')[0].user_version,0)
  assert.equal(rows(h,'SELECT count(*) n FROM sqlite_schema')[0].n,0)
})

test('M1-15 已有v1记录升级失败保留逐字节文件，新运行时重试不会丢数据',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kanata-m1-v1-failure-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const base=join(dir,'base.db'),initial=schemaHarness(base),m=migrations[0]
  await initial.connection.transaction(async tx=>{
    for(const sql of m.statements)await tx.execute(sql)
    await tx.execute('INSERT INTO schema_migrations VALUES(?,?,?)',[1,m.name,sha256Text(JSON.stringify([1,m.name,m.statements]))])
    await tx.execute('PRAGMA user_version=1');await tx.execute(`PRAGMA application_id=${appId}`)
    for(const s of kanataFixtureCommands())await tx.execute(s.sql,s.parameters)
  });initial.close()
  const size=migrations[1].statements.length
  for(const failAt of [1,Math.floor(size/2),size,size+1,size+2,'commit']){
    const path=join(dir,'failure-'+failAt+'.db');copyFileSync(base,path)
    let count=0
    const h=schemaHarness(path,{beforeExecute:()=>{if(++count===failAt)throw Error('injected')},beforeCommit:()=>{if(failAt==='commit')throw Error('injected')}})
    await assert.rejects(migrateKanataSchema(h.connection),code('KANATA_SCHEMA_MIGRATION_FAILED'));h.close()
    assert.deepEqual(readFileSync(path),readFileSync(base))
    const reopened=schemaHarness(path)
    assert.equal(rows(reopened,'PRAGMA user_version')[0].user_version,1)
    assert.deepEqual((await migrateKanataSchema(reopened.connection)).appliedVersions,[2,3])
    assert.equal(rows(reopened,'SELECT count(*) n FROM messages')[0].n,2);reopened.close()
  }
})

test('M1-07 跨世界群成员、消息、关系、来源及effects均由复合外键拒绝',async t=>{
  const h=await openFixture(t)
  const message=rows(h,"SELECT * FROM messages WHERE id='message-one'")[0]
  const c2=h.data.conversations.find(c=>c.worldId===h.w2).id
  insert(h,'messages',{...message,id:'world-two-message',world_id:h.w2,conversation_id:c2,sender_id:h.data.identities[1].id})
  const cases=[
    ['conversation_participants',{world_id:h.w,conversation_id:h.c,participant_id:h.i2,kind:'character',ordinal:9}],
    ['memory_sources',{world_id:h.w2,memory_id:'memory-one',message_id:'message-one',message_revision:1}],
    ['event_sources',{world_id:h.w2,event_id:'event-one',message_id:'message-one',message_revision:1}],
    ['memory_sources',{world_id:h.w,memory_id:'memory-one',message_id:'world-two-message',message_revision:1}],
    ['event_sources',{world_id:h.w,event_id:'event-one',message_id:'world-two-message',message_revision:1}],
    ['task_sources',{world_id:h.w,task_id:'task-one',message_id:'world-two-message',message_revision:1}],
    ['task_sources',{world_id:h.w2,task_id:'task-one',message_id:'message-one',message_revision:1}],
    ['event_participants',{world_id:h.w,event_id:'event-one',participant_id:h.i2}],
    ['memory_known_by',{world_id:h.w,memory_id:'memory-one',instance_id:h.i2}],
    ['task_result_memories',{world_id:h.w2,task_id:'task-one',memory_id:'memory-one'}],
    ['relationships',{...rows(h,'SELECT * FROM relationships LIMIT 1')[0],id:'cross-relation',to_id:h.i2}],
    ['messages',{...rows(h,'SELECT * FROM messages LIMIT 1')[0],id:'cross-message',world_id:h.w2}],
    ['messages',{...message,id:'spoofed-sender',role:'assistant',sender_type:'character'}],
    ['world_effects',{...rows(h,'SELECT * FROM world_effects')[0],id:'cross-effect',target_id:h.i2,target_instance_id:h.i2}]
  ]
  for(const [table,row] of cases){const before=snapshot(h);assert.throws(()=>insert(h,table,row),/FOREIGN KEY constraint failed/);assert.equal(snapshot(h),before)}
})

test('M1-08 重复全局ID、重复任务/授权/卡revision、孤儿发言及错role拒绝',async t=>{
  const h=await openFixture(t)
  for(const [table,query,patch] of [
    ['messages','SELECT * FROM messages LIMIT 1',{id:h.i}],
    ['background_tasks','SELECT * FROM background_tasks',{id:'duplicate-task'}],
    ['life_grants','SELECT * FROM life_grants',{id:'duplicate-grant'}],
    ['card_versions','SELECT * FROM card_versions LIMIT 1',{id:'duplicate-version'}],
    ['messages','SELECT * FROM messages LIMIT 1',{id:'orphan-sender',sender_id:'missing'}],
    ['messages','SELECT * FROM messages LIMIT 1',{id:'wrong-role',role:'assistant'}],
    ['messages','SELECT * FROM messages LIMIT 1',{id:'bad-status',status:'streaming'}],
    ['messages','SELECT * FROM messages LIMIT 1',{id:'null-content',content:null}],
    ['life_grants','SELECT * FROM life_grants',{id:'bad-boolean',module_id:'mood',can_share:2}]
  ]){const before=snapshot(h);assert.throws(()=>insert(h,table,{...rows(h,query)[0],...patch}));assert.equal(snapshot(h),before)}
  assert.throws(()=>run(h,"UPDATE messages SET world_id=? WHERE id='message-one'",h.w2),/KANATA_IMMUTABLE_SCOPE/)
})

test('M1-09 旧revision来源保持、未来来源/回复/审计/授权revision及倒退均拒绝',async t=>{
  const h=await openFixture(t)
  assert.equal(rows(h,'SELECT message_revision FROM memory_sources')[0].message_revision,1)
  for(const sql of [
    'UPDATE memory_sources SET message_revision=3', 'UPDATE event_sources SET message_revision=3', 'UPDATE task_sources SET message_revision=3',
    'UPDATE message_life_sources SET grant_revision=3', 'UPDATE memory_life_sources SET grant_revision=3', 'UPDATE event_life_sources SET grant_revision=3',
    "UPDATE messages SET reply_to_revision=3 WHERE id='message-two'", "UPDATE messages SET revision=1 WHERE id='message-one'",
    'UPDATE world_events SET revision=1', 'UPDATE life_grants SET revision=1',
    'UPDATE message_audits SET next_revision=3', 'UPDATE event_audits SET previous_revision=2',
    "UPDATE message_audits SET next_json='{}'"
  ]){const before=snapshot(h);assert.throws(()=>run(h,sql));assert.equal(snapshot(h),before)}
  run(h,"UPDATE messages SET revision=3,content='合成修订' WHERE id='message-one'")
  assert.equal(rows(h,'SELECT message_revision FROM memory_sources')[0].message_revision,1)
})

test('M1-13 冲突策略不能绕过全局ID；无revision编辑、延迟任务来源和审计发言者拒绝',async t=>{
  const h=await openFixture(t),message=rows(h,"SELECT * FROM messages WHERE id='message-one'")[0]
  for(const strategy of ['IGNORE','REPLACE']){
    const s=insertSql('messages',{...message,id:h.i})
    const before=snapshot(h)
    assert.throws(()=>run(h,s.sql.replace('INSERT INTO','INSERT OR '+strategy+' INTO'),...s.parameters),/KANATA_DUPLICATE_ENTITY_ID/)
    assert.equal(snapshot(h),before)
  }
  assert.throws(()=>run(h,"UPDATE messages SET content='unversioned' WHERE id='message-one'"),/KANATA_MESSAGE_REVISION_REQUIRED/)
  assert.throws(()=>run(h,"UPDATE messages SET deleted=1 WHERE id='message-one'"),/KANATA_MESSAGE_REVISION_REQUIRED/)
  const task=rows(h,'SELECT * FROM background_tasks')[0]
  const deferred={...task,id:'deferred-one',kind:'reply',idempotency_key:'synthetic-deferred',deferred_message_id:'message-one',deferred_revision:1,deferred_expires_at:2000}
  insert(h,'background_tasks',deferred)
  assert.throws(()=>run(h,"UPDATE background_tasks SET deferred_revision=3 WHERE id='deferred-one'"),/KANATA_DEFERRED_SOURCE_DENIED/)
  assert.throws(()=>insert(h,'background_tasks',{...deferred,id:'deferred-two',idempotency_key:'synthetic-deferred-2',deferred_message_id:'message-two'}),/KANATA_DEFERRED_SOURCE_DENIED/)
  assert.throws(()=>insert(h,'background_tasks',{...task,id:'social-cross',idempotency_key:'social-cross',kind:'world',window_task_id:h.data.tasks[0].id,world_id:h.w2,conversation_id:null,instance_id:null}),/FOREIGN KEY/)
  const audit=rows(h,'SELECT * FROM message_audits')[0], previous=JSON.parse(audit.previous_json)
  assert.throws(()=>run(h,'UPDATE message_audits SET previous_json=?',JSON.stringify({...previous,senderId:h.i2,senderType:'character'})),/KANATA_AUDIT_IMMUTABLE/)
})

test('M1-14 JSON类型、实例基线范围和策略边界；未知扩展与原卡payload按字节保留',async t=>{
  const h=await openFixture(t)
  for(const sql of ["UPDATE card_versions SET definition_json='[]'","UPDATE character_instances SET overrides_json='not json'",
    "UPDATE messages SET extensions_json='[]'",'UPDATE memory_policies SET summarize_after=recent_messages',
    'UPDATE autonomy_policies SET daily_dialogue_limit=5',"UPDATE effect_baselines SET value_json='2',path='state.energy'",
    "UPDATE world_effects SET operation='increment',value_json='\"string\"'"
  ])assert.throws(()=>run(h,sql))
  const raw='{"vendor":{"unknown":{"ordered":[1,"二",null]}}}',extensions='{"future":{"payload":[false,0,"扩展"]}}'
  run(h,'UPDATE card_versions SET raw_data_json=? WHERE id=?',raw,h.data.cardVersions[0].id)
  run(h,"UPDATE messages SET extensions_json=? WHERE id='message-one'",extensions)
  assert.equal(rows(h,'SELECT raw_data_json FROM card_versions WHERE id=?',h.data.cardVersions[0].id)[0].raw_data_json,raw)
  assert.equal(rows(h,"SELECT extensions_json FROM messages WHERE id='message-one'")[0].extensions_json,extensions)
})

test('M1-10 相同时间戳稳定排序，深页使用组合索引及keyset',async t=>{
  const h=await openFixture(t), original=rows(h,"SELECT * FROM messages WHERE id='message-one'")[0]
  await h.connection.transaction(async()=>{for(let i=0;i<120;i++)insert(h,'messages',{...original,id:'page-'+String(i).padStart(3,'0')})})
  const sql='SELECT id,created_at FROM messages WHERE world_id=? AND conversation_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?'
  const plan=rows(h,'EXPLAIN QUERY PLAN '+sql,h.w,h.c,1000,'page-100',50).map(r=>r.detail).join(' ')
  assert.match(plan,/SEARCH messages USING COVERING INDEX messages_scope_time/)
  const first=rows(h,sql,h.w,h.c,1000,'page-100',50),last=first.at(-1)
  const next=rows(h,sql,h.w,h.c,last.created_at,last.id,50)
  assert.equal(first.length,50);assert.equal(next.length,50)
  assert.equal(new Set([...first,...next].map(r=>r.id)).size,100)
  assert.deepEqual(first.map(r=>r.id),Array.from({length:50},(_,i)=>'page-'+String(99-i).padStart(3,'0')))
})

test('M1-11 事件因果和记忆共享父链禁止环；反向冲突链接允许',async t=>{
  const h=await openFixture(t)
  const e=rows(h,'SELECT * FROM world_events')[0],m=rows(h,'SELECT * FROM memories')[0]
  insert(h,'world_events',{...e,id:'event-two'});insert(h,'world_events',{...e,id:'event-three'})
  insert(h,'event_causes',{world_id:h.w,event_id:'event-two',cause_event_id:'event-one'})
  insert(h,'event_causes',{world_id:h.w,event_id:'event-three',cause_event_id:'event-two'})
  assert.throws(()=>insert(h,'event_causes',{world_id:h.w,event_id:'event-one',cause_event_id:'event-three'}),/KANATA_EVENT_CAUSAL_CYCLE/)
  insert(h,'memories',{...m,id:'memory-two'});insert(h,'memory_links',{world_id:h.w,memory_id:'memory-two',target_memory_id:'memory-one',kind:'shared'})
  assert.throws(()=>insert(h,'memory_links',{world_id:h.w,memory_id:'memory-one',target_memory_id:'memory-two',kind:'shared'}),/KANATA_MEMORY_SHARE_CYCLE/)
  for(const [a,b] of [['memory-one','memory-two'],['memory-two','memory-one']])insert(h,'memory_links',{world_id:h.w,memory_id:a,target_memory_id:b,kind:'conflict'})
})

test('M1-12 第二连接不能穿插升级事务；实际SIGKILL后DDL和版本回滚可重试',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kanata-m1-kill-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const path=join(dir,'synthetic.db'),h=schemaHarness(path);h.db.exec('PRAGMA journal_mode=WAL')
  const second=schemaHarness(path)
  h.db.exec('BEGIN IMMEDIATE')
  await assert.rejects(migrateKanataSchema(second.connection),code('KANATA_SCHEMA_MIGRATION_FAILED'))
  h.db.exec('ROLLBACK');h.close();second.close()
  const script=`import {schemaHarness} from './tests/helpers/kanataSqliteHarness.js';import {migrateKanataSchema} from './src/features/chat/storage/sqlite/kanataSchemaMigrator.js';
  let n=0;const h=schemaHarness(process.argv[1],{beforeExecute(sql){if(++n===30){process.stdout.write('READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)}}});await migrateKanataSchema(h.connection);`
  const child=spawn(process.execPath,['--input-type=module','-e',script,path],{stdio:['ignore','pipe','pipe']})
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')})
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('child timeout'))},15000);child.stdout.once('data',d=>{clearTimeout(timer);assert.match(String(d),/READY/);resolve()});child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited before ready'))})})
  const exited=once(child,'exit');child.kill('SIGKILL');const [exit,signal]=await exited
  assert.equal(exit,null);assert.equal(signal,'SIGKILL')
  const next=schemaHarness(path);t.after(next.close)
  assert.equal(rows(next,'PRAGMA user_version')[0].user_version,0)
  assert.equal(rows(next,'SELECT count(*) n FROM sqlite_schema')[0].n,0)
  assert.equal((await migrateKanataSchema(next.connection)).version,version)
  assert.equal(rows(next,'PRAGMA integrity_check')[0].integrity_check,'ok')
  assert.ok(readFileSync(path).length>0)
})
