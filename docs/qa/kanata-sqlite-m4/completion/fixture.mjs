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

export const memoryWideSources = `INSERT INTO memory_sources(world_id,memory_id,message_id,message_revision)
  SELECT world_id,?,id,revision FROM messages WHERE world_id=? AND conversation_id=? AND id GLOB ?`

export const replayEventRows = sequence + `
  INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,causality,kind)
  SELECT ?||n,?,'committed','private','synthetic',1000000000+?,1000000000+n,1,'explicit','note' FROM seq`
export const replayEffectRows = sequence + `
  INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
  SELECT ?||n,?,?||n,'instance',?,?,'set','state.location',json_quote('synthetic-location-'||n),1 FROM seq`
