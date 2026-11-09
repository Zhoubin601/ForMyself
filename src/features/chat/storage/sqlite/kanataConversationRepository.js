// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { validateGroupReplyLimits } from '../../domain/groupReplyLimits.js'
import { validateReplyTimingPolicy } from '../../domain/replyTimingPolicy.js'
import { readWorld } from './kanataWorldRepository.js'
import { executeOnce, found } from './kanataDomainRows.js'
import { deferredReplyWrites } from './kanataDeferredReplySql.js'
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

/** @param {Transaction} tx @param {Scope} scope @param {number} expectedRevision
 * @param {Fields} fields @param {Conversation['type']} type */
async function writeFields(tx, scope, expectedRevision, fields, type) {
  await writableWorld(tx, scope.worldId)
  const values = fieldValues(fields, type)
  need((await tx.execute(write.update, [...values, ...scopeBindings(scope), expectedRevision])).affectedRows === 1, conflict)
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
    createGroup(worldId, fields, options) {
      const input = cloneKanataJson(fields)
      need(nonemptyText(input.title) && input.title.length <= 200, 'INVALID_GROUP_TITLE')
      need(Array.isArray(input.instanceIds) && input.instanceIds.length >= 2 && new Set(input.instanceIds).size === input.instanceIds.length,
        'INVALID_GROUP_PARTICIPANTS')
      validateId(options.id, 'groupId')
      validateId(options.commandId, 'commandId')
      return run(async tx => {
        const current = found(await readWorld(tx, worldId), 'KANATA_CONVERSATION_WORLD_UNAVAILABLE')
        need(!current.world.archived, 'KANATA_CONVERSATION_WORLD_UNAVAILABLE')
        const id = await executeOnce(tx, ['group:create', worldId, options.commandId], input, async () => {
          const unit = createKanataConversationRepository({ transaction: work => work(tx), health: operation.health })
          const saved = await unit.create({ worldId, id: options.id, title: input.title.trim(), type:'group',
            participantIds: [current.identity.id, ...input.instanceIds], mode:'inherit', revision:1, lastReadAt:0 })
          return saved.id
        })
        return { id }
      })
    },
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
    updateChatSettings(scope, expectedRevision, changes, now) {
      need(safeInteger(now), invalid)
      const dto = cloneKanataJson(changes)
      const bindings = scopeBindings(scope)
      return run(async tx => {
        const [previous] = await tx.query(query.get, bindings)
        need(previous && previous.type !== 'character', 'CONVERSATION_UNAVAILABLE')
        const revision = Number(previous.revision)
        need(expectedRevision === undefined || expectedRevision === revision, conflict)
        const current = {
          title: String(previous.title), lastReadAt: Number(previous.last_read_at),
          mode: /** @type {Conversation['mode']} */ (previous.mode),
          ...(previous.max_speakers !== null && { replyLimits: { maxSpeakers: Number(previous.max_speakers), maxMessages: Number(previous.max_messages) } }),
          ...(previous.reply_timing_enabled !== null && { replyTiming: { enabled: previous.reply_timing_enabled === 1, waitMs: Number(previous.reply_wait_ms) } }),
        }
        const { mode = current.mode, replyLimits = current.replyLimits, replyTiming = current.replyTiming } = dto
        await writeFields(tx, scope, revision, { ...current, mode, replyLimits, replyTiming }, /** @type {Conversation['type']} */ (previous.type))
        if (dto.replyTiming?.enabled === false) await tx.execute(deferredReplyWrites.accelerate, [now, ...bindings])
      })
    },
    async update(scope, expectedRevision, fields) {
      need(safeInteger(expectedRevision, 1), conflict)
      const dto = cloneKanataJson(fields)
      const bindings = scopeBindings(scope)
      return run(async tx => {
        const [previous] = await tx.query(query.get, bindings)
        need(previous?.revision === expectedRevision, conflict)
        await writeFields(tx, scope, expectedRevision, dto, /** @type {Conversation['type']} */ (previous.type))
        const [updated] = await tx.query(query.get, bindings)
        return fromRow(tx, updated)
      })
    },
  }
}
