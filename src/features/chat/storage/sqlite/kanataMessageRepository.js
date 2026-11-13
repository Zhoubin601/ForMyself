// @ts-check
import { normalizeArchiveQuery } from '../messageArchiveCore.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { conversationQueries, messageQueries as query, messageWrites as write } from './kanataRepositorySql.js'
import { equalDto, nonemptyText, pageLimit, requireSqliteValue as need, safeInteger, scopeBindings, validId } from './kanataRepositoryValues.js'
import { createKanataHistoryArchive } from './kanataHistoryArchive.js'
import { reviseMessageDependents } from './kanataMessageDependents.js'
import { assertTranscriptHints, withReplyProvenance } from './kanataReplyProvenance.js'
import { assertMessageSnapshot, auditMessageChange, prepareMessageAudit, equalStoredMessage } from './kanataMessageSnapshot.js'
import { createMessageDetailRead } from './kanataMessageDetailRead.js'

/** @typedef {import('../../domain/kanataTypes').Message} Message */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageCursor} Cursor */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Transaction */
/** @typedef {{ id: () => string, clock: () => number }} Tools */

const deletedContent = '（已删除的原始记录）'
const revisionConflict = 'KANATA_MESSAGE_REVISION_CONFLICT'
const messageFields = [
  'id', 'worldId', 'conversationId', 'role', 'senderType', 'senderId', 'senderNameSnapshot', 'content',
  'createdAt', 'revision', 'status', 'turnId', 'batchId', 'deleted', 'replyToMessageId', 'replyToRevision',
]
const modules = ['home', 'mood', 'weight', 'savings', 'schedule', 'todo', 'reports']
/** @param {NonNullable<Message['lifeSources']>[number]} source */
const lifeLinkKey = source => JSON.stringify([source.grantId, source.instanceId, source.moduleId, source.revision, source.fingerprint])

/** @param {Message} message */
function validateMessage(message) {
  const code = 'KANATA_MESSAGE_INVALID'
  need(message && ['id', 'worldId', 'conversationId', 'senderId', 'turnId', 'batchId'].every(key =>
    validId(message[/** @type {keyof Message} */ (key)])), code)
  need((message.senderType === 'user' && message.role === 'user')
    || (message.senderType === 'character' && message.role === 'assistant'), code)
  need(nonemptyText(message.content) && nonemptyText(message.senderNameSnapshot)
    && safeInteger(message.createdAt) && safeInteger(message.revision, 1)
    && ['complete', 'stopped'].includes(message.status), code)
  if (message.deleted !== undefined) need(typeof message.deleted === 'boolean', code)
  if (message.replyToMessageId !== undefined) need(validId(message.replyToMessageId) && message.replyToMessageId !== message.id, code)
  if (message.replyToRevision !== undefined) need(message.replyToMessageId && safeInteger(message.replyToRevision, 1), code)
  if (message.lifeSources !== undefined) {
    need(Array.isArray(message.lifeSources), code)
    const seen = new Set()
    for (const source of message.lifeSources) {
      need(source && validId(source.grantId) && validId(source.instanceId) && modules.includes(source.moduleId)
        && safeInteger(source.revision, 1) && /^[a-f0-9]{64}$/.test(source.fingerprint), code)
      const encoded = JSON.stringify(source)
      need(!seen.has(encoded), code)
      seen.add(encoded)
    }
  }
}

/** @param {Row} row @returns {import('./kanataRepositoryTypes').KanataTranscriptMessage} */
function transcriptFromRow(row) {
  const message = {
    id: String(row.id), worldId: String(row.world_id), conversationId: String(row.conversation_id),
    role: /** @type {Message['role']} */ (row.role), senderType: /** @type {Message['senderType']} */ (row.sender_type),
    senderId: String(row.sender_id), senderNameSnapshot: String(row.sender_name_snapshot), content: String(row.content),
    createdAt: Number(row.created_at), revision: Number(row.revision), status: /** @type {Message['status']} */ (row.status),
    turnId: String(row.turn_id), batchId: String(row.batch_id),
    ...(row.deleted !== null && { deleted: row.deleted === 1 }),
    ...(row.reply_to_message_id !== null && { replyToMessageId: String(row.reply_to_message_id) }),
    ...(row.reply_to_revision !== null && { replyToRevision: Number(row.reply_to_revision) }),
  }
  validateMessage(message)
  return message
}

/** @param {Row} row @returns {import('./kanataRepositoryTypes').KanataMessageState} */
function messageState(row) {
  return { id: String(row.id), revision: Number(row.revision), createdAt: Number(row.created_at),
    status: /** @type {Message['status']} */ (row.status), deleted: row.deleted === 1, senderId: String(row.sender_id) }
}

/** @param {Transaction} tx @param {string} sql @param {string[]} bindings @param {readonly string[]} ids */
async function readContextRows(tx, sql, bindings, ids) {
  const unique = [...new Set(ids)]
  for (const id of unique) validateId(id, 'contextId')
  const rows = []
  for (let start = 0; start < unique.length; start += 128) {
    rows.push(...await tx.query(sql, [...bindings, JSON.stringify(unique.slice(start, start + 128))]))
  }
  return rows
}

/** @param {Transaction} tx @param {Scope} scope @param {string} id */
async function readMessage(tx, scope, id) {
  validateId(id, 'messageId')
  const [row] = await tx.query(query.getTranscript, [...scopeBindings(scope), id])
  return row ? transcriptFromRow(row) : null
}

/** @param {Transaction} tx @param {Message} message @param {'reply-base'} [projection] */
async function insertMessage(tx, message, projection) {
  const [prior] = await tx.query(query.state,[...scopeBindings(message),message.id])
  if (prior) {
    await assertMessageSnapshot(tx,{...message,revision:Number(prior.revision)})
    need(await equalStoredMessage(tx,message,Number(prior.revision),projection==='reply-base'), 'KANATA_MESSAGE_ID_CONFLICT')
    return /** @type {const} */ ('existing')
  }
  need((await tx.query(query.identity, [message.id])).length === 0, 'KANATA_MESSAGE_ID_CONFLICT')
  const [world] = await tx.query(query.world, [message.worldId])
  need(world && world.archived !== 1, 'KANATA_MESSAGE_WORLD_UNAVAILABLE')
  /** @type {Record<string, unknown>} */
  const extensions = { ...message }
  for (const field of messageFields) delete extensions[field]
  const result = await tx.execute(write.insert, [
    message.id, message.worldId, message.conversationId, message.role, message.senderType, message.senderId,
    message.senderNameSnapshot, message.content, message.createdAt, message.revision, message.status, message.turnId, message.batchId,
    message.deleted === undefined ? null : Number(message.deleted), message.replyToMessageId ?? null,
    message.replyToRevision ?? null, JSON.stringify(extensions),
  ])
  need(result.affectedRows === 1, 'KANATA_MESSAGE_INSERT_FAILED')
  const links = new Map((message.lifeSources ?? []).map(source => [lifeLinkKey(source), source]))
  for (const source of links.values()) {
    const link = await tx.execute(write.lifeSource, [
      message.worldId, message.id, source.grantId, source.instanceId, source.moduleId, source.revision, source.fingerprint,
    ])
    need(link.affectedRows === 1, 'KANATA_MESSAGE_INSERT_FAILED')
  }
  return /** @type {const} */ ('inserted')
}

/** @param {Scope} scope @param {Cursor} cursor */
function cursorBindings(scope, cursor) {
  need(cursor && cursor.version === 1 && cursor.worldId === scope.worldId && cursor.conversationId === scope.conversationId
    && safeInteger(cursor.createdAt) && validId(cursor.id), 'KANATA_MESSAGE_CURSOR_INVALID')
  return [cursor.createdAt, cursor.id]
}

/** @param {readonly Row[]} rows @param {number} limit */
function page(rows, limit) {
  const messages = rows.slice(0, limit).map(transcriptFromRow)
  const last = messages.at(-1)
  const hasMore = rows.length > limit
  return {
    messages, hasMore, cursor: last && hasMore ? {
      version: /** @type {const} */ (1), worldId: last.worldId, conversationId: last.conversationId,
      id: last.id, createdAt: last.createdAt,
    } : null,
  }
}

/** @param {Transaction} tx @param {Scope} scope @param {string} id @param {number} expectedRevision */
async function readForUpdate(tx, scope, id, expectedRevision) {
  need(safeInteger(expectedRevision, 1), revisionConflict)
  validateId(id, 'messageId')
  const [row] = await tx.query(query.state, [...scopeBindings(scope),id])
  const previous = row ? { ...scope, ...messageState(row) } : null
  if (!previous || previous.revision !== expectedRevision) throw new Error(revisionConflict)
  const [world] = await tx.query(query.world, [previous.worldId])
  need(world && world.archived !== 1, 'KANATA_MESSAGE_WORLD_UNAVAILABLE')
  await assertMessageSnapshot(tx,previous)
  await prepareMessageAudit(tx)
  return previous
}

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @param {Tools} tools @returns {import('./kanataRepositoryTypes').KanataMessageRepository} */
export function createKanataMessageRepository(operation, tools) {
  const run = operation.transaction
  return {
    ...createKanataHistoryArchive(operation),
    ...createMessageDetailRead(operation),
    async insert(message) {
      const dto = cloneKanataJson(message)
      validateMessage(dto)
      return run(tx => insertMessage(tx, dto))
    },
    async insertBatch(messages) {
      need(Array.isArray(messages) && messages.length > 0 && messages.length <= 256, 'KANATA_MESSAGE_BATCH_INVALID')
      const batch = cloneKanataJson(messages)
      batch.forEach(validateMessage)
      return run(async tx => {
        /** @type {('inserted' | 'existing')[]} */
        const results = []
        for (const message of batch) results.push(await insertMessage(tx, message))
        return results
      })
    },
    recent: (scope, limit = 50) => run(async tx => page(await tx.query(query.recentTranscript, [
      ...scopeBindings(scope), pageLimit(limit) + 1,
    ]), limit)),
    older: (scope, cursor, limit = 50) => run(async tx => page(await tx.query(query.olderTranscript, [
      ...scopeBindings(scope), ...cursorBindings(scope, cursor), pageLimit(limit) + 1,
    ]), limit)),
    searchHistory: (scope, text, cursor) => run(async tx => {
      need(typeof text === 'string' && text.length <= 200, 'KANATA_HISTORY_QUERY_INVALID')
      const normalized = normalizeArchiveQuery(text)
      const keys = scopeBindings(scope)
      if (cursor) need(cursor.query === normalized, 'KANATA_MESSAGE_CURSOR_INVALID')
      let before = cursor
      const messages = []
      // The legacy search also uses a 32-page budget. A continuation points to
      // the last actually inspected row, including when there were no matches.
      for (let batch = 0; batch < 32; batch++) {
        const rows = before
          ? await tx.query(query.olderHistory, [...keys, ...cursorBindings(scope, before), 51])
          : await tx.query(query.history, [...keys, 51])
        for (const [index, row] of rows.slice(0, 50).entries()) {
          const id = String(row.id), createdAt = Number(row.created_at), content = String(row.content)
          before = { version: 1, worldId: scope.worldId, conversationId: scope.conversationId, id, createdAt, query: normalized }
          if (!normalizeArchiveQuery(content).includes(normalized)) continue
          messages.push({ id, createdAt, content, revision: Number(row.revision), senderNameSnapshot: String(row.sender_name_snapshot) })
          if (messages.length === 50) return { messages, cursor: index + 1 < rows.length ? before : null }
        }
        if (rows.length <= 50) return { messages, cursor: null }
      }
      return { messages, cursor: before ?? null }
    }),
    locate: (scope, id, limit = 50) => run(async tx => {
      pageLimit(limit)
      validateId(id, 'messageId')
      const keys = scopeBindings(scope)
      const [anchor] = await tx.query(query.transcriptAnchor, [...keys, id])
      if (!anchor) return null
      return page(await tx.query(query.startingAtTranscript, [...keys, anchor.created_at, anchor.id, limit + 1]), limit)
    }),
    get: (scope, id) => run(tx => readMessage(tx, scope, id)),
    state: (scope, id) => run(async tx => {
      validateId(id, 'messageId')
      const [row] = await tx.query(query.state, [...scopeBindings(scope), id])
      return row ? messageState(row) : null
    }),
    latestState: (scope, role) => run(async tx => {
      const keys = scopeBindings(scope)
      const [row] = role === undefined ? await tx.query(query.newestState, keys)
        : await tx.query(query.latestState, [...keys, role])
      return row ? messageState(row) : null
    }),
    quote: (scope, id) => run(async tx => {
      validateId(id, 'messageId')
      const [row] = await tx.query(query.quote, [...scopeBindings(scope), id])
      return row ? { id: String(row.id), revision: Number(row.revision), senderNameSnapshot: String(row.sender_name_snapshot), content: String(row.content) } : null
    }),
    count: scope => run(async tx => Number((await tx.query(query.count, scopeBindings(scope)))[0].count)),
    latest: (scope, role) => run(async tx => {
      need(role === 'user' || role === 'assistant', 'KANATA_MESSAGE_INVALID')
      const [row] = await tx.query(query.latestTranscript, [...scopeBindings(scope), role])
      return row ? transcriptFromRow(row) : null
    }),
    completedReplies: (scope, id) => run(async tx => {
      validateId(id, 'messageId')
      const rows = await tx.query(query.completedReplies, [...scopeBindings(scope), id, 32])
      return rows.map(row => ({ id: String(row.id), revision: Number(row.revision), senderId: String(row.sender_id) }))
    }),
    historyForSpeaker: (scope, speaker, limit) => run(async tx => {
      validateId(speaker, 'speakerId')
      const rows = await tx.query(query.transcriptForSpeaker,
        [...scopeBindings(scope), speaker, pageLimit(limit)])
      const messages = rows.map(transcriptFromRow)
      await assertTranscriptHints(tx, scope, messages.map(({ id, revision }) => ({ id, revision })))
      return messages
    }),
    contextState: (scope, speaker, ids) => run(async tx => {
      validateId(speaker, 'speakerId')
      const bindings = scopeBindings(scope)
      const [row] = await tx.query(query.speakerState, [bindings[0], speaker])
      const [conversation] = await tx.query(conversationQueries.get, bindings)
      const members = await tx.query(conversationQueries.participants, bindings)
      need(row && conversation && members.some(member => member.participant_id === speaker && member.kind === 'character'),
        'KANATA_MESSAGE_REPLY_STALE')
      const events = await readContextRows(tx, query.eventState, [bindings[0]], ids.events)
      const memories = await readContextRows(tx, query.memoryState, [bindings[0]], ids.memories)
      const relationships = await readContextRows(tx, query.relationshipState, [bindings[0], speaker], ids.relationships)
      return {
        speaker: { revision: Number(row.revision), state: {
          mood: String(row.mood), energy: Number(row.energy), location: String(row.location),
        } },
        events: events.map(item => ({
          id: String(item.id), revision: Number(item.revision),
          status: /** @type {import('../../domain/kanataTypes').WorldEvent['status']} */ (item.status),
        })),
        memories: memories.map(item => ({
          id: String(item.id), revision: Number(item.revision),
          status: /** @type {import('../../domain/kanataTypes').Memory['status']} */ (item.status),
        })),
        relationships: relationships.map(item => ({
          id: String(item.id), revision: Number(item.revision),
          dimensions: { trust: Number(item.trust), intimacy: Number(item.intimacy), understanding: Number(item.understanding) },
        })),
      }
    }),
    replies: (scope, id, cursor, limit = 50) => run(async tx => {
      validateId(id, 'messageId')
      return page(await tx.query(cursor ? query.olderReplies : query.replies, [
        ...scopeBindings(scope), id, ...(cursor ? cursorBindings(scope, cursor) : []), pageLimit(limit) + 1,
      ]), limit)
    }),
    async insertReplyBatch(scope, expected, messages, provenance) {
      const binding = scopeBindings(scope)
      const owner = cloneKanataJson(expected)
      const batch = cloneKanataJson(messages)
      if (provenance) {
        need(provenance.history.length <= pageLimit(provenance.recentMessages) && provenance.events.length <= 12
          && provenance.life.length <= modules.length && provenance.memories.length <= 250, 'KANATA_MESSAGE_BATCH_INVALID')
      }
      const proof = provenance && cloneKanataJson(provenance)
      const code = 'KANATA_MESSAGE_REPLY_STALE'
      need(validId(owner.sourceId) && validId(owner.speakerId) && safeInteger(owner.sourceRevision, 1)
        && safeInteger(owner.speakerRevision, 1) && safeInteger(owner.conversationRevision, 1), code)
      need(Array.isArray(batch) && batch.length > 0 && batch.length <= 4, 'KANATA_MESSAGE_BATCH_INVALID')
      batch.forEach(message => {
        validateMessage(message)
        need(message.worldId === binding[0] && message.conversationId === binding[1] && message.senderType === 'character'
          && message.senderId === owner.speakerId && message.replyToMessageId === owner.sourceId
          && message.replyToRevision === owner.sourceRevision && message.status === 'complete', code)
      })
      await run(async tx => {
        const [source] = await tx.query(query.latestState, [...binding, 'user'])
        const [conversation] = await tx.query(conversationQueries.get, binding)
        const [speaker] = await tx.query(query.speakerRevision, [binding[0], owner.speakerId])
        need(source?.id === owner.sourceId && source.revision === owner.sourceRevision && source.deleted !== 1
          && source.status === 'complete' && conversation?.type !== 'character'
          && conversation?.revision === owner.conversationRevision && speaker?.revision === owner.speakerRevision, code)
        if (!proof) {
          for (const message of batch) await insertMessage(tx, message)
          return
        }
        need(batch.every(message => message.lifeSources === undefined), 'KANATA_MESSAGE_BATCH_INVALID')
        const rows = await tx.query(query.transcriptForAppend, [
          ...binding, owner.speakerId, JSON.stringify(batch.map(message => message.id)), proof.recentMessages,
        ])
        const history = [...rows].reverse().map(row => ({ id: row.id, revision: row.revision }))
        need(equalDto(history, proof.history), code)
        await assertTranscriptHints(tx, scope, proof.history)
        await withReplyProvenance(tx, { ...scope, instanceId: owner.speakerId, group: conversation.type === 'group' }, proof,
          async persist => {
            for (const message of batch) {
              const result = await insertMessage(tx, message, 'reply-base')
              await persist(message.id, result === 'existing')
            }
          })
      })
    },
    setStatus: (scope, id, expectedRevision, status) => run(async tx => {
      need(['complete', 'stopped'].includes(status), 'KANATA_MESSAGE_INVALID')
      const previous = await readForUpdate(tx, scope, id, expectedRevision)
      await auditMessageChange(tx,previous,{status},tools,async()=>{
        const result = await tx.execute(write.status, [status, previous.worldId, previous.conversationId, id, expectedRevision])
        need(result.affectedRows === 1, revisionConflict)
      })
      return { id, revision: expectedRevision + 1 }
    }),
    revise: (scope, id, expectedRevision, { content, deleted }) => run(async tx => {
      need(typeof deleted === 'boolean' && typeof content === 'string' && content.length <= 64000
        && (deleted || nonemptyText(content)), 'KANATA_MESSAGE_INVALID')
      const previous = await readForUpdate(tx, scope, id, expectedRevision)
      const change = { content: deleted ? deletedContent : content, deleted }
      await reviseMessageDependents(tx, previous, tools, async () => {
        await auditMessageChange(tx,previous,change,tools,async()=>{
          const result = await tx.execute(write.revise, [change.content, Number(deleted), previous.worldId, previous.conversationId, id, expectedRevision])
          need(result.affectedRows === 1, revisionConflict)
          if (deleted) await tx.execute(write.redact, [previous.worldId, id])
        })
      })
      return { id, revision: expectedRevision + 1 }
    }),
  }
}
