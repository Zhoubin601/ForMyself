// @ts-check
import { validateId } from '../../domain/kanataValidation.js'
import { pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
const worlds = 'SELECT id,name AS title,archived,revision,rowid AS ordinal FROM worlds WHERE rowid>? ORDER BY rowid LIMIT ?'
const worldSummary = 'SELECT id,name AS title,archived,revision FROM worlds WHERE id=?'
const pages = Object.freeze({
  conversations: `SELECT id,title,type AS status,revision FROM conversations
    WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
  actors: `SELECT i.id,i.revision,CASE WHEN json_type(i.overrides_json,'$.name') IS NULL THEN json_extract(v.definition_json,'$.name')
      ELSE json_extract(i.overrides_json,'$.name') END AS title
    FROM character_instances i JOIN card_versions v ON v.card_id=i.card_id AND v.id=i.card_version_id
    WHERE i.world_id=? AND i.id>? ORDER BY i.id LIMIT ?`,
  lorebook: `SELECT id,source_tag AS title,scope AS status,revision FROM lorebook_entries
    WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
  memories: `SELECT id,substr(memory_key,1,120) AS title,status,revision FROM memories
    WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
  events: `SELECT id,substr(summary,1,120) AS title,status,revision FROM world_events
    WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
  tasks: `SELECT id,kind AS title,state AS status FROM background_tasks
    WHERE world_id=? AND id>? ORDER BY id LIMIT ?`,
})
export const managementViewQueries = [worlds, worldSummary, ...Object.values(pages)]

/** @param {Row} row */
function summary(row) {
  if (typeof row.title !== 'string' || !row.title.trim()) throw new Error('KANATA_SUMMARY_INVALID')
  return { id: String(row.id), title: row.title,
    ...(row.status && { status: String(row.status) }),
    ...(row.revision && { revision: Number(row.revision) }) }
}

/** @param {Operation} operation */
export function createKanataManagementViewRepository(operation) {
  return {
    /** @param {number} [after] @param {number} [limit] */
    worlds: (after = 0, limit = 50) => operation.transaction(async tx => {
      need(safeInteger(after), 'KANATA_WORLD_CURSOR_INVALID')
      const rows = await tx.query(worlds, [after, pageLimit(limit) + 1])
      return { entries: rows.slice(0, limit).map(row => ({ ...summary(row), archived: row.archived === 1 })),
        cursor: rows.length > limit ? Number(rows[limit - 1].ordinal) : null }
    }),
    /** @param {string} id */
    world: id => operation.transaction(async tx => {
      validateId(id, 'worldId')
      const [row] = await tx.query(worldSummary, [id])
      return row ? { ...summary(row), archived: row.archived === 1 } : null
    }),
    /** @param {string} worldId @param {keyof typeof pages} section @param {string} [after] @param {number} [limit] */
    list: (worldId, section, after = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (after) validateId(after, 'cursor')
      need(Object.hasOwn(pages, section), 'KANATA_MANAGEMENT_SECTION_INVALID')
      const rows = await tx.query(pages[section], [worldId, after, pageLimit(limit) + 1])
      return { entries: rows.slice(0, limit).map(summary), cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
  }
}
