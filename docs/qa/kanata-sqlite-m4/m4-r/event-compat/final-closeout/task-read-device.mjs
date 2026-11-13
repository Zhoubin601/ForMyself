import {createKanataSqliteDomains} from '../../../../../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import {createKanataMessageRepository} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import {growthSeedSql} from '../../../fixture.mjs'
import {taskSourceProofQueries} from '../../../../../../src/features/chat/storage/sqlite/kanataTaskSourceProof.js'
export const taskProofPlanQuery='EXPLAIN QUERY PLAN '+taskSourceProofQueries[1]

const sourceLinks=`INSERT INTO task_sources(world_id,task_id,message_id,message_revision)
  SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND id LIKE ?`
const eventRows=`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
  INSERT INTO world_events(world_id,id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind,extensions_json)
  SELECT ?,?||printf('%05d',?-n+1),'committed','public','合成任务结果',n,n+1000,1,'explicit','note','{}' FROM seq`
const eventLinks=`INSERT INTO task_result_events(world_id,task_id,event_id)
  SELECT world_id,?,id FROM world_events WHERE world_id=? AND id LIKE ?`
const wideBody='UPDATE background_tasks SET metadata_json=?,extensions_json=?,idempotency_key=? WHERE world_id=? AND id=?'
const tailTag=`INSERT INTO message_life_sources(world_id,message_id,grant_id,instance_id,module_id,grant_revision,fingerprint) VALUES(?,?,?,?,?,?,?)`
const clearTail='DELETE FROM message_life_sources WHERE world_id=? AND message_id=?'
export const taskFixtureWrites=[sourceLinks,eventRows,eventLinks,wideBody,tailTag,clearTail]
const check=(value,code)=>{if(!value)throw Error(code)}
async function rejects(action,code){try{await action()}catch(error){check((error.code??error.message).includes(code),'UNEXPECTED_'+(error.code??error.message));return}throw Error('EXPECTED_'+code)}
const tools={id:()=>crypto.randomUUID(),clock:()=>1800000}
const taskId=size=>'task-device-'+size
const lease={attempt:1,leaseUntil:1800100}

export async function runTaskReadDevice(candidate,fixture,commands,commitFault){
  return candidate.run({create:true},async operation=>{
    await operation.transaction(async tx=>{for(const {sql,parameters}of commands)await tx.execute(sql,parameters)})
    const health=await operation.health(),results=[]
    const sample=fixture.messages[0],worldId=sample.worldId
    const tag=sample.lifeSources[0]
    const plan=await operation.transaction(tx=>tx.query(taskProofPlanQuery,[worldId,taskId(1000),null,sample.conversationId,1,'']))
    const proofIndex=plan.map(row=>String(row.detail)).filter(detail=>detail.includes('task_sources'))
    check(proofIndex.some(detail=>/SEARCH task_sources.*world_id=.*task_id=.*message_id>/.test(detail)),'TASK_PROOF_KEYSET_PLAN')
    for(const size of [1000,10000]){
      const started=performance.now(),prefix=`task-device-${size}`,id=taskId(size)
      const progress=phase=>{window.taskReadPhase={size,phase,elapsedMs:Math.round(performance.now()-started)}}
      progress('prepare')
      let maxRows=0,maxText=0,fullDtos=0
      const observed={transaction:action=>operation.transaction(tx=>action({execute:tx.execute,query:async(sql,args)=>{
        const rows=await tx.query(sql,args)
        maxRows=Math.max(maxRows,rows.length)
        for(const row of rows){
          if(Object.hasOwn(row,'metadata_json')||Object.hasOwn(row,'extensions_json'))fullDtos++
          for(const value of Object.values(row))if(typeof value==='string')maxText=Math.max(maxText,Array.from(value).length)
        }
        return rows
      }}))}
      const autonomy=createKanataSqliteDomains(observed,tools).autonomy
      await autonomy.enqueue({id,worldId,kind:'world',state:'pending',idempotencyKey:prefix,sourceRevision:1,
        sourceRefs:[],attempt:0,notBefore:0,leaseUntil:0,resultEventIds:[],conversationId:sample.conversationId})
      const metadata={future:{text:'界😀合成'.repeat(3000)},deep:JSON.parse('['.repeat(70)+'0'+']'.repeat(70))}
      const extensions={retained:[null,false,7],text:'扩展😀'.repeat(3000)}
      const key=prefix+'\u0000'+'K'.repeat(6000)
      await operation.transaction(async tx=>{
        await tx.execute(growthSeedSql,[size,prefix,worldId,sample.conversationId,sample.senderId])
        await tx.execute(sourceLinks,[id,worldId,prefix+'-history-%'])
        await tx.execute(eventRows,[size,worldId,prefix+'-event-',size])
        await tx.execute(eventLinks,[id,worldId,prefix+'-event-%'])
        await tx.execute(wideBody,[JSON.stringify(metadata),JSON.stringify(extensions),key,worldId,id])
      })
      const header=await autonomy.taskHeader(worldId,id)
      check(header.sourceCount===size&&header.resultEventCount===size&&header.idempotencyKey===null&&header.idempotencyKeyChunked,'TASK_HEADER')
      check(!Object.hasOwn(header,'sourceRefs')&&!Object.hasOwn(header,'resultEventIds')&&!Object.hasOwn(header,'future'),'TASK_FULL_DTO')
      let sources=0,sourceCursor,first
      progress('sources')
      do{const page=await autonomy.taskSources(worldId,id,sourceCursor)
        check(page.entries.length<=50,'TASK_SOURCE_LIMIT');first??=page.cursor
        for(const ref of page.entries){check(ref.revision===1&&ref.messageId.startsWith(prefix+'-history-'),'TASK_SOURCE_CONTENT');sources++}
        sourceCursor=page.cursor??undefined
      }while(sourceCursor)
      check(sources===size,'TASK_SOURCE_TAIL')
      let events=0,eventCursor
      progress('events')
      do{const page=await autonomy.taskResults(worldId,id,'events',eventCursor)
        check(page.ids.length<=50,'TASK_EVENT_LIMIT')
        for(const eventId of page.ids){check(eventId===prefix+'-event-'+String(size-events).padStart(5,'0'),'TASK_EVENT_ARRAY_ORDER');events++}
        eventCursor=page.cursor??undefined
      }while(eventCursor)
      check(events===size,'TASK_EVENT_TAIL')
      progress('chunks')
      let chunks=0
      for(const [field,expected]of [['metadata',metadata],['extensions',extensions],['idempotencyKey',key]]){
        // Deliberate synthetic verification sink, never used by the Runtime.
        let text='',cursor
        do{const page=await autonomy.taskJsonChunk(worldId,id,field,cursor)
          check(Array.from(page.part).length<=4096,'TASK_CHUNK_LIMIT');text+=page.part;chunks++;cursor=page.cursor??undefined
        }while(cursor)
        check(JSON.stringify(JSON.parse(text))===JSON.stringify(expected),'TASK_EXACT_'+field)
      }
      const selected={kind:'extensions'},scope={worldId,conversationId:sample.conversationId}
      const messageReader=createKanataMessageRepository(observed,tools)
      const selectedRead=messageReader.jsonChunk(scope,sample.id,selected)
      selected.kind='snapshot';scope.worldId='changed-world'
      const owned=await selectedRead
      check(!Object.hasOwn(JSON.parse(owned.fragment),'id'),'MESSAGE_SELECTION_ALIAS')
      // Derive the lexical source tail from the keyset API itself.
      const tailPage=await autonomy.taskSources(worldId,id,undefined,50)
      let last=tailPage.entries.at(-1).messageId,walk=tailPage.cursor
      while(walk){const page=await autonomy.taskSources(worldId,id,walk);last=page.entries.at(-1).messageId;walk=page.cursor}
      await operation.transaction(tx=>tx.execute(tailTag,[worldId,last,tag.grantId,tag.instanceId,tag.moduleId,tag.revision,tag.fingerprint]))
      progress('denied-tail')
      await rejects(()=>autonomy.claim(worldId,id,1800000,lease.leaseUntil),'TASK_SOURCE_SCOPE')
      check((await autonomy.taskHeader(worldId,id)).state==='pending','TASK_DENIED_PARTIAL')
      await operation.transaction(tx=>tx.execute(clearTail,[worldId,last]))
      progress('claim')
      const claimed=await autonomy.claim(worldId,id,1800000,lease.leaseUntil)
      check(claimed.attempt===1&&claimed.sourceCount===size&&!Object.hasOwn(claimed,'sourceRefs'),'TASK_CLAIM_HEADER')
      await rejects(()=>autonomy.taskSources(worldId,id,first),'CURSOR_STALE')
      const faulted=createKanataSqliteDomains({transaction:action=>operation.transaction(async tx=>{
        const result=await action(tx);await tx.execute(commitFault,['task-orphan','missing-card',1,'{}','{}','synthetic']);return result
      })},tools).autonomy
      await rejects(()=>faulted.finish(worldId,id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'}),'TRANSACTION_FAILED')
      check((await autonomy.taskHeader(worldId,id)).state==='running','TASK_COMMIT_PARTIAL')
      if(size===1000){
        const done=await autonomy.finish(worldId,id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
        const retry=await autonomy.finish(worldId,id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
        check(done.state==='failed'&&JSON.stringify(done)===JSON.stringify(retry),'TASK_FINISH_RETRY')
      }
      check(maxRows<=51&&maxText<=4097&&fullDtos===0,'TASK_BRIDGE_BOUND')
      results.push({size,sources,events,chunks,maxRows,maxText,fullDtos,deniedTail:true,realCommitRollback:true,elapsedMs:Math.round(performance.now()-started)})
      progress('complete')
    }
    window.taskReadPhase={phase:'permission-matrix'}
    const permissions=await taskPermissions(operation,fixture)
    return {status:'PASS',health,proofIndex,results,permissions,realModelCalls:0}
  })
}

// Use only the existing public writes and registered sourceLinks fixture SQL.
// Every tag carries the actual current grant revision; a denied flag therefore
// cannot pass merely because an unrelated stale grant already blocked it.
export async function taskPermissions(operation,fixture){
  const sample=fixture.messages[0],worldId=sample.worldId,origin=sample.lifeSources[0].instanceId
  const receiver=fixture.instances.find(row=>row.worldId===worldId&&row.id!==origin).id
  const group=fixture.conversations.find(row=>row.worldId===worldId&&row.type==='group').id
  const autonomy=createKanataSqliteDomains(operation,tools).autonomy
  const messages=createKanataMessageRepository(operation,tools)
  const cases=[
    {name:'private-owner-no-share',origin:[true,true,false]},
    {name:'private-owner-read-denied',origin:[false,true,false],error:'LIFE_PERMISSION_DENIED'},
    {name:'private-owner-remember-denied',origin:[true,false,false],error:'LIFE_PERMISSION_DENIED'},
    {name:'proactive-only-read',origin:[true,false,false],kind:'proactive'},
    {name:'group-origin-share-denied',origin:[true,true,false],group:true,error:'LIFE_PERMISSION_DENIED'},
    {name:'group-origin-allowed',origin:[true,true,true],group:true},
    {name:'group-receiver-allowed',origin:[true,true,true],receiver:[true,true,true],group:true},
    {name:'group-receiver-remember-denied-parent-chain',origin:[true,true,true],receiver:[true,false,true],group:true,derived:true,error:'LIFE_PERMISSION_DENIED'},
    {name:'group-receiver-share-denied',origin:[true,true,true],receiver:[true,true,false],group:true,error:'LIFE_PERMISSION_DENIED'},
    {name:'group-receiver-read-denied',origin:[true,true,true],receiver:[false,true,true],group:true,error:'LIFE_PERMISSION_DENIED'},
    {name:'private-non-member',origin:[true,true,true],receiver:[true,true,true],error:'TASK_SOURCE_SCOPE'},
  ]
  const results=[]
  for(const [index,entry]of cases.entries()){
    window.taskReadPhase={phase:'permission-matrix',case:entry.name}
    const flags=values=>({read:values[0],remember:values[1],share:values[2]})
    const previous=await autonomy.getGrant(worldId,origin,'todo')
    const grant=await autonomy.setGrant(worldId,origin,'todo',previous.revision,flags(entry.origin))
    if(entry.receiver){
      const before=await autonomy.getGrant(worldId,receiver,'todo')
      await autonomy.setGrant(worldId,receiver,'todo',before?.revision??null,flags(entry.receiver))
    }
    const conversationId=entry.group?group:sample.conversationId,id='task-permission-'+index
    const root={...sample,id:id+'-root',conversationId,revision:1,content:'仅合成权限来源',
      lifeSources:[{grantId:grant.id,revision:grant.revision,instanceId:origin,moduleId:'todo',fingerprint:'e'.repeat(64)}]}
    await messages.insert(root)
    let sourceId=root.id
    if(entry.derived){
      sourceId=id+'-child'
      await messages.insert({...fixture.messages[1],id:sourceId,conversationId,revision:1,
        replyToMessageId:root.id,replyToRevision:1,lifeSources:[]})
    }
    await autonomy.enqueue({id,worldId,kind:entry.kind??'world',state:'pending',idempotencyKey:id,sourceRevision:1,
      sourceRefs:[],resultEventIds:[],attempt:0,notBefore:0,leaseUntil:0,
      ...(entry.name!=='private-non-member'&&{conversationId}),instanceId:entry.receiver?receiver:origin})
    await operation.transaction(tx=>tx.execute(sourceLinks,[id,worldId,sourceId]))
    if(entry.error){
      await rejects(()=>autonomy.claim(worldId,id,1800000,1800100),entry.error)
      check((await autonomy.taskHeader(worldId,id)).state==='pending','TASK_PERMISSION_PARTIAL')
    }else{
      const claimed=await autonomy.claim(worldId,id,1800000,1800100)
      check(claimed.state==='running'&&claimed.sourceCount===1,'TASK_PERMISSION_ALLOWED')
    }
    results.push({name:entry.name,result:entry.error??'allowed',tagRevision:grant.revision})
  }
  return results
}

let crash='idle'
export const taskCrashState=()=>crash
export function armTaskCrash(candidate,worldId){
  crash='idle'
  void candidate.run({},async operation=>{
    const autonomy=createKanataSqliteDomains({transaction:action=>operation.transaction(tx=>action({query:tx.query,execute:async(sql,args)=>{
      const result=await tx.execute(sql,args)
      if(sql.startsWith('UPDATE background_tasks SET state=?')){crash='task-finish-uncommitted';await new Promise(()=>{})}
      return result
    }}))},tools).autonomy
    await autonomy.finish(worldId,taskId(10000),lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
  }).catch(error=>{crash=error.code??error.message})
  return 'armed'
}
export async function recoverTaskCrash(candidate,worldId){
  return candidate.run({},async operation=>{
    const autonomy=createKanataSqliteDomains(operation,tools).autonomy,id=taskId(10000)
    const before=await autonomy.taskHeader(worldId,id)
    check(before.state==='running'&&before.attempt===1,'TASK_CRASH_PARTIAL')
    const after=await autonomy.finish(worldId,id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
    const retry=await autonomy.finish(worldId,id,lease,{status:'failed',errorCode:'SYNTHETIC_FAILURE'})
    check(after.state==='failed'&&JSON.stringify(after)===JSON.stringify(retry),'TASK_CRASH_RETRY')
    return {before:before.state,after:after.state,sourceCount:after.sourceCount,idempotentRetry:true}
  })
}
