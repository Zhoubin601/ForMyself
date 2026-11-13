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

// Test-only reconstruction sink. Product reads retain one page/chunk and must
// never rebuild a complete compatibility DTO this way.
async function testMessageSnapshot(messages,scope,id,selection={kind:'snapshot'}) {
  let cursor, text=''
  do {
    const page=await messages.jsonChunk(scope,id,selection,cursor)
    assert(Array.from(page.fragment).length<=4096)
    text+=page.fragment
    cursor=page.cursor??undefined
  } while(cursor)
  return JSON.parse(text)
}

async function setup(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  t.after(() => db.close())
  const state = { queries: [], writes: [], failOnWrite: 0, beforeCommit: null }
  const tx = {
    async query(sql, parameters = []) {
      const rows = db.prepare(sql).all(...parameters)
      state.queries.push({ sql, rows: rows.length, maxText: Math.max(0, ...rows.flatMap(row =>
        Object.values(row).filter(value => typeof value === 'string').map(value => value.length))) })
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
  assert.deepEqual(await testMessageSnapshot(messages,scope,root.id), expected.messages[0])
  assert.deepEqual(await testMessageSnapshot(messages,scope,'message-two'), expected.messages[1])
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

for (const count of [1000, 10000]) test(`G4 ordinary revise keeps ${count} message provenance records inside SQLite and preserves full audit semantics`, async t => {
  const { db, fixture, state, messages, scope } = await setup(t)
  const tag = fixture.messages[0].lifeSources[0]
  const links = db.prepare('INSERT OR IGNORE INTO message_life_sources(world_id,message_id,grant_id,instance_id,module_id,grant_revision,fingerprint) VALUES(?,?,?,?,?,?,?)')
  const extend = db.prepare('UPDATE messages SET extensions_json=? WHERE id=?')
  for (const message of fixture.messages.filter(item => item.worldId === scope.worldId)) {
    const tags = Array.from({ length: count }, (_, i) => ({ ...tag, fingerprint: (i + 1).toString(16).padStart(64, '0') })).reverse()
    tags.push(...message.lifeSources ?? [])
    // Distinct extension records may share one normalized link. Their original
    // array order and unknown fields remain part of the compatibility contract.
    tags.push({ ...tags[0], unknown: 'same link, different record' })
    message.lifeSources = tags
    message.syntheticExtra = { opaque: '合成扩展'.repeat(count), nested: ['retain', null, false] }
    for (const source of tags) links.run(message.worldId, message.id, source.grantId, source.instanceId, source.moduleId, source.revision, source.fingerprint)
    extend.run(JSON.stringify({ lifeSources: tags, syntheticExtra: message.syntheticExtra }), message.id)
  }
  const root = fixture.messages[0]
  state.queries.length = 0
  for (const message of [(await messages.get(scope,root.id)),...(await messages.recent(scope)).messages,
    ...(await messages.replies(scope,root.id)).messages,(await messages.latest(scope,'user'))].filter(Boolean)) {
    assert.equal(Object.hasOwn(message,'lifeSources'),false)
    assert.equal(Object.hasOwn(message,'syntheticExtra'),false)
  }
  assert.equal(await messages.insert(root),'existing')
  await assert.rejects(messages.insert({...root,lifeSources:[...root.lifeSources].reverse()}),/ID_CONFLICT/)
  assert(state.queries.every(query=>query.maxText<=4096),'ordinary reads and idempotency must not bridge complete source objects')
  const expected = reviseKanataMessage(fixture, root.id, root.revision, { content: '有界修订', deleted: false }, {
    id: (() => { let n = 0; return () => 'oracle-' + ++n })(), clock: () => 1300,
  })
  state.queries.length = 0
  const result = await messages.revise(scope, root.id, root.revision, { content: '有界修订', deleted: false })
  assert(state.queries.every(query => query.maxText <= 4096), 'ordinary revise must not bridge full provenance or opaque extensions')
  assert.deepEqual(result, { id: root.id, revision: root.revision + 1 })
  const actual = db.prepare("SELECT previous_json,next_json FROM message_audits WHERE id LIKE 'm2-audit-%' ORDER BY message_id").all()
  const audits = expected.messageAudits.filter(item => item.id.startsWith('oracle-')).sort((a, b) => a.messageId.localeCompare(b.messageId))
  assert.equal(actual.length, audits.length)
  for (let i = 0; i < audits.length; i++) {
    assert.deepEqual(JSON.parse(actual[i].previous_json), audits[i].previous)
    assert.deepEqual(JSON.parse(actual[i].next_json), audits[i].next)
  }
  console.log(JSON.stringify({ scenario: 'ordinary-message-revise', count, maxRows: Math.max(...state.queries.map(q => q.rows)), maxText: Math.max(...state.queries.map(q => q.maxText)) }))
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
  assert.deepEqual(await testMessageSnapshot(messages,scope,input.id), input)
  assert.equal(db.prepare('SELECT count(*) AS n FROM message_life_sources WHERE message_id=?').get(input.id).n, 1)
  assert.equal(await messages.insert(input), 'existing')
})

test('G4 message detail pages and JSON chunks preserve unknown data, bind scope/revision/selection and release transaction staging', async t => {
  const { fixture, scope, messages, db, state } = await setup(t)
  const tag=fixture.messages[0].lifeSources[0]
  const input={...fixture.messages[0],id:'detail-long',revision:1,
    lifeSources:Array.from({length:103},(_,i)=>({...tag,fingerprint:i.toString(16).padStart(64,'0')})).reverse(),
    syntheticExtra:{raw:'x😀界\ud800\udc00\u0000'.repeat(3000),object:{z:1,a:['one',false,null]}}}
  await messages.insert(input)
  state.queries.length=0
  let cursor,seen=0,previous=''
  do {
    const page=await messages.sourcePage(scope,input.id,cursor)
    assert(page.rows.length<=50)
    for(const row of page.rows){assert(row.fingerprint>previous);previous=row.fingerprint;seen++}
    cursor=page.cursor??undefined
  }while(cursor)
  assert.equal(seen,103)
  const first=await messages.sourcePage(scope,input.id)
  await assert.rejects(messages.sourcePage({...scope,conversationId:'missing'},input.id,first.cursor),/UNAVAILABLE/)
  await assert.rejects(messages.sourcePage(scope,fixture.messages[0].id,first.cursor),/CURSOR_INVALID/)
  await assert.rejects(messages.sourcePage(scope,input.id,{...first.cursor,grantRevision:-1}),/CURSOR_INVALID/)
  await assert.rejects(messages.sourcePage(scope,input.id,undefined,51),/LIMIT_INVALID/)
  assert.deepEqual(await testMessageSnapshot(messages,scope,input.id),input)
  const head=await messages.jsonChunk(scope,input.id,{kind:'extensions'})
  assert(head.cursor)
  await assert.rejects(messages.jsonChunk(scope,input.id,{kind:'snapshot'},head.cursor),/CURSOR_INVALID/)
  await assert.rejects(messages.jsonChunk(scope,input.id,{kind:'extensions'},{...head.cursor,offset:-1}),/CURSOR_INVALID/)
  assert(state.queries.every(q=>q.rows<=51 && q.maxText<=8194)) // 4097 Unicode code points, at most two UTF-16 units each.
  const receipt=await messages.setStatus(scope,input.id,1,'stopped')
  assert.deepEqual(receipt,{id:input.id,revision:2})
  await assert.rejects(messages.jsonChunk(scope,input.id,{kind:'extensions'},head.cursor),/CURSOR_INVALID/)
  await assert.rejects(messages.sourcePage(scope,input.id,first.cursor),/CURSOR_INVALID/)
  const audit=db.prepare('SELECT id FROM message_audits WHERE message_id=?').get(input.id)
  assert.deepEqual(await testMessageSnapshot(messages,scope,input.id,{kind:'audit',auditId:audit.id,side:'previous'}),input)
  assert.deepEqual(await testMessageSnapshot(messages,scope,input.id,{kind:'audit',auditId:audit.id,side:'next'}),{...input,status:'stopped',revision:2})
  assert.equal(db.prepare('SELECT count(*) AS n FROM temp.kanata_message_audit_stage').get().n,0)
  const reordered={...input,syntheticExtra:{object:{a:['one',false,null],z:1},raw:input.syntheticExtra.raw},status:'stopped',revision:2}
  assert.equal(await messages.insert(reordered),'existing')
  await assert.rejects(messages.insert({...reordered,syntheticExtra:{...reordered.syntheticExtra,object:{a:['one',false],z:1}}}),/ID_CONFLICT/)
  const current=await messages.jsonChunk(scope,input.id,{kind:'audit',auditId:audit.id,side:'previous'})
  await assert.rejects(messages.jsonChunk(scope,input.id,{kind:'audit',auditId:audit.id,side:'next'},current.cursor),/CURSOR_INVALID/)
})

test('G3 message detail owns selection, scope and cursor before asynchronous transaction work',async t=>{
  const {fixture,scope,messages,db}=await setup(t)
  const input={...fixture.messages[0],id:'detail-owned-input',syntheticExtra:{text:'x'.repeat(10000)}}
  await messages.insert(input)
  const selected={kind:'extensions'},ownedScope={...scope}
  const pending=messages.jsonChunk(ownedScope,input.id,selected)
  selected.kind='snapshot';ownedScope.worldId='changed-world';ownedScope.conversationId='changed-conversation'
  const first=await pending
  const expected=db.prepare('SELECT extensions_json FROM messages WHERE id=?').get(input.id).extensions_json
  assert.equal(first.fragment,Array.from(expected).slice(0,4096).join(''))
  assert.equal(first.cursor.worldId,scope.worldId)
  assert.deepEqual(first.cursor.selection,{kind:'extensions'})
  const after=structuredClone(first.cursor)
  const next=messages.jsonChunk(scope,input.id,{kind:'extensions'},after)
  after.offset=0;after.selection.kind='snapshot'
  const second=await next
  assert.equal(second.cursor.offset,8192)
  assert.deepEqual(second.cursor.selection,{kind:'extensions'})
})

test('G4 invalid historical message hints/extensions and unexpected staging fail closed without cleanup', async t=>{
  const {fixture,scope,messages,db}=await setup(t)
  const root=fixture.messages[0]
  const original=db.prepare('SELECT extensions_json FROM messages WHERE id=?').get(root.id).extensions_json
  for(const raw of [JSON.stringify({lifeSources:[{...root.lifeSources[0],fingerprint:'b'.repeat(64)}]}),
    '{"nested":'+ '['.repeat(65)+'0'+']'.repeat(65)+'}', '{"future":1e999}']) {
    db.prepare('UPDATE messages SET extensions_json=? WHERE id=?').run(raw,root.id)
    const before=db.prepare('SELECT count(*) AS n FROM message_audits').get().n
    await assert.rejects(messages.setStatus(scope,root.id,root.revision,'stopped'),/INTEGRITY_FAILED/)
    assert.equal(db.prepare('SELECT count(*) AS n FROM message_audits').get().n,before)
    assert.equal(db.prepare('SELECT extensions_json FROM messages WHERE id=?').get(root.id).extensions_json,raw)
  }
  db.prepare('UPDATE messages SET extensions_json=? WHERE id=?').run(original,root.id)
  await messages.setStatus(scope,root.id,root.revision,'stopped')
  db.exec("INSERT INTO temp.kanata_message_audit_stage VALUES(1,'unknown-world','unknown-conversation','unknown-message',1,'{}')")
  const before=JSON.stringify(db.prepare('SELECT * FROM message_audits ORDER BY id').all())
  await assert.rejects(messages.setStatus(scope,root.id,root.revision+1,'complete'),/UNIQUE constraint/)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM message_audits ORDER BY id').all()),before)
  assert.equal(db.prepare('SELECT world_id FROM temp.kanata_message_audit_stage').get().world_id,'unknown-world')
  assert.equal((await messages.state(scope,root.id)).revision,root.revision+1)
})

test('G4 SQLite message snapshot validation keeps legacy Unicode whitespace and embedded NUL semantics',async t=>{
  const {fixture,scope,messages,db}=await setup(t)
  const base=fixture.messages[0]
  for(const [i,content]of ['\u0000tail','\u00a0x\u2000','\u2000\ufeff',''].entries()){
    const input={...base,id:'message-whitespace-'+i,revision:1,content:'temporary',deleted:true}
    await messages.insert(input)
    db.prepare('UPDATE messages SET content=?,revision=2 WHERE id=?').run(content,input.id)
    if(content.trim()){
      await messages.setStatus(scope,input.id,2,'stopped')
      const snapshot=await testMessageSnapshot(messages,scope,input.id)
      assert.equal(snapshot.content,content)
    }else{
      await assert.rejects(messages.setStatus(scope,input.id,2,'stopped'),/KANATA_MESSAGE_INVALID/)
      assert.equal((await messages.state(scope,input.id)).revision,2)
    }
  }
})

test('G4 message idempotency retains JavaScript JSON numeric equality for historical unknown fields',async t=>{
  const {fixture,scope,messages,db}=await setup(t)
  const {lifeSources:_sources,syntheticExtra:_extra,...base}=fixture.messages[0]
  const input={...base,id:'message-numeric-json',revision:1}
  await messages.insert(input)
  const raw='{"large":9007199254740993,"same":1.0,"zero":-0}'
  db.prepare('UPDATE messages SET extensions_json=? WHERE id=?').run(raw,input.id)
  assert.equal(await messages.insert({...input,...JSON.parse(raw)}),'existing')
  assert.deepEqual(await testMessageSnapshot(messages,scope,input.id),{...input,...JSON.parse(raw)})
  await assert.rejects(messages.insert({...input,...JSON.parse(raw),large:9007199254740994}),/ID_CONFLICT/)
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
