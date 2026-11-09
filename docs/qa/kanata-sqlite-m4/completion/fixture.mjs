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
