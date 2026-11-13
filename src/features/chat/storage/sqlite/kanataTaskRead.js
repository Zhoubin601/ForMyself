// @ts-check
import {validateId,cloneKanataJson} from '../../domain/kanataValidation.js'
import {createSha256Stream} from '../../../../shared/crypto/sha256Stream.js'
import {assertDomainArrayOrder} from './kanataArrayOrder.js'
import {pageLimit,requireSqliteValue as need,safeInteger,validId} from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataDomainTypes').KanataTaskHeader} Header */
/** @typedef {import('./kanataDomainTypes').KanataTaskRelationKind} Kind */
/** @typedef {import('./kanataDomainTypes').KanataTaskRelationCursor} Cursor */
/** @typedef {import('./kanataDomainTypes').KanataTaskReadIdentity} Identity */
const columns=`t.world_id,t.id,t.kind,t.state,t.source_revision,t.attempt,t.not_before,t.lease_until,t.conversation_id,t.instance_id,
  CASE WHEN length(json_quote(t.idempotency_key))<=4096 THEN t.idempotency_key END AS idempotency_key,
  CASE WHEN length(json_quote(t.error_code))<=4096 THEN t.error_code END AS error_code,
  t.error_code IS NOT NULL AS has_error,
  json_type(t.metadata_json,'$.simulationWindow') IS NOT NULL AS has_window,
  json_type(t.metadata_json,'$.social') IS NOT NULL AS has_social,
  json_type(t.metadata_json,'$.contact') IS NOT NULL AS has_contact,
  json_type(t.metadata_json,'$.deferredReply') IS NOT NULL AS has_reply,
  (SELECT count(*) FROM task_sources s WHERE s.world_id=t.world_id AND s.task_id=t.id) AS source_count,
  (SELECT count(*) FROM task_result_events s WHERE s.world_id=t.world_id AND s.task_id=t.id) AS event_count,
  (SELECT count(*) FROM task_result_memories s WHERE s.world_id=t.world_id AND s.task_id=t.id) AS memory_count,
  (SELECT count(*) FROM task_social_participants s WHERE s.world_id=t.world_id AND s.task_id=t.id) AS participant_count`
const header=`SELECT ${columns} FROM background_tasks t WHERE t.world_id=? AND t.id=?`
const list=`SELECT ${columns} FROM background_tasks t WHERE t.world_id=? AND t.id>? ORDER BY t.id LIMIT ?`
const specs={
  sources:{table:'task_sources',keys:['message_id','message_revision']},
  events:{table:'task_result_events',keys:['event_id']},
  memories:{table:'task_result_memories',keys:['memory_id']},
  participants:{table:'task_social_participants',keys:['instance_id','conversation_id']},
}
const memberQueries=Object.fromEntries(Object.entries(specs).map(([kind,{table,keys}])=>[kind,
  `SELECT ${keys[0]} AS id,${kind==='sources'?'message_revision':'NULL'} AS revision,-1 AS ordinal FROM ${table}
    WHERE world_id=? AND task_id=? AND ${keys[0]}>? ORDER BY ${keys[0]} LIMIT ?`]))
// Event member presentation follows the approved world array order, never ID,
// time or rowid guesses. Other normalized memberships have their own keysets.
memberQueries.events=`SELECT s.event_id AS id,NULL AS revision,o.ordinal FROM task_result_events s
  JOIN event_array_order o ON o.world_id=s.world_id AND o.entity_id=s.event_id
  WHERE s.world_id=? AND s.task_id=? AND o.ordinal>? ORDER BY o.ordinal LIMIT ?`
const signatureLinks=Object.values(specs).map(({table,keys})=>({
  table,sql:`SELECT ${keys[0]} AS id,json_array(${keys.join(',')}) AS item FROM ${table}
    WHERE world_id=? AND task_id=? AND ${keys[0]}>? ORDER BY ${keys[0]} LIMIT 50`,
}))
const body=`json_array(t.world_id,t.id,t.kind,t.state,t.idempotency_key,t.source_revision,t.attempt,t.not_before,t.lease_until,
  t.conversation_id,t.instance_id,t.error_code,t.metadata_json,t.window_task_id,t.deferred_message_id,t.deferred_revision,
  t.deferred_expires_at,t.notification_id,t.extensions_json)`
const bodyChunk=`SELECT substr(${body},?,4096) AS part FROM background_tasks t WHERE t.world_id=? AND t.id=?`
const chunk=`SELECT substr(CASE ? WHEN 'metadata' THEN metadata_json WHEN 'extensions' THEN extensions_json
    WHEN 'idempotencyKey' THEN json_quote(idempotency_key) ELSE json_quote(error_code) END,?,4097) AS part
  FROM background_tasks WHERE world_id=? AND id=?`
const extensionValid=`SELECT CASE WHEN json_valid(t.extensions_json) THEN json_type(t.extensions_json)='object'
  AND NOT EXISTS (WITH RECURSIVE tree(value,kind,depth) AS (
    SELECT t.extensions_json,'object',0 UNION ALL SELECT j.value,j.type,p.depth+1 FROM tree p
    CROSS JOIN json_each(CASE WHEN p.kind IN ('object','array') THEN p.value ELSE '[]' END) j WHERE p.depth<=64
  ) SELECT 1 FROM tree WHERE depth>64 OR (kind='real' AND abs(value)>1.7976931348623157e308) LIMIT 1)
  ELSE 0 END AS valid FROM background_tasks t WHERE t.world_id=? AND t.id=?`
const create=`CREATE TEMP TABLE IF NOT EXISTS kanata_task_read_signature (
  slot INTEGER PRIMARY KEY CHECK(slot=1),world_id TEXT NOT NULL,task_id TEXT NOT NULL,signature TEXT NOT NULL,
  local_changes INTEGER NOT NULL,data_version INTEGER NOT NULL
) STRICT`
const cached=`SELECT signature FROM temp.kanata_task_read_signature c CROSS JOIN pragma_data_version p
  WHERE c.slot=1 AND c.world_id=? AND c.task_id=? AND c.local_changes=total_changes() AND c.data_version=p.data_version`
const clear='DELETE FROM temp.kanata_task_read_signature'
const store=`INSERT INTO temp.kanata_task_read_signature(slot,world_id,task_id,signature,local_changes,data_version)
  SELECT 1,?,?,?,total_changes()+1,(SELECT data_version FROM pragma_data_version)`
export const taskReadQueries=[header,list,...Object.values(memberQueries),...signatureLinks.map(spec=>spec.sql),bodyChunk,chunk,extensionValid,cached]
export const taskReadWrites=[clear,store]
export const taskReadDdl=[create]

/** @param {Row} row @returns {Header} */
function decode(row){
  return {id:String(row.id),worldId:String(row.world_id),kind:/** @type {Header['kind']} */(row.kind),
    state:/** @type {Header['state']} */(row.state),sourceRevision:Number(row.source_revision),attempt:Number(row.attempt),
    notBefore:Number(row.not_before),leaseUntil:Number(row.lease_until),
    ...(row.conversation_id!==null&&{conversationId:String(row.conversation_id)}),
    ...(row.instance_id!==null&&{instanceId:String(row.instance_id)}),
    idempotencyKey:row.idempotency_key===null?null:String(row.idempotency_key),
    ...(row.idempotency_key===null&&{idempotencyKeyChunked:/** @type {const} */(true)}),
    ...(row.has_error===1&&{errorCode:row.error_code===null?null:String(row.error_code)}),
    ...(row.has_error===1&&row.error_code===null&&{errorCodeChunked:/** @type {const} */(true)}),
    sourceCount:Number(row.source_count),resultEventCount:Number(row.event_count),resultMemoryCount:Number(row.memory_count),
    participantCount:Number(row.participant_count),hasSimulationWindow:row.has_window===1,hasSocial:row.has_social===1,
    hasContact:row.has_contact===1,hasDeferredReply:row.has_reply===1}
}
/** @param {Tx} tx @param {string} worldId @param {string} id */
export async function readTaskHeader(tx,worldId,id){
  validateId(worldId,'worldId');validateId(id,'taskId')
  const [row]=await tx.query(header,[worldId,id])
  return row?decode(row):null
}
/** Preserve the old extension-object validation without materializing it.
 * metadata_json is kept raw: legacy task reads JSON.parse it independently,
 * without imposing the extension clone's depth/finite-number restrictions.
 * @param {Tx} tx @param {string} worldId @param {string} id */
export async function assertTaskExtensions(tx,worldId,id){
  const [row]=await tx.query(extensionValid,[worldId,id])
  need(row,'KANATA_TASK_UNAVAILABLE')
  need(row?.valid===1,'KANATA_SQLITE_INTEGRITY_FAILED')
}
/** @param {Tx} tx @param {string} worldId @param {string} id @returns {Promise<Identity>} */
async function identity(tx,worldId,id){
  validateId(worldId,'worldId');validateId(id,'taskId')
  await tx.execute(create)
  const [proof]=await tx.query(cached,[worldId,id])
  if(proof)return {worldId,taskId:id,signature:String(proof.signature)}
  await assertTaskExtensions(tx,worldId,id)
  const digest=createSha256Stream()
  let signature
  try{
    digest.update(JSON.stringify(['kanata-task-v1',worldId,id]))
    for(let offset=0;;){
      const [row]=await tx.query(bodyChunk,[offset+1,worldId,id])
      need(row&&typeof row.part==='string','KANATA_TASK_UNAVAILABLE')
      const part=String(row.part),length=Array.from(part).length
      digest.update(part);offset+=length
      if(length<4096)break
    }
    for(const spec of signatureLinks){
      digest.update(JSON.stringify([spec.table]))
      let after=''
      for(;;){
        const rows=await tx.query(spec.sql,[worldId,id,after])
        for(const row of rows)digest.update(JSON.stringify([String(row.item)]))
        if(rows.length<50)break
        after=String(rows[rows.length-1].id)
      }
    }
    signature=digest.finish()
  }finally{digest.release()}
  await tx.execute(clear)
  need((await tx.execute(store,[worldId,id,signature])).affectedRows===1,'KANATA_SQLITE_INTEGRITY_FAILED')
  return {worldId,taskId:id,signature}
}
/** @param {Identity} current @param {Identity|undefined} cursor */
function assertIdentity(current,cursor){
  if(cursor)need(cursor.worldId===current.worldId&&cursor.taskId===current.taskId&&cursor.signature===current.signature,'KANATA_TASK_CURSOR_STALE')
}
/** @param {Tx} tx @param {string} worldId @param {string} id @param {Kind} kind @param {Cursor|undefined} cursor @param {number} limit */
async function page(tx,worldId,id,kind,cursor,limit){
  pageLimit(limit)
  const current=await identity(tx,worldId,id)
  assertIdentity(current,cursor)
  if(cursor)need(cursor.kind===kind&&validId(cursor.afterId)
    &&(kind==='events'?safeInteger(cursor.afterOrdinal):cursor.afterOrdinal===-1),'KANATA_TASK_CURSOR_STALE')
  if(kind==='events')await assertDomainArrayOrder(tx,worldId)
  const rows=await tx.query(memberQueries[kind],[worldId,id,kind==='events'?(cursor?.afterOrdinal??-1):(cursor?.afterId??''),limit+1])
  const last=rows[limit-1]
  return {rows:rows.slice(0,limit),cursor:rows.length>limit?{...current,kind,afterId:String(last.id),afterOrdinal:Number(last.ordinal)}:null}
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @returns {import('./kanataDomainTypes').KanataTaskReadRepository} */
export function createTaskRead(operation){
  return {
    taskHeader:(worldId,id)=>operation.transaction(async tx=>{
      const row=await readTaskHeader(tx,worldId,id)
      if(row)await assertTaskExtensions(tx,worldId,id)
      return row
    }),
    listTasks:(worldId,cursor,limit=50)=>{
      const after=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
        validateId(worldId,'worldId');pageLimit(limit)
        if(after)need(after.worldId===worldId&&validId(after.afterId),'KANATA_TASK_CURSOR_STALE')
        const rows=await tx.query(list,[worldId,after?.afterId??'',limit+1])
        for(const row of rows)await assertTaskExtensions(tx,worldId,String(row.id))
        return {tasks:rows.slice(0,limit).map(decode),cursor:rows.length>limit?{worldId,afterId:String(rows[limit-1].id)}:null}
      })
    },
    taskSources:(worldId,id,cursor,limit=50)=>{
      const after=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
        const result=await page(tx,worldId,id,'sources',after,limit)
        return {entries:result.rows.map(row=>({messageId:String(row.id),revision:Number(row.revision)})),cursor:result.cursor}
      })
    },
    taskResults:(worldId,id,kind,cursor,limit=50)=>{
      need(['events','memories','participants'].includes(kind),'KANATA_TASK_CURSOR_STALE')
      const after=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
        const result=await page(tx,worldId,id,kind,after,limit)
        return {ids:result.rows.map(row=>String(row.id)),cursor:result.cursor}
      })
    },
    taskJsonChunk:(worldId,id,field,cursor)=>{
      need(['metadata','extensions','idempotencyKey','errorCode'].includes(field),'KANATA_TASK_CURSOR_STALE')
      const after=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
        const current=await identity(tx,worldId,id)
        assertIdentity(current,after)
        if(after)need(after.field===field&&safeInteger(after.offset)&&safeInteger(after.offset+4097),'KANATA_TASK_CURSOR_STALE')
        const offset=after?.offset??0
        const [row]=await tx.query(chunk,[field,offset+1,worldId,id])
        need(row&&typeof row.part==='string','KANATA_TASK_UNAVAILABLE')
        const points=Array.from(String(row.part))
        return {part:points.slice(0,4096).join(''),cursor:points.length>4096?{...current,field,offset:offset+4096}:null}
      })
    },
  }
}
