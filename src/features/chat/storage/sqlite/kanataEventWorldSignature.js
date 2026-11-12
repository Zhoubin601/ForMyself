// @ts-check
import { createSha256Stream } from '../../../../shared/crypto/sha256Stream.js'
import { assertDomainArrayOrder } from './kanataArrayOrder.js'
import { requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */

// Every stored authority/extension column is covered. Related source/link rows
// are streamed separately; an absent order hint never hides a normalized change.
const entities = [
  { table: 'world_events', order: 'event_array_order', columns: ['id','world_id','status','visibility','summary','effective_at','recorded_at','revision','causality','kind','action_instance_id','action_relationship_id','action_location','replaces_event_id','extensions_json'] },
  { table: 'world_effects', order: 'effect_array_order', columns: ['id','world_id','event_id','target_type','target_id','target_instance_id','target_relationship_id','operation','path','value_json','rule_version','extensions_json'] },
  { table: 'effect_baselines', order: 'baseline_array_order', columns: ['id','world_id','target_type','target_id','target_instance_id','target_relationship_id','path','value_json','extensions_json'] },
].map(spec => {
  const body = `json_array(${spec.columns.map(column=>'e.'+column).join(',')})`
  const from = `FROM ${spec.order} o CROSS JOIN ${spec.table} e
    ON e.world_id=o.world_id AND e.id=o.entity_id WHERE o.world_id=?`
  return { ...spec,
    page: `SELECT o.ordinal,e.id,length(${body}) AS size,CASE WHEN length(${body})<=4096 THEN ${body} END AS item
      ${from} AND o.ordinal>? ORDER BY o.ordinal LIMIT 50`,
    chunk: `SELECT substr(${body},?,4096) AS part FROM ${spec.table} e WHERE e.world_id=? AND e.id=?`,
  }
})
const links = [
  { table: 'event_participants', keys: ['participant_id'], values: ['participant_id'] },
  { table: 'event_causes', keys: ['cause_event_id'], values: ['cause_event_id'] },
  { table: 'event_sources', keys: ['message_id'], values: ['message_id','message_revision'] },
  { table: 'event_life_sources', keys: ['grant_id','grant_revision','fingerprint'], values: ['grant_id','instance_id','module_id','grant_revision','fingerprint'] },
].map(spec => {
  const columns = ['o.ordinal',...spec.keys.map(key=>'l.'+key)]
  return { ...spec, page: `SELECT o.ordinal,${spec.keys.map(key=>'l.'+key).join(',')},
    json_array(l.event_id,${spec.values.map(key=>'l.'+key).join(',')}) AS item
    FROM event_array_order o CROSS JOIN ${spec.table} l ON l.world_id=o.world_id AND l.event_id=o.entity_id
    WHERE o.world_id=? AND (${columns.join(',')})>(${columns.map(()=>'?').join(',')})
    ORDER BY ${columns.join(',')} LIMIT 50` }
})
export const eventWorldSignatureQueries = Object.freeze([
  ...entities.flatMap(({page,chunk})=>[page,chunk]), ...links.map(({page})=>page),
])

/** Full-world incremental signature with at most 50 bounded rows, or one JSON
 * chunk, live at a time. No Event/Effect/Baseline DTO is reconstructed in JS.
 * Raw extension representation is included conservatively as stored world data.
 * @param {Tx} tx @param {string} worldId */
export async function eventWorldSignature(tx, worldId) {
  await assertDomainArrayOrder(tx,worldId)
  const digest=createSha256Stream()
  /** @param {string} part */
  const update=part=>digest.update(part)
  try {
    update(JSON.stringify(['kanata-world-events-v1',worldId]))
    for(const spec of entities){
      update(JSON.stringify(['table',spec.table]))
      let after=-1
      for(;;){
        const rows=await tx.query(spec.page,[worldId,after])
        for(const row of rows){
          const ordinal=Number(row.ordinal),size=Number(row.size)
          need(safeInteger(ordinal)&&safeInteger(size),'KANATA_SQLITE_INTEGRITY_FAILED')
          update(JSON.stringify(['row',ordinal,String(row.id),size]))
          if(row.item!==null){
            need(typeof row.item==='string'&&size<=4096,'KANATA_SQLITE_INTEGRITY_FAILED')
            update(String(row.item))
          }else{
            for(let offset=0;offset<size;){
              const [chunk]=await tx.query(spec.chunk,[offset+1,worldId,String(row.id)])
              need(chunk&&typeof chunk.part==='string','KANATA_SQLITE_INTEGRITY_FAILED')
              const part=String(chunk.part),count=Array.from(part).length
              need(count===Math.min(4096,size-offset),'KANATA_SQLITE_INTEGRITY_FAILED')
              update(part);offset+=count
            }
          }
        }
        if(rows.length<50)break
        after=Number(rows[rows.length-1].ordinal)
      }
    }
    for(const spec of links){
      update(JSON.stringify(['links',spec.table]))
      /** @type {(string|number)[]} */
      let cursor=[-1,...spec.keys.map(key=>key==='grant_revision'?0:'')]
      for(;;){
        const rows=await tx.query(spec.page,[worldId,...cursor])
        for(const row of rows)update(JSON.stringify([Number(row.ordinal),String(row.item)]))
        if(rows.length<50)break
        const last=rows[rows.length-1]
        cursor=[Number(last.ordinal),...spec.keys.map(key=>key==='grant_revision'?Number(last[key]):String(last[key]))]
      }
    }
    return digest.finish()
  } finally {
    digest.release()
  }
}
