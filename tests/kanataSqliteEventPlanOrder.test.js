import assert from 'node:assert/strict'
import test from 'node:test'
import { previewKanataEventRevoke, revokeKanataEvent } from '../src/features/chat/experience/kanataEvents.js'
import { createKanataSqliteDomains } from '../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { eventCompatFixture } from './helpers/kanataEventCompatFixture.js'

async function seed(h,events){
  await h.operation.transaction(async tx=>{
    await tx.execute('PRAGMA defer_foreign_keys=ON')
    for(const e of events){
      const extensions={participantIds:e.participantIds,causedByEventIds:e.causedByEventIds,sourceRefs:e.sourceRefs,
        ...(e.action!==undefined&&{action:e.action})}
      await tx.execute(`INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,
        causality,kind,action_instance_id,action_location,extensions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [e.id,e.worldId,e.status,e.visibility,e.summary,e.effectiveAt,e.recordedAt,e.revision,e.causality,e.kind,
        e.action?.instanceId??null,e.action?.location??null,JSON.stringify(extensions)])
      for(const id of e.participantIds)await tx.execute('INSERT INTO event_participants VALUES(?,?,?)',[e.worldId,e.id,id])
      for(const id of e.causedByEventIds)await tx.execute('INSERT INTO event_causes VALUES(?,?,?)',[e.worldId,e.id,id])
    }
  })
}
const event=(h,id,causes=[],extra={})=>({...h.fields,id,causedByEventIds:causes,status:'committed',revision:1,recordedAt:1500,...extra})

test('E prompt context follows retained array order after physical rowids change',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const ids=[]
  for(let i=0;i<4;i++){
    const {id}=await h.domains.events.proposeAcknowledged({...h.fields,summary:'context-'+i},'context-'+i)
    await h.domains.events.commitAcknowledged(h.worldId,id,1);ids.push(id)
  }
  const read=async()=> (await h.domains.events.context(h.worldId,{instanceId:h.instanceId,group:false},[]))
    .events.filter(e=>ids.includes(e.id)).map(e=>e.id)
  const before=await read()
  assert.deepEqual(before,ids)
  h.db.prepare('UPDATE world_events SET rowid=(SELECT max(rowid)+1 FROM world_events) WHERE id=?').run(ids[0])
  assert.deepEqual(await read(),before)
})

test('E ordered preview matches pure-domain Set/data.events order on shuffled multi-parent DAGs', async t=>{
  let random=31
  const next=n=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n}
  for(let sample=0;sample<20;sample++){
    const h=await eventCompatFixture();t.after(h.close)
    const rows=[]
    for(let i=0;i<35;i++){
      const causes=i?new Set([next(i),next(i)]):new Set()
      rows.push(event(h,'graph-'+sample+'-'+i,[...causes].map(p=>'graph-'+sample+'-'+p),{
        status:i&&i%7===0?'revoked':'committed',causality:i%5===0?'unknown':'explicit',effectiveAt:1500+i%3,
      }))
    }
    for(let i=rows.length-1;i>0;i--){const j=next(i+1);[rows[i],rows[j]]=[rows[j],rows[i]]}
    await seed(h,rows)
    const data={...h.fixture,events:[...h.fixture.events,...rows]}
    const root='graph-'+sample+'-0', oracle=previewKanataEventRevoke(data,root)
    const actual={revoke:[],uncertain:[]};let cursor
    do{
      const page=await h.domains.events.openRevocation(h.worldId,root,cursor,7)
      for(const row of page.entries)actual[row.disposition].push(row.id)
      cursor=page.cursor
    }while(cursor)
    assert.deepEqual(actual.revoke,oracle.revokeIds)
    assert.deepEqual(actual.uncertain,oracle.uncertainIds)
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM temp.kanata_event_plan').get().n,0)
  }
})

test('E reverse causal chain keeps a bounded page and rolls failed plan work back to empty', async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const rows=Array.from({length:1000},(_,i)=>event(h,'reverse-'+i,i?['reverse-'+(i-1)]:[])).reverse()
  await seed(h,rows)
  const page=await h.domains.events.openRevocation(h.worldId,'reverse-0',undefined,50)
  assert.equal(page.plan.revokeCount,1000)
  assert.deepEqual(page.entries.map(row=>row.id),Array.from({length:50},(_,i)=>'reverse-'+i))
  const failing=createKanataSqliteDomains({...h.operation,transaction:action=>h.operation.transaction(tx=>action({
    ...tx,execute:async(sql,args)=>{
      const result=await tx.execute(sql,args)
      if(sql.startsWith('WITH RECURSIVE args(world,round)'))throw Error('CANCEL_ORDERED_PLAN')
      return result
    },
  }))},{id:()=> 'unused-id',clock:()=>1800000})
  await assert.rejects(failing.events.openRevocation(h.worldId,'reverse-0'),/CANCEL_ORDERED_PLAN/)
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM temp.kanata_event_plan').get().n,0)
  await assert.rejects(h.domains.events.openRevocation(h.worldId,'reverse-0',{plan:page.plan,after:'not-an-entry'}),/CURSOR_STALE/)
})

test('E execution matches pure-domain audit order, stale memory revisions and two-pass Effects replay', async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const root=event(h,'z-root',[],{kind:'move',action:{instanceId:h.instanceId,location:'root'},effectiveAt:1500})
  const child=event(h,'a-child',[root.id])
  const old=event(h,'b-old',[child.id],{status:'revoked'})
  const uncertain=event(h,'u-one',[],{kind:'move',action:{instanceId:h.instanceId,location:'uncertain'},causality:'unknown',effectiveAt:1502})
  const other=event(h,'u-two',[],{causality:'unknown',effectiveAt:1503})
  const rows=[uncertain,old,child,root,other]
  await seed(h,rows)
  const baseline={id:'plan-location-base',worldId:h.worldId,targetType:'instance',targetId:h.instanceId,path:'state.location',value:'before'}
  const effects=[root,old,uncertain].map(e=>({id:'plan-effect-'+e.id,worldId:h.worldId,eventId:e.id,targetType:'instance',targetId:h.instanceId,
    operation:'set',path:'state.location',value:e.id,ruleVersion:1}))
  const memory={id:'plan-memory',worldId:h.worldId,ownerType:'world',ownerId:h.worldId,layer:'L3',key:'plan-memory',content:'synthetic',
    sourceRefs:[],sourceEventIds:[root.id,uncertain.id],status:'stale',revision:1,visibility:'public'}
  await h.operation.transaction(async tx=>{
    await tx.execute(`INSERT INTO effect_baselines(id,world_id,target_type,target_id,target_instance_id,path,value_json)
      VALUES(?,?,'instance',?,?,'state.location',?)`,[baseline.id,h.worldId,h.instanceId,h.instanceId,JSON.stringify(baseline.value)])
    for(const f of effects)await tx.execute(`INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
      VALUES(?,?,?,'instance',?,?,'set','state.location',?,1)`,[f.id,h.worldId,f.eventId,h.instanceId,h.instanceId,JSON.stringify(f.value)])
    await tx.execute(`INSERT INTO memories(id,world_id,owner_type,owner_id,layer,memory_key,content,status,revision,visibility)
      VALUES(?,?,'world',?,'L3',?,'synthetic','stale',1,'public')`,[memory.id,h.worldId,h.worldId,memory.key])
    for(const id of memory.sourceEventIds)await tx.execute('INSERT INTO memory_events VALUES(?,?,?)',[h.worldId,memory.id,id])
  })
  const data={...h.fixture,events:[...h.fixture.events,...rows],effects:[...h.fixture.effects,...effects],
    effectBaselines:[...h.fixture.effectBaselines,baseline],memories:[...h.fixture.memories,memory]}
  let sequence=0
  const oracle=revokeKanataEvent(data,previewKanataEventRevoke(data,root.id),'mark-needs-review',
    {id:()=> 'pure-'+(++sequence),clock:()=>1800000})
  const plan=(await h.domains.events.openRevocation(h.worldId,root.id)).plan
  await h.domains.events.confirmRevocation(plan,'mark-needs-review','ordered-execution')
  const actual=h.db.prepare('SELECT event_id,previous_json,next_json FROM event_audits ORDER BY id').all()
    .filter(a=>rows.some(e=>e.id===a.event_id)).map(a=>({eventId:a.event_id,previous:JSON.parse(a.previous_json),next:JSON.parse(a.next_json)}))
  const expected=oracle.eventAudits.filter(a=>rows.some(e=>e.id===a.eventId)).map(({eventId,previous,next})=>({eventId,previous,next}))
  assert.deepEqual(actual,expected)
  assert.equal(h.db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,
    oracle.memories.find(m=>m.id===memory.id).revision)
  const instance=h.db.prepare('SELECT revision,location FROM character_instances WHERE id=?').get(h.instanceId)
  const expectedInstance=oracle.instances.find(i=>i.id===h.instanceId)
  assert.equal(instance.revision,expectedInstance.revision)
  assert.equal(instance.location,expectedInstance.state.location)
})
