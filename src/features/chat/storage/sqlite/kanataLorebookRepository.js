// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { normalizeCharacterCard } from '../../cards/characterCardImport.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { nonemptyText, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'
import { assertActor } from './kanataProvenance.js'

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
const knownBy = 'SELECT participant_id FROM lorebook_known_by WHERE world_id=? AND entry_id=? AND participant_id>? ORDER BY participant_id LIMIT 50'
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
const instanceVersion = 'SELECT card_id,card_version_id FROM character_instances WHERE world_id=? AND id=?'
const cardLoreBook = `SELECT json_extract(raw_data_json,'$.spec') AS spec,json_extract(raw_data_json,'$.spec_version') AS spec_version,
  json_extract(raw_data_json,'$.name') AS name,json_extract(definition_json,'$.name') AS def_name,
  coalesce(json_extract(raw_data_json,'$.data.character_book'),json_extract(raw_data_json,'$.character_book')) AS book_json
  FROM card_versions WHERE card_id=? AND id=?`
const cardLoreConflict = `SELECT id FROM lorebook_entries WHERE world_id=? AND owner_id=? AND (
  source_tag=? OR content=? OR EXISTS (SELECT 1 FROM json_each(keys_json) k WHERE k.value IN (SELECT value FROM json_each(?)))
) LIMIT 1`
const link = 'INSERT INTO lorebook_known_by(world_id,entry_id,participant_id) VALUES(?,?,?)'
const unlink = 'DELETE FROM lorebook_known_by WHERE world_id=? AND entry_id=?'
const remove = 'DELETE FROM lorebook_entries WHERE world_id=? AND id=? AND revision=?'
export const lorebookQueries = [entries.get, knownBy, list, visible, promptVisible, duplicate, instanceVersion, cardLoreBook, cardLoreConflict]
export const lorebookWrites = [...entries.writeStatements, link, unlink, remove]

/** @param {Tx} tx @param {StoredEntry} dto */
async function withReaders(tx, { ownerInstanceId: _ownerInstanceId, ...dto }) {
  const known = []
  for (let after = ''; ;) {
    const readers = await tx.query(knownBy, [dto.worldId, dto.id, after])
    for (const reader of readers) known.push(String(reader.participant_id))
    if (readers.length < 50) break
    after = known[known.length - 1]
  }
  return { ...dto, knownBy: known }
}

/** @param {Tx} tx @param {string} worldId @param {string} instanceId */
async function collectCardLore(tx, worldId, instanceId) {
  validateId(worldId, 'worldId')
  validateId(instanceId, 'instanceId')
  const [inst] = await tx.query(instanceVersion, [worldId, instanceId])
  const owner = found(inst, 'INSTANCE_NOT_FOUND')
  const cardId = String(owner.card_id), versionId = String(owner.card_version_id)
  const [ver] = await tx.query(cardLoreBook, [cardId, versionId])
  const row = found(ver, 'ORPHAN_CARD_VERSION')
  if (!row.book_json || (!row.spec && !row.name)) return []
  const book = JSON.parse(String(row.book_json))
  const name = String(row.name || row.def_name || '角色')
  const syntheticRaw = row.spec
    ? { spec: String(row.spec), spec_version: String(row.spec_version ?? (row.spec === 'chara_card_v3' ? '3.0' : '2.0')), data: { name, character_book: book } }
    : { name, character_book: book }
  const items = normalizeCharacterCard(syntheticRaw).lorebook
  const candidates = []
  for (const entry of items) {
    const sourceTag = 'card:' + versionId + ':' + entry.key
    const [existing] = await tx.query(cardLoreConflict, [worldId, instanceId, sourceTag, entry.content, JSON.stringify(entry.keys)])
    candidates.push({ ...entry, worldId, instanceId, sourceTag, ...(existing ? { conflictId: String(existing.id) } : {}) })
  }
  return candidates
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
      await assertActor(tx, worldId, actorId)
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
    /** @param {string} worldId @param {string} instanceId */
    previewCardLore: (worldId, instanceId) => operation.transaction(tx => collectCardLore(tx, worldId, instanceId)),
    /** @param {string} worldId @param {string} instanceId @param {{skipConflicts:boolean,commandId:string,idFactory:(kind:string,key:string)=>string}} options */
    attachCardLore: (worldId, instanceId, options) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(instanceId, 'instanceId')
      validateId(options.commandId, 'commandId')
      await assertWritableWorld(tx, worldId)
      let created = /** @type {string[]} */ ([])
      await executeOnce(tx, ['lore:attach-card', worldId, instanceId, options.commandId],
        { skipConflicts: Boolean(options.skipConflicts) }, async () => {
          const candidates = await collectCardLore(tx, worldId, instanceId)
          need(!candidates.some(item => item.conflictId) || options.skipConflicts === true, 'LORE_CONFLICT_REQUIRES_DECISION')
          for (const candidate of candidates.filter(item => !item.conflictId)) {
            const id = options.idFactory('lore', JSON.stringify([instanceId, candidate.sourceTag]))
            validateId(id, 'loreId')
            const content = candidate.content || '（未提供条目内容；保持停用）'
            const stored = /** @type {StoredEntry} */ ({
              id, worldId, scope: 'character', ownerId: instanceId, ownerInstanceId: instanceId,
              keys: candidate.keys, secondaryKeys: candidate.secondaryKeys, content, priority: candidate.priority,
              activationRule: candidate.activationRule, visibility: 'private', knownBy: [instanceId],
              sourceTag: candidate.sourceTag, revision: 1, enabled: candidate.enabled, caseSensitive: candidate.caseSensitive,
            })
            await entries.create(tx, stored)
            await writeOne(tx, link, [worldId, id, instanceId])
            created.push(id)
          }
          return created[0] ?? instanceId
        })
      return { created }
    }),
  }
}
