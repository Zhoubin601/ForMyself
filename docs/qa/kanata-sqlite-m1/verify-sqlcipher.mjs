import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createHash} from 'node:crypto'
import os from 'node:os'
import {KANATA_SCHEMA_MIGRATIONS as migrations} from '../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {migrateKanataSchema} from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {kanataSqliteFixture,kanataFixtureCommands,insertSql} from '../../../tests/helpers/kanataSqliteFixture.js'

// Run from repository root; optional first argument selects an installed pinned QA Python.
const child=spawn(process.argv[2]??'work/m0/venv/bin/python',['docs/qa/kanata-sqlite-m1/sqlcipher-connection.py'],{stdio:['pipe','pipe','pipe']})
const closed=new Promise(resolve=>child.once('close',resolve))
const pending=[];let stderrSeen=false,executionCount=0
const deadline=setTimeout(()=>child.kill('SIGKILL'),60000)
child.stderr.on('data',()=>{stderrSeen=true})
child.on('error',()=>{for(const p of pending.splice(0))p.reject(Error('QA_WORKER_UNAVAILABLE'))})
child.stdin.on('error',()=>{for(const p of pending.splice(0))p.reject(Error('QA_WORKER_INPUT_FAILED'))})
child.on('exit',()=>{for(const p of pending.splice(0))p.reject(Error('QA_WORKER_EXITED'))})
const lines=createInterface({input:child.stdout})
lines.on('line',line=>{const p=pending.shift();if(!p)return;try{const r=JSON.parse(line);if(r.ok)p.resolve(r.value);else p.reject(Error(r.code))}catch{p.reject(Error('QA_RESPONSE_INVALID'))}})
const call=(operation,sql='',parameters=[])=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({operation,sql,parameters})+'\n')})
const tx={execute:async(sql,parameters=[])=>{executionCount++;await call('execute',sql,parameters)},query:(sql,parameters=[])=>call('query',sql,parameters)}
const connection={transaction:async f=>{await call('execute','BEGIN IMMEDIATE');try{const r=await f(tx);await call('execute','COMMIT');return r}catch(e){await call('execute','ROLLBACK');throw e}}}
const checks=[]
try {
  const cipherVersion=(await tx.query('PRAGMA cipher_version'))[0].cipher_version
  const sqliteVersion=(await tx.query('SELECT sqlite_version() AS version'))[0].version
  assert.equal((await migrateKanataSchema(connection)).version,2);checks.push('empty-to-latest')
  const data=kanataSqliteFixture(),commands=kanataFixtureCommands(data),w=data.worlds[0].id,w2=data.worlds[1].id,c=data.conversations[0].id
  await connection.transaction(async()=>{for(const s of commands)await tx.execute(s.sql,s.parameters)});checks.push('actual-domain-fixture')
  const before=executionCount
  assert.deepEqual((await migrateKanataSchema(connection)).appliedVersions,[])
  assert.equal(executionCount,before);checks.push('idempotent-no-ddl')
  for(const [table,row] of [
    ['conversation_participants',{world_id:w,conversation_id:c,participant_id:data.instances.find(i=>i.worldId===w2).id,kind:'character',ordinal:10}],
    ['memory_sources',{world_id:w2,memory_id:'memory-one',message_id:'message-one',message_revision:1}],
    ['event_sources',{world_id:w2,event_id:'event-one',message_id:'message-one',message_revision:1}],
    ['memory_sources',{world_id:w,memory_id:'memory-one',message_id:'missing',message_revision:1}]
  ]){const s=insertSql(table,row);await assert.rejects(tx.execute(s.sql,s.parameters))}
  checks.push('cross-world-and-orphans-rejected')
  for(const sql of ['UPDATE memory_sources SET message_revision=3','UPDATE event_sources SET message_revision=3',"UPDATE messages SET revision=1 WHERE id='message-one'",'UPDATE life_grants SET can_share=2',"UPDATE messages SET content='unaudited edit' WHERE id='message-one'"])await assert.rejects(tx.execute(sql))
  checks.push('revision-and-state-rejected')
  await assert.rejects(connection.transaction(async()=>{await tx.execute("UPDATE messages SET content='rolled-back',revision=3 WHERE id='message-one'");await tx.execute('CREATE TABLE invalid_migration(value TEXT)');throw Error('injected')}))
  assert.equal((await tx.query("SELECT revision FROM messages WHERE id='message-one'"))[0].revision,2)
  assert.equal((await tx.query("SELECT count(*) n FROM sqlite_schema WHERE name='invalid_migration'"))[0].n,0);checks.push('ddl-and-data-rollback')
  await call('reopen');await migrateKanataSchema(connection);checks.push('encrypted-reopen')
  await tx.execute('PRAGMA user_version=999');const writes=executionCount
  await assert.rejects(migrateKanataSchema(connection),e=>e.code==='KANATA_SCHEMA_FUTURE_VERSION')
  assert.equal(executionCount,writes);await tx.execute('PRAGMA user_version=2');checks.push('future-version-zero-write')
  assert.deepEqual(await tx.query('PRAGMA foreign_key_check'),[])
  assert.equal((await tx.query('PRAGMA integrity_check'))[0].integrity_check,'ok')
  assert.deepEqual(await tx.query('PRAGMA cipher_integrity_check'),[])
  assert.equal(await call('encrypted'),true);checks.push('cipher-and-foreign-key-integrity')
  const plan=await tx.query('EXPLAIN QUERY PLAN SELECT id FROM messages WHERE world_id=? AND conversation_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?',[w,c,1000,'message-two',50])
  assert.match(plan.map(r=>r.detail).join(' '),/SEARCH messages USING COVERING INDEX messages_scope_time/);checks.push('keyset-index')
  console.log(JSON.stringify({status:'PASS_HOST_SQLCIPHER',cipherVersion,sqliteVersion,node:process.version,platform:os.platform(),arch:os.arch(),kernel:os.release(),
    schemaSha256:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),fixtureSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    fixtureCommands:commands.length,checks,stderrSeen,android:'NOT_RUN_BY_THIS_HOST_SCRIPT'},null,2))
} finally {
  child.stdin.end();await closed;lines.close();clearTimeout(deadline)
}
