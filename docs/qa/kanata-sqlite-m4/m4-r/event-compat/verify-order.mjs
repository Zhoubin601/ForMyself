import assert from 'node:assert/strict'
import { eventCompatFixture } from '../../../../../tests/helpers/kanataEventCompatFixture.js'
import { historicalEvent } from '../../../../../tests/helpers/kanataEventCompatibilityOracle.js'
import { previewKanataEventRevoke } from '../../../../../src/features/chat/experience/kanataEvents.js'
import { domainArrayOrderPage } from '../../../../../src/features/chat/storage/sqlite/kanataArrayOrder.js'

const h=await eventCompatFixture()
try{
  const {events}=h.domains
  const root=await events.proposeAcknowledged(h.fields,'order-root')
  const child=await events.proposeAcknowledged({...h.fields,causedByEventIds:[root.id]},'order-child')
  const grandchild=await events.proposeAcknowledged({...h.fields,causedByEventIds:[child.id]},'order-grandchild')
  const sibling=await events.proposeAcknowledged({...h.fields,causedByEventIds:[root.id]},'order-sibling')
  const ordered=await Promise.all([root,child,grandchild,sibling].map(e=>historicalEvent(h.tx,h.worldId,e.id)))
  const reordered=[ordered[0],ordered[2],ordered[3],ordered[1]]
  const base={effects:[],effectBaselines:[]}
  const a=previewKanataEventRevoke({...base,events:ordered},root.id)
  const b=previewKanataEventRevoke({...base,events:reordered},root.id)
  assert.notDeepEqual(a.revokeIds,b.revokeIds)
  const metadata={}
  const keys=['events','effects','baselines']
  const originals=[h.fixture.events.map(e=>e.id).concat(ordered.map(e=>e.id)),h.fixture.effects.map(e=>e.id),h.fixture.effectBaselines.map(e=>e.id)]
  async function readOrder(kind){
    // Full ID collection is a deliberate tiny test-only Oracle, never a product API.
    const ids=[];let after=-1
    for(;;){const page=await domainArrayOrderPage(h.tx,kind,h.worldId,after);assert.ok(page.length<=50)
      if(!page.length)return ids
      ids.push(...page.map(row=>row.id));after=page.at(-1).ordinal
    }
  }
  for(const [index,kind] of keys.entries()){
    metadata[kind]=await readOrder(kind)
    assert.deepEqual(metadata[kind],originals[index])
  }
  const before=h.db.prepare('SELECT * FROM world_events ORDER BY id').all()
  const rowidsBefore=h.db.prepare('SELECT rowid,id FROM world_events ORDER BY rowid').all()
  // Schema-only counterexample, not a production operation. Neither table
  // identity nor the existing constraints make implicit rowid an immutable
  // domain-array ordinal. Keep all declared columns, links and revisions intact.
  h.db.prepare('UPDATE world_events SET rowid=(SELECT max(rowid)+1 FROM world_events) WHERE id=?').run(child.id)
  const rowidsAfter=h.db.prepare('SELECT rowid,id FROM world_events ORDER BY rowid').all()
  assert.deepEqual(h.db.prepare('SELECT * FROM world_events ORDER BY id').all(),before)
  assert.notDeepEqual(rowidsBefore,rowidsAfter)
  assert.deepEqual(await readOrder('events'),metadata.events)
  console.log(JSON.stringify({status:'PASS',scope:'Schema 005 order persistence only; E/G4/M4 still BLOCKED',authority:'pure-domain (user decision 2026-11-11)',
    domainOrderA:ordered.map(e=>e.id),domainOrderB:reordered.map(e=>e.id),
    descendantsA:a.revokeIds,descendantsB:b.revokeIds,metadata,rowidsBefore,rowidsAfter,
    conclusion:'New candidate writes retain explicit immutable ordinal metadata. Rowid changes cannot change it. Historical missing order is not inferred or backfilled. No production rowid was touched.'},null,2))
}finally{h.close()}
