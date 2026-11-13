// An explicit acceptance probe. A reproduced incompatibility exits nonzero;
// the ordinary regression tests do not label known incompatible results PASS.
import assert from 'node:assert/strict'
import { eventCompatFixture } from '../../../../../tests/helpers/kanataEventCompatFixture.js'
import { actionCases,historicalEvent,historicalSelection } from '../../../../../tests/helpers/kanataEventCompatibilityOracle.js'
import { previewKanataEventRevoke,revokeKanataEvent } from '../../../../../src/features/chat/experience/kanataEvents.js'

let failures=0
const results=[]
async function compare(name,action){
  try{await action();results.push({name,status:'PASS'})}
  catch(error){failures++;results.push({name,status:'FAIL',message:error.message})}
}
const h=await eventCompatFixture()
try{
  // Raw synthetic SQLite rows, not real files, are the independent adapter input.
  const {worldId,fields,domains,tx,db}=h
  const {events}=domains
  await compare('revoked descendant is part of both old confirmation sets',async()=>{
    const root=await events.proposeAcknowledged(fields,'revoked-root')
    await events.commitAcknowledged(worldId,root.id,1)
    const child=await events.proposeAcknowledged({...fields,causedByEventIds:[root.id]},'revoked-child')
    await events.commitAcknowledged(worldId,child.id,1)
    await events.confirmRevocation((await events.openRevocation(worldId,child.id)).plan,undefined,'revoke-child')
    const old=await historicalSelection(tx,worldId,root.id)
    const pure=previewKanataEventRevoke({events:[await historicalEvent(tx,worldId,root.id),await historicalEvent(tx,worldId,child.id)],effects:[],effectBaselines:[]},root.id)
    assert.deepEqual(pure.revokeIds,old.revokeIds)
    const page=await events.openRevocation(worldId,root.id)
    console.log(JSON.stringify({case:'revoked-descendant',old:old.revokeIds,pure:pure.revokeIds,compact:page.entries.map(e=>e.id)}))
    assert.deepEqual(page.entries.filter(e=>e.disposition==='revoke').map(e=>e.id),old.revokeIds)
  })
  await compare('unrelated event invalidates old and compact preview equally',async()=>{
    const {id}=await events.proposeAcknowledged(fields,'stale-root')
    const compact=(await events.openRevocation(worldId,id)).plan
    await events.proposeAcknowledged({...fields,summary:'无关事件'},'unrelated')
    assert.notEqual(compact.signature,(await events.openRevocation(worldId,id)).plan.signature)
    await assert.rejects(()=>events.confirmRevocation(compact,'keep-independent','stale-confirm'),/STALE/)
  })
  for(const [name,input] of actionCases){
    await compare('revoke snapshot vs adapter action '+name,async()=>{
      const {id}=await events.proposeAcknowledged(fields,'action-'+name)
      const raw={participantIds:[h.instanceId],sourceRefs:[],causedByEventIds:[],future:{kept:true}}
      if(name!=='missing')raw.action=input
      db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?').run(JSON.stringify(raw),worldId,id)
      // Candidate root is valid in both old and compact contracts.
      const expected=await historicalEvent(tx,worldId,id)
      await events.confirmRevocation((await events.openRevocation(worldId,id)).plan,undefined,'action-revoke-'+name)
      const audit=db.prepare('SELECT previous_json,next_json FROM event_audits WHERE world_id=? AND event_id=?').get(worldId,id)
      assert.deepEqual(JSON.parse(audit.previous_json),expected)
      assert.deepEqual(JSON.parse(audit.next_json),{...expected,status:'revoked',revision:2})
    })
  }
  const sqlite=db.prepare('SELECT sqlite_version() AS version').get().version
  const spike=actionCases.filter(([,value])=>typeof value==='string').map(([name,value])=>{
    const json=JSON.stringify({action:value})
    const result=db.prepare("SELECT json_quote(json_extract(?,'$.action')) AS extracted,hex(json_extract(?,'$.action')) AS utf8, ? -> '$.action' AS raw").get(json,json,json)
    return {name,expected:JSON.stringify(value),...result,
      extractedEqual:result.extracted===JSON.stringify(value),rawEqual:result.raw===JSON.stringify(value)}
  })
  console.log(JSON.stringify({sqlite,utf16Spike:spike}))
  // Preserve both Oracles as separate facts: pure validation rejects historical
  // strings; the adapter accepts code-unit spread. It is not one interchangeable contract.
  for(const [name,input] of actionCases.filter(([,value])=>typeof value==='string'||value===null||Array.isArray(value))){
    await compare('pure domain rejects abnormal historical action '+name,async()=>{
      const data={...h.fixture,events:[...h.fixture.events,{...fields,id:'pure-action',status:'candidate',revision:1,recordedAt:1800000,action:input}]}
      const plan=previewKanataEventRevoke(data,'pure-action')
      assert.throws(()=>revokeKanataEvent(data,plan,undefined,{id:()=> 'pure-audit',clock:()=>1800001}),/INVALID_EVENT_ACTION/)
    })
  }
}finally{h.close()}
console.log(JSON.stringify({status:failures?'BLOCKED':'PASS',failures,results},null,2))
process.exitCode=failures?1:0
