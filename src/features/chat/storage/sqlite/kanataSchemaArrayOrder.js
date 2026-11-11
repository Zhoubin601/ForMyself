// @ts-check
// Additive 005 only. Released 001–004 definitions/checksums stay frozen.
export const KANATA_ARRAY_TABLES = Object.freeze([
  Object.freeze({ entity: 'world_events', order: 'event_array_order' }),
  Object.freeze({ entity: 'world_effects', order: 'effect_array_order' }),
  Object.freeze({ entity: 'effect_baselines', order: 'baseline_array_order' }),
])

/** Committed rows cannot have orphan order entries (composite FK). Equal counts
 * therefore prove complete coverage without returning entity IDs or JSON to JS.
 * @param {string} world */
export const arrayOrderMissing = world => KANATA_ARRAY_TABLES.map(({ entity, order }) =>
  `(SELECT count(*) FROM ${entity} WHERE world_id=${world})<>(SELECT count(*) FROM ${order} WHERE world_id=${world})`).join(' OR ')

/** Only an empty mapping can be inherited from 001–004: 005 never backfills.
 * Every new entity inserts exactly one immutable, deferred-FK-bound order row;
 * ordinary DML cannot create a partially mapped committed world. The per-row
 * trigger checks this bootstrap invariant with indexed existence probes rather
 * than rescanning a growing world for each entity. Repository entry points still
 * perform the FULL coverage check above, including partially damaged databases.
 * @param {string} world */
const inheritedOrderMissing = world => KANATA_ARRAY_TABLES.map(({ entity, order }) =>
  `(EXISTS(SELECT 1 FROM ${entity} WHERE world_id=${world}) AND NOT EXISTS(SELECT 1 FROM ${order} WHERE world_id=${world}))`).join(' OR ')

export function createKanataArrayOrderMigration() {
  /** @type {string[]} */
  const statements = []
  for (const { entity, order } of KANATA_ARRAY_TABLES) {
    statements.push(`CREATE TABLE ${order} (
      world_id TEXT NOT NULL, entity_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY(world_id,entity_id), UNIQUE(world_id,ordinal),
      FOREIGN KEY(world_id,entity_id) REFERENCES ${entity}(world_id,id) DEFERRABLE INITIALLY DEFERRED
    ) STRICT`)
    // The order row precedes its NEW entity within the same transaction. A direct
    // insert for an existing historical entity is never an allowed repair path.
    statements.push(`CREATE TRIGGER ${order}_new_only BEFORE INSERT ON ${order} BEGIN
      SELECT RAISE(ABORT,'KANATA_DOMAIN_ARRAY_ORDER_IMMUTABLE') WHERE
        EXISTS(SELECT 1 FROM ${entity} WHERE id=NEW.entity_id)
        OR EXISTS(SELECT 1 FROM ${order} WHERE world_id=NEW.world_id AND (entity_id=NEW.entity_id OR ordinal=NEW.ordinal));
    END`)
    for (const action of ['UPDATE', 'DELETE']) statements.push(
      `CREATE TRIGGER ${order}_no_${action.toLowerCase()} BEFORE ${action} ON ${order} BEGIN SELECT RAISE(ABORT,'KANATA_DOMAIN_ARRAY_ORDER_IMMUTABLE'); END`)
  }
  for (const { entity, order } of KANATA_ARRAY_TABLES) {
    statements.push(`CREATE TRIGGER ${entity}_array_order_insert BEFORE INSERT ON ${entity} BEGIN
      SELECT RAISE(ABORT,'KANATA_DUPLICATE_ENTITY_ID') WHERE EXISTS(SELECT 1 FROM entity_ids WHERE id=NEW.id);
      SELECT RAISE(ABORT,'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED') WHERE ${inheritedOrderMissing('NEW.world_id')};
      INSERT INTO ${order}(world_id,entity_id,ordinal)
        SELECT NEW.world_id,NEW.id,COALESCE(MAX(ordinal)+1,0) FROM ${order} WHERE world_id=NEW.world_id;
    END`)
    for (const action of ['UPDATE', 'DELETE']) statements.push(
      `CREATE TRIGGER ${entity}_array_order_${action.toLowerCase()} BEFORE ${action} ON ${entity} BEGIN
        SELECT RAISE(ABORT,'KANATA_DOMAIN_ARRAY_ORDER_REQUIRED') WHERE ${inheritedOrderMissing('OLD.world_id')};
      END`)
  }
  return Object.freeze({ version: 5, name: 'kanata-domain-array-order', statements: Object.freeze(statements) })
}
