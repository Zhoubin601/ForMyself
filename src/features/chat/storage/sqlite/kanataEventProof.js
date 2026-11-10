// @ts-check
import { grantAccess, grantAllowed, grantBindings } from './kanataProvenance.js'
import { requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */

const create = `CREATE TEMP TABLE kanata_event_proof (
  ordinal INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE, tag TEXT NOT NULL
)`
const drop = 'DROP TABLE temp.kanata_event_proof'
const add = `INSERT INTO temp.kanata_event_proof(identity,tag)
  SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE 1 ORDER BY key
  ON CONFLICT(identity) DO UPDATE SET tag=excluded.tag`
const any = 'SELECT 1 FROM temp.kanata_event_proof LIMIT 1'
const denied = `WITH ${grantAccess}, tags AS (
  SELECT ? AS world_id,json_extract(tag,'$.grantId') AS grant_id,
    json_extract(tag,'$.instanceId') AS instance_id,json_extract(tag,'$.moduleId') AS module_id,
    json_extract(tag,'$.revision') AS grant_revision FROM temp.kanata_event_proof
)
SELECT 1 FROM tags s CROSS JOIN access WHERE NOT ${grantAllowed} LIMIT 1`
export const orderedEventTags = `(SELECT json_group_array(json(tag)) FROM (
  SELECT tag FROM temp.kanata_event_proof ORDER BY ordinal
))`
const store = `UPDATE world_events SET extensions_json=json_set(extensions_json,'$.lifeSources',json(${orderedEventTags}))
  WHERE world_id=? AND id=? AND EXISTS (SELECT 1 FROM temp.kanata_event_proof)`
export const storeEventProofLinks = `INSERT INTO event_life_sources(world_id,event_id,grant_id,instance_id,module_id,grant_revision,fingerprint)
  SELECT ?,?,json_extract(tag,'$.grantId'),json_extract(tag,'$.instanceId'),json_extract(tag,'$.moduleId'),
    json_extract(tag,'$.revision'),json_extract(tag,'$.fingerprint') FROM temp.kanata_event_proof`

export const eventProofDdl = [create, drop]
export const eventProofQueries = [any, denied]
export const eventProofWrites = [add, store, storeEventProofLinks]

/** @template T @param {Tx} tx @param {AsyncIterable<LifeSource>} sources @param {()=>Promise<T>} persist */
export async function withEventProof(tx, sources, persist) {
  await tx.execute(create)
  /** @type {[string,string][]} */
  const batch = []
  const flush = async () => tx.execute(add, [JSON.stringify(batch.splice(0))])
  for await (const tag of sources) {
    // Match Map: the first identity keeps its position, the last value keeps its extensions.
    batch.push([JSON.stringify([tag.grantId, tag.revision, tag.fingerprint]), JSON.stringify(tag)])
    if (batch.length === 50) await flush()
  }
  if (batch.length) await flush()
  const result = await persist()
  await tx.execute(drop)
  return result
}

/** @param {Tx} tx @param {string} worldId @param {Iterable<string>|AsyncIterable<string>} roles @param {boolean} group */
export async function authorizeEventProof(tx, worldId, roles, group) {
  const [present] = await tx.query(any)
  if (!present) return
  let hasRole = false
  for await (const instanceId of roles) {
    hasRole = true
    const [failure] = await tx.query(denied, [...grantBindings({worldId, instanceId, group, remember:true}), worldId])
    need(!failure, 'KANATA_LIFE_PERMISSION_DENIED')
  }
  need(hasRole, 'EVENT_LIFE_PERMISSION_DENIED')
}

/** @param {Tx} tx @param {string} worldId @param {string} id */
export async function storeEventProof(tx, worldId, id) {
  await tx.execute(store, [worldId, id])
  await tx.execute(storeEventProofLinks, [worldId, id])
}
