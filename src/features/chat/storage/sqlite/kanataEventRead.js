// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { eventAuditSupport, eventRelationReads, eventIntegrityDdl, eventIntegrityCached, clearEventIntegrity, storeEventIntegrity } from './kanataEventSnapshot.js'
import { effectFromRow } from './kanataMessageDependents.js'
import { equalDto, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertDomainArrayOrder } from './kanataArrayOrder.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataDomainTypes').KanataEventReadScope} Scope */
/** @typedef {import('./kanataDomainTypes').KanataEventReadIdentity} Identity */
/** @typedef {import('./kanataDomainTypes').KanataEventRelationKind} Relation */
/** @typedef {import('./kanataDomainTypes').KanataEventRelationCursor} RelationCursor */
/** @typedef {import('./kanataDomainTypes').KanataEventReadCursor} PageCursor */
/** @typedef {import('./kanataDomainTypes').KanataEventJsonSelection} Selection */
/** @typedef {import('./kanataDomainTypes').KanataEventJsonCursor} JsonCursor */
/** @typedef {import('../../domain/kanataTypes').WorldEvent} Event */

const headerFields = `id,world_id,revision,status,visibility,
  CASE WHEN length(summary)<=4096 THEN summary END AS summary,effective_at,recorded_at,causality,kind,replaces_event_id`
const header = `SELECT ${headerFields},action_instance_id,action_relationship_id,action_location,
  json_type(extensions_json,'$.action') AS action_type FROM world_events WHERE world_id=? AND id=?`
const summaryPage = `SELECT ${headerFields} FROM world_events WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const revisionSql = 'SELECT revision FROM world_events WHERE world_id=? AND id=?'
const effectPage = `SELECT id,world_id,event_id,target_type,target_id,CASE WHEN length(path)<=4096 THEN path END AS path,operation,rule_version,
  CASE WHEN length(value_json)<=4096 THEN value_json END AS value_json
  FROM world_effects INDEXED BY effects_by_event WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT ?`
const auditPage = `SELECT id,at,previous_revision,next_revision,CASE WHEN length(json_extract(next_json,'$.status'))<=4096 THEN json_extract(next_json,'$.status') END AS status,
  CASE WHEN json_type(extensions_json,'$.ownedEffectCount')='integer' THEN json_extract(extensions_json,'$.ownedEffectCount') END AS effect_count FROM event_audits
  WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT ?`
const extensionChunk = 'SELECT substr(extensions_json,?,4097) AS part FROM world_events WHERE world_id=? AND id=?'
const summaryChunk = 'SELECT substr(json_quote(summary),?,4097) AS part FROM world_events WHERE world_id=? AND id=?'
const effectChunk = `SELECT substr(CASE WHEN ?=1 THEN json_quote(path) ELSE value_json END,?,4097) AS part
  FROM world_effects WHERE world_id=? AND event_id=? AND id=?`
const auditChunk = `WITH snapshot AS (
  SELECT CASE ? WHEN 'previous' THEN previous_json ELSE next_json END AS body,
    CASE ? WHEN 'previous' THEN previous_revision ELSE next_revision END AS revision
  FROM event_audits WHERE world_id=? AND event_id=? AND id=?
)
SELECT CASE WHEN ? IS NULL THEN substr(body,?,4097)
  ELSE substr(body -> ?,?,4097) END AS part FROM snapshot WHERE revision=?`
export const eventReadQueries = [header,summaryPage,revisionSql,effectPage,auditPage,extensionChunk,summaryChunk,effectChunk,auditChunk]

/** @param {Row} row */
function summary(row) {
  return {id:String(row.id),worldId:String(row.world_id),revision:Number(row.revision),
    status:/** @type {Event['status']} */ (row.status),visibility:/** @type {Event['visibility']} */ (row.visibility),
    summary:row.summary===null?null:String(row.summary),...(row.summary===null&&{summaryChunked:true}),effectiveAt:Number(row.effective_at),recordedAt:Number(row.recorded_at),
    ...(row.causality!==null&&{causality:/** @type {Event['causality']} */ (row.causality)}),
    ...(row.kind!==null&&{kind:/** @type {Event['kind']} */ (row.kind)}),
    ...(row.replaces_event_id!==null&&{replacesEventId:String(row.replaces_event_id)})}
}

/** @param {Identity} current @param {Identity|undefined} cursor */
function assertIdentity(current,cursor) {
  if(cursor) need(cursor.worldId===current.worldId&&cursor.eventId===current.eventId
    &&cursor.eventRevision===current.eventRevision&&equalDto(cursor.scope,current.scope),'EVENT_READ_CURSOR_STALE')
}

/** @param {Tx} tx @param {Identity} identity */
async function assertHints(tx,{worldId,eventId,eventRevision}) {
  const keys=[worldId,eventId,eventRevision]
  await tx.execute(eventIntegrityDdl[0])
  if((await tx.query(eventIntegrityCached,keys)).length)return
  const [row]=await tx.query(eventAuditSupport,keys)
  need(row && Number(row.supported)>=0,'KANATA_SQLITE_INTEGRITY_FAILED')
  await tx.execute(clearEventIntegrity)
  need((await tx.execute(storeEventIntegrity,keys)).affectedRows===1,'KANATA_SQLITE_INTEGRITY_FAILED')
}

/** Compatibility consumers explicitly materialize one snapshot, with bounded bridge reads.
 * @param {Tx} tx @param {string} worldId @param {string} id @param {string} auditId
 * @param {'previous'|'next'} side @param {number} revision */
export async function materializeAuditSnapshot(tx,worldId,id,auditId,side,revision) {
  let offset=0
  let json=''
  for(;;){
    const [row]=await tx.query(auditChunk,[side,side,worldId,id,auditId,null,offset+1,null,offset+1,revision])
    need(row && typeof row.part==='string','EVENT_JSON_UNAVAILABLE')
    const chars=Array.from(String(row.part))
    json+=chars.slice(0,4096).join('')
    if(chars.length<=4096) return /** @type {Event} */ (JSON.parse(json))
    offset+=4096
  }
}

/** @param {Operation} operation @param {(tx:Tx,worldId:string,id:string,scope:Scope)=>Promise<void>} authorize */
export function createEventRead(operation, authorize) {
  /** @param {Tx} tx @param {string} worldId @param {string} eventId @param {Scope|null} scope @returns {Promise<Identity>} */
  async function identity(tx,worldId,eventId,scope) {
    validateId(worldId,'worldId')
    validateId(eventId,'eventId')
    await assertDomainArrayOrder(tx,worldId)
    const access=scope?{instanceId:scope.instanceId,group:scope.group}:null
    if(access){
      need(typeof access.instanceId==='string'&&typeof access.group==='boolean','KANATA_CONTEXT_SCOPE_DENIED')
      await authorize(tx,worldId,eventId,access)
    }
    const [row]=await tx.query(revisionSql,[worldId,eventId])
    need(row,'EVENT_UNAVAILABLE')
    return {worldId,eventId,eventRevision:Number(row.revision),scope:access}
  }

  /** @param {Tx} tx @param {string} worldId @param {string} id */
  async function readHeader(tx,worldId,id) {
    const [row]=await tx.query(header,[worldId,id])
    need(row,'EVENT_UNAVAILABLE')
    return {...summary(row),
      actionType: row.action_type,
      actionColumns:{instanceId:row.action_instance_id,relationshipId:row.action_relationship_id,location:row.action_location}}
  }

  /** @param {Tx} tx @param {'effects'|'audits'} kind @param {string} worldId @param {string} eventId
   * @param {PageCursor|undefined} cursor @param {number} limit */
  async function readPage(tx,kind,worldId,eventId,cursor,limit) {
    const current=await identity(tx,worldId,eventId,null)
    assertIdentity(current,cursor)
    if(cursor) {
      need(cursor.kind===kind,'EVENT_READ_CURSOR_STALE')
      validateId(cursor.after,'cursor')
    }
    const rows=await tx.query(kind==='effects'?effectPage:auditPage,[worldId,eventId,cursor?.after??'',pageLimit(limit)+1])
    return {rows:rows.slice(0,limit),cursor:rows.length>limit?{...current,kind,after:String(rows[limit-1].id)}:null}
  }

  return {
    /** @param {string} worldId @param {string} [after] @param {number} [limit] */
    list: (worldId,after='',limit=50)=>operation.transaction(async tx=>{
      validateId(worldId,'worldId')
      await assertDomainArrayOrder(tx,worldId)
      if(after)validateId(after,'cursor')
      const rows=await tx.query(summaryPage,[worldId,after,pageLimit(limit)+1])
      return {events:rows.slice(0,limit).map(summary),cursor:rows.length>limit?String(rows[limit-1].id):null}
    }),
    /** @param {string} worldId @param {string} id @param {Scope} scope */
    readFor: (worldId,id,scope)=>operation.transaction(async tx=>{
      need(scope,'KANATA_CONTEXT_SCOPE_DENIED')
      const current=await identity(tx,worldId,id,scope)
      await assertHints(tx,current)
      return readHeader(tx,worldId,id)
    }),
    /** @param {string} worldId @param {string} id @param {Relation} kind @param {Scope|null} scope
     * @param {RelationCursor} [cursor] @param {number} [limit] */
    relations: (worldId,id,kind,scope,cursor,limit=50)=>operation.transaction(async tx=>{
      need(Object.hasOwn(eventRelationReads,kind),'EVENT_RELATION_KIND_INVALID')
      const current=await identity(tx,worldId,id,scope)
      assertIdentity(current,cursor)
      if(cursor) need(cursor.kind===kind&&safeInteger(cursor.after),'EVENT_READ_CURSOR_STALE')
      await assertHints(tx,current)
      const rows=await tx.query(eventRelationReads[kind].page,[worldId,id,current.eventRevision,cursor?.after??-1,pageLimit(limit)+1])
      return {entries:rows.slice(0,limit).map(row=>row.item===null
        ? {position:Number(row.position),chunked:true}
        : {position:Number(row.position),value:/** @type {unknown} */ (cloneKanataJson(JSON.parse(String(row.item))))}),
      cursor:rows.length>limit?{...current,kind,after:Number(rows[limit-1].position)}:null}
    }),
    /** @param {string} worldId @param {string} id @param {PageCursor} [cursor] @param {number} [limit] */
    effects: (worldId,id,cursor,limit=50)=>operation.transaction(async tx=>{
      const page=await readPage(tx,'effects',worldId,id,cursor,limit)
      return {entries:page.rows.map(row=>{
        const {value,path,...metadata}=effectFromRow({...row,value_json:row.value_json??'null'})
        return {...metadata,...(row.path===null?{pathChunked:true}:{path}),
          ...(row.value_json===null?{valueChunked:true}:{value})}
      }),cursor:page.cursor}
    }),
    /** @param {string} worldId @param {string} id @param {PageCursor} [cursor] @param {number} [limit] */
    audits: (worldId,id,cursor,limit=50)=>operation.transaction(async tx=>{
      const page=await readPage(tx,'audits',worldId,id,cursor,limit)
      return {entries:page.rows.map(row=>({id:String(row.id),at:Number(row.at),previousRevision:Number(row.previous_revision),
        nextRevision:Number(row.next_revision),status:row.status===null?null:String(row.status),...(row.status===null&&{statusChunked:true}),effectCount:row.effect_count===null?null:Number(row.effect_count)})),
      cursor:page.cursor}
    }),
    /** @param {string} worldId @param {string} id @param {Selection} selection @param {Scope|null} scope
     * @param {JsonCursor} [cursor] */
    jsonChunk: (worldId,id,selection,scope,cursor)=>operation.transaction(async tx=>{
      const current=await identity(tx,worldId,id,scope)
      assertIdentity(current,cursor)
      if(cursor)need(equalDto(cursor.selection,selection)&&safeInteger(cursor.offset,1),'EVENT_READ_CURSOR_STALE')
      const offset=cursor?.offset??0
      const start=offset+1
      need(safeInteger(start,1),'EVENT_READ_CURSOR_STALE')
      let rows
      switch(selection.kind) {
        case 'extensions':
          await assertHints(tx,current)
          rows=await tx.query(extensionChunk,[start,worldId,id])
          break
        case 'summary':
          await assertHints(tx,current)
          rows=await tx.query(summaryChunk,[start,worldId,id])
          break
        case 'relation':
          need(Object.hasOwn(eventRelationReads,selection.relation)&&safeInteger(selection.position),'EVENT_RELATION_KIND_INVALID')
          await assertHints(tx,current)
          rows=await tx.query(eventRelationReads[selection.relation].chunk,[start,worldId,id,current.eventRevision,selection.position])
          break
        case 'effectValue':
        case 'effectPath':
          need(!scope,'KANATA_CONTEXT_SCOPE_DENIED')
          validateId(selection.effectId,'effectId')
          rows=await tx.query(effectChunk,[Number(selection.kind==='effectPath'),start,worldId,id,selection.effectId])
          break
        case 'audit': {
          need(!scope,'KANATA_CONTEXT_SCOPE_DENIED')
          validateId(selection.auditId,'auditId')
          need((selection.side==='previous'||selection.side==='next')&&safeInteger(selection.snapshotRevision,1),'EVENT_AUDIT_UNAVAILABLE')
          need(selection.field===undefined||Object.hasOwn(eventRelationReads,selection.field),'EVENT_RELATION_KIND_INVALID')
          const path=selection.field?'$.'+selection.field:null
          rows=await tx.query(auditChunk,[selection.side,selection.side,worldId,id,selection.auditId,path,start,path,start,selection.snapshotRevision])
          break
        }
        default:
          throw new Error('EVENT_JSON_KIND_INVALID')
      }
      need(rows[0],'EVENT_JSON_UNAVAILABLE')
      // SQLite substr indexes code points. Remove only the lookahead code point.
      const part=rows[0].part
      if(part===null)return {part:null,cursor:null}
      const text=String(part)
      const characters=Array.from(text)
      return {part:characters.length>4096?characters.slice(0,4096).join(''):text,
        cursor:characters.length>4096?{...current,selection:{...selection},offset:offset+4096}:null}
    }),
  }
}
