// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { validateId } from '../../domain/kanataValidation.js'
import { executeOnce, writeOne } from './kanataDomainRows.js'
import { rebuildEventEffects, visitRows } from './kanataMessageDependents.js'
import { equalDto, pageLimit, requireSqliteValue as need } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationPlan} Plan */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationCursor} Cursor */
/** @typedef {import('./kanataDomainTypes').KanataEventRevocationDecision} Decision */

const root = 'SELECT revision,status FROM world_events WHERE world_id=? AND id=?'
const selection = `WITH RECURSIVE scope(world,root) AS (VALUES(?,?)), descendants(id) AS (
    SELECT root FROM scope UNION
    SELECT l.event_id FROM descendants d CROSS JOIN scope
    JOIN event_causes l ON l.world_id=scope.world AND l.cause_event_id=d.id
  ), selected AS (
    SELECT e.id,e.revision,e.status,e.effective_at,'revoke' AS disposition
    FROM descendants d CROSS JOIN scope JOIN world_events e ON e.world_id=scope.world AND e.id=d.id
    WHERE e.status<>'revoked'
    UNION ALL
    SELECT e.id,e.revision,e.status,e.effective_at,'uncertain'
    FROM scope JOIN world_events original ON original.world_id=scope.world AND original.id=scope.root
    JOIN world_events e ON e.world_id=scope.world AND e.status='committed'
    WHERE e.effective_at>=original.effective_at AND e.causality IS NOT 'explicit'
      AND NOT EXISTS(SELECT 1 FROM descendants d WHERE d.id=e.id)
  )`
const projected = selection + `
    SELECT selected.*,(SELECT count(*) FROM world_effects f WHERE f.world_id=scope.world AND f.event_id=selected.id) AS effect_count
    FROM selected CROSS JOIN scope WHERE selected.id>? ORDER BY selected.id LIMIT ?`
const selectionBatch = projected.replace('LIMIT ?', 'LIMIT 128')
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

// The immutable audit records are the confirmed set after statuses change. Match the
// scope, plan and exact revision, so an audit from another operation cannot affect replay.
const auditedOwner = `JOIN event_audits a ON a.world_id=e.world_id AND a.event_id=e.id AND a.next_revision=e.revision
  AND json_extract(a.extensions_json,'$.revocationSignature')=p.signature`
const completedEffects = `WITH p(world,signature) AS (VALUES(?,?))
  SELECT f.* FROM p JOIN world_effects f ON f.world_id=p.world JOIN world_events e ON e.world_id=f.world_id AND e.id=f.event_id
  ${auditedOwner} WHERE (f.target_type,f.target_id,f.path,f.id)>(?,?,?,?)
  ORDER BY f.target_type,f.target_id,f.path,f.id LIMIT 128`
const staleMemories = `WITH p(world,signature) AS (VALUES(?,?))
  UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=(SELECT world FROM p) AND status NOT IN ('deleted','stale')
  AND id IN (SELECT l.memory_id FROM p JOIN memory_events l ON l.world_id=p.world
    JOIN world_events e ON e.world_id=l.world_id AND e.id=l.event_id ${auditedOwner})`

const statusUpdate = `UPDATE world_events SET status=?,revision=revision+1
  WHERE world_id=? AND id=? AND revision=? AND status=?`
const arrayLinks = (/** @type {string} */ table, /** @type {string} */ field) =>
  `(SELECT json_group_array(v) FROM (SELECT ${field} AS v FROM ${table} l
    WHERE l.world_id=e.world_id AND l.event_id=e.id ORDER BY ${field}))`
const eventSnapshot = `json_patch(e.extensions_json,json_object(
  'id',e.id,'worldId',e.world_id,'visibility',e.visibility,'summary',e.summary,
  'effectiveAt',e.effective_at,'recordedAt',e.recorded_at,'causality',e.causality,'kind',e.kind,'replacesEventId',e.replaces_event_id,
  'participantIds',json(COALESCE(json_extract(e.extensions_json,'$.participantIds'),${arrayLinks('event_participants','participant_id')})),
  'causedByEventIds',json(COALESCE(json_extract(e.extensions_json,'$.causedByEventIds'),${arrayLinks('event_causes','cause_event_id')})),
  'sourceRefs',json(COALESCE(json_extract(e.extensions_json,'$.sourceRefs'),(SELECT json_group_array(json_object(
    'messageId',s.message_id,'revision',s.message_revision)) FROM event_sources s WHERE s.world_id=e.world_id AND s.event_id=e.id)))
))`
const writeAudit = `WITH p(id,at,old_status,old_revision,signature,effect_count,world,event) AS (VALUES(?,?,?,?,?,?,?,?)),
  snapshot AS (SELECT p.*,e.revision,e.status,${eventSnapshot} AS body FROM p JOIN world_events e ON e.world_id=p.world AND e.id=p.event)
  INSERT INTO event_audits(id,world_id,event_id,at,previous_revision,next_revision,previous_json,next_json,extensions_json)
  SELECT id,world,event,at,old_revision,revision,json_set(body,'$.status',old_status,'$.revision',old_revision),
    json_set(body,'$.status',status,'$.revision',revision),
    json_object('revocationSignature',signature,'ownedEffectCount',effect_count)
  FROM snapshot`
const auditHeaders = `SELECT id,at,previous_revision,next_revision,json_extract(next_json,'$.status') AS status,
  json_extract(extensions_json,'$.ownedEffectCount') AS effect_count
  FROM event_audits WHERE world_id=? AND event_id=? AND id>?
  AND json_extract(extensions_json,'$.revocationSignature') IS NOT NULL ORDER BY id LIMIT ?`
export const eventRevocationQueries = [root, projected, selectionBatch, effectProof, baselineProof, completedEffects, auditHeaders]
export const eventRevocationWrites = [statusUpdate, writeAudit, staleMemories]

/** @param {Row} row */
function entry(row) {
  return {
    id: String(row.id), revision: Number(row.revision), effectiveAt: Number(row.effective_at), status: String(row.status),
    disposition: /** @type {'revoke'|'uncertain'} */ (row.disposition), effectCount: Number(row.effect_count),
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId */
async function snapshot(tx, worldId, eventId) {
  const scope = [worldId,eventId]
  const [original] = await tx.query(root,scope)
  need(original && original.status!=='revoked','EVENT_UNAVAILABLE')
  let revokeCount=0,uncertainCount=0
  const rootRevision=Number(original.revision)
  let signature=sha256Text(JSON.stringify([worldId,eventId,rootRevision,'revocation-v1']))
  for await (const row of visitRows(tx,selectionBatch,scope,['id'])) {
    if(row.disposition==='revoke')revokeCount++
    else uncertainCount++
    signature=sha256Text(signature+JSON.stringify(row))
  }
  for (const [sql,kind] of [[effectProof,'effect'],[baselineProof,'baseline']]) {
    for await (const row of visitRows(tx,sql,scope,['id'])) signature=sha256Text(signature+JSON.stringify([kind,row]))
  }
  return { worldId,eventId,rootRevision,revokeCount,uncertainCount,signature }
}

/** @param {Operation} operation @param {{id:()=>string,clock:()=>number}} tools */
export function createEventRevocation(operation,tools) {
  return {
    /** @param {string} worldId @param {string} eventId @param {Cursor} [cursor] @param {number} [limit] */
    openRevocation: (worldId,eventId,cursor,limit=50) => operation.transaction(async tx=>{
      validateId(worldId,'worldId')
      validateId(eventId,'eventId')
      const current=await snapshot(tx,worldId,eventId)
      if(cursor){
        validateId(cursor.after,'cursor')
        need(equalDto(current,cursor.plan),'EVENT_REVOCATION_CURSOR_STALE')
      }
      const rows=await tx.query(projected,[worldId,eventId,cursor?.after??'',pageLimit(limit)+1])
      const entries=rows.slice(0,limit).map(entry)
      return { plan:current,entries,cursor:rows.length>limit?{plan:current,after:entries[limit-1].id}:null }
    }),
    /** @param {Plan} plan @param {Decision|undefined} decision @param {string} commandId */
    confirmRevocation: (plan,decision,commandId) => operation.transaction(async tx=>{
      const {worldId,eventId,signature}=plan
      validateId(commandId,'commandId')
      validateId(eventId,'eventId')
      need(decision===undefined||decision==='keep-independent'||decision==='mark-needs-review','EVENT_REVOCATION_DECISION_INVALID')
      await assertWritableWorld(tx,worldId)
      const expected={revoked:plan.revokeCount,needsReview:decision==='mark-needs-review'?plan.uncertainCount:0}
      await executeOnce(tx,['event:revoke-confirmed',worldId,eventId,commandId],{plan,decision:decision??null},async()=>{
        const current=await snapshot(tx,worldId,eventId)
        need(equalDto(current,plan),'EVENT_REVOKE_PREVIEW_STALE')
        need(!plan.uncertainCount||decision!==undefined,'EVENT_DEPENDENCY_UNCERTAIN')
        let revoked=0,needsReview=0
        for await(const row of visitRows(tx,selectionBatch,[worldId,eventId],['id'])){
          const next=row.disposition==='revoke'?'revoked':decision==='mark-needs-review'?'needsReview':null
          if(!next)continue
          await writeOne(tx,statusUpdate,[next,worldId,row.id,row.revision,row.status])
          await writeOne(tx,writeAudit,[tools.id(),tools.clock(),row.status,row.revision,signature,row.effect_count,worldId,row.id])
          if(next==='revoked')revoked++
          else needsReview++
        }
        need(revoked===expected.revoked&&needsReview===expected.needsReview,'EVENT_REVOKE_PREVIEW_STALE')
        await tx.execute(staleMemories,[worldId,signature])
        await rebuildEventEffects(tx,completedEffects,[worldId,signature])
        return eventId
      })
      return expected
    }),
    /** @param {string} worldId @param {string} eventId @param {string} [after] @param {number} [limit] */
    revocationAudits: (worldId,eventId,after='',limit=50) => operation.transaction(async tx=>{
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
