import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSchemaAdapter } from '../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { createKanataMessageRepository } from '../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { createKanataConversationRepository } from '../src/features/chat/storage/sqlite/kanataConversationRepository.js'
import { createKanataDeferredReplyRepository } from '../src/features/chat/storage/sqlite/kanataDeferredReplyRepository.js'
import { reviseKanataMessage } from '../src/features/chat/experience/kanataEvents.js'
import { auditInspection, fixtureWrites, m2Fixture, m2FixtureCommands } from './helpers/kanataSqliteM2Fixture.js'

async function setup(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  t.after(() => db.close())
  const state = { queries: [], writes: [], failOnWrite: 0, beforeCommit: null }
  const tx = {
    async query(sql, parameters = []) {
      const rows = db.prepare(sql).all(...parameters)
      state.queries.push({ sql, rows: rows.length })
      return rows
    },
    async execute(sql, parameters = []) {
      state.writes.push(sql)
      if (state.failOnWrite && state.writes.length === state.failOnWrite) throw Error('injected write failure')
      return { affectedRows: Number(db.prepare(sql).run(...parameters).changes) }
    },
  }
  const operation = {
    async transaction(run) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const value = await run(tx)
        state.beforeCommit?.()
        db.exec('COMMIT')
        return value
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  await migrateKanataSchema(kanataSchemaAdapter(operation), { now: () => 1200 })
  const fixture = m2Fixture()
  await operation.transaction(async transaction => {
    for (const { sql, parameters } of m2FixtureCommands(fixture)) await transaction.execute(sql, parameters)
  })
  let id = 0
  const tools = { id: () => 'm2-audit-' + ++id, clock: () => 1300 }
  const messages = createKanataMessageRepository(operation, tools)
  const conversations = createKanataConversationRepository(operation)
  const { worldId, conversationId } = fixture.messages[0]
  state.queries.length = state.writes.length = 0
  const deferred = createKanataDeferredReplyRepository(operation)
  return { db, tx, state, fixture, messages, conversations, deferred, scope: { worldId, conversationId } }
}

test('M2 bulk boundaries, duplicate identity, quote and fixed-size scoped keyset pages', async t => {
  const { fixture, messages, scope, state } = await setup(t)
  const batch = Array.from({ length: 256 }, (_, i) => ({
    ...fixture.messages[0], id: 'synthetic-' + String(i).padStart(3, '0'), content: "' ; DROP TABLE messages;--",
    createdAt: 1002, revision: 1, lifeSources: [],
  }))
  assert.equal(await messages.insert(batch[0]), 'inserted')
  assert.equal(await messages.insert(batch[0]), 'existing')
  assert.deepEqual(await messages.insertBatch(batch.slice(0, 50)), ['existing', ...Array(49).fill('inserted')])
  assert.equal((await messages.insertBatch(batch)).length, 256)
  assert.equal(await messages.count(scope), 258)
  await assert.rejects(messages.insertBatch([...batch, { ...batch[0], id: 'overflow' }]), /BATCH_INVALID/)
  await assert.rejects(messages.insert({ ...batch[0], content: 'changed' }), /ID_CONFLICT/)
  await assert.rejects(messages.insert({ ...batch[0], conversationId: fixture.conversations[1].id }), /ID_CONFLICT/)
  const first = await messages.recent(scope)
  const second = await messages.older(scope, first.cursor)
  assert.equal(first.messages[0].id, 'synthetic-255')
  assert.equal(second.messages[0].id, 'synthetic-205')
  assert.equal(first.messages.length, 50)
  assert.equal(new Set([...first.messages, ...second.messages].map(row => row.id)).size, 100)
  assert.equal(state.queries.every(query => query.rows <= 51), true)
  await assert.rejects(messages.older({ ...scope, worldId: fixture.worlds[1].id }, first.cursor), /CURSOR_INVALID/)
  await assert.rejects(messages.older(scope, { ...first.cursor, version: 2 }), /CURSOR_INVALID/)
  assert.equal((await messages.locate(scope, batch[2].id)).messages[0].id, batch[2].id)
  assert.equal(await messages.locate(scope, 'missing'), null)
  assert.equal((await messages.quote(scope, batch[2].id)).content, batch[2].content)
  assert.equal(await messages.quote({ ...scope, conversationId: 'other' }, batch[2].id), null)
  const valid = { ...batch[0], id: 'atomic-valid' }
  await assert.rejects(messages.insertBatch([valid, { ...valid, id: 'wrong-foreign-key', senderId: 'unknown' }]))
  assert.equal(await messages.get(scope, valid.id), null)
})

test('M2 edit and delete match the domain transaction, including both memory invalidations and exact redaction', async t => {
  const { tx, fixture, messages, scope } = await setup(t)
  const root = fixture.messages[0]
  const change = { deleted: true, content: '' }
  const originalAudit = (await tx.query(auditInspection.messages, [scope.worldId]))[0]
  let nextAudit = 0
  const expected = reviseKanataMessage(fixture, root.id, root.revision, change, {
    id: () => 'pure-audit-' + ++nextAudit, clock: () => 1300,
  })
  await messages.revise(scope, root.id, root.revision, change)
  assert.deepEqual(await messages.get(scope, root.id), expected.messages[0])
  assert.deepEqual(await messages.get(scope, 'message-two'), expected.messages[1])
  assert.equal(await messages.quote(scope, root.id), null)
  for (const row of await tx.query(auditInspection.eventRows, [scope.worldId])) {
    const event = expected.events.find(item => item.id === row.id)
    assert.deepEqual([row.status, row.revision], [event.status, event.revision])
  }
  for (const [name, collection, pairs] of [
    ['memories', expected.memories, [['status', 'status'], ['revision', 'revision']]],
    ['tasks', expected.tasks, [['state', 'state'], ['lease_until', 'leaseUntil'], ['error_code', 'errorCode']]],
  ]) {
    for (const row of await tx.query(auditInspection[name], [scope.worldId])) {
      const domain = collection.find(item => item.id === row.id)
      for (const [column, field] of pairs) assert.equal(row[column], domain[field])
    }
  }
  for (const row of await tx.query(auditInspection.instances, [scope.worldId])) {
    const expectedRow = expected.instances.find(item => item.id === row.id)
    assert.deepEqual([row.mood, row.revision], [expectedRow.state.mood, expectedRow.revision])
  }
  for (const row of await tx.query(auditInspection.relationships, [scope.worldId])) {
    const expectedRow = expected.relationships.find(item => item.id === row.id)
    assert.deepEqual([row.trust, row.revision], [expectedRow.dimensions.trust, expectedRow.revision])
  }
  const audits = await tx.query(auditInspection.messages, [scope.worldId])
  const redacted = audits.find(row => row.id === originalAudit.id)
  for (const key of ['previous_json', 'next_json']) {
    const [row] = await tx.query("SELECT json_set(?,'$.content','（已删除的原始记录）','$.deleted',json('true')) AS value", [originalAudit[key]])
    assert.equal(redacted[key], row.value)
  }
  assert.equal(audits.length, expected.messageAudits.length)
  const eventAudits = (await tx.query(auditInspection.events, [scope.worldId])).filter(row => row.id.startsWith('m2-audit'))
  for (const row of eventAudits) {
    const previous = JSON.parse(row.previous_json), next = JSON.parse(row.next_json)
    assert.deepEqual(previous, fixture.events.find(event => event.id === previous.id))
    assert.deepEqual(next, expected.events.find(event => event.id === next.id))
  }
  await assert.rejects(messages.setStatus(scope, root.id, root.revision, 'stopped'), /REVISION_CONFLICT/)
})

test('M2 no partial derived changes on uncertainty, any write fault or actual COMMIT failure', async t => {
  const { db, tx, state, fixture, messages, scope } = await setup(t)
  const { id, revision } = fixture.messages[0]
  const snapshot = async () => Promise.all(Object.values(auditInspection).map(sql => tx.query(sql, [scope.worldId])))
  const unchanged = await snapshot()
  await tx.execute(fixtureWrites.event, [null, 'note', '{}', 'event-independent'])
  await assert.rejects(messages.revise(scope, id, revision, { content: '', deleted: true }), /EVENT_DEPENDENCY_UNCERTAIN/)
  await tx.execute(fixtureWrites.event, ['explicit', 'note', '{}', 'event-independent'])
  for (let step = 1; ; step++) {
    state.writes.length = 0
    state.failOnWrite = step
    state.beforeCommit = () => {
      db.prepare(fixtureWrites.deferredCommit).run('will-rollback', 'missing-card', 1, '{}', '{}', 'synthetic')
    }
    await assert.rejects(messages.revise(scope, id, revision, { content: '', deleted: true }), /injected write failure|FOREIGN KEY/)
    const reachedCommit = state.writes.length < step
    state.failOnWrite = 0
    state.beforeCommit = null
    assert.deepEqual(await snapshot(), unchanged)
    assert.equal((await messages.get(scope, id)).revision, revision)
    if (reachedCommit) break
    assert(step < 40)
  }
  const edited = await messages.revise(scope, id, revision, { content: '合成编辑', deleted: false })
  assert.equal(edited.revision, revision + 1)
  assert.equal(JSON.parse((await tx.query(auditInspection.messages, [scope.worldId])).find(row => row.id === 'message-audit-one').next_json).content, fixture.messages[0].content)
})

test('M2 conversation create/update preserve participant order and observable CAS', async t => {
  const { fixture, conversations, scope } = await setup(t)
  const group = fixture.conversations.find(item => item.type === 'group')
  const dto = {
    ...group, id: 'm2-group', participantIds: [...group.participantIds].reverse(),
    replyLimits: { maxSpeakers: 2, maxMessages: 3 }, replyTiming: { enabled: false, waitMs: 1300 },
  }
  const groupScope = { worldId: dto.worldId, conversationId: dto.id }
  await conversations.create(dto)
  assert.deepEqual(await conversations.get(groupScope), dto)
  assert.deepEqual((await conversations.participants(groupScope)).map(row => row.id), dto.participantIds)
  const updated = await conversations.update(groupScope, dto.revision, { ...dto, title: '合成改名' })
  assert.equal(updated.revision, dto.revision + 1)
  await assert.rejects(conversations.update(groupScope, dto.revision, dto), /REVISION_CONFLICT/)
  assert.equal((await conversations.list(scope.worldId, '', 1)).hasMore, true)
  assert.equal(await conversations.get({ ...groupScope, worldId: fixture.worlds[1].id }), null)
})

test('M2 sources keep distinct extension records without duplicating normalized grant links', async t => {
  const { fixture, scope, messages, db } = await setup(t)
  const first = fixture.messages[0].lifeSources[0]
  const input = {
    ...fixture.messages[0], id: 'life-ext', revision: 1, lifeSources: [{ ...first, extra: 'A' }, { ...first, extra: 'B' }],
  }
  assert.equal(await messages.insert(input), 'inserted')
  assert.deepEqual(await messages.get(scope, input.id), input)
  assert.equal(db.prepare('SELECT count(*) AS n FROM message_life_sources WHERE message_id=?').get(input.id).n, 1)
  assert.equal(await messages.insert(input), 'existing')
})

test('M2 scoped deferred reply recovers due work and refuses a stale or cancelled source', async t => {
  const { fixture, scope, messages, deferred, db } = await setup(t)
  const source = fixture.messages[0]
  const task = { id: 'm2-delayed', sourceId: source.id, sourceRevision: source.revision, notBefore: 1700, expiresAt: 2800, activityDelay: true }
  await deferred.schedule(scope, task, false)
  assert.deepEqual(await deferred.pending(scope), task)
  assert.equal(await deferred.claim(scope, 1699), null)
  assert.deepEqual(await deferred.claim(scope, 1700), task)
  assert.equal(await deferred.claim(scope, 1701), null)
  await deferred.finish(scope, task.id, false)
  await deferred.schedule(scope, { ...task, id: 'unused-retry-id' }, true)
  assert.equal((await deferred.pending(scope)).id, task.id)
  await messages.revise(scope, source.id, source.revision, { content: '合成修订', deleted: false })
  assert.equal(await deferred.claim(scope, 1800), null)
  assert.deepEqual({ ...db.prepare('SELECT state,error_code FROM background_tasks WHERE id=?').get(task.id) },
    { state: 'cancelled', error_code: 'SOURCE_REVISED' })
})
