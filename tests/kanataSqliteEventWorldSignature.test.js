import assert from 'node:assert/strict'
import test from 'node:test'
import { eventWorldSignature } from '../src/features/chat/storage/sqlite/kanataEventWorldSignature.js'
import { eventCompatFixture } from './helpers/kanataEventCompatFixture.js'

test('E full-world signature detects unrelated Events, Effects, Baselines and normalized links', async t => {
  const h=await eventCompatFixture();t.after(h.close)
  const root=await h.domains.events.proposeAcknowledged(h.fields,'signature-root')
  const original=await eventWorldSignature(h.tx,h.worldId)
  const changes=[
    ["UPDATE world_events SET summary=summary||'x' WHERE id='event-independent'",[]],
    ["UPDATE world_events SET extensions_json=json_set(extensions_json,'$.future',json('{\"kept\":true}')) WHERE id='event-independent'",[]],
    ["UPDATE world_effects SET value_json=json_quote('changed') WHERE id='effect-independent'",[]],
    ["UPDATE world_effects SET extensions_json=json_set(extensions_json,'$.future',2) WHERE id='effect-independent'",[]],
    ["UPDATE effect_baselines SET value_json=json_quote('changed') WHERE id='baseline-one'",[]],
    ["UPDATE effect_baselines SET extensions_json=json_set(extensions_json,'$.future',2) WHERE id='baseline-one'",[]],
    ['INSERT INTO event_causes(world_id,event_id,cause_event_id) VALUES(?,?,?)',[h.worldId,root.id,'event-independent']],
  ]
  for(const [sql,args] of changes){
    let changed
    await assert.rejects(h.operation.transaction(async tx=>{
      await tx.execute(sql,args);changed=await eventWorldSignature(tx,h.worldId)
      throw Error('ROLL_BACK_SYNTHETIC_CHANGE')
    }),/ROLL_BACK_SYNTHETIC_CHANGE/)
    assert.notEqual(changed,original,sql)
    assert.equal(await eventWorldSignature(h.tx,h.worldId),original)
  }
  h.db.prepare('UPDATE world_events SET rowid=(SELECT max(rowid)+1 FROM world_events) WHERE id=?').run(root.id)
  assert.equal(await eventWorldSignature(h.tx,h.worldId),original)
  const other=h.fixture.worlds.find(w=>w.id!==h.worldId)
  await h.domains.events.proposeAcknowledged({...h.fields,worldId:other.id,participantIds:[h.fixture.instances.find(i=>i.worldId===other.id).id]},'other-world-signature')
  assert.equal(await eventWorldSignature(h.tx,h.worldId),original)
})

test('E full-world signature streams oversized Unicode extensions and releases cancelled work', async t => {
  const h=await eventCompatFixture();t.after(h.close)
  h.db.prepare("UPDATE world_events SET extensions_json=json_set(extensions_json,'$.future',?) WHERE id='event-independent'")
    .run('界😀\ud800'.repeat(10000))
  let maxRows=0,maxPart=0,chunked=0,largeInline=0
  const tx={...h.tx,async query(sql,args){
    const rows=await h.tx.query(sql,args);maxRows=Math.max(maxRows,rows.length)
    for(const row of rows){
      if(Object.hasOwn(row,'item')&&row.item!==null)largeInline+=Array.from(String(row.item)).length>4096?1:0
      if(Object.hasOwn(row,'part')){maxPart=Math.max(maxPart,Array.from(row.part).length);chunked++}
    }
    return rows
  }}
  const first=await eventWorldSignature(tx,h.worldId)
  assert.equal(await eventWorldSignature(tx,h.worldId),first)
  assert(maxRows<=50&&maxPart<=4096&&chunked>1&&largeInline===0)
  let queries=0
  await assert.rejects(eventWorldSignature({...h.tx,query:async(sql,args)=>{
    if(++queries===3)throw Error('CANCELLED_SIGNATURE')
    return h.tx.query(sql,args)
  }},h.worldId),/CANCELLED_SIGNATURE/)
  assert.equal(queries,3)
  assert.equal(await eventWorldSignature(h.tx,h.worldId),first)
})

test('E compact confirmation retains revoked descendants without repeating their revision or audit', async t => {
  const h=await eventCompatFixture();t.after(h.close)
  const e=h.domains.events
  const root=await e.proposeAcknowledged(h.fields,'no-op-root')
  await e.commitAcknowledged(h.worldId,root.id,1)
  const child=await e.proposeAcknowledged({...h.fields,causedByEventIds:[root.id]},'no-op-child')
  await e.commitAcknowledged(h.worldId,child.id,1)
  await e.confirmRevocation((await e.openRevocation(h.worldId,child.id)).plan,undefined,'child-first')
  const before=h.db.prepare('SELECT revision FROM world_events WHERE id=?').get(child.id).revision
  const audits=h.db.prepare('SELECT count(*) AS n FROM event_audits WHERE event_id=?').get(child.id).n
  const page=await e.openRevocation(h.worldId,root.id)
  assert.equal(page.plan.revokeCount,2)
  assert.deepEqual(page.entries.map(row=>row.id),[root.id,child.id])
  await e.confirmRevocation(page.plan,undefined,'root-second')
  assert.equal(h.db.prepare('SELECT revision FROM world_events WHERE id=?').get(child.id).revision,before)
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM event_audits WHERE event_id=?').get(child.id).n,audits)
})

test('E compact preview becomes stale after an unrelated event without applying old confirmation', async t => {
  const h=await eventCompatFixture();t.after(h.close)
  const e=h.domains.events
  const root=await e.proposeAcknowledged(h.fields,'unrelated-root')
  const page=await e.openRevocation(h.worldId,root.id)
  await e.proposeAcknowledged({...h.fields,summary:'unrelated'},'unrelated-new')
  await assert.rejects(e.confirmRevocation(page.plan,undefined,'old-plan'),/EVENT_REVOKE_PREVIEW_STALE/)
  assert.equal((await e.managedEvent(h.worldId,root.id)).status,'candidate')
})
