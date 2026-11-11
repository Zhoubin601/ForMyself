// @ts-check
import { orderedEventTags } from './kanataEventProof.js'

/** @type {{field:string,table:string,keys:Record<string,string|null>,order?:string}[]} */
const relations = [
  { field:'participantIds', table:'event_participants', keys:{participant_id:null} },
  { field:'causedByEventIds', table:'event_causes', keys:{cause_event_id:null} },
  { field:'sourceRefs', table:'event_sources', keys:{message_id:'messageId',message_revision:'revision'} },
  { field:'lifeSources', table:'event_life_sources', keys:{
    grant_id:'grantId',instance_id:'instanceId',module_id:'moduleId',grant_revision:'revision',fingerprint:'fingerprint',
  }, order:'grant_id,grant_revision,fingerprint' },
]

const projections = relations.map(({field,table,keys,order}) => {
  const columns = Object.keys(keys)
  const scalar = columns.length === 1
  const member = scalar ? 'l.' + columns[0] : 'json_object(' +
    Object.entries(keys).map(([column,key]) => "'" + key + "',l." + column).join(',') + ')'
  const hint = "json_extract(e.extensions_json,'$." + field + "')"
  const type = "json_type(e.extensions_json,'$." + field + "')"
  const owner = 'l.world_id=e.world_id AND l.event_id=e.id'
  const array = `(SELECT json_group_array(${scalar ? 'item' : 'json(item)'}) FROM (
    SELECT ${member} AS item FROM ${table} l WHERE ${owner} ORDER BY ${order ?? columns[0]}
  ))`
  const declared = columns.map(column => {
    if(scalar)return 'j.value AS '+column
    return `CASE WHEN j.type='object' THEN json_extract(j.value,'$.${keys[column]}') END AS ${column}`
  }).join(',')
  const invalidType = scalar ? "j.type<>'text'" : `j.type<>'object' OR ${columns.map(column => {
    const type = keys[column]==='revision' ? "('integer','real')" : "('text')"
    return `CASE WHEN j.type='object' THEN json_type(j.value,'$.${keys[column]}') NOT IN ${type} ELSE 1 END`
  }).join(' OR ')}`
  const names = columns.join(',')
  const valid = `CASE
    WHEN ${type} IS NULL THEN 1
    WHEN ${type}<>'array' THEN 0
    WHEN json_array_length(${hint})<>(SELECT count(*) FROM ${table} l WHERE ${owner}) THEN 0
    ELSE NOT EXISTS (
      WITH declared AS MATERIALIZED (
        SELECT ${declared},CASE WHEN ${invalidType} THEN 1 ELSE 0 END AS invalid
        FROM json_each(${hint}) j
      ), normalized AS MATERIALIZED (
        SELECT ${names} FROM ${table} l WHERE ${owner}
      ), extra AS (SELECT ${names} FROM declared EXCEPT SELECT * FROM normalized),
      missing AS (SELECT * FROM normalized EXCEPT SELECT ${names} FROM declared)
      SELECT 1 WHERE EXISTS(SELECT 1 FROM declared WHERE invalid=1)
        OR EXISTS(SELECT 1 FROM extra) OR EXISTS(SELECT 1 FROM missing)
    ) END`
  return {field, value:`COALESCE(${hint},${array})`,valid}
})
const action = `json_set(
  CASE json_type(e.extensions_json,'$.action')
    WHEN 'object' THEN json_extract(e.extensions_json,'$.action')
    WHEN 'array' THEN (SELECT json_group_object(CAST(key AS TEXT),json(extensions_json -> fullkey))
      FROM json_each(extensions_json,'$.action'))
    ELSE '{}' END,
  '$.instanceId',e.action_instance_id,'$.relationshipId',e.action_relationship_id,'$.location',e.action_location
)`
const remove = (/** @type {string} */ predicate, /** @type {string} */ field) =>
  `CASE WHEN ${predicate} THEN '$.${field}' ELSE '$[#]' END`
const withoutMissingAction = `json_remove(${action},
  ${remove('e.action_instance_id IS NULL','instanceId')},
  ${remove('e.action_relationship_id IS NULL','relationshipId')},
  ${remove('e.action_location IS NULL','location')})`
const snapshot = `json_remove(json_set(e.extensions_json,
  '$.id',e.id,'$.worldId',e.world_id,'$.status',e.status,'$.visibility',e.visibility,'$.summary',e.summary,
  '$.effectiveAt',e.effective_at,'$.recordedAt',e.recorded_at,'$.revision',e.revision,
  '$.causality',e.causality,'$.kind',e.kind,'$.replacesEventId',e.replaces_event_id,
  '$.action',json(${withoutMissingAction}),
  ${projections.map(({field,value}) => "'$." + field + "',json(" + value + ")").join(',')}
),
  ${remove('e.causality IS NULL','causality')},
  ${remove('e.kind IS NULL','kind')},
  ${remove('e.replaces_event_id IS NULL','replacesEventId')},
  ${remove("json_type(e.extensions_json,'$.action') IS NULL AND e.action_instance_id IS NULL AND e.action_relationship_id IS NULL AND e.action_location IS NULL",'action')},
  ${remove("json_type(e.extensions_json,'$.lifeSources') IS NULL AND NOT EXISTS (SELECT 1 FROM event_life_sources l WHERE l.world_id=e.world_id AND l.event_id=e.id)",'lifeSources')}
)`
const scope = 'FROM world_events e WHERE e.world_id=? AND e.id=? AND e.revision=?'
const extensionJsonValid = `NOT EXISTS (
  WITH RECURSIVE tree(value,kind,depth) AS (
    SELECT e.extensions_json,'object',0
    UNION ALL SELECT j.value,j.type,t.depth+1 FROM tree t
      CROSS JOIN json_each(CASE WHEN t.kind IN ('object','array') THEN t.value ELSE '[]' END) j
      WHERE t.depth<=64
  ) SELECT 1 FROM tree WHERE depth>64
    OR (kind='real' AND abs(value)>1.7976931348623157e308) LIMIT 1
)`
const valid = `CASE WHEN json_valid(e.extensions_json) THEN json_type(e.extensions_json)='object'
  AND ${extensionJsonValid} AND ${projections.map(({valid}) => '('+valid+')').join(' AND ')} ELSE 0 END`
export const eventAuditSupport = `SELECT CASE WHEN ${valid}
  THEN CASE WHEN json_type(e.extensions_json,'$.action') IS 'text' THEN 0 ELSE 1 END
  ELSE -1 END AS supported ${scope}`
const auditSql = (/** @type {boolean} */ commit) => `WITH input(id,at,old_status) AS (VALUES(?,?,?)), snapshot AS MATERIALIZED (
  SELECT e.world_id,e.id,e.status,e.revision,${snapshot} AS body ${scope} AND ${valid}
)
INSERT INTO event_audits(id,world_id,event_id,at,previous_revision,next_revision,previous_json,next_json)
SELECT input.id,s.world_id,s.id,input.at,s.revision-1,s.revision,
  json_set(s.body,'$.status',input.old_status,'$.revision',s.revision-1),
  ${commit ? `CASE WHEN EXISTS (SELECT 1 FROM temp.kanata_event_proof)
    THEN json_set(s.body,'$.lifeSources',json(${orderedEventTags})) ELSE s.body END` : 's.body'}
FROM snapshot s CROSS JOIN input`
export const writeEventCommitAudit = auditSql(true)
export const writeEventStatusAudit = auditSql(false)
const scalarFields = ['id','worldId','status','visibility','summary','effectiveAt','recordedAt','revision','causality','kind','replacesEventId']
export const updateEventFromAudit = `UPDATE world_events SET extensions_json=(SELECT json_remove(next_json,${scalarFields.map(field => "'$."+field+"'").join(',')})
    FROM event_audits a WHERE a.world_id=world_events.world_id AND a.event_id=world_events.id AND a.id=?)
  WHERE world_id=? AND id=? AND revision=?`
// Reuse the same projections for correction so its source traversal follows the historical hints.
const correctionPage = (/** @type {string} */ field) => `SELECT j.key AS position,
  json_quote(j.value) AS item FROM world_events e
  CROSS JOIN json_each(${projections.find(p=>p.field===field)?.value}) j
  WHERE e.world_id=? AND e.id=? AND j.key>? ORDER BY j.key LIMIT 50`
export const correctionSourceRefs = correctionPage('sourceRefs')
export const correctionCauses = correctionPage('causedByEventIds')
export const correctionTags = correctionPage('lifeSources')
export const insertEventCorrection = `INSERT INTO world_events(world_id,id,status,visibility,summary,effective_at,recorded_at,revision,
  causality,kind,action_instance_id,action_relationship_id,action_location,replaces_event_id,extensions_json)
  SELECT e.world_id,?,'candidate',e.visibility,?,e.effective_at,?,1,
    e.causality,e.kind,e.action_instance_id,e.action_relationship_id,e.action_location,e.id,
    json_remove(${snapshot},${scalarFields.map(field=>"'$."+field+"'").join(',')})
  FROM world_events e WHERE e.world_id=? AND e.id=?`
const copyLinks = (/** @type {string} */ table, /** @type {string} */ columns) =>
  `INSERT INTO ${table}(world_id,event_id,${columns}) SELECT world_id,?,${columns} FROM ${table}
    WHERE world_id=? AND event_id=?`
export const eventCorrectionLinks = [
  copyLinks('event_participants','participant_id'), copyLinks('event_causes','cause_event_id'),
  copyLinks('event_sources','message_id,message_revision'),
]
// Keep oversized members out of the page. The same ordinal can be read in JSON chunks.
const relationRead = projections.map(({field,value}) => {
  const from = `FROM world_events e CROSS JOIN json_each(${value}) j
    WHERE e.world_id=? AND e.id=? AND e.revision=?`
  const item = 'json_quote(j.value)'
  return {field,
    page:`SELECT j.key AS position, CASE WHEN length(${item})<=4096 THEN ${item} END AS item
      ${from} AND j.key>? ORDER BY j.key LIMIT ?`,
    chunk:`SELECT substr(${item},?,4097) AS part ${from} AND j.key=?`}
})
export const eventRelationReads = /** @type {Record<import('./kanataDomainTypes').KanataEventRelationKind,{page:string,chunk:string}>} */ (
  Object.fromEntries(relationRead.map(({field,...sql})=>[field,sql])))
// A single connection-local integrity proof survives read pages only while SQLite
// reports no local writes, no external commits, and the same event revision.
export const eventIntegrityDdl = [`CREATE TEMP TABLE IF NOT EXISTS kanata_event_integrity (
  slot INTEGER PRIMARY KEY CHECK(slot=1),world_id TEXT NOT NULL,event_id TEXT NOT NULL,
  revision INTEGER NOT NULL,local_changes INTEGER NOT NULL,data_version INTEGER NOT NULL
)`]
export const eventIntegrityCached = `SELECT 1 FROM temp.kanata_event_integrity c
  CROSS JOIN pragma_data_version p JOIN world_events e ON e.world_id=c.world_id AND e.id=c.event_id
  WHERE c.slot=1 AND c.world_id=? AND c.event_id=? AND c.revision=?
    AND e.revision=c.revision AND c.local_changes=total_changes() AND c.data_version=p.data_version`
export const clearEventIntegrity = 'DELETE FROM temp.kanata_event_integrity'
export const storeEventIntegrity = `INSERT INTO temp.kanata_event_integrity(slot,world_id,event_id,revision,local_changes,data_version)
  SELECT 1,e.world_id,e.id,e.revision,total_changes()+1,(SELECT data_version FROM pragma_data_version)
  ${scope} AND ${valid}`
export const eventSnapshotQueries = [eventIntegrityCached, eventAuditSupport, correctionSourceRefs, correctionCauses, correctionTags, ...relationRead.flatMap(({page,chunk})=>[page,chunk])]
export const eventSnapshotWrites = [clearEventIntegrity, storeEventIntegrity, writeEventCommitAudit, writeEventStatusAudit, updateEventFromAudit,
  insertEventCorrection, ...eventCorrectionLinks]
