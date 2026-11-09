// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { domainTable, writeOne } from './kanataDomainRows.js'
import { equalDto, pageLimit, requireSqliteValue as need, safeInteger, scopeBindings, validId } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').KanataUsageEvent} Usage */
/** @typedef {Omit<Usage,'usage'> & Partial<NonNullable<Usage['usage']>>} Stored */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */

const usage = /** @type {ReturnType<typeof domainTable<Stored>>} */ (domainTable('usage_events', {
  world_id: 'worldId', id: 'id', conversation_id: 'conversationId', instance_id: 'instanceId', turn_id: 'turnId', model: 'model',
  official_provider: 'officialProvider:flag', started_at: 'startedAt', finished_at: 'finishedAt', transport: 'transport', status: 'status',
  error_code: 'errorCode', finish_reason: 'finishReason', estimated_input_tokens: 'estimatedInputTokens', estimated_output_tokens: 'estimatedOutputTokens',
  prompt_tokens: 'promptTokens', completion_tokens: 'completionTokens', cache_hit_tokens: 'cacheHitTokens', purpose: 'purpose',
}, ['world_id', 'id']))
const list = `SELECT ${usage.stored} FROM usage_events WHERE world_id=? AND instance_id=? AND (started_at,id)>(?,?)
  ORDER BY started_at,id LIMIT ?`
const conversationCount = 'SELECT count(*) AS count FROM usage_events WHERE world_id=? AND conversation_id=?'
const conversationList = `SELECT ${usage.stored} FROM usage_events WHERE world_id=? AND conversation_id=? AND (started_at,id)>(?,?)
  ORDER BY started_at,id LIMIT ?`
const finalize = `UPDATE usage_events SET finished_at=?,status=?,error_code=?,finish_reason=?,estimated_input_tokens=?,
  estimated_output_tokens=?,prompt_tokens=?,completion_tokens=?,cache_hit_tokens=? WHERE world_id=? AND id=? AND status='pending'`
export const usageQueries = [usage.get, list, conversationCount, conversationList]
export const usageWrites = [...usage.writeStatements, finalize]

/** @param {Stored} dto @returns {Usage} */
function unpack({ promptTokens, completionTokens, cacheHitTokens, ...fields }) {
  return { ...fields, finishedAt: fields.finishedAt ?? null,
    usage: promptTokens === undefined || completionTokens === undefined ? null : { promptTokens, completionTokens, cacheHitTokens: cacheHitTokens ?? null } }
}

/** @param {Operation} operation */
export function createKanataUsageRepository(operation) {
  return {
    /** @param {import('./kanataRepositoryTypes').KanataMessageScope} scope
     * @param {{startedAt:number,id:string}} cursor @param {number} limit */
    forConversation: (scope, cursor = { startedAt: -1, id: '' }, limit = 50) => operation.transaction(async tx => {
      need((cursor.startedAt === -1 && cursor.id === '') || (safeInteger(cursor.startedAt) && validId(cursor.id)), 'KANATA_USAGE_CURSOR_INVALID')
      const keys = scopeBindings(scope)
      const [count] = await tx.query(conversationCount, keys)
      const rows = await tx.query(conversationList, [...keys, cursor.startedAt, cursor.id, pageLimit(limit) + 1])
      const last = rows[limit - 1]
      return { count: Number(count.count), attempts: rows.slice(0, limit).map(row => unpack(usage.decode(row))),
        cursor: rows.length > limit ? { startedAt: Number(last.started_at), id: String(last.id) } : null }
    }),
    /** @param {Usage} event */
    record: event => operation.transaction(async tx => {
      const dto = cloneKanataJson(event)
      await assertWritableWorld(tx, dto.worldId)
      need(typeof dto.model === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(dto.model), 'INVALID_MODEL')
      const previous = await usage.read(tx, [dto.worldId, dto.id])
      const { usage: tokens, ...fields } = dto
      if (!previous) await usage.create(tx, { ...fields, ...tokens })
      else {
        const old = unpack(previous)
        if (equalDto(dto, old)) return old
        need(old.conversationId === dto.conversationId && old.instanceId === dto.instanceId && old.turnId === dto.turnId
          && old.model === dto.model && old.startedAt === dto.startedAt && old.transport === dto.transport
          && old.officialProvider === dto.officialProvider && old.purpose === dto.purpose, 'USAGE_SCOPE_DENIED')
        need(old.status === 'pending' && dto.status !== 'pending', 'USAGE_ALREADY_FINAL')
        await writeOne(tx, finalize, [dto.finishedAt, dto.status, dto.errorCode, dto.finishReason, dto.estimatedInputTokens,
          dto.estimatedOutputTokens, tokens?.promptTokens ?? null, tokens?.completionTokens ?? null, tokens?.cacheHitTokens ?? null, dto.worldId, dto.id])
      }
      return dto
    }),
    /** @param {string} worldId @param {string} actor @param {{startedAt:number,id:string}} cursor @param {number} limit */
    list: (worldId, actor, cursor = { startedAt: -1, id: '' }, limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(actor, 'instanceId')
      const rows = await tx.query(list, [worldId, actor, cursor.startedAt, cursor.id, pageLimit(limit) + 1])
      const last = rows[limit - 1]
      return { attempts: rows.slice(0, limit).map(row => unpack(usage.decode(row))),
        cursor: rows.length > limit ? { startedAt: Number(last.started_at), id: String(last.id) } : null }
    }),
  }
}
