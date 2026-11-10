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
  const match = columns.map(column => {
    if (scalar) return 'j.type=\'text\' AND l.' + column + '=j.value'
    const path = "'$." + keys[column] + "'"
    const types = keys[column] === 'revision' ? "('integer','real')" : "('text')"
    return `json_type(j.value,${path}) IN ${types} AND l.${column}=json_extract(j.value,${path})`
  }).join(' AND ')
  const sameIdentity = scalar ? 'j.value' : 'json_array(' + columns.map(column => {
    const value = "json_extract(j.value,'$." + keys[column] + "')"
    return keys[column] === 'revision' ? 'CAST(' + value + ' AS INTEGER)' : value
  }).join(',') + ')'
  const owner = 'l.world_id=e.world_id AND l.event_id=e.id'
  const array = `(SELECT json_group_array(${scalar ? 'item' : 'json(item)'}) FROM (
    SELECT ${member} AS item FROM ${table} l WHERE ${owner} ORDER BY ${order ?? columns[0]}
  ))`
  const valid = `CASE
    WHEN ${type} IS NULL THEN 1
    WHEN ${type}<>'array' THEN 0
    WHEN json_array_length(${hint})<>(SELECT count(*) FROM ${table} l WHERE ${owner}) THEN 0
    WHEN EXISTS (SELECT 1 FROM json_each(${hint}) j WHERE
      CASE WHEN j.type<>'${scalar ? 'text' : 'object'}' THEN 1 ELSE
        NOT EXISTS (SELECT 1 FROM ${table} l WHERE ${owner} AND ${match}) END) THEN 0
    WHEN EXISTS (SELECT 1 FROM json_each(${hint}) j GROUP BY ${sameIdentity} HAVING count(*)>1) THEN 0
    ELSE 1 END`
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
const valid = `CASE WHEN json_valid(e.extensions_json) THEN json_type(e.extensions_json)='object'
  AND ${projections.map(({valid}) => '('+valid+')').join(' AND ')} ELSE 0 END`
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
export const eventSnapshotQueries = [eventAuditSupport, correctionSourceRefs, correctionCauses, correctionTags]
export const eventSnapshotWrites = [writeEventCommitAudit, writeEventStatusAudit, updateEventFromAudit,
  insertEventCorrection, ...eventCorrectionLinks]
