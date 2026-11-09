// @ts-check
import { conversationAccess } from './kanataProvenance.js'
import { pageLimit, requireSqliteValue as need, safeInteger, scopeBindings } from './kanataRepositoryValues.js'

/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('../../domain/kanataTypes').Conversation} Conversation */
/** @typedef {Pick<Conversation,'id'|'type'|'title'|'mode'|'revision'|'replyLimits'|'replyTiming'>} ConversationSummary */

const overview = `SELECT c.id,c.type,c.title,c.mode,c.revision,c.last_read_at,c.max_speakers,c.max_messages,c.reply_timing_enabled,c.reply_wait_ms,
  w.id AS world_id,w.name,w.archived,w.default_chat_mode
  FROM conversations c JOIN worlds w ON w.id=c.world_id WHERE c.world_id=? AND c.id=?`
const members = `SELECT p.participant_id AS id,p.ordinal,
  CASE WHEN json_type(i.overrides_json,'$.name') IS NULL THEN json_extract(v.definition_json,'$.name')
    ELSE json_extract(i.overrides_json,'$.name') END AS name
  FROM conversation_participants p
  JOIN character_instances i ON i.world_id=p.world_id AND i.id=p.participant_id
  JOIN card_versions v ON v.card_id=i.card_id AND v.id=i.card_version_id
  WHERE p.world_id=? AND p.conversation_id=? AND p.kind='character' AND p.ordinal>?
  ORDER BY p.ordinal LIMIT ?`
const profiles = members.replace('END AS name', `END AS name,
  CASE WHEN json_type(i.overrides_json,'$.aliases') IS NULL THEN json_extract(v.definition_json,'$.aliases') ELSE json_extract(i.overrides_json,'$.aliases') END AS aliases,
  CASE WHEN json_type(i.overrides_json,'$.interests') IS NULL THEN json_extract(v.definition_json,'$.interests') ELSE json_extract(i.overrides_json,'$.interests') END AS interests`)
export const chatViewQueries = [overview, members, profiles]

/** @param {Tx} tx @param {Scope} scope @param {number} after @param {number} limit */
async function readMembers(tx, scope, after, limit) {
  need(after === -1 || safeInteger(after), 'KANATA_MEMBER_CURSOR_INVALID')
  const rows = await tx.query(members, [...scopeBindings(scope), after, pageLimit(limit) + 1])
  const entries = rows.slice(0, limit).map(row => {
    const { name } = row
    if (typeof name !== 'string' || !name.trim()) throw new Error('KANATA_MEMBER_NAME_INVALID')
    return { id: String(row.id), name }
  })
  return { entries, after, cursor: rows.length > limit ? Number(rows[limit - 1].ordinal) : null }
}

/** @param {import('./kanataSchemaTypes').KanataSqlRow} row */
function fromRow(row) {
  const conversation = /** @type {ConversationSummary} */ ({
    id: String(row.id), type: row.type, title: String(row.title), mode: row.mode, revision: Number(row.revision),
    ...(row.max_speakers !== null && { replyLimits: { maxSpeakers: Number(row.max_speakers), maxMessages: Number(row.max_messages) } }),
    ...(row.reply_timing_enabled !== null && { replyTiming: { enabled: row.reply_timing_enabled === 1, waitMs: Number(row.reply_wait_ms) } }),
  })
  const world = { id: String(row.world_id), name: String(row.name), archived: row.archived === 1,
    defaultChatMode: /** @type {'daily'|'roleplay'} */ (row.default_chat_mode) }
  return { conversation, world, lastReadAt: Number(row.last_read_at) }
}
/** @param {Operation} operation */
export function createKanataChatViewRepository(operation) {
  return {
    /** @param {Scope} scope */
    load: scope => operation.transaction(async tx => {
      const [row] = await tx.query(overview, scopeBindings(scope))
      if (!row) return null
      return { ...fromRow(row), members: await readMembers(tx, scope, -1, 50) }
    }),
    /** @param {Scope} scope */
    summary: scope => operation.transaction(async tx => {
      const [row] = await tx.query(overview, scopeBindings(scope))
      return row ? fromRow(row) : null
    }),
    /** @param {Scope} scope @param {string} actor */
    hasSpeaker: (scope, actor) => operation.transaction(async tx => {
      const [worldId, conversationId] = scopeBindings(scope)
      return Boolean(await conversationAccess(tx, worldId, conversationId, actor))
    }),
    /** @param {Scope} scope @param {number} after */
    profiles: (scope, after = -1) => operation.transaction(async tx => {
      need(safeInteger(after, -1), 'KANATA_MEMBER_CURSOR_INVALID')
      const rows = await tx.query(profiles, [...scopeBindings(scope), after, 51])
      const entries = rows.slice(0, 50).map(row => {
        const name = row.name
        const aliases = /** @type {unknown} */ (JSON.parse(String(row.aliases)))
        const interests = /** @type {unknown} */ (JSON.parse(String(row.interests)))
        if (typeof name !== 'string' || !name.trim() || !Array.isArray(aliases) || !Array.isArray(interests)
          || ![...aliases, ...interests].every(value => typeof value === 'string' && value.trim())) {
          throw new Error('KANATA_MEMBER_PROFILE_INVALID')
        }
        return { id: String(row.id), name, aliases: /** @type {string[]} */ (aliases), interests: /** @type {string[]} */ (interests) }
      })
      return { entries, cursor: rows.length > 50 ? Number(rows[49].ordinal) : null }
    }),
    /** @param {Scope} scope @param {number} after @param {number} [limit] */
    members: (scope, after, limit = 50) => operation.transaction(tx => readMembers(tx, scope, after, limit)),
  }
}
