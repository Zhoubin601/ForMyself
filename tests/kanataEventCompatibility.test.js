import assert from 'node:assert/strict'
import test from 'node:test'
import { actionCases,historicalAction,historicalEvent,historicalSelection,historicalExtensions } from './helpers/kanataEventCompatibilityOracle.js'
import { eventCompatFixture } from './helpers/kanataEventCompatFixture.js'
import { createKanataSqliteWorldRuntime } from '../src/application/kanataSqliteWorldRuntime.js'
import { previewKanataEventRevoke,revokeKanataEvent } from '../src/features/chat/experience/kanataEvents.js'

test('ER1 application exposes bounded event capabilities without the unused legacy wrapper',()=>{
  const runtime=createKanataSqliteWorldRuntime({candidate:{withDomains:async()=>{throw new Error('unexpected I/O')}}})
  const model=runtime.select('synthetic-world')
  assert.equal(Object.hasOwn(model,'legacyEvents'),false)
  for(const name of ['proposeEventAcknowledged','commitEventAcknowledged','eventDetail','openRevocation',
    'confirmRevocation','correctConfirmedEvent','eventReadFor','eventRelations','eventEffects','eventAudits','eventJsonChunk']){
    assert.equal(typeof model[name],'function',name)
  }
  runtime.dispose()
})

test('ER1 independent historical action Oracle freezes code units, presence, scalar deletion and property order',()=>{
  const columns={action_instance_id:null,action_relationship_id:null,action_location:null}
  for(const [name,input] of actionCases){
    const raw=name==='missing'?{}:{action:input}
    const actual=historicalAction(raw,columns)
    const expected=name==='missing'?{}:name==='object'?{action:{'2':'two','10':'ten',future:null}}:{action:{...input}}
    assert.deepEqual(actual,expected,name)
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(actual))),JSON.stringify(actual),name)
  }
  assert.equal(JSON.stringify(historicalAction({action:'😀'},columns)),
    '{"action":{"0":"\\ud83d","1":"\\ude00"}}')
  assert.deepEqual(historicalAction({action:{location:'old',instanceId:'old',future:3}},columns),{action:{future:3}})
  assert.equal(JSON.stringify(historicalAction({action:{'10':'x','2':'y',location:'old',future:3}},
    {...columns,action_location:'new',action_instance_id:'actor'})),
    '{"action":{"2":"y","10":"x","location":"new","future":3,"instanceId":"actor"}}')
})

test('ER1 independent adapter Oracle matches frozen historical reads before Facade migration',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  for(const [name,input] of actionCases){
    const {id}=await h.domains.events.proposeAcknowledged(h.fields,'oracle-'+name)
    const raw={participantIds:[h.instanceId],causedByEventIds:[],sourceRefs:[],future:{null:null,text:'未知😀'}}
    if(name!=='missing')raw.action=input
    h.db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?').run(JSON.stringify(raw),h.worldId,id)
    const expected=await historicalEvent(h.tx,h.worldId,id)
    const actual=(await h.domains.events.legacy.list(h.worldId)).events.find(e=>e.id===id)
    assert.deepEqual(actual,expected,name)
    assert.equal(JSON.stringify(actual),JSON.stringify(expected),name+' property order')
    await h.domains.events.commitAcknowledged(h.worldId,id,1)
    const audit=h.db.prepare('SELECT previous_json,next_json FROM event_audits WHERE world_id=? AND event_id=?').get(h.worldId,id)
    assert.deepEqual(JSON.parse(audit.previous_json),expected,name+' commit previous')
    assert.deepEqual(JSON.parse(audit.next_json),{...expected,status:'committed',revision:2},name+' commit next')
  }
  const root=await h.domains.events.proposeAcknowledged(h.fields,'selection-root')
  const child=await h.domains.events.proposeAcknowledged({...h.fields,causedByEventIds:[root.id]},'selection-child')
  h.db.prepare("UPDATE world_events SET status='revoked' WHERE world_id=? AND id=?").run(h.worldId,child.id)
  const independent=await historicalSelection(h.tx,h.worldId,root.id)
  const old=await h.domains.events.legacy.preview(h.worldId,root.id)
  assert.deepEqual(independent,{revokeIds:old.revokeIds,uncertainIds:old.uncertainIds})
  assert.deepEqual(independent.revokeIds,[root.id,child.id])
})

test('ER1 product authority freezes domain traversal, world signature and revoked descendant no-op',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const event=(id,causes=[],status='committed',causality='explicit')=>({...h.fields,id,
    causedByEventIds:causes,status,causality,revision:1,recordedAt:1800000})
  const root=event('authority-root')
  const child=event('authority-child',[root.id])
  const grandchild=event('authority-grandchild',[child.id],'revoked')
  const sibling=event('authority-sibling',[root.id])
  const uncertainZ=event('authority-z',[],'committed','unknown')
  const uncertainA=event('authority-a',[],'committed','unknown')
  const data={...h.fixture,events:[...h.fixture.events,root,grandchild,sibling,child,uncertainZ,uncertainA]}
  const plan=previewKanataEventRevoke(data,root.id)
  assert.deepEqual(plan.revokeIds,[root.id,sibling.id,child.id,grandchild.id])
  assert.deepEqual(plan.uncertainIds.slice(-2),[uncertainZ.id,uncertainA.id])
  const change=mutate=>{
    const next=JSON.parse(JSON.stringify(data));mutate(next)
    assert.notEqual(previewKanataEventRevoke(next,root.id).signature,plan.signature)
  }
  change(next=>{next.events.push(event('authority-unrelated'))})
  change(next=>{next.events.find(e=>e.id===uncertainA.id).summary='变更'})
  change(next=>{next.events.find(e=>e.id===root.id).future={unknown:null}})
  change(next=>{next.effects.push({worldId:h.worldId,id:'signature-effect',unknown:null})})
  change(next=>{next.effectBaselines.push({worldId:h.worldId,id:'signature-baseline',unknown:null})})
  const next=revokeKanataEvent(data,plan,'keep-independent',{id:()=>crypto.randomUUID(),clock:()=>1800001})
  assert.deepEqual(next.events.find(e=>e.id===grandchild.id),grandchild)
  assert.equal(next.eventAudits.some(a=>a.eventId===grandchild.id),false)
})

test('ER1 adapter Oracle independently retains the frozen JSON depth, finite numbers and inert keys',()=>{
  for(const raw of ['[]','null','1','{"future":1e999}'])assert.throws(()=>historicalExtensions(raw),/INTEGRITY_FAILED/)
  const nested=depth=>'['.repeat(depth)+'0'+']'.repeat(depth)
  assert.doesNotThrow(()=>historicalExtensions('{"future":'+nested(63)+'}'))
  assert.throws(()=>historicalExtensions('{"future":'+nested(64)+'}'),/INTEGRITY_FAILED/)
  const inert=historicalExtensions('{"__proto__":{"future":true},"value":-0}')
  assert.equal(Object.hasOwn(inert,'__proto__'),true)
  assert.equal(Object.is(inert.value,-0),false)
  assert.equal(Object.getPrototypeOf(inert),Object.prototype)
})
