// @ts-check
import { visitEventPromptGrants } from './kanataEventRepository.js'
import { visitMemoryPromptGrants } from './kanataMemoryRepository.js'
import { requireLifeSources } from './kanataProvenance.js'
import { requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataRepositoryTypes').KanataReplyProvenance} Provenance */
/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */

const create = `CREATE TEMP TABLE kanata_reply_proof (
  ordinal INTEGER PRIMARY KEY, section INTEGER NOT NULL, identity TEXT NOT NULL, tag TEXT NOT NULL,
  UNIQUE(section,identity)
)`
const drop = 'DROP TABLE temp.kanata_reply_proof'
const input = `WITH args(world,conversation,refs) AS (VALUES(?,?,?)), roots AS MATERIALIZED (
  SELECT j.key AS position, m.id,m.world_id,
    json_extract(m.extensions_json,'$.lifeSources') AS hint,
    json_type(m.extensions_json,'$.lifeSources') AS hint_type
  FROM args CROSS JOIN json_each(args.refs) j
  JOIN messages m ON m.world_id=args.world AND m.conversation_id=args.conversation
    AND m.id=json_extract(j.value,'$.id') AND m.revision=json_extract(j.value,'$.revision')
)`
const invalidHints = input + `, hinted AS MATERIALIZED (
  SELECT * FROM roots WHERE hint_type='array'
), declared AS MATERIALIZED (
  SELECT r.id,j.type,j.value AS tag,
    CASE WHEN j.type='object' THEN json_extract(j.value,'$.grantId') END AS grant_id,
    CASE WHEN j.type='object' THEN json_extract(j.value,'$.instanceId') END AS instance_id,
    CASE WHEN j.type='object' THEN json_extract(j.value,'$.moduleId') END AS module_id,
    CASE WHEN j.type='object' AND json_type(j.value,'$.revision')='integer' THEN json_extract(j.value,'$.revision') END AS revision,
    CASE WHEN j.type='object' THEN json_extract(j.value,'$.fingerprint') END AS fingerprint
  FROM hinted r CROSS JOIN json_each(r.hint) j
), normalized AS MATERIALIZED (
  SELECT r.id,l.grant_id,l.instance_id,l.module_id,l.grant_revision AS revision,l.fingerprint
  FROM hinted r CROSS JOIN message_life_sources l
  WHERE l.world_id=r.world_id AND l.message_id=r.id
), extra AS (
  SELECT id,grant_id,instance_id,module_id,revision,fingerprint FROM declared EXCEPT SELECT * FROM normalized
), missing AS (
  SELECT * FROM normalized EXCEPT SELECT id,grant_id,instance_id,module_id,revision,fingerprint FROM declared
)
SELECT 1 WHERE EXISTS (SELECT 1 FROM roots WHERE hint_type NOT IN ('null','array'))
  OR EXISTS (SELECT 1 FROM declared WHERE type<>'object')
  OR EXISTS (SELECT 1 FROM extra) OR EXISTS (SELECT 1 FROM missing)
  OR EXISTS (SELECT 1 FROM declared GROUP BY id,tag HAVING count(*)>1)`
const fromHistory = input + `, ordered AS (
  SELECT r.position,j.key AS hint_position,'' AS grant_id,0 AS revision,'' AS fingerprint,json(j.value) AS tag
  FROM roots r CROSS JOIN json_each(CASE WHEN r.hint_type='array' THEN r.hint ELSE '[]' END) j
  UNION ALL
  SELECT r.position,0,l.grant_id,l.grant_revision,l.fingerprint,
    json_object('grantId',l.grant_id,'instanceId',l.instance_id,'moduleId',l.module_id,
      'revision',l.grant_revision,'fingerprint',l.fingerprint)
  FROM roots r CROSS JOIN message_life_sources l
  WHERE (r.hint_type IS NULL OR r.hint_type='null') AND l.world_id=r.world_id AND l.message_id=r.id
)
INSERT INTO temp.kanata_reply_proof(section,identity,tag)
SELECT 0,tag,tag FROM ordered WHERE 1 ORDER BY position,hint_position,grant_id,revision,fingerprint
ON CONFLICT(section,identity) DO NOTHING`
const add = `INSERT INTO temp.kanata_reply_proof(section,identity,tag)
  SELECT ?,json_extract(value,'$.identity'),json_extract(value,'$.tag') FROM json_each(?) WHERE 1
  ON CONFLICT(section,identity) DO UPDATE SET tag=excluded.tag`
const addAliases = `INSERT INTO temp.kanata_reply_proof(section,identity,tag)
  SELECT -1,tag,tag FROM (
    SELECT p.ordinal,json_set(p.tag,'$.grantId',g.id,'$.revision',g.revision,'$.instanceId',g.instance_id) AS tag
    FROM temp.kanata_reply_proof p JOIN life_grants g ON g.world_id=? AND g.instance_id=?
      AND g.module_id=json_extract(p.tag,'$.moduleId') WHERE p.section>=0
  ) WHERE 1 ORDER BY ordinal ON CONFLICT(section,identity) DO NOTHING`
const orderedTags = `(SELECT json_group_array(json(tag)) FROM (
  SELECT tag FROM temp.kanata_reply_proof GROUP BY tag ORDER BY min(ordinal)
))`
const store = `UPDATE messages SET extensions_json=json_set(extensions_json,'$.lifeSources',json(${orderedTags}))
  WHERE world_id=? AND conversation_id=? AND id=?`
const stored = `SELECT 1 FROM messages WHERE world_id=? AND conversation_id=? AND id=?
  AND json_extract(extensions_json,'$.lifeSources')=${orderedTags}`
const storeLinks = `INSERT INTO message_life_sources(world_id,message_id,grant_id,instance_id,module_id,grant_revision,fingerprint)
  SELECT DISTINCT ?,?,json_extract(tag,'$.grantId'),json_extract(tag,'$.instanceId'),json_extract(tag,'$.moduleId'),
    json_extract(tag,'$.revision'),json_extract(tag,'$.fingerprint') FROM temp.kanata_reply_proof`

export const replyProofQueries = [invalidHints, stored]
export const replyProofWrites = [fromHistory, add, addAliases, store, storeLinks]
export const replyProofDdl = [create, drop]

/** @param {Tx} tx @param {Scope} scope @param {Provenance['history']} history */
export async function assertTranscriptHints(tx, scope, history) {
  const invalid = await tx.query(invalidHints, [scope.worldId, scope.conversationId, JSON.stringify(history)])
  need(invalid.length === 0, 'KANATA_SQLITE_INTEGRITY_FAILED')
}

/** Use a transaction-local SQL work table for provenance ordering and deduplication.
 * @param {Tx} tx @param {Scope & {instanceId:string,group:boolean}} scope @param {Provenance} sources
 * @param {(persist:(id:string,existing:boolean)=>Promise<void>)=>Promise<void>} append */
export async function withReplyProvenance(tx, scope, sources, append) {
  const { worldId, conversationId, instanceId } = scope
  await tx.execute(create)
  await tx.execute(fromHistory, [worldId, conversationId, JSON.stringify(sources.history)])
  let section = 0
  /** @type {{identity:string,tag:string}[]} */
  const batch = []
  async function flush() {
    if (batch.length) await tx.execute(add, [section, JSON.stringify(batch.splice(0))])
  }
  /** @param {LifeSource} tag */
  async function visit(tag) {
    batch.push({ identity: JSON.stringify([tag.grantId, tag.revision, tag.fingerprint]), tag: JSON.stringify(tag) })
    if (batch.length === 50) await flush()
  }
  for (const entry of sources.memories) {
    section++
    await visitMemoryPromptGrants(tx, scope, entry, visit)
    await flush()
  }
  for (const entry of sources.events) {
    section++
    await visitEventPromptGrants(tx, worldId, entry, scope, visit)
    await flush()
  }
  await requireLifeSources(tx, sources.life, scope)
  section++
  for (const tag of sources.life) await visit(tag)
  await flush()
  await tx.execute(addAliases, [worldId, instanceId])
  await append(async (id, existing) => {
    const keys = [worldId, conversationId, id]
    if (existing) {
      need((await tx.query(stored, keys)).length === 1, 'KANATA_MESSAGE_ID_CONFLICT')
      await assertTranscriptHints(tx, scope, [{id,revision:1}])
      return
    }
    need((await tx.execute(store, keys)).affectedRows === 1, 'KANATA_MESSAGE_INSERT_FAILED')
    await tx.execute(storeLinks, [worldId, id])
  })
  await tx.execute(drop)
}
