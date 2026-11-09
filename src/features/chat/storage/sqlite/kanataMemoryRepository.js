// @ts-check
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { authorizeEvent, eventProvenance } from './kanataEventRepository.js'
import { visitRows } from './kanataMessageDependents.js'
import { assertActor, conversationAccess, grantTable, requireLifeSources, sourceMetadata, uniqueLifeSources } from './kanataProvenance.js'
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
const list = 'SELECT id FROM memories WHERE world_id=? AND id>? ORDER BY id LIMIT ?'
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
export const memoryQueries = [memory.get, metadata, list, listOwner, sources, known, events, life, linksByKind, isArchived]
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

/** @param {Tx} tx @param {string} id @param {Context} scope @param {boolean} share */
async function authorizeMemory(tx, id, scope, share = false) {
  const { worldId, instanceId, conversationId } = scope
  await assertActor(tx, worldId, instanceId)
  const context = conversationId && found(await conversationAccess(tx, worldId, conversationId, instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
  const group = Boolean(context && context.group)
  const [row] = await tx.query(metadata, [worldId, id])
  need(row?.status === 'active', 'KANATA_MEMORY_CONTEXT_DENIED')
  const root = await memoryLinks(tx, worldId, id)
  const belongs = (row.owner_type === 'character' && row.owner_id === instanceId) || root.knownBy.includes(instanceId)
    || (row.owner_type === 'world' && row.visibility === 'public' && !root.knownBy.length)
  need(belongs, 'KANATA_MEMORY_CONTEXT_DENIED')
  const seen = new Set([id])
  const grants = []
  let current = root
  for (;;) {
    grants.push(...current.lifeSources)
    for (const ref of current.sourceRefs) {
      const source = await sourceMetadata(tx, worldId, ref)
      grants.push(...source.sources)
      if (current === root && !root.sharedFromId) {
        need(await conversationAccess(tx, worldId, source.conversationId, instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
      }
      if (current === root && group && row.visibility !== 'public') {
        need(row.conversation_id === conversationId && source.conversationId === conversationId, 'KANATA_MEMORY_CONTEXT_DENIED')
      }
    }
    for (const event of current.sourceEventIds) {
      grants.push(...await authorizeEvent(tx, worldId, event, { instanceId, group, sharedMemory: Boolean(root.sharedFromId) }))
    }
    if (!current.sharedFromId) break
    need(!seen.has(current.sharedFromId), 'KANATA_SQLITE_INTEGRITY_FAILED')
    seen.add(current.sharedFromId)
    const [parent] = await tx.query(metadata, [worldId, current.sharedFromId])
    need(parent?.status === 'active', 'KANATA_MEMORY_CONTEXT_DENIED')
    current = await memoryLinks(tx, worldId, current.sharedFromId)
  }
  need(!group || row.visibility === 'public' || root.sourceRefs.length, 'KANATA_MEMORY_CONTEXT_DENIED')
  const provenance = uniqueLifeSources(grants)
  await requireLifeSources(tx, provenance, { worldId, instanceId, group, remember: true, share })
  return { row, root, provenance, group }
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
      const proof = await authorizeMemory(tx, id, scope)
      need(!proof.root.sharedFromId, 'KANATA_MEMORY_CONTEXT_DENIED')
      need(proof.root.sourceRefs.some(source => source.messageId === ref.messageId && source.revision === ref.revision), 'KANATA_SOURCE_STALE')
      const source = await sourceMetadata(tx, scope.worldId, ref)
      const access = found(await conversationAccess(tx, scope.worldId, source.conversationId, scope.instanceId), 'KANATA_MEMORY_CONTEXT_DENIED')
      await requireLifeSources(tx, source.sources, { ...scope, group: access.group || proof.group })
      const [row] = await tx.query(messageQueries.quote, [scope.worldId, source.conversationId, ref.messageId])
      need(row?.revision === ref.revision, 'KANATA_SOURCE_STALE')
      const archived = (await tx.query(isArchived, [scope.worldId, source.conversationId, ref.messageId])).length > 0
      return { messageId: ref.messageId, revision: ref.revision, conversationId: source.conversationId, content: String(row.content), archived }
    }),
    /** Historical source marker. The row remains addressable by primary key.
     * @param {string} worldId @param {SourceRef} ref */
    archiveSource: (worldId, ref) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const source = await sourceMetadata(tx, worldId, ref)
      const keys = [worldId, source.conversationId, ref.messageId]
      if (!(await tx.query(isArchived, keys)).length) await writeOne(tx, addArchive, keys)
    }),
  }
}
