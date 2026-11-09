// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { nonemptyText, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').LorebookEntry} Entry */
/** @typedef {Entry & {ownerInstanceId?:string}} StoredEntry */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */

const entries = /** @type {ReturnType<typeof domainTable<StoredEntry>>} */ (domainTable('lorebook_entries', {
  world_id: 'worldId', id: 'id', scope: 'scope', owner_id: 'ownerId', owner_instance_id: 'ownerInstanceId',
  keys_json: 'keys:json', secondary_keys_json: 'secondaryKeys:json', content: 'content', priority: 'priority',
  activation_rule: 'activationRule', visibility: 'visibility', source_tag: 'sourceTag', revision: 'revision',
  enabled: 'enabled:flag', case_sensitive: 'caseSensitive:flag',
}, ['world_id', 'id'], ['knownBy']))
const knownBy = 'SELECT participant_id FROM lorebook_known_by WHERE world_id=? AND entry_id=? ORDER BY participant_id'
const list = `SELECT ${entries.stored} FROM lorebook_entries WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const visible = `WITH scope(world,actor,after_id) AS (VALUES(?,?,?))
  SELECT l.* FROM scope JOIN worlds w ON w.id=scope.world AND coalesce(w.archived,0)=0
  JOIN character_instances i ON i.world_id=scope.world AND i.id=scope.actor
  JOIN lorebook_entries l ON l.world_id=scope.world AND l.id>scope.after_id
  WHERE coalesce(l.enabled,1)=1 AND (
    (l.scope='character' AND l.owner_id=scope.actor)
    OR EXISTS (SELECT 1 FROM lorebook_known_by k WHERE k.world_id=l.world_id AND k.entry_id=l.id AND k.participant_id=scope.actor)
    OR (l.visibility='public' AND l.scope<>'character' AND NOT EXISTS (
      SELECT 1 FROM lorebook_known_by k WHERE k.world_id=l.world_id AND k.entry_id=l.id
    ))) ORDER BY l.id LIMIT ?`
const promptVisible = visible.replace('SELECT l.*', 'SELECT l.id,l.content,l.priority,l.revision,l.activation_rule,l.keys_json,l.secondary_keys_json,l.case_sensitive')
  .replace('WHERE coalesce(l.enabled,1)=1 AND (', 'WHERE coalesce(l.enabled,1)=1 AND length(CAST(l.content AS BLOB))<=3992 AND (')
const duplicate = 'SELECT id FROM lorebook_entries WHERE world_id=? AND owner_id=? AND content=? LIMIT 1'
const link = 'INSERT INTO lorebook_known_by(world_id,entry_id,participant_id) VALUES(?,?,?)'
const unlink = 'DELETE FROM lorebook_known_by WHERE world_id=? AND entry_id=?'
const remove = 'DELETE FROM lorebook_entries WHERE world_id=? AND id=? AND revision=?'
export const lorebookQueries = [entries.get, knownBy, list, visible, promptVisible, duplicate]
export const lorebookWrites = [...entries.writeStatements, link, unlink, remove]

/** @param {Tx} tx @param {StoredEntry} dto */
async function withReaders(tx, { ownerInstanceId: _ownerInstanceId, ...dto }) {
  const readers = await tx.query(knownBy, [dto.worldId, dto.id])
  return { ...dto, knownBy: readers.map(reader => String(reader.participant_id)) }
}
/** @param {Entry} input */
function validate(input) {
  validateId(input.id, 'loreId')
  validateId(input.worldId, 'worldId')
  validateId(input.ownerId, 'ownerId')
  need(Array.isArray(input.knownBy), 'LORE_READERS_INVALID')
  for (const id of input.knownBy) validateId(id, 'lore.knownBy')
  need(new Set(input.knownBy).size === input.knownBy.length, 'LORE_DUPLICATE_READER')
  need(input.visibility !== 'private' || input.knownBy.length > 0, 'PRIVATE_KNOWLEDGE_REQUIRED')
  for (const keys of [input.keys, input.secondaryKeys ?? []]) {
    need(Array.isArray(keys) && keys.every(nonemptyText) && new Set(keys).size === keys.length, 'LORE_KEYS_INVALID')
  }
  need(nonemptyText(input.content) && nonemptyText(input.sourceTag) && safeInteger(input.priority), 'LORE_FIELDS_INVALID')
  return cloneKanataJson(input)
}

/** @param {Operation} operation */
export function createKanataLorebookRepository(operation) {
  return {
    /** @param {string} worldId @param {string} afterId @param {number} limit @param {string} [actorId] */
    list: (worldId, afterId = '', limit = 50, actorId) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (afterId) validateId(afterId, 'loreCursor')
      if (actorId !== undefined) validateId(actorId, 'instanceId')
      const rows = await tx.query(actorId === undefined ? list : visible,
        actorId === undefined ? [worldId, afterId, pageLimit(limit) + 1] : [worldId, actorId, afterId, pageLimit(limit) + 1])
      const result = []
      for (const row of rows.slice(0, limit)) result.push(await withReaders(tx, entries.decode(row)))
      return { entries: result, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} worldId @param {string} actorId @param {string} afterId @param {number} limit */
    promptCandidates: (worldId, actorId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(actorId, 'instanceId')
      if (afterId) validateId(afterId, 'loreCursor')
      const rows = await tx.query(promptVisible, [worldId, actorId, afterId, pageLimit(limit) + 1])
      const result = rows.slice(0, limit).map(row => ({
        id: String(row.id), content: String(row.content), priority: Number(row.priority), revision: Number(row.revision),
        activationRule: /** @type {Entry['activationRule']} */ (row.activation_rule), caseSensitive: row.case_sensitive === 1,
        keys: /** @type {string[]} */ (JSON.parse(String(row.keys_json))),
        secondaryKeys: row.secondary_keys_json === null ? undefined : /** @type {string[]} */ (JSON.parse(String(row.secondary_keys_json))),
      }))
      return { entries: result, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} worldId @param {string} id */
    getManaged: (worldId, id) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(id, 'loreId')
      const item = await entries.read(tx, [worldId, id])
      return item ? withReaders(tx, item) : null
    }),
    /** @param {Entry} entry @param {number|null} expectedRevision */
    save: (entry, expectedRevision) => operation.transaction(async tx => {
      const dto = validate(entry)
      await assertWritableWorld(tx, dto.worldId)
      const id = await executeOnce(tx, ['lore:save', dto.worldId, dto.id, String(expectedRevision)], dto, async () => {
        const previous = await entries.read(tx, [dto.worldId, dto.id])
        need(previous ? previous.revision === expectedRevision : expectedRevision === null, 'LORE_EDIT_CONFLICT')
        const stored = { ...dto, revision: (previous?.revision ?? 0) + 1,
          ...(dto.scope === 'character' && { ownerInstanceId: dto.ownerId }) }
        if (previous) {
          await entries.replace(tx, stored, [dto.worldId, dto.id], previous.revision)
          await tx.execute(unlink, [dto.worldId, dto.id])
        } else {
          need(!(await tx.query(duplicate, [dto.worldId, dto.ownerId, dto.content])).length, 'LORE_DUPLICATE_CONTENT')
          await entries.create(tx, stored)
        }
        for (const actor of dto.knownBy) await writeOne(tx, link, [dto.worldId, dto.id, actor])
        return dto.id
      })
      return withReaders(tx, found(await entries.read(tx, [dto.worldId, id]), 'LORE_EDIT_CONFLICT'))
    }),
    /** @param {string} worldId @param {string} id @param {number} expectedRevision */
    delete: (worldId, id, expectedRevision) => operation.transaction(async tx => {
      validateId(id, 'loreId')
      await assertWritableWorld(tx, worldId)
      await executeOnce(tx, ['lore:delete', worldId, id, String(expectedRevision)], expectedRevision, async () => {
        await tx.execute(unlink, [worldId, id])
        await writeOne(tx, remove, [worldId, id, expectedRevision])
        return id
      })
    }),
  }
}
