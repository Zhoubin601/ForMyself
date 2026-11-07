// @ts-check
// Appended migration only: never rewrite the released 001/002 definitions.
const REDACTED = '（已删除的原始记录）'
/** @param {string} condition @param {string} code */
const reject = (condition, code) => `SELECT RAISE(ABORT,'${code}') WHERE ${condition};`
/** @param {'NEW'|'a'} alias */
function messageSnapshotInvalid(alias) {
  return ['previous', 'next'].map(key => `NOT EXISTS(SELECT 1 FROM messages m WHERE m.world_id=${alias}.world_id AND m.id=${alias}.message_id
    AND json_extract(${alias}.${key}_json,'$.conversationId') IS m.conversation_id
    AND json_extract(${alias}.${key}_json,'$.senderId') IS m.sender_id
    AND json_extract(${alias}.${key}_json,'$.senderType') IS m.sender_type
    AND json_extract(${alias}.${key}_json,'$.role') IS m.role
    AND json_extract(${alias}.${key}_json,'$.createdAt') IS m.created_at)
    OR json_type(${alias}.${key}_json,'$.content') IS NOT 'text'
    OR json_type(${alias}.${key}_json,'$.senderNameSnapshot') IS NOT 'text'
    OR json_extract(${alias}.${key}_json,'$.status') NOT IN ('complete','stopped')
    OR json_type(${alias}.${key}_json,'$.status') IS NOT 'text'
    OR (json_type(${alias}.${key}_json,'$.deleted') IS NOT NULL AND json_type(${alias}.${key}_json,'$.deleted') NOT IN ('true','false'))`).join(' OR ')
}
/** A missing historical interval is allowed; a fork/overlap is not fabricated into a chain.
 * @param {string} table @param {string} owner @param {string} alias */
const overlap = (table, owner, alias) => `EXISTS(SELECT 1 FROM ${table} other WHERE other.world_id=${alias}.world_id AND other.${owner}=${alias}.${owner}
  AND ${alias}.previous_revision<other.next_revision AND other.previous_revision<${alias}.next_revision${alias==='a'?' AND other.id<>a.id':''})`

/** Bounded native validation before installing new guards on an existing legacy DB.
 * These queries return at most one marker, never user snapshots to JS. */
export const KANATA_AUDIT_VALIDATION_QUERIES = Object.freeze([
  `SELECT 1 AS invalid FROM message_audits a WHERE ${messageSnapshotInvalid('a')} LIMIT 1`,
  ...[['message_audits','message_id'],['event_audits','event_id']].map(([table,owner]) =>
    // v1 has no access indexes yet. A correlated pairwise scan could be quadratic.
    `SELECT 1 AS invalid FROM (SELECT previous_revision,MAX(next_revision) OVER (
      PARTITION BY world_id,${owner} ORDER BY previous_revision,next_revision,id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end FROM ${table})
      WHERE previous_revision<prior_end LIMIT 1`)
])

/** @type {string[]} */
const statements = [
  `CREATE TABLE schema_migration_applications (
version INTEGER NOT NULL PRIMARY KEY REFERENCES schema_migrations(version),
applied_at INTEGER CHECK(applied_at IS NULL OR applied_at BETWEEN 0 AND 9007199254740991),
time_source TEXT NOT NULL CHECK(time_source IN ('js-wall-clock-utc-ms','legacy-unrecorded')),
CHECK((time_source='legacy-unrecorded' AND applied_at IS NULL AND version IN (1,2)) OR (time_source='js-wall-clock-utc-ms' AND applied_at IS NOT NULL))
) STRICT`
]
for(const [table,owner] of [['message_audits','message_id'],['event_audits','event_id']]) {
  statements.push(`CREATE UNIQUE INDEX ${table}_revision_unique ON ${table}(world_id,${owner},next_revision)`)
  statements.push(`CREATE TRIGGER ${table}_revision_intervals BEFORE INSERT ON ${table} BEGIN ${reject(overlap(table,owner,'NEW'),'KANATA_AUDIT_REVISION_CONFLICT')} END`)
  statements.push(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'KANATA_AUDIT_IMMUTABLE'); END`)
}
statements.push(`CREATE TRIGGER message_audits_snapshot_scope BEFORE INSERT ON message_audits BEGIN ${reject(messageSnapshotInvalid('NEW'),'KANATA_AUDIT_SNAPSHOT_INVALID')} END`)
statements.push(`CREATE TRIGGER event_audits_no_update BEFORE UPDATE ON event_audits BEGIN SELECT RAISE(ABORT,'KANATA_AUDIT_IMMUTABLE'); END`)

// Existing P5 deletion deliberately redacts ALL historical message bodies. Permit
// only that deterministic, irreversible privacy operation, after live deletion.
// IDs, scope, clock, revisions, extensions and every other snapshot field stay fixed.
statements.push(`CREATE TRIGGER message_audits_restrict_update BEFORE UPDATE ON message_audits BEGIN
${reject(`NOT (
NEW.id IS OLD.id AND NEW.world_id IS OLD.world_id AND NEW.message_id IS OLD.message_id
AND NEW.at IS OLD.at AND NEW.previous_revision IS OLD.previous_revision AND NEW.next_revision IS OLD.next_revision
AND NEW.extensions_json IS OLD.extensions_json
AND EXISTS(SELECT 1 FROM messages m WHERE m.world_id=OLD.world_id AND m.id=OLD.message_id AND m.deleted=1 AND m.content='${REDACTED}')
AND json(NEW.previous_json) IS json_set(OLD.previous_json,'$.content','${REDACTED}','$.deleted',json('true'))
AND json(NEW.next_json) IS json_set(OLD.next_json,'$.content','${REDACTED}','$.deleted',json('true'))
)`,'KANATA_AUDIT_IMMUTABLE')}
END`)
for(const table of ['schema_migrations','schema_migration_applications']) {
  for(const action of ['UPDATE','DELETE'])statements.push(`CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'KANATA_SCHEMA_JOURNAL_IMMUTABLE'); END`)
  // Explicit abort defeats outer OR REPLACE even with recursive_triggers=OFF.
  statements.push(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} BEGIN ${reject(`EXISTS(SELECT 1 FROM ${table} WHERE version=NEW.version)`,'KANATA_SCHEMA_JOURNAL_IMMUTABLE')} END`)
}
/** Registry writes are owned by the released entity AFTER INSERT/DELETE triggers.
 * Guarding only the entity tables lets direct registry DML bypass global IDs.
 * @param {readonly string[]} tables */
export function createKanataSchemaHardening(tables) {
  /** @param {string} alias */
  const ownerExists = alias => tables.map(table => `(${alias}.table_name='${table}' AND EXISTS(SELECT 1 FROM ${table} WHERE id=${alias}.id))`).join(' OR ')
  return Object.freeze({version:3,name:'kanata-audit-and-application-time',statements:Object.freeze([...statements,
    `CREATE TRIGGER entity_ids_no_update BEFORE UPDATE ON entity_ids BEGIN SELECT RAISE(ABORT,'KANATA_ENTITY_REGISTRY_OWNED'); END`,
    `CREATE TRIGGER entity_ids_guard_delete BEFORE DELETE ON entity_ids BEGIN ${reject(ownerExists('OLD'),'KANATA_ENTITY_REGISTRY_OWNED')} END`,
    `CREATE TRIGGER entity_ids_guard_insert BEFORE INSERT ON entity_ids BEGIN ${reject(`EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id) OR NOT (${ownerExists('NEW')})`,'KANATA_ENTITY_REGISTRY_OWNED')} END`
  ])})
}
/** Refuse an already damaged legacy registry; never synthesize ownership.
 * Only a bounded marker crosses the native/JS boundary.
 * @param {readonly string[]} tables */
export function createKanataRegistryValidationQueries(tables) {
  const entities=tables.map(table=>`SELECT id,'${table}' AS table_name FROM ${table}`).join(' UNION ALL ')
  return Object.freeze([`WITH actual AS (${entities}) SELECT 1 AS invalid FROM (
    SELECT a.id FROM actual a LEFT JOIN entity_ids r ON r.id=a.id AND r.table_name=a.table_name WHERE r.id IS NULL
    UNION ALL SELECT r.id FROM entity_ids r LEFT JOIN actual a ON a.id=r.id AND a.table_name=r.table_name WHERE a.id IS NULL
  ) LIMIT 1`])
}
