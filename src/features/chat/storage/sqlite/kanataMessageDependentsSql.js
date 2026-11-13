const messages = `WITH RECURSIVE args(world,conversation,message) AS (VALUES(?,?,?)),
  affected_messages(id) AS (
    SELECT message FROM args UNION
    SELECT m.id FROM affected_messages a JOIN messages m ON m.reply_to_message_id=a.id
    JOIN args ON m.world_id=args.world AND m.conversation_id=args.conversation
  )`
const events = messages + `,
  affected_events(id) AS (
    SELECT e.id FROM affected_messages a JOIN event_sources s ON s.message_id=a.id
    JOIN args ON s.world_id=args.world JOIN world_events e ON e.world_id=s.world_id AND e.id=s.event_id
    WHERE e.status<>'revoked' UNION
    SELECT c.event_id FROM affected_events a JOIN event_causes c ON c.cause_event_id=a.id JOIN args ON c.world_id=args.world
  )`
const effectTarget = 'world_id=? AND target_type=? AND target_id=? AND path=?'
// IDs are restricted to ASCII alphanumerics and _-:.; the English primary
// order is _ < - < : < . < digits < letters. Binary DESC breaks case-only
// ties in lowercase-first order, as in the legacy English comparator.
const effectOrderKey = id => `lower(replace(replace(replace(replace(${id},'_','!'),'-','"'),':','#'),'.','$'))`
const effectCursor = '(f.target_type,f.target_id,f.path,f.id)>(?,?,?,?)'
const effectOrder = 'ORDER BY f.target_type,f.target_id,f.path,f.id LIMIT 128'
const paths = {
  'state.mood': ['character_instances', 'mood'],
  'state.energy': ['character_instances', 'energy'],
  'state.location': ['character_instances', 'location'],
  'dimensions.trust': ['relationships', 'trust'],
  'dimensions.intimacy': ['relationships', 'intimacy'],
  'dimensions.understanding': ['relationships', 'understanding'],
}

export const updateEffectValue = Object.freeze(Object.fromEntries(Object.entries(paths).map(([path, [table, field]]) =>
  [path, `UPDATE ${table} SET ${field}=? WHERE world_id=? AND id=?`])))

export const dependentQueries = Object.freeze({
  uncertain: events + ` SELECT 1 AS uncertain FROM world_events e JOIN args ON e.world_id=args.world
    WHERE e.status='committed' AND e.causality IS NOT 'explicit' AND e.id NOT IN (SELECT id FROM affected_events)
      AND e.effective_at>=(SELECT min(affected.effective_at) FROM affected_events a
        JOIN world_events affected ON affected.id=a.id AND affected.world_id=args.world) LIMIT 1`,
  events: events + ` SELECT e.world_id,e.id,e.status,e.revision FROM affected_events a
    JOIN world_events e ON e.id=a.id JOIN args ON e.world_id=args.world
    WHERE e.status<>'revoked' AND e.id>? ORDER BY e.id LIMIT 50`,
  replies: messages + ` SELECT m.id,m.world_id,m.conversation_id,m.revision FROM affected_messages a JOIN messages m ON m.id=a.id
    JOIN args ON m.world_id=args.world AND m.conversation_id=args.conversation
    WHERE m.id<>args.message AND m.id>? ORDER BY m.id LIMIT 128`,
  affectedEffects: events + ` SELECT f.* FROM affected_events a JOIN world_effects f ON f.event_id=a.id
    JOIN args ON f.world_id=args.world WHERE ${effectCursor} ${effectOrder}`,
  eventEffectPaths: `SELECT f.* FROM world_effects f
    WHERE f.world_id=? AND f.event_id=? AND ${effectCursor} ${effectOrder}`,
  baseline: 'SELECT value_json FROM effect_baselines WHERE ' + effectTarget,
  remainingEffects: `WITH position(at,recorded,event_key,event_id,effect_key,id) AS (VALUES(?,?,?,?,?,?)),
    ordered AS (SELECT f.*,e.effective_at,e.recorded_at,${effectOrderKey('e.id')} AS event_key,${effectOrderKey('f.id')} AS effect_key
      FROM world_effects f JOIN world_events e ON e.world_id=f.world_id AND e.id=f.event_id
      WHERE f.world_id=? AND f.target_type=? AND f.target_id=? AND f.path=? AND e.status='committed')
    SELECT o.* FROM ordered o CROSS JOIN position p
    WHERE (o.effective_at,o.recorded_at,o.event_key)>(p.at,p.recorded,p.event_key)
      OR ((o.effective_at,o.recorded_at,o.event_key)=(p.at,p.recorded,p.event_key) AND (
        o.event_id<p.event_id OR (o.event_id=p.event_id AND (
          o.effect_key>p.effect_key OR (o.effect_key=p.effect_key AND o.id<p.id)))))
    ORDER BY effective_at,recorded_at,event_key,event_id DESC,effect_key,id DESC LIMIT 128`,
  eventSources: 'SELECT message_id,message_revision FROM event_sources WHERE world_id=? AND event_id=? AND message_id>? ORDER BY message_id LIMIT 50',
  eventLifeSources: `SELECT grant_id,instance_id,module_id,grant_revision,fingerprint FROM event_life_sources
    WHERE world_id=? AND event_id=? AND (grant_id,grant_revision,fingerprint)>(?,?,?)
    ORDER BY grant_id,grant_revision,fingerprint LIMIT 50`,
})

export const dependentWrites = Object.freeze({
  event: "UPDATE world_events SET status='needsReview',revision=revision+1 WHERE world_id=? AND id=? AND revision=?",
  eventMemories: events + ` UPDATE memories SET status='stale',revision=revision+1
    WHERE world_id=(SELECT world FROM args) AND status<>'deleted' AND id IN
      (SELECT l.memory_id FROM memory_events l JOIN args ON l.world_id=args.world JOIN affected_events a ON a.id=l.event_id)`,
  messageMemories: messages + ` UPDATE memories SET status='stale',revision=revision+1
    WHERE world_id=(SELECT world FROM args) AND status<>'deleted' AND id IN
      (SELECT l.memory_id FROM memory_sources l JOIN args ON l.world_id=args.world JOIN affected_messages a ON a.id=l.message_id)`,
  tasks: messages + ` UPDATE background_tasks SET state='cancelled',lease_until=0,error_code='SOURCE_REVISED'
    WHERE world_id=(SELECT world FROM args) AND state IN ('pending','running') AND id IN
      (SELECT l.task_id FROM task_sources l JOIN args ON l.world_id=args.world JOIN affected_messages a ON a.id=l.message_id)`,
  instanceRevision: 'UPDATE character_instances SET revision=revision+1 WHERE world_id=? AND id=?',
  relationshipRevision: 'UPDATE relationships SET revision=revision+1 WHERE world_id=? AND id=?',
})
