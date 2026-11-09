// @ts-check
import { kanataAutonomyPolicy, kanataLocalTime, kanataWindowEvents, planKanataWorldWindow } from '../../autonomy/kanataAutonomy.js'
import { validateKanataAutonomy } from '../../autonomy/autonomyValidation.js'
import { createEmptyKanataData } from '../../domain/kanataCore.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { instanceTable, packInstance, unpackInstance } from './kanataCharacterRepository.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { commitEvent, insertEvent } from './kanataEventRepository.js'
import { saveMemory } from './kanataMemoryRepository.js'
import { visitRows } from './kanataMessageDependents.js'
import { conversationAccess, grantTable, requireLifeSources, sourceMetadata } from './kanataProvenance.js'
import { equalDto, nonemptyText, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld, readWorld, worldTable } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').BackgroundTask} Task */
/** @typedef {import('../../domain/kanataTypes').WorldEvent} Event */
/** @typedef {import('../../domain/kanataTypes').VirtualSchedule} Schedule */
/** @typedef {import('../../domain/kanataTypes').AutonomyPolicy} Policy */
/** @typedef {import('../../domain/kanataTypes').LifeGrant} Grant */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {{id:()=>string, clock:()=>number}} Tools */
/** @typedef {NonNullable<ReturnType<typeof planKanataWorldWindow>>} Plan */
/** @typedef {Pick<Task,'attempt'|'leaseUntil'>} Lease */
/** @typedef {Pick<Task,'simulationWindow'|'contact'|'social'|'deferredReply'>} TaskMeta */
/** @typedef {Omit<Task,'sourceRefs'|'resultEventIds'|'resultMemoryIds'> & {metadata:TaskMeta,windowTaskId?:string,notificationId?:number}} StoredTask */

const task = /** @type {ReturnType<typeof domainTable<StoredTask>>} */ (domainTable('background_tasks', {
  world_id: 'worldId', id: 'id', kind: 'kind', state: 'state', idempotency_key: 'idempotencyKey', source_revision: 'sourceRevision',
  attempt: 'attempt', not_before: 'notBefore', lease_until: 'leaseUntil', conversation_id: 'conversationId', instance_id: 'instanceId',
  error_code: 'errorCode', metadata_json: 'metadata:json', window_task_id: 'windowTaskId', notification_id: 'notificationId',
}, ['world_id', 'id'], ['simulationWindow', 'contact', 'social', 'deferredReply']))
const policy = /** @type {ReturnType<typeof domainTable<Policy>>} */ (domainTable('autonomy_policies', {
  world_id: 'worldId', revision: 'revision', daily_dialogue_limit: 'dailyDialogueLimit', max_catch_up_hours: 'maxCatchUpHours',
  freedom: 'freedom', quiet_start_minute: 'quietStartMinute', quiet_end_minute: 'quietEndMinute', social_channel: 'socialChannel',
}, ['world_id']))
const schedule = /** @type {ReturnType<typeof domainTable<Schedule>>} */ (domainTable('virtual_schedules', {
  world_id: 'worldId', id: 'id', instance_id: 'instanceId', start_minute: 'startMinute', end_minute: 'endMinute',
  location: 'location', activity: 'activity', resting: 'resting:flag', revision: 'revision',
}, ['world_id', 'id'], ['days']))
const findTask = `SELECT id FROM background_tasks WHERE world_id=? AND kind=? AND idempotency_key=?`
const listTask = `SELECT id FROM background_tasks WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const taskSources = 'SELECT message_id,message_revision FROM task_sources WHERE world_id=? AND task_id=? AND message_id>? ORDER BY message_id LIMIT 128'
const taskEvents = 'SELECT event_id FROM task_result_events WHERE world_id=? AND task_id=? AND event_id>? ORDER BY event_id LIMIT 128'
const taskMemories = 'SELECT memory_id FROM task_result_memories WHERE world_id=? AND task_id=? AND memory_id>? ORDER BY memory_id LIMIT 128'
const taskSource = 'INSERT INTO task_sources(world_id,task_id,message_id,message_revision) VALUES(?,?,?,?)'
const taskEvent = 'INSERT INTO task_result_events(world_id,task_id,event_id) VALUES(?,?,?)'
const taskMemory = 'INSERT INTO task_result_memories(world_id,task_id,memory_id) VALUES(?,?,?)'
const taskPerson = 'INSERT INTO task_social_participants(world_id,task_id,conversation_id,instance_id) VALUES(?,?,?,?)'
const claim = "UPDATE background_tasks SET state='running',attempt=attempt+1,lease_until=?,error_code=NULL WHERE world_id=? AND id=? AND state=? AND attempt=? AND lease_until=?"
const finish = 'UPDATE background_tasks SET state=?,lease_until=0,error_code=? WHERE world_id=? AND id=? AND state=\'running\' AND attempt=? AND lease_until=?'
const worldActors = `SELECT ${instanceTable.stored} FROM character_instances WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const worldSchedules = `SELECT ${schedule.stored} FROM virtual_schedules WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const scheduleDays = 'SELECT day FROM virtual_schedule_days WHERE world_id=? AND schedule_id=? ORDER BY day'
const addDay = 'INSERT INTO virtual_schedule_days(world_id,schedule_id,day) VALUES(?,?,?)'
const clearDays = 'DELETE FROM virtual_schedule_days WHERE world_id=?'
const clearSchedules = 'DELETE FROM virtual_schedules WHERE world_id=?'
const cancelContact = "UPDATE background_tasks SET state='cancelled',lease_until=0 WHERE world_id=? AND kind='proactive' AND state IN ('pending','running')"
const advanceWatermark = `UPDATE worlds SET last_simulated_at=? WHERE id=? AND revision=? AND last_simulated_at=?
  AND autonomy_enabled=1 AND coalesce(archived,0)=0`
const grantsByWorld = `SELECT ${grantTable.stored} FROM life_grants WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const staleGrantMemories = `UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=? AND status<>'deleted'
  AND id IN (SELECT memory_id FROM memory_life_sources WHERE world_id=? AND grant_id=?)`
export const autonomyQueries = [task.get, findTask, listTask, taskSources, taskEvents, taskMemories, worldActors, worldSchedules, scheduleDays, policy.get, grantsByWorld]
export const autonomyWrites = [...task.writeStatements, ...policy.writeStatements, schedule.writeStatements[0], ...grantTable.writeStatements,
  taskSource, taskEvent, taskMemory, taskPerson, claim, finish, addDay, clearDays, clearSchedules, cancelContact, advanceWatermark, staleGrantMemories]

/** @param {Tx} tx @param {string} worldId @param {string} id @returns {Promise<Task>} */
async function loadTask(tx, worldId, id) {
  const { metadata, notificationId: _notificationId, windowTaskId: _windowTaskId, ...fields } =
    found(await task.read(tx, [worldId, id]), 'KANATA_TASK_UNAVAILABLE')
  const sourceRefs = [], resultEventIds = [], resultMemoryIds = []
  for await (const row of visitRows(tx, taskSources, [worldId, id], ['message_id'])) {
    sourceRefs.push({ messageId: String(row.message_id), revision: Number(row.message_revision) })
  }
  for await (const row of visitRows(tx, taskEvents, [worldId, id], ['event_id'])) resultEventIds.push(String(row.event_id))
  for await (const row of visitRows(tx, taskMemories, [worldId, id], ['memory_id'])) resultMemoryIds.push(String(row.memory_id))
  return { ...metadata, ...fields, sourceRefs, resultEventIds, ...(resultMemoryIds.length && { resultMemoryIds }) }
}

/** @param {Tx} tx @param {Task} dto */
async function createTask(tx, dto) {
  validateId(dto.id, 'taskId')
  need(nonemptyText(dto.idempotencyKey) && dto.idempotencyKey.length <= 64000, 'KANATA_TASK_KEY_INVALID')
  const { simulationWindow, social, contact, deferredReply, sourceRefs, resultEventIds, resultMemoryIds: _memories, ...fields } = dto
  need(!deferredReply, 'KANATA_DEFERRED_USE_M2_REPOSITORY')
  const metadata = { ...(simulationWindow && { simulationWindow }), ...(social && { social }), ...(contact && { contact }) }
  await task.create(tx, { ...fields, metadata, ...(social && { windowTaskId: social.windowTaskId }), ...(contact && { notificationId: contact.notificationId }) })
  for (const ref of sourceRefs) await writeOne(tx, taskSource, [dto.worldId, dto.id, ref.messageId, ref.revision])
  for (const eventId of resultEventIds) await writeOne(tx, taskEvent, [dto.worldId, dto.id, eventId])
  for (const actor of social?.participantIds ?? []) await writeOne(tx, taskPerson, [dto.worldId, dto.id, dto.conversationId ?? null, actor])
}

/** @param {Tx} tx @param {string} worldId */
async function projection(tx, worldId) {
  const { world, identity } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  const data = createEmptyKanataData(identity.userId)
  data.worlds.push(world)
  data.identities.push(identity)
  const currentPolicy = await policy.read(tx, [worldId])
  data.autonomyPolicies = currentPolicy ? [currentPolicy] : []
  data.virtualSchedules = []
  for await (const row of visitRows(tx, worldActors, [worldId], ['id'])) data.instances.push(unpackInstance(instanceTable.decode(row)))
  for await (const row of visitRows(tx, worldSchedules, [worldId], ['id'])) {
    const value = schedule.decode(row)
    const days = await tx.query(scheduleDays, [worldId, value.id])
    data.virtualSchedules.push({ ...value, days: days.map(day => Number(day.day)) })
  }
  return { data, world, identity, currentPolicy }
}

/** @param {Tx} tx @param {Task} task */
async function checkTaskSources(tx, task) {
  for (const ref of task.sourceRefs) {
    const source = await sourceMetadata(tx, task.worldId, ref)
    need(!task.conversationId || source.conversationId === task.conversationId, 'KANATA_TASK_SOURCE_SCOPE')
    if (task.instanceId) {
      const access = found(await conversationAccess(tx, task.worldId, source.conversationId, task.instanceId), 'KANATA_TASK_SOURCE_SCOPE')
      await requireLifeSources(tx, source.sources, { worldId: task.worldId, instanceId: task.instanceId, group: access.group,
        remember: task.kind === 'memory' || task.kind === 'summary' || task.kind === 'world' })
    } else need(!source.sources.length, 'KANATA_TASK_SOURCE_SCOPE')
  }
}

/** @param {Operation} operation @param {Tools} tools */
export function createKanataAutonomyRepository(operation, tools) {
  return {
    /** @param {string} worldId @param {number} now */
    plan: (worldId, now) => operation.transaction(async tx => planKanataWorldWindow((await projection(tx, worldId)).data, worldId, now)),
    /** @param {Plan} plan @param {number} now */
    completeWindow: (plan, now) => operation.transaction(async tx => {
      await assertWritableWorld(tx, plan.worldId)
      const id = await executeOnce(tx, ['window:complete', plan.worldId, plan.idempotencyKey], plan, async () => {
        const { data } = await projection(tx, plan.worldId)
        const expected = planKanataWorldWindow(data, plan.worldId, now)
        need(expected && equalDto(expected, plan), 'SIMULATION_PLAN_STALE')
        const [existing] = await tx.query(findTask, [plan.worldId, 'world', plan.idempotencyKey])
        need(!existing, 'KANATA_TASK_IDEMPOTENCY_CONFLICT')
        const resultEventIds = []
        for (const fields of kanataWindowEvents(data, plan)) {
          const event = await insertEvent(tx, { ...fields, id: tools.id(), revision: 1, status: 'candidate', causality: 'explicit', recordedAt: now })
          await commitEvent(tx, event, { ...tools, clock: () => now })
          resultEventIds.push(event.id)
        }
        const id = tools.id()
        await createTask(tx, { id, worldId: plan.worldId, kind: 'world', state: 'succeeded', idempotencyKey: plan.idempotencyKey,
          sourceRevision: plan.worldRevision, sourceRefs: [], attempt: 1, notBefore: plan.start, leaseUntil: 0, resultEventIds,
          simulationWindow: { start: plan.start, end: plan.end, skippedMs: plan.skippedMs, timeZone: plan.timeZone } })
        await writeOne(tx, advanceWatermark, [plan.end, plan.worldId, plan.worldRevision, plan.from])
        return id
      })
      return loadTask(tx, plan.worldId, id)
    }),
    /** @param {string} worldId @param {number} revision
     * @param {Parameters<typeof import('../../autonomy/kanataAutonomy.js').configureKanataAutonomy>[3]} fields @param {number} now */
    configure: (worldId, revision, fields, now) => operation.transaction(async tx => {
      const { data, world, identity, currentPolicy } = await projection(tx, worldId)
      need(!world.archived && world.revision === revision, 'WORLD_ACTIVITY_CONFLICT')
      kanataLocalTime(now, world.timeZone)
      need(fields.policy.worldId === worldId && fields.schedules.every(value => value.worldId === worldId), 'AUTONOMY_CONFIGURATION_SCOPE')
      need(new Set(fields.instanceFlags.map(flag => flag.id)).size === fields.instanceFlags.length, 'DUPLICATE_INSTANCE_FLAGS')
      for (const flag of fields.instanceFlags) {
        const actor = found(data.instances.find(actor => actor.id === flag.id), 'AUTONOMY_INSTANCE_SCOPE')
        const next = { ...actor, autonomyEnabled: flag.autonomyEnabled, proactiveEnabled: flag.proactiveEnabled, revision: actor.revision + 1 }
        await instanceTable.replace(tx, packInstance(next), [worldId, actor.id], actor.revision)
      }
      const next = { ...cloneKanataJson(fields.policy), revision: kanataAutonomyPolicy(data, worldId).revision + 1 }
      data.autonomyPolicies = [next]
      data.virtualSchedules = cloneKanataJson(fields.schedules)
      validateKanataAutonomy(data)
      if (currentPolicy) await policy.replace(tx, next, [worldId], currentPolicy.revision)
      else await policy.create(tx, next)
      await tx.execute(clearDays, [worldId])
      await tx.execute(clearSchedules, [worldId])
      for (const value of data.virtualSchedules) {
        await schedule.create(tx, value)
        for (const day of value.days) await writeOne(tx, addDay, [worldId, value.id, day])
      }
      await worldTable.replace(tx, { ...world, identityId: identity.id, revision: revision + 1,
        lastSimulatedAt: Math.max(world.lastSimulatedAt, now) }, [worldId], revision)
    }),
    /** @param {string} worldId @param {number} revision
     * @param {Pick<import('../../domain/kanataTypes').World,'autonomyEnabled'|'proactiveEnabled'|'notificationsEnabled'>} flags @param {number} now */
    setActivity: (worldId, revision, flags, now) => operation.transaction(async tx => {
      const { world, identity } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      need(!world.archived && world.revision === revision, 'WORLD_ACTIVITY_CONFLICT')
      kanataLocalTime(now, world.timeZone)
      const lastSimulatedAt = world.autonomyEnabled !== flags.autonomyEnabled ? Math.max(world.lastSimulatedAt, now) : world.lastSimulatedAt
      await worldTable.replace(tx, { ...world, ...flags, identityId: identity.id, revision: revision + 1, lastSimulatedAt }, [worldId], revision)
      if (!flags.proactiveEnabled) await tx.execute(cancelContact, [worldId])
    }),
    /** @param {string} worldId @param {string} afterId @param {number} limit */
    listTasks: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      const rows = await tx.query(listTask, [worldId, afterId, pageLimit(limit) + 1])
      const tasks = []
      for (const row of rows.slice(0, limit)) tasks.push(await loadTask(tx, worldId, String(row.id)))
      return { tasks, cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {Task} value */
    enqueue: value => operation.transaction(async tx => {
      const dto = cloneKanataJson(value)
      await assertWritableWorld(tx, dto.worldId)
      need(dto.kind !== 'reply' && !dto.simulationWindow && dto.state === 'pending' && dto.attempt === 0 && dto.leaseUntil === 0
        && !dto.resultEventIds.length && !dto.resultMemoryIds?.length, 'KANATA_TASK_INVALID')
      const { id: _id, ...request } = dto
      const id = await executeOnce(tx, ['task:enqueue', dto.worldId, dto.kind, dto.idempotencyKey], request, async () => {
        await checkTaskSources(tx, dto)
        await createTask(tx, dto)
        return dto.id
      })
      return loadTask(tx, dto.worldId, id)
    }),
    /** @param {string} worldId @param {string} id @param {number} now @param {number} leaseUntil */
    claim: (worldId, id, now, leaseUntil) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const current = await loadTask(tx, worldId, id)
      need(current.kind !== 'reply' && safeInteger(now) && safeInteger(leaseUntil) && leaseUntil > now && now >= current.notBefore
        && (current.state === 'pending' || current.state === 'failed' || (current.state === 'running' && current.leaseUntil <= now)), 'KANATA_TASK_LEASE_CONFLICT')
      await checkTaskSources(tx, current)
      await writeOne(tx, claim, [leaseUntil, worldId, id, current.state, current.attempt, current.leaseUntil])
      return loadTask(tx, worldId, id)
    }),
    /** @param {string} worldId @param {string} id @param {Lease} lease
     * @param {{status:'failed',errorCode:string}|{status:'succeeded',events:Omit<Event,'id'|'status'|'revision'|'recordedAt'|'worldId'>[],
     * memories?:import('../../domain/kanataTypes').Memory[]}} result */
    finish: (worldId, id, lease, result) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      await executeOnce(tx, ['task:finish', worldId, id, String(lease.attempt)], { lease, result }, async () => {
        const current = await loadTask(tx, worldId, id)
        const now = tools.clock()
        need(current.kind !== 'reply' && current.state === 'running' && current.attempt === lease.attempt
          && current.leaseUntil === lease.leaseUntil && lease.leaseUntil > now, 'KANATA_TASK_LEASE_CONFLICT')
        if (result.status === 'succeeded') {
          await checkTaskSources(tx, current)
          for (const fields of result.events) {
            need(fields.sourceRefs.every(ref => current.sourceRefs.some(source => equalDto(ref, source))), 'KANATA_TASK_SOURCE_SCOPE')
            const event = await insertEvent(tx, { ...fields, worldId, id: tools.id(), revision: 1, status: 'candidate', recordedAt: now })
            await commitEvent(tx, event, tools)
            await writeOne(tx, taskEvent, [worldId, id, event.id])
          }
          for (const entry of result.memories ?? []) {
            need((current.kind === 'memory' || current.kind === 'summary') && entry.worldId === worldId
              && entry.ownerType === 'character' && entry.ownerId === current.instanceId && entry.conversationId === current.conversationId
              && entry.sourceRefs.length > 0 && entry.sourceRefs.every(ref => current.sourceRefs.some(source => equalDto(ref, source))), 'KANATA_TASK_SOURCE_SCOPE')
            const memoryId = await saveMemory(tx, cloneKanataJson(entry), null)
            await writeOne(tx, taskMemory, [worldId, id, memoryId])
          }
        }
        await writeOne(tx, finish, [result.status, result.status === 'failed' ? result.errorCode : null, worldId, id, lease.attempt, lease.leaseUntil])
        return id
      })
      return loadTask(tx, worldId, id)
    }),
    /** @param {string} worldId @param {string} actor @param {Grant['moduleId']} moduleId
     * @param {number|null} revision @param {Pick<Grant,'read'|'remember'|'share'>} flags */
    setGrant: (worldId, actor, moduleId, revision, flags) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const keys = [worldId, actor, moduleId]
      const previous = await grantTable.read(tx, keys)
      if (previous?.revision === revision && previous.read === flags.read && previous.remember === flags.remember && previous.share === flags.share) {
        return previous
      }
      const id = await executeOnce(tx, ['grant:set', ...keys, String(revision)], flags, async () => {
        need(previous ? previous.revision === revision : revision === null, 'KANATA_GRANT_CONFLICT')
        const grant = { ...flags, id: previous?.id ?? tools.id(), worldId, instanceId: actor, moduleId, revision: (previous?.revision ?? 0) + 1 }
        if (previous) {
          await grantTable.replace(tx, grant, keys, previous.revision)
          await tx.execute(staleGrantMemories, [worldId, worldId, previous.id])
        } else await grantTable.create(tx, grant)
        return grant.id
      })
      const current = await grantTable.read(tx, keys)
      need(current?.id === id, 'KANATA_GRANT_CONFLICT')
      return found(current, 'KANATA_GRANT_CONFLICT')
    }),
    /** @param {string} worldId */
    grants: worldId => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      const grants = []
      for await (const row of visitRows(tx, grantsByWorld, [worldId], ['id'])) grants.push(grantTable.decode(row))
      return grants
    }),
    /** @param {string} worldId @param {string} actor @param {Grant['moduleId']} moduleId */
    getGrant: (worldId, actor, moduleId) => operation.transaction(tx => grantTable.read(tx, [worldId, actor, moduleId])),
  }
}
