import assert from 'node:assert/strict'
import { eventCompatFixture } from '../../../../../tests/helpers/kanataEventCompatFixture.js'
import { historicalEvent } from '../../../../../tests/helpers/kanataEventCompatibilityOracle.js'
import { previewKanataEventRevoke } from '../../../../../src/features/chat/experience/kanataEvents.js'

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
  for(const table of ['world_events','world_effects','effect_baselines']){
    metadata[table]=h.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name)
    assert.equal(metadata[table].some(name=>/ordinal|position|sequence|array_order/.test(name)),false)
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
  console.log(JSON.stringify({status:'BLOCKED',authority:'pure-domain (user decision 2026-11-11)',
    domainOrderA:ordered.map(e=>e.id),domainOrderB:reordered.map(e=>e.id),
    descendantsA:a.revokeIds,descendantsB:b.revokeIds,metadata,rowidsBefore,rowidsAfter,
    conclusion:'No frozen original-array-order mapping has been proven. Implicit rowid is not a schema-guaranteed ordinal. This does not prove every candidate insertion loses order; it prevents certifying arbitrary historical domain order. No production rowid was touched.'},null,2))
  process.exitCode=1
}finally{h.close()}
