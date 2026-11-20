// @ts-check
// Trusted static Schema 005 catalog for Kanata Portable Backup (kanata-logical-v1).
// Generated deterministically from Schema 001-005 DDL; never parsed from untrusted backup input.
import { asciiBytes, concatBytes, writeU16BE, writeU32BE } from './bytes.js'
import { PORTABLE_DOMAIN } from './constants.js'

export const KANATA_SCHEMA_005_FINGERPRINT = '8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a'

export const PORTABLE_RUNTIME_TABLE_NAMES = Object.freeze(['data_migrations', 'schema_migration_applications', 'schema_migrations'])
export const PORTABLE_DERIVED_TABLE_NAMES = Object.freeze(['baseline_array_order', 'effect_array_order', 'entity_ids', 'event_array_order', 'participants'])
export const PORTABLE_ARRAY_ORDERED_TABLE_NAMES = Object.freeze(['effect_baselines', 'world_effects', 'world_events'])

/**
 * @param {string} name
 * @param {number} cid
 * @param {'TEXT' | 'INTEGER' | 'REAL'} type
 * @param {boolean} notnull
 * @param {number} pk
 */
const col = (name, cid, type, notnull, pk) => Object.freeze({ name, cid, type, notnull, pk })

/**
 * @param {number} tableId
 * @param {string} name
 * @param {'business' | 'derived' | 'runtime'} category
 * @param {boolean} hasOrdinal
 * @param {readonly { name: string, cid: number, type: 'TEXT' | 'INTEGER' | 'REAL', notnull: boolean, pk: number }[]} columns
 */
function defineTable(tableId, name, category, hasOrdinal, columns) {
  const pkColumns = Object.freeze(columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name))
  const columnsByName = Object.freeze(Object.fromEntries(columns.map(c => [c.name, c])))
  return Object.freeze({ tableId, name, category, hasOrdinal, columns: Object.freeze(columns), pkColumns, columnsByName })
}

export const PORTABLE_TABLES = Object.freeze([
  defineTable(1, 'archived_message_marks', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('conversation_id', 1, 'TEXT', true, 2), col('message_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(2, 'autonomy_policies', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('revision', 1, 'INTEGER', true, 0), col('daily_dialogue_limit', 2, 'INTEGER', true, 0), col('max_catch_up_hours', 3, 'INTEGER', true, 0), col('freedom', 4, 'TEXT', true, 0), col('quiet_start_minute', 5, 'INTEGER', true, 0), col('quiet_end_minute', 6, 'INTEGER', true, 0), col('social_channel', 7, 'TEXT', false, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(3, 'background_tasks', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('kind', 2, 'TEXT', true, 0), col('state', 3, 'TEXT', true, 0), col('idempotency_key', 4, 'TEXT', true, 0), col('source_revision', 5, 'INTEGER', true, 0), col('attempt', 6, 'INTEGER', true, 0), col('not_before', 7, 'INTEGER', true, 0), col('lease_until', 8, 'INTEGER', true, 0), col('conversation_id', 9, 'TEXT', false, 0), col('instance_id', 10, 'TEXT', false, 0), col('error_code', 11, 'TEXT', false, 0), col('metadata_json', 12, 'TEXT', true, 0), col('window_task_id', 13, 'TEXT', false, 0), col('deferred_message_id', 14, 'TEXT', false, 0), col('deferred_revision', 15, 'INTEGER', false, 0), col('deferred_expires_at', 16, 'INTEGER', false, 0), col('notification_id', 17, 'INTEGER', false, 0), col('extensions_json', 18, 'TEXT', true, 0),
  ]),
  defineTable(4, 'baseline_array_order', 'derived', false, [
    col('world_id', 0, 'TEXT', true, 1), col('entity_id', 1, 'TEXT', true, 2), col('ordinal', 2, 'INTEGER', true, 0),
  ]),
  defineTable(5, 'card_versions', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('card_id', 1, 'TEXT', true, 0), col('revision', 2, 'INTEGER', true, 0), col('definition_json', 3, 'TEXT', true, 0), col('raw_data_json', 4, 'TEXT', true, 0), col('source', 5, 'TEXT', true, 0), col('imported_json', 6, 'TEXT', false, 0), col('extensions_json', 7, 'TEXT', true, 0),
  ]),
  defineTable(6, 'character_cards', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('current_version_id', 1, 'TEXT', true, 0), col('archived', 2, 'INTEGER', true, 0), col('preset_key', 3, 'TEXT', false, 0), col('extensions_json', 4, 'TEXT', true, 0),
  ]),
  defineTable(7, 'character_instances', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('card_id', 2, 'TEXT', true, 0), col('card_version_id', 3, 'TEXT', true, 0), col('revision', 4, 'INTEGER', true, 0), col('overrides_json', 5, 'TEXT', true, 0), col('mood', 6, 'TEXT', true, 0), col('energy', 7, 'REAL', true, 0), col('location', 8, 'TEXT', true, 0), col('autonomy_enabled', 9, 'INTEGER', true, 0), col('proactive_enabled', 10, 'INTEGER', true, 0), col('extensions_json', 11, 'TEXT', true, 0),
  ]),
  defineTable(8, 'conversation_participants', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('conversation_id', 1, 'TEXT', true, 2), col('participant_id', 2, 'TEXT', true, 3), col('kind', 3, 'TEXT', true, 0), col('ordinal', 4, 'INTEGER', true, 0),
  ]),
  defineTable(9, 'conversations', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('type', 2, 'TEXT', true, 0), col('title', 3, 'TEXT', true, 0), col('mode', 4, 'TEXT', true, 0), col('revision', 5, 'INTEGER', true, 0), col('last_read_at', 6, 'INTEGER', true, 0), col('max_speakers', 7, 'INTEGER', false, 0), col('max_messages', 8, 'INTEGER', false, 0), col('reply_timing_enabled', 9, 'INTEGER', false, 0), col('reply_wait_ms', 10, 'INTEGER', false, 0), col('extensions_json', 11, 'TEXT', true, 0),
  ]),
  defineTable(10, 'data_migrations', 'runtime', false, [
    col('id', 0, 'TEXT', true, 1), col('target_schema_version', 1, 'INTEGER', true, 0), col('source_fingerprint', 2, 'TEXT', true, 0), col('collection', 3, 'TEXT', true, 0), col('cursor_json', 4, 'TEXT', true, 0), col('imported_count', 5, 'INTEGER', true, 0), col('state', 6, 'TEXT', true, 0), col('extensions_json', 7, 'TEXT', true, 0),
  ]),
  defineTable(11, 'dataset_metadata', 'business', false, [
    col('singleton', 0, 'INTEGER', true, 1), col('user_id', 1, 'TEXT', true, 0), col('data_version', 2, 'INTEGER', true, 0), col('extensions_json', 3, 'TEXT', true, 0),
  ]),
  defineTable(12, 'domain_command_receipts', 'business', false, [
    col('command_key', 0, 'TEXT', true, 1), col('fingerprint', 1, 'TEXT', true, 0), col('result_id', 2, 'TEXT', true, 0),
  ]),
  defineTable(13, 'effect_array_order', 'derived', false, [
    col('world_id', 0, 'TEXT', true, 1), col('entity_id', 1, 'TEXT', true, 2), col('ordinal', 2, 'INTEGER', true, 0),
  ]),
  defineTable(14, 'effect_baselines', 'business', true, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('target_type', 2, 'TEXT', true, 0), col('target_id', 3, 'TEXT', true, 0), col('target_instance_id', 4, 'TEXT', false, 0), col('target_relationship_id', 5, 'TEXT', false, 0), col('path', 6, 'TEXT', true, 0), col('value_json', 7, 'TEXT', true, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(15, 'entity_ids', 'derived', false, [
    col('id', 0, 'TEXT', true, 1), col('table_name', 1, 'TEXT', true, 0),
  ]),
  defineTable(16, 'event_array_order', 'derived', false, [
    col('world_id', 0, 'TEXT', true, 1), col('entity_id', 1, 'TEXT', true, 2), col('ordinal', 2, 'INTEGER', true, 0),
  ]),
  defineTable(17, 'event_audits', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('event_id', 2, 'TEXT', true, 0), col('at', 3, 'INTEGER', true, 0), col('previous_revision', 4, 'INTEGER', true, 0), col('next_revision', 5, 'INTEGER', true, 0), col('previous_json', 6, 'TEXT', true, 0), col('next_json', 7, 'TEXT', true, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(18, 'event_causes', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('event_id', 1, 'TEXT', true, 2), col('cause_event_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(19, 'event_life_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('event_id', 1, 'TEXT', true, 2), col('grant_id', 2, 'TEXT', true, 3), col('instance_id', 3, 'TEXT', true, 0), col('module_id', 4, 'TEXT', true, 0), col('grant_revision', 5, 'INTEGER', true, 4), col('fingerprint', 6, 'TEXT', true, 5),
  ]),
  defineTable(20, 'event_participants', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('event_id', 1, 'TEXT', true, 2), col('participant_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(21, 'event_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('event_id', 1, 'TEXT', true, 2), col('message_id', 2, 'TEXT', true, 3), col('message_revision', 3, 'INTEGER', true, 0),
  ]),
  defineTable(22, 'life_grants', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('instance_id', 2, 'TEXT', true, 0), col('module_id', 3, 'TEXT', true, 0), col('can_read', 4, 'INTEGER', true, 0), col('can_remember', 5, 'INTEGER', true, 0), col('can_share', 6, 'INTEGER', true, 0), col('revision', 7, 'INTEGER', true, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(23, 'lorebook_entries', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('scope', 2, 'TEXT', true, 0), col('owner_id', 3, 'TEXT', true, 0), col('owner_instance_id', 4, 'TEXT', false, 0), col('keys_json', 5, 'TEXT', true, 0), col('secondary_keys_json', 6, 'TEXT', false, 0), col('content', 7, 'TEXT', true, 0), col('priority', 8, 'INTEGER', true, 0), col('activation_rule', 9, 'TEXT', true, 0), col('visibility', 10, 'TEXT', true, 0), col('source_tag', 11, 'TEXT', true, 0), col('revision', 12, 'INTEGER', true, 0), col('enabled', 13, 'INTEGER', false, 0), col('case_sensitive', 14, 'INTEGER', false, 0), col('extensions_json', 15, 'TEXT', true, 0),
  ]),
  defineTable(24, 'lorebook_known_by', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('entry_id', 1, 'TEXT', true, 2), col('participant_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(25, 'memories', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('owner_type', 2, 'TEXT', true, 0), col('owner_id', 3, 'TEXT', true, 0), col('owner_instance_id', 4, 'TEXT', false, 0), col('layer', 5, 'TEXT', true, 0), col('memory_key', 6, 'TEXT', true, 0), col('content', 7, 'TEXT', true, 0), col('status', 8, 'TEXT', true, 0), col('revision', 9, 'INTEGER', true, 0), col('visibility', 10, 'TEXT', true, 0), col('conversation_id', 11, 'TEXT', false, 0), col('confidence', 12, 'TEXT', false, 0), col('generation_key', 13, 'TEXT', false, 0), col('extensions_json', 14, 'TEXT', true, 0),
  ]),
  defineTable(26, 'memory_events', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('memory_id', 1, 'TEXT', true, 2), col('event_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(27, 'memory_known_by', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('memory_id', 1, 'TEXT', true, 2), col('instance_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(28, 'memory_life_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('memory_id', 1, 'TEXT', true, 2), col('grant_id', 2, 'TEXT', true, 3), col('instance_id', 3, 'TEXT', true, 0), col('module_id', 4, 'TEXT', true, 0), col('grant_revision', 5, 'INTEGER', true, 4), col('fingerprint', 6, 'TEXT', true, 5),
  ]),
  defineTable(29, 'memory_links', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('memory_id', 1, 'TEXT', true, 2), col('target_memory_id', 2, 'TEXT', true, 4), col('kind', 3, 'TEXT', true, 3),
  ]),
  defineTable(30, 'memory_policies', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('strategy', 1, 'TEXT', true, 0), col('enabled', 2, 'INTEGER', true, 0), col('recent_messages', 3, 'INTEGER', true, 0), col('summarize_after', 4, 'INTEGER', true, 0), col('extract_after', 5, 'INTEGER', true, 0), col('context_budget', 6, 'INTEGER', true, 0), col('revision', 7, 'INTEGER', true, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(31, 'memory_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('memory_id', 1, 'TEXT', true, 2), col('message_id', 2, 'TEXT', true, 3), col('message_revision', 3, 'INTEGER', true, 0),
  ]),
  defineTable(32, 'message_audits', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('message_id', 2, 'TEXT', true, 0), col('at', 3, 'INTEGER', true, 0), col('previous_revision', 4, 'INTEGER', true, 0), col('next_revision', 5, 'INTEGER', true, 0), col('previous_json', 6, 'TEXT', true, 0), col('next_json', 7, 'TEXT', true, 0), col('extensions_json', 8, 'TEXT', true, 0),
  ]),
  defineTable(33, 'message_life_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('message_id', 1, 'TEXT', true, 2), col('grant_id', 2, 'TEXT', true, 3), col('instance_id', 3, 'TEXT', true, 0), col('module_id', 4, 'TEXT', true, 0), col('grant_revision', 5, 'INTEGER', true, 4), col('fingerprint', 6, 'TEXT', true, 5),
  ]),
  defineTable(34, 'messages', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('conversation_id', 2, 'TEXT', true, 0), col('role', 3, 'TEXT', true, 0), col('sender_type', 4, 'TEXT', true, 0), col('sender_id', 5, 'TEXT', true, 0), col('sender_name_snapshot', 6, 'TEXT', true, 0), col('content', 7, 'TEXT', true, 0), col('created_at', 8, 'INTEGER', true, 0), col('revision', 9, 'INTEGER', true, 0), col('status', 10, 'TEXT', true, 0), col('turn_id', 11, 'TEXT', true, 0), col('batch_id', 12, 'TEXT', true, 0), col('deleted', 13, 'INTEGER', false, 0), col('reply_to_message_id', 14, 'TEXT', false, 0), col('reply_to_revision', 15, 'INTEGER', false, 0), col('extensions_json', 16, 'TEXT', true, 0),
  ]),
  defineTable(35, 'participants', 'derived', false, [
    col('world_id', 0, 'TEXT', true, 1), col('id', 1, 'TEXT', true, 2), col('kind', 2, 'TEXT', true, 0), col('identity_id', 3, 'TEXT', false, 0), col('instance_id', 4, 'TEXT', false, 0),
  ]),
  defineTable(36, 'preset_applications', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('initialization_key', 2, 'TEXT', true, 0), col('preset_source_id', 3, 'TEXT', true, 0), col('preset_version', 4, 'INTEGER', true, 0), col('extensions_json', 5, 'TEXT', true, 0),
  ]),
  defineTable(37, 'relationship_events', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('relationship_id', 1, 'TEXT', true, 2), col('event_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(38, 'relationships', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('from_id', 2, 'TEXT', true, 0), col('to_id', 3, 'TEXT', true, 0), col('kind', 4, 'TEXT', true, 0), col('trust_baseline', 5, 'TEXT', true, 0), col('public_summary', 6, 'TEXT', true, 0), col('trust', 7, 'REAL', true, 0), col('intimacy', 8, 'REAL', true, 0), col('understanding', 9, 'REAL', true, 0), col('dimension_rule_version', 10, 'INTEGER', true, 0), col('revision', 11, 'INTEGER', true, 0), col('extensions_json', 12, 'TEXT', true, 0),
  ]),
  defineTable(39, 'role_binding_state', 'business', false, [
    col('singleton', 0, 'INTEGER', true, 1), col('revision', 1, 'INTEGER', true, 0), col('extensions_json', 2, 'TEXT', true, 0),
  ]),
  defineTable(40, 'role_bindings', 'business', false, [
    col('scope', 0, 'TEXT', true, 1), col('state_id', 1, 'INTEGER', true, 0), col('world_id', 2, 'TEXT', false, 0), col('instance_id', 3, 'TEXT', false, 0), col('extensions_json', 4, 'TEXT', true, 0),
  ]),
  defineTable(41, 'schema_migration_applications', 'runtime', false, [
    col('version', 0, 'INTEGER', true, 1), col('applied_at', 1, 'INTEGER', false, 0), col('time_source', 2, 'TEXT', true, 0),
  ]),
  defineTable(42, 'schema_migrations', 'runtime', false, [
    col('version', 0, 'INTEGER', true, 1), col('name', 1, 'TEXT', true, 0), col('checksum', 2, 'TEXT', true, 0),
  ]),
  defineTable(43, 'task_result_events', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('task_id', 1, 'TEXT', true, 2), col('event_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(44, 'task_result_memories', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('task_id', 1, 'TEXT', true, 2), col('memory_id', 2, 'TEXT', true, 3),
  ]),
  defineTable(45, 'task_social_participants', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('task_id', 1, 'TEXT', true, 2), col('conversation_id', 2, 'TEXT', true, 0), col('instance_id', 3, 'TEXT', true, 3), col('kind', 4, 'TEXT', true, 0),
  ]),
  defineTable(46, 'task_sources', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('task_id', 1, 'TEXT', true, 2), col('message_id', 2, 'TEXT', true, 3), col('message_revision', 3, 'INTEGER', true, 0),
  ]),
  defineTable(47, 'usage_events', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('conversation_id', 2, 'TEXT', true, 0), col('instance_id', 3, 'TEXT', true, 0), col('participant_kind', 4, 'TEXT', true, 0), col('turn_id', 5, 'TEXT', true, 0), col('model', 6, 'TEXT', true, 0), col('official_provider', 7, 'INTEGER', true, 0), col('started_at', 8, 'INTEGER', true, 0), col('finished_at', 9, 'INTEGER', false, 0), col('transport', 10, 'TEXT', true, 0), col('status', 11, 'TEXT', true, 0), col('error_code', 12, 'TEXT', true, 0), col('finish_reason', 13, 'TEXT', true, 0), col('estimated_input_tokens', 14, 'INTEGER', true, 0), col('estimated_output_tokens', 15, 'INTEGER', true, 0), col('prompt_tokens', 16, 'INTEGER', false, 0), col('completion_tokens', 17, 'INTEGER', false, 0), col('cache_hit_tokens', 18, 'INTEGER', false, 0), col('purpose', 19, 'TEXT', false, 0), col('extensions_json', 20, 'TEXT', true, 0),
  ]),
  defineTable(48, 'virtual_schedule_days', 'business', false, [
    col('world_id', 0, 'TEXT', true, 1), col('schedule_id', 1, 'TEXT', true, 2), col('day', 2, 'INTEGER', true, 3),
  ]),
  defineTable(49, 'virtual_schedules', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('instance_id', 2, 'TEXT', true, 0), col('start_minute', 3, 'INTEGER', true, 0), col('end_minute', 4, 'INTEGER', true, 0), col('location', 5, 'TEXT', true, 0), col('activity', 6, 'TEXT', true, 0), col('resting', 7, 'INTEGER', true, 0), col('revision', 8, 'INTEGER', true, 0), col('extensions_json', 9, 'TEXT', true, 0),
  ]),
  defineTable(50, 'world_effects', 'business', true, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('event_id', 2, 'TEXT', true, 0), col('target_type', 3, 'TEXT', true, 0), col('target_id', 4, 'TEXT', true, 0), col('target_instance_id', 5, 'TEXT', false, 0), col('target_relationship_id', 6, 'TEXT', false, 0), col('operation', 7, 'TEXT', true, 0), col('path', 8, 'TEXT', true, 0), col('value_json', 9, 'TEXT', true, 0), col('rule_version', 10, 'INTEGER', true, 0), col('extensions_json', 11, 'TEXT', true, 0),
  ]),
  defineTable(51, 'world_events', 'business', true, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('status', 2, 'TEXT', true, 0), col('visibility', 3, 'TEXT', true, 0), col('summary', 4, 'TEXT', true, 0), col('effective_at', 5, 'INTEGER', true, 0), col('recorded_at', 6, 'INTEGER', true, 0), col('revision', 7, 'INTEGER', true, 0), col('causality', 8, 'TEXT', false, 0), col('kind', 9, 'TEXT', false, 0), col('action_instance_id', 10, 'TEXT', false, 0), col('action_relationship_id', 11, 'TEXT', false, 0), col('action_location', 12, 'TEXT', false, 0), col('replaces_event_id', 13, 'TEXT', false, 0), col('extensions_json', 14, 'TEXT', true, 0),
  ]),
  defineTable(52, 'world_identities', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('world_id', 1, 'TEXT', true, 0), col('user_id', 2, 'TEXT', true, 0), col('display_name', 3, 'TEXT', true, 0), col('background', 4, 'TEXT', true, 0), col('revision', 5, 'INTEGER', true, 0), col('extensions_json', 6, 'TEXT', true, 0),
  ]),
  defineTable(53, 'worlds', 'business', false, [
    col('id', 0, 'TEXT', true, 1), col('name', 1, 'TEXT', true, 0), col('rules', 2, 'TEXT', true, 0), col('revision', 3, 'INTEGER', true, 0), col('time_zone', 4, 'TEXT', true, 0), col('created_at', 5, 'INTEGER', true, 0), col('last_simulated_at', 6, 'INTEGER', true, 0), col('autonomy_enabled', 7, 'INTEGER', true, 0), col('proactive_enabled', 8, 'INTEGER', true, 0), col('notifications_enabled', 9, 'INTEGER', true, 0), col('default_chat_mode', 10, 'TEXT', true, 0), col('archived', 11, 'INTEGER', false, 0), col('identity_id', 12, 'TEXT', true, 0), col('extensions_json', 13, 'TEXT', true, 0),
  ]),
])

export const PORTABLE_BUSINESS_TABLES = Object.freeze(PORTABLE_TABLES.filter(t => t.category === 'business'))
export const PORTABLE_DERIVED_TABLES = Object.freeze(PORTABLE_TABLES.filter(t => t.category === 'derived'))
export const PORTABLE_RUNTIME_TABLES = Object.freeze(PORTABLE_TABLES.filter(t => t.category === 'runtime'))
export const PORTABLE_FOOTER_TABLES = Object.freeze(PORTABLE_TABLES.filter(t => t.category !== 'runtime'))

/** @type {ReadonlyMap<number, (typeof PORTABLE_TABLES)[number]>} */
export const PORTABLE_TABLES_BY_ID = new Map(PORTABLE_TABLES.map(t => [t.tableId, t]))
/** @type {ReadonlyMap<string, (typeof PORTABLE_TABLES)[number]>} */
export const PORTABLE_TABLES_BY_NAME = new Map(PORTABLE_TABLES.map(t => [t.name, t]))

/**
 * Encode canonical Schema 001..005 DDL byte sequence for SHA-256 fingerprint calculation.
 * @param {readonly { version: number, statements: readonly string[] }[]} migrations
 * @returns {Uint8Array}
 */
export function encodeSchema005CanonicalSequence(migrations) {
  const encoder = new TextEncoder()
  const parts = [asciiBytes(PORTABLE_DOMAIN.SCHEMA_005)]
  for (const migration of migrations) {
    const header = new Uint8Array(6)
    writeU16BE(header, 0, migration.version)
    writeU32BE(header, 2, migration.statements.length)
    parts.push(header)
    for (const statement of migration.statements) {
      const stmtBytes = encoder.encode(statement)
      const len = new Uint8Array(4)
      writeU32BE(len, 0, stmtBytes.byteLength)
      parts.push(len, stmtBytes)
    }
  }
  return concatBytes(...parts)
}
