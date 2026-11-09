import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { KANATA_SCHEMA_MIGRATIONS } from '../src/features/chat/storage/sqlite/kanataSchema.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSchemaAdapter } from '../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { sha256Text } from '../src/shared/crypto/sha256Text.js'
import { createKanataSqliteDomains } from '../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { createKanataSqliteWorldRuntime } from '../src/application/kanataSqliteWorldRuntime.js'
import { createKanataMessageRepository } from '../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { installLegacySchema } from './helpers/kanataSqliteLegacy.js'
import { schemaHarness } from './helpers/kanataSqliteHarness.js'
import { m2Fixture, m2FixtureCommands } from './helpers/kanataSqliteM2Fixture.js'

async function setup(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  t.after(() => db.close())
  const state = { queries: [], failOn: '', failCommit: false, now: 1800000 }
  let tail = Promise.resolve()
  const operation = {
    transaction(run) {
      const result = tail.then(() => transact(run))
      tail = result.catch(() => {})
      return result
    },
  }
  async function transact(run) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await run({
          async query(sql, parameters = []) {
            state.queries.push(sql)
            return db.prepare(sql).all(...parameters)
          },
          async execute(sql, parameters = []) {
            if (state.failOn && sql.startsWith(state.failOn)) throw new Error('injected statement failure')
            return { affectedRows: Number(db.prepare(sql).run(...parameters).changes) }
          },
        })
        if (state.failCommit) throw new Error('injected commit failure')
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
  }
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture = m2Fixture()
  await operation.transaction(async tx => {
    for (const { sql, parameters } of m2FixtureCommands(fixture)) await tx.execute(sql, parameters)
  })
  let sequence = 0
  const tools = { clock: () => state.now, id: () => 'm3-' + String(++sequence).padStart(4, '0') }
  const domains = createKanataSqliteDomains(operation, tools)
  const messages = createKanataMessageRepository(operation, tools)
  const instance = fixture.instances[0], other = fixture.instances.find(actor => actor.worldId !== instance.worldId)
  const conversation = fixture.conversations[0]
  const scope = { worldId: instance.worldId, instanceId: instance.id, conversationId: conversation.id }
  const move = location => ({ worldId: scope.worldId, participantIds: [instance.id], sourceRefs: [], causedByEventIds: [],
    visibility: 'private', summary: '合成移动', effectiveAt: 1500, kind: 'move', action: { instanceId: instance.id, location } })
  return { db, state, fixture, domains, messages, instance, other, scope, move }
}

test('M3 only appends to the frozen 001–003 catalog', () => {
  const frozen = JSON.parse(readFileSync(new URL('../docs/qa/kanata-sqlite-m2/evidence/schema-fingerprints.json', import.meta.url)))
  assert.deepEqual(KANATA_SCHEMA_MIGRATIONS.slice(0, 3).map(m => sha256Text(JSON.stringify([m.version, m.name, m.statements]))),
    frozen.migrations.map(m => m.checksum))
  assert.equal(KANATA_SCHEMA_MIGRATIONS.at(-1).version, 4)
})

test('M3 upgrades a populated v3 and preserves historical application times', async t => {
  const h = schemaHarness()
  t.after(h.close)
  await installLegacySchema(h, 3, m2FixtureCommands())
  const messages = h.db.prepare('SELECT * FROM messages ORDER BY id')
  const before = messages.all()
  assert.deepEqual(await migrateKanataSchema(h.connection, { now: () => 1100 }), { version: 4, appliedVersions: [4] })
  assert.deepEqual(messages.all(), before)
  assert.deepEqual(h.db.prepare('SELECT applied_at FROM schema_migration_applications ORDER BY version').all().map(row => row.applied_at),
    [null, null, 1000, 1100])
})

test('M3 world and identity creation are atomic, idempotent and reversibly archived', async t => {
  const { domains, state, fixture } = await setup(t)
  const options = { key: 'world-command', now: 1000, timeZone: 'UTC', idFactory: kind => 'new-' + kind }
  const fields = { name: '合成世界', rules: '', displayName: '合成用户', background: '' }
  state.failOn = 'INSERT INTO world_identities'
  await assert.rejects(domains.worlds.create(fixture.userId, fields, options), /injected/)
  assert.equal(await domains.worlds.get('new-world'), null)
  state.failOn = ''
  const { world, identity } = await domains.worlds.create(fixture.userId, fields, options)
  assert.equal((await domains.worlds.create(fixture.userId, fields, options)).identity.id, identity.id)
  await assert.rejects(domains.worlds.create(fixture.userId, { ...fields, name: '其他' }, options), /IDEMPOTENCY_CONFLICT/)
  assert.equal((await domains.worlds.list()).worlds.at(-1).id, world.id)
  await domains.worlds.archive(world.id, 1, true)
  await assert.rejects(domains.worlds.updateIdentity(world.id, 1, fields), /WORLD_ARCHIVED/)
  await domains.worlds.archive(world.id, 2, false)
  assert.equal((await domains.worlds.get(world.id)).world.autonomyEnabled, false)
  const competing = await Promise.allSettled(['甲', '乙'].map(name => domains.worlds.rename(world.id, 3, name)))
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(competing.find(result => result.status === 'rejected').reason.code, 'KANATA_WORLD_REVISION_CONFLICT')
})

test('M3 character version publication is immutable and instance scope stays isolated', async t => {
  const { domains, fixture, scope, other } = await setup(t)
  const card = fixture.cards[0], oldVersion = fixture.cardVersions.find(version => version.id === card.currentVersionId)
  const options = { key: 'publish-card', now: 1000, timeZone: 'UTC', idFactory: () => 'new-version' }
  const next = await domains.characters.publish(card.id, { ...oldVersion.definition, name: '合成新版' }, oldVersion.id, options)
  assert.equal(next.revision, oldVersion.revision + 1)
  assert.equal((await domains.characters.versions(card.id)).versions[0].definition.name, oldVersion.definition.name)
  assert.equal((await domains.characters.getInstance(scope.worldId, scope.instanceId)).cardVersionId, oldVersion.id)
  assert.equal(await domains.characters.getInstance(scope.worldId, other.id), null)
  const created = await domains.characters.addInstance(scope.worldId, card.id, { ...options, key: 'add', idFactory: kind => 'new-' + kind })
  assert.equal(created.cardVersionId, next.id)
})

test('M3 lore visibility is checked before projection and associations roll back', async t => {
  const { domains, scope, other } = await setup(t)
  const entry = { id: 'm3-lore', worldId: scope.worldId, scope: 'character', ownerId: scope.instanceId,
    keys: ['合成'], content: '私有条目', priority: 8, activationRule: 'keyword', visibility: 'private', knownBy: [scope.instanceId],
    sourceTag: 'synthetic', revision: 1, enabled: true }
  await assert.rejects(domains.lorebook.save({ ...entry, knownBy: [other.id] }, null), /FOREIGN KEY/)
  const saved = await domains.lorebook.save(entry, null)
  assert.deepEqual(saved.knownBy, [scope.instanceId])
  assert.equal((await domains.lorebook.list(scope.worldId, '', 50, other.id)).entries.length, 0)
  await domains.lorebook.delete(scope.worldId, entry.id, saved.revision)
  assert.equal((await domains.lorebook.list(scope.worldId)).entries.some(row => row.id === entry.id), false)
})

test('M3 remember, read and share reject before sensitive queries and archived source requires exact revision', async t => {
  const { domains, fixture, messages, state, scope, db } = await setup(t)
  const peer = fixture.instances.find(actor => actor.worldId === scope.worldId && actor.id !== scope.instanceId)
  const grant = await domains.autonomy.setGrant(scope.worldId, scope.instanceId, 'todo', 2, { read: true, remember: true, share: false })
  await domains.autonomy.setGrant(scope.worldId, peer.id, 'todo', null, { read: true, remember: true, share: false })
  const ref = { messageId: 'memory-message', revision: 1 }
  await messages.insert({ ...fixture.messages[0], id: ref.messageId, revision: 1,
    lifeSources: [{ grantId: grant.id, revision: grant.revision, moduleId: 'todo', instanceId: scope.instanceId, fingerprint: 'b'.repeat(64) }] })
  const memory = { id: 'm3-memory', worldId: scope.worldId, ownerType: 'character', ownerId: scope.instanceId,
    layer: 'L3', key: '合成记忆', content: '可核对来源', sourceRefs: [ref], status: 'active', revision: 1,
    visibility: 'private', knownBy: [scope.instanceId], conversationId: scope.conversationId }
  await domains.memories.save(memory, null)
  await domains.memories.archiveSource(scope.worldId, ref)
  assert.equal((await messages.historyForSpeaker(scope, scope.instanceId, 10)).some(message => message.id === ref.messageId), false)
  assert.equal((await messages.locate(scope, ref.messageId)).messages[0].id, ref.messageId)
  assert.deepEqual(await domains.memories.resolveSource(scope, memory.id, ref),
    { ...ref, content: fixture.messages[0].content, conversationId: scope.conversationId, archived: true })
  const noBodies = () => assert(!state.queries.some(sql => /(?:SELECT\s+\*|SELECT.*(?:content|summary))\s+FROM\s+(?:memories|messages|world_events)\b/i.test(sql)), state.queries.join('\n'))
  state.queries.length = 0
  await assert.rejects(domains.memories.share(scope, memory.id, peer.id, 'try-share'), /LIFE_PERMISSION_DENIED/)
  noBodies()
  state.queries.length = 0
  // Replace an active grant with a denied grant without mutating derived memory state,
  // proving the authorization checks the current grant independently of the stale flag.
  db.prepare('UPDATE life_grants SET can_remember=0 WHERE id=?').run(grant.id)
  await assert.rejects(domains.memories.readFor(scope, memory.id), /LIFE_PERMISSION_DENIED/)
  noBodies()
  state.queries.length = 0
  db.prepare('UPDATE life_grants SET can_read=0,can_remember=1 WHERE id=?').run(grant.id)
  await assert.rejects(domains.memories.readFor(scope, memory.id), /LIFE_PERMISSION_DENIED/)
  noBodies()
  await domains.autonomy.setGrant(scope.worldId, scope.instanceId, 'todo', grant.revision, { read: false, remember: false, share: false })
  state.queries.length = 0
  await assert.rejects(domains.memories.resolveSource(scope, memory.id, ref), /MEMORY_CONTEXT_DENIED/)
  noBodies()
  state.queries.length = 0
  await assert.rejects(domains.memories.save({ ...memory, id: 'invalid-source', sourceRefs: [{ ...ref, revision: 2 }] }, null), /SOURCE_STALE/)
  noBodies()
})

test('M3 revoke retains independent same-path effects and atomically changes causal descendants', async t => {
  const { domains, state, scope, move } = await setup(t)
  const a = await domains.events.propose(move('位置甲'), 'a')
  const b = await domains.events.propose(move('位置乙'), 'b')
  const c = await domains.events.propose({ ...move('位置丙'), causedByEventIds: [a.id] }, 'c')
  for (const event of [a, b, c]) await domains.events.commit(scope.worldId, event.id, 1)
  assert.equal((await domains.characters.getInstance(scope.worldId, scope.instanceId)).state.location, '位置丙')
  const plan = await domains.events.preview(scope.worldId, a.id)
  assert.deepEqual(plan.revokeIds, [a.id, c.id])
  state.failOn = 'UPDATE character_instances SET location'
  await assert.rejects(domains.events.revoke(plan), /injected/)
  assert.equal((await domains.events.readFor(scope.worldId, a.id, { instanceId: scope.instanceId, group: false })).status, 'committed')
  state.failOn = ''
  await domains.events.revoke(plan)
  await domains.events.revoke(plan)
  assert.equal((await domains.characters.getInstance(scope.worldId, scope.instanceId)).state.location, '位置乙')
  assert.equal((await domains.events.readFor(scope.worldId, b.id, { instanceId: scope.instanceId, group: false })).status, 'committed')
})

test('M3 window writes event, effects, task and watermark atomically, including failed COMMIT', async t => {
  const { domains, state, fixture, scope, db } = await setup(t)
  const { world } = await domains.worlds.get(scope.worldId)
  const policy = fixture.autonomyPolicies[0]
  await domains.autonomy.configure(scope.worldId, world.revision, { policy,
    instanceFlags: [{ id: scope.instanceId, autonomyEnabled: true, proactiveEnabled: false }],
    schedules: [{ id: 'm3-schedule', worldId: scope.worldId, instanceId: scope.instanceId, days: [1, 2, 3, 4, 5, 6, 7],
      startMinute: 0, endMinute: 1440, location: '合成休息处', activity: '休息', resting: true, revision: 1 }] }, 1000)
  await domains.autonomy.setActivity(scope.worldId, world.revision + 1, { autonomyEnabled: true, proactiveEnabled: false, notificationsEnabled: false }, 1000)
  const plan = await domains.autonomy.plan(scope.worldId, state.now)
  const counts = () => ['world_events', 'world_effects', 'event_audits', 'background_tasks'].map(table => db.prepare(`SELECT count(*) AS total FROM ${table}`).get().total)
  const before = counts()
  state.failCommit = true
  await assert.rejects(domains.autonomy.completeWindow(plan, state.now), /injected commit/)
  state.failCommit = false
  assert.deepEqual(counts(), before)
  assert.equal((await domains.worlds.get(scope.worldId)).world.lastSimulatedAt, 1000)
  const done = await domains.autonomy.completeWindow(plan, state.now)
  assert.equal(done.resultEventIds.length, 2)
  assert.equal((await domains.autonomy.completeWindow(plan, state.now)).id, done.id)
  assert.equal((await domains.worlds.get(scope.worldId)).world.lastSimulatedAt, plan.end)
  assert.equal(counts()[0], before[0] + 2)
})

test('M3 old world owner rejects late data and never sends a new command', async t => {
  const { domains, fixture } = await setup(t)
  let resolveRead, started
  const wait = new Promise(resolve => { resolveRead = resolve })
  const inFlight = new Promise(resolve => { started = resolve })
  let entered = 0
  const runtime = createKanataSqliteWorldRuntime({ candidate: { async withDomains(options, action) {
    options.assertOwner()
    entered++
    const result = await action(domains)
    started()
    await wait
    return result
  } } })
  const first = runtime.select(fixture.worlds[0].id)
  const old = first.read()
  await inFlight
  const second = runtime.select(fixture.worlds[1].id)
  resolveRead()
  await assert.rejects(old, /WORLD_OWNER_EXPIRED/)
  await assert.rejects(first.rename('过期写入', 1), /WORLD_OWNER_EXPIRED/)
  assert.equal(entered, 1)
  assert.equal((await second.read()).world.id, fixture.worlds[1].id)
  runtime.dispose()
  await assert.rejects(second.read(), /WORLD_OWNER_EXPIRED/)
})

test('M3 a derived reply cannot launder an unrememberable source and deletion redacts the body', async t => {
  const { domains, fixture, messages, scope, state, db } = await setup(t)
  const grant = await domains.autonomy.setGrant(scope.worldId, scope.instanceId, 'todo', 2, { read: true, remember: false, share: true })
  const original = { ...fixture.messages[0], id: 'privacy-parent', revision: 1,
    lifeSources: [{ grantId: grant.id, revision: grant.revision, moduleId: 'todo', instanceId: scope.instanceId, fingerprint: 'c'.repeat(64) }] }
  await messages.insert(original)
  await messages.insert({ ...fixture.messages[1], id: 'privacy-child', revision: 1, replyToMessageId: original.id, replyToRevision: 1, lifeSources: [] })
  const memory = { id: 'privacy-memory', worldId: scope.worldId, ownerType: 'character', ownerId: scope.instanceId,
    layer: 'L3', key: '合成主题', content: '需要脱敏的合成正文', sourceRefs: [], status: 'active', revision: 1, visibility: 'private' }
  state.queries.length = 0
  await assert.rejects(domains.memories.save({ ...memory, sourceRefs: [{ messageId: 'privacy-child', revision: 1 }] }, null), /LIFE_PERMISSION_DENIED/)
  assert(!state.queries.some(sql => sql.includes('content') || sql.includes('summary')))
  await domains.memories.save(memory, null)
  await domains.memories.save({ ...memory, status: 'deleted' }, 1)
  const stored = db.prepare('SELECT content,status,revision FROM memories WHERE id=?').get(memory.id)
  assert.deepEqual({ ...stored }, { content: '（已删除的记忆内容）', status: 'deleted', revision: 2 })
})

test('M3 private event context reads neither its summary nor another actor’s effects', async t => {
  const { domains, fixture, scope, move, state } = await setup(t)
  const outsider = fixture.instances.find(actor => actor.worldId === scope.worldId && actor.id !== scope.instanceId)
  const event = await domains.events.propose(move('私有活动'), 'private-effect')
  await domains.events.commit(scope.worldId, event.id, 1)
  state.queries.length = 0
  const projected = await domains.events.context(scope.worldId, { instanceId: outsider.id, group: false }, [scope.instanceId])
  assert(projected.hiddenTargetIds.has(scope.instanceId))
  assert.equal(projected.events.some(row => row.id === event.id), false)
  assert(!state.queries.some(sql => /^SELECT (?:\*|.*summary) FROM world_events/.test(sql)))
  state.queries.length = 0
  await domains.characters.conversationActors(scope.worldId, [scope.instanceId], projected.hiddenTargetIds)
  assert(!state.queries.some(sql => /SELECT.*\bmood\b/.test(sql)))
  const audit = await domains.events.audits(scope.worldId, event.id)
  assert.deepEqual(audit.audits.map(item => [item.previous.status, item.next.status]), [['candidate', 'committed']])
})

test('M3 expired lease cannot complete and duplicate task completion writes one event', async t => {
  const { domains, state, scope, move } = await setup(t)
  const pending = { id: 'm3-task', worldId: scope.worldId, kind: 'world', state: 'pending', sourceRefs: [],
    sourceRevision: 1, attempt: 0, notBefore: 1000, leaseUntil: 0, idempotencyKey: 'candidate-task', resultEventIds: [] }
  assert.equal((await domains.autonomy.enqueue(pending)).id, (await domains.autonomy.enqueue({ ...pending, id: 'discarded-id' })).id)
  const one = await domains.autonomy.claim(scope.worldId, pending.id, state.now, state.now + 10)
  state.now += 11
  const two = await domains.autonomy.claim(scope.worldId, pending.id, state.now, state.now + 10)
  const { worldId: _worldId, ...fields } = move('任务位置')
  const result = { status: 'succeeded', events: [fields] }
  await assert.rejects(domains.autonomy.finish(scope.worldId, pending.id, one, result), /TASK_LEASE_CONFLICT/)
  const lease = { attempt: two.attempt, leaseUntil: two.leaseUntil }
  const committed = await domains.autonomy.finish(scope.worldId, pending.id, lease, result)
  assert.equal(committed.resultEventIds.length, 1)
  assert.deepEqual((await domains.autonomy.finish(scope.worldId, pending.id, lease, result)).resultEventIds, committed.resultEventIds)
})

test('M3 usage attempt preserves null measurement and final usage is idempotent', async t => {
  const { domains, fixture, scope } = await setup(t)
  const started = { ...fixture.usageEvents[0], id: 'm3-usage', status: 'pending', finishedAt: null, usage: null }
  await domains.usage.record(started)
  const done = { ...started, status: 'succeeded', finishedAt: 1300, usage: { promptTokens: 7, completionTokens: 3, cacheHitTokens: null } }
  await domains.usage.record(done)
  assert.deepEqual(await domains.usage.record(done), done)
  assert.deepEqual((await domains.usage.list(scope.worldId, scope.instanceId)).attempts.find(value => value.id === done.id), done)
  await assert.rejects(domains.usage.record({ ...done, finishedAt: 1400 }), /USAGE_ALREADY_FINAL/)
})

test('C2 source chain is checked in bounded SQL pages and rejects a historical reply cycle', async t => {
  const { db, state, scope } = await setup(t)
  const { sourceMetadata } = await import('../src/features/chat/storage/sqlite/kanataProvenance.js')
  const trace = []
  const tx = { query: async (sql, args) => {
    const rows = db.prepare(sql).all(...args)
    trace.push({ sql, rows: rows.length })
    return rows
  } }
  const add = db.prepare(`INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
    content,created_at,revision,status,turn_id,batch_id,reply_to_message_id,reply_to_revision)
    SELECT ?,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
    'synthetic',?,1,'complete',turn_id,batch_id,?,? FROM messages WHERE id='message-one'`)
  let parent = 'message-one', revision = 2
  for (const size of [1000, 10000]) {
    db.exec('BEGIN')
    for (let n = size === 1000 ? 0 : 1000; n < size; n++) {
      const id = 'c2-msg-' + n
      add.run(id, 3000 + n, parent, revision)
      parent = id
      revision = 1
    }
    db.exec('COMMIT')
    trace.length = 0
    const result = await sourceMetadata(tx, scope.worldId, { messageId: parent, revision })
    assert.equal(result.conversationId, scope.conversationId)
    assert.ok(trace.length <= 3)
    assert.ok(trace.every(query => query.rows <= 51 && !/SELECT\s+\*|\bm\.content\b/.test(query.sql)))
    t.diagnostic(JSON.stringify({ size, queries: trace.length, rows: Math.max(...trace.map(query => query.rows)) }))
  }
  db.prepare("UPDATE messages SET reply_to_message_id=?,reply_to_revision=1 WHERE id='c2-msg-0'").run(parent)
  await assert.rejects(sourceMetadata(tx, scope.worldId, { messageId: parent, revision }), /KANATA_SOURCE_STALE/)
  assert.equal(state.failOn, '')
})

test('C2 shared memory authorization handles 1k and 10k links without fetching parent bodies', async t => {
  const { db, state, scope, domains } = await setup(t)
  const addMemory = db.prepare(`INSERT INTO memories(id,world_id,owner_type,owner_id,owner_instance_id,layer,memory_key,content,status,revision,visibility)
    VALUES(?,?,'character',?,?,'L3','synthetic','synthetic','active',1,'private')`)
  const link = db.prepare("INSERT INTO memory_links(world_id,memory_id,kind,target_memory_id) VALUES(?,?,'shared',?)")
  for (const size of [1000, 10000]) {
    const prefix = 'c2-memory-' + size + '-'
    db.exec('BEGIN')
    for (let n = 0; n <= size; n++) addMemory.run(prefix + n, scope.worldId, scope.instanceId, scope.instanceId)
    for (let n = 0; n < size; n++) link.run(scope.worldId, prefix + n, prefix + (n + 1))
    db.exec('COMMIT')
    state.queries.length = 0
    const item = await domains.memories.readFor(scope, prefix + '0')
    assert.equal(item.id, prefix + '0')
    assert.equal(state.queries.filter(sql => /^SELECT .*\bcontent\b.*FROM memories/i.test(sql)).length, 1)
    assert.ok(state.queries.length < 20)
    t.diagnostic(JSON.stringify({ sharedLinks: size, queries: state.queries.length, bodies: 1 }))
    db.prepare("UPDATE memories SET status='stale',revision=revision+1 WHERE id=?").run(prefix + size)
    state.queries.length = 0
    await assert.rejects(domains.memories.readFor(scope, prefix + '0'), /MEMORY_CONTEXT_DENIED/)
    assert.ok(!state.queries.some(sql => /^SELECT .*\bcontent\b.*FROM memories/i.test(sql)))
  }
})

test('C3 new group receipts preserve ordered members and reject a cross-world actor', async t => {
  const { domains, scope, fixture, other } = await setup(t)
  const actors = fixture.instances.filter(row => row.worldId === scope.worldId).slice(0,2).map(row=>row.id).reverse()
  const fields = { title: '合成群聊', instanceIds: actors }
  const command = { id:'c3-group', commandId:'c3-create' }
  const { id } = await domains.conversations.createGroup(scope.worldId, fields, command)
  assert.deepEqual(await domains.conversations.createGroup(scope.worldId, fields, command), { id })
  const row = await domains.conversations.get({ ...scope, conversationId:id })
  assert.deepEqual(row.participantIds.slice(1), actors)
  await assert.rejects(domains.conversations.createGroup(scope.worldId, { ...fields, instanceIds:[actors[0],other.id] },
    { id:'c3-invalid', commandId:'c3-invalid' }), /KANATA_CONVERSATION_INVALID/)
  assert.equal(await domains.conversations.get({ ...scope, conversationId:'c3-invalid' }), null)
})

test('C3 new group has no access to messages or quotes in a prior group', async t => {
  const { domains, fixture, messages, scope } = await setup(t)
  const [first, removed, added] = fixture.instances.filter(row => row.worldId === scope.worldId).map(row => row.id)
  const prior = await domains.conversations.createGroup(scope.worldId, {
    title: '合成原群', instanceIds: [first, removed],
  }, { id: 'prior-group', commandId: 'create-prior-group' })
  const priorScope = { worldId: scope.worldId, conversationId: prior.id }
  const root = { ...fixture.messages[0], id: 'prior-group-root', conversationId: prior.id, content: '原群独有历史', lifeSources: [] }
  const reply = { ...fixture.messages[1], id: 'prior-group-reply', conversationId: prior.id,
    senderId: removed, replyToMessageId: root.id, replyToRevision: root.revision }
  await messages.insertBatch([root, reply])
  const before = await domains.conversations.get(priorScope)
  const history = await messages.recent(priorScope)
  const formerContext = await messages.historyForSpeaker(priorScope, removed, 10)
  assert.equal(history.messages.length, 2)
  assert.deepEqual(formerContext.map(row => row.id).sort(), [reply.id, root.id].sort())

  const created = await domains.conversations.createGroup(scope.worldId, {
    title: '合成新群', instanceIds: [first, added],
  }, { id: 'new-group', commandId: 'create-new-group' })
  assert.notEqual(created.id, prior.id)
  const newScope = { worldId: scope.worldId, conversationId: created.id }
  assert.deepEqual((await domains.conversations.get(newScope)).participantIds, [before.participantIds[0], first, added])
  assert.equal(await messages.count(newScope), 0)
  assert.deepEqual((await messages.recent(newScope)).messages, [])
  assert.deepEqual((await messages.searchHistory(newScope, root.content)).messages, [])
  assert.equal(await messages.locate(newScope, root.id), null)
  assert.equal(await messages.quote(newScope, root.id), null)
  assert.deepEqual(await messages.historyForSpeaker(newScope, added, 10), [])

  assert.deepEqual(await domains.conversations.get(priorScope), before)
  assert.deepEqual(await messages.recent(priorScope), history)
  assert.equal((await messages.get(priorScope, reply.id)).replyToMessageId, root.id)
  assert.equal((await messages.quote(priorScope, root.id)).content, root.content)
  assert.deepEqual(await messages.historyForSpeaker(priorScope, removed, 10), formerContext)
})

test('C2 event ancestry pages merge overlapping paths and bind cursors to direction and root', async t => {
  const { db, domains, scope, other } = await setup(t)
  const fixture = await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  db.prepare(fixture.eventRows).run(70, 'c2-event-', scope.worldId)
  db.prepare(fixture.eventEdges).run(69, scope.worldId, 'c2-event-', 'c2-event-')
  db.prepare('INSERT INTO event_causes(world_id,event_id,cause_event_id) VALUES(?,?,?)').run(scope.worldId,'c2-event-0','c2-event-20')
  const first = await domains.events.graphPage(scope.worldId, 'c2-event-0', 'cause')
  assert.equal(first.entries.length, 50)
  const second = await domains.events.graphPage(scope.worldId, 'c2-event-0', 'cause', first.cursor)
  assert.equal(second.entries.length, 20)
  assert.equal(new Set([...first.entries,...second.entries].map(row=>row.id)).size,70)
  await assert.rejects(domains.events.graphPage(scope.worldId, 'c2-event-0', 'consequence', first.cursor), /CURSOR_STALE/)
  await assert.rejects(domains.events.graphPage(other.worldId, 'c2-event-0', 'cause', first.cursor), /EVENT_UNAVAILABLE/)
  assert.throws(() => db.prepare('INSERT INTO event_causes(world_id,event_id,cause_event_id) VALUES(?,?,?)').run(scope.worldId,'c2-event-70','c2-event-0'), /CAUSAL_CYCLE/)
})

test('C3 binding CAS preserves inherit, explicit none and archived selections', async t => {
  const { domains, scope, other } = await setup(t)
  const original = await domains.roleBindings.read()
  const binding = { worldId:scope.worldId, instanceId:scope.instanceId }
  const global = await domains.roleBindings.set('global',binding,original.revision)
  assert.deepEqual((await domains.roleBindings.resolve('home')).binding,binding)
  const none = await domains.roleBindings.set('home',null,global.revision)
  assert.equal((await domains.roleBindings.resolve('home')).status,'unselected')
  await assert.rejects(domains.roleBindings.set('home','inherit',global.revision), /REVISION_CONFLICT/)
  await domains.roleBindings.set('home','inherit',none.revision)
  assert.deepEqual((await domains.roleBindings.resolve('home')).binding,binding)
  await assert.rejects(domains.roleBindings.set('home',{...binding,instanceId:other.id},none.revision+1), /BINDING_UNAVAILABLE/)
  const current = await domains.worlds.get(scope.worldId)
  await domains.worlds.archive(scope.worldId,current.world.revision,true)
  assert.equal((await domains.roleBindings.resolve('home')).status,'unavailable')
  assert.deepEqual((await domains.roleBindings.read()).global,binding)
})
