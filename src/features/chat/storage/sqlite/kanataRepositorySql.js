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
// Candidate transcript projections deliberately exclude opaque extensions and
// normalized provenance. The compatibility DTO queries still return both.
const transcriptProjection = `m.id,m.world_id,m.conversation_id,m.role,m.sender_type,m.sender_id,m.sender_name_snapshot,
  m.content,m.created_at,m.revision,m.status,m.turn_id,m.batch_id,m.deleted,m.reply_to_message_id,m.reply_to_revision,
  '{}' AS extensions_json,'[]' AS life_sources`
const replyBaseProjection = transcriptProjection.replace("'{}' AS extensions_json",
  "json_remove(m.extensions_json,'$.lifeSources') AS extensions_json")
const messageState = 'SELECT id,revision,created_at,status,deleted,sender_id FROM messages WHERE ' + scope
const transcript = 'SELECT ' + transcriptProjection + ' FROM messages m WHERE ' + scope
const history = 'SELECT id,content,sender_name_snapshot,created_at,revision FROM messages WHERE ' + scope + ' AND coalesce(deleted,0)=0'
const conversationColumns = 'id,world_id,type,title,mode,revision,last_read_at,max_speakers,max_messages,reply_timing_enabled,reply_wait_ms,extensions_json'

/** @param {string} projection */
const speakerHistory = projection => `WITH args(world,conversation,speaker) AS (VALUES(?,?,?))
    SELECT ${projection} FROM args JOIN conversations c ON c.world_id=args.world AND c.id=args.conversation
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
      ) ORDER BY m.created_at DESC,m.id DESC LIMIT ?`

export const messageQueries = Object.freeze({
  get: message + ' AND id=?',
  recent: message + descending,
  older: message + anchor + descending,
  startingAt: message + ' AND (created_at,id)<=(?,?)' + descending,
  replies: message + ' AND reply_to_message_id=?' + descending,
  history: history + descending,
  olderHistory: history + anchor + descending,
  completedReplies: 'SELECT id,revision,sender_id FROM messages WHERE ' + scope
    + " AND reply_to_message_id=? AND role='assistant' AND status='complete' AND coalesce(deleted,0)=0" + descending,
  olderReplies: message + ' AND reply_to_message_id=?' + anchor + descending,
  latest: message + ' AND role=? ORDER BY created_at DESC,id DESC LIMIT 1',
  state: messageState + ' AND id=?',
  latestState: messageState + ' AND role=? ORDER BY created_at DESC,id DESC LIMIT 1',
  newestState: messageState + ' ORDER BY created_at DESC,id DESC LIMIT 1',
  latestTranscript: transcript + ' AND role=? ORDER BY created_at DESC,id DESC LIMIT 1',
  transcriptAnchor: 'SELECT id,created_at FROM messages WHERE ' + scope + ' AND id=?',
  getTranscript: transcript + ' AND id=?',
  getReplyBase: 'SELECT ' + replyBaseProjection + ' FROM messages m WHERE ' + scope + ' AND id=?',
  recentTranscript: transcript + descending,
  olderTranscript: transcript + anchor + descending,
  startingAtTranscript: transcript + ' AND (created_at,id)<=(?,?)' + descending,
  provenance: `SELECT m.id,m.world_id,m.conversation_id,m.revision,m.status,m.deleted,m.reply_to_message_id,m.reply_to_revision,
    ${lifeSources} FROM messages m WHERE m.world_id=? AND m.id=?`,
  speakerRevision: 'SELECT revision FROM character_instances WHERE world_id=? AND id=?',
  speakerState: 'SELECT revision,mood,energy,location FROM character_instances WHERE world_id=? AND id=?',
  eventState: 'SELECT id,status,revision FROM world_events WHERE world_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128',
  memoryState: 'SELECT id,status,revision FROM memories WHERE world_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128',
  relationshipState: `SELECT id,trust,intimacy,understanding,revision FROM relationships
    WHERE world_id=? AND from_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 128`,
  historyForSpeaker: speakerHistory(messageProjection),
  transcriptForSpeaker: speakerHistory(transcriptProjection),
  transcriptForAppend: speakerHistory(transcriptProjection)
    .replace('args(world,conversation,speaker) AS (VALUES(?,?,?))', 'args(world,conversation,speaker,batch) AS (VALUES(?,?,?,?))')
    .replace("WHERE m.status='complete'", "WHERE NOT EXISTS (SELECT 1 FROM json_each(args.batch) j WHERE j.value=m.id) AND m.status='complete'"),
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
  groupEdit: `SELECT c.title,c.revision,EXISTS(SELECT 1 FROM messages m
      WHERE m.world_id=c.world_id AND m.conversation_id=c.id) AS has_history
    FROM conversations c WHERE c.world_id=? AND c.id=? AND c.type='group'`,
  groupMembers: `SELECT p.participant_id,p.ordinal,COALESCE(json_extract(i.overrides_json,'$.name'),json_extract(v.definition_json,'$.name')) AS title
    FROM conversation_participants p JOIN character_instances i ON i.world_id=p.world_id AND i.id=p.participant_id
    JOIN card_versions v ON v.card_id=i.card_id AND v.id=i.card_version_id
    WHERE p.world_id=? AND p.conversation_id=? AND p.kind='character' AND p.ordinal>? ORDER BY p.ordinal LIMIT ?`,
  groupMemberCount: `SELECT count(*) AS total FROM json_each(?) picked
    JOIN character_instances i ON i.world_id=? AND i.id=picked.value`,
  highestOrdinal: `SELECT COALESCE(MAX(ordinal),0) AS highest FROM conversation_participants WHERE ${scope}`,
})

export const conversationWrites = Object.freeze({
  create: `INSERT INTO conversations(${conversationColumns}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  participant: 'INSERT INTO conversation_participants(world_id,conversation_id,participant_id,kind,ordinal) VALUES(?,?,?,?,?)',
  editGroupRevision: `UPDATE conversations SET revision=revision+1 WHERE world_id=? AND id=? AND revision=? AND type='group'`,
  removeGroupMembers: `DELETE FROM conversation_participants WHERE ${scope} AND kind='character'
    AND participant_id NOT IN (SELECT value FROM json_each(?))`,
  parkGroupMembers: `UPDATE conversation_participants SET ordinal=ordinal+? WHERE ${scope}`,
  orderGroupMember: `INSERT INTO conversation_participants(world_id,conversation_id,participant_id,kind,ordinal) VALUES(?,?,?,?,?)
    ON CONFLICT(world_id,conversation_id,participant_id) DO UPDATE SET ordinal=excluded.ordinal`,
  update: `UPDATE conversations SET title=?,mode=?,last_read_at=?,max_speakers=?,max_messages=?,
    reply_timing_enabled=?,reply_wait_ms=?,revision=revision+1 WHERE world_id=? AND id=? AND revision=?`,
})
