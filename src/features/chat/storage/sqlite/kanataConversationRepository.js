// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { validateGroupReplyLimits } from '../../domain/groupReplyLimits.js'
import { validateReplyTimingPolicy } from '../../domain/replyTimingPolicy.js'
import { conversationQueries as query, conversationWrites as write, messageQueries } from './kanataRepositorySql.js'
import { extensionObject, nonemptyText, pageLimit, requireSqliteValue as need, safeInteger, scopeBindings, validId } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').Conversation} Conversation */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Transaction */
/** @typedef {Omit<Conversation, 'worldId' | 'id' | 'type' | 'revision' | 'participantIds'>} Fields */

const known = ['id', 'worldId', 'type', 'title', 'participantIds', 'mode', 'revision', 'lastReadAt', 'replyLimits', 'replyTiming']
const invalid = 'KANATA_CONVERSATION_INVALID'
const conflict = 'KANATA_CONVERSATION_REVISION_CONFLICT'

/** @param {Transaction} tx @param {Scope} scope */
async function participants(tx, scope) {
  return (await tx.query(query.participants, scopeBindings(scope))).map(row => ({
    id: String(row.participant_id), kind: /** @type {'user' | 'character'} */ (row.kind),
  }))
}

/** @param {Transaction} tx @param {Row} row @returns {Promise<Conversation>} */
async function fromRow(tx, row) {
  const id = String(row.id), worldId = String(row.world_id)
  const extensions = extensionObject(row.extensions_json)
  for (const key of known) delete extensions[key]
  return {
    ...extensions, id, worldId, type: /** @type {Conversation['type']} */ (row.type),
    title: String(row.title), mode: /** @type {Conversation['mode']} */ (row.mode), revision: Number(row.revision),
    lastReadAt: Number(row.last_read_at), participantIds: (await participants(tx, { worldId, conversationId: id })).map(person => person.id),
    ...(row.max_speakers !== null && { replyLimits: { maxSpeakers: Number(row.max_speakers), maxMessages: Number(row.max_messages) } }),
    ...(row.reply_timing_enabled !== null && { replyTiming: { enabled: row.reply_timing_enabled === 1, waitMs: Number(row.reply_wait_ms) } }),
  }
}

/** @param {Fields} fields @param {Conversation['type']} type */
function fieldValues(fields, type) {
  need(nonemptyText(fields.title) && ['inherit', 'daily', 'roleplay'].includes(fields.mode) && safeInteger(fields.lastReadAt), invalid)
  if (fields.replyLimits !== undefined) {
    need(type === 'group', invalid)
    validateGroupReplyLimits(fields.replyLimits)
  }
  if (fields.replyTiming !== undefined) {
    need(type !== 'character', invalid)
    validateReplyTimingPolicy(fields.replyTiming)
  }
  return [fields.title, fields.mode, fields.lastReadAt,
    fields.replyLimits?.maxSpeakers ?? null, fields.replyLimits?.maxMessages ?? null,
    fields.replyTiming === undefined ? null : Number(fields.replyTiming.enabled), fields.replyTiming?.waitMs ?? null]
}

/** @param {Transaction} tx @param {string} worldId */
async function writableWorld(tx, worldId) {
  const [world] = await tx.query(messageQueries.world, [worldId])
  need(world && world.archived !== 1, 'KANATA_CONVERSATION_WORLD_UNAVAILABLE')
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @returns {import('./kanataRepositoryTypes').KanataConversationRepository} */
export function createKanataConversationRepository(operation) {
  const run = operation.transaction
  return {
    list: (worldId, afterId = '', limit = 50) => run(async tx => {
      validateId(worldId, 'worldId')
      if (afterId !== '') validateId(afterId, 'conversationCursor')
      const rows = await tx.query(query.list, [worldId, afterId, pageLimit(limit) + 1])
      const conversations = []
      for (const row of rows.slice(0, limit)) conversations.push(await fromRow(tx, row))
      const hasMore = rows.length > limit
      return { conversations, cursor: hasMore ? String(rows[limit - 1].id) : null, hasMore }
    }),
    get: scope => run(async tx => {
      const [row] = await tx.query(query.get, scopeBindings(scope))
      return row ? fromRow(tx, row) : null
    }),
    participants: scope => run(tx => participants(tx, scope)),
    async create(conversation) {
      const dto = cloneKanataJson(conversation)
      const { id, worldId, type, revision, participantIds } = dto
      need(validId(id) && validId(worldId) && ['private', 'group', 'character'].includes(type) && revision === 1, invalid)
      need(Array.isArray(participantIds) && participantIds.every(validId) && new Set(participantIds).size === participantIds.length, invalid)
      const [title, mode, ...fields] = fieldValues(dto, type)
      /** @type {Record<string,unknown>} */
      const extensions = { ...dto }
      for (const key of known) delete extensions[key]
      return run(async tx => {
        await writableWorld(tx, worldId)
        const kinds = []
        for (const member of participantIds) {
          const [row] = await tx.query(query.participant, [worldId, member])
          need(row && ['user', 'character'].includes(String(row.kind)), invalid)
          kinds.push(row.kind)
        }
        const users = kinds.filter(kind => kind === 'user').length
        const characters = kinds.length - users
        need(type === 'private' ? users === 1 && characters === 1 : type === 'group' ? users === 1 && characters >= 2 : users === 0 && characters >= 2, invalid)
        need((await tx.execute(write.create, [id, worldId, type, title, mode, revision, ...fields, JSON.stringify(extensions)])).affectedRows === 1, invalid)
        for (let ordinal = 0; ordinal < participantIds.length; ordinal++) {
          need((await tx.execute(write.participant, [worldId, id, participantIds[ordinal], kinds[ordinal], ordinal])).affectedRows === 1, invalid)
        }
        return dto
      })
    },
    async update(scope, expectedRevision, fields) {
      need(safeInteger(expectedRevision, 1), conflict)
      const dto = cloneKanataJson(fields)
      const bindings = scopeBindings(scope)
      return run(async tx => {
        const [previous] = await tx.query(query.get, bindings)
        need(previous?.revision === expectedRevision, conflict)
        await writableWorld(tx, scope.worldId)
        const values = fieldValues(dto, /** @type {Conversation['type']} */ (previous.type))
        need((await tx.execute(write.update, [...values, ...bindings, expectedRevision])).affectedRows === 1, conflict)
        const [updated] = await tx.query(query.get, bindings)
        return fromRow(tx, updated)
      })
    },
  }
}
