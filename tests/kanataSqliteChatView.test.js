import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { shallowRef } from 'vue'
import { createKanataSqliteChatRuntime } from '../src/application/kanataSqliteChatRuntime.js'
import { createKanataSqliteDomains } from '../src/features/chat/storage/sqlite/kanataSqliteDomains.js'
import { createKanataConversationRepository } from '../src/features/chat/storage/sqlite/kanataConversationRepository.js'
import { createKanataMessageRepository } from '../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { createKanataDeferredReplyRepository } from '../src/features/chat/storage/sqlite/kanataDeferredReplyRepository.js'
import { selectKanataWindowActors } from '../src/features/chat/storage/sqlite/kanataWindowActors.js'
import { createKanataBudgetSelection } from '../src/features/chat/domain/kanataBudgetSelection.js'
import { createKanataChatViewRepository } from '../src/features/chat/storage/sqlite/kanataChatViewRepository.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSchemaAdapter } from '../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { m2Fixture, m2FixtureCommands } from './helpers/kanataSqliteM2Fixture.js'
import { resolveKanataCharacter } from '../src/features/chat/domain/kanataManagementCore.js'

async function setup(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('PRAGMA foreign_keys=ON')
  const reads = []
  let failingSql = ''
  const operation = { async transaction(work) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await work({
        async query(sql, parameters = []) {
          const rows = db.prepare(sql).all(...parameters)
          reads.push({ sql, parameters, rows: rows.length, keys: Object.keys(rows[0] ?? {}) })
          return rows
        },
        async execute(sql, parameters = []) {
          if (failingSql && sql.includes(failingSql)) throw new Error('INJECTED_WRITE_FAILURE')
          return { affectedRows: Number(db.prepare(sql).run(...parameters).changes) }
        },
      })
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } }
  await migrateKanataSchema(kanataSchemaAdapter(operation))
  const fixture = m2Fixture()
  await operation.transaction(async tx => {
    for (const { sql, parameters } of m2FixtureCommands(fixture)) await tx.execute(sql, parameters)
  })
  return { db, reads, operation, fixture, failOn: text => { failingSql = text } }
}

test('M4 chat metadata reads a scoped light projection without projecting cards or history', async t => {
  const { operation, fixture, reads } = await setup(t)
  const { worldId, id: conversationId, title, participantIds } = fixture.conversations[0]
  const scope = { worldId, conversationId }
  const alternate = fixture.worlds.find(world => world.id !== worldId)
  const repository = createKanataChatViewRepository(operation)
  reads.length = 0
  const view = await repository.load(scope)
  assert.equal(view.conversation.title, title)
  assert.equal(view.world.id, worldId)
  assert.equal(view.members.entries.length, 1)
  assert.ok(participantIds.includes(view.members.entries[0].id))
  assert.equal(view.members.entries[0].name, resolveKanataCharacter(fixture, view.members.entries[0].id).name)
  assert.equal(view.members.cursor, null)
  assert.deepEqual(reads.map(read => read.parameters.slice(0, 2)), [[worldId, conversationId], [worldId, conversationId]])
  assert.ok(reads.every(read => read.rows <= 51))
  assert.ok(reads.every(read => !/\b(messages|raw_data_json|imported_json)\b/i.test(read.sql)))
  assert.ok(reads.every(read => !read.keys.some(key => /json|extensions/.test(key))))
  assert.equal(await repository.load({ ...scope, worldId: alternate.id }), null)
  await assert.rejects(repository.members(scope, -2), /CURSOR_INVALID/)
})

test('M4 cost buckets match exact ranked greedy selection across mixed costs and ties', () => {
  for (let seed = 0; seed < 20; seed++) {
    const entries = Array.from({ length: 1700 }, (_, id) => ({
      id, score: (seed + id * 2) % 19, cost: 9 + (id * 179 + seed * 13) % 220,
    }))
    const compare = (a, b) => b.score - a.score || b.id - a.id
    const selection = createKanataBudgetSelection(4000, compare)
    for (const row of entries) selection.offer(row, row.cost)
    let remaining = 4000
    const expected = entries.sort(compare).filter(entry => {
      if (entry.cost > remaining) return false
      remaining -= entry.cost
      return true
    })
    assert.deepEqual(selection.finish(), expected)
  }
})

test('M4 reply-timing CAS and pending activity acceleration roll back together', async t => {
  const { operation, fixture, failOn } = await setup(t)
  const { worldId, id: conversationId } = fixture.conversations[0]
  const scope = { worldId, conversationId }
  const repository = createKanataConversationRepository(operation)
  const previous = await repository.get(scope)
  await repository.updateChatSettings(scope, previous.revision, { replyTiming: { enabled: true, waitMs: 5000 } }, 2000)
  await assert.rejects(repository.updateChatSettings(scope, previous.revision, { mode: 'roleplay' }, 2000), /REVISION_CONFLICT/)
  const before = await repository.get(scope)
  failOn('not_before=min')
  await assert.rejects(repository.updateChatSettings(scope, before.revision, { replyTiming: { enabled: false, waitMs: 5000 } }, 2000),
    /INJECTED_WRITE_FAILURE/)
  assert.deepEqual(await repository.get(scope), before)
})

test('M4 real SQLite runtime keeps identical access shape from 1k to 10k messages', async t => {
  const counts = []
  for (const size of [1000, 10000]) {
    const { db, reads, operation, fixture } = await setup(t)
    const { worldId, id: conversationId } = fixture.conversations[0]
    const { id: senderId } = fixture.identities.find(row => row.worldId === worldId)
    const scope = { worldId, conversationId }
    db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
        content,created_at,revision,status,turn_id,batch_id,extensions_json)
      SELECT 'm4-load-'||n,?,?,'user','user',?,'合成','合成历史',n+2000,1,'complete','load-turn','load-batch','{}' FROM seq`)
      .run(size, worldId, conversationId, senderId)
    let sequence = 0
    const tools = { id: () => 'qa-' + size + '-' + (++sequence), clock: () => 90000 }
    const domains = createKanataSqliteDomains(operation, tools)
    const messages = createKanataMessageRepository(operation, tools)
    const conversations = createKanataConversationRepository(operation)
    const deferred = createKanataDeferredReplyRepository(operation)
    const generation = shallowRef(0)
    let calls = 0
    let lastSystem
    let tail = Promise.resolve()
    function run(request, task) {
      const result = tail.then(async () => {
        request.assertOwner?.()
        const value = await task()
        request.assertOwner?.()
        return value
      })
      tail = result.catch(() => {})
      return result
    }
    const candidate = {
      generation, isAvailable: () => true, release: async () => { generation.value++ },
      withRepositories: (request, work) => run(request, () => work(messages, conversations, deferred, domains)),
      withDomains: (request, work) => run(request, () => work(domains)),
      loadConversationView: request => run(request, () => domains.chatView.load(request)),
      readConversationMembers: (request, cursor) => run(request, () => domains.chatView.members(request, cursor)),
    }
    const runtime = createKanataSqliteChatRuntime({
      candidate, auth: { sessionRevision: 1, isLocked: false }, clock: tools.clock, id: tools.id,
      completion: async options => {
        calls++
        lastSystem = options.messages[0].content
        assert.ok(options.messages.length <= 41)
        options.onDelta?.('合成')
        return { content: '一段合成回复\n\n二段合成回复' }
      },
    })
    const view = runtime.createViewModel()
    reads.length = 0
    const originalStringify = JSON.stringify
    const originalClone = globalThis.structuredClone
    const fullGraphs = []
    let serializedSourceObjects = 0
    let singleSourceWrites = 0
    let highHeapSample = 0
    const observe = value => {
      if (value && Object.hasOwn(value, 'messageId') && Object.hasOwn(value, 'revision') && Object.keys(value).length === 2) {
        singleSourceWrites++
        if (singleSourceWrites % 50 === 0) highHeapSample = Math.max(highHeapSample, process.memoryUsage().heapUsed)
      }
      if (Array.isArray(value)) {
        for (const entry of value) serializedSourceObjects += entry?.sourceRefs?.length ?? 0
      }
      if (value && typeof value === 'object' && ['worlds', 'conversations', 'messages', 'cards'].every(key => Object.hasOwn(value, key))) {
        fullGraphs.push(Object.keys(value))
      }
    }
    JSON.stringify = (value, ...args) => { observe(value); return originalStringify(value, ...args) }
    globalThis.structuredClone = (...args) => { observe(args[0]); return originalClone(...args) }
    try {
      runtime.activate(scope)
      await view.open(conversationId)
      assert.equal(view.window.messages.value.length, 50)
      assert.equal(await view.window.older(), true)
      assert.equal(view.window.messages.value.length, 100)
      const onDelta = value => assert.equal(value.content, '合成')
      const result = await runtime.send(conversationId, { text: '合成 M4 请求', onDelta, timing: 'immediate' })
      assert.equal(calls, 1)
      assert.equal((await messages.replies(scope, result.messageId)).messages.length, 2)
      await runtime.reviseMessage(result.messageId, 1, { content: '合成修订', deleted: false })
      assert.equal((await messages.get(scope, result.messageId)).revision, 2)
      assert.deepEqual(fullGraphs, [])
      assert.ok(reads.every(read => read.rows <= 51))
      counts.push(reads.length)

      const instanceId = fixture.instances.find(row => row.worldId === worldId && fixture.conversations[0].participantIds.includes(row.id)).id
      db.prepare(`INSERT INTO memories(id,world_id,owner_type,owner_id,owner_instance_id,layer,memory_key,content,status,revision,visibility)
        VALUES('wide-prompt-memory',?,'character',?,?,'L3','合成来源','合成待引用记忆','active',1,'private')`).run(worldId, instanceId, instanceId)
      db.prepare(`INSERT INTO memory_sources(world_id,memory_id,message_id,message_revision)
        SELECT world_id,'wide-prompt-memory',id,revision FROM messages WHERE world_id=? AND conversation_id=? AND id GLOB 'm4-load-*'`)
        .run(worldId, conversationId)
      reads.length = 0
      const heapAtStart = process.memoryUsage().heapUsed
      await assert.rejects(runtime.send(conversationId, { text: '合成宽来源', timing: 'immediate' }), { code: 'CONTEXT_BUDGET_EXCEEDED', sourceSaved: true })
      assert.equal(calls, 1)
      assert.equal(serializedSourceObjects, 0, 'ordinary send must not assemble or serialize a source-reference array')
      const sourcePages = reads.filter(read => read.keys.join() === 'message_id,message_revision')
      assert.ok(sourcePages.length > 1 && sourcePages.reduce((total, page) => total + page.rows, 0) < size)
      assert.ok(singleSourceWrites < size)
      assert.ok(!reads.some(read => /SELECT (?:instance_id|kind,target_memory_id|event_id) FROM memory_/.test(read.sql)))
      t.diagnostic(JSON.stringify({size, sourcePages:sourcePages.length, sourcePageMax:Math.max(...sourcePages.map(page=>page.rows)),
        serializedSourceObjects,singleSourceWrites, heapAtStart, highHeapSample, retainedWindow:view.window.messages.value.length}))

      db.prepare(`DELETE FROM memory_sources WHERE world_id=? AND memory_id='wide-prompt-memory'
        AND cast(substr(message_id,9) AS INTEGER)>55`).run(worldId)
      await domains.memories.archiveSource(worldId, { messageId: 'm4-load-1', revision: 1 })
      const sent = await runtime.send(conversationId, { text: '合成可引用来源', timing: 'immediate' })
      assert.equal(calls, 2)
      assert.equal((await messages.replies(scope, sent.messageId)).messages.length, 2)
      const expectedRefs = db.prepare(`SELECT message_id AS messageId,message_revision AS revision FROM memory_sources
        WHERE world_id=? AND memory_id='wide-prompt-memory' ORDER BY message_id`).all(worldId).map(row => ({ ...row }))
      assert.equal(expectedRefs.length, 55)
      const json = lastSystem.split('\n').find(line => line.startsWith('可追溯的动态记忆')).split('：')[1]
      assert.deepEqual(JSON.parse(json).find(row => row.id === 'wide-prompt-memory'), {
        id: 'wide-prompt-memory', layer: 'L3', content: '合成待引用记忆', confidence: 'statement', sourceRefs: expectedRefs,
      })
      assert.equal(serializedSourceObjects, 0)
    } finally {
      JSON.stringify = originalStringify
      globalThis.structuredClone = originalClone
      view.dispose()
      await runtime.dispose()
      await tail
    }
  }
  assert.equal(counts[0], counts[1])
  t.diagnostic(JSON.stringify({ seeds: [1000, 10000], queryCounts: counts, recent: 50, window: 100, fullGraphCalls: 0 }))
})
test('M4 turn source and deferred task roll back on a failed link write and retry exactly once', async t => {
  const { operation, fixture, failOn } = await setup(t)
  const scope = { worldId: fixture.conversations[0].worldId, conversationId: fixture.conversations[0].id }
  const tools = { clock: () => 2000, id: () => 'm4-unused' }
  const { turns } = createKanataSqliteDomains(operation, tools)
  const repository = createKanataMessageRepository(operation, tools)
  const source = { ...fixture.messages[0], ...scope, id: 'm4-source-atomic', revision: 1, createdAt: 2000, lifeSources: [] }
  const deferred = { id: 'm4-task-atomic', sourceId: source.id, sourceRevision: 1, notBefore: 3000, expiresAt: 9000, activityDelay: false }
  failOn('INSERT INTO task_sources')
  await assert.rejects(turns.save(scope, { source, retry: false, conversationRevision: fixture.conversations[0].revision, deferred }), /INJECTED_WRITE_FAILURE/)
  assert.equal(await repository.get(scope, source.id), null)
  failOn('')
  assert.equal((await turns.save(scope, { source, retry: false, conversationRevision: fixture.conversations[0].revision, deferred })).id, deferred.id)
  assert.equal((await turns.save(scope, { source, retry: false, conversationRevision: fixture.conversations[0].revision, deferred })).id, deferred.id)
  assert.equal((await repository.get(scope, source.id)).revision, 1)
  await repository.insert({ ...source, id: 'm4-newer-source', createdAt: 2001 })
  await assert.rejects(turns.save(scope, { source, retry: true, conversationRevision: fixture.conversations[0].revision, deferred }), /STALE_TURN/)
})

test('M4 candidate history archive freezes protected components and keeps archived messages addressable',async t=>{
  const {operation,fixture,db,failOn,reads}=await setup(t)
  const {worldId,id:conversationId,participantIds}=fixture.conversations[0]
  const scope={worldId,conversationId}
  const senderId=fixture.identities.find(identity=>identity.worldId===worldId).id
  const instanceId=fixture.instances.find(actor=>participantIds.includes(actor.id)).id
  const tools={clock:()=>90000,id:()=> 'archive-id'}
  const messages=createKanataMessageRepository(operation,tools)
  const domains=createKanataSqliteDomains(operation,tools)
  db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<250)
    INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
      content,created_at,revision,status,turn_id,batch_id,extensions_json)
    SELECT 'archive-'||n,?,?,'user','user',?,'合成','合成归档',n+5000,1,'complete','archive-turn','archive-batch','{}' FROM seq`)
    .run(worldId,conversationId,senderId)
  db.prepare("UPDATE messages SET reply_to_message_id='archive-2',reply_to_revision=1 WHERE id='archive-250'").run()
  const before=await messages.previewArchive(scope)
  await domains.memories.save({id:'archive-source-memory',worldId,ownerType:'character',ownerId:instanceId,layer:'L3',
    key:'合成引用保护',content:'合成',status:'active',visibility:'private',revision:1,sourceRefs:[{messageId:'archive-1',revision:1}]},null)
  await assert.rejects(messages.confirmArchive(scope,before,'archive-first'),/ARCHIVE_PREVIEW_STALE/)
  db.prepare("UPDATE worlds SET extensions_json=json_set(extensions_json,'$.legacyNested',json(?)) WHERE id=?")
    .run(JSON.stringify([{ arbitrary:'archive-3' }]), worldId)
  const plan=await messages.previewArchive(scope)
  assert.equal(plan.count,before.count-2)
  failOn('INSERT INTO archived_message_marks')
  await assert.rejects(messages.confirmArchive(scope,plan,'archive-first'),/INJECTED_WRITE_FAILURE/)
  failOn('')
  assert.deepEqual(await messages.previewArchive(scope),plan)
  reads.length=0
  const receipt=await messages.confirmArchive(scope,plan,'archive-first')
  assert.deepEqual(await messages.confirmArchive(scope,plan,'archive-first'),receipt)
  assert.equal(receipt.archivedCount,plan.count)
  assert.ok(reads.every(query=>query.rows<=128))
  const marked=db.prepare('SELECT message_id FROM archived_message_marks WHERE world_id=? AND conversation_id=?').all(worldId,conversationId)
    .map(row=>row.message_id)
  assert.equal(marked.length,plan.count)
  assert.ok(marked.includes('archive-4') && !marked.includes('archive-3'))
  assert.ok(!marked.includes('archive-1')&&!marked.includes('archive-2')&&!marked.includes('archive-250'))
  assert.equal((await messages.quote(scope,'archive-3')).content,'合成归档')
  assert.equal((await messages.locate(scope,'archive-3',10)).messages[0].id,'archive-3')
  assert.equal((await messages.previewArchive(scope)).count,0)
})

test('M4 history handles Unicode normalization and scope-bound continuations after a sparse scan', async t => {
  const { operation, fixture, db, reads } = await setup(t)
  const scope = { worldId: fixture.conversations[0].worldId, conversationId: fixture.conversations[0].id }
  const tools = { clock: () => 2000, id: () => 'm4-unused' }
  const repository = createKanataMessageRepository(operation, tools)
  const source = { ...fixture.messages[0], ...scope, id: 'm4-history-match', revision: 1, createdAt: 2000, lifeSources: [], content: 'ＨＥＬＬＯ 世界' }
  await repository.insert(source)
  db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1601)
    INSERT INTO messages(id,world_id,conversation_id,role,sender_type,sender_id,sender_name_snapshot,
      content,created_at,revision,status,turn_id,batch_id,extensions_json)
    SELECT 'm4-search-'||n,?,?,'user','user',?,'合成','不匹配',n+2000,1,'complete','search-turn','search-batch','{}' FROM seq`)
    .run(scope.worldId, scope.conversationId, source.senderId)
  reads.length = 0
  const first = await repository.searchHistory(scope, 'hello')
  assert.deepEqual(first.messages, [])
  assert.ok(first.cursor)
  assert.equal(reads.length, 32)
  assert.ok(reads.every(read => read.rows <= 51))
  await assert.rejects(repository.searchHistory(scope, 'different', first.cursor), /CURSOR_INVALID/)
  const other = fixture.worlds.find(world => world.id !== scope.worldId)
  await assert.rejects(repository.searchHistory({ ...scope, worldId: other.id }, 'hello', first.cursor), /CURSOR_INVALID/)
  const next = await repository.searchHistory(scope, 'hello', first.cursor)
  assert.deepEqual(next.messages.map(row => row.id), [source.id])
  assert.equal(next.cursor, null)
})
test('M4 autonomy rotates the exact legacy locale order across actor batches and wraps', async () => {
  const ids = Array.from({ length: 321 }, (_, index) => 'actor' + ['.', '_', '-', ':'][index % 4] +
    ['a', 'A', 'z', 'Z'][index % 4] + (321 - index)).sort()
  for (const group of [ids, ids.slice(0, 6)]) {
    const order = [...group].sort((a, b) => a.localeCompare(b, 'en'))
    for (const offset of [0, 1, Math.floor(group.length / 2), group.length - 1]) {
      const visit = async function* () { yield* group }
      assert.deepEqual(await selectKanataWindowActors(visit, offset, group.length),
        [...order.slice(offset), ...order.slice(0, offset)].slice(0, 8))
    }
  }
})
test('MR2 wide chat keeps ordered legacy tags and rolls back its SQL work set', async t => {
  const { seedWideChatSources, chatReplyTagCheck } = await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  for (const size of [1000, 10000]) {
    const { db, reads, operation, fixture, failOn } = await setup(t)
    const { worldId, id: conversationId, participantIds, revision } = fixture.conversations[0]
    const instanceId = fixture.instances.find(actor => participantIds.includes(actor.id)).id
    const scope = { worldId, conversationId, instanceId }
    let nextId = 0
    const tools = { id: () => 'g4-test-' + (++nextId), clock: () => 60000 }
    const domains = createKanataSqliteDomains(operation, tools)
    const messages = createKanataMessageRepository(operation, tools)
    await domains.autonomy.setGrant(worldId, instanceId, 'todo', 2, { read:true, remember:true, share:true })
    const { lifeSources: _oldTags, ...sample } = fixture.messages[0]
    const source = { ...sample, id: 'wide-user', createdAt: 50000, revision: 1 }
    await messages.insert(source)
    const seeds = await operation.transaction(tx => seedWideChatSources(tx, scope, source.id, size))
    reads.length = 0
    const history = [...await messages.historyForSpeaker(scope, instanceId, 12, 'transcript')].reverse()
    assert.ok(history.some(row => row.id === source.id))
    assert.ok(history.every(row => row.lifeSources === undefined))
    const memory = await domains.memories.readPrompt(scope, seeds.memoryId, 4000)
    const context = await domains.events.context(worldId, { instanceId, group: false }, [instanceId])
    assert.ok(context.events.some(row => row.id === seeds.eventId))
    assert.equal(memory.lifeSources, undefined)
    const expected = { sourceId:source.id, sourceRevision:1, conversationRevision:revision, speakerId:instanceId,
      speakerRevision:(await domains.characters.getInstance(worldId, instanceId)).revision }
    const reply = { ...sample, id:'wide-reply', role:'assistant', senderType:'character', senderId:instanceId,
      senderNameSnapshot:'合成', createdAt:50001, revision:1, replyToMessageId:source.id, replyToRevision:1 }
    const ref = ({ id, revision }) => ({ id, revision })
    const proof = { history:history.map(ref), recentMessages:12, memories:[ref(memory)], events:context.events.map(ref), life:[] }
    const append = () => messages.insertReplyBatch(scope, expected, [reply], proof)
    failOn('SELECT DISTINCT ?,?,json_extract(tag')
    await assert.rejects(append(), /INJECTED_WRITE_FAILURE/)
    assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE id=?').get(reply.id).n, 0)
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_temp_master WHERE name='kanata_reply_proof'").get().n, 0)
    failOn('')
    await append()
    await append()
    const order = db.prepare(chatReplyTagCheck).get(worldId, source.id, reply.id, instanceId)
    assert.deepEqual({...order}, { tags:2*size+2,links:size+1,ordered_matches:2*size+2 })
    assert.ok(reads.every(row => row.rows<=51))
    await domains.autonomy.setGrant(worldId, seeds.deniedActor, 'todo', 1, { read:false, remember:false, share:false })
    const current = await messages.historyForSpeaker(scope, instanceId, 12, 'transcript')
    assert.ok(current.every(row => row.id !== reply.id && row.id !== source.id))
    await assert.rejects(append(), /KANATA_MESSAGE_REPLY_STALE/)
    t.diagnostic(JSON.stringify({ size, tags:order.tags, normalized:order.links, rollback:true, afterRevocation:'excluded' }))
  }
})
