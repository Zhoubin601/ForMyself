// @ts-check
import {validateId} from '../../domain/kanataValidation.js'
import {assertDomainArrayOrder} from './kanataArrayOrder.js'
import {equalDto,pageLimit,requireSqliteValue as need,safeInteger} from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('./kanataDomainTypes').KanataEventEffectAuditField} Field */
const fields=['path','value','before','after','snapshot']
const header=`SELECT previous_revision,next_revision,
  json_extract(extensions_json,'$.revocationSignature') AS signature,
  json_type(extensions_json,'$.ownedEffects') AS snapshot_type,
  json_array_length(extensions_json,'$.ownedEffects') AS array_count,
  json_extract(extensions_json,'$.ownedEffectCount') AS effect_count
  FROM event_audits WHERE world_id=? AND event_id=? AND id=?
    AND json_type(extensions_json,'$.revocationSignature')='text'`
const from=`FROM event_audits a JOIN json_each(a.extensions_json,'$.ownedEffects') j
  WHERE a.world_id=? AND a.event_id=? AND a.id=?`
// Small snapshots remain compatible. Large records expose fixed metadata and
// explicit field flags; JSON strings stay encoded until parsed by JavaScript.
const page=`SELECT j.key AS position,CASE WHEN length(j.value)<=4096 THEN j.value ELSE json_object(
    'id',json_extract(j.value,'$.id'),'targetType',json_extract(j.value,'$.targetType'),
    'targetId',json_extract(j.value,'$.targetId'),'operation',json_extract(j.value,'$.operation'),
    'ruleVersion',json_extract(j.value,'$.ruleVersion'),'snapshotChunked',json('true'),
    'pathChunked',json(CASE WHEN json_type(j.value,'$.path') IS NULL THEN 'false' ELSE 'true' END),
    'valueChunked',json(CASE WHEN json_type(j.value,'$.value') IS NULL THEN 'false' ELSE 'true' END),
    'beforeChunked',json(CASE WHEN json_type(j.value,'$.before') IS NULL THEN 'false' ELSE 'true' END),
    'afterChunked',json(CASE WHEN json_type(j.value,'$.after') IS NULL THEN 'false' ELSE 'true' END)) END AS effect
  ${from} AND j.key>? ORDER BY j.key LIMIT ?`
const chunkSql=`WITH input(field,start) AS (VALUES(?,?))
  SELECT substr(CASE WHEN input.field='snapshot' THEN j.value ELSE j.value -> ('$.'||input.field) END,input.start,4097) AS part
  FROM event_audits a JOIN json_each(a.extensions_json,'$.ownedEffects') j CROSS JOIN input
  WHERE a.world_id=? AND a.event_id=? AND a.id=? AND json_extract(j.value,'$.id')=?`
export const effectAuditQueries=[header,page,chunkSql]

/** @param {Operation} operation */
export function createEffectAuditRead(operation){
  /** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
   * @param {string} worldId @param {string} eventId @param {string} auditId */
  async function identity(tx,worldId,eventId,auditId){
    for(const id of [worldId,eventId,auditId])validateId(id,'auditScope')
    await assertDomainArrayOrder(tx,worldId)
    const [row]=await tx.query(header,[worldId,eventId,auditId])
    need(row&&safeInteger(row.effect_count),'EVENT_AUDIT_UNAVAILABLE')
    const complete=row.snapshot_type==='array'
    need(row.snapshot_type===null||complete,'KANATA_SQLITE_INTEGRITY_FAILED')
    if(complete)need(row.array_count===row.effect_count,'KANATA_SQLITE_INTEGRITY_FAILED')
    return {worldId,eventId,auditId,previousRevision:Number(row.previous_revision),
      nextRevision:Number(row.next_revision),signature:String(row.signature),complete,total:Number(row.effect_count)}
  }
  return {
    /** @param {string} worldId @param {string} eventId @param {string} auditId
     * @param {import('./kanataDomainTypes').KanataEventEffectAuditCursor} [cursor] @param {number} [limit] */
    revocationEffectAudit:(worldId,eventId,auditId,cursor,limit=50)=>operation.transaction(async tx=>{
      const current=await identity(tx,worldId,eventId,auditId)
      const {complete,total,...scope}=current
      if(cursor){
        const {after,...binding}=cursor
        need(safeInteger(after)&&after<total&&equalDto(binding,scope),'EVENT_AUDIT_CURSOR_STALE')
      }
      const rows=complete?await tx.query(page,[worldId,eventId,auditId,cursor?.after??-1,pageLimit(limit)+1]):[]
      const entries=rows.slice(0,limit).map(row=>/** @type {import('./kanataDomainTypes').KanataEventEffectAuditEntry} */(JSON.parse(String(row.effect))))
      return {complete,total,entries,cursor:rows.length>limit?{...scope,after:Number(rows[limit-1].position)}:null}
    }),
    /** Encoded JSON fragments; only one requested part is retained by a consumer.
     * @param {string} worldId @param {string} eventId @param {string} auditId @param {string} effectId @param {Field} field
     * @param {import('./kanataDomainTypes').KanataEventEffectAuditJsonCursor} [cursor] */
    revocationEffectAuditChunk:(worldId,eventId,auditId,effectId,field,cursor)=>operation.transaction(async tx=>{
      validateId(effectId,'effectId');need(fields.includes(field),'EVENT_AUDIT_FIELD_INVALID')
      const {complete,total:_total,...scope}=await identity(tx,worldId,eventId,auditId)
      need(complete,'EVENT_AUDIT_UNAVAILABLE')
      const selection={...scope,effectId,field}
      if(cursor){const {offset,...binding}=cursor
        need(safeInteger(offset,1)&&equalDto(binding,selection),'EVENT_AUDIT_CURSOR_STALE')}
      const offset=cursor?.offset??0
      need(safeInteger(offset+1,1),'EVENT_AUDIT_CURSOR_STALE')
      const [row]=await tx.query(chunkSql,[field,offset+1,worldId,eventId,auditId,effectId])
      need(row&&typeof row.part==='string','EVENT_AUDIT_FIELD_UNAVAILABLE')
      const characters=Array.from(String(row.part))
      return {part:characters.slice(0,4096).join(''),cursor:characters.length>4096?{...selection,offset:offset+4096}:null}
    }),
  }
}
