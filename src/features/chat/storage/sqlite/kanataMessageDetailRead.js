// @ts-check
import { validateId, cloneKanataJson } from '../../domain/kanataValidation.js'
import { messageSnapshotSql, assertMessageSnapshot } from './kanataMessageSnapshot.js'
import { equalDto, pageLimit, requireSqliteValue as need, safeInteger, scopeBindings, validId } from './kanataRepositoryValues.js'

/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageDetailIdentity} Identity */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageSourceCursor} SourceCursor */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageJsonCursor} JsonCursor */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageJsonSelection} Selection */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageTextCursor} TextCursor */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
const revision = 'SELECT revision FROM messages WHERE world_id=? AND conversation_id=? AND id=?'
const sources = `SELECT grant_id,instance_id,module_id,grant_revision,fingerprint FROM message_life_sources
  WHERE world_id=? AND message_id=? AND (grant_id,grant_revision,fingerprint)>(?,?,?)
  ORDER BY grant_id,grant_revision,fingerprint LIMIT ?`
const chunk = `SELECT substr(CASE ? WHEN 'snapshot' THEN ${messageSnapshotSql} WHEN 'content' THEN json_quote(m.content)
  WHEN 'senderName' THEN json_quote(m.sender_name_snapshot) ELSE m.extensions_json END,?,4097) AS part
  FROM messages m WHERE m.world_id=? AND m.conversation_id=? AND m.id=? AND m.revision=?`
const auditChunk = `SELECT substr(CASE WHEN ?='previous' THEN a.previous_json ELSE a.next_json END,?,4097) AS part
  FROM message_audits a JOIN messages m ON m.world_id=a.world_id AND m.id=a.message_id
  WHERE m.world_id=? AND m.conversation_id=? AND m.id=? AND m.revision=? AND a.id=?`
// Hex transports raw UTF-8 bytes without SQLite TEXT substr's embedded-NUL
// termination. At most 2048 bytes/4096 ASCII hex digits cross the bridge.
// One byte is reserved for lookahead; decoded text also stays below 4096.
const textChunk=`SELECT hex(substr(CAST(CASE ? WHEN 'content' THEN content ELSE sender_name_snapshot END AS BLOB),?,2048)) AS part
  FROM messages WHERE world_id=? AND conversation_id=? AND id=? AND revision=?`
export const messageDetailQueries = [revision,sources,chunk,auditChunk,textChunk]

/** @param {Tx} tx @param {Scope} scope @param {string} id @returns {Promise<Identity>} */
async function identity(tx,scope,id) {
  validateId(id,'messageId')
  const [row]=await tx.query(revision,[...scopeBindings(scope),id])
  need(row,'KANATA_MESSAGE_UNAVAILABLE')
  const current={worldId:scope.worldId,conversationId:scope.conversationId,id,revision:Number(row.revision)}
  await assertMessageSnapshot(tx,current)
  return current
}
/** @param {Identity} current @param {Identity|undefined} cursor */
function assertIdentity(current,cursor) {
  if(cursor) need(cursor.worldId===current.worldId && cursor.conversationId===current.conversationId
    && cursor.id===current.id && cursor.revision===current.revision,'KANATA_MESSAGE_CURSOR_INVALID')
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation */
export function createMessageDetailRead(operation) {
  return {
    /** Raw human-readable text, one UTF-8 boundary-aligned fragment. No JSON
     * decoder state or caller-provided tail can inject a continuation value.
     * @param {Scope} scope @param {string} id @param {'content'|'senderName'} field @param {TextCursor} [cursor] */
    textChunk:(scope,id,field,cursor)=>{
      scope=cloneKanataJson(scope);cursor=cursor?cloneKanataJson(cursor):undefined
      need(['content','senderName'].includes(field),'KANATA_MESSAGE_CURSOR_INVALID')
      return operation.transaction(async tx=>{
        const current=await identity(tx,scope,id)
        assertIdentity(current,cursor)
        if(cursor)need(cursor.kind==='text'&&cursor.field===field&&safeInteger(cursor.offset)
          &&safeInteger(cursor.offset+4097),'KANATA_MESSAGE_CURSOR_INVALID')
        const offset=cursor?.offset??0
        const [row]=await tx.query(textChunk,[field,offset+1,current.worldId,current.conversationId,id,current.revision])
        need(row&&typeof row.part==='string'&&/^(?:[A-F0-9]{2}){0,2048}$/.test(row.part),'KANATA_SQLITE_INTEGRITY_FAILED')
        const hex=String(row.part),bytes=new Uint8Array(hex.length/2)
        for(let index=0;index<bytes.length;index++)bytes[index]=parseInt(hex.slice(index*2,index*2+2),16)
        need(!bytes.length||(bytes[0]&0xc0)!==0x80,'KANATA_MESSAGE_CURSOR_INVALID')
        let count=Math.min(2047,bytes.length)
        while(count>0&&count<bytes.length&&(bytes[count]&0xc0)===0x80)count--
        const fragment=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count))
        return {fragment,cursor:bytes.length>count?{...current,kind:/** @type {const} */('text'),field,offset:offset+count}:null}
      })
    },
    /** Normalized links are a fixed record page. The exact original hint array
     * (order, duplicates and unknown fields) remains available via JSON chunks.
     * @param {Scope} scope @param {string} id @param {SourceCursor} [cursor] @param {number} [limit] */
    sourcePage:(scope,id,cursor,limit=50)=>{
      scope=cloneKanataJson(scope);cursor=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
      const current=await identity(tx,scope,id)
      assertIdentity(current,cursor)
      if(cursor) need(cursor.kind==='sources' && validId(cursor.grantId) && safeInteger(cursor.grantRevision,1)
        && /^[a-f0-9]{64}$/.test(cursor.fingerprint),'KANATA_MESSAGE_CURSOR_INVALID')
      const rows=await tx.query(sources,[current.worldId,id,cursor?.grantId??'',cursor?.grantRevision??0,cursor?.fingerprint??'',pageLimit(limit)+1])
      const last=rows[limit-1]
      return {rows:rows.slice(0,limit).map(row=>({grantId:String(row.grant_id),instanceId:String(row.instance_id),
        moduleId:/** @type {import('../../domain/kanataTypes').LifeSource['moduleId']} */(row.module_id),
        revision:Number(row.grant_revision),fingerprint:String(row.fingerprint)})),
      cursor:rows.length>limit ? {...current,kind:/** @type {const} */('sources'),grantId:String(last.grant_id),
        grantRevision:Number(last.grant_revision),fingerprint:String(last.fingerprint)} : null}
      })
    },
    /** @param {Scope} scope @param {string} id @param {Selection} selection @param {JsonCursor} [cursor] */
    jsonChunk:(scope,id,selection,cursor)=>{
      scope=cloneKanataJson(scope);selection=cloneKanataJson(selection);cursor=cursor?cloneKanataJson(cursor):undefined
      return operation.transaction(async tx=>{
      need(selection && ['snapshot','extensions','content','senderName','audit'].includes(selection.kind),'KANATA_MESSAGE_CURSOR_INVALID')
      const selected=selection.kind==='audit' ? {kind:selection.kind,auditId:selection.auditId,side:selection.side} : {kind:selection.kind}
      if(selection.kind==='audit') {
        validateId(selection.auditId,'auditId')
        need(['previous','next'].includes(selection.side),'KANATA_MESSAGE_CURSOR_INVALID')
      }
      const current=await identity(tx,scope,id)
      assertIdentity(current,cursor)
      if(cursor) need(cursor.kind==='json' && equalDto(cursor.selection,selected)
        && safeInteger(cursor.offset) && safeInteger(cursor.offset+4097),'KANATA_MESSAGE_CURSOR_INVALID')
      const offset=cursor?.offset??0
      const keys=[current.worldId,current.conversationId,id,current.revision]
      const [row]=selection.kind==='audit' ? await tx.query(auditChunk,[selection.side,offset+1,...keys,selection.auditId])
        : await tx.query(chunk,[selection.kind,offset+1,...keys])
      need(row && typeof row.part==='string','KANATA_MESSAGE_UNAVAILABLE')
      const points=Array.from(String(row.part))
      return {fragment:points.slice(0,4096).join(''),cursor:points.length>4096 ? {
        ...current,kind:/** @type {const} */('json'),selection:selected,offset:offset+4096,
      } : null}
      })
    },
  }
}
