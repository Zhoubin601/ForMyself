import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {migrateKanataSchema} from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {kanataSchemaAdapter} from '../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import {createKanataSqliteDomains} from '../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import {m2Fixture,m2FixtureCommands} from './helpers/kanataSqliteM2Fixture.js'
import {growthSeedSql} from '../docs/qa/kanata-sqlite-m4/fixture.mjs'
import {checkStoredTaskSources,taskSourceProofQueries} from '../src/features/chat/storage/sqlite/kanataTaskSourceProof.js'
import {sourceConversation,conversationAccess,requireSourceGrants,hasSourceGrants} from '../src/features/chat/storage/sqlite/kanataProvenance.js'

async function setup(t,path=':memory:'){
  const db=new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL')
  t.after(()=>{if(db.isOpen)db.close()})
  const state={queries:[],writes:[],failOnWrite:0,failCommit:false,closed:false}
  const tx={
    async query(sql,args=[]){
      const rows=db.prepare(sql).all(...args)
      state.queries.push({sql,count:rows.length,maxText:Math.max(0,...rows.flatMap(row=>Object.values(row)
        .filter(value=>typeof value==='string').map(value=>Array.from(value).length))),
      fullRows:rows.filter(row=>Object.hasOwn(row,'metadata_json')||Object.hasOwn(row,'extensions_json')).length})
      return rows
    },
    async execute(sql,args=[]){
      state.writes.push(sql)
      if(state.failOnWrite===state.writes.length)throw Error('TASK_WRITE_INJECTED')
      return {affectedRows:Number(db.prepare(sql).run(...args).changes)}
    },
  }
  const operation={async transaction(action){
    if(state.closed)throw Error('TASK_OWNER_CLOSED')
    db.exec('BEGIN IMMEDIATE')
    try{
      const result=await action(tx)
      if(state.failCommit)db.prepare('INSERT INTO task_sources(world_id,task_id,message_id,message_revision) VALUES(?,?,?,?)')
        .run('missing-world','missing-task','missing-message',1)
      db.exec('COMMIT');return result
    }catch(error){db.exec('ROLLBACK');throw error}
  }}
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture=m2Fixture()
  await operation.transaction(async tx=>{for(const {sql,parameters}of m2FixtureCommands(fixture))await tx.execute(sql,parameters)})
  let sequence=0
  const tools={id:()=>`task-read-${++sequence}`,clock:()=>1800000}
  const domains=createKanataSqliteDomains(operation,tools)
  const worldId=fixture.messages[0].worldId
  const task=fixture.tasks.find(row=>row.worldId===worldId)
  state.queries.length=state.writes.length=0
  return {db,state,tx,operation,fixture,domains,task,worldId}
}

// These sinks deliberately gather synthetic expected output in tests. No
// corresponding reconstruction exists in the ordinary Repository or Runtime.
async function sourceSink(autonomy,worldId,id){
  const entries=[]
  let cursor
  do{const page=await autonomy.taskSources(worldId,id,cursor);assert(page.entries.length<=50)
    entries.push(...page.entries);cursor=page.cursor??undefined}while(cursor)
  return entries
}
async function resultSink(autonomy,worldId,id,kind){
  const ids=[]
  let cursor
  do{const page=await autonomy.taskResults(worldId,id,kind,cursor);assert(page.ids.length<=50)
    ids.push(...page.ids);cursor=page.cursor??undefined}while(cursor)
  return ids
}
async function jsonSink(autonomy,worldId,id,field){
  let text='',cursor
  do{const page=await autonomy.taskJsonChunk(worldId,id,field,cursor);assert(Array.from(page.part).length<=4096)
    text+=page.part;cursor=page.cursor??undefined}while(cursor)
  return JSON.parse(text)
}
const seedEvents=`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
  INSERT INTO world_events(world_id,id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind,extensions_json)
  SELECT ?,?||printf('%05d',?-n+1),'committed','public','合成任务结果',n,n+1000,1,'explicit','note','{}' FROM seq`
const seedMemories=`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
  INSERT INTO memories(world_id,id,owner_type,owner_id,owner_instance_id,layer,memory_key,content,status,revision,visibility)
  SELECT ?,?||n,'character',?,?,'L3',?||n,'合成结果记忆','active',1,'private' FROM seq`

for(const size of [1000,10000])test(`G4 task ${size} sources/results stay in bounded headers, keysets and incremental signatures`,async t=>{
  const {db,state,operation,fixture,domains,task,worldId}=await setup(t)
  const sample=fixture.messages[0],actor=fixture.instances.find(row=>row.worldId===worldId)
  const prefix=`task-bounds-${size}-`
  await operation.transaction(async tx=>{
    await tx.execute(growthSeedSql,[size,prefix,worldId,sample.conversationId,sample.senderId])
    await tx.execute(`INSERT INTO task_sources(world_id,task_id,message_id,message_revision)
      SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND id LIKE ?`,[task.id,worldId,prefix+'-history-%'])
    await tx.execute(seedEvents,[size,worldId,prefix+'event-',size])
    await tx.execute(`INSERT INTO task_result_events(world_id,task_id,event_id)
      SELECT world_id,?,id FROM world_events WHERE world_id=? AND id LIKE ?`,[task.id,worldId,prefix+'event-%'])
    await tx.execute(seedMemories,[103,worldId,prefix+'memory-',actor.id,actor.id,prefix+'memory-key-'])
    await tx.execute(`INSERT INTO task_result_memories(world_id,task_id,memory_id)
      SELECT world_id,?,id FROM memories WHERE world_id=? AND id LIKE ?`,[task.id,worldId,prefix+'memory-%'])
  })
  const key='task\u0000'+'K'.repeat(6000)
  const metadata={future:{text:'meta界😀'.repeat(3000)},deep:JSON.parse('['.repeat(70)+'0'+']'.repeat(70))}
  const extensions={future:{text:'extension界😀'.repeat(2000)},keep:[null,false,7]}
  db.prepare('UPDATE background_tasks SET metadata_json=?,extensions_json=?,idempotency_key=? WHERE world_id=? AND id=?')
    .run(JSON.stringify(metadata),JSON.stringify(extensions),key,worldId,task.id)
  state.queries.length=state.writes.length=0
  const header=await domains.autonomy.taskHeader(worldId,task.id)
  const listed=(await domains.autonomy.listTasks(worldId)).tasks.find(row=>row.id===task.id)
  const headerValidations=state.queries.filter(row=>row.sql.includes('WITH RECURSIVE tree')).length
  assert.deepEqual(listed,header)
  assert.equal(header.sourceCount,size+task.sourceRefs.length)
  assert.equal(header.resultEventCount,size+task.resultEventIds.length)
  assert.equal(header.resultMemoryCount,103+(task.resultMemoryIds?.length??0))
  for(const field of ['sourceRefs','resultEventIds','resultMemoryIds','metadata','future','simulationWindow','contact','social'])
    assert.equal(Object.hasOwn(header,field),false)
  assert.equal(header.idempotencyKey,null)
  assert.equal(header.idempotencyKeyChunked,true)
  const sources=await sourceSink(domains.autonomy,worldId,task.id)
  assert.equal(sources.length,header.sourceCount)
  assert.equal(new Set(sources.map(row=>row.messageId)).size,header.sourceCount)
  for(const ref of task.sourceRefs)assert(sources.some(row=>row.messageId===ref.messageId&&row.revision===ref.revision))
  const eventIds=await resultSink(domains.autonomy,worldId,task.id,'events')
  assert.deepEqual(eventIds,[...task.resultEventIds,...Array.from({length:size},(_,i)=>prefix+'event-'+String(size-i).padStart(5,'0'))])
  assert.equal((await resultSink(domains.autonomy,worldId,task.id,'memories')).length,103+(task.resultMemoryIds?.length??0))
  assert.deepEqual(await jsonSink(domains.autonomy,worldId,task.id,'metadata'),metadata)
  assert.deepEqual(await jsonSink(domains.autonomy,worldId,task.id,'extensions'),extensions)
  assert.equal(await jsonSink(domains.autonomy,worldId,task.id,'idempotencyKey'),key)
  assert(state.queries.every(row=>row.count<=51&&row.maxText<=4097&&row.fullRows===0))
  assert.equal(db.prepare('SELECT count(*) AS n FROM temp.kanata_task_read_signature').get().n,1)
  assert.equal(state.queries.filter(row=>row.sql.includes('WITH RECURSIVE tree')).length-headerValidations,1,'unchanged pages reuse only one connection-local proof')
  console.log(JSON.stringify({size,sources:header.sourceCount,events:header.resultEventCount,maxRows:Math.max(...state.queries.map(row=>row.count)),
    maxText:Math.max(...state.queries.map(row=>row.maxText)),completeDtos:0}))
})

test('G4 task continuations bind task, world, relation, field and all same-revision stored data',async t=>{
  const {db,domains,task,worldId,fixture}=await setup(t)
  const sample=fixture.messages[0]
  for(let i=0;i<55;i++){
    const id='task-cursor-source-'+i
    db.prepare(`INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,content,created_at,revision,status,turn_id,batch_id)
      VALUES(?,?,?,'user','user',?,'合成','source',1000,1,'complete','turn','batch')`).run(id,worldId,sample.conversationId,sample.senderId)
    db.prepare('INSERT INTO task_sources VALUES(?,?,?,1)').run(worldId,task.id,id)
  }
  db.prepare('UPDATE background_tasks SET extensions_json=? WHERE id=?').run(JSON.stringify({value:'界😀'.repeat(5000)}),task.id)
  const first=await domains.autonomy.taskSources(worldId,task.id)
  const text=await domains.autonomy.taskJsonChunk(worldId,task.id,'extensions')
  assert(first.cursor&&text.cursor)
  await assert.rejects(domains.autonomy.taskSources(fixture.worlds[1].id,task.id,first.cursor),/TASK_UNAVAILABLE/)
  await assert.rejects(domains.autonomy.taskResults(worldId,task.id,'memories',first.cursor),/CURSOR_STALE/)
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id,{...first.cursor,afterOrdinal:0}),/CURSOR_STALE/)
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id,undefined,51),/LIMIT_INVALID/)
  await assert.rejects(domains.autonomy.taskJsonChunk(worldId,task.id,'metadata',text.cursor),/CURSOR_STALE/)
  await assert.rejects(domains.autonomy.taskJsonChunk(worldId,task.id,'extensions',{...text.cursor,offset:-1}),/CURSOR_STALE/)
  db.prepare('UPDATE background_tasks SET extensions_json=? WHERE id=?').run(JSON.stringify({value:'changed'}),task.id)
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id,first.cursor),/CURSOR_STALE/)
  await assert.rejects(domains.autonomy.taskJsonChunk(worldId,task.id,'extensions',text.cursor),/CURSOR_STALE/)
  const next=await domains.autonomy.taskSources(worldId,task.id)
  db.prepare('UPDATE task_sources SET message_revision=2 WHERE world_id=? AND task_id=? AND message_id=?')
    .run(worldId,task.id,task.sourceRefs[0].messageId)
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id,next.cursor),/CURSOR_STALE/)
  assert.equal((await domains.autonomy.taskHeader(worldId,task.id)).sourceCount,56)
})

test('G4 task list cursor scope, owner cancellation and failed read COMMIT preserve source rows and retry',async t=>{
  const {db,state,domains,task,worldId,fixture}=await setup(t)
  const copy=fixture.tasks[0]
  await domains.autonomy.enqueue({...copy,id:'task-list-second',state:'pending',attempt:0,leaseUntil:0,sourceRefs:[],resultEventIds:[],resultMemoryIds:[],idempotencyKey:'second'})
  const first=await domains.autonomy.listTasks(worldId,undefined,1)
  assert(first.cursor)
  await assert.rejects(domains.autonomy.listTasks(fixture.worlds[1].id,first.cursor),/CURSOR_STALE/)
  assert.equal((await domains.autonomy.listTasks(worldId,first.cursor,1)).tasks.length,1)
  const before=db.prepare('SELECT * FROM task_sources ORDER BY world_id,task_id,message_id').all()
  state.failCommit=true
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id),/FOREIGN KEY/)
  state.failCommit=false
  assert.deepEqual(db.prepare('SELECT * FROM task_sources ORDER BY world_id,task_id,message_id').all(),before)
  assert.equal((await domains.autonomy.taskSources(worldId,task.id)).entries.length,task.sourceRefs.length)
  state.queries.length=state.writes.length=0
  state.closed=true
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id),/TASK_OWNER_CLOSED/)
  assert.equal(state.queries.length,0);assert.equal(state.writes.length,0)
})

test('G4 task proof detects external commits and failed cache writes never alter task data',async t=>{
  const {mkdtempSync,rmSync,rmdirSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const folder=mkdtempSync(join(tmpdir(),'kanata-task-read-')),path=join(folder,'synthetic.sqlite')
  const {db,state,domains,task,worldId}=await setup(t,path)
  const external=new DatabaseSync(path)
  external.exec('PRAGMA foreign_keys=ON')
  t.after(()=>{
    if(external.isOpen)external.close();if(db.isOpen)db.close()
    for(const suffix of ['', '-wal', '-shm'])rmSync(path+suffix,{force:true})
    rmdirSync(folder)
  })
  db.prepare('UPDATE background_tasks SET metadata_json=? WHERE id=?').run(JSON.stringify({future:'界😀'.repeat(5000)}),task.id)
  const first=await domains.autonomy.taskJsonChunk(worldId,task.id,'metadata')
  assert(first.cursor)
  const changes=db.prepare('SELECT total_changes() AS n').get().n
  external.prepare('UPDATE background_tasks SET metadata_json=? WHERE id=?').run(JSON.stringify({future:'external'}),task.id)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,changes)
  await assert.rejects(domains.autonomy.taskJsonChunk(worldId,task.id,'metadata',first.cursor),/CURSOR_STALE/)
  assert.deepEqual(await jsonSink(domains.autonomy,worldId,task.id,'metadata'),{future:'external'})
  const snapshot=db.prepare('SELECT * FROM background_tasks WHERE id=?').get(task.id)
  for(let step=1;step<=3;step++){
    db.exec('DELETE FROM temp.kanata_task_read_signature')
    state.writes.length=0;state.failOnWrite=step
    await assert.rejects(domains.autonomy.taskSources(worldId,task.id),/TASK_WRITE_INJECTED/)
    state.failOnWrite=0
    assert.deepEqual(db.prepare('SELECT * FROM background_tasks WHERE id=?').get(task.id),snapshot)
    assert.equal((await domains.autonomy.taskSources(worldId,task.id)).entries.length,task.sourceRefs.length)
  }
  external.prepare('UPDATE background_tasks SET extensions_json=? WHERE id=?').run('{"deep":'+'['.repeat(65)+'0'+']'.repeat(65)+'}',task.id)
  await assert.rejects(domains.autonomy.taskSources(worldId,task.id),/INTEGRITY_FAILED/)
  await assert.rejects(domains.autonomy.taskHeader(worldId,task.id),/INTEGRITY_FAILED/)
  await assert.rejects(domains.autonomy.listTasks(worldId),/INTEGRITY_FAILED/)
  await assert.rejects(domains.autonomy.claim(worldId,task.id,1800000,1800100),/INTEGRITY_FAILED/)
  assert.equal(db.prepare('SELECT state FROM background_tasks WHERE id=?').get(task.id).state,snapshot.state)
})

test('G3 task enqueue and finish own caller input before Native transaction acquisition',async t=>{
  const {operation,worldId}=await setup(t)
  const delayed={transaction:action=>Promise.resolve().then(()=>operation.transaction(action))}
  const autonomy=createKanataSqliteDomains(delayed,{id:()=>crypto.randomUUID(),clock:()=>1800000}).autonomy
  const input={id:'task-owned-input',worldId,kind:'world',state:'pending',idempotencyKey:'task-owned-input',sourceRevision:1,
    sourceRefs:[],resultEventIds:[],attempt:0,notBefore:0,leaseUntil:0}
  const pending=autonomy.enqueue(input)
  input.worldId='changed-world';input.sourceRefs.push({messageId:'changed-message',revision:9})
  assert.equal((await pending).worldId,worldId)
  const claimed=await autonomy.claim(worldId,'task-owned-input',1800000,1800100)
  const lease={attempt:claimed.attempt,leaseUntil:claimed.leaseUntil},result={status:'failed',errorCode:'ORIGINAL_FAILURE'}
  const finishing=autonomy.finish(worldId,claimed.id,lease,result)
  lease.attempt=99;result.errorCode='CHANGED_FAILURE'
  const finished=await finishing
  assert.equal(finished.errorCode,'ORIGINAL_FAILURE')
  assert.equal(finished.state,'failed')
})

for(const size of [1000,10000])test(`G4 task ${size} source claim checks the denied tail and returns no gathered DTO on retry or finish`,async t=>{
  const {db,state,operation,domains,fixture,worldId}=await setup(t)
  const sample=fixture.messages[0],prefix='task-claim-'+size
  const pending={id:prefix,worldId,kind:'world',state:'pending',idempotencyKey:prefix,sourceRevision:1,
    sourceRefs:[],resultEventIds:[],attempt:0,notBefore:1000,leaseUntil:0}
  await domains.autonomy.enqueue(pending)
  await operation.transaction(async tx=>{
    await tx.execute(growthSeedSql,[size,prefix,worldId,sample.conversationId,sample.senderId])
    await tx.execute(`INSERT INTO task_sources(world_id,task_id,message_id,message_revision)
      SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND id LIKE ?`,[pending.id,worldId,prefix+'-history-%'])
  })
  const grant=fixture.lifeGrants.find(row=>row.worldId===worldId)
  const tail=db.prepare('SELECT message_id FROM task_sources WHERE task_id=? ORDER BY message_id DESC LIMIT 1').get(pending.id).message_id
  db.prepare('INSERT INTO message_life_sources VALUES(?,?,?,?,?,?,?)').run(worldId,tail,grant.id,grant.instanceId,grant.moduleId,grant.revision,'b'.repeat(64))
  await assert.rejects(domains.autonomy.claim(worldId,pending.id,1800000,1800100),/TASK_SOURCE_SCOPE/)
  assert.equal((await domains.autonomy.taskHeader(worldId,pending.id)).state,'pending')
  db.prepare('DELETE FROM message_life_sources WHERE world_id=? AND message_id=?').run(worldId,tail)
  state.queries.length=state.writes.length=0
  const claimed=await domains.autonomy.claim(worldId,pending.id,1800000,1800100)
  assert.equal(claimed.sourceCount,size);assert.equal(claimed.attempt,1)
  assert.equal(Object.hasOwn(claimed,'sourceRefs'),false)
  const lease={attempt:claimed.attempt,leaseUntil:claimed.leaseUntil}
  const done=await domains.autonomy.finish(worldId,pending.id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
  assert.equal(done.state,'failed');assert.equal(done.sourceCount,size)
  assert.equal(Object.hasOwn(done,'sourceRefs'),false)
  assert.deepEqual(await domains.autonomy.finish(worldId,pending.id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'}),done)
  assert(state.queries.every(row=>row.count<=50&&row.maxText<=4096&&row.fullRows===0))
  assert.equal(state.queries.filter(row=>row.sql.includes('roots AS MATERIALIZED')).length,size/50+1)
})

test('G6 stored task range proof matches the original ordered source checks for private/group grants and stale chains',async t=>{
  const {db,tx,operation,domains,fixture,worldId}=await setup(t)
  const plan=db.prepare('EXPLAIN QUERY PLAN '+taskSourceProofQueries[1]).all(worldId,'task','actor','conversation',1,'')
  assert(plan.some(row=>/SEARCH task_sources.*world_id=.*task_id=.*message_id>/.test(row.detail)))
  const sample=fixture.messages[0],origin=sample.lifeSources[0].instanceId
  const receiver=fixture.instances.find(row=>row.worldId===worldId&&row.id!==origin).id
  const group=fixture.conversations.find(row=>row.worldId===worldId&&row.type==='group').id
  const otherConversation=fixture.conversations.find(row=>row.worldId===worldId&&row.id!==sample.conversationId).id
  const id='task-proof-parity'
  await domains.autonomy.enqueue({id,worldId,kind:'world',state:'pending',idempotencyKey:id,sourceRevision:1,
    sourceRefs:[],resultEventIds:[],attempt:0,notBefore:0,leaseUntil:0})
  await operation.transaction(tx=>tx.execute(growthSeedSql,[2,'task-proof-parity',worldId,sample.conversationId,sample.senderId]))
  const [parent,child]=db.prepare("SELECT id FROM messages WHERE id LIKE 'task-proof-parity-history-%' ORDER BY id").all().map(row=>row.id)
  await operation.transaction(tx=>tx.execute(growthSeedSql,[2,'task-proof-group',worldId,group,sample.senderId]))
  const groupPair=db.prepare("SELECT id FROM messages WHERE id LIKE 'task-proof-group-history-%' ORDER BY id").all().map(row=>row.id)
  db.prepare('UPDATE messages SET reply_to_message_id=?,reply_to_revision=NULL WHERE id=?').run(parent,child)
  db.prepare('UPDATE messages SET reply_to_message_id=?,reply_to_revision=NULL WHERE id=?').run(...groupPair)
  db.prepare('INSERT INTO task_sources VALUES(?,?,?,?)').run(worldId,id,child,1)
  const grant=fixture.lifeGrants[0]
  db.prepare('INSERT INTO life_grants(world_id,instance_id,module_id,id,can_read,can_remember,can_share,revision) VALUES(?,?,?,?,1,1,1,1)')
    .run(worldId,receiver,grant.moduleId,'task-proof-receiver')
  db.prepare('INSERT INTO message_life_sources VALUES(?,?,?,?,?,?,?)').run(worldId,parent,grant.id,origin,grant.moduleId,grant.revision,'f'.repeat(64))
  db.prepare('INSERT INTO message_life_sources VALUES(?,?,?,?,?,?,?)').run(worldId,groupPair[0],grant.id,origin,grant.moduleId,grant.revision,'f'.repeat(64))
  // Frozen old ordered algorithm; its original provenance functions remain the
  // oracle. This test compares actual allow/deny codes, not SQL source text.
  const original=async(task,refs)=>{
    for(const ref of refs){
      const conversationId=await sourceConversation(tx,task.worldId,ref)
      if(task.conversationId&&conversationId!==task.conversationId)throw Error('KANATA_TASK_SOURCE_SCOPE')
      if(task.instanceId){
        const access=await conversationAccess(tx,task.worldId,conversationId,task.instanceId)
        if(!access)throw Error('KANATA_TASK_SOURCE_SCOPE')
        await requireSourceGrants(tx,ref,{worldId:task.worldId,instanceId:task.instanceId,group:access.group,
          remember:['memory','summary','world'].includes(task.kind)})
      }else if(await hasSourceGrants(tx,task.worldId,ref))throw Error('KANATA_TASK_SOURCE_SCOPE')
    }
  }
  const outcome=async action=>{try{await action();return 'PASS'}catch(error){return error.code??error.message}}
  let allowed=0,denied=0,cases=0
  for(const conversationId of [sample.conversationId,group]){
    const currentChild=conversationId===group?groupPair[1]:child
    db.prepare('DELETE FROM task_sources WHERE task_id=?').run(id)
    db.prepare('INSERT INTO task_sources VALUES(?,?,?,?)').run(worldId,id,currentChild,1)
    const refs=[{messageId:currentChild,revision:1}]
    for(const instanceId of [undefined,origin,receiver])for(const kind of ['proactive','world','memory']){
      for(let flags=0;flags<64;flags++){
        db.prepare('UPDATE life_grants SET can_read=?,can_remember=?,can_share=? WHERE id=?')
          .run(flags&1?1:0,flags&2?1:0,flags&4?1:0,grant.id)
        db.prepare('UPDATE life_grants SET can_read=?,can_remember=?,can_share=? WHERE id=?')
          .run(flags&8?1:0,flags&16?1:0,flags&32?1:0,'task-proof-receiver')
        const task={id,worldId,kind,conversationId,...(instanceId&&{instanceId})}
        const expected=await outcome(()=>original(task,refs))
        const actual=await outcome(()=>checkStoredTaskSources(tx,task,rows=>original(task,rows)))
        assert.equal(actual,expected,JSON.stringify({conversationId,instanceId,kind,flags}))
        expected==='PASS'?allowed++:denied++;cases++
      }
    }
  }
  db.prepare('DELETE FROM task_sources WHERE task_id=?').run(id)
  db.prepare('INSERT INTO task_sources VALUES(?,?,?,?)').run(worldId,id,child,1)
  const task={id,worldId,kind:'world',conversationId:otherConversation,instanceId:origin}
  db.prepare('UPDATE messages SET revision=2 WHERE id=?').run(parent)
  assert.equal(await outcome(()=>checkStoredTaskSources(tx,task,rows=>original(task,rows))),'KANATA_SOURCE_STALE')
  db.prepare('UPDATE messages SET reply_to_revision=2 WHERE id=?').run(child)
  db.prepare('UPDATE messages SET reply_to_message_id=? WHERE id=?').run(child,parent)
  assert.equal(await outcome(()=>checkStoredTaskSources(tx,task,rows=>original(task,rows))),'KANATA_SOURCE_STALE')
  assert(allowed>0&&denied>0);console.log(JSON.stringify({permissionCases:cases,allowed,denied,staleAndCyclePriority:true}))
})
