// @ts-check
import { validateId } from '../../domain/kanataValidation.js'
import { assertTranscriptHints } from './kanataReplyProvenance.js'
import { requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

// Compatibility snapshots are built and stored in SQLite. No complete tag
// array or opaque extension crosses the bridge during an ordinary edit.
const fields = ['id','worldId','conversationId','role','senderType','senderId','senderNameSnapshot','content',
  'createdAt','revision','status','turnId','batchId','deleted','replyToMessageId','replyToRevision','lifeSources']
const links = `(SELECT json_group_array(json(tag)) FROM (
  SELECT json_object('grantId',l.grant_id,'instanceId',l.instance_id,'moduleId',l.module_id,
    'revision',l.grant_revision,'fingerprint',l.fingerprint) AS tag
  FROM message_life_sources l WHERE l.world_id=m.world_id AND l.message_id=m.id
  ORDER BY l.grant_id,l.grant_revision,l.fingerprint
))`
const omit = (/** @type {string} */ condition, /** @type {string} */ field) => `CASE WHEN ${condition} THEN '$.${field}' ELSE '$[#]' END`
export const messageSnapshotSql = `json_remove(json_set(json_remove(m.extensions_json,${fields.map(field => "'$."+field+"'").join(',')}),
  '$.id',m.id,'$.worldId',m.world_id,'$.conversationId',m.conversation_id,'$.role',m.role,
  '$.senderType',m.sender_type,'$.senderId',m.sender_id,'$.senderNameSnapshot',m.sender_name_snapshot,
  '$.content',m.content,'$.createdAt',m.created_at,'$.revision',m.revision,'$.status',m.status,
  '$.turnId',m.turn_id,'$.batchId',m.batch_id,'$.deleted',json(CASE WHEN m.deleted=1 THEN 'true' ELSE 'false' END),
  '$.replyToMessageId',m.reply_to_message_id,'$.replyToRevision',m.reply_to_revision,
  '$.lifeSources',json(COALESCE(json_extract(m.extensions_json,'$.lifeSources'),${links}))),
  ${omit('m.deleted IS NULL','deleted')},${omit('m.reply_to_message_id IS NULL','replyToMessageId')},
  ${omit('m.reply_to_revision IS NULL','replyToRevision')},
  ${omit("json_type(m.extensions_json,'$.lifeSources') IS NOT 'array' AND NOT EXISTS (SELECT 1 FROM message_life_sources l WHERE l.world_id=m.world_id AND l.message_id=m.id)",'lifeSources')})`
const owner = 'FROM messages m WHERE m.world_id=? AND m.conversation_id=? AND m.id=? AND m.revision=?'
const snapshot = messageSnapshotSql
// Match String.trim(), including Unicode whitespace; a NUL is ordinary
// content, so compare to the empty string rather than SQLite length().
const whitespace = 'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'
const support = `SELECT CASE WHEN json_valid(m.extensions_json) THEN json_type(m.extensions_json)='object'
  AND NOT EXISTS (
    WITH RECURSIVE tree(value,kind,depth) AS (
      SELECT m.extensions_json,'object',0 UNION ALL
      SELECT j.value,j.type,t.depth+1 FROM tree t
      CROSS JOIN json_each(CASE WHEN t.kind IN ('object','array') THEN t.value ELSE '[]' END) j WHERE t.depth<=64
    ) SELECT 1 FROM tree WHERE depth>64 OR (kind='real' AND abs(value)>1.7976931348623157e308) LIMIT 1
  ) ELSE 0 END AS supported,
  trim(m.content,${whitespace})<>'' AND trim(m.sender_name_snapshot,${whitespace})<>'' AS message_valid ${owner}`
const redacted = `json_set(s.body,'$.content','（已删除的原始记录）','$.deleted',json('true'))`
const create = `CREATE TEMP TABLE IF NOT EXISTS kanata_message_audit_stage (
  slot INTEGER PRIMARY KEY CHECK(slot=1),world_id TEXT NOT NULL,conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL
) STRICT`
const stage = `INSERT INTO temp.kanata_message_audit_stage(slot,world_id,conversation_id,id,revision,body)
  SELECT 1,m.world_id,m.conversation_id,m.id,m.revision,${snapshot} ${owner}`
const clear = 'DELETE FROM temp.kanata_message_audit_stage WHERE slot=1 AND world_id=? AND conversation_id=? AND id=? AND revision=?'
const audit = (/** @type {boolean} */ revision) => `WITH input(id,at,content,deleted,status) AS (VALUES(?,?,?,?,?)),
  snapshot AS MATERIALIZED (SELECT s.world_id,s.id,s.revision,s.body FROM temp.kanata_message_audit_stage s
    JOIN messages m ON m.world_id=s.world_id AND m.conversation_id=s.conversation_id AND m.id=s.id AND m.revision=s.revision+1
    WHERE s.slot=1 AND s.world_id=? AND s.conversation_id=? AND s.id=? AND s.revision=?)
INSERT INTO message_audits(id,world_id,message_id,at,previous_revision,next_revision,previous_json,next_json)
SELECT i.id,s.world_id,s.id,i.at,s.revision,s.revision+1,
  ${revision ? `CASE WHEN i.deleted=1 THEN ${redacted} ELSE s.body END` : 's.body'},
  ${revision ? "json_set(s.body,'$.content',i.content,'$.deleted',json(CASE WHEN i.deleted=1 THEN 'true' ELSE 'false' END),'$.revision',s.revision+1)"
    : "json_set(s.body,'$.status',i.status,'$.revision',s.revision+1)"}
FROM snapshot s CROSS JOIN input i`
const revisionAudit = audit(true), statusAudit = audit(false)
const equivalent = (/** @type {boolean} */ replyBase) => `WITH input(body) AS (VALUES(?)),
  snapshot AS MATERIALIZED (SELECT ${replyBase ? `json_remove(${snapshot},'$.lifeSources')` : snapshot} AS body ${owner}),
  a AS (SELECT fullkey,CASE WHEN type IN ('integer','real') THEN 'number' ELSE type END AS type,
    CASE WHEN type IN ('integer','real') THEN CAST(atom AS REAL) ELSE atom END AS atom FROM snapshot,json_tree(snapshot.body)),
  b AS (SELECT fullkey,CASE WHEN type IN ('integer','real') THEN 'number' ELSE type END AS type,
    CASE WHEN type IN ('integer','real') THEN CAST(atom AS REAL) ELSE atom END AS atom FROM input,json_tree(input.body)),
  extra AS (SELECT * FROM a EXCEPT SELECT * FROM b), missing AS (SELECT * FROM b EXCEPT SELECT * FROM a)
SELECT NOT EXISTS(SELECT 1 FROM extra) AND NOT EXISTS(SELECT 1 FROM missing) AS equal`
const equals = equivalent(false), equalsReply = equivalent(true)
export const messageSnapshotQueries = [support,equals,equalsReply]
export const messageSnapshotWrites = [stage,revisionAudit,statusAudit,clear]
export const messageSnapshotDdl = [create]

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
 * @param {import('./kanataRepositoryTypes').KanataMessageScope & {id:string,revision:number}} message */
export async function assertMessageSnapshot(tx, message) {
  const [row] = await tx.query(support,[message.worldId,message.conversationId,message.id,message.revision])
  need(row?.supported===1,'KANATA_SQLITE_INTEGRITY_FAILED')
  need(row?.message_valid===1,'KANATA_MESSAGE_INVALID')
  await assertTranscriptHints(tx,message,[{id:message.id,revision:message.revision}])
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
 * @param {import('./kanataRepositoryTypes').KanataMessageScope & {id:string,revision:number}} message
 * @param {{content:string,deleted:boolean}|{status:import('../../domain/kanataTypes').Message['status']}} change
 * @param {{id:()=>string,clock:()=>number}} tools @param {()=>Promise<void>} apply */
export async function auditMessageChange(tx,message,change,tools,apply) {
  const id=tools.id(), at=tools.clock()
  validateId(id,'auditId')
  need(safeInteger(at),'KANATA_MESSAGE_AUDIT_INVALID')
  const bindings=[message.worldId,message.conversationId,message.id,message.revision]
  // A leftover row is rejected by the single-slot primary key. Never clear an
  // unknown stage to make a failed operation appear recoverable.
  need((await tx.execute(stage,bindings)).affectedRows===1,'KANATA_MESSAGE_AUDIT_INVALID')
  await apply()
  const revision='content' in change
  const result=await tx.execute(revision ? revisionAudit : statusAudit,[id,at,
    revision ? change.content : null,revision ? Number(change.deleted) : null, 'status' in change ? change.status : null,
    message.worldId,message.conversationId,message.id,message.revision])
  need(result.affectedRows===1,'KANATA_MESSAGE_AUDIT_INVALID')
  need((await tx.execute(clear,bindings)).affectedRows===1,'KANATA_MESSAGE_AUDIT_INVALID')
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx */
export async function prepareMessageAudit(tx) { await tx.execute(create) }

/** Compare an explicit input DTO inside SQLite, without reading the persisted
 * complete object back into JS. Object property order is immaterial; array
 * order, missing fields, primitive types and unknown extensions are not.
 * @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} tx
 * @param {import('../../domain/kanataTypes').Message} message @param {number} revision @param {boolean} replyBase */
export async function equalStoredMessage(tx,message,revision,replyBase) {
  const [row]=await tx.query(replyBase ? equalsReply : equals,[JSON.stringify(message),message.worldId,message.conversationId,message.id,revision])
  return row?.equal===1
}
