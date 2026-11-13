// @ts-check
import { applyKanataEffect, assertKanataEffectExecutable } from '../../experience/kanataEvents.js'
import { validateId } from '../../domain/kanataValidation.js'
import { dependentQueries as query, dependentWrites as write, updateEffectValue } from './kanataMessageDependentsSql.js'
import { eventAuditSupport, writeEventStatusAudit } from './kanataEventSnapshot.js'
import { messageWrites } from './kanataRepositorySql.js'
import { requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertDomainArrayOrder } from './kanataArrayOrder.js'

/** @typedef {import('../../domain/kanataTypes').Message} Message */
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

/** @param {Transaction} tx @param {Effect} effect */
async function replayEffectPath(tx, { worldId, targetType, targetId, path }) {
  const bindings = [worldId, targetType, targetId, path]
  const [baseline] = await tx.query(query.baseline, bindings)
  need(baseline, 'EVENT_BASELINE_REQUIRED')
  let value = JSON.parse(String(baseline.value_json))
  /** @type {Value[]} */
  let cursor = [-1,-1,'','','','']
  for (;;) {
    const rows = await tx.query(query.remainingEffects, [...cursor, ...bindings])
    for (const row of rows) value = applyKanataEffect(value, effectFromRow(row))
    if (rows.length < 128) break
    const last = rows[rows.length - 1]
    cursor = [last.effective_at,last.recorded_at,last.event_key,last.event_id,last.effect_key,last.id]
  }
  await changeOne(tx, updateEffectValue[path], [value, worldId, targetId])
}

/** Group by the catalog's target/path keyset. Retain at most one affected page
 * and one replay page; update a target revision only once for all its paths.
 * @param {Transaction} tx @param {string} sql @param {Value[]} bindings */
export async function rebuildEventEffects(tx, sql, bindings) {
  await assertDomainArrayOrder(tx,String(bindings[0]))
  /** @type {Effect|undefined} */
  let previous
  /** @param {Effect} effect */
  const finish = effect => changeOne(tx, effect.targetType === 'instance' ? write.instanceRevision : write.relationshipRevision,
    [effect.worldId, effect.targetId])
  for await (const row of visitRows(tx, sql, bindings, ['target_type','target_id','path','id'])) {
    const effect = effectFromRow(row)
    assertKanataEffectExecutable(effect)
    const sameTarget = previous && previous.worldId === effect.worldId &&
      previous.targetType === effect.targetType && previous.targetId === effect.targetId
    if (!sameTarget && previous) await finish(previous)
    if (!sameTarget || previous?.path !== effect.path) await replayEffectPath(tx, effect)
    previous = effect
  }
  if (previous) await finish(previous)
}

/** @param {Transaction} tx @param {Message} message @param {Tools} tools
 * @param {() => Promise<void>} revise
 * @param {{ decode(row:Row):Message, audit(tx:Transaction, previous:Message, next:Message, tools:Tools):Promise<void> }} messages */
export async function reviseMessageDependents(tx, message, tools, revise, messages) {
  await assertDomainArrayOrder(tx,message.worldId)
  const scope = [message.worldId, message.conversationId, message.id]
  need((await tx.query(query.uncertain, scope)).length === 0, 'EVENT_DEPENDENCY_UNCERTAIN')
  for await (const row of visitRows(tx, query.events, scope, ['id'], 50)) {
    const key = [row.world_id,row.id], revision = Number(row.revision)
    const [audit] = await tx.query(eventAuditSupport,[...key,revision])
    need(audit && Number(audit.supported)>=0,'KANATA_SQLITE_INTEGRITY_FAILED')
    const id = tools.id(), at = tools.clock()
    validateId(id, 'eventAuditId')
    need(safeInteger(at), 'KANATA_MESSAGE_AUDIT_INVALID')
    await changeOne(tx, write.event, [...key,revision])
    await changeOne(tx,writeEventStatusAudit,[id,at,row.status,...key,revision+1])
  }
  await tx.execute(write.eventMemories, scope)
  await rebuildEventEffects(tx, query.affectedEffects, scope)
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
