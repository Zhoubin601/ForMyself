// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { eventProvenance, visitAuthorizedEventSources } from './kanataEventRepository.js'
import { visitRows } from './kanataMessageDependents.js'
import { assertActor, conversationAccess, grantTable, requireLifeSources, sourceConversation, sourceMetadata, uniqueLifeSources, visitSourceGrants } from './kanataProvenance.js'
import { messageQueries } from './kanataRepositorySql.js'
import { pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').Memory} Memory */
/** @typedef {import('../../domain/kanataTypes').SourceRef} SourceRef */
/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */
/** @typedef {Memory & {ownerInstanceId?:string}} StoredMemory */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {{worldId:string,instanceId:string,conversationId?:string}} Context */

const memory = /** @type {ReturnType<typeof domainTable<StoredMemory>>} */ (domainTable('memories', {
  world_id: 'worldId', id: 'id', owner_type: 'ownerType', owner_id: 'ownerId', owner_instance_id: 'ownerInstanceId',
  layer: 'layer', memory_key: 'key', content: 'content', status: 'status', revision: 'revision', visibility: 'visibility',
  conversation_id: 'conversationId', confidence: 'confidence', generation_key: 'generationKey',
}, ['world_id', 'id'], ['knownBy', 'sourceRefs', 'sourceEventIds', 'lifeSources', 'sharedFromId', 'supersededById', 'conflictWith']))
const metadata = `SELECT id,owner_type,owner_id,status,visibility,conversation_id,revision FROM memories WHERE world_id=? AND id=?`
const rankFields = 'SELECT id,layer,memory_key,content FROM memories WHERE world_id=? AND id=? AND length(CAST(content AS BLOB))<=?'
const memoryPolicy = 'SELECT world_id,strategy,enabled,recent_messages,summarize_after,extract_after,context_budget,revision FROM memory_policies WHERE world_id=?'
const list = 'SELECT id FROM memories WHERE world_id=? AND id>? ORDER BY id LIMIT ?'
const promptList = `WITH scope(world,actor,after_id) AS (VALUES(?,?,?))
  SELECT m.id FROM scope JOIN memories m ON m.world_id=scope.world AND m.id>scope.after_id
  WHERE m.status='active' AND (
    (m.owner_type='character' AND m.owner_id=scope.actor)
    OR EXISTS (SELECT 1 FROM memory_known_by k WHERE k.world_id=m.world_id AND k.memory_id=m.id AND k.instance_id=scope.actor)
    OR (m.owner_type='world' AND m.visibility='public'
      AND NOT EXISTS (SELECT 1 FROM memory_known_by k WHERE k.world_id=m.world_id AND k.memory_id=m.id))
  ) ORDER BY m.id LIMIT ?`
const listOwner = `SELECT id FROM memories WHERE world_id=? AND owner_type=? AND owner_id=? AND layer=?
  AND id>? ORDER BY id LIMIT 128`
const sources = 'SELECT message_id,message_revision FROM memory_sources WHERE world_id=? AND memory_id=? AND message_id>? ORDER BY message_id LIMIT 128'
const known = 'SELECT instance_id FROM memory_known_by WHERE world_id=? AND memory_id=? AND instance_id>? ORDER BY instance_id LIMIT 128'
const events = 'SELECT event_id FROM memory_events WHERE world_id=? AND memory_id=? AND event_id>? ORDER BY event_id LIMIT 128'
const life = `SELECT grant_id,instance_id,module_id,grant_revision,fingerprint FROM memory_life_sources
  WHERE world_id=? AND memory_id=? AND (grant_id,grant_revision,fingerprint)>(?,?,?)
  ORDER BY grant_id,grant_revision,fingerprint LIMIT 128`
const links = `SELECT kind,target_memory_id FROM memory_links WHERE world_id=? AND memory_id=? AND target_memory_id>?
  ORDER BY target_memory_id LIMIT 128`
// Link kind is part of the key. Paginate by both fields even when a memory has two links to the same ID.
const linksByKind = links.replace('AND target_memory_id>?', 'AND (target_memory_id,kind)>(?,?)').replace('ORDER BY target_memory_id', 'ORDER BY target_memory_id,kind')
const sharedChain = `WITH RECURSIVE scope(world,root) AS (VALUES(?,?)), chain(id) AS (
  SELECT root FROM scope UNION SELECT l.target_memory_id FROM chain c CROSS JOIN scope
  CROSS JOIN memory_links l WHERE l.world_id=scope.world AND l.memory_id=c.id AND l.kind='shared'
)`
const chainValid = sharedChain + ` SELECT 1 AS valid FROM scope WHERE NOT EXISTS(
  SELECT 1 FROM chain c LEFT JOIN memories m ON m.world_id=scope.world AND m.id=c.id WHERE m.status IS NOT 'active'
) AND EXISTS(
  SELECT 1 FROM chain c WHERE NOT EXISTS(
    SELECT 1 FROM memory_links l WHERE l.world_id=scope.world AND l.memory_id=c.id AND l.kind='shared'
  )
)`
const chainSources = sharedChain + ` SELECT l.memory_id,l.message_id,l.message_revision FROM chain c CROSS JOIN scope CROSS JOIN memory_sources l
  WHERE l.world_id=scope.world AND l.memory_id=c.id AND (l.memory_id,l.message_id)>(?,?) ORDER BY l.memory_id,l.message_id LIMIT 50`
const chainEvents = sharedChain + ` SELECT DISTINCT l.event_id FROM chain c CROSS JOIN scope CROSS JOIN memory_events l
  WHERE l.world_id=scope.world AND l.memory_id=c.id AND l.event_id>? ORDER BY l.event_id LIMIT 50`
const chainLife = sharedChain + ` SELECT DISTINCT l.grant_id,l.grant_revision,l.fingerprint,l.instance_id,l.module_id
  FROM chain c CROSS JOIN scope CROSS JOIN memory_life_sources l
  WHERE l.world_id=scope.world AND l.memory_id=c.id AND (l.grant_id,l.grant_revision,l.fingerprint)>(?,?,?) ORDER BY l.grant_id,l.grant_revision,l.fingerprint LIMIT 50`
const rootAccess = `SELECT m.owner_type,m.owner_id,m.status,m.visibility,m.conversation_id,m.revision,
  EXISTS(SELECT 1 FROM memory_known_by k WHERE k.world_id=m.world_id AND k.memory_id=m.id AND k.instance_id=?) AS known,
  EXISTS(SELECT 1 FROM memory_known_by k WHERE k.world_id=m.world_id AND k.memory_id=m.id) AS has_readers,
  EXISTS(SELECT 1 FROM memory_links l WHERE l.world_id=m.world_id AND l.memory_id=m.id AND l.kind='shared') AS shared
  FROM memories m WHERE m.world_id=? AND m.id=?`
const sourcePageSql = `SELECT message_id,message_revision FROM memory_sources
  WHERE world_id=? AND memory_id=? AND message_id>? ORDER BY message_id LIMIT 51`
const detailBody = 'SELECT id,memory_key,content,layer,status,revision FROM memories WHERE world_id=? AND id=?'
const sourceMembership = `SELECT 1 FROM memory_sources WHERE world_id=? AND memory_id=? AND message_id=? AND message_revision=?`
const addSource = 'INSERT INTO memory_sources(world_id,memory_id,message_id,message_revision) VALUES(?,?,?,?)'
const addKnown = 'INSERT INTO memory_known_by(world_id,memory_id,instance_id) VALUES(?,?,?)'
const addEvent = 'INSERT INTO memory_events(world_id,memory_id,event_id) VALUES(?,?,?)'
const addLife = 'INSERT INTO memory_life_sources(world_id,memory_id,grant_id,instance_id,module_id,grant_revision,fingerprint) VALUES(?,?,?,?,?,?,?)'
const addLink = 'INSERT INTO memory_links(world_id,memory_id,kind,target_memory_id) VALUES(?,?,?,?)'
const clearLinks = ['memory_sources', 'memory_known_by', 'memory_events', 'memory_life_sources', 'memory_links']
  .map(table => `DELETE FROM ${table} WHERE world_id=? AND memory_id=?`)
const deleteMemory = "UPDATE memories SET status='deleted',content='（已删除的记忆内容）',revision=revision+1 WHERE world_id=? AND id=? AND revision=? AND status<>'deleted'"
const addArchive = 'INSERT INTO archived_message_marks(world_id,conversation_id,message_id) VALUES(?,?,?)'
const isArchived = 'SELECT 1 FROM archived_message_marks WHERE world_id=? AND conversation_id=? AND message_id=?'
const denial = new Set(['KANATA_MEMORY_CONTEXT_DENIED', 'KANATA_CONTEXT_SCOPE_DENIED', 'KANATA_LIFE_PERMISSION_DENIED', 'KANATA_SOURCE_STALE',
  'EVENT_CONTEXT_DENIED', 'EVENT_CAUSE_UNAVAILABLE', 'EVENT_UNAVAILABLE'])
export const memoryQueries = [detailBody, sourcePageSql, chainValid, chainSources, chainEvents, chainLife, rootAccess, sourceMembership, rankFields, memoryPolicy, memory.get, metadata, list, promptList, listOwner, sources, known, events, life, linksByKind, isArchived]
export const memoryWrites = [...memory.writeStatements, addSource, addKnown, addEvent, addLife, addLink, ...clearLinks, deleteMemory, addArchive]

/** @param {string} value */
const canonical = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** @param {Tx} tx @param {string} worldId @param {string} id */
async function memoryLinks(tx, worldId, id) {
  const keys = [worldId, id]
  const sourceRefs = [], knownBy = [], sourceEventIds = [], lifeSources = [], conflictWith = []
  /** @type {string|undefined} */
  let sharedFromId
  /** @type {string|undefined} */
  let supersededById
  for await (const row of visitRows(tx, sources, keys, ['message_id'])) sourceRefs.push({ messageId: String(row.message_id), revision: Number(row.message_revision) })
  for await (const row of visitRows(tx, known, keys, ['instance_id'])) knownBy.push(String(row.instance_id))
  for await (const row of visitRows(tx, events, keys, ['event_id'])) sourceEventIds.push(String(row.event_id))
  for await (const row of visitRows(tx, life, keys, ['grant_id', 'grant_revision', 'fingerprint'])) {
    lifeSources.push({ grantId: String(row.grant_id), instanceId: String(row.instance_id), revision: Number(row.grant_revision),
      moduleId: /** @type {LifeSource['moduleId']} */ (row.module_id), fingerprint: String(row.fingerprint) })
  }
  for await (const row of visitRows(tx, linksByKind, keys, ['target_memory_id', 'kind'])) {
    if (row.kind === 'shared') sharedFromId = String(row.target_memory_id)
    if (row.kind === 'superseded') supersededById = String(row.target_memory_id)
    if (row.kind === 'conflict') conflictWith.push(String(row.target_memory_id))
  }
  return { sourceRefs, knownBy, sourceEventIds, lifeSources, conflictWith, sharedFromId, supersededById }
}

/** @param {Tx} tx @param {string} worldId @param {string} id @returns {Promise<Memory|null>} */
async function readMemory(tx, worldId, id) {
  const dto = await memory.read(tx, [worldId, id])
  if (!dto) return null
  const { ownerInstanceId: _ownerInstanceId, ...fields } = dto
  const { sharedFromId, supersededById, ...linked } = await memoryLinks(tx, worldId, id)
  return { ...fields, ...linked, ...(sharedFromId && { sharedFromId }), ...(supersededById && { supersededById }) }
}

/** @param {Tx} tx @param {string} id @param {Context} scope @param {boolean} share @param {boolean} collect */
async function authorizeMemory(tx, id, scope, share = false, collect = true) {
  const { worldId, instanceId, conversationId } = scope
  await assertActor(tx, worldId, instanceId)
  const context = conversationId && found(await conversationAccess(tx, worldId, conversationId, instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
  const group = Boolean(context && context.group)
  const keys = [worldId, id]
  const [row] = await tx.query(rootAccess, [instanceId, ...keys])
  need(row?.status === 'active', 'KANATA_MEMORY_CONTEXT_DENIED')
  const belongs = (row.owner_type === 'character' && row.owner_id === instanceId) || row.known === 1
    || (row.owner_type === 'world' && row.visibility === 'public' && row.has_readers === 0)
  need(belongs, 'KANATA_MEMORY_CONTEXT_DENIED')
  const [valid] = await tx.query(chainValid, keys)
  need(valid, 'KANATA_MEMORY_CONTEXT_DENIED')
  const provenance = []
  /** @param {LifeSource} source */
  const authorize = async source => {
    await requireLifeSources(tx, [source], { worldId, instanceId, group, remember: true, share })
    if (collect) provenance.push(source)
  }
  let rootHasSource = false
  for await (const link of visitRows(tx, chainSources, keys, ['memory_id', 'message_id'], 50)) {
    const ref = { messageId: String(link.message_id), revision: Number(link.message_revision) }
    const source = await sourceConversation(tx, worldId, ref)
    if (link.memory_id === id) {
      rootHasSource = true
      if (row.shared === 0) need(await conversationAccess(tx, worldId, source, instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
      if (group && row.visibility !== 'public') {
        need(row.conversation_id === conversationId && source === conversationId, 'KANATA_MEMORY_CONTEXT_DENIED')
      }
    }
    for await (const tag of visitSourceGrants(tx, worldId, ref)) await authorize(tag)
  }
  need(!group || row.visibility === 'public' || rootHasSource, 'KANATA_MEMORY_CONTEXT_DENIED')
  for await (const link of visitRows(tx, chainEvents, keys, ['event_id'], 50)) {
    for await (const tag of visitAuthorizedEventSources(tx, worldId, String(link.event_id), { instanceId, group, sharedMemory: row.shared === 1 })) {
      if (share) await authorize(tag)
      else if (collect) provenance.push(tag)
    }
  }
  for await (const link of visitRows(tx, chainLife, keys, ['grant_id', 'grant_revision', 'fingerprint'], 50)) {
    await authorize({ grantId: String(link.grant_id), instanceId: String(link.instance_id), revision: Number(link.grant_revision),
      moduleId: /** @type {LifeSource['moduleId']} */ (link.module_id), fingerprint: String(link.fingerprint) })
  }
  return { row, provenance: uniqueLifeSources(provenance), group }
}
/** @param {Tx} tx @param {Memory} dto @param {number|null} expectedRevision */
async function persistMemory(tx, dto, expectedRevision) {
  const keys = [dto.worldId, dto.id]
  const next = { ...dto, ...(dto.ownerType === 'character' && { ownerInstanceId: dto.ownerId }) }
  if (expectedRevision === null) await memory.create(tx, next)
  else {
    await memory.replace(tx, next, keys, expectedRevision)
    for (const sql of clearLinks) await tx.execute(sql, keys)
  }
  for (const ref of dto.sourceRefs) await writeOne(tx, addSource, [...keys, ref.messageId, ref.revision])
  for (const actor of dto.knownBy ?? []) await writeOne(tx, addKnown, [...keys, actor])
  for (const event of dto.sourceEventIds ?? []) await writeOne(tx, addEvent, [...keys, event])
  for (const tag of dto.lifeSources ?? []) await writeOne(tx, addLife, [...keys, tag.grantId, tag.instanceId, tag.moduleId, tag.revision, tag.fingerprint])
  for (const id of dto.conflictWith ?? []) await writeOne(tx, addLink, [...keys, 'conflict', id])
  if (dto.sharedFromId) await writeOne(tx, addLink, [...keys, 'shared', dto.sharedFromId])
  if (dto.supersededById) await writeOne(tx, addLink, [...keys, 'superseded', dto.supersededById])
}

/** @param {Tx} tx @param {Memory} dto @param {number|null} expectedRevision */
export async function saveMemory(tx, dto, expectedRevision) {
  validateId(dto.id, 'memoryId')
  validateId(dto.ownerId, 'memoryOwner')
  const [previous] = await tx.query(metadata, [dto.worldId, dto.id])
  need(previous ? previous.revision === expectedRevision : expectedRevision === null, 'MEMORY_EDIT_CONFLICT')
  need(!previous || previous.owner_id === dto.ownerId && previous.owner_type === dto.ownerType, 'MEMORY_OWNER_IMMUTABLE')
  need(dto.status !== 'deleted' && previous?.status !== 'deleted', 'MEMORY_DELETED')
  need(typeof dto.key === 'string' && dto.key.trim() && dto.key.length <= 200
    && typeof dto.content === 'string' && dto.content.trim() && dto.content.length <= 4000, 'INVALID_MEMORY_CONTENT')
  const old = previous ? await memoryLinks(tx, dto.worldId, dto.id) : null
  need((old?.sharedFromId ?? undefined) === dto.sharedFromId, 'MEMORY_SHARE_IMMUTABLE')
  const provenance = [...old?.lifeSources ?? [], ...dto.lifeSources ?? []]
  for (const ref of dto.sourceRefs) {
    validateId(ref.messageId, 'source.messageId')
    need(safeInteger(ref.revision, 1), 'KANATA_SOURCE_STALE')
    provenance.push(...(await sourceMetadata(tx, dto.worldId, ref)).sources)
  }
  for (const event of dto.sourceEventIds ?? []) provenance.push(...await eventProvenance(tx, dto.worldId, event))
  dto.lifeSources = uniqueLifeSources(provenance)
  for (const source of dto.lifeSources) {
    await requireLifeSources(tx, [source], { worldId: dto.worldId, instanceId: dto.ownerType === 'character' ? dto.ownerId : source.instanceId,
      group: dto.visibility === 'public', remember: true })
  }
  const conflicts = []
  for await (const candidate of visitRows(tx, listOwner, [dto.worldId, dto.ownerType, dto.ownerId, dto.layer], ['id'])) {
    if (candidate.id === dto.id) continue
    const current = found(await readMemory(tx, dto.worldId, String(candidate.id)), 'MEMORY_UNAVAILABLE')
    if (canonical(current.key) !== canonical(dto.key)) continue
    if (current.status === 'deleted') {
      if (!previous && dto.sourceRefs.length && dto.sourceRefs.every(ref => current.sourceRefs.some(oldRef => oldRef.messageId === ref.messageId && oldRef.revision === ref.revision))) {
        return current.id
      }
      continue
    }
    const same = canonical(current.content) === canonical(dto.content)
    if (!previous && same && ['active', 'candidate'].includes(current.status) && current.sharedFromId === dto.sharedFromId) {
      current.sourceRefs = [...new Map([...current.sourceRefs, ...dto.sourceRefs].map(ref => [ref.messageId, ref])).values()]
      current.lifeSources = uniqueLifeSources([...current.lifeSources ?? [], ...dto.lifeSources])
      const revision = current.revision++
      await persistMemory(tx, current, revision)
      return current.id
    }
    if (!same) conflicts.push(current)
  }
  const next = { ...dto, revision: Number(previous?.revision ?? 0) + 1, supersededById: old?.supersededById,
    status: conflicts.length && dto.status === 'active' ? /** @type {const} */ ('candidate') : dto.status,
    conflictWith: conflicts.map(record => record.id) }
  if (next.supersededById === undefined) delete next.supersededById
  await persistMemory(tx, next, expectedRevision)
  for (const conflict of conflicts) {
    if (conflict.conflictWith?.includes(dto.id)) continue
    await writeOne(tx, addLink, [dto.worldId, conflict.id, 'conflict', dto.id])
  }
  return dto.id
}

/** @param {Operation} operation @param {()=>string} idFactory */
export function createKanataMemoryRepository(operation, idFactory) {
  return {
    /** @param {string} worldId @returns {Promise<import('../../domain/kanataTypes').MemoryPolicy|null>} */
    policy: worldId => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      const [row] = await tx.query(memoryPolicy, [worldId])
      return row ? { worldId, strategy: /** @type {import('../../domain/kanataTypes').MemoryPolicy['strategy']} */ (row.strategy),
        enabled: row.enabled === 1, recentMessages: Number(row.recent_messages), summarizeAfter: Number(row.summarize_after),
        extractAfter: Number(row.extract_after), contextBudget: Number(row.context_budget), revision: Number(row.revision) } : null
    }),
    /** @param {Context} scope @param {string} id */
    readDetailFor: (scope, id) => operation.transaction(async tx => {
      await authorizeMemory(tx, id, scope, false, false)
      const [row] = await tx.query(detailBody, [scope.worldId, id])
      need(row, 'MEMORY_UNAVAILABLE')
      return { id, key: String(row.memory_key), content: String(row.content),
        layer: String(row.layer), status: String(row.status), revision: Number(row.revision) }
    }),
    /** @param {Context} scope @param {string} id
     * @param {import('./kanataDomainTypes').KanataMemorySourceCursor} [cursor] */
    sourcePage: (scope, id, cursor) => operation.transaction(async tx => {
      const { row } = await authorizeMemory(tx, id, scope, false, false)
      const revision = Number(row.revision)
      if (cursor) {
        validateId(cursor.after, 'cursor')
        need(cursor.worldId === scope.worldId && cursor.instanceId === scope.instanceId && cursor.conversationId === scope.conversationId
          && cursor.memoryId === id && cursor.revision === revision, 'MEMORY_SOURCE_CURSOR_STALE')
      }
      const rows = await tx.query(sourcePageSql, [scope.worldId, id, cursor?.after ?? ''])
      const entries = rows.slice(0, 50).map(link => ({ messageId: String(link.message_id), revision: Number(link.message_revision) }))
      const next = rows.length > 50 ? {
        worldId: scope.worldId, instanceId: scope.instanceId, conversationId: scope.conversationId, memoryId: id,
        revision, after: entries[49].messageId,
      } : null
      return { entries, cursor: next }
    }),
    /** @param {Context} scope @param {string} id */
    readFor: (scope, id) => operation.transaction(async tx => {
      const proof = await authorizeMemory(tx, id, scope)
      const record = found(await readMemory(tx, scope.worldId, id), 'MEMORY_UNAVAILABLE')
      return { ...record, lifeSources: proof.provenance }
    }),
    /** @param {Context} scope @param {string} afterId @param {number} limit */
    listFor: (scope, afterId = '', limit = 50) => operation.transaction(async tx => {
      await assertActor(tx, scope.worldId, scope.instanceId)
      const candidates = await tx.query(list, [scope.worldId, afterId, pageLimit(limit) + 1])
      const entries = []
      for (const { id } of candidates.slice(0, limit)) {
        let proof
        try { proof = await authorizeMemory(tx, String(id), scope) }
        catch (error) {
          if (denial.has(/** @type {{code?:string}} */ (error).code ?? '')) continue
          throw error
        }
        const record = found(await readMemory(tx, scope.worldId, String(id)), 'MEMORY_UNAVAILABLE')
        entries.push({ ...record, lifeSources: proof.provenance })
      }
      return { entries, cursor: candidates.length > limit ? String(candidates[limit - 1].id) : null }
    }),
    /** @param {Context} scope @param {string} afterId @param {number} limit */
    promptCandidates: (scope, afterId = '', limit = 50) => operation.transaction(async tx => {
      await assertActor(tx, scope.worldId, scope.instanceId)
      if (afterId) validateId(afterId, 'memoryCursor')
      const candidates = await tx.query(promptList, [scope.worldId, scope.instanceId, afterId, pageLimit(limit) + 1])
      const entries = []
      for (const { id } of candidates.slice(0, limit)) {
        try { await authorizeMemory(tx, String(id), scope, false, false) }
        catch (error) {
          if (denial.has(/** @type {{code?:string}} */ (error).code ?? '')) continue
          throw error
        }
        const [row] = await tx.query(rankFields, [scope.worldId, id, 3984])
        if (row) entries.push({ id: String(row.id), layer: /** @type {Memory['layer']} */ (row.layer),
          key: String(row.memory_key), content: String(row.content) })
      }
      return { entries, cursor: candidates.length > limit ? String(candidates[limit - 1].id) : null }
    }),
    /** Protected owner view includes stale and candidate records. Role context uses listFor.
     * @param {string} worldId @param {string} afterId @param {number} limit */
    listManaged: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (afterId) validateId(afterId, 'memoryCursor')
      const rows = await tx.query(list, [worldId, afterId, pageLimit(limit) + 1])
      const entries = []
      for (const row of rows.slice(0, limit)) entries.push(found(await readMemory(tx, worldId, String(row.id)), 'MEMORY_UNAVAILABLE'))
      return { entries, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {Memory} entry @param {number|null} revision */
    save: (entry, revision) => operation.transaction(async tx => {
      const dto = cloneKanataJson(entry)
      await assertWritableWorld(tx, dto.worldId)
      const id = await executeOnce(tx, ['memory:save', dto.worldId, dto.id, String(revision)], dto, async () => {
        if (dto.status !== 'deleted') return saveMemory(tx, dto, revision)
        need(safeInteger(revision, 1), 'MEMORY_EDIT_CONFLICT')
        await writeOne(tx, deleteMemory, [dto.worldId, dto.id, revision])
        return dto.id
      })
      return found(await readMemory(tx, dto.worldId, id), 'MEMORY_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {string} id @param {number} revision */
    delete: (worldId, id, revision) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      await executeOnce(tx, ['memory:delete', worldId, id, String(revision)], revision, async () => {
        await writeOne(tx, deleteMemory, [worldId, id, revision])
        return id
      })
    }),
    /** @param {Context} scope @param {string} id @param {string} recipientId @param {string} commandId */
    share: (scope, id, recipientId, commandId) => operation.transaction(async tx => {
      const { worldId, instanceId } = scope
      await assertActor(tx, worldId, recipientId)
      const proof = await authorizeMemory(tx, id, scope, true)
      need(proof.row.owner_type === 'character' && proof.row.owner_id === instanceId && recipientId !== instanceId,
        'KANATA_MEMORY_CONTEXT_DENIED')
      await requireLifeSources(tx, proof.provenance, { worldId, instanceId: recipientId, remember: true, group: false, share: true })
      const copyId = await executeOnce(tx, ['memory:share', worldId, id, commandId], { scope, recipientId }, async () => {
        const provenance = [...proof.provenance]
        for (const source of proof.provenance) {
          const recipient = found(await grantTable.read(tx, [worldId, recipientId, source.moduleId]), 'KANATA_LIFE_PERMISSION_DENIED')
          provenance.push({ ...source, grantId: recipient.id, instanceId: recipientId, revision: recipient.revision })
        }
        const { supersededById: _supersededById, ...original } = found(await readMemory(tx, worldId, id), 'MEMORY_UNAVAILABLE')
        const copy = { ...original, id: idFactory(), ownerId: recipientId, knownBy: [recipientId], sharedFromId: id,
          lifeSources: uniqueLifeSources(provenance), visibility: /** @type {const} */ ('private'), revision: 1, conflictWith: [] }
        await persistMemory(tx, copy, null)
        return copy.id
      })
      return found(await readMemory(tx, worldId, copyId), 'MEMORY_UNAVAILABLE')
    }),
    /** @param {Context} scope @param {string} id @param {SourceRef} ref */
    resolveSource: (scope, id, ref) => operation.transaction(async tx => {
      const proof = await authorizeMemory(tx, id, scope, false, false)
      need(proof.row.shared === 0, 'KANATA_MEMORY_CONTEXT_DENIED')
      const [linked] = await tx.query(sourceMembership, [scope.worldId, id, ref.messageId, ref.revision])
      need(linked, 'KANATA_SOURCE_STALE')
      const conversationId = await sourceConversation(tx, scope.worldId, ref)
      const access = found(await conversationAccess(tx, scope.worldId, conversationId, scope.instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
      for await (const tag of visitSourceGrants(tx, scope.worldId, ref)) {
        await requireLifeSources(tx, [tag], { ...scope, group: access.group || proof.group })
      }
      const [row] = await tx.query(messageQueries.quote, [scope.worldId, conversationId, ref.messageId])
      need(row?.revision === ref.revision, 'KANATA_SOURCE_STALE')
      const archived = (await tx.query(isArchived, [scope.worldId, conversationId, ref.messageId])).length > 0
      return { messageId: ref.messageId, revision: ref.revision, conversationId, content: String(row.content), archived }
    }),
    /** Historical source marker. The row remains addressable by primary key.
     * @param {string} worldId @param {SourceRef} ref */
    archiveSource: (worldId, ref) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const conversationId = await sourceConversation(tx, worldId, ref)
      const keys = [worldId, conversationId, ref.messageId]
      if (!(await tx.query(isArchived, keys)).length) await writeOne(tx, addArchive, keys)
    }),
  }
}
