const sequence = 'WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<?)'
export const memoryRows = sequence + `
  INSERT INTO memories(id,world_id,owner_type,owner_id,owner_instance_id,layer,memory_key,content,status,revision,visibility)
  SELECT ?||n,?,'character',?,?,'L3','synthetic','synthetic','active',1,'private' FROM seq`
export const memoryEdges = sequence + `
  INSERT INTO memory_links(world_id,memory_id,kind,target_memory_id)
  SELECT ?,?||n,'shared',?||(n+1) FROM seq ORDER BY n`
export const eventRows = sequence + `
  INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind)
  SELECT ?||n,?,'committed','private','synthetic',n+1,n+1,1,'explicit','note' FROM seq`
export const eventEdges = sequence + `
  INSERT INTO event_causes(world_id,event_id,cause_event_id)
  SELECT ?,?||n,?||(n+1) FROM seq ORDER BY n`

export const eventFanout = sequence + `
  INSERT INTO event_causes(world_id,event_id,cause_event_id)
  SELECT ?,?||n,? FROM seq ORDER BY n`

// The frozen cycle trigger can scan an entire world per edge with no planner
// statistics. Use local statistics only while loading synthetic fanout links.
export const fanoutAnalyze = 'ANALYZE event_causes'
export const fanoutClearStats = "DELETE FROM sqlite_stat1 WHERE tbl='event_causes'"
export const fanoutReloadStats = 'ANALYZE sqlite_schema'
export const fanoutCyclePlan = `EXPLAIN QUERY PLAN WITH RECURSIVE ancestors(id) AS (
  SELECT ? UNION SELECT c.cause_event_id FROM event_causes c
  JOIN ancestors a ON c.event_id=a.id WHERE c.world_id=?
) SELECT 1 FROM ancestors WHERE id=?`

export async function seedFanoutLinks(tx, size, world, prefix, root) {
  const parameters=[root,world,prefix+'0']
  const plan=async()=> (await tx.query(fanoutCyclePlan,parameters)).map(row=>row.detail)
  const before=await plan()
  await tx.execute(fanoutAnalyze)
  let analyzed, inserted
  try {
    analyzed=await plan()
    inserted=await tx.execute(eventFanout,[size-1,world,prefix,root])
  } finally {
    await tx.execute(fanoutClearStats)
    await tx.execute(fanoutReloadStats)
  }
  return { before,analyzed,restored:await plan(),affectedRows:inserted.affectedRows }
}

export const memoryWideSources = `INSERT INTO memory_sources(world_id,memory_id,message_id,message_revision)
  SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND conversation_id=? AND id GLOB ?`

export const replayEventRows = sequence + `
  INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind)
  SELECT ?||n,?,'committed','private','synthetic',1000000000+?,1000000000+n,1,'explicit','note' FROM seq`
export const replayEffectRows = sequence + `
  INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
  SELECT ?||n,?,?||n,'instance',?,?,'set','state.location',json_quote('synthetic-location-'||n),1 FROM seq`

export const fanoutAuditInspection = `WITH p(world,prefix) AS (VALUES(?,?))
  SELECT count(*) AS events,
    count(*) FILTER (WHERE e.status='committed' AND e.revision=1) AS original,
    count(*) FILTER (WHERE e.status='revoked' AND e.revision=2) AS revoked,
    count(a.id) AS audits,
    count(*) FILTER (WHERE a.previous_revision=1 AND a.next_revision=2
      AND json_extract(a.previous_json,'$.status')='committed'
      AND json_extract(a.next_json,'$.status')='revoked'
      AND json_extract(a.extensions_json,'$.ownedEffectCount')=1
      AND json_array_length(a.extensions_json,'$.ownedEffects')=1
      AND json_extract(a.extensions_json,'$.ownedEffects[0].id')=f.id
      AND json_extract(a.extensions_json,'$.ownedEffects[0].targetType')=f.target_type
      AND json_extract(a.extensions_json,'$.ownedEffects[0].targetId')=f.target_id
      AND json_extract(a.extensions_json,'$.ownedEffects[0].path')=f.path
      AND json_extract(a.extensions_json,'$.ownedEffects[0].operation')=f.operation
      AND json_extract(a.extensions_json,'$.ownedEffects[0].ruleVersion')=f.rule_version
      AND json_extract(a.extensions_json,'$.ownedEffects[0].value')=json_extract(f.value_json,'$')) AS exactAudits
  FROM p JOIN world_events e ON e.world_id=p.world AND e.id GLOB p.prefix||'*'
  LEFT JOIN event_audits a ON a.world_id=e.world_id AND a.event_id=e.id
  LEFT JOIN world_effects f ON f.world_id=e.world_id AND f.event_id=e.id`
