import { createKanataSqliteDomains } from '../../../../../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { createKanataMessageRepository } from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import {eventWrites} from '../../../../../../src/features/chat/storage/sqlite/kanataEventRepository.js'
import { actionCases,historicalAction } from '../../../../../../tests/helpers/kanataEventCompatibilityOracle.js'
import { previewKanataEventRevoke } from '../../../../../../src/features/chat/experience/kanataEvents.js'

export const actionFixtureWrite='UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?'
export const longAuditFixtureWrites=[
  "UPDATE world_events SET status='revoked',revision=2 WHERE world_id=? AND id=?",
  `INSERT INTO event_audits(id,world_id,event_id,at,previous_revision,next_revision,previous_json,next_json,extensions_json)
    VALUES(?,?,?,1800001,1,2,?,?,?)`,
]
export const orderFixtureWrites=[
  `INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind,extensions_json)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.worldId'),json_extract(value,'$.status'),'private','合成顺序',1500,1500,1,
      json_extract(value,'$.causality'),'note',json_object('participantIds',json('[]'),'sourceRefs',json('[]'),
      'causedByEventIds',json_extract(value,'$.causedByEventIds')) FROM json_each(?) ORDER BY CAST(key AS INTEGER)`,
  `INSERT INTO event_causes(world_id,event_id,cause_event_id)
    SELECT json_extract(e.value,'$.worldId'),json_extract(e.value,'$.id'),c.value
    FROM json_each(?) e CROSS JOIN json_each(e.value,'$.causedByEventIds') c`,
]

// Only synthetic Oracles assemble snapshots. Production uses the actual bounded
// audit/chunk APIs below; no repository materializer is available to this probe.
export async function runEventSemanticsDevice(protectedCandidate,fixture,commands){
  return protectedCandidate.run({create:true},async operation=>{
  let maxRows=0,maxChunk=0,fullEventReads=0
  const guarded={transaction:action=>operation.transaction(tx=>action({execute:tx.execute,
    query:async(sql,args)=>{
      if(/SELECT id,world_id,status,visibility,summary/.test(sql))fullEventReads++
      const rows=await tx.query(sql,args);maxRows=Math.max(maxRows,rows.length);return rows
    }}))}
  const tools={id:()=>crypto.randomUUID(),clock:Date.now}
  const domains=createKanataSqliteDomains(guarded,tools)
  const messages=createKanataMessageRepository(guarded,tools)
  const candidate={run:(_,action)=>action(operation),withDomains:(_,action)=>action(domains),withRepositories:(_,action)=>action(messages)}
  const check=(condition,code)=>{if(!condition)throw Error(code)}
  const same=(a,b,code)=>check(JSON.stringify(a)===JSON.stringify(b),code)
  const worldId=fixture.worlds[0].id,instanceId=fixture.instances[0].id
  await candidate.run({create:true},op=>op.transaction(async tx=>{
    for(const {sql,parameters} of commands)await tx.execute(sql,parameters)
  }))
  const fields={worldId,participantIds:[instanceId],sourceRefs:[],causedByEventIds:[],visibility:'private',
    summary:'合成 action',effectiveAt:1500,kind:'note',causality:'explicit'}
  const chunked=async(events,id,selection)=>{
    let cursor,json=''
    do{
      const page=await events.jsonChunk(worldId,id,selection,null,cursor)
      maxChunk=Math.max(maxChunk,Array.from(page.part).length);check(maxChunk<=4096,'ACTION_CHUNK_LIMIT')
      json+=page.part;cursor=page.cursor
    }while(cursor)
    return JSON.parse(json)
  }
  const samples=[]
  for(const [name,input] of [...actionCases,['boolean',true],['number',7],['control','\u0000\b\f\n\r\t"\\/'],
    ['large','x😀界\ud800y\udc00'.repeat(1000)]]){
    await candidate.withDomains({},async domains=>{
      const events=domains.events
      const make=async(key,source)=>{
        const value={...fields,...(source&&{sourceRefs:[{messageId:source.id,revision:source.revision}]})}
        const {id}=await events.proposeAcknowledged(value,'action-'+name+'-'+key)
        const raw={participantIds:value.participantIds,sourceRefs:value.sourceRefs,causedByEventIds:[],future:{kept:true}}
        if(name!=='missing')raw.action=input
        await candidate.run({},op=>op.transaction(tx=>tx.execute(actionFixtureWrite,[JSON.stringify(raw),worldId,id])))
        return id
      }
      const ids={commit:await make('commit'),revoke:await make('revoke'),correct:await make('correct')}
      const message={...fixture.messages.find(m=>m.worldId===worldId),id:'action-source-'+name,revision:1}
      delete message.lifeSources
      await candidate.withRepositories({},repo=>repo.insert(message))
      ids.revise=await make('revise',message)
      await events.commitAcknowledged(worldId,ids.commit,1)
      await events.confirmRevocation((await events.openRevocation(worldId,ids.revoke)).plan,undefined,'action-revoke-'+name)
      await events.commitAcknowledged(worldId,ids.correct,1)
      const correction=await events.correctConfirmed((await events.openRevocation(worldId,ids.correct)).plan,
        undefined,'action-correct-'+name,'更正')
      await candidate.withRepositories({},repo=>repo.revise({worldId,conversationId:message.conversationId},message.id,1,
        {content:'合成修订',deleted:false}))
      const expected=historicalAction(name==='missing'?{}:{action:input},
        {action_instance_id:null,action_relationship_id:null,action_location:null})
      const assertAction=(actual,code)=>{
        same(actual.action,expected.action,code)
        check(Object.hasOwn(actual,'action')===Object.hasOwn(expected,'action'),code+'_PRESENCE')
      }
      for(const [path,status] of [['commit','committed'],['revoke','revoked'],['revise','needsReview']]){
        const audit=(await events.audits(worldId,ids[path])).entries[0]
        for(const [side,revision] of [['previous',1],['next',2]]){
          const body=await chunked(events,ids[path],{kind:'audit',auditId:audit.id,side,snapshotRevision:revision})
          assertAction(body,'ACTION_'+path+'_'+side+'_'+name)
          check(body.revision===revision&&body.status===(side==='previous'?'candidate':status),'ACTION_STATUS')
          same(body.future,{kept:true},'ACTION_UNKNOWN')
        }
      }
      assertAction(await chunked(events,correction.id,{kind:'extensions'}),'ACTION_CORRECTION_'+name)
      samples.push({name,writes:['commit','revoke','correction','message-revision']})
    })
  }
  // A shuffled multi-parent DAG exercises pure Set order and a revoked descendant.
  const graph=[]
  for(let i=0;i<35;i++)graph.push({id:'order-device-'+i,worldId,status:i===7?'revoked':'committed',
    causality:i%5===0?'unknown':'explicit',effectiveAt:1500,
    causedByEventIds:i?[...new Set([Math.floor((i-1)/2),i-1])].map(p=>'order-device-'+p):[]})
  const original=[...graph.filter((_,i)=>i%2),...graph.filter((_,i)=>i%2===0).reverse()]
  await candidate.run({},op=>op.transaction(async tx=>{
    for(const sql of orderFixtureWrites)await tx.execute(sql,[JSON.stringify(original)])
  }))
  const oracle=previewKanataEventRevoke({events:original,effects:[],effectBaselines:[]},'order-device-0')
  await candidate.withDomains({},async({events})=>{
    let cursor,ids=[]
    do{
      const page=await events.openRevocation(worldId,'order-device-0',cursor,7)
      check(page.entries.length<=7,'ORDER_PAGE_LIMIT')
      ids.push(...page.entries.filter(e=>e.disposition==='revoke').map(e=>e.id));cursor=page.cursor
    }while(cursor)
    same(ids,oracle.revokeIds,'ORDER_PURE_SET')
    const before=(await events.openRevocation(worldId,'order-device-0')).plan
    await events.proposeAcknowledged(fields,'world-signature-unrelated')
    let denied=false
    try{await events.confirmRevocation(before,'keep-independent','world-signature-stale')}
    catch(error){denied=(error.code??error.message)==='EVENT_REVOKE_PREVIEW_STALE'}
    check(denied,'WORLD_SIGNATURE_STALE')
    const plan=(await events.openRevocation(worldId,'order-device-0')).plan
    const result=await events.confirmRevocation(plan,'keep-independent','order-device-confirm')
    check(result.revoked===35,'ORDER_REVOKED_INCLUDED')
    const revoked=await events.managedEvent(worldId,'order-device-7')
    check(revoked.revision===1&&(await events.audits(worldId,'order-device-7')).entries.length===0,'ORDER_REVOKED_NOOP')
  })
  const actualEffectAudit=await candidate.withDomains({},async({events})=>{
    const move=location=>({...fields,kind:'move',action:{instanceId,location}})
    const a=await events.proposeAcknowledged(move('设备保留甲'),'actual-before-a')
    await events.commitAcknowledged(worldId,a.id,1)
    const b=await events.proposeAcknowledged(move('设备撤销乙'),'actual-before-b')
    await events.commitAcknowledged(worldId,b.id,1)
    const plan=(await events.openRevocation(worldId,b.id)).plan
    await events.confirmRevocation(plan,undefined,'actual-before-confirm')
    const audit=(await events.revocationAudits(worldId,b.id)).entries[0]
    const entry=(await events.revocationEffectAudit(worldId,b.id,audit.id)).entries[0]
    check(entry.before==='设备撤销乙'&&entry.after==='设备保留甲','ACTUAL_BEFORE_AFTER')
    check(entry.ownerRevision===2&&entry.nextOwnerRevision===3&&entry.idempotencyKey.includes('actual-before-confirm'),
      'ACTUAL_OWNER_COMMAND')
    await events.confirmRevocation(plan,undefined,'actual-before-confirm')
    same((await events.revocationEffectAudit(worldId,b.id,audit.id)).entries[0],entry,'ACTUAL_FROZEN_RECEIPT')
    return {before:entry.before,after:entry.after,ownerRevision:entry.ownerRevision,
      nextOwnerRevision:entry.nextOwnerRevision,commandBound:true,receiptStable:true}
  })
  const errorClassification=await candidate.withDomains({},async({events})=>{
    const {id}=await events.proposeAcknowledged(fields,'unknown-effect-audit')
    await events.commitAcknowledged(worldId,id,1)
    const sql=eventWrites.find(sql=>sql.startsWith('INSERT INTO world_effects('))
    check(sql,'UNKNOWN_EFFECT_SEED_SQL')
    await operation.transaction(tx=>tx.execute(sql,[worldId,'device-unknown-effect',id,'instance',instanceId,
      instanceId,null,'set','future.unsupported','"synthetic"',1]))
    const plan=(await events.openRevocation(worldId,id)).plan
    let code
    try{await events.confirmRevocation(plan,undefined,'unknown-effect-confirm')}
    catch(error){code=error.code??error.message}
    check(code==='EVENT_EFFECT_PATH_UNSUPPORTED','EFFECT_ERROR_CLASS_'+code)
    check((await events.managedEvent(worldId,id)).revision===2&&(await events.revocationAudits(worldId,id)).entries.length===0,
      'EFFECT_ERROR_ROLLBACK')
    return {code,rolledBack:true}
  })
  const longAudit=await candidate.withDomains({},async({events})=>{
    const {id}=await events.proposeAcknowledged(fields,'long-effect-audit')
    // Original synthetic fixture, not a mutation/backfill of an existing audit.
    let header,after=''
    do{const page=await events.list(worldId,after);header=page.events.find(row=>row.id===id);after=page.cursor}while(!header&&after)
    check(header,'LONG_AUDIT_OWNER')
    const previous={...fields,id,status:'candidate',revision:1,recordedAt:header.recordedAt}
    const long={path:'long-路径😀\ud800'.repeat(1000),value:'long-值😀\udc00'.repeat(1000),
      before:{old:'旧😀\ud800'.repeat(1000)},after:{new:'新😀\udc00'.repeat(1000)}}
    const records=Array.from({length:55},(_,index)=>({id:'device-frozen-'+(55-index),targetType:'instance',
      targetId:instanceId,operation:'set',ruleVersion:1,...(index===0||index===54?long:{path:'state.location',value:'合成'})}))
    const auditId='device-long-frozen-audit'
    await operation.transaction(async tx=>{
      await tx.execute(longAuditFixtureWrites[0],[worldId,id])
      await tx.execute(longAuditFixtureWrites[1],[auditId,worldId,id,JSON.stringify(previous),
        JSON.stringify({...previous,status:'revoked',revision:2}),
        JSON.stringify({revocationSignature:'device-frozen',ownedEffectCount:55,ownedEffects:records})])
    })
    let cursor,ids=[]
    do{const page=await events.revocationEffectAudit(worldId,id,auditId,cursor,7)
      check(page.entries.length<=7,'LONG_AUDIT_PAGE_LIMIT');ids.push(...page.entries.map(row=>row.id));cursor=page.cursor
    }while(cursor)
    same(ids,records.map(row=>row.id),'LONG_AUDIT_ARRAY_ORDER')
    let chunks=0
    for(const field of ['path','value','before','after','snapshot']){
      let continuation,json=''
      do{const piece=await events.revocationEffectAuditChunk(worldId,id,auditId,records[0].id,field,continuation)
        const length=Array.from(piece.part).length;maxChunk=Math.max(maxChunk,length)
        check(length<=4096,'LONG_AUDIT_CHUNK_LIMIT');chunks++;json+=piece.part;continuation=piece.cursor
      }while(continuation)
      same(JSON.parse(json),field==='snapshot'?records[0]:records[0][field],'LONG_AUDIT_'+field)
    }
    return {records:55,chunks,fields:['path','value','before','after','snapshot'],arrayOrder:true}
  })
  check(maxRows<=128&&fullEventReads===0,'EVENT_CONSUMER_BOUNDS_'+JSON.stringify({maxRows,fullEventReads}))
  return {status:'PASS',samples,maxRows,maxChunk,fullEventReads,
    graph:{nodes:35,shuffled:true,revokedNoop:true,staleWorld:true},actualEffectAudit,longAudit,errorClassification}
  })
}
