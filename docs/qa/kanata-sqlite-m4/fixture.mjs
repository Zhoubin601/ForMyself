export const growthSeedSql = `WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
  INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
    content,created_at,revision,status,turn_id,batch_id,extensions_json)
  SELECT ?||'-history-'||n,?,?,'user','user',?,'合成用户','合成历史消息',n+2000,1,'complete',
    'm4-seed-turn','m4-seed-batch','{}' FROM seq`
