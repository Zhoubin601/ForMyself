import { createKanataSqliteDomains } from '../../../../../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { createKanataMessageRepository } from '../../../../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { actionCases,historicalAction } from '../../../../../../tests/helpers/kanataEventCompatibilityOracle.js'
import { previewKanataEventRevoke } from '../../../../../../src/features/chat/experience/kanataEvents.js'

export const actionFixtureWrite='UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?'
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
  check(maxRows<=128&&fullEventReads===0,'EVENT_CONSUMER_BOUNDS_'+JSON.stringify({maxRows,fullEventReads}))
  return {status:'PASS',samples,maxRows,maxChunk,fullEventReads,
    graph:{nodes:35,shuffled:true,revokedNoop:true,staleWorld:true}}
  })
}
