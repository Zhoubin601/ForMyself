// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { assertKanataEffectExecutable, eventEffects } from '../../experience/kanataEvents.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { authorizeEventProof, storeEventProof, storeEventProofLinks, withEventProof } from './kanataEventProof.js'
import { correctionCauses, correctionSourceRefs, correctionTags, eventAuditSupport, eventCorrectionLinks,
  insertEventCorrection, updateEventFromAudit, writeEventCommitAudit, writeEventStatusAudit } from './kanataEventSnapshot.js'
import { createEventRevocation } from './kanataEventRevocation.js'
import { instanceTable, unpackInstance } from './kanataCharacterRepository.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { effectFromRow, eventFromRow, rebuildEventEffects, visitRows } from './kanataMessageDependents.js'
import { dependentQueries, dependentWrites } from './kanataMessageDependentsSql.js'
import { assertActor, grantAccess, grantAllowed, grantBindings, requireLifeSources, requireSourceGrants, sourceConversation, uniqueLifeSources, visitSourceGrants } from './kanataProvenance.js'
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
const contextCandidates = `WITH scope(world,actor,group_mode,before_id) AS (VALUES(?,?,?,?))
  SELECT e.id,e.rowid AS ordinal FROM scope JOIN world_events e ON e.world_id=scope.world
  WHERE e.status='committed' AND e.rowid<scope.before_id AND (scope.group_mode=0 OR e.visibility='public')
    AND EXISTS (SELECT 1 FROM event_participants p WHERE p.world_id=e.world_id AND p.event_id=e.id AND p.participant_id=scope.actor)
  ORDER BY e.rowid DESC LIMIT 50`
const contextBody = 'SELECT id,summary,effective_at,revision FROM world_events WHERE world_id=? AND id=?'
const eventMembership = 'SELECT 1 FROM event_participants WHERE world_id=? AND event_id=? AND participant_id=?'
const targetEvents = `SELECT DISTINCT f.event_id FROM world_effects f JOIN world_events e ON e.world_id=f.world_id AND e.id=f.event_id
  WHERE f.world_id=? AND f.target_id=? AND f.event_id>? AND e.status='committed' ORDER BY f.event_id LIMIT 128`
const deniedContext = new Set(['EVENT_CONTEXT_DENIED', 'EVENT_CAUSE_UNAVAILABLE', 'EVENT_UNAVAILABLE',
  'KANATA_CONTEXT_SCOPE_DENIED', 'KANATA_SOURCE_STALE', 'KANATA_LIFE_PERMISSION_DENIED'])
const eventAudits = `SELECT id,at,previous_json,next_json FROM event_audits WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT ?`
const listEffects = 'SELECT * FROM world_effects WHERE world_id=? AND event_id=? AND id>? ORDER BY id LIMIT 128'
const eventCharacters = `SELECT l.participant_id FROM event_participants l JOIN participants p
  ON p.world_id=l.world_id AND p.id=l.participant_id AND p.kind='character'
  WHERE l.world_id=? AND l.event_id=? AND l.participant_id>? ORDER BY l.participant_id LIMIT 50`
const effectInput = `SELECT status,revision,kind,visibility,effective_at,action_instance_id,action_relationship_id,action_location
  FROM world_events WHERE world_id=? AND id=?`
const eventIdentity = 'SELECT id FROM world_events WHERE world_id=? AND id=?'
const previewRows = 'SELECT id,status,revision,effective_at,causality FROM world_events WHERE world_id=? AND id>? ORDER BY id LIMIT 128'
const descendants = `WITH RECURSIVE args(world,root) AS (VALUES(?,?)), affected(id) AS (
  SELECT root FROM args UNION SELECT c.event_id FROM affected a JOIN event_causes c ON c.cause_event_id=a.id
  JOIN args ON c.world_id=args.world
) SELECT id FROM affected WHERE id>? ORDER BY id LIMIT 128`
const originRows = `WITH RECURSIVE args(world,root) AS (VALUES(?,?)), origins(id) AS (
  SELECT root FROM args UNION SELECT c.cause_event_id FROM origins o JOIN event_causes c ON c.event_id=o.id
  JOIN args ON c.world_id=args.world
) SELECT e.id,e.status,e.visibility FROM origins o JOIN world_events e ON e.id=o.id JOIN args ON e.world_id=args.world
  WHERE e.id>? ORDER BY e.id LIMIT 50`
const graphPageSql = (/** @type {'cause'|'consequence'} */ direction) => {
  const [from, to] = direction === 'cause' ? ['event_id', 'cause_event_id'] : ['cause_event_id', 'event_id']
  return `WITH RECURSIVE scope(world,root) AS (VALUES(?,?)), nodes(id) AS (
    SELECT root FROM scope UNION
    SELECT l.${to} FROM nodes n CROSS JOIN scope CROSS JOIN event_causes l WHERE l.world_id=scope.world AND l.${from}=n.id
  )
  SELECT e.id,e.revision,e.status,e.effective_at FROM scope JOIN nodes n
  JOIN world_events e ON e.world_id=scope.world AND e.id=n.id
  WHERE e.id<>scope.root AND e.id>? ORDER BY e.id LIMIT ?`
}
const graphQueries = { cause: graphPageSql('cause'), consequence: graphPageSql('consequence') }
const graphRoot = 'SELECT revision FROM world_events WHERE world_id=? AND id=?'
const relation = /** @type {ReturnType<typeof domainTable<StoredRelation>>} */ (domainTable('relationships', {
  world_id: 'worldId', id: 'id', from_id: 'fromId', to_id: 'toId', kind: 'kind', trust_baseline: 'trustBaseline',
  public_summary: 'publicSummary', trust: 'trust', intimacy: 'intimacy', understanding: 'understanding',
  dimension_rule_version: 'dimensionRuleVersion', revision: 'revision',
}, ['world_id', 'id'], ['sourceEventIds']))
const eventInsert = `INSERT INTO world_events(world_id,id,status,visibility,summary,effective_at,recorded_at,revision,causality,
  kind,action_instance_id,action_relationship_id,action_location,replaces_event_id,extensions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
const eventUpdate = 'UPDATE world_events SET status=?,revision=revision+1,extensions_json=? WHERE world_id=? AND id=? AND revision=?'
const eventStatus = 'UPDATE world_events SET status=?,revision=revision+1 WHERE world_id=? AND id=? AND revision=?'
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
const outgoing = `SELECT id,from_id,to_id,kind,public_summary FROM relationships
  WHERE world_id=? AND from_id=? AND id>? ORDER BY id LIMIT 50`
const managedEventRelations = `SELECT id,from_id,to_id,kind,public_summary FROM relationships
  WHERE world_id=? AND id>? ORDER BY id LIMIT 51`
const managedEventCauses = `SELECT id,summary FROM world_events
  WHERE world_id=? AND status='committed' AND id>? ORDER BY id LIMIT 51`
const relationDimensions = 'SELECT trust,intimacy,understanding FROM relationships WHERE world_id=? AND id=?'
const relationEvents = 'SELECT event_id FROM relationship_events WHERE world_id=? AND relationship_id=? ORDER BY event_id'
const staleEventMemories = `UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=? AND status<>'deleted'
  AND id IN (SELECT memory_id FROM memory_events WHERE world_id=? AND event_id IN (SELECT value FROM json_each(?)))`
const baselineValue = `SELECT mood,energy,location FROM character_instances WHERE world_id=? AND id=?`
const provenanceSources = dependentQueries.eventSources.replace('LIMIT 128','LIMIT 50')
const provenanceGrants = dependentQueries.eventLifeSources.replace('LIMIT 128','LIMIT 50')
const deniedEventGrant = `WITH ${grantAccess}
  SELECT 1 FROM event_life_sources s CROSS JOIN access WHERE s.world_id=? AND s.event_id=?
    AND NOT ${grantAllowed} LIMIT 1`
export const eventQueries = [graphRoot, ...Object.values(graphQueries), outgoing, managedEventRelations, managedEventCauses, relationDimensions, eventRow, list, pathHasEffects, listEffects, eventAudits, contextCandidates, contextBody, eventMembership, targetEvents, eventCharacters, effectInput, eventIdentity, previewRows, descendants, originRows, provenanceSources, provenanceGrants, deniedEventGrant, relation.get, relationEvents, baselineValue]
export const eventWrites = [eventInsert, eventUpdate, eventStatus, eventParticipant, eventSource, eventCause, eventLife, eventLifeClear,
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

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {'committed'|'commit'|'propose'} mode */
async function* visitOrigins(tx, worldId, eventId, mode) {
  let present = false
  for await (const origin of visitRows(tx, originRows, [worldId, eventId], ['id'], 50)) {
    present ||= origin.id === eventId
    need(origin.status === 'committed' || (origin.status === 'candidate' && (mode === 'propose' || (mode === 'commit' && origin.id === eventId))), 'EVENT_CAUSE_UNAVAILABLE')
    yield String(origin.id)
  }
  need(present, 'EVENT_UNAVAILABLE')
}

/** @param {Tx} tx @param {string} worldId @param {string} id */
async function* visitEventRefs(tx, worldId, id) {
  for await (const row of visitRows(tx, provenanceSources, [worldId, id], ['message_id'], 50)) {
    const ref = { messageId: String(row.message_id), revision: Number(row.message_revision) }
    await sourceConversation(tx, worldId, ref)
    yield ref
  }
}

/** Collect proof without accessing event summaries or transcripts.
 * @param {Tx} tx @param {string} worldId @param {string} eventId @param {'committed'|'commit'|'propose'} mode */
export async function* visitEventProvenance(tx, worldId, eventId, mode = 'committed') {
  for await (const id of visitOrigins(tx, worldId, eventId, mode)) {
    for await (const ref of visitEventRefs(tx, worldId, id)) yield* visitSourceGrants(tx, worldId, ref)
    for await (const grant of visitRows(tx, provenanceGrants, [worldId, id], ['grant_id', 'grant_revision', 'fingerprint'], 50)) {
      yield { grantId: String(grant.grant_id), instanceId: String(grant.instance_id), moduleId: /** @type {LifeSource['moduleId']} */ (grant.module_id),
        revision: Number(grant.grant_revision), fingerprint: String(grant.fingerprint) }
    }
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {'committed'|'commit'|'propose'} [mode] */
export async function eventProvenance(tx, worldId, eventId, mode) {
  const sources = []
  for await (const source of visitEventProvenance(tx, worldId, eventId, mode)) sources.push(source)
  return uniqueLifeSources(sources)
}
/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {{instanceId:string,group:boolean,sharedMemory?:boolean}} scope */
async function assertEventAudience(tx, worldId, eventId, scope) {
  await assertActor(tx, worldId, scope.instanceId)
  const [metadata] = await tx.query(eventRole, [worldId, eventId])
  need(metadata?.status === 'committed' && (!scope.group || metadata.visibility === 'public'), 'EVENT_CONTEXT_DENIED')
  if (!scope.sharedMemory) {
    const [member] = await tx.query(eventMembership, [worldId, eventId, scope.instanceId])
    need(member, 'EVENT_CONTEXT_DENIED')
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {{instanceId:string,group:boolean,sharedMemory?:boolean}} scope */
export async function assertEventProvenance(tx, worldId, eventId, scope) {
  await assertEventAudience(tx, worldId, eventId, scope)
  const access = { worldId, ...scope, remember: true }
  for await (const id of visitOrigins(tx, worldId, eventId, 'committed')) {
    for await (const ref of visitEventRefs(tx, worldId, id)) await requireSourceGrants(tx, ref, access)
    const denied = await tx.query(deniedEventGrant, [...grantBindings(access), worldId, id])
    need(denied.length === 0, 'KANATA_LIFE_PERMISSION_DENIED')
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {{instanceId:string,group:boolean,sharedMemory?:boolean}} scope */
export async function* visitAuthorizedEventSources(tx, worldId, eventId, scope) {
  await assertEventProvenance(tx, worldId, eventId, scope)
  yield* visitEventProvenance(tx, worldId, eventId)
}

/** @param {Tx} tx @param {string} worldId @param {string} eventId @param {{instanceId:string,group:boolean,sharedMemory?:boolean}} scope */
export async function authorizeEvent(tx, worldId, eventId, scope) {
  const sources = []
  for await (const source of visitAuthorizedEventSources(tx, worldId, eventId, scope)) sources.push(source)
  return uniqueLifeSources(sources)
}
const eventRole = 'SELECT status,visibility,revision FROM world_events WHERE world_id=? AND id=?'
/** @param {Tx} tx @param {string} worldId @param {{id:string,revision:number}} entry
 * @param {{instanceId:string,group:boolean}} scope @param {(source:LifeSource)=>Promise<void>} visit */
export async function visitEventPromptGrants(tx, worldId, entry, scope, visit) {
  const [row] = await tx.query(eventRole, [worldId, entry.id])
  need(row?.revision === entry.revision, 'EVENT_CONTEXT_DENIED')
  for await (const source of visitAuthorizedEventSources(tx, worldId, entry.id, scope)) await visit(source)
}
const managedEvent = 'SELECT id,summary,status,revision,kind,effective_at FROM world_events WHERE world_id=? AND id=?'
eventQueries.push(eventRole,managedEvent)

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
  await withEventProof(tx, proposalSources(tx, event), async () => {
    await authorizeEventProof(tx, worldId, characterParticipants(tx, event), event.visibility !== 'private')
    await writeOne(tx, eventInsert, [worldId, id, event.status, event.visibility, event.summary, effectiveAt, recordedAt, event.revision,
      event.causality ?? null, event.kind ?? null, event.action?.instanceId ?? null, event.action?.relationshipId ?? null,
      event.action?.location ?? null, event.replacesEventId ?? null, eventExtensions(event)])
    for (const member of participantIds) await writeOne(tx, eventParticipant, [worldId, id, member])
    for (const ref of sourceRefs) await writeOne(tx, eventSource, [worldId, id, ref.messageId, ref.revision])
    for (const cause of causedByEventIds) await writeOne(tx, eventCause, [worldId, id, cause])
    await storeEventProof(tx, worldId, id)
  })
  return event
}

/** @param {Tx} tx @param {Event} event */
async function* proposalSources(tx, event) {
  yield* event.lifeSources ?? []
  for (const ref of event.sourceRefs) {
    await sourceConversation(tx, event.worldId, ref)
    yield* visitSourceGrants(tx, event.worldId, ref)
  }
  for (const cause of event.causedByEventIds) yield* visitEventProvenance(tx, event.worldId, cause, 'propose')
}

/** @param {Tx} tx @param {string} worldId @param {string} id @param {string} sql */
async function* correctionItems(tx, worldId, id, sql) {
  let after = -1
  for (;;) {
    const page = await tx.query(sql,[worldId,id,after])
    for (const row of page) yield JSON.parse(String(row.item))
    if (page.length < 50) return
    after = Number(page[page.length-1].position)
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} id */
async function* correctedSources(tx, worldId, id) {
  yield* correctionItems(tx,worldId,id,correctionTags)
  for await (const ref of correctionItems(tx,worldId,id,correctionSourceRefs)) {
    await sourceConversation(tx,worldId,ref)
    yield* visitSourceGrants(tx,worldId,ref)
  }
  for await (const cause of correctionItems(tx,worldId,id,correctionCauses)) {
    yield* visitEventProvenance(tx,worldId,cause,'propose')
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} id @param {string} summary @param {Tools} tools */
async function prepareCorrection(tx,worldId,id,summary,tools) {
  const original = found((await tx.query(effectInput,[worldId,id]))[0],'EVENT_UNAVAILABLE')
  const [audit] = await tx.query(eventAuditSupport,[worldId,id,original.revision])
  need(audit && Number(audit.supported)>=0,'KANATA_SQLITE_INTEGRITY_FAILED')
  if (audit.supported===0) {
    const legacy = found(await loadEvent(tx,worldId,id),'EVENT_UNAVAILABLE')
    return async () => (await insertEvent(tx,{...legacy,id:tools.id(),replacesEventId:id,summary,
      status:'candidate',revision:1,recordedAt:tools.clock()})).id
  }
  return async () => {
    const replacementId = tools.id(), recordedAt = tools.clock()
    validateId(replacementId,'eventId')
    need(safeInteger(recordedAt) && safeInteger(Number(original.effective_at)),'INVALID_EVENT_FIELDS')
    await withEventProof(tx,correctedSources(tx,worldId,id),async () => {
      await authorizeEventProof(tx,worldId,storedCharacters(tx,worldId,id),original.visibility!=='private')
      await writeOne(tx,insertEventCorrection,[replacementId,summary,recordedAt,worldId,id])
      for (const sql of eventCorrectionLinks) await tx.execute(sql,[replacementId,worldId,id])
      await storeEventProof(tx,worldId,replacementId)
    })
    return replacementId
  }
}

/** @param {Tx} tx @param {Event} event */
async function* characterParticipants(tx, event) {
  for (const id of event.participantIds) {
    const [person] = await tx.query(participantKind, [event.worldId, id])
    if (person?.kind === 'character') yield id
  }
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

/** @param {Tx} tx @param {Pick<Event,'id'|'worldId'|'revision'>} previous @param {Tools} tools */
export async function commitEvent(tx, {id,worldId,revision}, tools) {
  const row = found((await tx.query(effectInput, [worldId,id]))[0], 'EVENT_UNAVAILABLE')
  need(row.status === 'candidate' && row.revision === revision, 'EVENT_COMMIT_CONFLICT')
  const scope = [worldId,id,revision]
  const [audit] = await tx.query(eventAuditSupport, scope)
  need(audit && Number(audit.supported) >= 0, 'KANATA_SQLITE_INTEGRITY_FAILED')
  if (audit.supported === 0) {
    // Historical non-object action strings use JavaScript object-spread UTF-16 semantics.
    await commitLegacyStringAction(tx, found(await loadEvent(tx,worldId,id),'EVENT_UNAVAILABLE'), tools)
    return
  }
  const action = {
    ...(row.action_instance_id !== null && {instanceId:String(row.action_instance_id)}),
    ...(row.action_relationship_id !== null && {relationshipId:String(row.action_relationship_id)}),
    ...(row.action_location !== null && {location:String(row.action_location)}),
  }
  const effects = await withEventProof(tx, visitEventProvenance(tx,worldId,id,'commit'), async () => {
    await authorizeEventProof(tx,worldId,storedCharacters(tx,worldId,id),row.visibility !== 'private')
    const effects = await calculateEffects(tx, {id,worldId,kind:/** @type {Event['kind']} */ (row.kind),action}, tools)
    const auditId = tools.id()
    await writeOne(tx,eventStatus,['committed',...scope])
    const committed = [worldId,id,revision+1]
    need((await tx.execute(writeEventCommitAudit,[auditId,tools.clock(),'candidate',...committed])).affectedRows === 1,
      'KANATA_SQLITE_INTEGRITY_FAILED')
    await writeOne(tx, updateEventFromAudit, [auditId,...committed])
    await tx.execute(eventLifeClear, [worldId,id])
    await tx.execute(storeEventProofLinks,[worldId,id])
    return effects
  })
  await publishEffects(tx,worldId,id,effects,tools)
}

/** @param {Tx} tx @param {string} worldId @param {string} id */
async function* storedCharacters(tx, worldId, id) {
  for await (const row of visitRows(tx,eventCharacters,[worldId,id],['participant_id'],50)) yield String(row.participant_id)
}

/** @param {Tx} tx @param {Event} previous @param {Tools} tools */
async function commitLegacyStringAction(tx, previous, tools) {
  const { id, worldId } = previous
  const sources = await eventProvenance(tx, worldId, id, 'commit')
  /** @type {Event} */
  const next = { ...previous, status: 'committed', revision: previous.revision + 1, ...(sources.length && { lifeSources: sources }) }
  await authorizeParticipants(tx, next)
  const effects = await calculateEffects(tx,previous,tools)
  await transition(tx, previous, next, tools)
  await tx.execute(eventLifeClear, [worldId, id])
  await writeEventLife(tx, next)
  await publishEffects(tx,worldId,id,effects,tools)
}

/** @param {Tx} tx @param {Pick<Event,'id'|'worldId'|'kind'|'action'>} event @param {Tools} tools */
async function calculateEffects(tx, event, tools) {
  const { worldId, id, action } = event
  const relationships = []
  const instances = []
  const target = action?.relationshipId ? await relation.read(tx, [worldId, action.relationshipId]) : null
  if (target) {
    const { trust, intimacy, understanding, ...fields } = target
    relationships.push({ ...fields, dimensions: { trust, intimacy, understanding }, sourceEventIds: [] })
  }
  for (const instanceId of new Set([action?.instanceId, target?.fromId])) {
    const row = instanceId && await instanceTable.read(tx, [worldId, instanceId])
    if (row) instances.push(unpackInstance(row))
  }
  const participantIds = []
  for (const member of new Set([action?.instanceId,target?.fromId,target?.toId])) {
    if (member && (await tx.query(eventMembership,[worldId,id,member])).length) participantIds.push(member)
  }
  return eventEffects({ relationships, instances }, {...event,participantIds}, tools.id)
}

/** @param {Tx} tx @param {string} worldId @param {string} id @param {Effect[]} effects @param {Tools} tools */
async function publishEffects(tx, worldId, id, effects, tools) {
  for (const effect of effects) await insertEffect(tx, effect, tools)
  await rebuildEventEffects(tx, dependentQueries.eventEffectPaths, [worldId, id])
  for (const targetId of new Set(effects.filter(effect => effect.targetType === 'relationship').map(effect => effect.targetId))) {
    await writeOne(tx, relationLink, [worldId, targetId, id])
  }
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
    const [row] = await tx.query(eventRole,[plan.worldId,id])
    const current = found(row,'EVENT_UNAVAILABLE')
    if (current.status === 'revoked') continue
    const scope = [plan.worldId,id,current.revision]
    const [audit] = await tx.query(eventAuditSupport,scope)
    need(audit && Number(audit.supported)>=0,'KANATA_SQLITE_INTEGRITY_FAILED')
    const status = changes.has(id) ? 'revoked' : 'needsReview'
    const revision = Number(current.revision)+1
    if (audit.supported === 0) {
      const previous = found(await loadEvent(tx,plan.worldId,id),'EVENT_UNAVAILABLE')
      await transition(tx,previous,{...previous,status,revision},tools)
    } else {
      await writeOne(tx,eventStatus,[status,...scope])
      const auditId = tools.id()
      need((await tx.execute(writeEventStatusAudit,[auditId,tools.clock(),current.status,plan.worldId,id,revision])).affectedRows===1,
        'KANATA_SQLITE_INTEGRITY_FAILED')
      await writeOne(tx,updateEventFromAudit,[auditId,plan.worldId,id,revision])
    }
  }
  await tx.execute(staleEventMemories, [plan.worldId, plan.worldId, JSON.stringify(ids)])
  await rebuildEventEffects(tx, dependentQueries.plannedEffectPaths, [JSON.stringify(ids), plan.worldId])
}

/** @param {Tx} tx @param {string} worldId @param {string} id @param {{instanceId:string,group:boolean}} scope */
async function authorizedEventProof(tx, worldId, id, scope) {
  try {
    await assertEventProvenance(tx, worldId, id, scope)
    return true
  }
  catch (error) {
    if (!deniedContext.has(/** @type {{code?:string}} */ (error).code ?? '')) throw error
    return null
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} targetId @param {{instanceId:string,group:boolean}} scope */
async function targetVisible(tx, worldId, targetId, scope) {
  for await (const row of visitRows(tx, targetEvents, [worldId, targetId], ['event_id'])) {
    try {
      await assertEventProvenance(tx, worldId, String(row.event_id), scope)
    } catch (error) {
      if (!deniedContext.has(/** @type {{code?:string}} */ (error).code ?? '')) throw error
      return false
    }
  }
  return true
}
/** @param {Operation} operation @param {Tools} tools */
export function createKanataEventRepository(operation, tools) {
  /** @param {Tx} tx @param {Omit<Event,'id'|'status'|'revision'|'recordedAt'>} fields @param {string} commandId */
  async function proposeCommand(tx, fields, commandId) {
    await assertWritableWorld(tx, fields.worldId)
    return executeOnce(tx, ['event:propose', fields.worldId, commandId], fields, async () => {
      const event = await insertEvent(tx, { ...cloneKanataJson(fields), id: tools.id(), revision: 1, status: 'candidate',
        recordedAt: tools.clock(), causality: fields.causality ?? 'explicit' })
      return event.id
    })
  }
  /** @param {Tx} tx @param {string} worldId @param {string} id @param {number} revision */
  async function commitCommand(tx, worldId, id, revision) {
    await assertWritableWorld(tx, worldId)
    return executeOnce(tx, ['event:commit', worldId, id, String(revision)], revision, async () => {
      await commitEvent(tx, {id,worldId,revision}, tools)
      return id
    })
  }
  /** @param {Tx} tx @param {string} worldId @param {string} id
   * @returns {Promise<import('./kanataDomainTypes').KanataEventAcknowledgement>} */
  async function acknowledgement(tx, worldId, id) {
    found((await tx.query(eventIdentity,[worldId,id]))[0],'EVENT_UNAVAILABLE')
    return {id}
  }
  return {
    ...createEventRevocation(operation,tools,(tx,plan,summary)=>
      prepareCorrection(tx,plan.worldId,plan.eventId,summary,tools)),
    /** @param {string} worldId @param {string} after */
    proposalRelations: (worldId,after='') => operation.transaction(async tx=>{
      await assertWritableWorld(tx,worldId)
      if(after)validateId(after,'cursor')
      const rows=await tx.query(managedEventRelations,[worldId,after])
      const entries=rows.slice(0,50).map(row=>({id:String(row.id),fromId:String(row.from_id),toId:String(row.to_id),
        title:String(row.public_summary||row.kind)}))
      return {entries,cursor:rows.length>50?entries[49].id:null}
    }),
    /** @param {string} worldId @param {string} after */
    proposalCauses: (worldId,after='') => operation.transaction(async tx=>{
      await assertWritableWorld(tx,worldId)
      if(after)validateId(after,'cursor')
      const rows=await tx.query(managedEventCauses,[worldId,after])
      const entries=rows.slice(0,50).map(row=>({id:String(row.id),title:String(row.summary)}))
      return {entries,cursor:rows.length>50?entries[49].id:null}
    }),
    /** @param {string} worldId @param {string} eventId */
    managedEvent: (worldId,eventId) => operation.transaction(async tx=>{
      validateId(worldId,'worldId')
      validateId(eventId,'eventId')
      const [row]=await tx.query(managedEvent,[worldId,eventId])
      return row?{id:String(row.id),summary:String(row.summary),revision:Number(row.revision),
        status:String(row.status),kind:row.kind??'note',effectiveAt:Number(row.effective_at)}:null
    }),
    /** @param {string} worldId @param {string} afterId @param {number} limit */
    list: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      const rows = await tx.query(list, [worldId, afterId, pageLimit(limit) + 1])
      const events = []
      for (const row of rows.slice(0, limit)) events.push(await eventFromRow(tx, row))
      return { events, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} worldId @param {string} eventId @param {'cause'|'consequence'} direction
     * @param {import('./kanataDomainTypes').KanataEventGraphCursor} [cursor] */
    graphPage: (worldId, eventId, direction, cursor) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(eventId, 'eventId')
      need(Object.hasOwn(graphQueries, direction), 'EVENT_GRAPH_DIRECTION_INVALID')
      const [root] = await tx.query(graphRoot, [worldId, eventId])
      need(root, 'EVENT_UNAVAILABLE')
      const rootRevision = Number(root.revision)
      if (cursor) {
        validateId(cursor.after, 'cursor')
        need(cursor.worldId === worldId && cursor.eventId === eventId && cursor.direction === direction
          && cursor.rootRevision === rootRevision, 'EVENT_GRAPH_CURSOR_STALE')
      }
      const rows = await tx.query(graphQueries[direction], [worldId, eventId, cursor?.after ?? '', 51])
      const entries = rows.slice(0, 50).map(row => ({
        id: String(row.id), revision: Number(row.revision), effectiveAt: Number(row.effective_at),
        status: /** @type {Event['status']} */ (row.status),
      }))
      return { entries, cursor: rows.length > 50 ? { worldId, eventId, direction, rootRevision, after: entries[49].id } : null }
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
      const events = []
      let before = Number.MAX_SAFE_INTEGER
      while (events.length < 12) {
        const page = await tx.query(contextCandidates, [worldId, scope.instanceId, Number(scope.group), before])
        for (const row of page) {
          const id = String(row.id)
          if (!await authorizedEventProof(tx, worldId, id, scope)) continue
          const [event] = await tx.query(contextBody, [worldId, id])
          const body = found(event, 'EVENT_UNAVAILABLE')
          events.unshift({ id, summary: String(body.summary), effectiveAt: Number(body.effective_at), revision: Number(body.revision) })
          if (events.length === 12) break
        }
        if (page.length < 50) break
        before = Number(page[page.length - 1].ordinal)
      }
      const hiddenTargetIds = new Set()
      for (const targetId of targets) {
        if (!await targetVisible(tx, worldId, targetId, scope)) hiddenTargetIds.add(targetId)
      }
      return { events, hiddenTargetIds }
    }),
    /** @param {string} worldId @param {{instanceId:string,group:boolean}} scope @param {number} byteBudget */
    relationshipContext: (worldId, scope, byteBudget) => operation.transaction(async tx => {
      await assertActor(tx, worldId, scope.instanceId)
      need(safeInteger(byteBudget, 1) && byteBudget <= 64000, 'INVALID_CONTEXT_BUDGET')
      const relationships = []
      const hiddenTargetIds = new Set()
      const encoder = new TextEncoder()
      let bytes = 2
      let cursor = ''
      for (;;) {
        const page = await tx.query(outgoing, [worldId, scope.instanceId, cursor])
        for (const row of page) {
          const id = String(row.id), toId = String(row.to_id), publicSummary = String(row.public_summary)
          const kind = /** @type {Relationship['kind']} */ (row.kind)
          const visible = await targetVisible(tx, worldId, id, scope)
          const [state] = visible ? await tx.query(relationDimensions, [worldId, id]) : []
          const dimensions = state ? { trust: Number(state.trust), intimacy: Number(state.intimacy), understanding: Number(state.understanding) } : undefined
          bytes += Number(relationships.length > 0) + encoder.encode(JSON.stringify({
            target: toId, kind, summary: publicSummary, ...(dimensions ? { dimensions } : { dynamicStateUnavailable: true }),
          })).length
          need(bytes <= byteBudget, 'CONTEXT_BUDGET_EXCEEDED')
          if (!visible) hiddenTargetIds.add(id)
          relationships.push({ id, worldId, fromId: scope.instanceId, toId, kind, publicSummary, dimensions })
        }
        if (page.length < 50) return { relationships, hiddenTargetIds }
        cursor = String(page[page.length - 1].id)
      }
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
      const id = await proposeCommand(tx,fields,commandId)
      return found(await loadEvent(tx,fields.worldId,id),'EVENT_UNAVAILABLE')
    }),
    /** @param {Omit<Event,'id'|'status'|'revision'|'recordedAt'>} fields @param {string} commandId */
    proposeAcknowledged: (fields, commandId) => operation.transaction(async tx =>
      acknowledgement(tx,fields.worldId,await proposeCommand(tx,fields,commandId))),
    /** @param {string} worldId @param {string} id @param {number} revision */
    commit: (worldId, id, revision) => operation.transaction(async tx => {
      await commitCommand(tx,worldId,id,revision)
      return found(await loadEvent(tx,worldId,id),'EVENT_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {string} id @param {number} revision */
    commitAcknowledged: (worldId,id,revision) => operation.transaction(async tx =>
      acknowledgement(tx,worldId,await commitCommand(tx,worldId,id,revision))),
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
        const replacement = await prepareCorrection(tx,plan.worldId,plan.eventId,summary.trim(),tools)
        await revoke(tx, plan, decision, tools)
        return replacement()
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
