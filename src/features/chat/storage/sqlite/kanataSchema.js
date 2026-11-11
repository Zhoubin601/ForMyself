// @ts-check
// M1 definitions only. No connection, plugin registration or production data access.
import {createKanataSchemaHardening, createKanataRegistryValidationQueries} from './kanataSchemaHardening.js'
import {createKanataArrayOrderMigration} from './kanataSchemaArrayOrder.js'
const MAX = Number.MAX_SAFE_INTEGER
/** @param {string} name */
const id = name => `${name} TEXT NOT NULL CHECK(length(${name}) BETWEEN 1 AND 200 AND substr(${name},1,1) GLOB '[A-Za-z0-9]' AND ${name} NOT GLOB '*[^A-Za-z0-9._:-]*')`
/** @param {string} name */
const text = name => `${name} TEXT NOT NULL CHECK(length(trim(${name})) > 0)`
/** @param {string} name @param {number} [min] @param {number} [max] */
const integer = (name, min = 0, max = MAX) => `${name} INTEGER NOT NULL CHECK(${name} BETWEEN ${min} AND ${max})`
/** @param {string} name */
const flag = name => integer(name, 0, 1)
/** Optional domain booleans preserve absent vs explicit false. @param {string} name */
const optionalFlag = name => `${name} INTEGER CHECK(${name} IS NULL OR ${name} IN (0,1))`
/** @param {string} name @param {string[]} values */
const enumeration = (name, values) => `${name} TEXT NOT NULL CHECK(${name} IN (${values.map(v => `'${v}'`).join(',')}))`
/** @param {string} name @param {string} [type] */
const json = (name, type = '') => `${name} TEXT NOT NULL CHECK(CASE WHEN json_valid(${name}) THEN ${type ? `json_type(${name}) = '${type}'` : '1'} ELSE 0 END)`
const extra = `${json('extensions_json', 'object')} DEFAULT '{}'`
const visibility = () => enumeration('visibility', ['public', 'private', 'participants'])
const revision = () => integer('revision', 1)
const world = () => `${id('world_id')} REFERENCES worlds(id)`
/** @param {string} columns @param {string} table @param {string} [targets] @param {boolean} [deferred] */
const fk = (columns, table, targets = columns, deferred = false) => `FOREIGN KEY(${columns}) REFERENCES ${table}(${targets})${deferred ? ' DEFERRABLE INITIALLY DEFERRED' : ''}`
/** @param {string} column @param {string} table @param {boolean} [deferred] */
const scoped = (column, table, deferred = false) => fk(`world_id,${column}`, table, 'world_id,id', deferred)
const modules = ['home', 'mood', 'weight', 'savings', 'schedule', 'todo', 'reports']
/** @type {string[]} */
const core = []
/** @type {string[]} */
const guards = []
/** @type {string[]} */
const entityTables = []
/** @param {string} name @param {string[]} columns */
const table = (name, columns) => {
  /** @param {string} column */
  const isConstraint = column => /^(CHECK|FOREIGN KEY|UNIQUE|PRIMARY KEY)\(/.test(column)
  core.push(`CREATE TABLE ${name} (${[...columns.filter(c => !isConstraint(c)), ...columns.filter(isConstraint)].join(',\n')}) STRICT`)
}
/** @param {string} name @param {string[]} columns @param {boolean} [isScoped] */
const entity = (name, columns, isScoped = true) => {
  entityTables.push(name)
  table(name, [id('id') + ' PRIMARY KEY', ...(isScoped ? [world()] : []), ...columns, extra, ...(isScoped ? ['UNIQUE(world_id,id)'] : [])])
}
/** @param {string} name @param {string} timing @param {string} tableName @param {string} body */
const trigger = (name, timing, tableName, body) => guards.push(`CREATE TRIGGER ${name} ${timing} ON ${tableName} BEGIN ${body} END`)
/** @param {string} condition @param {string} code */
const reject = (condition, code) => `SELECT RAISE(ABORT,'${code}') WHERE ${condition};`
/** @param {string} name @param {string} on @param {string} columns @param {boolean} [unique] @param {string} [where] */
const index = (name, on, columns, unique = false, where = '') => guards.push(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${on}(${columns})${where ? ' WHERE ' + where : ''}`)

table('schema_migrations', [integer('version', 1) + ' PRIMARY KEY', text('name'), 'checksum TEXT NOT NULL CHECK(length(checksum)=64)'])
// Maintained by per-entity triggers; references always point to the actual typed table.
table('entity_ids', [id('id') + ' PRIMARY KEY', text('table_name')])
table('dataset_metadata', [integer('singleton', 1, 1) + ' PRIMARY KEY', id('user_id') + ' UNIQUE', integer('data_version', 1, 2), extra])
entity('worlds', [text('name'), 'rules TEXT NOT NULL', revision(), text('time_zone'), integer('created_at'),
  integer('last_simulated_at'), flag('autonomy_enabled'), flag('proactive_enabled'), flag('notifications_enabled'),
  enumeration('default_chat_mode', ['daily', 'roleplay']), optionalFlag('archived'), id('identity_id'),
  'CHECK(last_simulated_at>=created_at)', fk('id,identity_id', 'world_identities', 'world_id,id', true)], false)
entity('character_cards', [id('current_version_id'), flag('archived'), 'preset_key TEXT UNIQUE',
  fk('id,current_version_id', 'card_versions', 'card_id,id', true)], false)
entity('card_versions', [id('card_id') + ' REFERENCES character_cards(id) DEFERRABLE INITIALLY DEFERRED', revision(),
  json('definition_json', 'object'), json('raw_data_json'), text('source'), 'imported_json TEXT CHECK(imported_json IS NULL OR (json_valid(imported_json) AND json_type(imported_json)=\'object\'))',
  'UNIQUE(card_id,revision)', 'UNIQUE(card_id,id)'], false)
entity('world_identities', [id('user_id') + ' REFERENCES dataset_metadata(user_id)', text('display_name'), 'background TEXT NOT NULL', revision(), 'UNIQUE(world_id)'])
entity('character_instances', [id('card_id'), id('card_version_id'), revision(), json('overrides_json', 'object'),
  text('mood'), 'energy REAL NOT NULL CHECK(energy BETWEEN 0 AND 1)', 'location TEXT NOT NULL', flag('autonomy_enabled'), flag('proactive_enabled'),
  fk('card_id,card_version_id', 'card_versions', 'card_id,id')])
table('participants', [world(), id('id'), enumeration('kind', ['user', 'character']), 'identity_id TEXT', 'instance_id TEXT',
  'PRIMARY KEY(world_id,id)', 'UNIQUE(world_id,id,kind)',
  "CHECK((kind='user' AND identity_id IS NOT NULL AND identity_id=id AND instance_id IS NULL) OR (kind='character' AND instance_id IS NOT NULL AND instance_id=id AND identity_id IS NULL))",
  scoped('identity_id', 'world_identities'), scoped('instance_id', 'character_instances')])
entity('conversations', [enumeration('type', ['private', 'group', 'character']), text('title'),
  enumeration('mode', ['daily', 'roleplay', 'inherit']), revision(), integer('last_read_at'),
  'max_speakers INTEGER', 'max_messages INTEGER', 'reply_timing_enabled INTEGER', 'reply_wait_ms INTEGER',
  "CHECK((max_speakers IS NULL AND max_messages IS NULL) OR (type='group' AND max_speakers IS NOT NULL AND max_messages IS NOT NULL AND max_speakers BETWEEN 1 AND 8 AND max_messages BETWEEN max_speakers AND 32))",
  "CHECK((reply_timing_enabled IS NULL AND reply_wait_ms IS NULL) OR (type<>'character' AND reply_timing_enabled IS NOT NULL AND reply_wait_ms IS NOT NULL AND reply_timing_enabled IN (0,1) AND reply_wait_ms BETWEEN 1000 AND 30000))"])
table('conversation_participants', [world(), id('conversation_id'), id('participant_id'), enumeration('kind', ['user', 'character']), integer('ordinal'),
  'PRIMARY KEY(world_id,conversation_id,participant_id)', 'UNIQUE(world_id,conversation_id,ordinal)',
  'UNIQUE(world_id,conversation_id,participant_id,kind)', scoped('conversation_id', 'conversations'),
  fk('world_id,participant_id,kind', 'participants', 'world_id,id,kind')])
entity('messages', [id('conversation_id'), enumeration('role', ['user', 'assistant']), enumeration('sender_type', ['user', 'character']),
  id('sender_id'), text('sender_name_snapshot'), 'content TEXT NOT NULL', integer('created_at'), revision(),
  enumeration('status', ['complete', 'stopped']), id('turn_id'), id('batch_id'), optionalFlag('deleted'),
  'reply_to_message_id TEXT', 'reply_to_revision INTEGER CHECK(reply_to_revision IS NULL OR reply_to_revision BETWEEN 1 AND 9007199254740991)',
  "CHECK((sender_type='user' AND role='user') OR (sender_type='character' AND role='assistant'))",
  'CHECK(length(trim(content))>0 OR COALESCE(deleted,0)=1)',
  'CHECK(reply_to_message_id IS NULL OR reply_to_message_id<>id)', 'CHECK(reply_to_revision IS NULL OR reply_to_message_id IS NOT NULL)',
  'UNIQUE(world_id,conversation_id,id)', scoped('conversation_id', 'conversations'),
  fk('world_id,conversation_id,sender_id,sender_type', 'conversation_participants', 'world_id,conversation_id,participant_id,kind'),
  fk('world_id,conversation_id,reply_to_message_id', 'messages', 'world_id,conversation_id,id')])
entity('lorebook_entries', [enumeration('scope', ['world', 'character', 'system']), id('owner_id'), 'owner_instance_id TEXT',
  json('keys_json', 'array'), "secondary_keys_json TEXT CHECK(secondary_keys_json IS NULL OR CASE WHEN json_valid(secondary_keys_json) THEN json_type(secondary_keys_json)='array' ELSE 0 END)", text('content'), integer('priority'),
  enumeration('activation_rule', ['keyword', 'always']), visibility(), text('source_tag'), revision(), optionalFlag('enabled'), optionalFlag('case_sensitive'),
  "CHECK((scope='character' AND owner_instance_id IS NOT NULL AND owner_id=owner_instance_id) OR (scope<>'character' AND owner_instance_id IS NULL AND owner_id=world_id))", scoped('owner_instance_id', 'character_instances')])
entity('memories', [enumeration('owner_type', ['world', 'character']), id('owner_id'), 'owner_instance_id TEXT',
  enumeration('layer', ['L2', 'L3']), text('memory_key'), text('content'), enumeration('status', ['candidate', 'active', 'stale', 'deleted']), revision(), visibility(),
  'conversation_id TEXT', "confidence TEXT CHECK(confidence IS NULL OR confidence IN ('statement','inference','confirmed','joke'))",
  'generation_key TEXT CHECK(generation_key IS NULL OR length(generation_key)<=64000)',
  "CHECK((owner_type='character' AND owner_instance_id IS NOT NULL AND owner_id=owner_instance_id) OR (owner_type='world' AND owner_instance_id IS NULL AND owner_id=world_id))",
  scoped('owner_instance_id', 'character_instances'), scoped('conversation_id', 'conversations')])
entity('relationships', [id('from_id'), id('to_id'), enumeration('kind', ['teammate', 'teacher', 'acquaintance', 'friend', 'conflict', 'romantic']),
  enumeration('trust_baseline', ['new', 'established']), text('public_summary'),
  ...['trust', 'intimacy', 'understanding'].map(c => `${c} REAL NOT NULL CHECK(${c} BETWEEN -1 AND 1)`),
  integer('dimension_rule_version', 1), revision(), 'CHECK(from_id<>to_id)', 'UNIQUE(world_id,from_id,to_id)',
  fk('world_id,from_id', 'participants', 'world_id,id'), fk('world_id,to_id', 'participants', 'world_id,id')])
entity('world_events', [enumeration('status', ['candidate', 'committed', 'revoked', 'needsReview']), visibility(), text('summary'), integer('effective_at'), integer('recorded_at'), revision(),
  "causality TEXT CHECK(causality IS NULL OR causality IN ('explicit','unknown'))", "kind TEXT CHECK(kind IS NULL OR kind IN ('note','support','conflict','rest','move','promise'))",
  'action_instance_id TEXT', 'action_relationship_id TEXT', 'action_location TEXT CHECK(action_location IS NULL OR length(action_location)<=200)',
  'replaces_event_id TEXT', 'CHECK(replaces_event_id IS NULL OR replaces_event_id<>id)',
  scoped('action_instance_id', 'character_instances'), scoped('action_relationship_id', 'relationships'), scoped('replaces_event_id', 'world_events', true)])
const targetColumns = () => [enumeration('target_type', ['world', 'instance', 'relationship']), id('target_id'), 'target_instance_id TEXT', 'target_relationship_id TEXT',
  "CHECK((target_type='world' AND target_id=world_id AND target_instance_id IS NULL AND target_relationship_id IS NULL) OR (target_type='instance' AND target_instance_id IS NOT NULL AND target_id=target_instance_id AND target_relationship_id IS NULL) OR (target_type='relationship' AND target_relationship_id IS NOT NULL AND target_id=target_relationship_id AND target_instance_id IS NULL))",
  scoped('target_instance_id', 'character_instances'), scoped('target_relationship_id', 'relationships')]
entity('world_effects', [id('event_id'), ...targetColumns(), enumeration('operation', ['set', 'increment']), text('path'), json('value_json'), integer('rule_version', 1),
  "CHECK(operation<>'increment' OR json_type(value_json) IN ('integer','real'))", scoped('event_id', 'world_events')])
entity('effect_baselines', [...targetColumns(), text('path'), json('value_json'), 'UNIQUE(world_id,target_type,target_id,path)',
  "CHECK((target_type='instance' AND path IN ('state.mood','state.energy','state.location')) OR (target_type='relationship' AND path IN ('dimensions.trust','dimensions.intimacy','dimensions.understanding')))",
  "CHECK(CASE WHEN path='state.energy' OR target_type='relationship' THEN json_type(value_json) IN ('integer','real') AND json_extract(value_json,'$') BETWEEN (CASE WHEN path='state.energy' THEN 0 ELSE -1 END) AND 1 ELSE json_type(value_json)='text' AND length(json_extract(value_json,'$'))<=2000 END)"])
entity('background_tasks', [enumeration('kind', ['reply', 'memory', 'summary', 'world', 'proactive', 'followup']),
  enumeration('state', ['pending', 'running', 'succeeded', 'failed', 'cancelled']), text('idempotency_key'), integer('source_revision', 1), integer('attempt'), integer('not_before'), integer('lease_until'),
  'conversation_id TEXT', 'instance_id TEXT', "error_code TEXT CHECK(error_code IS NULL OR error_code NOT GLOB '*[^A-Z0-9_]*')", json('metadata_json', 'object') + " DEFAULT '{}'",
  'window_task_id TEXT', 'deferred_message_id TEXT', 'deferred_revision INTEGER', 'deferred_expires_at INTEGER',
  'notification_id INTEGER UNIQUE CHECK(notification_id IS NULL OR notification_id BETWEEN 910000000 AND 910999999)',
  "CHECK((deferred_message_id IS NULL AND deferred_revision IS NULL AND deferred_expires_at IS NULL) OR (kind='reply' AND conversation_id IS NOT NULL AND deferred_message_id IS NOT NULL AND deferred_revision IS NOT NULL AND deferred_revision BETWEEN 1 AND 9007199254740991 AND deferred_expires_at IS NOT NULL AND deferred_expires_at BETWEEN not_before AND 9007199254740991))",
  "CHECK(window_task_id IS NULL OR (kind='world' AND window_task_id<>id))", "CHECK(notification_id IS NULL OR (kind='proactive' AND instance_id IS NOT NULL AND conversation_id IS NOT NULL))",
  'UNIQUE(world_id,id,conversation_id)', 'UNIQUE(world_id,kind,idempotency_key)', scoped('conversation_id', 'conversations'), scoped('instance_id', 'character_instances'),
  scoped('window_task_id', 'background_tasks'), fk('world_id,conversation_id,deferred_message_id', 'messages', 'world_id,conversation_id,id')])
entity('life_grants', [id('instance_id'), enumeration('module_id', modules), flag('can_read'), flag('can_remember'), flag('can_share'), revision(),
  'UNIQUE(world_id,instance_id,module_id)', 'UNIQUE(world_id,id,instance_id,module_id)', scoped('instance_id', 'character_instances')])
entity('preset_applications', [text('initialization_key') + ' UNIQUE', text('preset_source_id'), integer('preset_version', 1), 'UNIQUE(world_id)'])
entity('usage_events', [id('conversation_id'), id('instance_id'), "participant_kind TEXT NOT NULL DEFAULT 'character' CHECK(participant_kind='character')", id('turn_id'), text('model'), flag('official_provider'),
  integer('started_at'), 'finished_at INTEGER CHECK(finished_at IS NULL OR finished_at BETWEEN 0 AND 9007199254740991)',
  enumeration('transport', ['stream', 'json']), enumeration('status', ['pending', 'succeeded', 'failed']),
  "error_code TEXT NOT NULL CHECK(error_code NOT GLOB '*[^A-Z0-9_]*')", "finish_reason TEXT NOT NULL CHECK(finish_reason NOT GLOB '*[^a-z_]*')",
  integer('estimated_input_tokens'), integer('estimated_output_tokens'), 'prompt_tokens INTEGER', 'completion_tokens INTEGER', 'cache_hit_tokens INTEGER',
  "purpose TEXT CHECK(purpose IS NULL OR purpose IN ('chat','memory','summary','world','proactive','life'))",
  "CHECK((status='pending')=(finished_at IS NULL))",
  'CHECK((prompt_tokens IS NULL AND completion_tokens IS NULL AND cache_hit_tokens IS NULL) OR (prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL AND prompt_tokens BETWEEN 0 AND 9007199254740991 AND completion_tokens BETWEEN 0 AND 9007199254740991 AND (cache_hit_tokens IS NULL OR cache_hit_tokens BETWEEN 0 AND prompt_tokens)))',
  scoped('instance_id', 'character_instances'), fk('world_id,conversation_id,instance_id,participant_kind', 'conversation_participants', 'world_id,conversation_id,participant_id,kind')])
entity('virtual_schedules', [id('instance_id'), integer('start_minute', 0, 1439), integer('end_minute', 1, 1440),
  text('location'), text('activity'), flag('resting'), revision(), 'CHECK(start_minute<end_minute)', scoped('instance_id', 'character_instances')])
table('virtual_schedule_days', [world(), id('schedule_id'), integer('day', 1, 7), 'PRIMARY KEY(world_id,schedule_id,day)', scoped('schedule_id', 'virtual_schedules')])
table('task_social_participants', [world(), id('task_id'), id('conversation_id'), id('instance_id'),
  "kind TEXT NOT NULL DEFAULT 'character' CHECK(kind='character')", 'PRIMARY KEY(world_id,task_id,instance_id)',
  fk('world_id,task_id,conversation_id', 'background_tasks', 'world_id,id,conversation_id'),
  fk('world_id,conversation_id,instance_id,kind', 'conversation_participants', 'world_id,conversation_id,participant_id,kind')])
table('memory_policies', [world() + ' PRIMARY KEY', enumeration('strategy', ['economical', 'standard', 'deep', 'custom']), flag('enabled'),
  integer('recent_messages', 2, 40), integer('summarize_after', 4, 200), integer('extract_after', 2, 100), integer('context_budget', 2000, 64000), revision(), extra, 'CHECK(summarize_after>recent_messages)'])
table('autonomy_policies', [world() + ' PRIMARY KEY', revision(), integer('daily_dialogue_limit', 0, 4), integer('max_catch_up_hours', 1, 24),
  enumeration('freedom', ['strict', 'standard', 'free', 'unrestricted']), integer('quiet_start_minute', 0, 1439), integer('quiet_end_minute', 0, 1439),
  "social_channel TEXT CHECK(social_channel IS NULL OR social_channel IN ('private','group'))", extra])
// Deliberately no FK on selected binding IDs: current validators allow stale selections,
// and runtime resolves them to unavailable, never to a replacement by name.
table('role_binding_state', [integer('singleton', 1, 1) + ' PRIMARY KEY', revision(), extra])
table('role_bindings', ["scope TEXT NOT NULL PRIMARY KEY CHECK(scope IN ('global','home','mood','weight','savings','schedule','todo','reports'))",
  'state_id INTEGER NOT NULL DEFAULT 1 CHECK(state_id=1) REFERENCES role_binding_state(singleton)',
  'world_id TEXT', 'instance_id TEXT', 'CHECK((world_id IS NULL)=(instance_id IS NULL))', extra])
table('data_migrations', [text('id') + ' PRIMARY KEY', integer('target_schema_version', 1),
  "source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64 AND source_fingerprint NOT GLOB '*[^a-f0-9]*')",
  text('collection'), json('cursor_json'), integer('imported_count'), enumeration('state', ['pending', 'running', 'complete', 'failed']), extra])

/** @param {string} name @param {string} ownerColumn @param {string} ownerTable @param {string} targetColumn @param {string} targetTable @param {string[]} [other] @param {string} [unique] */
const link = (name, ownerColumn, ownerTable, targetColumn, targetTable, other = [], unique = '') => {
  table(name, [world(), id(ownerColumn), id(targetColumn), ...other, `PRIMARY KEY(world_id,${ownerColumn},${targetColumn})`, ...(unique ? [unique] : []), scoped(ownerColumn, ownerTable), scoped(targetColumn, targetTable)])
  index(name + '_reverse', name, `world_id,${targetColumn},${ownerColumn}`)
}
link('lorebook_known_by', 'entry_id', 'lorebook_entries', 'participant_id', 'participants')
link('memory_known_by', 'memory_id', 'memories', 'instance_id', 'character_instances')
link('event_participants', 'event_id', 'world_events', 'participant_id', 'participants')
link('event_causes', 'event_id', 'world_events', 'cause_event_id', 'world_events', ['CHECK(event_id<>cause_event_id)'])
link('relationship_events', 'relationship_id', 'relationships', 'event_id', 'world_events')
link('memory_events', 'memory_id', 'memories', 'event_id', 'world_events')
link('task_result_events', 'task_id', 'background_tasks', 'event_id', 'world_events')
link('task_result_memories', 'task_id', 'background_tasks', 'memory_id', 'memories')
table('memory_links', [world(), id('memory_id'), id('target_memory_id'), enumeration('kind', ['conflict', 'shared', 'superseded']),
  'PRIMARY KEY(world_id,memory_id,kind,target_memory_id)', 'CHECK(memory_id<>target_memory_id)', scoped('memory_id', 'memories'), scoped('target_memory_id', 'memories')])
for (const [prefix, owner, ownerTable] of [['memory', 'memory_id', 'memories'], ['event', 'event_id', 'world_events'], ['task', 'task_id', 'background_tasks']]) {
  link(prefix + '_sources', owner, ownerTable, 'message_id', 'messages', [integer('message_revision', 1)])
}
for (const [prefix, owner, ownerTable] of [['message', 'message_id', 'messages'], ['memory', 'memory_id', 'memories'], ['event', 'event_id', 'world_events']]) {
  table(prefix + '_life_sources', [world(), id(owner), id('grant_id'), id('instance_id'), enumeration('module_id', modules), integer('grant_revision', 1),
    "fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*')",
    `PRIMARY KEY(world_id,${owner},grant_id,grant_revision,fingerprint)`, scoped(owner, ownerTable),
    fk('world_id,grant_id,instance_id,module_id', 'life_grants', 'world_id,id,instance_id,module_id')])
}
for (const [prefix, owner, ownerTable] of [['message', 'message_id', 'messages'], ['event', 'event_id', 'world_events']]) {
  entity(prefix + '_audits', [id(owner), integer('at'), integer('previous_revision', 1), integer('next_revision', 1),
    json('previous_json', 'object'), json('next_json', 'object'), 'CHECK(next_revision>previous_revision)', scoped(owner, ownerTable)])
}

// Core identity guards belong to v1 so a populated v1 remains valid during upgrade.
const identityGuardStart = guards.length
// Global stable ID uniqueness includes optional records and audit/schedule additions.
for (const name of entityTables) {
  // RAISE is explicit: outer INSERT OR IGNORE/REPLACE must not override registry UNIQUE.
  trigger(name + '_unique_id', 'BEFORE INSERT', name,
    reject('EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id)', 'KANATA_DUPLICATE_ENTITY_ID'))
  trigger(name + '_register', 'AFTER INSERT', name, `INSERT INTO entity_ids(id,table_name) VALUES(NEW.id,'${name}');`)
  trigger(name + '_unregister', 'AFTER DELETE', name, `DELETE FROM entity_ids WHERE id=OLD.id AND table_name='${name}';`)
  trigger(name + '_immutable_scope', 'BEFORE UPDATE', name,
    reject(`NEW.id<>OLD.id${['worlds', 'character_cards', 'card_versions'].includes(name) ? '' : ' OR NEW.world_id<>OLD.world_id'}`, 'KANATA_IMMUTABLE_SCOPE'))
}
for (const [name, kind, column] of [['world_identities', 'user', 'identity_id'], ['character_instances', 'character', 'instance_id']]) {
  trigger(name + '_participant', 'AFTER INSERT', name, `INSERT INTO participants(world_id,id,kind,${column}) VALUES(NEW.world_id,NEW.id,'${kind}',NEW.id);`)
}
core.push(...guards.splice(identityGuardStart))
for (const name of ['messages', 'world_events', 'life_grants']) {
  trigger(name + '_revision', 'BEFORE UPDATE', name, reject('NEW.revision<OLD.revision', 'KANATA_REVISION_REGRESSION'))
}
for (const name of ['memory_sources', 'event_sources', 'task_sources']) {
  for (const action of ['INSERT', 'UPDATE']) trigger(name + '_' + action.toLowerCase(), 'BEFORE ' + action, name,
    reject('NEW.message_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.message_id)', 'KANATA_FUTURE_SOURCE_REVISION'))
  index(name + '_by_message', name, 'world_id,message_id,message_revision')
}
for (const name of ['message_life_sources', 'memory_life_sources', 'event_life_sources']) {
  for (const action of ['INSERT', 'UPDATE']) trigger(name + '_' + action.toLowerCase(), 'BEFORE ' + action, name,
    reject('NEW.grant_revision>(SELECT revision FROM life_grants WHERE world_id=NEW.world_id AND id=NEW.grant_id)', 'KANATA_FUTURE_GRANT_REVISION'))
  index(name + '_by_grant', name, 'world_id,grant_id,grant_revision')
}
for (const action of ['INSERT', 'UPDATE']) {
  trigger('messages_reply_' + action.toLowerCase(), 'BEFORE ' + action, 'messages',
    reject('NEW.reply_to_revision>(SELECT revision FROM messages WHERE world_id=NEW.world_id AND id=NEW.reply_to_message_id)', 'KANATA_FUTURE_REPLY_REVISION'))
  trigger('effects_committed_' + action.toLowerCase(), 'BEFORE ' + action, 'world_effects',
    reject("(SELECT status FROM world_events WHERE world_id=NEW.world_id AND id=NEW.event_id)='candidate'", 'KANATA_UNCOMMITTED_EFFECT'))
  trigger('tasks_speaker_' + action.toLowerCase(), 'BEFORE ' + action, 'background_tasks',
    reject("NEW.conversation_id IS NOT NULL AND NEW.instance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND participant_id=NEW.instance_id AND kind='character')", 'KANATA_TASK_SPEAKER_DENIED'))
  trigger('tasks_deferred_' + action.toLowerCase(), 'BEFORE ' + action, 'background_tasks',
    reject("NEW.deferred_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE world_id=NEW.world_id AND conversation_id=NEW.conversation_id AND id=NEW.deferred_message_id AND sender_type='user' AND revision>=NEW.deferred_revision)", 'KANATA_DEFERRED_SOURCE_DENIED'))
}
trigger('messages_edit_revision', 'BEFORE UPDATE', 'messages',
  reject('(NEW.content IS NOT OLD.content OR NEW.deleted IS NOT OLD.deleted) AND NEW.revision<=OLD.revision', 'KANATA_MESSAGE_REVISION_REQUIRED') +
  reject('NEW.conversation_id<>OLD.conversation_id OR NEW.sender_id<>OLD.sender_id OR NEW.sender_type<>OLD.sender_type OR NEW.created_at<>OLD.created_at', 'KANATA_MESSAGE_IDENTITY_IMMUTABLE'))
for (const [prefix, owner, ownerTable] of [['message', 'message_id', 'messages'], ['event', 'event_id', 'world_events']]) {
  const snapshots = ['previous', 'next'].map(key => `json_extract(NEW.${key}_json,'$.id') IS NOT NEW.${owner} OR json_extract(NEW.${key}_json,'$.worldId') IS NOT NEW.world_id OR json_extract(NEW.${key}_json,'$.revision') IS NOT NEW.${key}_revision`).join(' OR ')
  for (const action of ['INSERT', 'UPDATE']) trigger(prefix + '_audits_' + action.toLowerCase(), 'BEFORE ' + action, prefix + '_audits',
    reject(snapshots + ` OR NEW.next_revision>(SELECT revision FROM ${ownerTable} WHERE world_id=NEW.world_id AND id=NEW.${owner})`, 'KANATA_INVALID_AUDIT_REVISION') +
    (prefix === 'message' ? ['previous', 'next'].map(key => reject(`NOT EXISTS(SELECT 1 FROM conversation_participants WHERE world_id=NEW.world_id AND conversation_id=json_extract(NEW.${key}_json,'$.conversationId') AND participant_id=json_extract(NEW.${key}_json,'$.senderId') AND kind=json_extract(NEW.${key}_json,'$.senderType'))`, 'KANATA_AUDIT_SENDER_DENIED')).join('') : ''))
  index(prefix + '_audits_by_owner', prefix + '_audits', `world_id,${owner},at,id`)
}
// UNION (not UNION ALL) bounds traversal even if an old database already contains a cycle.
for (const action of ['INSERT', 'UPDATE']) {
  trigger('event_causes_cycle_' + action.toLowerCase(), 'AFTER ' + action, 'event_causes',
    reject(`EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.cause_event_id UNION SELECT c.cause_event_id FROM event_causes c JOIN ancestors a ON c.event_id=a.id WHERE c.world_id=NEW.world_id) SELECT 1 FROM ancestors WHERE id=NEW.event_id)`, 'KANATA_EVENT_CAUSAL_CYCLE'))
  trigger('memory_links_cycle_' + action.toLowerCase(), 'AFTER ' + action, 'memory_links',
    reject(`NEW.kind='shared' AND EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT NEW.target_memory_id UNION SELECT l.target_memory_id FROM memory_links l JOIN ancestors a ON l.memory_id=a.id WHERE l.world_id=NEW.world_id AND l.kind='shared') SELECT 1 FROM ancestors WHERE id=NEW.memory_id)`, 'KANATA_MEMORY_SHARE_CYCLE'))
}
index('memory_single_parent', 'memory_links', 'world_id,memory_id,kind', true, "kind IN ('shared','superseded')")
index('messages_scope_time', 'messages', 'world_id,conversation_id,created_at DESC,id DESC')
index('messages_by_sender', 'messages', 'world_id,sender_id,created_at,id')
index('messages_replies', 'messages', 'world_id,conversation_id,reply_to_message_id')
index('participants_by_member', 'conversation_participants', 'world_id,participant_id,conversation_id')
index('instances_by_card', 'character_instances', 'card_id,card_version_id')
index('memories_owner_status', 'memories', 'world_id,owner_type,owner_id,status,layer')
index('memories_conversation', 'memories', 'world_id,conversation_id,status')
index('lorebook_owner', 'lorebook_entries', 'world_id,scope,owner_id,enabled,priority')
index('events_effective', 'world_events', 'world_id,status,effective_at,id')
index('effects_by_event', 'world_effects', 'world_id,event_id')
index('effects_by_target', 'world_effects', 'world_id,target_type,target_id,path')
index('tasks_due', 'background_tasks', 'world_id,state,not_before,id')
index('tasks_conversation', 'background_tasks', 'world_id,conversation_id,instance_id,kind,state')
index('usage_conversation_time', 'usage_events', 'world_id,conversation_id,started_at,id')
index('usage_instance_time', 'usage_events', 'world_id,instance_id,started_at,id')
index('schedules_instance', 'virtual_schedules', 'world_id,instance_id,start_minute,end_minute')

// All safety constraints also apply to a populated v1. v2 only adds access indexes.
core.push(...guards.filter(sql => sql.startsWith('CREATE TRIGGER ')))
const accessIndexes = guards.filter(sql => !sql.startsWith('CREATE TRIGGER '))

/** Immutable ordered DDL; one execute call per statement, including each whole trigger. */
export const KANATA_SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({version: 1, name: 'kanata-core', statements: Object.freeze(core)}),
  Object.freeze({version: 2, name: 'kanata-access-indexes', statements: Object.freeze(accessIndexes)}),
  createKanataSchemaHardening(entityTables),
  Object.freeze({version: 4, name: 'kanata-domain-commands', statements: Object.freeze([
    `CREATE TABLE domain_command_receipts (
      command_key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
      result_id TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE archived_message_marks (
      world_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY(world_id,conversation_id,message_id),
      FOREIGN KEY(world_id,conversation_id,message_id) REFERENCES messages(world_id,conversation_id,id)
    ) STRICT`,
    "CREATE INDEX instances_world_id ON character_instances(world_id,id)",
    "CREATE INDEX lorebook_world_id ON lorebook_entries(world_id,id)",
    "CREATE INDEX memories_world_id ON memories(world_id,id)",
    "CREATE INDEX events_world_id ON world_events(world_id,id)",
    "CREATE TRIGGER card_versions_immutable BEFORE UPDATE ON card_versions BEGIN SELECT RAISE(ABORT,'KANATA_CARD_VERSION_IMMUTABLE'); END",
  ])}),
  createKanataArrayOrderMigration(),
])
export const KANATA_SCHEMA_VERSION = 5
export const KANATA_SCHEMA_APPLICATION_ID = 0x4b4e5441

export const KANATA_REGISTRY_VALIDATION_QUERIES = createKanataRegistryValidationQueries(entityTables)
