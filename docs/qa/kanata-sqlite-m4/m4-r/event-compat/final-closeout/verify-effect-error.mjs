// Reproduce only the pre-fix staging expression in a fresh synthetic database.
// Current repository behavior is asserted separately; no historical schema changes.
import assert from 'node:assert/strict'
import {eventCompatFixture} from '../../../../../../tests/helpers/kanataEventCompatFixture.js'
import {captureEffectAuditBefore,effectTargetJson} from '../../../../../../src/features/chat/storage/sqlite/kanataEffectAuditStorage.js'
async function run(previous){
  const h=await eventCompatFixture()
  try{
    const events=h.domains.events
    const {id}=await events.proposeAcknowledged(h.fields,'error-class')
    await events.commitAcknowledged(h.worldId,id,1)
    h.db.prepare(`INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
      VALUES('unknown-path',?,?,'instance',?,?,'set','future.unsupported','"synthetic"',1)`)
      .run(h.worldId,id,h.instanceId,h.instanceId)
    if(previous){
      const target=effectTargetJson('f.world_id','f.target_id','f.path')
      const old=captureEffectAuditBefore.replace('coalesce('+target+",'null')",target)
      assert.notEqual(old,captureEffectAuditBefore)
      const execute=h.tx.execute
      h.tx.execute=(sql,args)=>execute(sql===captureEffectAuditBefore?old:sql,args)
    }
    const plan=(await events.openRevocation(h.worldId,id)).plan
    let observed
    try{await events.confirmRevocation(plan,undefined,'error-class-confirm')}
    catch(error){observed=error.message}
    assert.match(observed,previous?/NOT NULL constraint failed/:/EVENT_EFFECT_PATH_UNSUPPORTED/)
    assert.equal((await events.managedEvent(h.worldId,id)).revision,2)
    assert.equal((await events.revocationAudits(h.worldId,id)).entries.length,0)
    return {mode:previous?'pre-fix-expression':'current',observed,atomicRollback:true}
  }finally{h.close()}
}
console.log(JSON.stringify({results:[await run(true),await run(false)]},null,2))
