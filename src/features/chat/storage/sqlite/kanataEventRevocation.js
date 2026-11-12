// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { validateId } from '../../domain/kanataValidation.js'
import { executeOnce } from './kanataDomainRows.js'
import { rebuildEventEffects, visitRows } from './kanataMessageDependents.js'
import { equalDto, pageLimit, requireSqliteValue as need } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'
import { assertDomainArrayOrder } from './kanataArrayOrder.js'
import { eventWorldSignature } from './kanataEventWorldSignature.js'
import { withEventPlan } from './kanataEventPlanOrder.js'
import { eventSnapshotSql, eventSnapshotValidSql, eventScalarFieldsSql } from './kanataEventSnapshot.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationPlan} Plan */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationCursor} Cursor */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationDecision} Decision */

const root = 'SELECT revision,status FROM world_events WHERE world_id=? AND id=?'
const selection = `WITH scope(world,root) AS (VALUES(?,?)), selected AS (
    SELECT e.id,e.revision,e.status,e.effective_at,p.disposition,p.sort_key,p.exec_key
    FROM temp.kanata_event_plan p CROSS JOIN scope
    JOIN world_events e ON e.world_id=scope.world AND e.id=p.id
  )`
const projected = selection + `
    SELECT selected.*,(SELECT count(*) FROM world_effects f WHERE f.world_id=scope.world AND f.event_id=selected.id) AS effect_count
    FROM selected CROSS JOIN scope WHERE selected.sort_key>? ORDER BY selected.sort_key LIMIT ?`
const selectionBatch = projected.replace('LIMIT ?', 'LIMIT 128')
const executionBatch = projected.replace('selected.sort_key>? ORDER BY selected.sort_key LIMIT ?',
  'selected.disposition=? AND selected.exec_key>? ORDER BY selected.exec_key LIMIT 128')
const planCursor = 'SELECT 1 FROM temp.kanata_event_plan WHERE sort_key=? LIMIT 1'
const proofPaths = selection + `, paths AS (
  SELECT DISTINCT f.target_type,f.target_id,f.path FROM selected s CROSS JOIN scope
  JOIN world_effects f ON f.world_id=scope.world AND f.event_id=s.id
)`
const pathJoin = 'p.target_type=f.target_type AND p.target_id=f.target_id AND p.path=f.path'
const effectProof = proofPaths + ` SELECT f.id,f.event_id,f.target_type,f.target_id,f.path,f.operation,f.value_json,f.rule_version,e.status,e.revision,e.effective_at,e.recorded_at
  FROM paths p CROSS JOIN scope JOIN world_effects f ON f.world_id=scope.world AND ${pathJoin}
  JOIN world_events e ON e.world_id=f.world_id AND e.id=f.event_id WHERE f.id>? ORDER BY f.id LIMIT 128`
const baselineProof = proofPaths + ` SELECT f.id,f.target_type,f.target_id,f.path,f.value_json
  FROM paths p CROSS JOIN scope JOIN effect_baselines f ON f.world_id=scope.world AND ${pathJoin}
  WHERE f.id>? ORDER BY f.id LIMIT 128`

// The transaction-local frozen set includes already-revoked owners. Pure-domain
// replay still visits their affected paths, while event revisions/audits stay no-op.
const completedEffects = `WITH p(world,disposition) AS (VALUES(?,?))
  SELECT f.* FROM p JOIN world_effects f ON f.world_id=p.world
  JOIN temp.kanata_event_plan s ON s.id=f.event_id AND s.disposition=p.disposition
  WHERE (f.target_type,f.target_id,f.path,f.id)>(?,?,?,?)
  ORDER BY f.target_type,f.target_id,f.path,f.id LIMIT 128`
const staleMemories = `WITH p(world,disposition) AS (VALUES(?,?))
  UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=(SELECT world FROM p) AND status<>'deleted'
  AND id IN (SELECT l.memory_id FROM p JOIN memory_events l ON l.world_id=p.world
    JOIN temp.kanata_event_plan s ON s.id=l.event_id AND s.disposition=p.disposition)`

const batchInput = `WITH args(world,changes,signature) AS (VALUES(?,?,?)), p AS MATERIALIZED (
  SELECT world,signature,json_extract(j.value,'$.id') AS event,json_extract(j.value,'$.auditId') AS id,
    json_extract(j.value,'$.at') AS at,json_extract(j.value,'$.status') AS old_status,
    json_extract(j.value,'$.revision') AS old_revision,json_extract(j.value,'$.next') AS next_status,
    json_extract(j.value,'$.effectCount') AS effect_count
  FROM args JOIN json_each(args.changes) j
)`
const statusUpdate = batchInput + `
  UPDATE world_events AS e SET status=p.next_status,revision=e.revision+1 FROM p
  WHERE e.world_id=p.world AND e.id=p.event AND e.revision=p.old_revision AND e.status=p.old_status`
// Constrain the lookup to its owner before ordering by ID. SQLCipher can otherwise
// use the world/ID index for ORDER BY and scan unrelated Effects for each audit.
const ownedEffects = `(SELECT json_group_array(json_object('id',f.id,'targetType',f.target_type,'targetId',f.target_id,
    'path',f.path,'operation',f.operation,'value',json(f.value_json),'ruleVersion',f.rule_version))
  FROM (SELECT f.* FROM world_effects f INDEXED BY effects_by_event
    JOIN effect_array_order o ON o.world_id=f.world_id AND o.entity_id=f.id
    WHERE f.world_id=p.world AND f.event_id=p.event ORDER BY o.ordinal) f)`
const writeAudit = batchInput + `,
  snapshot AS (SELECT p.*,e.revision,e.status,${eventSnapshotSql} AS body,${ownedEffects} AS owned_effects
    FROM p JOIN world_events e ON e.world_id=p.world AND e.id=p.event AND e.revision=p.old_revision+1 AND e.status=p.next_status
    WHERE ${eventSnapshotValidSql})
  INSERT INTO event_audits(id,world_id,event_id,at,previous_revision,next_revision,previous_json,next_json,extensions_json)
  SELECT id,world,event,at,old_revision,revision,json_set(body,'$.status',old_status,'$.revision',old_revision),
    json_set(body,'$.status',status,'$.revision',revision),
    json_object('revocationSignature',signature,'ownedEffectCount',effect_count,'ownedEffects',json(owned_effects))
  FROM snapshot WHERE json_array_length(owned_effects)=effect_count`
const updateExtensions = batchInput + `
  UPDATE world_events AS e SET extensions_json=(SELECT json_remove(a.next_json,${eventScalarFieldsSql})
    FROM event_audits a WHERE a.world_id=e.world_id AND a.event_id=e.id AND a.id=p.id)
  FROM p WHERE e.world_id=p.world AND e.id=p.event AND e.revision=p.old_revision+1 AND e.status=p.next_status`
const auditHeaders = `SELECT id,at,previous_revision,next_revision,json_extract(next_json,'$.status') AS status,
  json_extract(extensions_json,'$.ownedEffectCount') AS effect_count
  FROM event_audits WHERE world_id=? AND event_id=? AND id>?
  AND json_extract(extensions_json,'$.revocationSignature') IS NOT NULL ORDER BY id LIMIT ?`
const auditEffectHeader = `SELECT json_type(extensions_json,'$.ownedEffects') AS snapshot_type,
  json_extract(extensions_json,'$.ownedEffectCount') AS effect_count
  FROM event_audits WHERE world_id=? AND event_id=? AND id=?
    AND json_extract(extensions_json,'$.revocationSignature') IS NOT NULL`
const auditEffectPage = `SELECT json_extract(j.value,'$.id') AS id,j.value AS effect
  FROM event_audits a JOIN json_each(a.extensions_json,'$.ownedEffects') j
  WHERE a.world_id=? AND a.event_id=? AND a.id=? AND json_extract(j.value,'$.id')>?
  ORDER BY id LIMIT ?`
export const eventRevocationQueries = [root, projected, selectionBatch, effectProof, baselineProof, completedEffects,
  auditHeaders, auditEffectHeader, auditEffectPage, executionBatch, planCursor]
export const eventRevocationWrites = [statusUpdate, writeAudit, staleMemories, updateExtensions]

/** @param {Row} row */
function entry(row) {
  return {
    id: String(row.id), revision: Number(row.revision), effectiveAt: Number(row.effective_at), status: String(row.status),
    disposition: /** @type {'revoke'|'uncertain'} */ (row.disposition), effectCount: Number(row.effect_count),
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId */
async function snapshot(tx, worldId, eventId) {
  await assertDomainArrayOrder(tx,worldId)
  const scope = [worldId,eventId]
  const [original] = await tx.query(root,scope)
  need(original && original.status!=='revoked','EVENT_UNAVAILABLE')
  let revokeCount=0,uncertainCount=0
  const rootRevision=Number(original.revision)
  let signature=sha256Text(JSON.stringify([worldId,eventId,rootRevision,'revocation-v3',await eventWorldSignature(tx,worldId)]))
  for await (const row of visitRows(tx,selectionBatch,scope,['sort_key'])) {
    if(row.disposition==='revoke')revokeCount++
    else uncertainCount++
    signature=sha256Text(signature+JSON.stringify(row))
  }
  return { worldId,eventId,rootRevision,revokeCount,uncertainCount,signature }
}

/** @param {Operation} operation @param {{id:()=>string,clock:()=>number}} tools
 * @param {(tx:Tx,plan:Plan,summary:string)=>Promise<()=>Promise<string>>} prepareCorrection */
export function createEventRevocation(operation,tools,prepareCorrection) {
  /** @param {Tx} tx @param {Plan} plan @param {Decision|undefined} decision
   * @param {string} commandId @param {string} [summary] */
  async function apply(tx,plan,decision,commandId,summary){
    const {worldId,eventId,signature}=plan
    validateId(commandId,'commandId')
    validateId(eventId,'eventId')
    need(decision===undefined||decision==='keep-independent'||decision==='mark-needs-review','EVENT_REVOCATION_DECISION_INVALID')
    await assertWritableWorld(tx,worldId)
    const expected={revoked:plan.revokeCount,needsReview:decision==='mark-needs-review'?plan.uncertainCount:0}
    const command=summary===undefined?'event:revoke-confirmed':'event:correct-confirmed'
    const resultId=await executeOnce(tx,[command,worldId,eventId,commandId],{plan,decision:decision??null,...(summary!==undefined&&{summary})},()=>withEventPlan(tx,worldId,eventId,async()=>{
      const current=await snapshot(tx,worldId,eventId)
      need(equalDto(current,plan),'EVENT_REVOKE_PREVIEW_STALE')
      need(!plan.uncertainCount||decision!==undefined,'EVENT_DEPENDENCY_UNCERTAIN')
      const correct=summary===undefined?undefined:await prepareCorrection(tx,plan,summary)
      let revoked=0,needsReview=0
      for(const disposition of ['revoke','uncertain']){
        if(disposition==='uncertain'&&decision!=='mark-needs-review')continue
        let after=''
        for (;;) {
          const rows=await tx.query(executionBatch,[worldId,eventId,disposition,after])
          const changes=[]
          for(const row of rows){
            const next=disposition==='revoke'?'revoked':'needsReview'
            if(next==='revoked')revoked++
            else needsReview++
            if(row.status==='revoked')continue
            changes.push({id:row.id,revision:row.revision,status:row.status,next,
              auditId:tools.id(),at:tools.clock(),effectCount:row.effect_count})
          }
          if(changes.length){
            const parameters=[worldId,JSON.stringify(changes),signature]
            need((await tx.execute(statusUpdate,parameters)).affectedRows===changes.length,'EVENT_REVOKE_PREVIEW_STALE')
            need((await tx.execute(writeAudit,parameters)).affectedRows===changes.length,'EVENT_REVOKE_AUDIT_CONFLICT')
            need((await tx.execute(updateExtensions,parameters)).affectedRows===changes.length,'EVENT_REVOKE_AUDIT_CONFLICT')
          }
          if(rows.length<128)break
          after=String(rows[rows.length-1].exec_key)
        }
        await tx.execute(staleMemories,[worldId,disposition])
        await rebuildEventEffects(tx,completedEffects,[worldId,disposition])
      }
      need(revoked===expected.revoked&&needsReview===expected.needsReview,'EVENT_REVOKE_PREVIEW_STALE')
      return correct?correct():eventId
    }))
    return {expected,resultId}
  }
  return {
    /** @param {string} worldId @param {string} eventId @param {Cursor} [cursor] @param {number} [limit] */
    openRevocation: (worldId,eventId,cursor,limit=50) => operation.transaction(tx=>withEventPlan(tx,worldId,eventId,async()=>{
      validateId(worldId,'worldId')
      validateId(eventId,'eventId')
      const current=await snapshot(tx,worldId,eventId)
      if(cursor){
        validateId(cursor.after,'cursor')
        need(equalDto(current,cursor.plan),'EVENT_REVOCATION_CURSOR_STALE')
        need((await tx.query(planCursor,[cursor.after])).length===1,'EVENT_REVOCATION_CURSOR_STALE')
      }
      const rows=await tx.query(projected,[worldId,eventId,cursor?.after??'',pageLimit(limit)+1])
      const entries=rows.slice(0,limit).map(entry)
      return { plan:current,entries,cursor:rows.length>limit?{plan:current,after:String(rows[limit-1].sort_key)}:null }
    })),
    /** @param {Plan} plan @param {Decision|undefined} decision @param {string} commandId */
    confirmRevocation: (plan,decision,commandId) => operation.transaction(async tx=>
      (await apply(tx,plan,decision,commandId)).expected),
    /** @param {Plan} plan @param {Decision|undefined} decision @param {string} commandId @param {string} summary */
    correctConfirmed: (plan,decision,commandId,summary) => operation.transaction(async tx=>{
      need(typeof summary==='string'&&summary.trim()&&summary.length<=2000,'INVALID_EVENT_SUMMARY')
      const result=await apply(tx,plan,decision,commandId,summary.trim())
      return {id:result.resultId,...result.expected}
    }),
    /** @param {string} worldId @param {string} eventId @param {string} auditId
     * @param {import('./kanataDomainTypes').KanataEventEffectAuditCursor} [cursor] @param {number} [limit] */
    revocationEffectAudit: (worldId, eventId, auditId, cursor, limit=50) => operation.transaction(async tx => {
      await assertDomainArrayOrder(tx,worldId)
      validateId(worldId, 'worldId')
      validateId(eventId, 'eventId')
      validateId(auditId, 'auditId')
      if(cursor){
        validateId(cursor.after,'cursor')
        need(cursor.worldId===worldId&&cursor.eventId===eventId&&cursor.auditId===auditId,'EVENT_AUDIT_CURSOR_STALE')
      }
      const keys=[worldId,eventId,auditId]
      const [header]=await tx.query(auditEffectHeader,keys)
      need(header,'EVENT_AUDIT_UNAVAILABLE')
      const complete=header.snapshot_type==='array'
      const rows=complete ? await tx.query(auditEffectPage,[...keys,cursor?.after??'',pageLimit(limit)+1]) : []
      const entries=rows.slice(0,limit).map(row=> /** @type {Omit<import('../../domain/kanataTypes').WorldEffect,'worldId'|'eventId'>} */ (JSON.parse(String(row.effect))))
      return {entries,complete,total:Number(header.effect_count),cursor:rows.length>limit ? {
        worldId,eventId,auditId,after:entries[limit-1].id,
      } : null}
    }),
    /** @param {string} worldId @param {string} eventId @param {string} [after] @param {number} [limit] */
    revocationAudits: (worldId,eventId,after='',limit=50) => operation.transaction(async tx=>{
      await assertDomainArrayOrder(tx,worldId)
      validateId(worldId,'worldId')
      validateId(eventId,'eventId')
      if(after)validateId(after,'cursor')
      const rows=await tx.query(auditHeaders,[worldId,eventId,after,pageLimit(limit)+1])
      const entries=rows.slice(0,limit).map(row=>({id:String(row.id),at:Number(row.at),status:String(row.status),
        previousRevision:Number(row.previous_revision),nextRevision:Number(row.next_revision),effectCount:Number(row.effect_count)}))
      return {entries,cursor:rows.length>limit?entries[limit-1].id:null}
    }),
  }
}
