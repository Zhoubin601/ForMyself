// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { assertKanataEffectExecutable, eventEffects } from '../../experience/kanataEvents.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { instanceTable, unpackInstance } from './kanataCharacterRepository.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { effectFromRow, eventFromRow, rebuildEventEffects, visitRows } from './kanataMessageDependents.js'
import { dependentQueries, dependentWrites } from './kanataMessageDependentsSql.js'
import { assertActor, requireLifeSources, sourceMetadata, uniqueLifeSources } from './kanataProvenance.js'
import { equalDto, nonemptyText, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').WorldEvent} Event */
/** @typedef {import('../../domain/kanataTypes').WorldEffect} Effect */
/** @typedef {import('../../domain/kanataTypes').Relationship} Relationship */
/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */
/** @typedef {Omit<Relationship,'dimensions'|'sourceEventIds'> & Relationship['dimensions']} StoredRelation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {{id:()=>string, clock:()=>number}} Tools */
/** @typedef {{worldId:string,eventId:string,revokeIds:string[],uncertainIds:string[],signature:string}} Preview */

const eventRow = 'SELECT * FROM world_events WHERE world_id=? AND id=?'
const list = 'SELECT * FROM world_events WHERE world_id=? AND id>? ORDER BY id LIMIT ?'
const pathHasEffects = 'SELECT 1 FROM world_effects WHERE world_id=? AND target_type=? AND target_id=? AND path=? LIMIT 1'
const contextCandidates = `SELECT id,rowid AS ordinal FROM world_events
  WHERE world_id=? AND status='committed' AND rowid<? ORDER BY rowid DESC LIMIT 50`
const targetEvents = `SELECT DISTINCT f.event_id FROM world_effects f JOIN world_events e ON e.world_id=f.world_id AND e.id=f.event_id
  WHERE f.world_id=? AND f.target_id=? AND f.event_id>? AND e.status='committed' ORDER BY f.event_id LIMIT 128`
const deniedContext = new Set(['EVENT_CONTEXT_DENIED', 'EVENT_CAUSE_UNAVAILABLE', 'EVENT_UNAVAILABLE',
  'KANATA_CONTEXT_SCOPE_DENIED', 'KANATA_SOURCE_STALE', 'KANATA_LIFE_PERMISSION_DENIED'])
const eventAudits = `SELECT id,at,previous_json,next_json FROM event_audits WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT ?`
const listEffects = 'SELECT * FROM world_effects WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT 128'
const participants = 'SELECT participant_id FROM event_participants WHERE world_id=? AND event_id=? ORDER BY participant_id'
const previewRows = 'SELECT id,status,revision,effective_at,causality FROM world_events WHERE world_id=? AND id>? ORDER BY id LIMIT 128'
const descendants = `WITH RECURSIVE args(world,root) AS (VALUES(?,?)), affected(id) AS (
  SELECT root FROM args UNION SELECT c.event_id FROM affected a JOIN event_causes c ON c.cause_event_id=a.id
  JOIN args ON c.world_id=args.world
) SELECT id FROM affected WHERE id>? ORDER BY id LIMIT 128`
const originRows = `WITH RECURSIVE args(world,root) AS (VALUES(?,?)), origins(id) AS (
  SELECT root FROM args UNION SELECT c.cause_event_id FROM origins o JOIN event_causes c ON c.event_id=o.id
  JOIN args ON c.world_id=args.world
) SELECT e.id,e.status,e.visibility FROM origins o JOIN world_events e ON e.id=o.id JOIN args ON e.world_id=args.world
  WHERE e.id>? ORDER BY e.id LIMIT 128`
const relation = /** @type {ReturnType<typeof domainTable<StoredRelation>>} */ (domainTable('relationships', {
  world_id: 'worldId', id: 'id', from_id: 'fromId', to_id: 'toId', kind: 'kind', trust_baseline: 'trustBaseline',
  public_summary: 'publicSummary', trust: 'trust', intimacy: 'intimacy', understanding: 'understanding',
  dimension_rule_version: 'dimensionRuleVersion', revision: 'revision',
}, ['world_id', 'id'], ['sourceEventIds']))
const eventInsert = `INSERT INTO world_events(world_id,id,status,visibility,summary,effective_at,recorded_at,revision,causality,
  kind,action_instance_id,action_relationship_id,action_location,replaces_event_id,extensions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
const eventUpdate = 'UPDATE world_events SET status=?,revision=revision+1,extensions_json=? WHERE world_id=? AND id=? AND revision=?'
const eventParticipant = 'INSERT INTO event_participants(world_id,event_id,participant_id) VALUES(?,?,?)'
const eventSource = 'INSERT INTO event_sources(world_id,event_id,message_id,message_revision) VALUES(?,?,?,?)'
const eventCause = 'INSERT INTO event_causes(world_id,event_id,cause_event_id) VALUES(?,?,?)'
const eventLife = 'INSERT INTO event_life_sources(world_id,event_id,grant_id,instance_id,module_id,grant_revision,fingerprint) VALUES(?,?,?,?,?,?,?)'
const eventLifeClear = 'DELETE FROM event_life_sources WHERE world_id=? AND event_id=?'
const effectInsert = `INSERT INTO world_effects(world_id,id,event_id,target_type,target_id,target_instance_id,target_relationship_id,
  operation,path,value_json,rule_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
const baselineInsert = `INSERT INTO effect_baselines(world_id,id,target_type,target_id,target_instance_id,target_relationship_id,path,value_json)
  VALUES(?,?,?,?,?,?,?,?)`
const relationLink = 'INSERT INTO relationship_events(world_id,relationship_id,event_id) VALUES(?,?,?)'
const relationEvents = 'SELECT event_id FROM relationship_events WHERE world_id=? AND relationship_id=? ORDER BY event_id'
const staleEventMemories = `UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=? AND status<>'deleted'
  AND id IN (SELECT memory_id FROM memory_events WHERE world_id=? AND event_id IN (SELECT value FROM json_each(?)))`
const baselineValue = `SELECT mood,energy,location FROM character_instances WHERE world_id=? AND id=?`
export const eventQueries = [eventRow, list, pathHasEffects, listEffects, eventAudits, contextCandidates, targetEvents, participants, previewRows, descendants, originRows, relation.get, relationEvents, baselineValue]
export const eventWrites = [eventInsert, eventUpdate, eventParticipant, eventSource, eventCause, eventLife, eventLifeClear,
  effectInsert, baselineInsert, relationLink, staleEventMemories, ...relation.writeStatements]

/** @param {Event} event */
function eventExtensions(event) {
  const { id: _id, worldId: _worldId, status: _status, visibility: _visibility, summary: _summary,
    effectiveAt: _effectiveAt, recordedAt: _recordedAt, revision: _revision, causality: _causality,
    kind: _kind, replacesEventId: _replacesEventId, ...extensions } = event
  return JSON.stringify(extensions)
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId */
async function loadEvent(tx, worldId, eventId) {
  const [row] = await tx.query(eventRow, [worldId, eventId])
  return row ? eventFromRow(tx, row) : null
}

/** Collect proof of all source revisions and grants without accessing event summaries or transcripts.
 * @param {Tx} tx @param {string} worldId @param {string} eventId @param {'committed'|'commit'|'propose'} mode */
export async function eventProvenance(tx, worldId, eventId, mode = 'committed') {
  const sources = []
  let present = false
  for await (const origin of visitRows(tx, originRows, [worldId, eventId], ['id'])) {
    present ||= origin.id === eventId
    need(origin.status === 'committed' || (origin.status === 'candidate' && (mode === 'propose' || (mode === 'commit' && origin.id === eventId))), 'EVENT_CAUSE_UNAVAILABLE')
    const keys = [worldId, origin.id]
    for await (const ref of visitRows(tx, dependentQueries.eventSources, keys, ['message_id'])) {
      const metadata = await sourceMetadata(tx, worldId, { messageId: String(ref.message_id), revision: Number(ref.message_revision) })
      sources.push(...metadata.sources)
    }
    for await (const grant of visitRows(tx, dependentQueries.eventLifeSources, keys, ['grant_id', 'grant_revision', 'fingerprint'])) {
      sources.push({ grantId: String(grant.grant_id), instanceId: String(grant.instance_id), moduleId: /** @type {LifeSource['moduleId']} */ (grant.module_id),
        revision: Number(grant.grant_revision), fingerprint: String(grant.fingerprint) })
    }
  }
  need(present, 'EVENT_UNAVAILABLE')
  return uniqueLifeSources(sources)
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {{instanceId:string,group:boolean,sharedMemory?:boolean}} scope */
export async function authorizeEvent(tx, worldId, eventId, scope) {
  await assertActor(tx, worldId, scope.instanceId)
  const [metadata] = await tx.query(eventRole, [worldId, eventId])
  need(metadata?.status === 'committed' && (!scope.group || metadata.visibility === 'public'), 'EVENT_CONTEXT_DENIED')
  if (!scope.sharedMemory) {
    const people = await tx.query(participants, [worldId, eventId])
    need(people.some(person => person.participant_id === scope.instanceId), 'EVENT_CONTEXT_DENIED')
  }
  const sources = await eventProvenance(tx, worldId, eventId)
  await requireLifeSources(tx, sources, { worldId, ...scope, remember: true })
  return sources
}
const eventRole = 'SELECT status,visibility FROM world_events WHERE world_id=? AND id=?'
eventQueries.push(eventRole)

/** @param {Tx} tx @param {Event} event */
async function writeEventLife(tx, event) {
  for (const source of event.lifeSources ?? []) {
    await writeOne(tx, eventLife, [event.worldId, event.id, source.grantId, source.instanceId, source.moduleId, source.revision, source.fingerprint])
  }
}

/** @param {Tx} tx @param {Event} event */
export async function insertEvent(tx, event) {
  const { id, worldId, effectiveAt, recordedAt, participantIds, causedByEventIds, sourceRefs } = event
  validateId(id, 'eventId')
  need(nonemptyText(event.summary) && event.summary.length <= 2000 && safeInteger(effectiveAt) && safeInteger(recordedAt),
    'INVALID_EVENT_FIELDS')
  const sources = [...event.lifeSources ?? []]
  for (const ref of sourceRefs) sources.push(...(await sourceMetadata(tx, worldId, ref)).sources)
  for (const cause of causedByEventIds) sources.push(...await eventProvenance(tx, worldId, cause, 'propose'))
  if (sources.length) {
    event.lifeSources = uniqueLifeSources(sources)
    await authorizeParticipants(tx, event)
  }
  await writeOne(tx, eventInsert, [worldId, id, event.status, event.visibility, event.summary, effectiveAt, recordedAt, event.revision,
    event.causality ?? null, event.kind ?? null, event.action?.instanceId ?? null, event.action?.relationshipId ?? null,
    event.action?.location ?? null, event.replacesEventId ?? null, eventExtensions(event)])
  for (const member of participantIds) await writeOne(tx, eventParticipant, [worldId, id, member])
  for (const ref of sourceRefs) await writeOne(tx, eventSource, [worldId, id, ref.messageId, ref.revision])
  for (const cause of causedByEventIds) await writeOne(tx, eventCause, [worldId, id, cause])
  await writeEventLife(tx, event)
  return event
}

/** @param {Tx} tx @param {Event} event */
async function authorizeParticipants(tx, event) {
  let roles = 0
  for (const id of event.participantIds) {
    const [person] = await tx.query(participantKind, [event.worldId, id])
    if (person?.kind !== 'character') continue
    roles++
    await requireLifeSources(tx, event.lifeSources ?? [], {
      worldId: event.worldId, instanceId: id, group: event.visibility !== 'private', remember: true,
    })
  }
  need(roles > 0 || !event.lifeSources?.length, 'EVENT_LIFE_PERMISSION_DENIED')
}
const participantKind = 'SELECT kind FROM participants WHERE world_id=? AND id=?'
eventQueries.push(participantKind)

/** @param {Tx} tx @param {Event} previous @param {Event} next @param {Tools} tools */
async function transition(tx, previous, next, tools) {
  await writeOne(tx, eventUpdate, [next.status, eventExtensions(next), previous.worldId, previous.id, previous.revision])
  await writeOne(tx, dependentWrites.audit, [tools.id(), previous.worldId, previous.id, tools.clock(), previous.revision, next.revision,
    JSON.stringify(previous), JSON.stringify(next)])
}

/** @param {Effect} effect */
function targetValues({ targetType, targetId }) {
  return [targetType, targetId, targetType === 'instance' ? targetId : null, targetType === 'relationship' ? targetId : null]
}

/** @param {Tx} tx @param {Effect} effect @param {Tools} tools */
async function insertEffect(tx, effect, tools) {
  assertKanataEffectExecutable(effect)
  const values = [effect.worldId, effect.targetType, effect.targetId, effect.path]
  const [baseline] = await tx.query(dependentQueries.baseline, values)
  if (!baseline) {
    const [existing] = await tx.query(pathHasEffects, values)
    need(!existing, 'EVENT_BASELINE_REQUIRED')
    const target = effect.targetType === 'instance'
      ? (await tx.query(baselineValue, [effect.worldId, effect.targetId]))[0]
      : await relation.read(tx, [effect.worldId, effect.targetId])
    const field = effect.path.split('.')[1]
    const record = /** @type {Record<string, unknown>|null|undefined} */ (target)
    need(record && Object.hasOwn(record, field), 'EVENT_TARGET_UNAVAILABLE')
    await writeOne(tx, baselineInsert, [effect.worldId, tools.id(), ...targetValues(effect), effect.path, JSON.stringify(record?.[field])])
  }
  await writeOne(tx, effectInsert, [effect.worldId, effect.id, effect.eventId, ...targetValues(effect), effect.operation, effect.path,
    JSON.stringify(effect.value), effect.ruleVersion])
}

/** @param {Tx} tx @param {Event} previous @param {Tools} tools */
export async function commitEvent(tx, previous, tools) {
  const { id, worldId } = previous
  need(previous.status === 'candidate', 'EVENT_COMMIT_CONFLICT')
  const sources = await eventProvenance(tx, worldId, id, 'commit')
  /** @type {Event} */
  const next = { ...previous, status: 'committed', revision: previous.revision + 1, ...(sources.length && { lifeSources: sources }) }
  await authorizeParticipants(tx, next)
  const relationships = []
  const instances = []
  const target = previous.action?.relationshipId ? await relation.read(tx, [worldId, previous.action.relationshipId]) : null
  if (target) {
    const { trust, intimacy, understanding, ...fields } = target
    relationships.push({ ...fields, dimensions: { trust, intimacy, understanding }, sourceEventIds: [] })
  }
  for (const instanceId of new Set([previous.action?.instanceId, target?.fromId])) {
    const row = instanceId && await instanceTable.read(tx, [worldId, instanceId])
    if (row) instances.push(unpackInstance(row))
  }
  const effects = eventEffects({ relationships, instances }, previous, tools.id)
  await transition(tx, previous, next, tools)
  await tx.execute(eventLifeClear, [worldId, id])
  await writeEventLife(tx, next)
  for (const effect of effects) await insertEffect(tx, effect, tools)
  await rebuildEventEffects(tx, visitRows(tx, listEffects, [worldId, id], ['id']))
  for (const targetId of new Set(effects.filter(effect => effect.targetType === 'relationship').map(effect => effect.targetId))) {
    await writeOne(tx, relationLink, [worldId, targetId, id])
  }
  return next
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @returns {Promise<Preview>} */
async function preview(tx, worldId, eventId) {
  const [root] = await tx.query(previewRoot, [worldId, eventId])
  need(root && root.status !== 'revoked', 'EVENT_UNAVAILABLE')
  const affected = new Set()
  for await (const row of visitRows(tx, descendants, [worldId, eventId], ['id'])) affected.add(String(row.id))
  const uncertainIds = []
  let signature = ''
  for await (const row of visitRows(tx, previewRows, [worldId], ['id'])) {
    signature = sha256Text(signature + JSON.stringify(row))
    if (!affected.has(row.id) && row.status === 'committed' && row.causality !== 'explicit' && Number(row.effective_at) >= Number(root.effective_at)) uncertainIds.push(String(row.id))
  }
  return { worldId, eventId, revokeIds: [...affected], uncertainIds, signature }
}
const previewRoot = 'SELECT status,effective_at FROM world_events WHERE world_id=? AND id=?'
eventQueries.push(previewRoot)

/** @param {Tx} tx @param {Preview} plan @param {'mark-needs-review'|'keep-independent'|undefined} decision @param {Tools} tools */
async function revoke(tx, plan, decision, tools) {
  const current = await preview(tx, plan.worldId, plan.eventId)
  need(equalDto(current, plan), 'EVENT_REVOKE_PREVIEW_STALE')
  need(!current.uncertainIds.length || decision === 'keep-independent' || decision === 'mark-needs-review', 'EVENT_DEPENDENCY_UNCERTAIN')
  const ids = [...current.revokeIds, ...(decision === 'mark-needs-review' ? current.uncertainIds : [])]
  const changes = new Set(current.revokeIds)
  for (const id of ids) {
    const previous = found(await loadEvent(tx, plan.worldId, id), 'EVENT_UNAVAILABLE')
    if (previous.status === 'revoked') continue
    await transition(tx, previous, { ...previous, status: changes.has(id) ? 'revoked' : 'needsReview', revision: previous.revision + 1 }, tools)
  }
  await tx.execute(staleEventMemories, [plan.worldId, plan.worldId, JSON.stringify(ids)])
  /** @returns {AsyncGenerator<import('./kanataSchemaTypes').KanataSqlRow>} */
  async function* affected() {
    for (const id of ids) yield* visitRows(tx, listEffects, [plan.worldId, id], ['id'])
  }
  await rebuildEventEffects(tx, affected())
}

/** @param {Operation} operation @param {Tools} tools */
export function createKanataEventRepository(operation, tools) {
  return {
    /** @param {string} worldId @param {string} afterId @param {number} limit */
    list: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      const rows = await tx.query(list, [worldId, afterId, pageLimit(limit) + 1])
      const events = []
      for (const row of rows.slice(0, limit)) events.push(await eventFromRow(tx, row))
      return { events, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} worldId @param {string} id @param {{instanceId:string,group:boolean}} scope */
    readFor: (worldId, id, scope) => operation.transaction(async tx => {
      const lifeSources = await authorizeEvent(tx, worldId, id, scope)
      const event = found(await loadEvent(tx, worldId, id), 'EVENT_UNAVAILABLE')
      return { ...event, lifeSources }
    }),
    /** @param {string} worldId @param {{instanceId:string,group:boolean}} scope @param {readonly string[]} targets */
    context: (worldId, scope, targets) => operation.transaction(async tx => {
      await assertActor(tx, worldId, scope.instanceId)
      const proofs = new Map()
      /** @param {string} id */
      const proof = async id => {
        if (!proofs.has(id)) {
          try { proofs.set(id, await authorizeEvent(tx, worldId, id, scope)) }
          catch (error) {
            if (!deniedContext.has(/** @type {{code?:string}} */ (error).code ?? '')) throw error
            proofs.set(id, null)
          }
        }
        return /** @type {LifeSource[]|null} */ (proofs.get(id))
      }
      const events = []
      let before = Number.MAX_SAFE_INTEGER
      while (events.length < 12) {
        const page = await tx.query(contextCandidates, [worldId, before])
        for (const row of page) {
          const id = String(row.id)
          const lifeSources = await proof(id)
          if (!lifeSources) continue
          const event = found(await loadEvent(tx, worldId, id), 'EVENT_UNAVAILABLE')
          events.unshift({ ...event, lifeSources })
          if (events.length === 12) break
        }
        if (page.length < 50) break
        before = Number(page[page.length - 1].ordinal)
      }
      const hiddenTargetIds = new Set()
      for (const targetId of targets) {
        for await (const row of visitRows(tx, targetEvents, [worldId, targetId], ['event_id'])) {
          if (!await proof(String(row.event_id))) { hiddenTargetIds.add(targetId); break }
        }
      }
      return { events, hiddenTargetIds }
    }),
    /** @param {string} worldId @param {string} eventId */
    effects: (worldId, eventId) => operation.transaction(async tx => {
      const result = []
      for await (const row of visitRows(tx, listEffects, [worldId, eventId], ['id'])) result.push(effectFromRow(row))
      return result
    }),
    /** @param {string} worldId @param {string} eventId @param {string} afterId @param {number} limit */
    audits: (worldId, eventId, afterId = '', limit = 50) => operation.transaction(async tx => {
      const rows = await tx.query(eventAudits, [worldId, eventId, afterId, pageLimit(limit) + 1])
      return {
        audits: rows.slice(0, limit).map(row => ({
          id: String(row.id), worldId, eventId, at: Number(row.at),
          previous: /** @type {Event} */ (JSON.parse(String(row.previous_json))),
          next: /** @type {Event} */ (JSON.parse(String(row.next_json))),
        })),
        cursor: rows.length > limit ? String(rows[limit - 1].id) : null,
      }
    }),
    /** @param {Omit<Event,'id'|'status'|'revision'|'recordedAt'>} fields @param {string} commandId */
    propose: (fields, commandId) => operation.transaction(async tx => {
      await assertWritableWorld(tx, fields.worldId)
      const id = await executeOnce(tx, ['event:propose', fields.worldId, commandId], fields, async () => {
        const event = await insertEvent(tx, { ...cloneKanataJson(fields), id: tools.id(), revision: 1, status: 'candidate',
          recordedAt: tools.clock(), causality: fields.causality ?? 'explicit' })
        return event.id
      })
      return found(await loadEvent(tx, fields.worldId, id), 'EVENT_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {string} id @param {number} revision */
    commit: (worldId, id, revision) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      await executeOnce(tx, ['event:commit', worldId, id, String(revision)], revision, async () => {
        const event = found(await loadEvent(tx, worldId, id), 'EVENT_UNAVAILABLE')
        need(event.revision === revision, 'EVENT_COMMIT_CONFLICT')
        await commitEvent(tx, event, tools)
        return id
      })
      return found(await loadEvent(tx, worldId, id), 'EVENT_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {string} id */
    preview: (worldId, id) => operation.transaction(tx => preview(tx, worldId, id)),
    /** @param {Preview} plan @param {'mark-needs-review'|'keep-independent'} [decision] */
    revoke: (plan, decision) => operation.transaction(async tx => {
      await assertWritableWorld(tx, plan.worldId)
      await executeOnce(tx, ['event:revoke', plan.worldId, plan.eventId, plan.signature], { plan, decision: decision ?? null }, async () => {
        await revoke(tx, plan, decision, tools)
        return plan.eventId
      })
    }),
    /** @param {Preview} plan @param {'mark-needs-review'|'keep-independent'|undefined} decision @param {string} summary */
    correct: (plan, decision, summary) => operation.transaction(async tx => {
      await assertWritableWorld(tx, plan.worldId)
      need(nonemptyText(summary) && summary.length <= 2000, 'INVALID_EVENT_SUMMARY')
      const id = await executeOnce(tx, ['event:correct', plan.worldId, plan.eventId, plan.signature], { plan, decision: decision ?? null, summary }, async () => {
        const original = found(await loadEvent(tx, plan.worldId, plan.eventId), 'EVENT_UNAVAILABLE')
        await revoke(tx, plan, decision, tools)
        const replacement = await insertEvent(tx, { ...original, id: tools.id(), replacesEventId: original.id,
          summary: summary.trim(), status: 'candidate', revision: 1, recordedAt: tools.clock() })
        return replacement.id
      })
      return found(await loadEvent(tx, plan.worldId, id), 'EVENT_UNAVAILABLE')
    }),
    /** @param {Relationship} value */
    createRelationship: value => operation.transaction(async tx => {
      await assertWritableWorld(tx, value.worldId)
      need(value.revision === 1 && !value.sourceEventIds.length, 'KANATA_RELATIONSHIP_INVALID')
      const { dimensions, sourceEventIds: _sourceEventIds, ...fields } = value
      await executeOnce(tx, ['relation:create', value.worldId, value.id], value, async () => {
        await relation.create(tx, { ...fields, ...dimensions })
        return value.id
      })
    }),
    /** @param {string} worldId @param {string} id */
    relationship: (worldId, id) => operation.transaction(async tx => {
      const row = await relation.read(tx, [worldId, id])
      if (!row) return null
      const { trust, intimacy, understanding, ...fields } = row
      const links = await tx.query(relationEvents, [worldId, id])
      return { ...fields, dimensions: { trust, intimacy, understanding }, sourceEventIds: links.map(link => String(link.event_id)) }
    }),
  }
}
