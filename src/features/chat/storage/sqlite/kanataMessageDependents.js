// @ts-check
import { applyKanataEffect, assertKanataEffectExecutable } from '../../experience/kanataEvents.js'
import { validateId } from '../../domain/kanataValidation.js'
import { dependentQueries as query, dependentWrites as write, updateEffectValue } from './kanataMessageDependentsSql.js'
import { messageWrites } from './kanataRepositorySql.js'
import { extensionObject, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').Message} Message */
/** @typedef {import('../../domain/kanataTypes').WorldEvent} Event */
/** @typedef {import('../../domain/kanataTypes').WorldEffect} Effect */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('./kanataSchemaTypes').KanataSqlValue} Value */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Transaction */
/** @typedef {{id:()=>string, clock:()=>number}} Tools */

/** @param {Transaction} tx @param {string} sql @param {Value[]} bindings @param {string[]} columns @param {number} [batchSize] */
export async function* visitRows(tx, sql, bindings, columns, batchSize = 128) {
  /** @type {Value[]} */
  let cursor = columns.map(column => column === 'grant_revision' ? 0 : '')
  for (;;) {
    const rows = await tx.query(sql, [...bindings, ...cursor])
    yield* rows
    if (rows.length < batchSize) return
    cursor = columns.map(column => rows[rows.length - 1][column])
  }
}

/** @template T @param {AsyncIterable<Row>} rows @param {(row:Row)=>T} project */
async function gather(rows, project) {
  /** @type {T[]} */
  const result = []
  for await (const row of rows) result.push(project(row))
  return result
}

/** Stored order hints may carry future fields, but cannot override normalized links.
 * @template T @param {T[]} actual @param {unknown} hint @param {(value:T)=>string} identity */
function originalOrder(actual, hint, identity) {
  if (hint === undefined) return actual
  need(Array.isArray(hint) && hint.length === actual.length, 'KANATA_SQLITE_INTEGRITY_FAILED')
  const expected = new Set(actual.map(identity))
  for (const item of /** @type {T[]} */ (hint)) {
    need(expected.delete(identity(item)), 'KANATA_SQLITE_INTEGRITY_FAILED')
  }
  return /** @type {T[]} */ (hint)
}

/** @param {Transaction} tx @param {Row} row @returns {Promise<Event>} */
export async function eventFromRow(tx, row) {
  const keys = [row.world_id, row.id]
  const extensions = extensionObject(row.extensions_json)
  const participants = await gather(visitRows(tx, query.eventParticipants, keys, ['participant_id']), link => String(link.participant_id))
  const causes = await gather(visitRows(tx, query.eventCauses, keys, ['cause_event_id']), link => String(link.cause_event_id))
  const sources = await gather(visitRows(tx, query.eventSources, keys, ['message_id']), link => ({
    messageId: String(link.message_id), revision: Number(link.message_revision),
  }))
  const life = await gather(visitRows(tx, query.eventLifeSources, keys, ['grant_id', 'grant_revision', 'fingerprint']), link => ({
    grantId: String(link.grant_id), instanceId: String(link.instance_id),
    moduleId: /** @type {import('../../domain/kanataTypes').LifeModule} */ (link.module_id),
    revision: Number(link.grant_revision), fingerprint: String(link.fingerprint),
  }))
  const action = { ...extensions.action }
  for (const [key, value] of [['instanceId', row.action_instance_id], ['relationshipId', row.action_relationship_id], ['location', row.action_location]]) {
    if (value !== null) action[String(key)] = String(value)
    else delete action[String(key)]
  }
  const participantIds = originalOrder(participants, extensions.participantIds, id => id)
  const causedByEventIds = originalOrder(causes, extensions.causedByEventIds, id => id)
  const sourceRefs = originalOrder(sources, extensions.sourceRefs, source => JSON.stringify([source.messageId, source.revision]))
  const lifeSources = originalOrder(life, extensions.lifeSources, source => JSON.stringify([
    source.grantId, source.instanceId, source.moduleId, source.revision, source.fingerprint,
  ]))
  const actionPresent = Object.keys(action).length || Object.hasOwn(extensions, 'action')
  const lifePresent = lifeSources.length || Object.hasOwn(extensions, 'lifeSources')
  for (const field of ['action', 'lifeSources', 'causality', 'kind', 'replacesEventId']) delete extensions[field]
  return {
    ...extensions, id: String(row.id), worldId: String(row.world_id), participantIds, causedByEventIds, sourceRefs,
    status: /** @type {Event['status']} */ (row.status), visibility: /** @type {Event['visibility']} */ (row.visibility),
    summary: String(row.summary), effectiveAt: Number(row.effective_at), recordedAt: Number(row.recorded_at), revision: Number(row.revision),
    ...(row.causality !== null && { causality: /** @type {Event['causality']} */ (row.causality) }),
    ...(row.kind !== null && { kind: /** @type {Event['kind']} */ (row.kind) }),
    ...(row.replaces_event_id !== null && { replacesEventId: String(row.replaces_event_id) }),
    ...(actionPresent && { action }),
    ...(lifePresent && { lifeSources }),
  }
}

/** @param {Row} row @returns {Effect} */
export function effectFromRow(row) {
  return {
    id: String(row.id), worldId: String(row.world_id), eventId: String(row.event_id),
    targetType: /** @type {Effect['targetType']} */ (row.target_type), targetId: String(row.target_id),
    path: String(row.path), operation: /** @type {Effect['operation']} */ (row.operation),
    value: JSON.parse(String(row.value_json)), ruleVersion: Number(row.rule_version),
  }
}

/** @param {Transaction} tx @param {string} sql @param {Value[]} values */
async function changeOne(tx, sql, values) {
  need((await tx.execute(sql, values)).affectedRows === 1, 'KANATA_MESSAGE_DEPENDENT_CONFLICT')
}

/** @param {Transaction} tx @param {AsyncIterable<Row>|Iterable<Row>} affected */
export async function rebuildEventEffects(tx, affected) {
  /** @type {Map<string,Effect>} */
  const paths = new Map()
  for await (const row of affected) {
    const effect = effectFromRow(row)
    assertKanataEffectExecutable(effect)
    paths.set(JSON.stringify([effect.targetType, effect.targetId, effect.path]), effect)
  }
  /** @type {Map<string,Effect>} */
  const entities = new Map()
  for (const effect of paths.values()) {
    const { worldId, targetType, targetId, path } = effect
    const bindings = [worldId, targetType, targetId, path]
    const [baseline] = await tx.query(query.baseline, bindings)
    need(baseline, 'EVENT_BASELINE_REQUIRED')
    const effects = await gather(visitRows(tx, query.remainingEffects, bindings, ['id']), row => ({
      effect: effectFromRow(row), effectiveAt: Number(row.effective_at), recordedAt: Number(row.recorded_at),
    }))
    effects.sort((a, b) => a.effectiveAt - b.effectiveAt || a.recordedAt - b.recordedAt
      || a.effect.eventId.localeCompare(b.effect.eventId, 'en') || a.effect.id.localeCompare(b.effect.id, 'en'))
    let value = JSON.parse(String(baseline.value_json))
    for (const active of effects) value = applyKanataEffect(value, active.effect)
    await changeOne(tx, updateEffectValue[path], [value, worldId, targetId])
    entities.set(targetId, effect)
  }
  for (const entity of entities.values()) {
    await changeOne(tx, entity.targetType === 'instance' ? write.instanceRevision : write.relationshipRevision, [entity.worldId, entity.targetId])
  }
}

/** @param {Transaction} tx @param {Message} message @param {Tools} tools
 * @param {() => Promise<void>} revise
 * @param {{ decode(row:Row):Message, audit(tx:Transaction, previous:Message, next:Message, tools:Tools):Promise<void> }} messages */
export async function reviseMessageDependents(tx, message, tools, revise, messages) {
  const scope = [message.worldId, message.conversationId, message.id]
  need((await tx.query(query.uncertain, scope)).length === 0, 'EVENT_DEPENDENCY_UNCERTAIN')
  for await (const row of visitRows(tx, query.events, scope, ['id'])) {
    const previous = await eventFromRow(tx, row)
    const next = { ...previous, status: 'needsReview', revision: previous.revision + 1 }
    const id = tools.id(), at = tools.clock()
    validateId(id, 'eventAuditId')
    need(safeInteger(at), 'KANATA_MESSAGE_AUDIT_INVALID')
    await changeOne(tx, write.event, [previous.worldId, previous.id, previous.revision])
    await changeOne(tx, write.audit, [id, previous.worldId, previous.id, at, previous.revision,
      next.revision, JSON.stringify(previous), JSON.stringify(next)])
  }
  await tx.execute(write.eventMemories, scope)
  await rebuildEventEffects(tx, visitRows(tx, query.affectedEffects, scope, ['id']))
  await revise()
  for await (const row of visitRows(tx, query.replies, scope, ['id'])) {
    const previous = messages.decode(row)
    const next = { ...previous, status: /** @type {const} */ ('stopped'), revision: previous.revision + 1 }
    await changeOne(tx, messageWrites.status, [next.status, previous.worldId, previous.conversationId, previous.id, previous.revision])
    await messages.audit(tx, previous, next, tools)
  }
  await tx.execute(write.messageMemories, scope)
  await tx.execute(write.tasks, scope)
}
