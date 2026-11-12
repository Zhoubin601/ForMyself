import assert from 'node:assert/strict'
import test from 'node:test'
import { eventCompatFixture } from './helpers/kanataEventCompatFixture.js'
import { actionCases,historicalEvent } from './helpers/kanataEventCompatibilityOracle.js'
import { createKanataMessageRepository } from '../src/features/chat/storage/sqlite/kanataMessageRepository.js'

test('E all four business writes preserve historical action without an Event materializer',async t=>{
  for(const [name,input] of [...actionCases,['boolean',true],['number',7],['control','\u0000\b\f\n\r\t"\\/'],
    ['large','x😀界\ud800y\udc00'.repeat(1000)]]){
    const h=await eventCompatFixture();t.after(h.close)
    const {events}=h.domains
    const make=async(key,source)=>{
      const fields={...h.fields,...(source&&{sourceRefs:[{messageId:source.id,revision:source.revision}]})}
      const {id}=await events.proposeAcknowledged(fields,key)
      const raw={participantIds:fields.participantIds,sourceRefs:fields.sourceRefs,causedByEventIds:[],future:{kept:true}}
      if(name!=='missing')raw.action=input
      h.db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?').run(JSON.stringify(raw),h.worldId,id)
      return {id,expected:await historicalEvent(h.tx,h.worldId,id)}
    }
    const committed=await make('commit'),revoked=await make('revoke'),corrected=await make('correct')
    let sequence=0
    const messages=createKanataMessageRepository(h.operation,{id:()=>`message-action-${++sequence}`,clock:()=>1800001})
    const message={...h.fixture.messages.find(m=>m.worldId===h.worldId),id:'action-source',revision:1}
    delete message.lifeSources
    await messages.insert(message)
    const revised=await make('revise',message)
    const originalQuery=h.tx.query
    h.tx.query=async(sql,args)=>{
      assert.doesNotMatch(sql,/SELECT id,world_id,status,visibility,summary|SELECT substr\(extensions_json/,
        name+' must not materialize a full Event')
      const rows=await originalQuery(sql,args);assert.ok(rows.length<=128);return rows
    }
    await events.commitAcknowledged(h.worldId,committed.id,1)
    await events.confirmRevocation((await events.openRevocation(h.worldId,revoked.id)).plan,undefined,'revoke')
    await events.commitAcknowledged(h.worldId,corrected.id,1)
    const correction=await events.correctConfirmed((await events.openRevocation(h.worldId,corrected.id)).plan,
      undefined,'correct','更正')
    await messages.revise({worldId:h.worldId,conversationId:message.conversationId},message.id,message.revision,
      {content:'合成修订',deleted:false})
    for(const [event,status] of [[committed,'committed'],[revoked,'revoked'],[revised,'needsReview']]){
      const audit=h.db.prepare('SELECT previous_json,next_json FROM event_audits WHERE world_id=? AND event_id=?').get(h.worldId,event.id)
      assert.deepEqual(JSON.parse(audit.previous_json),event.expected,name+' previous '+status)
      assert.deepEqual(JSON.parse(audit.next_json),{...event.expected,status,revision:2},name+' next '+status)
    }
    h.tx.query=originalQuery
    const replacement=await historicalEvent(h.tx,h.worldId,correction.id)
    assert.deepEqual(replacement,{...corrected.expected,id:correction.id,summary:'更正',recordedAt:1800000,
      replacesEventId:corrected.id},name+' correction')
  }
})
