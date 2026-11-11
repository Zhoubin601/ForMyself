import { createKanataSqliteDomains } from '../../../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { createKanataMessageRepository } from '../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'

function check(value, code) { if (!value) throw new Error(code) }
async function rejects(action, code) {
  try { await action() }
  catch (error) { check((error.code ?? error.message) === code, 'UNEXPECTED_' + (error.code ?? error.message)); return }
  throw new Error('MISSING_' + code)
}

export const tools = { id: () => 'm3-qa-' + crypto.randomUUID(), clock: () => 1800000 }

export function runM3DeviceScenario(candidate, fixture, failCommitSql) {
  return candidate.run({}, async operation => {
    const domains = createKanataSqliteDomains(operation, tools)
    const messages = createKanataMessageRepository(operation, tools)
    const passed = []
    const instance = fixture.instances[0]
    const { worldId, conversationId } = fixture.messages[0]
    const scope = { worldId, instanceId: instance.id, conversationId }
    const other = fixture.instances.find(row => row.worldId !== worldId)
    const card = fixture.cards.find(row => row.id === instance.cardId)
    const old = fixture.cardVersions.find(row => row.id === card.currentVersionId)
    const options = { key: 'device-version', now: 1000, timeZone: 'UTC', idFactory: kind => 'm3-qa-' + kind }
    const world = await domains.worlds.create(fixture.userId, { name: '合成隔离', rules: '', displayName: '合成用户', background: '' }, options)
    const published = await domains.characters.publish(card.id, { ...old.definition, name: '合成新版' }, old.id, options)
    check(published.revision === old.revision + 1 && (await domains.characters.getInstance(worldId, instance.id)).cardVersionId === old.id
      && await domains.characters.getInstance(worldId, other.id) === null, 'WORLD_AND_CHARACTER')
    await domains.worlds.archive(world.world.id, 1, true)
    await domains.worlds.archive(world.world.id, 2, false)
    const lore = await domains.lorebook.save({ id: 'm3-qa-lore', worldId, scope: 'character', ownerId: instance.id, keys: ['合成'],
      content: '合成私有世界书', priority: 8, activationRule: 'keyword', visibility: 'private', knownBy: [instance.id], sourceTag: 'synthetic', revision: 1 }, null)
    check((await domains.lorebook.list(worldId, '', 50, instance.id)).entries.some(row => row.id === lore.id)
      && !(await domains.lorebook.list(worldId, '', 50, other.id)).entries.length, 'LORE_SCOPE')
    await domains.lorebook.delete(worldId, lore.id, lore.revision)
    passed.push('world-card-lore-scope-and-archive')
    const grant = await domains.autonomy.setGrant(worldId, instance.id, 'todo', 2, { read: true, remember: true, share: true })
    const ref = { messageId: 'm3-qa-source', revision: 1 }
    await messages.insert({ ...fixture.messages[0], id: ref.messageId, revision: 1, createdAt: 1400,
      lifeSources: [{ grantId: grant.id, revision: grant.revision, moduleId: 'todo', instanceId: instance.id, fingerprint: 'b'.repeat(64) }] })
    const memory = await domains.memories.save({ id: 'm3-qa-memory', worldId, ownerType: 'character', ownerId: instance.id, knownBy: [instance.id],
      layer: 'L3', key: '合成来源', content: '合成记忆', sourceRefs: [ref], status: 'active', visibility: 'private', revision: 1, conversationId }, null)
    await domains.memories.archiveSource(worldId, ref)
    check(!(await messages.historyForSpeaker(scope, instance.id, 20)).some(row => row.id === ref.messageId), 'ARCHIVED_CONTEXT')
    check((await domains.memories.resolveSource(scope, memory.id, ref)).archived === true, 'ARCHIVED_SOURCE')
    await rejects(() => domains.memories.resolveSource(scope, memory.id, { ...ref, revision: 2 }), 'KANATA_SOURCE_STALE')
    const peer = fixture.instances.find(row => row.worldId === worldId && row.id !== instance.id)
    const queries = []
    const traced = createKanataSqliteDomains({ ...operation, transaction: action => operation.transaction(tx => action({
      ...tx, query: (sql, parameters) => { queries.push(sql); return tx.query(sql, parameters) },
    })) }, tools)
    await rejects(() => traced.memories.share(scope, memory.id, peer.id, 'share-denied'), 'KANATA_LIFE_PERMISSION_DENIED')
    check(!queries.some(sql => sql.includes('content') || sql.includes('summary')), 'SHARE_QUERY_ORDER')
    await domains.autonomy.setGrant(worldId, instance.id, 'todo', grant.revision, { read: false, remember: false, share: false })
    queries.length = 0
    await rejects(() => traced.memories.readFor(scope, memory.id), 'KANATA_MEMORY_CONTEXT_DENIED')
    check(!queries.some(sql => sql.includes('content') || sql.includes('summary')), 'READ_QUERY_ORDER')
    passed.push('memory-archive-source-revision-and-revoke-before-content')
    const move = (location, effectiveAt) => ({ worldId, participantIds: [instance.id], sourceRefs: [], causedByEventIds: [],
      visibility: 'private', summary: '合成移动', effectiveAt, kind: 'move', action: { instanceId: instance.id, location } })
    const first = await domains.events.proposeAcknowledged(move('甲', 1600), 'first-move')
    await domains.events.commitAcknowledged(worldId, first.id, 1)
    const independent = await domains.events.proposeAcknowledged(move('乙', 1601), 'second-move')
    await domains.events.commitAcknowledged(worldId, independent.id, 1)
    await domains.events.legacy.revoke(await domains.events.legacy.preview(worldId, first.id))
    check((await domains.characters.getInstance(worldId, instance.id)).state.location === '乙', 'EFFECT_OWNERSHIP')
    passed.push('same-path-event-revoke-isolation')
    const attempt = { ...fixture.usageEvents[0], id: 'm3-qa-usage' }
    await domains.usage.record(attempt)
    check((await domains.usage.list(worldId, instance.id)).attempts.some(row => row.id === attempt.id), 'USAGE')
    const before = (await domains.worlds.get(worldId)).world
    await domains.autonomy.configure(worldId, before.revision, { policy: fixture.autonomyPolicies[0],
      instanceFlags: [{ id: instance.id, autonomyEnabled: true, proactiveEnabled: false }],
      schedules: [{ id: 'm3-qa-schedule', worldId, instanceId: instance.id, days: [1,2,3,4,5,6,7], startMinute: 0, endMinute: 1440,
        location: '合成休息处', activity: '合成休息', resting: true, revision: 1 }] }, 1000)
    await domains.autonomy.setActivity(worldId, before.revision + 1, { autonomyEnabled: true, proactiveEnabled: false, notificationsEnabled: false }, 1000)
    const plan = await domains.autonomy.plan(worldId, 1800000)
    const fault = createKanataSqliteDomains({ ...operation, transaction: action => operation.transaction(async tx => {
      const result = await action(tx)
      await tx.execute(failCommitSql, ['m3-orphan-version', 'absent-card', 1, '{}', '{}', 'synthetic'])
      return result
    }) }, tools)
    await rejects(() => fault.autonomy.completeWindow(plan, 1800000), 'KANATA_SQLITE_TRANSACTION_FAILED')
    check((await domains.worlds.get(worldId)).world.lastSimulatedAt === plan.from, 'WATERMARK_ROLLBACK')
    const completed = await domains.autonomy.completeWindow(plan, 1800000)
    check(completed.resultEventIds.length === 2 && (await domains.autonomy.completeWindow(plan, 1800000)).id === completed.id, 'WINDOW_IDEMPOTENCY')
    passed.push('task-event-usage-commit-failure-and-idempotency')
    return { passed, next: await domains.autonomy.plan(worldId, 3600000) }
  })
}
