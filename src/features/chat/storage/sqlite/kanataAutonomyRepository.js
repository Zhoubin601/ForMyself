// @ts-check
import { kanataActorWindowEvents, kanataAutonomyPolicy, kanataLocalTime, kanataWindowBounds, KANATA_WINDOW_MS } from '../../autonomy/kanataAutonomy.js'
import { kanataQuietTime } from '../../autonomy/kanataContact.js'
import { canUseKanataLifeSources } from '../../experience/kanataKnowledge.js'
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { selectKanataWindowActors } from './kanataWindowActors.js'
import { validateKanataAutonomy } from '../../autonomy/autonomyValidation.js'
import { createEmptyKanataData } from '../../domain/kanataCore.js'
import { cloneKanataJson, validateId } from '../../domain/kanataValidation.js'
import { instanceTable, unpackInstance } from './kanataCharacterRepository.js'
import { createKanataConversationRepository } from './kanataConversationRepository.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { commitEvent, insertEvent } from './kanataEventRepository.js'
import { saveMemory } from './kanataMemoryRepository.js'
import { visitRows } from './kanataMessageDependents.js'
import { insertMessage } from './kanataMessageRepository.js'
import { conversationAccess, grantTable, hasSourceGrants, requireSourceGrants, sourceConversation } from './kanataProvenance.js'
import { equalDto, nonemptyText, pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertWritableWorld, readWorld, worldTable } from './kanataWorldRepository.js'
import {createTaskRead,readTaskHeader,assertTaskExtensions} from './kanataTaskRead.js'
import {checkStoredTaskSources} from './kanataTaskSourceProof.js'

/** @typedef {import('../../domain/kanataTypes').BackgroundTask} Task */
/** @typedef {import('../../domain/kanataTypes').WorldEvent} Event */
/** @typedef {import('../../domain/kanataTypes').VirtualSchedule} Schedule */
/** @typedef {import('../../domain/kanataTypes').AutonomyPolicy} Policy */
/** @typedef {import('../../domain/kanataTypes').LifeGrant} Grant */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {{id:()=>string, clock:()=>number}} Tools */
/** @typedef {NonNullable<ReturnType<typeof kanataWindowBounds>> & {signature:string}} Plan */
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
const taskSourceMember = 'SELECT 1 FROM task_sources WHERE world_id=? AND task_id=? AND message_id=? AND message_revision=?'
const taskSource = 'INSERT INTO task_sources(world_id,task_id,message_id,message_revision) VALUES(?,?,?,?)'
const taskEvent = 'INSERT INTO task_result_events(world_id,task_id,event_id) VALUES(?,?,?)'
const taskMemory = 'INSERT INTO task_result_memories(world_id,task_id,memory_id) VALUES(?,?,?)'
const taskPerson = 'INSERT INTO task_social_participants(world_id,task_id,conversation_id,instance_id) VALUES(?,?,?,?)'
const claim = "UPDATE background_tasks SET state='running',attempt=attempt+1,lease_until=?,error_code=NULL WHERE world_id=? AND id=? AND state=? AND attempt=? AND lease_until=?"
const finish = 'UPDATE background_tasks SET state=?,lease_until=0,error_code=? WHERE world_id=? AND id=? AND state=\'running\' AND attempt=? AND lease_until=?'
const changeActorActivity = `UPDATE character_instances SET autonomy_enabled=?,proactive_enabled=?,revision=revision+1
  WHERE world_id=? AND id=?`
const worldActors = `SELECT id,revision,location,autonomy_enabled FROM character_instances
  WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const worldSchedules = `SELECT id,instance_id,start_minute,end_minute,location,activity,resting,revision FROM virtual_schedules
  WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const enabledCount = 'SELECT count(*) AS count FROM character_instances WHERE world_id=? AND autonomy_enabled=1'
const enabledActors = 'SELECT id FROM character_instances WHERE world_id=? AND autonomy_enabled=1 AND id>? ORDER BY id LIMIT 128'
const actorLocation = 'SELECT location FROM character_instances WHERE world_id=? AND id=? AND autonomy_enabled=1'
const activeSchedule = `SELECT s.location,s.activity,s.resting FROM virtual_schedules s JOIN virtual_schedule_days d
  ON d.world_id=s.world_id AND d.schedule_id=s.id WHERE s.world_id=? AND s.instance_id=?
  AND d.day=? AND s.start_minute<=? AND ?<s.end_minute ORDER BY s.id LIMIT 1`
const scheduleDays = 'SELECT day FROM virtual_schedule_days WHERE world_id=? AND schedule_id=? ORDER BY day'
const addDay = 'INSERT INTO virtual_schedule_days(world_id,schedule_id,day) VALUES(?,?,?)'
const clearDays = 'DELETE FROM virtual_schedule_days WHERE world_id=?'
const clearSchedules = 'DELETE FROM virtual_schedules WHERE world_id=?'
const cancelContact = "UPDATE background_tasks SET state='cancelled',lease_until=0 WHERE world_id=? AND kind='proactive' AND state IN ('pending','running')"
const advanceWatermark = `UPDATE worlds SET last_simulated_at=? WHERE id=? AND revision=? AND last_simulated_at=?
  AND autonomy_enabled=1 AND coalesce(archived,0)=0`
const busyActor = `SELECT 1 AS busy FROM character_instances i WHERE i.world_id=? AND i.id=? AND i.autonomy_enabled=1
  AND (i.energy<=0.25 OR EXISTS (SELECT 1 FROM virtual_schedules s JOIN virtual_schedule_days d
    ON d.world_id=s.world_id AND d.schedule_id=s.id WHERE s.world_id=i.world_id AND s.instance_id=i.id
    AND d.day=? AND s.start_minute<=? AND ?<s.end_minute))`
const grantsForActor = `SELECT ${grantTable.stored} FROM life_grants WHERE world_id=? AND instance_id=? ORDER BY module_id`
const grantsByWorld = `SELECT ${grantTable.stored} FROM life_grants WHERE world_id=? AND id>? ORDER BY id LIMIT 128`
const staleGrantMemories = `UPDATE memories SET status='stale',revision=revision+1 WHERE world_id=? AND status<>'deleted'
  AND id IN (SELECT memory_id FROM memory_life_sources WHERE world_id=? AND grant_id=?)`
const actorFlagsSql = `SELECT i.id,i.autonomy_enabled,i.proactive_enabled,
  CASE WHEN json_type(i.overrides_json,'$.name') IS NULL THEN json_extract(v.definition_json,'$.name')
    ELSE json_extract(i.overrides_json,'$.name') END AS name
  FROM character_instances i JOIN card_versions v ON v.card_id=i.card_id AND v.id=i.card_version_id
  WHERE i.world_id=? AND i.id>? ORDER BY i.id LIMIT ?`
const schedulesSql = `SELECT id,instance_id,start_minute,end_minute,location,activity,resting,revision
  FROM virtual_schedules WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const actorPrivateChatSql = `SELECT c.id FROM conversations c JOIN conversation_participants p
  ON p.world_id=c.world_id AND p.conversation_id=c.id
  WHERE c.world_id=? AND c.type='private' AND p.participant_id=? AND p.kind='character' LIMIT 1`
const actorNameSql = `SELECT CASE WHEN json_type(i.overrides_json,'$.name') IS NULL THEN json_extract(v.definition_json,'$.name')
    ELSE json_extract(i.overrides_json,'$.name') END AS name, i.autonomy_enabled, i.proactive_enabled
  FROM character_instances i JOIN card_versions v ON v.card_id=i.card_id AND v.id=i.card_version_id
  WHERE i.world_id=? AND i.id=?`
const contactExistsToday = `SELECT id,state,not_before FROM background_tasks
  WHERE world_id=? AND kind='proactive' AND json_extract(metadata_json,'$.contact.date')=? LIMIT 1`
const pendingContactSql = `SELECT id,state,attempt,not_before,lease_until,conversation_id,instance_id,metadata_json,notification_id
  FROM background_tasks WHERE world_id=? AND kind='proactive' AND state IN ('pending','running') AND id>? ORDER BY id LIMIT 50`
const expireContactTask = `UPDATE background_tasks SET state='cancelled',lease_until=0
  WHERE world_id=? AND id=? AND state IN ('pending','running')`
const contactRecentMsg = `SELECT 1 FROM messages WHERE world_id=? AND conversation_id=? AND coalesce(deleted,0)=0 AND created_at>=? LIMIT 1`
const contactCandidateSql = `SELECT i.id AS instance_id, c.id AS conversation_id,
    coalesce((SELECT max(m.created_at) FROM messages m WHERE m.world_id=i.world_id AND m.conversation_id=c.id), ?) AS last_at
  FROM character_instances i JOIN conversation_participants p
    ON p.world_id=i.world_id AND p.participant_id=i.id AND p.kind='character'
  JOIN conversations c ON c.world_id=p.world_id AND c.id=p.conversation_id AND c.type='private'
  WHERE i.world_id=? AND i.proactive_enabled=1 AND i.id>? ORDER BY i.id LIMIT 50`
const maxNotificationIdSql = 'SELECT coalesce(max(notification_id),909999999) AS max_id FROM background_tasks WHERE notification_id BETWEEN 910000000 AND 910999999'
const taskMetaSql = 'SELECT metadata_json FROM background_tasks WHERE world_id=? AND id=?'
const updateTaskMeta = 'UPDATE background_tasks SET metadata_json=? WHERE world_id=? AND id=?'
const latestWindowSql = `SELECT id,metadata_json FROM background_tasks
  WHERE world_id=? AND kind='world' AND state='succeeded' AND window_task_id IS NULL
  ORDER BY rowid DESC LIMIT 1`
const socialUsedDateSql = `SELECT count(*) AS count FROM background_tasks
  WHERE world_id=? AND kind='world' AND json_extract(metadata_json,'$.social.date')=?`
const socialForWindowSql = `SELECT 1 FROM background_tasks WHERE world_id=? AND kind='world' AND window_task_id=? LIMIT 1`
const socialUserMsgSql = `SELECT 1 FROM messages m JOIN conversation_participants p
  ON p.world_id=m.world_id AND p.conversation_id=m.conversation_id
  WHERE m.world_id=? AND m.role='user' AND m.created_at>=? AND (p.participant_id=? OR p.participant_id=?) LIMIT 1`
const findSocialGroupSql = `SELECT c.id,c.revision,coalesce(c.max_speakers,2) AS max_speakers FROM conversations c
  WHERE c.world_id=? AND c.type='group' AND coalesce(c.max_speakers,2)>=2
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.world_id=c.world_id AND p.conversation_id=c.id AND p.participant_id=?)
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.world_id=c.world_id AND p.conversation_id=c.id AND p.participant_id=?)
  ORDER BY c.id LIMIT 1`
const findSocialCharChatSql = `SELECT c.id FROM conversations c
  WHERE c.world_id=? AND c.type='character'
    AND (SELECT count(*) FROM conversation_participants p WHERE p.world_id=c.world_id AND p.conversation_id=c.id)=2
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.world_id=c.world_id AND p.conversation_id=c.id AND p.participant_id=?)
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.world_id=c.world_id AND p.conversation_id=c.id AND p.participant_id=?)
  ORDER BY c.id LIMIT 1`
const convTypeSql = 'SELECT type,revision,coalesce(max_speakers,2) AS max_speakers FROM conversations WHERE world_id=? AND id=?'
const convCharMembersSql = `SELECT participant_id FROM conversation_participants
  WHERE world_id=? AND conversation_id=? AND kind='character' AND participant_id>? ORDER BY participant_id LIMIT 50`
/** @param {string} table @param {string} ownerCol */
const lifeSourcePageSql = (table, ownerCol) => `SELECT grant_id,grant_revision,module_id,instance_id,fingerprint FROM ${table}
  WHERE world_id=? AND ${ownerCol}=? AND (grant_id>? OR (grant_id=? AND (grant_revision>? OR (grant_revision=? AND fingerprint>?))))
  ORDER BY grant_id,grant_revision,fingerprint LIMIT 50`
const memoryLifeSourcesSql = lifeSourcePageSql('memory_life_sources', 'memory_id')
const messageLifeSourcesSql = lifeSourcePageSql('message_life_sources', 'message_id')
const eventLifeSourcesSql = lifeSourcePageSql('event_life_sources', 'event_id')
export const autonomyQueries = [findTask, taskSourceMember, worldActors, worldSchedules, scheduleDays, policy.get, grantsByWorld, busyActor, grantsForActor, enabledCount, enabledActors, actorLocation, activeSchedule,
  actorFlagsSql, schedulesSql, actorPrivateChatSql, actorNameSql, contactExistsToday, pendingContactSql, contactRecentMsg, contactCandidateSql, maxNotificationIdSql, taskMetaSql,
  latestWindowSql, socialUsedDateSql, socialForWindowSql, socialUserMsgSql, findSocialGroupSql, findSocialCharChatSql, convTypeSql, convCharMembersSql,
  memoryLifeSourcesSql, messageLifeSourcesSql, eventLifeSourcesSql]
export const autonomyWrites = [...task.writeStatements, ...policy.writeStatements, schedule.writeStatements[0], ...grantTable.writeStatements,
  taskSource, taskEvent, taskMemory, taskPerson, claim, finish, changeActorActivity, addDay, clearDays, clearSchedules, cancelContact, advanceWatermark, staleGrantMemories,
  expireContactTask, updateTaskMeta]

/** @param {Tx} tx @param {string} sql @param {string} worldId @param {string} ownerId */
async function readOwnerLifeSources(tx, sql, worldId, ownerId) {
  /** @type {import('../../domain/kanataTypes').LifeSource[]} */
  const out = []
  let grantId = '', grantRev = 0, fp = ''
  for (;;) {
    const rows = await tx.query(sql, [worldId, ownerId, grantId, grantId, grantRev, grantRev, fp])
    for (const row of rows) {
      out.push({
        grantId: String(row.grant_id),
        revision: Number(row.grant_revision),
        moduleId: /** @type {import('../../domain/kanataTypes').LifeModule} */ (String(row.module_id)),
        instanceId: String(row.instance_id),
        fingerprint: String(row.fingerprint),
      })
    }
    if (rows.length < 50) break
    const last = rows[rows.length - 1]
    grantId = String(last.grant_id); grantRev = Number(last.grant_revision); fp = String(last.fingerprint)
  }
  return out
}

/** @param {Tx} tx @param {string} worldId @param {readonly string[]} recipients @param {boolean} group
 * @param {{memoryIds?:readonly string[],messageIds?:readonly string[],eventIds?:readonly string[]}} [lineage]
 * @param {readonly import('../../domain/kanataTypes').LifeSource[]} [explicitSources] */
async function resolveLineageSources(tx, worldId, recipients, group, lineage, explicitSources = []) {
  /** @type {Map<string, import('../../domain/kanataTypes').LifeSource>} */
  const merged = new Map()
  const add = (/** @type {import('../../domain/kanataTypes').LifeSource} */ s) => {
    merged.set(`${s.grantId}:${s.revision}:${s.moduleId}:${s.instanceId}:${s.fingerprint}`, s)
  }
  for (const s of explicitSources) add(s)
  for (const id of lineage?.memoryIds ?? []) {
    validateId(id, 'memoryId')
    for (const s of await readOwnerLifeSources(tx, memoryLifeSourcesSql, worldId, id)) add(s)
  }
  for (const id of lineage?.messageIds ?? []) {
    validateId(id, 'messageId')
    for (const s of await readOwnerLifeSources(tx, messageLifeSourcesSql, worldId, id)) add(s)
  }
  for (const id of lineage?.eventIds ?? []) {
    validateId(id, 'eventId')
    for (const s of await readOwnerLifeSources(tx, eventLifeSourcesSql, worldId, id)) add(s)
  }
  const lifeSources = [...merged.values()]
  if (!lifeSources.length) return lifeSources
  /** @type {Grant[]} */
  const lifeGrants = []
  for await (const row of visitRows(tx, grantsByWorld, [worldId], ['id'])) lifeGrants.push(grantTable.decode(row))
  for (const recipientId of recipients) {
    need(canUseKanataLifeSources({ lifeGrants }, lifeSources, { worldId, instanceId: recipientId, group }), 'LIFE_PERMISSION_REVISED')
  }
  return lifeSources
}

/** @param {Tx} tx @param {string} worldId @param {string} id */
async function readTaskFields(tx, worldId, id) {
  const fields=found(await readTaskHeader(tx,worldId,id),'KANATA_TASK_UNAVAILABLE')
  await assertTaskExtensions(tx,worldId,id)
  return fields
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

/** @param {Tx} tx @param {string} worldId @param {number} now */
async function readWindowPlan(tx, worldId, now) {
  const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  need(!world.archived, 'SIMULATION_WORLD_UNAVAILABLE')
  const currentPolicy = await policy.read(tx, [worldId])
  const bounds = kanataWindowBounds(world, kanataAutonomyPolicy({ autonomyPolicies: currentPolicy ? [currentPolicy] : [] }, worldId), now)
  if (!bounds) return null
  let signature = 'sqlite-window-v2'
  for await (const row of visitRows(tx, worldActors, [worldId], ['id'])) {
    signature = sha256Text(signature + JSON.stringify(['actor', row]))
  }
  for await (const row of visitRows(tx, worldSchedules, [worldId], ['id'])) {
    const days = await tx.query(scheduleDays, [worldId, row.id])
    signature = sha256Text(signature + JSON.stringify(['schedule', row, days]))
  }
  return { ...bounds, signature }
}

/** @param {Tx} tx @param {Plan} plan */
async function* visitWindowEvents(tx, plan) {
  const [total] = await tx.query(enabledCount, [plan.worldId])
  const count = Number(total.count)
  if (!count) return
  const offset = Math.floor(plan.start / KANATA_WINDOW_MS) % count
  const visit = async function* () {
    for await (const row of visitRows(tx, enabledActors, [plan.worldId], ['id'])) yield String(row.id)
  }
  const actors = await selectKanataWindowActors(visit, offset, count)
  const { day, minute } = kanataLocalTime(plan.end - 1, plan.timeZone)
  for (const id of actors) {
    const [actor] = await tx.query(actorLocation, [plan.worldId, id])
    const [slot] = await tx.query(activeSchedule, [plan.worldId, id, day, minute, minute])
    if (slot && actor) yield* kanataActorWindowEvents({ id, state: { location: String(actor.location) } },
      { location: String(slot.location), activity: String(slot.activity), resting: slot.resting === 1 }, plan)
  }
}
/** @param {Tx} tx @param {Pick<Task,'worldId'|'conversationId'|'instanceId'|'kind'>} task
 * @param {Iterable<Task['sourceRefs'][number]>|AsyncIterable<Task['sourceRefs'][number]>} refs */
async function checkTaskSources(tx, task, refs) {
  for await (const ref of refs) {
    const conversationId = await sourceConversation(tx, task.worldId, ref)
    need(!task.conversationId || conversationId === task.conversationId, 'KANATA_TASK_SOURCE_SCOPE')
    if (task.instanceId) {
      const access = found(await conversationAccess(tx, task.worldId, conversationId, task.instanceId), 'KANATA_TASK_SOURCE_SCOPE')
      await requireSourceGrants(tx, ref, { worldId: task.worldId, instanceId: task.instanceId, group: access.group,
        remember: task.kind === 'memory' || task.kind === 'summary' || task.kind === 'world' })
    } else need(!(await hasSourceGrants(tx, task.worldId, ref)), 'KANATA_TASK_SOURCE_SCOPE')
  }
}

/** @param {Tx} tx @param {string} worldId @param {string} id @param {Task['sourceRefs']} refs */
async function requireTaskSourceMembers(tx, worldId, id, refs) {
  for (const ref of refs) {
    need(equalDto(ref, { messageId:ref.messageId, revision:ref.revision }), 'KANATA_TASK_SOURCE_SCOPE')
    const rows = await tx.query(taskSourceMember, [worldId, id, ref.messageId, ref.revision])
    need(rows.length === 1, 'KANATA_TASK_SOURCE_SCOPE')
  }
}

/** @param {Operation} operation @param {Tools} tools */
export function createKanataAutonomyRepository(operation, tools) {
  return {
    ...createTaskRead(operation),
    /** @param {string} worldId @param {number} now */
    plan: (worldId, now) => operation.transaction(tx => readWindowPlan(tx, worldId, now)),
    /** @param {Plan} plan @param {number} now */
    completeWindow: (plan, now) => operation.transaction(async tx => {
      await assertWritableWorld(tx, plan.worldId)
      const id = await executeOnce(tx, ['window:complete', plan.worldId, plan.idempotencyKey], plan, async () => {
        const expected = await readWindowPlan(tx, plan.worldId, now)
        need(expected && equalDto(expected, plan), 'SIMULATION_PLAN_STALE')
        const [existing] = await tx.query(findTask, [plan.worldId, 'world', plan.idempotencyKey])
        need(!existing, 'KANATA_TASK_IDEMPOTENCY_CONFLICT')
        const resultEventIds = []
        for await (const fields of visitWindowEvents(tx, plan)) {
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
      return found(await readTaskHeader(tx,plan.worldId,id),'KANATA_TASK_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {number} revision
     * @param {Parameters<typeof import('../../autonomy/kanataAutonomy.js').configureKanataAutonomy>[3]} fields @param {number} now */
    configure: (worldId, revision, fields, now) => operation.transaction(async tx => {
      const { world, identity } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      need(!world.archived && world.revision === revision, 'WORLD_ACTIVITY_CONFLICT')
      kanataLocalTime(now, world.timeZone)
      need(fields.policy.worldId === worldId && fields.schedules.every(value => value.worldId === worldId), 'AUTONOMY_CONFIGURATION_SCOPE')
      need(fields.schedules.length <= 1000, 'VIRTUAL_SCHEDULE_LIMIT')
      need(new Set(fields.instanceFlags.map(flag => flag.id)).size === fields.instanceFlags.length, 'DUPLICATE_INSTANCE_FLAGS')
      const currentPolicy = await policy.read(tx, [worldId])
      const validation = createEmptyKanataData(identity.userId)
      validation.worlds.push(world)
      validation.identities.push(identity)
      const next = { ...cloneKanataJson(fields.policy), revision: (currentPolicy?.revision ?? 1) + 1 }
      validation.autonomyPolicies = [next]
      const schedules = cloneKanataJson(fields.schedules)
      validation.virtualSchedules = schedules
      for (const id of new Set(schedules.map(value => value.instanceId))) {
        const actor = found(await instanceTable.read(tx, [worldId, id]), 'VIRTUAL_SCHEDULE_SCOPE')
        validation.instances.push(unpackInstance(actor))
      }
      validateKanataAutonomy(validation)
      for (const flag of fields.instanceFlags) {
        validateId(flag.id, 'instanceId')
        need(typeof flag.autonomyEnabled === 'boolean' && typeof flag.proactiveEnabled === 'boolean', 'AUTONOMY_INSTANCE_SCOPE')
        const updated = await tx.execute(changeActorActivity, [Number(flag.autonomyEnabled), Number(flag.proactiveEnabled), worldId, flag.id])
        need(updated.affectedRows === 1, 'AUTONOMY_INSTANCE_SCOPE')
      }
      if (currentPolicy) await policy.replace(tx, next, [worldId], currentPolicy.revision)
      else await policy.create(tx, next)
      await tx.execute(clearDays, [worldId])
      await tx.execute(clearSchedules, [worldId])
      for (const value of schedules) {
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
    /** @param {Task} value */
    enqueue: value => {
      const dto = cloneKanataJson(value)
      return operation.transaction(async tx => {
      await assertWritableWorld(tx, dto.worldId)
      need(dto.kind !== 'reply' && !dto.simulationWindow && dto.state === 'pending' && dto.attempt === 0 && dto.leaseUntil === 0
        && !dto.resultEventIds.length && !dto.resultMemoryIds?.length, 'KANATA_TASK_INVALID')
      const { id: _id, ...request } = dto
      const id = await executeOnce(tx, ['task:enqueue', dto.worldId, dto.kind, dto.idempotencyKey], request, async () => {
        await checkTaskSources(tx, dto, dto.sourceRefs)
        await createTask(tx, dto)
        return dto.id
      })
      return found(await readTaskHeader(tx,dto.worldId,id),'KANATA_TASK_UNAVAILABLE')
      })
    },
    /** @param {string} worldId @param {string} id @param {number} now @param {number} leaseUntil */
    claim: (worldId, id, now, leaseUntil) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const current = await readTaskFields(tx, worldId, id)
      need(current.kind !== 'reply' && safeInteger(now) && safeInteger(leaseUntil) && leaseUntil > now && now >= current.notBefore
        && (current.state === 'pending' || current.state === 'failed' || (current.state === 'running' && current.leaseUntil <= now)), 'KANATA_TASK_LEASE_CONFLICT')
      await checkStoredTaskSources(tx,current,refs=>checkTaskSources(tx,current,refs))
      await writeOne(tx, claim, [leaseUntil, worldId, id, current.state, current.attempt, current.leaseUntil])
      return found(await readTaskHeader(tx,worldId,id),'KANATA_TASK_UNAVAILABLE')
    }),
    /** @param {string} worldId @param {string} id @param {Lease} lease
     * @param {{status:'failed',errorCode:string}|{status:'succeeded',events:Omit<Event,'id'|'status'|'revision'|'recordedAt'|'worldId'>[],
     * memories?:import('../../domain/kanataTypes').Memory[]}} result */
    finish: (worldId, id, lease, result) => {
      lease=cloneKanataJson(lease);result=cloneKanataJson(result)
      return operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      await executeOnce(tx, ['task:finish', worldId, id, String(lease.attempt)], { lease, result }, async () => {
        const current = await readTaskFields(tx, worldId, id)
        const now = tools.clock()
        need(current.kind !== 'reply' && current.state === 'running' && current.attempt === lease.attempt
          && current.leaseUntil === lease.leaseUntil && lease.leaseUntil > now, 'KANATA_TASK_LEASE_CONFLICT')
        if (result.status === 'succeeded') {
          await checkStoredTaskSources(tx,current,refs=>checkTaskSources(tx,current,refs))
          for (const fields of result.events) {
            await requireTaskSourceMembers(tx, worldId, id, fields.sourceRefs)
            const event = await insertEvent(tx, { ...fields, worldId, id: tools.id(), revision: 1, status: 'candidate', recordedAt: now })
            await commitEvent(tx, event, tools)
            await writeOne(tx, taskEvent, [worldId, id, event.id])
          }
          for (const entry of result.memories ?? []) {
            need((current.kind === 'memory' || current.kind === 'summary') && entry.worldId === worldId
              && entry.ownerType === 'character' && entry.ownerId === current.instanceId && entry.conversationId === current.conversationId
              && entry.sourceRefs.length > 0, 'KANATA_TASK_SOURCE_SCOPE')
            await requireTaskSourceMembers(tx, worldId, id, entry.sourceRefs)
            const memoryId = await saveMemory(tx, cloneKanataJson(entry), null)
            await writeOne(tx, taskMemory, [worldId, id, memoryId])
          }
        }
        await writeOne(tx, finish, [result.status, result.status === 'failed' ? result.errorCode : null, worldId, id, lease.attempt, lease.leaseUntil])
        return id
      })
      return found(await readTaskHeader(tx,worldId,id),'KANATA_TASK_UNAVAILABLE')
      })
    },
    /** @param {string} worldId @param {readonly string[]} speakers @param {number} now @param {string} timeZone */
    anySpeakerBusy: (worldId, speakers, now, timeZone) => operation.transaction(async tx => {
      need(speakers.length <= 8, 'KANATA_SPEAKER_LIMIT_INVALID')
      const { day, minute } = kanataLocalTime(now, timeZone)
      for (const actor of speakers) {
        const [row] = await tx.query(busyActor, [worldId, actor, day, minute, minute])
        if (row) return true
      }
      return false
    }),
    /** @param {string} worldId @param {string} actor */
    grantsForActor: (worldId, actor) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(actor, 'instanceId')
      return (await tx.query(grantsForActor, [worldId, actor])).map(grantTable.decode)
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
    /** @param {string} worldId */
    readConfig: worldId => operation.transaction(async tx => {
      const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      const current = await policy.read(tx, [worldId])
      return {
        world,
        policy: kanataAutonomyPolicy({ autonomyPolicies: current ? [current] : [] }, worldId),
      }
    }),
    /** @param {string} worldId @param {string} [afterId] @param {number} [limit] */
    actorFlagsPage: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (afterId) validateId(afterId, 'actorCursor')
      const rows = await tx.query(actorFlagsSql, [worldId, afterId, pageLimit(limit) + 1])
      const entries = rows.slice(0, limit).map(row => ({
        id: String(row.id), name: String(row.name),
        autonomyEnabled: row.autonomy_enabled === 1, proactiveEnabled: row.proactive_enabled === 1,
      }))
      return { entries, cursor: rows.length > limit ? entries[limit - 1].id : null }
    }),
    /** @param {string} worldId @param {string} [afterId] @param {number} [limit] */
    schedulesPage: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (afterId) validateId(afterId, 'scheduleCursor')
      const rows = await tx.query(schedulesSql, [worldId, afterId, pageLimit(limit) + 1])
      const entries = []
      for (const row of rows.slice(0, limit)) {
        const days = (await tx.query(scheduleDays, [worldId, String(row.id)])).map(d => Number(d.day))
        entries.push({
          id: String(row.id), worldId, instanceId: String(row.instance_id), days,
          startMinute: Number(row.start_minute), endMinute: Number(row.end_minute),
          location: String(row.location), activity: String(row.activity),
          resting: row.resting === 1, revision: Number(row.revision),
        })
      }
      return { entries, cursor: rows.length > limit ? entries[limit - 1].id : null }
    }),
    /** @param {string} worldId @param {string} instanceId */
    actorPrivateConversation: (worldId, instanceId) => operation.transaction(async tx => {
      validateId(worldId, 'worldId'); validateId(instanceId, 'instanceId')
      const [row] = await tx.query(actorPrivateChatSql, [worldId, instanceId])
      return row ? String(row.id) : null
    }),
    /** @param {string} worldId @param {number} now */
    expireContacts: (worldId, now) => operation.transaction(tx => expireWorldContacts(tx, worldId, now)),
    /** @param {string} worldId @param {number} now */
    planContact: (worldId, now) => operation.transaction(async tx => {
      await expireWorldContacts(tx, worldId, now)
      const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      if (world.archived || !world.proactiveEnabled) return null
      const currentPolicy = await policy.read(tx, [worldId])
      const worldSnapshot = /** @type {import('../../domain/kanataTypes').KanataData} */ ({
        ...createEmptyKanataData('contact'), worlds: [world], autonomyPolicies: currentPolicy ? [currentPolicy] : [],
      })
      if (kanataQuietTime(worldSnapshot, worldId, now)) return null
      const { date } = kanataLocalTime(now, world.timeZone)
      const [existing] = await tx.query(contactExistsToday, [worldId, date])
      if (existing) {
        return existing.state === 'pending' && Number(existing.not_before) <= now
          ? await readTaskHeader(tx, worldId, String(existing.id)) : null
      }
      const cutoff = now - 6 * 3600000
      let picked = null
      for (let after = ''; !picked;) {
        const rows = await tx.query(contactCandidateSql, [world.createdAt, worldId, after])
        picked = rows.find(row => Number(row.last_at) <= cutoff) ?? null
        if (picked || rows.length < 50) break
        after = String(rows[49].instance_id)
      }
      if (!picked) return null
      const [maxRow] = await tx.query(maxNotificationIdSql)
      const notificationId = Number(maxRow.max_id) + 1
      need(notificationId < 911000000, 'KANATA_NOTIFICATION_IDS_EXHAUSTED')
      const taskId = tools.id()
      await createTask(tx, {
        id: taskId, worldId, kind: 'proactive', state: 'pending', idempotencyKey: `contact-v1:${date}`,
        sourceRefs: [], sourceRevision: world.revision, attempt: 0, notBefore: now + 120000, leaseUntil: 0,
        conversationId: String(picked.conversation_id), instanceId: String(picked.instance_id), resultEventIds: [],
        contact: { date, expiresAt: now + 2 * 3600000, notificationId, notificationState: 'none' },
      })
      return readTaskHeader(tx, worldId, taskId)
    }),
    /** @param {string} worldId @param {string} taskId @param {number} now */
    beginContact: (worldId, taskId, now) => operation.transaction(async tx => {
      await expireWorldContacts(tx, worldId, now)
      await assertWritableWorld(tx, worldId)
      const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      const currentPolicy = await policy.read(tx, [worldId])
      const snapshot = /** @type {import('../../domain/kanataTypes').KanataData} */ ({
        ...createEmptyKanataData('contact'), worlds: [world], autonomyPolicies: currentPolicy ? [currentPolicy] : [],
      })
      const current = await readTaskFields(tx, worldId, taskId)
      const [metaRow] = await tx.query(taskMetaSql, [worldId, taskId])
      const meta = metaRow?.metadata_json ? JSON.parse(String(metaRow.metadata_json)) : {}
      need(current.kind === 'proactive' && meta.contact && current.state === 'pending'
        && current.notBefore <= now && !kanataQuietTime(snapshot, worldId, now), 'CONTACT_NOT_DUE')
      const leaseUntil = now + 90000
      await writeOne(tx, claim, [leaseUntil, worldId, taskId, current.state, current.attempt, current.leaseUntil])
      const header = found(await readTaskHeader(tx, worldId, taskId), 'KANATA_TASK_UNAVAILABLE')
      return { task: header, contact: /** @type {NonNullable<Task['contact']>} */ (meta.contact), lease: { attempt: header.attempt, leaseUntil: header.leaseUntil } }
    }),
    /** @param {string} worldId @param {string} taskId
     * @param {'none'|'dispatching'|'sent'|'denied'|'failed'} notificationState */
    setContactNotificationState: (worldId, taskId, notificationState) => operation.transaction(async tx => {
      need(['none', 'dispatching', 'sent', 'denied', 'failed'].includes(notificationState), 'INVALID_CONTACT_NOTIFICATION_STATE')
      await readTaskFields(tx, worldId, taskId)
      const [metaRow] = await tx.query(taskMetaSql, [worldId, taskId])
      const meta = metaRow?.metadata_json ? JSON.parse(String(metaRow.metadata_json)) : {}
      need(meta.contact, 'CONTACT_TASK_UNAVAILABLE')
      const next = { ...meta, contact: { ...meta.contact, notificationState } }
      await writeOne(tx, updateTaskMeta, [JSON.stringify(next), worldId, taskId])
    }),
    /** @param {string} worldId @param {string} taskId @param {Lease} lease @param {string} content
     * @param {import('../../domain/kanataTypes').LifeSource[]} lifeSources @param {number} now
     * @param {{memoryIds?:readonly string[],messageIds?:readonly string[],eventIds?:readonly string[]}} [lineage] */
    completeContact: (worldId, taskId, lease, content, lifeSources, now, lineage) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      need(typeof content === 'string' && content.trim().length > 0 && content.length <= 4000, 'INVALID_CONTACT_REPLY')
      const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      const currentPolicy = await policy.read(tx, [worldId])
      const snapshot = /** @type {import('../../domain/kanataTypes').KanataData} */ ({
        ...createEmptyKanataData('contact'), worlds: [world], autonomyPolicies: currentPolicy ? [currentPolicy] : [],
      })
      const current = await readTaskFields(tx, worldId, taskId)
      const [metaRow] = await tx.query(taskMetaSql, [worldId, taskId])
      const meta = metaRow?.metadata_json ? JSON.parse(String(metaRow.metadata_json)) : {}
      const [actor] = current.instanceId ? await tx.query(actorNameSql, [worldId, current.instanceId]) : []
      need(meta.contact && current.state === 'running' && current.attempt === lease.attempt
        && current.leaseUntil === lease.leaseUntil && current.leaseUntil > now && Number(meta.contact.expiresAt) >= now
        && world.proactiveEnabled && !world.archived && actor?.proactive_enabled === 1
        && !kanataQuietTime(snapshot, worldId, now), 'CONTACT_EXPIRED')
      const verifiedLifeSources = await resolveLineageSources(tx, worldId, [/** @type {string} */ (current.instanceId)], false, lineage, lifeSources)
      const message = /** @type {import('../../domain/kanataTypes').Message} */ ({
        id: tools.id(), worldId, conversationId: /** @type {string} */ (current.conversationId),
        role: 'assistant', senderType: 'character', senderId: /** @type {string} */ (current.instanceId),
        senderNameSnapshot: String(actor.name), content: content.trim(), createdAt: now, revision: 1,
        status: 'complete', turnId: taskId, batchId: taskId, lifeSources: cloneKanataJson(verifiedLifeSources),
      })
      await insertMessage(tx, message)
      await writeOne(tx, finish, ['succeeded', null, worldId, taskId, lease.attempt, lease.leaseUntil])
      return { message, task: found(await readTaskHeader(tx, worldId, taskId), 'KANATA_TASK_UNAVAILABLE') }
    }),
    /** @param {string} worldId @param {number} now */
    planSocial: (worldId, now) => operation.transaction(tx => readSocialPlan(tx, worldId, now)),
    /** @param {NonNullable<Awaited<ReturnType<typeof readSocialPlan>>>} plan @param {number} now */
    beginSocial: (plan, now) => operation.transaction(async tx => {
      await assertWritableWorld(tx, plan.worldId)
      const current = await readSocialPlan(tx, plan.worldId, now)
      need(current && current.signature === plan.signature, 'SOCIAL_PLAN_STALE')
      let conversationId = plan.conversationId
      if (!conversationId) {
        const [existing] = await tx.query(findSocialCharChatSql, [plan.worldId, plan.social.participantIds[0], plan.social.participantIds[1]])
        if (existing) conversationId = String(existing.id)
        else {
          const convRepo = createKanataConversationRepository({ ...operation, transaction: work => work(tx) })
          conversationId = (await convRepo.create({
            id: tools.id(), worldId: plan.worldId, type: 'character', title: '角色间交流',
            participantIds: [...plan.social.participantIds], mode: 'inherit', revision: 1, lastReadAt: 0,
          })).id
        }
      }
      const { world } = found(await readWorld(tx, plan.worldId), 'WORLD_NOT_FOUND')
      const taskId = tools.id(), leaseUntil = now + 120000
      await createTask(tx, {
        id: taskId, worldId: plan.worldId, kind: 'world', state: 'running', idempotencyKey: plan.idempotencyKey,
        sourceRefs: [], sourceRevision: world.revision, attempt: 1, notBefore: now, leaseUntil,
        conversationId, resultEventIds: [], social: cloneKanataJson(plan.social),
      })
      const header = found(await readTaskHeader(tx, plan.worldId, taskId), 'KANATA_TASK_UNAVAILABLE')
      return { task: header, lease: { attempt: header.attempt, leaseUntil: header.leaseUntil } }
    }),
    /** @param {string} worldId @param {string} taskId @param {Lease} lease
     * @param {{speakerId:string,content:string,lifeSources:import('../../domain/kanataTypes').LifeSource[],lineage?:{memoryIds?:readonly string[],messageIds?:readonly string[],eventIds?:readonly string[]}}[]} replies @param {number} now */
    completeSocial: (worldId, taskId, lease, replies, now) => operation.transaction(async tx => {
      await assertWritableWorld(tx, worldId)
      const current = await readTaskFields(tx, worldId, taskId)
      const [metaRow] = await tx.query(taskMetaSql, [worldId, taskId])
      const parsedMeta = metaRow?.metadata_json ? JSON.parse(String(metaRow.metadata_json)) : {}
      const social = found(/** @type {Task['social']} */ (parsedMeta.social), 'SOCIAL_RESULT_INVALID')
      const conversationId = found(current.conversationId, 'SOCIAL_CONVERSATION_DENIED')
      need(current.kind === 'world' && current.state === 'running'
        && current.attempt === lease.attempt && current.leaseUntil === lease.leaseUntil
        && current.leaseUntil > now && Array.isArray(replies) && replies.length === 2
        && replies.every((r, n) => r.speakerId === social.participantIds[n] && typeof r.content === 'string' && r.content.trim().length > 0 && r.content.length <= 4000),
        'SOCIAL_RESULT_INVALID')
      const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      const currentPolicy = await policy.read(tx, [worldId])
      const resolvedPolicy = kanataAutonomyPolicy({ autonomyPolicies: currentPolicy ? [currentPolicy] : [] }, worldId)
      need(world.autonomyEnabled && !world.archived && resolvedPolicy.dailyDialogueLimit > 0, 'SOCIAL_SCENE_EXPIRED')
      const { day, minute } = kanataLocalTime(social.effectiveAt - 1, world.timeZone)
      const sourceRefs = []
      const [conv] = await tx.query(convTypeSql, [worldId, conversationId])
      need(conv && (conv.type !== 'group' || Number(conv.max_speakers ?? 2) >= 2), 'SOCIAL_GROUP_LIMIT')
      const isGroup = conv.type === 'group'
      /** @type {string[]} */
      const recipients = isGroup ? [] : [...social.participantIds]
      if (isGroup) {
        for await (const row of visitRows(tx, convCharMembersSql, [worldId, conversationId], ['participant_id'])) {
          recipients.push(String(row.participant_id))
        }
      }
      for (const reply of replies) {
        const [actor] = await tx.query(actorNameSql, [worldId, reply.speakerId])
        const [loc] = await tx.query(actorLocation, [worldId, reply.speakerId])
        const [slot] = await tx.query(activeSchedule, [worldId, reply.speakerId, day, minute, minute])
        need(actor?.autonomy_enabled === 1 && loc?.location === social.location
          && slot?.location === social.location && slot?.resting === 0, 'SOCIAL_LOCATION_CHANGED')
        const verifiedLifeSources = await resolveLineageSources(tx, worldId, recipients, isGroup, reply.lineage, reply.lifeSources)
        const message = /** @type {import('../../domain/kanataTypes').Message} */ ({
          id: tools.id(), worldId, conversationId,
          role: 'assistant', senderType: 'character', senderId: reply.speakerId, senderNameSnapshot: String(actor.name),
          content: reply.content.trim(), createdAt: now, revision: 1, status: 'complete', turnId: taskId, batchId: taskId,
          lifeSources: cloneKanataJson(verifiedLifeSources),
        })
        await insertMessage(tx, message)
        sourceRefs.push({ messageId: message.id, revision: 1 })
      }
      const participantIds = isGroup ? recipients : [...social.participantIds]
      const event = await insertEvent(tx, {
        id: tools.id(), worldId, participantIds, sourceRefs, causedByEventIds: [], visibility: 'participants',
        summary: `角色在「${social.location}」进行了一场两段文字交流；完整内容见关联角色会话。`,
        effectiveAt: social.effectiveAt, recordedAt: now, revision: 1, status: 'candidate', causality: 'explicit', kind: 'note',
      })
      await commitEvent(tx, event, { ...tools, clock: () => now })
      for (const ref of sourceRefs) await writeOne(tx, taskSource, [worldId, taskId, ref.messageId, ref.revision])
      await writeOne(tx, taskEvent, [worldId, taskId, event.id])
      await writeOne(tx, finish, ['succeeded', null, worldId, taskId, lease.attempt, lease.leaseUntil])
      return { eventId: event.id, task: found(await readTaskHeader(tx, worldId, taskId), 'KANATA_TASK_UNAVAILABLE') }
    }),
    /** @param {string} worldId @param {string} taskId @param {Lease} lease @param {string} errorCode */
    failTask: (worldId, taskId, lease, errorCode) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(taskId, 'taskId')
      need(/^[A-Z0-9_]{1,64}$/.test(errorCode), 'KANATA_TASK_ERROR_CODE_INVALID')
      await tx.execute(finish, ['failed', errorCode, worldId, taskId, lease.attempt, lease.leaseUntil])
    }),
    /** @param {string} worldId @param {string} conversationId */
    conversationCharMembers: (worldId, conversationId) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(conversationId, 'conversationId')
      const members = []
      for await (const row of visitRows(tx, convCharMembersSql, [worldId, conversationId], ['participant_id'])) {
        members.push(String(row.participant_id))
      }
      return members
    }),
  }
}

/** @param {Tx} tx @param {string} worldId @param {number} now */
async function expireWorldContacts(tx, worldId, now) {
  const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  for await (const row of visitRows(tx, pendingContactSql, [worldId], ['id'])) {
    const taskId = String(row.id)
    const meta = row.metadata_json ? JSON.parse(String(row.metadata_json)) : {}
    const [actor] = row.instance_id ? await tx.query(actorNameSql, [worldId, String(row.instance_id)]) : []
    const recent = row.conversation_id
      ? (await tx.query(contactRecentMsg, [worldId, String(row.conversation_id), Number(row.not_before) - 120000])).length > 0
      : true
    if (!world.proactiveEnabled || world.archived || actor?.proactive_enabled !== 1 || recent
      || Number(meta.contact?.expiresAt ?? -1) < now
      || (row.state === 'running' && Number(row.lease_until) <= now)) {
      await tx.execute(expireContactTask, [worldId, taskId])
    }
  }
}

/** @param {Tx} tx @param {string} worldId @param {number} now */
async function readSocialPlan(tx, worldId, now) {
  const { world } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  const currentPolicy = await policy.read(tx, [worldId])
  const resolved = kanataAutonomyPolicy({ autonomyPolicies: currentPolicy ? [currentPolicy] : [] }, worldId)
  if (world.archived || !world.autonomyEnabled || resolved.dailyDialogueLimit === 0) return null
  const [windowRow] = await tx.query(latestWindowSql, [worldId])
  if (!windowRow) return null
  const windowMeta = JSON.parse(String(windowRow.metadata_json || '{}')).simulationWindow
  if (!windowMeta || windowMeta.end > now || now - windowMeta.end > 3 * 3600000) return null
  const effectiveAt = Number(windowMeta.end)
  const { date } = kanataLocalTime(effectiveAt - 1, world.timeZone)
  const [usedCount] = await tx.query(socialUsedDateSql, [worldId, date])
  if (Number(usedCount.count) >= resolved.dailyDialogueLimit) return null
  if ((await tx.query(socialForWindowSql, [worldId, String(windowRow.id)])).length > 0) return null
  const { day, minute } = kanataLocalTime(effectiveAt - 1, world.timeZone)
  const available = []
  let signature = sha256Text(JSON.stringify([world.revision, world.autonomyEnabled, resolved, String(windowRow.id)]))
  for await (const row of visitRows(tx, worldActors, [worldId], ['id'])) {
    signature = sha256Text(signature + JSON.stringify(row))
    if (row.autonomy_enabled !== 1) continue
    const [slot] = await tx.query(activeSchedule, [worldId, String(row.id), day, minute, minute])
    if (slot && slot.resting === 0 && String(row.location) === String(slot.location)) {
      available.push({ id: String(row.id), location: String(slot.location), activity: String(slot.activity) })
    }
  }
  for await (const sched of visitRows(tx, worldSchedules, [worldId], ['id'])) {
    const days = (await tx.query(scheduleDays, [worldId, String(sched.id)])).map(d => Number(d.day))
    signature = sha256Text(signature + JSON.stringify([sched, days]))
  }
  let pair = null
  for (let i = 0; i < available.length && !pair; i++) {
    for (let j = i + 1; j < available.length; j++) {
      if (available[i].location === available[j].location) {
        pair = [available[i], available[j]]
        break
      }
    }
  }
  if (!pair) return null
  const [first, other] = pair
  if ((await tx.query(socialUserMsgSql, [worldId, windowMeta.start, first.id, other.id])).length > 0) return null
  let conversationId = /** @type {string|undefined} */ (undefined)
  if (resolved.socialChannel === 'group') {
    const [group] = await tx.query(findSocialGroupSql, [worldId, first.id, other.id])
    if (!group) return null
    conversationId = String(group.id)
    signature = sha256Text(signature + JSON.stringify([group.id, group.revision, group.max_speakers]))
  }
  return {
    worldId, signature, conversationId,
    idempotencyKey: `social-v1:${String(windowRow.id)}`,
    social: {
      windowTaskId: String(windowRow.id), date, participantIds: /** @type {[string,string]} */ ([first.id, other.id]),
      location: first.location, effectiveAt,
    },
    activities: { [first.id]: first.activity, [other.id]: other.activity },
  }
}
