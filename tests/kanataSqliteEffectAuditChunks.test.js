import assert from 'node:assert/strict'
import test from 'node:test'
import {eventCompatFixture} from './helpers/kanataEventCompatFixture.js'
import {testEvent} from './helpers/kanataEventCompatibilityOracle.js'
import {eventPlanDdl} from '../src/features/chat/storage/sqlite/kanataEventPlanOrder.js'
import {eventRevocationWrites} from '../src/features/chat/storage/sqlite/kanataEventRevocation.js'

test('E complete audit query plan fits the existing native 256-row metadata gate',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  for(const sql of eventPlanDdl)h.db.exec(sql)
  const rows=h.db.prepare('EXPLAIN QUERY PLAN '+eventRevocationWrites[1]).all(h.worldId,'[]','synthetic')
  assert.ok(rows.length>0&&rows.length<=256,`complete plan has ${rows.length} rows`)
})

test('E audit staging preserves the existing unsupported-path rejection and atomic rollback',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const events=h.domains.events
  const {id}=await events.proposeAcknowledged(h.fields,'unsupported-audit-path')
  await events.commitAcknowledged(h.worldId,id,1)
  h.db.prepare(`INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
    VALUES('future-audit-effect',?,?,'instance',?,?,'set','future.unsupported','"synthetic"',1)`)
    .run(h.worldId,id,h.instanceId,h.instanceId)
  const plan=(await events.openRevocation(h.worldId,id)).plan
  await assert.rejects(()=>events.confirmRevocation(plan,undefined,'unsupported-path-confirm'),/EVENT_EFFECT_PATH_UNSUPPORTED/)
  assert.equal((await events.managedEvent(h.worldId,id)).revision,2)
  assert.equal((await events.revocationAudits(h.worldId,id)).entries.length,0)
})

test('E actual revocation freezes each owned Effect target before/after, owner revisions and command',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const events=h.domains.events
  const move=location=>({...h.fields,kind:'move',action:{instanceId:h.instanceId,location}})
  const a=await events.proposeAcknowledged(move('保留甲'),'effect-before-a')
  await events.commitAcknowledged(h.worldId,a.id,1)
  const b=await events.proposeAcknowledged(move('撤销乙'),'effect-before-b')
  await events.commitAcknowledged(h.worldId,b.id,1)
  const plan=(await events.openRevocation(h.worldId,b.id)).plan
  await events.confirmRevocation(plan,undefined,'effect-before-confirm')
  const audit=(await events.revocationAudits(h.worldId,b.id)).entries[0]
  const item=(await events.revocationEffectAudit(h.worldId,b.id,audit.id)).entries[0]
  assert.equal(item.before,'撤销乙')
  assert.equal(item.after,'保留甲')
  assert.equal(item.ownerRevision,2)
  assert.equal(item.nextOwnerRevision,3)
  assert.ok(item.idempotencyKey.includes('effect-before-confirm'))
  const frozen=JSON.stringify(item)
  const c=await events.proposeAcknowledged({...move('后续丙'),effectiveAt:5000},'effect-later-c')
  await events.commitAcknowledged(h.worldId,c.id,1)
  const d=await events.proposeAcknowledged(move('较早时间的后提交'),'effect-later-d')
  await events.commitAcknowledged(h.worldId,d.id,1)
  await events.confirmRevocation((await events.openRevocation(h.worldId,d.id)).plan,undefined,'effect-before-d')
  const laterAudit=(await events.revocationAudits(h.worldId,d.id)).entries[0]
  const later=(await events.revocationEffectAudit(h.worldId,d.id,laterAudit.id)).entries[0]
  assert.equal(later.before,'后续丙')
  assert.equal(later.after,'后续丙')
  await events.confirmRevocation(plan,undefined,'effect-before-confirm')
  assert.equal(JSON.stringify((await events.revocationEffectAudit(h.worldId,b.id,audit.id)).entries[0]),frozen)
  for(const table of ['kanata_effect_audit_before','kanata_event_audit_plan']){
    assert.equal(h.db.prepare('SELECT count(*) AS total FROM temp.'+table).get().total,0)
  }
})

test('E frozen Effect audit pages preserve array order and stream long path/value/before/after',async t=>{
  const h=await eventCompatFixture();t.after(h.close)
  const events=h.domains.events
  const {id}=await events.proposeAcknowledged(h.fields,'audit-chunk')
  const previous=await testEvent(h.db,h.worldId,id)
  const audit={id:'synthetic-long-effect-audit'}
  const ownedEffects=Array.from({length:55},(_,i)=>({id:'frozen-'+(55-i),targetType:'instance',targetId:h.instanceId,
    operation:'set',ruleVersion:1,path:'long-path-'+i+'界😀\ud800'.repeat(1000),
    value:'value-'+i+'😀界\udc00'.repeat(1200),before:{old:'旧😀\ud800'.repeat(1500)},after:{new:'新😀\udc00'.repeat(1500)}}))
  h.db.prepare("UPDATE world_events SET status='revoked',revision=2 WHERE world_id=? AND id=?").run(h.worldId,id)
  h.db.prepare(`INSERT INTO event_audits(id,world_id,event_id,at,previous_revision,next_revision,previous_json,next_json,extensions_json)
    VALUES(?,?,?,1800001,1,2,?,?,?)`).run(audit.id,h.worldId,id,JSON.stringify(previous),
      JSON.stringify({...previous,status:'revoked',revision:2}),
      JSON.stringify({revocationSignature:'synthetic-frozen',ownedEffectCount:55,ownedEffects}))
  let cursor,seen=[],maxRows=0,maxPart=0
  const query=h.tx.query
  h.tx.query=async(sql,args)=>{const rows=await query(sql,args);maxRows=Math.max(maxRows,rows.length);return rows}
  const first=await events.revocationEffectAudit(h.worldId,id,audit.id,undefined,7)
  assert.ok(first.entries.every(entry=>entry.snapshotChunked&&entry.pathChunked&&entry.valueChunked&&entry.beforeChunked&&entry.afterChunked))
  assert.ok(first.entries.every(entry=>JSON.stringify(entry).length<4096&&!Object.hasOwn(entry,'value')))
  do{
    const page=await events.revocationEffectAudit(h.worldId,id,audit.id,cursor,7)
    assert.ok(page.entries.length<=7);seen.push(...page.entries.map(row=>row.id));cursor=page.cursor
  }while(cursor)
  assert.deepEqual(seen,ownedEffects.map(row=>row.id))
  for(const field of ['path','value','before','after','snapshot']){
    let continuation,text='',firstCursor
    do{
      const part=await events.revocationEffectAuditChunk(h.worldId,id,audit.id,ownedEffects[0].id,field,continuation)
      maxPart=Math.max(maxPart,Array.from(part.part).length);text+=part.part
      continuation=part.cursor;firstCursor??=continuation
    }while(continuation)
    assert.deepEqual(JSON.parse(text),field==='snapshot'?ownedEffects[0]:ownedEffects[0][field])
    assert.ok(firstCursor)
    await assert.rejects(()=>events.revocationEffectAuditChunk(h.worldId,id,audit.id,ownedEffects[1].id,field,firstCursor),/CURSOR_STALE/)
    await assert.rejects(()=>events.revocationEffectAuditChunk(h.worldId,id,audit.id,ownedEffects[0].id,field,{...firstCursor,offset:-1}),/CURSOR_STALE/)
  }
  assert.ok(maxRows<=8&&maxPart<=4096)
  await assert.rejects(()=>events.revocationEffectAudit(h.worldId,id,audit.id,{...first.cursor,after:'frozen-1'}),/CURSOR_STALE/)
  await assert.rejects(()=>events.revocationEffectAuditChunk(h.worldId,id,audit.id,ownedEffects[0].id,'unknown'),/FIELD_INVALID/)
  assert.throws(()=>h.db.prepare('UPDATE event_audits SET next_revision=next_revision+1 WHERE id=?').run(audit.id),/AUDIT_IMMUTABLE/)
  await assert.rejects(()=>events.revocationEffectAudit(h.worldId,id,audit.id,{...first.cursor,signature:'other'}),/CURSOR_STALE/)
})
