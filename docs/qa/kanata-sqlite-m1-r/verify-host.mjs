import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {randomBytes,createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {migrateKanataSchema} from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {KANATA_SCHEMA_MIGRATIONS as migrations,KANATA_SCHEMA_VERSION as version,KANATA_SCHEMA_APPLICATION_ID as appId} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {sha256Text} from '../../../src/shared/crypto/sha256Text.js'
import {kanataFixtureCommands,kanataSqliteFixture} from '../../../tests/helpers/kanataSqliteFixture.js'
const root=await fs.mkdtemp(path.resolve('work/m0/m1-r-cipher-')),key=randomBytes(32),db=path.join(root,'synthetic.db')
let current,versions
async function worker(){
 const child=spawn(process.argv[2]??'work/m0/venv/bin/python',['docs/qa/kanata-sqlite-m1-r/cipher-worker.py'],{stdio:['pipe','pipe','pipe']})
 let dead=false;const pending=[],closed=new Promise(resolve=>child.once('close',(code,signal)=>{dead=true;for(const p of pending.splice(0))p.reject(Error('QA_WORKER_CLOSED'));resolve({code,signal})}))
 const reject=()=>{for(const p of pending.splice(0))p.reject(Error('QA_WORKER_FAILED'))}
 child.on('error',reject);child.stdin.on('error',reject);child.stderr.on('data',()=>{})
 const reader=createInterface({input:child.stdout})
 reader.on('line',line=>{const p=pending.shift();if(p){const r=JSON.parse(line);r.ok?p.resolve(r.value):p.reject(Error(r.code))}})
 const call=(operation,sql='',parameters=[],extra={})=>new Promise((resolve,reject)=>{
  if(dead){reject(Error('QA_WORKER_CLOSED'));return}pending.push({resolve,reject});child.stdin.write(JSON.stringify({operation,sql,parameters,...extra})+'\n')
 })
 const tx={execute:(sql,p=[])=>call('execute',sql,p),query:(sql,p=[])=>call('query',sql,p)}
 const connection={transaction:async action=>{await tx.execute('BEGIN IMMEDIATE');try{const r=await action(tx);await tx.execute('COMMIT');return r}catch(e){await tx.execute('ROLLBACK');throw e}}}
 versions=await call('init','',[],{path:db,key:key.toString('hex')})
 return {child,closed,tx,connection,call,close:async()=>{child.stdin.end();await closed;reader.close()}}
}
async function data(w){await w.connection.transaction(async tx=>{for(const c of kanataFixtureCommands())await tx.execute(c.sql,c.parameters)})}
async function integrity(w){assert.deepEqual(await w.tx.query('PRAGMA foreign_key_check'),[]);assert.equal((await w.tx.query('PRAGMA integrity_check'))[0].integrity_check,'ok');assert.deepEqual(await w.tx.query('PRAGMA cipher_integrity_check'),[])}
const checks=[]
const timeout=setTimeout(()=>{current?.child.kill('SIGKILL')},120000)
try{
 current=await worker()
 await current.connection.transaction(async tx=>{
  for(const m of migrations.slice(0,2)){for(const sql of m.statements)await tx.execute(sql);await tx.execute('INSERT INTO schema_migrations VALUES(?,?,?)',[m.version,m.name,sha256Text(JSON.stringify([m.version,m.name,m.statements]))])}
  await tx.execute('PRAGMA user_version=2');await tx.execute(`PRAGMA application_id=${appId}`)
 })
 await data(current);checks.push('released-v2-domain-fixture')
 let ready,release
 const reached=new Promise(r=>{ready=r}),gate=new Promise(r=>{release=r})
 const wrapped={transaction:action=>current.connection.transaction(tx=>action({...tx,execute:async(sql,p=[])=>{
  if(sql.startsWith('INSERT INTO schema_migration_applications')&&p[0]===3){ready();await gate;throw Error('simulated caller detects worker death')}
  await tx.execute(sql,p)
 }}))}
 const attempt=migrateKanataSchema(wrapped).catch(e=>e)
 await reached;current.child.kill('SIGKILL');assert.equal((await current.closed).signal,'SIGKILL');release();await attempt
 current=await worker()
 assert.equal((await current.tx.query('PRAGMA user_version'))[0].user_version,2)
 assert.equal((await current.tx.query("SELECT count(*) n FROM sqlite_schema WHERE name='schema_migration_applications'"))[0].n,0)
 assert.equal((await current.tx.query('SELECT count(*) n FROM messages'))[0].n,2);await integrity(current)
 checks.push('sigkill-new-application-time-writes-rolled-back')
 const start=Date.now();assert.equal((await migrateKanataSchema(current.connection)).version,version);const end=Date.now()
 const times=await current.tx.query('SELECT * FROM schema_migration_applications ORDER BY version')
 assert.deepEqual(times.slice(0,2).map(r=>r.applied_at),[null,null]);assert.ok(times[2].applied_at>=start&&times[2].applied_at<=end)
 checks.push('legacy-unknown-and-real-new-time')
 const a=(await current.tx.query('SELECT * FROM message_audits'))[0],d=kanataSqliteFixture()
 const other=d.conversations.find(c=>c.worldId===d.worlds[0].id&&c.id!==d.conversations[0].id&&c.participantIds.includes(d.identities[0].id)).id
 await current.tx.execute("UPDATE messages SET content='candidate-three',revision=3 WHERE id='message-one'")
 await assert.rejects(current.tx.execute('INSERT INTO message_audits(id,world_id,message_id,at,previous_revision,next_revision,previous_json,next_json) VALUES(?,?,?,?,?,?,?,?)',[
  'invalid-history',a.world_id,a.message_id,1001,2,3,JSON.stringify({...JSON.parse(a.next_json),conversationId:other}),JSON.stringify({...JSON.parse(a.next_json),revision:3})
 ]));checks.push('wrong-conversation-rejected')
 for(const sql of ['UPDATE message_audits SET at=at+1','DELETE FROM event_audits','UPDATE schema_migration_applications SET applied_at=0',"DELETE FROM entity_ids WHERE id='message-audit-one'","INSERT INTO entity_ids VALUES('orphan','memories')"])await assert.rejects(current.tx.execute(sql))
 checks.push('audit-time-and-entity-registry-immutability')
 // A committed prior edit without new audit is an intentionally synthetic setup,
 // not a claim that a production CAS/audit command has been implemented.
 await current.tx.execute('BEGIN IMMEDIATE')
 await current.tx.execute("UPDATE messages SET content='uncommitted-four',revision=4 WHERE id='message-one'")
 await current.tx.execute('INSERT INTO message_audits(id,world_id,message_id,at,previous_revision,next_revision,previous_json,next_json) VALUES(?,?,?,?,?,?,?,?)',[
  'crash-audit',a.world_id,a.message_id,1002,3,4,JSON.stringify({...JSON.parse(a.next_json),revision:3}),JSON.stringify({...JSON.parse(a.next_json),revision:4})
 ])
 current.child.kill('SIGKILL');assert.equal((await current.closed).signal,'SIGKILL');current=await worker()
 assert.equal((await current.tx.query("SELECT revision FROM messages WHERE id='message-one'"))[0].revision,3)
 assert.equal((await current.tx.query("SELECT count(*) n FROM message_audits WHERE id='crash-audit'"))[0].n,0)
 checks.push('sigkill-business-and-audit-atomic-rollback')
 await current.tx.execute("UPDATE messages SET deleted=1,content='（已删除的原始记录）',revision=4 WHERE id='message-one'")
 await current.tx.execute("UPDATE message_audits SET previous_json=json_set(previous_json,'$.content','（已删除的原始记录）','$.deleted',json('true')),next_json=json_set(next_json,'$.content','（已删除的原始记录）','$.deleted',json('true'))")
 await assert.rejects(current.tx.execute('UPDATE message_audits SET previous_json=?',[a.previous_json]));checks.push('irreversible-privacy-redaction')
 await integrity(current);assert.equal(await current.call('plain-rejected'),true);checks.push('cipher-fk-integrity-and-plaintext-read-rejection')
 await current.close();current=await worker();await migrateKanataSchema(current.connection);await integrity(current);checks.push('reopen-and-idempotent-migration')
 console.log(JSON.stringify({status:'PASS_HOST_SQLCIPHER_M1_R',...versions,node:process.version,version,
  schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),fixtureSha256:createHash('sha256').update(JSON.stringify(d)).digest('hex'),checks,android:'not covered by host runner'},null,2))
}finally{clearTimeout(timeout);if(current&&current.child.exitCode===null&&current.child.signalCode===null)await current.close();key.fill(0);await fs.rm(root,{recursive:true,force:true})}
