const scope = 'world_id=? AND conversation_id=?'
const lifeSources = `(SELECT json_group_array(json_object(
  'grantId',link.grant_id,'instanceId',link.instance_id,'moduleId',link.module_id,
  'revision',link.grant_revision,'fingerprint',link.fingerprint))
  FROM (SELECT * FROM message_life_sources WHERE world_id=m.world_id AND message_id=m.id
    ORDER BY grant_id,grant_revision,fingerprint) link) AS life_sources`
export const messageProjection = 'm.*, ' + lifeSources
const anchor = ' AND (created_at,id)<(?,?)'
const descending = ' ORDER BY created_at DESC,id DESC LIMIT ?'
const message = 'SELECT ' + messageProjection + ' FROM messages m WHERE ' + scope
const conversationColumns = 'id,world_id,type,title,mode,revision,last_read_at,max_speakers,max_messages,reply_timing_enabled,reply_wait_ms,extensions_json'

export const messageQueries = Object.freeze({
  get: message + ' AND id=?',
  recent: message + descending,
  older: message + anchor + descending,
  startingAt: message + ' AND (created_at,id)<=(?,?)' + descending,
  replies: message + ' AND reply_to_message_id=?' + descending,
  olderReplies: message + ' AND reply_to_message_id=?' + anchor + descending,
  latest: message + ' AND role=? ORDER BY created_at DESC,id DESC LIMIT 1',
  provenance: `SELECT m.id,m.world_id,m.conversation_id,m.revision,m.status,m.deleted,m.reply_to_message_id,m.reply_to_revision,
    ${lifeSources} FROM messages m WHERE m.world_id=? AND m.id=?`,
  speakerRevision: 'SELECT revision FROM character_instances WHERE world_id=? AND id=?',
  speakerState: 'SELECT revision,mood,energy,location FROM character_instances WHERE world_id=? AND id=?',
  eventState: 'SELECT id,status,revision FROM world_events WHERE world_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128',
  memoryState: 'SELECT id,status,revision FROM memories WHERE world_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128',
  relationshipState: `SELECT id,trust,intimacy,understanding,revision FROM relationships
    WHERE world_id=? AND from_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128`,
  historyForSpeaker: `WITH args(world,conversation,speaker) AS (VALUES(?,?,?))
    SELECT ${messageProjection} FROM args JOIN conversations c ON c.world_id=args.world AND c.id=args.conversation
    JOIN messages m ON m.world_id=args.world AND m.conversation_id=args.conversation
    JOIN conversation_participants p ON p.world_id=args.world AND p.conversation_id=args.conversation
      AND p.participant_id=args.speaker AND p.kind='character'
    WHERE m.status='complete' AND coalesce(m.deleted,0)=0
      AND NOT EXISTS (SELECT 1 FROM archived_message_marks a
        WHERE a.world_id=m.world_id AND a.conversation_id=m.conversation_id AND a.message_id=m.id)
      AND (m.reply_to_message_id IS NULL OR EXISTS (
        SELECT 1 FROM messages r WHERE r.world_id=m.world_id AND r.conversation_id=m.conversation_id
          AND r.id=m.reply_to_message_id AND r.revision=coalesce(m.reply_to_revision,1)
          AND r.status='complete' AND coalesce(r.deleted,0)=0
      ))
      AND NOT EXISTS (
        SELECT 1 FROM message_life_sources s
        WHERE s.world_id=m.world_id AND s.message_id=m.id AND NOT EXISTS (
          SELECT 1 FROM life_grants g JOIN life_grants receiver ON receiver.world_id=g.world_id
            AND receiver.module_id=g.module_id AND receiver.instance_id=args.speaker
          WHERE g.world_id=s.world_id AND g.id=s.grant_id AND g.revision=s.grant_revision AND g.can_read=1
            AND receiver.can_read=1 AND (g.can_share=1 OR (c.type<>'group' AND s.instance_id=args.speaker))
            AND (c.type<>'group' OR receiver.can_share=1)
        )
      ) ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
  count: 'SELECT count(*) AS count FROM messages WHERE ' + scope,
  quote: 'SELECT id,content,sender_name_snapshot,revision FROM messages WHERE ' + scope + ' AND id=? AND coalesce(deleted,0)=0',
  identity: 'SELECT table_name FROM entity_ids WHERE id=?',
  world: 'SELECT archived FROM worlds WHERE id=?',
})

export const messageWrites = Object.freeze({
  insert: `INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
    content,created_at,revision,status,turn_id,batch_id,deleted,reply_to_message_id,reply_to_revision,extensions_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  lifeSource: `INSERT INTO message_life_sources(world_id,message_id,grant_id,instance_id,module_id,grant_revision,fingerprint)
    VALUES(?,?,?,?,?,?,?)`,
  status: 'UPDATE messages SET status=?,revision=revision+1 WHERE ' + scope + ' AND id=? AND revision=?',
  revise: 'UPDATE messages SET content=?,deleted=?,revision=revision+1 WHERE ' + scope + ' AND id=? AND revision=?',
  audit: `INSERT INTO message_audits(id,world_id,message_id,at,previous_revision,next_revision,previous_json,next_json)
    VALUES(?,?,?,?,?,?,?,?)`,
  redact: `UPDATE message_audits SET
    previous_json=json_set(previous_json,'$.content','（已删除的原始记录）','$.deleted',json('true')),
    next_json=json_set(next_json,'$.content','（已删除的原始记录）','$.deleted',json('true'))
    WHERE world_id=? AND message_id=?`,
})

export const conversationQueries = Object.freeze({
  get: `SELECT ${conversationColumns} FROM conversations WHERE world_id=? AND id=?`,
  list: `SELECT ${conversationColumns} FROM conversations WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
  participants: 'SELECT participant_id,kind FROM conversation_participants WHERE world_id=? AND conversation_id=? ORDER BY ordinal',
  participant: 'SELECT kind FROM participants WHERE world_id=? AND id=?',
})

export const conversationWrites = Object.freeze({
  create: `INSERT INTO conversations(${conversationColumns}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  participant: 'INSERT INTO conversation_participants(world_id,conversation_id,participant_id,kind,ordinal) VALUES(?,?,?,?,?)',
  update: `UPDATE conversations SET title=?,mode=?,last_read_at=?,max_speakers=?,max_messages=?,
    reply_timing_enabled=?,reply_wait_ms=?,revision=revision+1 WHERE world_id=? AND id=? AND revision=?`,
})
