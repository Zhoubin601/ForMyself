import {testEvent,testEventAudits,testEventEffects,testRelationship} from './helpers/kanataEventCompatibilityOracle.js'
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

async function setup(t, databasePath=':memory:') {
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA foreign_keys=ON')
  t.after(() => { if(db.isOpen)db.close() })
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
            const rows = db.prepare(sql).all(...parameters)
            state.observeRows?.(sql, rows.length)
            return rows
          },
          async execute(sql, parameters = []) {
            if (state.failOn && sql.startsWith(state.failOn)) throw new Error('injected statement failure')
            state.observeWrites?.(sql)
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
  return { db, state, fixture, domains, messages, instance, other, scope, move, operation }
}

test('M3 only appends to the frozen 001–003 catalog', () => {
  const frozen = JSON.parse(readFileSync(new URL('../docs/qa/kanata-sqlite-m2/evidence/schema-fingerprints.json', import.meta.url)))
  assert.deepEqual(KANATA_SCHEMA_MIGRATIONS.slice(0, 3).map(m => sha256Text(JSON.stringify([m.version, m.name, m.statements]))),
    frozen.migrations.map(m => m.checksum))
  assert.equal(KANATA_SCHEMA_MIGRATIONS.at(-1).version, 5)
})

test('M3 upgrades a populated v3 and preserves historical application times', async t => {
  const h = schemaHarness()
  t.after(h.close)
  await installLegacySchema(h, 3, m2FixtureCommands())
  const messages = h.db.prepare('SELECT * FROM messages ORDER BY id')
  const before = messages.all()
  assert.deepEqual(await migrateKanataSchema(h.connection, { now: () => 1100 }), { version: 5, appliedVersions: [4,5] })
  assert.deepEqual(messages.all(), before)
  assert.deepEqual(h.db.prepare('SELECT applied_at FROM schema_migration_applications ORDER BY version').all().map(row => row.applied_at),
    [null, null, 1000, 1100, 1100])
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

test('R5 candidate world creation derives owner and retries after failed commit without duplicates',async t=>{
  const {domains,state,fixture}=await setup(t)
  const candidate={withDomains:async({assertOwner},action)=>{assertOwner(); return action(domains)}}
  const runtime=createKanataSqliteWorldRuntime({candidate})
  const fields={name:'合成空白世界',rules:'合成设定',displayName:'合成身份',background:''}
  const options={key:'new-world',now:state.now,timeZone:'UTC',idFactory:kind=>kind+'-candidate-created'}
  state.failCommit=true
  await assert.rejects(runtime.createWorld(fields,options,()=>{}),/injected commit failure/)
  state.failCommit=false
  assert.equal(await domains.worlds.get('world-candidate-created'),null)
  const id=await runtime.createWorld(fields,options,()=>{})
  assert.equal(await runtime.createWorld(fields,options,()=>{}),id)
  const created=await domains.worlds.get(id)
  assert.equal(created.identity.userId,fixture.userId)
  assert.equal(created.world.autonomyEnabled,false)
  assert.equal(created.world.rules,fields.rules)
  assert.deepEqual((await domains.managementView.list(id,'conversations')).entries,[])
  runtime.select(id)
  await assert.rejects(runtime.createWorld(fields,options,()=>{}),/KANATA_WORLD_OWNER_EXPIRED/)
})

test('M4 candidate world settings validate time zone and CAS without touching identity',async t=>{
  const {domains,scope}=await setup(t)
  const {world,identity}=await domains.worlds.get(scope.worldId)
  const fields={name:'新合成世界名',rules:'合成规则',timeZone:'Asia/Shanghai',defaultChatMode:'roleplay'}
  await assert.rejects(domains.worlds.updateSettings(world.id,world.revision,{...fields,timeZone:'Invalid/Synthetic'}),/INVALID_TIMEZONE/)
  assert.deepEqual(await domains.worlds.get(world.id),{world,identity})
  const result=await domains.worlds.updateSettings(world.id,world.revision,fields)
  for(const [key,value] of Object.entries(fields))assert.equal(result[key],value)
  await assert.rejects(domains.worlds.updateSettings(world.id,world.revision,fields),/REVISION_CONFLICT/)
  await domains.worlds.archive(world.id,result.revision,true)
  await assert.rejects(domains.worlds.updateSettings(world.id,result.revision+1,fields),/WORLD_ARCHIVED/)
  assert.deepEqual((await domains.worlds.get(world.id)).identity,identity)
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

test('R5 role lore preview reuses prompt activation, scope and ranking across SQLite pages', async t => {
  const { scope, other, domains, state } = await setup(t)
  const withDomains = ({ assertOwner }, action) => { assertOwner(); return action(domains) }
  const runtime = createKanataSqliteWorldRuntime({ candidate:{ withDomains } })
  const owner = runtime.select(scope.worldId)
  for (const entry of (await domains.lorebook.list(scope.worldId)).entries) await domains.lorebook.delete(scope.worldId,entry.id,entry.revision)
  const publicEntry = { worldId:scope.worldId,ownerId:scope.worldId,scope:'world',visibility:'public',
    knownBy:[],sourceTag:'synthetic',revision:1,enabled:true,activationRule:'always',keys:[],priority:5 }
  for (let index=0;index<52;index++) {
    const id='lore-preview-'+String(index).padStart(2,'0')
    await domains.lorebook.save({...publicEntry,id,content:id},null)
  }
  await domains.lorebook.save({...publicEntry,id:'lore-keyword',content:'matched keyword',activationRule:'keyword',
    keys:['Red'],secondaryKeys:['Town'],caseSensitive:true,priority:100},null)
  await domains.lorebook.save({...publicEntry,id:'lore-disabled',content:'disabled entry',enabled:false,priority:200},null)
  const first=await owner.previewLore(scope.instanceId,'Red Town',0,()=>{})
  assert.equal(first.entries.length,50)
  assert.equal(first.entries[0].id,'lore-keyword')
  assert.equal(first.hasMore,true)
  const second=await owner.previewLore(scope.instanceId,'Red Town',50,()=>{})
  assert.deepEqual(second.entries.map(row=>row.id),['lore-preview-49','lore-preview-50','lore-preview-51'])
  assert.equal(second.hasMore,false)
  assert.equal((await owner.previewLore(scope.instanceId,'red Town',0,()=>{})).entries[0].id,'lore-preview-00')
  state.queries=[]
  await assert.rejects(owner.previewLore(other.id,'Red Town',0,()=>{}),/KANATA_CONTEXT_SCOPE_DENIED/)
  assert.ok(!state.queries.some(sql=>sql.includes('l.content')))
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

test('MR2 memory detail and source resolution prove every distinct reply-chain grant without projecting tags', async t => {
  const { domains, fixture, messages, db, scope, state } = await setup(t)
  const { grantOriginActors, grantOrigins, grantMessageTags, memoryRows, memoryWideSources } =
    await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const { worldId, instanceId, conversationId } = scope
  await domains.autonomy.setGrant(worldId, instanceId, 'todo', 2, { read: true, remember: true, share: true })
  const samples = []
  for (const size of [1000, 10000]) {
    const prefix = 'mr2-origin-' + size + '-'
    const source = 'mr2-source-' + size, reply = 'mr2-reply-' + size, memory = 'mr2-memory-' + size + '-'
    await messages.insert({ ...fixture.messages[0], id: source, revision: 1, lifeSources: [] })
    await messages.insert({ ...fixture.messages[0], id: reply, revision: 1, lifeSources: [], replyToMessageId: source, replyToRevision: 1 })
    assert.equal(db.prepare(grantOriginActors).run(size - 1, prefix, worldId, instanceId).changes, size)
    assert.equal(db.prepare(grantOrigins).run(worldId, prefix + '*').changes, size)
    assert.equal(db.prepare(grantMessageTags).run(source, worldId, prefix + '*').changes, size)
    db.prepare(memoryRows).run(0, memory, worldId, instanceId, instanceId)
    db.prepare(memoryWideSources).run(memory + '0', worldId, conversationId, reply)
    const ref = { messageId: reply, revision: 1 }
    state.queries.length = 0
    assert.equal((await domains.memories.readDetailFor(scope, memory + '0')).content, 'synthetic')
    assert.equal((await domains.memories.resolveSource(scope, memory + '0', ref)).content, fixture.messages[0].content)
    assert.ok(!state.queries.some(sql => sql.includes('SELECT DISTINCT l.grant_id') && sql.includes('JOIN message_life_sources l')))
    samples.push(state.queries.length)
    const deniedActor = prefix + (size - 1)
    await domains.autonomy.setGrant(worldId, deniedActor, 'todo', 1, { read: false, remember: false, share: false })
    state.queries.length = 0
    await assert.rejects(domains.memories.readDetailFor(scope, memory + '0'), /LIFE_PERMISSION_DENIED/)
    await assert.rejects(domains.memories.resolveSource(scope, memory + '0', ref), /LIFE_PERMISSION_DENIED/)
    assert.ok(!state.queries.some(sql => /SELECT (?:.*\bcontent\b|\*)\s+FROM (?:memories|messages)\b/i.test(sql)))
    t.diagnostic(JSON.stringify({ size, queries: samples.at(-1), projectedTags: 0, bodyReadsAfterRevocation: 0 }))
  }
  assert.equal(samples[0], samples[1])
})

test('R4 candidate share copies exact source metadata without reading body into JS or bypassing the recipient grant',async t=>{
  const { domains,fixture,messages,state,scope,db,other }=await setup(t)
  const peer=fixture.instances.find(actor=>actor.worldId===scope.worldId&&actor.id!==scope.instanceId)
  const grant=await domains.autonomy.setGrant(scope.worldId,scope.instanceId,'todo',2,{read:true,remember:true,share:true})
  const ref={messageId:'r4-share-msg',revision:1}
  await messages.insert({...fixture.messages[0],id:ref.messageId,revision:1,lifeSources:[{
    grantId:grant.id,revision:grant.revision,instanceId:scope.instanceId,moduleId:'todo',fingerprint:'c'.repeat(64),
  }]})
  const memory={id:'r4-share-memory',worldId:scope.worldId,ownerType:'character',ownerId:scope.instanceId,layer:'L3',
    key:'合成分享',content:'合成分享正文',status:'active',revision:1,visibility:'private',sourceRefs:[ref],knownBy:[scope.instanceId]}
  await domains.memories.save(memory,null)
  const share=recipient=>domains.memories.shareManaged(scope,memory.id,1,recipient,'share-r4')
  const sensitive=/SELECT (?:.*\bcontent\b|\*)\s+FROM (?:memories|messages)\b/i
  state.queries.length=0
  await assert.rejects(share(peer.id),/LIFE_PERMISSION_DENIED/)
  await assert.rejects(share(other.id),/SCOPE_DENIED/)
  assert.ok(!state.queries.some(sql=>sensitive.test(sql)))
  const peerGrant=await domains.autonomy.setGrant(scope.worldId,peer.id,'todo',null,{read:true,remember:true,share:false})
  state.queries.length=0
  state.failCommit=true
  await assert.rejects(share(peer.id),/injected commit/)
  state.failCommit=false
  assert.equal(db.prepare("SELECT count(*) AS total FROM memory_links WHERE kind='shared' AND target_memory_id=?").get(memory.id).total,0)
  const {id}=await share(peer.id)
  assert.equal((await share(peer.id)).id,id)
  assert.ok(!state.queries.some(sql=>sensitive.test(sql)))
  const recipient={worldId:scope.worldId,instanceId:peer.id}
  assert.equal((await domains.memories.readDetailFor(recipient,id)).content,memory.content)
  const page=await domains.memories.sourcePage(recipient,id)
  assert.deepEqual(page.entries,[ref])
  await assert.rejects(domains.memories.resolveSource(recipient,id,ref),/CONTEXT_DENIED/)
  await domains.autonomy.setGrant(scope.worldId,peer.id,'todo',peerGrant.revision,{read:false,remember:false,share:false})
  state.queries.length=0
  await assert.rejects(domains.memories.readDetailFor(recipient,id),/CONTEXT_DENIED|LIFE_PERMISSION_DENIED/)
  assert.ok(!state.queries.some(sql=>sensitive.test(sql)))
})

test('M4 outgoing share withdrawal is scoped, atomic and denies all downstream bodies',async t=>{
  const {domains,scope,fixture,state,db,other}=await setup(t)
  const [recipient,next]=fixture.instances.filter(actor=>actor.worldId===scope.worldId&&actor.id!==scope.instanceId)
  const item={id:'outgoing-origin',worldId:scope.worldId,ownerType:'character',ownerId:scope.instanceId,layer:'L3',
    key:'合成分享来源',content:'合成正文',status:'active',revision:1,visibility:'private',sourceRefs:[]}
  await domains.memories.save(item,null)
  const peer={worldId:scope.worldId,instanceId:recipient.id}
  const onward={worldId:scope.worldId,instanceId:next.id}
  const copy=await domains.memories.shareManaged(scope,item.id,1,recipient.id,'share-first')
  const child=await domains.memories.shareManaged(peer,copy.id,1,next.id,'share-second')
  assert.equal((await domains.memories.readDetailFor(onward,child.id)).content,item.content)
  await assert.rejects(domains.memories.listOutgoingShares(peer,item.id),/CONTEXT_DENIED/)
  await assert.rejects(domains.memories.listOutgoingShares({...scope,instanceId:other.id},item.id),/SCOPE_DENIED/)
  const shares=await domains.memories.listOutgoingShares(scope,item.id)
  assert.deepEqual(shares.entries.map(({id,recipientId,revision})=>[id,recipientId,revision]),[[copy.id,recipient.id,1]])
  const withdraw=()=>domains.memories.withdrawShare(scope,item.id,copy.id,1,'withdraw-first')
  await assert.rejects(domains.memories.withdrawShare(scope,item.id,child.id,1,'wrong-edge'),/CONTEXT_DENIED/)
  await assert.rejects(domains.memories.withdrawShare(scope,item.id,copy.id,2,'stale-copy'),/EDIT_CONFLICT/)
  state.failCommit=true
  await assert.rejects(withdraw(),/injected commit/)
  state.failCommit=false
  assert.equal((await domains.memories.readDetailFor(peer,copy.id)).content,item.content)
  await withdraw()
  await withdraw()
  assert.equal((await domains.memories.listOutgoingShares(scope,item.id)).entries.length,0)
  state.queries=[]
  await assert.rejects(domains.memories.readDetailFor(peer,copy.id),/CONTEXT_DENIED/)
  await assert.rejects(domains.memories.readDetailFor(onward,child.id),/CONTEXT_DENIED/)
  assert.ok(!state.queries.some(sql=>/SELECT .*content FROM memories/i.test(sql)))
  assert.equal(db.prepare('SELECT revision FROM memories WHERE world_id=? AND id=?').get(scope.worldId,copy.id).revision,2)
  assert.equal((await domains.memories.readDetailFor(scope,item.id)).content,item.content)
})

test('R4 conflicts page without body, bind the revisions, and retain discarded memories for review', async t=>{
  const {domains,scope,db}=await setup(t)
  const base={worldId:scope.worldId,ownerType:'character',ownerId:scope.instanceId,
    layer:'L3',key:'合成冲突',sourceRefs:[],status:'active',revision:1,visibility:'private'}
  await domains.memories.save({...base,id:'r4-conflict-old',content:'旧事实'},null)
  await domains.memories.save({...base,id:'r4-conflict-new',content:'新事实'},null)
  const preferred='r4-conflict-new', older='r4-conflict-old'
  const managed=await domains.memories.managedDetailFor(scope,preferred)
  assert.equal(managed.status,'candidate')
  assert.equal(managed.canManage,true)
  await assert.rejects(domains.memories.readDetailFor(scope,preferred),/CONTEXT_DENIED/)
  const first=await domains.memories.previewConflicts(scope,preferred)
  assert.equal(first.plan.count,1)
  assert.deepEqual(first.entries.map(row=>row.id),[older])
  db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(older)
  await assert.rejects(domains.memories.confirmConflicts(scope,first.plan,'r4-conflict-command'),/CONFLICT_PREVIEW_STALE/)
  const second=await domains.memories.previewConflicts(scope,preferred)
  await domains.memories.confirmConflicts(scope,second.plan,'r4-conflict-command')
  await domains.memories.confirmConflicts(scope,second.plan,'r4-conflict-command')
  assert.equal((await domains.memories.readDetailFor(scope,preferred)).content,'新事实')
  assert.equal((await domains.memories.managedDetailFor(scope,older)).content,'旧事实')
  assert.deepEqual({...db.prepare('SELECT status,revision FROM memories WHERE id=?').get(older)},{status:'stale',revision:3})
  assert.equal(db.prepare("SELECT target_memory_id FROM memory_links WHERE memory_id=? AND kind='superseded'").get(older).target_memory_id,preferred)
})

test('M4 custom memory merge keeps both exact sources and retries atomically',async t=>{
  const {domains,fixture,scope,messages,state}=await setup(t)
  const refs=[]
  for(const id of ['merge-source-a','merge-source-b']){
    await messages.insert({...fixture.messages[0],id,revision:1,lifeSources:[]})
    refs.push({messageId:id,revision:1})
  }
  const base={worldId:scope.worldId,ownerType:'character',ownerId:scope.instanceId,layer:'L3',key:'合成合并',
    status:'active',revision:1,visibility:'private'}
  await domains.memories.save({...base,id:'merge-a',sourceRefs:[refs[0]],content:'合成甲'},null)
  await domains.memories.save({...base,id:'merge-b',sourceRefs:[refs[1]],content:'合成乙'},null)
  const plan=(await domains.memories.previewConflicts(scope,'merge-b')).plan
  const merge=()=>domains.memories.confirmConflicts(scope,plan,'merge-user','用户合成核对')
  state.failCommit=true
  await assert.rejects(merge(),/injected commit/)
  state.failCommit=false
  assert.deepEqual((await domains.memories.sourcePage(scope,'merge-b',undefined,true)).entries,[refs[1]])
  await merge()
  await merge()
  assert.deepEqual((await domains.memories.sourcePage(scope,'merge-b')).entries,refs)
  assert.equal((await domains.memories.readFor(scope,'merge-b')).content,'用户合成核对')
  assert.equal((await domains.memories.managedDetailFor(scope,'merge-a')).status,'stale')
})

test('M4 correcting a confirmed event reuses the frozen scope and rolls back candidate and effects together',async t=>{
  const {domains,move,scope,state}=await setup(t)
  const {worldId}=scope
  const initial=await domains.events.proposeAcknowledged(move('原地点'),'correct-origin')
  const original=await domains.events.commitAcknowledged(worldId,initial.id,1)
  const plan=(await domains.events.openRevocation(worldId,original.id)).plan
  const correct=()=>domains.events.correctConfirmed(plan,'keep-independent','correct-key','合成修正')
  state.failCommit=true
  await assert.rejects(correct(),/injected commit/)
  state.failCommit=false
  assert.equal((await domains.events.managedEvent(worldId,original.id)).status,'committed')
  assert.equal((await domains.characters.getInstance(worldId,scope.instanceId)).state.location,'原地点')
  const receipt=await correct()
  assert.deepEqual(await correct(),receipt)
  assert.equal(receipt.revoked,1)
  assert.equal((await domains.events.managedEvent(worldId,original.id)).status,'revoked')
  const replacement=await domains.events.managedEvent(worldId,receipt.id)
  assert.equal(replacement.status,'candidate')
  assert.equal(replacement.summary,'合成修正')
  assert.notEqual((await domains.characters.getInstance(worldId,scope.instanceId)).state.location,'原地点')
})

test('M3 revoke retains independent same-path effects and atomically changes causal descendants', async t => {
  const { domains, state, scope, move } = await setup(t)
  const a = await domains.events.proposeAcknowledged(move('位置甲'), 'a')
  const b = await domains.events.proposeAcknowledged(move('位置乙'), 'b')
  const c = await domains.events.proposeAcknowledged({ ...move('位置丙'), causedByEventIds: [a.id] }, 'c')
  for (const event of [a, b, c]) await domains.events.commitAcknowledged(scope.worldId, event.id, 1)
  assert.equal((await domains.characters.getInstance(scope.worldId, scope.instanceId)).state.location, '位置丙')
  const plan = (await domains.events.openRevocation(scope.worldId,a.id)).plan
  assert.deepEqual((await domains.events.openRevocation(scope.worldId,a.id)).entries.map(row=>row.id),[a.id,c.id])
  state.failOn = 'UPDATE character_instances SET location'
  await assert.rejects(domains.events.confirmRevocation(plan,undefined,'test-revoke-'+plan.eventId), /injected/)
  assert.equal((await domains.events.readFor(scope.worldId, a.id, { instanceId: scope.instanceId, group: false })).status, 'committed')
  state.failOn = ''
  await domains.events.confirmRevocation(plan,undefined,'test-revoke-'+plan.eventId)
  await domains.events.confirmRevocation(plan,undefined,'test-revoke-'+plan.eventId)
  assert.equal((await domains.characters.getInstance(scope.worldId, scope.instanceId)).state.location, '位置乙')
  assert.equal((await domains.events.readFor(scope.worldId, b.id, { instanceId: scope.instanceId, group: false })).status, 'committed')
})

test('R3 folds 1k/10k interleaved same-path Effects in bounded legacy order', async t => {
  for (const size of [1000, 10000]) {
    const { db, domains, scope, move, state } = await setup(t)
    const event = await domains.events.proposeAcknowledged(move('撤销时不得覆盖独立效果'), 'revoke-'+size)
    await domains.events.commitAcknowledged(scope.worldId, event.id, 1)
    const seed = db.prepare(`INSERT INTO world_events(id,world_id,status,visibility,summary,effective_at,recorded_at,revision,causality)
      VALUES(?,?,'committed','private','合成',5000,5000,1,'explicit')`)
    const effect = db.prepare(`INSERT INTO world_effects(id,world_id,event_id,target_type,target_id,target_instance_id,operation,path,value_json,rule_version)
      VALUES(?,?,?,'instance',?,?,'set','state.location',?,1)`)
    const ids = Array.from({length:size},(_,index)=>'r'+size+'-'+String(index).padStart(5,'0')+['._','_-','-.',':.','aA','Aa'][index%6])
    ids.push('r'+size+'-zAz', 'r'+size+'-zaz', 'r'+size+'-z_Z', 'r'+size+'-z-Z')
    db.exec('BEGIN')
    for (const id of ids) {
      seed.run(id,scope.worldId)
      effect.run('fx-'+id,scope.worldId,id,scope.instanceId,scope.instanceId,JSON.stringify(id))
    }
    db.exec('COMMIT')
    const plan = (await domains.events.openRevocation(scope.worldId,event.id)).plan
    let maxRows=0, replayQueries=0
    state.observeRows=(sql,rows)=>{
      if(!sql.includes('FROM world_effects f JOIN world_events e'))return
      maxRows=Math.max(maxRows,rows)
      replayQueries++
    }
    await domains.events.confirmRevocation(plan,undefined,'test-revoke-'+plan.eventId)
    state.observeRows=undefined
    ids.sort((a,b)=>a.localeCompare(b,'en'))
    assert.equal((await domains.characters.getInstance(scope.worldId,scope.instanceId)).state.location,ids.at(-1))
    assert.ok(replayQueries>1&&maxRows<=128)
    // The replay order must come from the bounded SQL cursor, not a JS array of every Effect.
    assert.ok(state.queries.some(sql=>sql.includes('ORDER BY effective_at,recorded_at,event_key')))
    t.diagnostic(JSON.stringify({size,activeEffects:ids.length,maxRows,replayQueries}))
    // Order metadata is immutable. Each size owns its fresh synthetic fixture.
  }
})

test('R3 bounded confirmation pages freeze owned Effects and explicit/inferred decisions', async t=>{
  const {db,domains,move,scope,state}=await setup(t)
  const world=scope.worldId
  const events=domains.events
  const root=await events.proposeAcknowledged(move('根'), 'bounded-root')
  const child=await events.proposeAcknowledged({...move('明确后续'),causedByEventIds:[root.id]},'bounded-child')
  const independent=await events.proposeAcknowledged(move('独立后续'),'bounded-independent')
  const uncertain=await events.proposeAcknowledged({...move('推断后续'),causality:'unknown'},'bounded-inferred')
  for(const event of [root,child,independent,uncertain])await events.commitAcknowledged(world,event.id,1)
  const open=await events.openRevocation(world,root.id,undefined,1)
  const plan=open.plan
  assert.equal(plan.revokeCount,2)
  assert.equal(plan.uncertainCount,1)
  assert.ok(!('revokeIds' in plan))
  assert.deepEqual(open.entries.map(row=>[row.id,row.disposition]),[[root.id,'revoke']])
  const next=await events.openRevocation(world,root.id,open.cursor,1)
  assert.deepEqual(next.entries.map(row=>[row.id,row.disposition]),[[child.id,'revoke']])
  const last=await events.openRevocation(world,root.id,next.cursor,1)
  assert.deepEqual(last.entries.map(row=>[row.id,row.disposition]),[[uncertain.id,'uncertain']])
  assert.equal(last.cursor,null)
  await assert.rejects(events.openRevocation(world,independent.id,open.cursor,1),/CURSOR_STALE/)
  await assert.rejects(events.confirmRevocation(plan,undefined,'bounded-run'),/DEPENDENCY_UNCERTAIN/)
  db.prepare("UPDATE world_effects SET value_json=json_quote('合成变化') WHERE event_id=?").run(root.id)
  await assert.rejects(events.confirmRevocation(plan,'keep-independent','bounded-run'),/PREVIEW_STALE/)
  const fresh=(await events.openRevocation(world,root.id)).plan
  state.failCommit=true
  await assert.rejects(events.confirmRevocation(fresh,'mark-needs-review','bounded-run'),/injected commit/)
  state.failCommit=false
  assert.equal(db.prepare('SELECT status FROM world_events WHERE id=?').get(root.id).status,'committed')
  assert.deepEqual(await events.confirmRevocation(fresh,'mark-needs-review','bounded-run'),{revoked:2,needsReview:1})
  assert.deepEqual(await events.confirmRevocation(fresh,'mark-needs-review','bounded-run'),{revoked:2,needsReview:1})
  assert.equal((await domains.characters.getInstance(world,scope.instanceId)).state.location,'独立后续')
  const audits=await events.revocationAudits(world,root.id)
  assert.deepEqual(audits.entries.map(row=>[row.previousRevision,row.nextRevision,row.status,row.effectCount]),[[2,3,'revoked',1]])
  const recorded=await events.revocationEffectAudit(world,root.id,audits.entries[0].id)
  assert.equal(recorded.complete,true)
  assert.equal(recorded.total,1)
  assert.equal(recorded.entries[0].value,'合成变化')
  assert.equal(recorded.entries[0].path,'state.location')
  db.prepare("UPDATE world_effects SET value_json=json_quote('合成后写') WHERE event_id=?").run(root.id)
  assert.deepEqual(await events.revocationEffectAudit(world,root.id,audits.entries[0].id),recorded)
  await assert.rejects(events.revocationEffectAudit(world,independent.id,audits.entries[0].id),/AUDIT_UNAVAILABLE/)
  assert.equal(db.prepare('SELECT status FROM world_events WHERE id=?').get(independent.id).status,'committed')
  assert.equal(db.prepare('SELECT status FROM world_events WHERE id=?').get(uncertain.id).status,'needsReview')
})

test('M4 wide event confirmation covers 1k and 10k exact descendants and rolls back between batches',async t=>{
  const {db,domains,scope,state,move}=await setup(t)
  const {eventRows,eventFanout,replayEffectRows,fanoutAuditInspection}=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {worldId,instanceId}=scope
  const retained=await domains.events.proposeAcknowledged(move('保留独立位置'),'mr1-retained')
  await domains.events.commitAcknowledged(worldId,retained.id,1)
  for(const size of [1000,10000]){
    const prefix='event-fanout-'+size+'-',rootId=prefix+size
    db.prepare(eventRows).run(size,prefix,worldId)
    db.prepare(eventFanout).run(size-1,worldId,prefix,rootId)
    db.prepare(replayEffectRows).run(size,prefix+'effect-',worldId,prefix,instanceId,instanceId)
    let maxRows=0
    state.observeRows=(_sql,rows)=>{maxRows=Math.max(maxRows,rows)}
    const first=await domains.events.openRevocation(worldId,rootId)
    assert.equal(first.plan.revokeCount,size+1)
    assert.equal(first.plan.uncertainCount,0)
    const second=await domains.events.openRevocation(worldId,rootId,first.cursor)
    assert.deepEqual(second.plan,first.plan)
    assert.ok(second.entries[0].id>first.entries.at(-1).id)
    const snapshotBatches=Math.floor((size+1)/128)+1
    let selectionBatches=0
    state.observeRows=(sql,rows)=>{
      maxRows=Math.max(maxRows,rows)
      if(sql.includes('SELECT selected.*')&&++selectionBatches===snapshotBatches+2)throw new Error('CANCEL_BETWEEN_BATCHES')
    }
    const confirm=()=>domains.events.confirmRevocation(first.plan,'keep-independent',prefix+'command')
    await assert.rejects(confirm(),/CANCEL_BETWEEN_BATCHES/)
    const revoked=db.prepare("SELECT count(*) AS total FROM world_events WHERE world_id=? AND id GLOB ? AND status='revoked'")
    assert.equal(revoked.get(worldId,prefix+'*').total,0)
    state.observeRows=(_sql,rows)=>{maxRows=Math.max(maxRows,rows)}
    const {eventPlanWrites}=await import('../src/features/chat/storage/sqlite/kanataEventPlanOrder.js')
    const {captureEffectAuditBefore}=await import('../src/features/chat/storage/sqlite/kanataEffectAuditStorage.js')
    let allWrites=0,planWrites=0
    state.observeWrites=sql=>{allWrites++;if(eventPlanWrites.includes(sql)||sql===captureEffectAuditBefore)planWrites++}
    assert.deepEqual(await confirm(),{revoked:size+1,needsReview:0})
    state.observeWrites=undefined
    assert.ok(planWrites<=6&&allWrites-planWrites<=2*Math.ceil((size+1)/128)+3,JSON.stringify({allWrites,planWrites}))
    assert.ok(allWrites<=2*Math.ceil((size+1)/128)+9)
    assert.deepEqual(await confirm(),{revoked:size+1,needsReview:0})
    assert.equal(revoked.get(worldId,prefix+'*').total,size+1)
    const { events, original, revoked:confirmedRows, audits, exactAudits }=db.prepare(fanoutAuditInspection).get(worldId,prefix)
    assert.deepEqual({events,original,confirmedRows,audits,exactAudits},
      {events:size+1,original:0,confirmedRows:size+1,audits:size+1,exactAudits:size+1})
    assert.equal((await domains.characters.getInstance(worldId,instanceId)).state.location,'保留独立位置')
    assert.ok(maxRows<=128)
    t.diagnostic(JSON.stringify({size,confirmed:size+1,maxRows,allWrites,temporaryWrites:planWrites,persistentWrites:allWrites-planWrites,rollbackAfterFirstBatch:true,replayedReceipt:true}))
  }
})

test('M4 synthetic wide fixture preserves every edge and restores the runtime planner after seeding',async t=>{
  const {db,scope,operation}=await setup(t)
  const {eventRows,eventEdges,seedFanoutLinks}=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {worldId}=scope
  const deep='mr1-deep-', wide='mr1-wide-', size=10000, root=wide+size
  db.prepare(eventRows).run(size,deep,worldId)
  db.prepare(eventEdges).run(size-1,worldId,deep,deep)
  db.prepare(eventRows).run(size,wide,worldId)
  const result=await operation.transaction(tx=>seedFanoutLinks(tx,size,worldId,wide,root))
  assert.equal(result.affectedRows,size)
  assert.deepEqual(result.restored,result.before)
  assert.match(result.analyzed.join(' '),/world_id=\? AND event_id=\?/)
  assert.equal(db.prepare("SELECT count(*) AS total FROM sqlite_stat1 WHERE tbl='event_causes'").get().total,0)
  assert.equal(db.prepare('SELECT count(*) AS total FROM event_causes WHERE world_id=? AND cause_event_id=?').get(worldId,root).total,size)
  assert.throws(()=>db.prepare('INSERT INTO event_causes(world_id,event_id,cause_event_id) VALUES(?,?,?)').run(worldId,root,wide+'0'),
    /KANATA_EVENT_CAUSAL_CYCLE/)
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
  const { db, domains, fixture, scope, move, state } = await setup(t)
  const outsider = fixture.instances.find(actor => actor.worldId === scope.worldId && actor.id !== scope.instanceId)
  const event = await domains.events.proposeAcknowledged(move('私有活动'), 'private-effect')
  await domains.events.commitAcknowledged(scope.worldId, event.id, 1)
  state.queries.length = 0
  const projected = await domains.events.context(scope.worldId, { instanceId: outsider.id, group: false }, [scope.instanceId])
  assert(projected.hiddenTargetIds.has(scope.instanceId))
  assert.equal(projected.events.some(row => row.id === event.id), false)
  assert(!state.queries.some(sql => /^SELECT (?:\*|.*summary) FROM world_events/.test(sql)))
  state.queries.length = 0
  await domains.characters.conversationActors(scope.worldId, [scope.instanceId], projected.hiddenTargetIds)
  assert(!state.queries.some(sql => /SELECT.*\bmood\b/.test(sql)))
  const audit = await testEventAudits(db,scope.worldId, event.id)
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

test('R4 1k and 10k direct and mixed source graphs stay paged and deny stale tails before content',async t=>{
  const {db,state,scope,domains,fixture}=await setup(t)
  const seeds=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {growthSeedSql}=await import('../docs/qa/kanata-sqlite-m4/fixture.mjs')
  const sender=fixture.identities.find(row=>row.worldId===scope.worldId).id
  for(const size of [1000,10000]){
    const memory='r4-mixed-'+size+'-',wide='r4-wide-'+size+'-'
    db.exec('BEGIN')
    db.prepare(seeds.memoryRows).run(size,memory,scope.worldId,scope.instanceId,scope.instanceId)
    db.prepare(seeds.memoryEdges).run(size-1,scope.worldId,memory,memory)
    db.prepare(growthSeedSql).run(size,wide,scope.worldId,scope.conversationId,sender)
    db.prepare(seeds.memoryRows).run(0,wide,scope.worldId,scope.instanceId,scope.instanceId)
    for(const id of [wide+'0',memory+size]){
      assert.equal(db.prepare(seeds.memoryWideSources).run(id,scope.worldId,scope.conversationId,wide+'-history-*').changes,size)
    }
    db.exec('COMMIT')
    const trace={queries:0,maxRows:0,bodies:0}
    state.observeRows=(sql,rows)=>{
      trace.queries++
      trace.maxRows=Math.max(trace.maxRows,rows)
      if(/SELECT id,memory_key,content/.test(sql))trace.bodies+=rows
    }
    for(const id of [wide+'0',memory+'0']){
      Object.assign(trace,{queries:0,maxRows:0,bodies:0})
      assert.equal((await domains.memories.readDetailFor(scope,id)).id,id)
      assert.equal(trace.bodies,1)
      assert.equal(trace.maxRows,50)
      t.diagnostic(JSON.stringify({size,shape:id.startsWith(wide)?'wide':'mixed',...trace}))
    }
    const tail=wide+'-history-'+size
    assert.equal(db.prepare('UPDATE messages SET revision=revision+1 WHERE world_id=? AND id=?').run(scope.worldId,tail).changes,1)
    trace.bodies=0
    await assert.rejects(domains.memories.readDetailFor(scope,memory+'0'),/KANATA_SOURCE_STALE/)
    assert.equal(trace.bodies,0)
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

test('GROUP-01–05 membership editing uses history, scope, CAS and an atomic receipt', async t => {
  const { domains, fixture, messages, scope, state, other } = await setup(t)
  const [a, b, c] = fixture.instances.filter(row => row.worldId === scope.worldId).map(row => row.id)
  const repo = domains.conversations
  const create = async id => {
    await repo.createGroup(scope.worldId, { title:'合成成员编辑', instanceIds:[a,b] }, { id, commandId:id })
    return { worldId:scope.worldId, conversationId:id }
  }
  const command = (key, hasHistory, ids = [c,a]) => ({
    expectedRevision:1, expectedHistory:hasHistory, instanceIds:ids, commandId:key, newGroupId:'copy-'+key,
  })
  const send = async (target, id, from, reply) => {
    const message = { ...fixture.messages[from], id, conversationId:target.conversationId, lifeSources:[],
      ...(reply && { replyToMessageId:reply.id, replyToRevision:reply.revision }) }
    await messages.insertBatch([message])
    return message
  }

  const empty = await create('group-empty')
  const identity = (await repo.get(empty)).participantIds[0]
  const beforeEdit = await repo.groupEdit(empty)
  assert.equal(beforeEdit.hasHistory, false)
  const firstPage = await repo.groupMemberPage(empty, beforeEdit.revision, 0, 1)
  assert.deepEqual(firstPage.entries.map(row => row.id), [a])
  assert.deepEqual((await repo.groupMemberPage(empty, beforeEdit.revision, firstPage.cursor, 1)).entries.map(row => row.id), [b])
  const inPlace = command('empty-edit', false)
  assert.deepEqual(await repo.editGroupMembers(empty, inPlace), { id:empty.conversationId, created:false })
  assert.deepEqual(await repo.editGroupMembers(empty, inPlace), { id:empty.conversationId, created:false })
  assert.deepEqual((await repo.get(empty)).participantIds, [identity,c,a])
  assert.equal((await repo.get(empty)).revision, 2)
  assert.equal(await messages.count(empty), 0)
  await assert.rejects(repo.groupMemberPage(empty, 1), /REVISION_CONFLICT/)
  await assert.rejects(repo.editGroupMembers(empty, command('stale-edit', false)), /REVISION_CONFLICT/)

  const prior = await create('group-prior')
  const root = await send(prior,'member-edit-root',0)
  const reply = await send(prior,'member-edit-reply',1,root)
  const before = await repo.get(prior)
  const history = await messages.recent(prior)
  assert.equal((await repo.groupEdit(prior)).hasHistory, true)
  await assert.rejects(repo.editGroupMembers(prior, command('foreign-history', true, [a,other.id])), /INVALID_GROUP_PARTICIPANTS/)
  const move = command('history-edit', true)
  const result = await repo.editGroupMembers(prior, move)
  assert.deepEqual(result, { id:move.newGroupId, created:true })
  assert.deepEqual(await repo.editGroupMembers(prior, move), result)
  assert.deepEqual(await repo.get(prior), before)
  assert.deepEqual(await messages.recent(prior), history)
  assert.equal((await messages.get(prior,reply.id)).replyToMessageId, root.id)
  const fresh = { ...prior, conversationId:result.id }
  assert.deepEqual((await repo.get(fresh)).participantIds, [identity,c,a])
  assert.equal(await messages.count(fresh), 0)
  assert.deepEqual((await messages.searchHistory(fresh,root.content)).messages, [])
  assert.equal(await messages.locate(fresh,root.id), null)
  assert.equal(await messages.quote(fresh,root.id), null)
  assert.deepEqual(await messages.historyForSpeaker(fresh,c,10), [])
  assert.ok((await messages.historyForSpeaker(prior,b,10)).some(row => row.id===root.id))

  const race = await create('group-race')
  assert.equal((await repo.groupEdit(race)).hasHistory, false)
  await assert.rejects(repo.editGroupMembers(race, command('foreign-empty', false, [a,other.id])), /INVALID_GROUP_PARTICIPANTS/)
  const arrival = await send(race,'member-edit-arrival',0)
  const afterArrival = await repo.get(race)
  const confirm = command('race-edit', false)
  await assert.rejects(repo.editGroupMembers(race, confirm), /KANATA_GROUP_HISTORY_CHANGED/)
  assert.deepEqual(await repo.get(race), afterArrival)
  assert.equal(await repo.get({ ...race, conversationId:confirm.newGroupId }), null)

  await domains.memories.archiveSource(race.worldId, { messageId:arrival.id, revision:arrival.revision })
  assert.equal((await repo.groupEdit(race)).hasHistory, true)
  const confirmed = { ...confirm, expectedHistory:true }
  state.failOn='INSERT INTO domain_command_receipts'
  await assert.rejects(repo.editGroupMembers(race, confirmed), /injected statement failure/)
  state.failOn=''
  state.failCommit=true
  await assert.rejects(repo.editGroupMembers(race, confirmed), /injected commit failure/)
  state.failCommit=false
  assert.equal(await repo.get({ ...race, conversationId:confirm.newGroupId }), null)
  assert.deepEqual(await repo.get(race), afterArrival)
  await repo.editGroupMembers(race, confirmed)
  await repo.editGroupMembers(race, confirmed)
  await assert.rejects(repo.editGroupMembers(race, { ...confirmed, instanceIds:[a,c] }), /IDEMPOTENCY_CONFLICT/)

  const deleted = await create('group-deleted')
  const tombstone = await send(deleted, 'member-edit-deleted', 0)
  await messages.revise(deleted,tombstone.id,tombstone.revision,{content:'',deleted:true})
  assert.equal((await repo.groupEdit(deleted)).hasHistory, true)
  await assert.rejects(repo.editGroupMembers(deleted, command('deleted-edit', false)), /HISTORY_CHANGED/)
})

test('MR2 event write acknowledgements preserve 1k/10k mixed provenance, legacy snapshots and rollback', async t => {
  const { seedWideChatSources } = await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const { db, state, fixture, domains, messages, scope, other, move, operation } = await setup(t)
  await domains.autonomy.setGrant(scope.worldId,scope.instanceId,'todo',2,{read:true,remember:true,share:true})
  const { lifeSources:_life, ...sample } = fixture.messages[0]
  for (const size of [1000,10000]) {
    const source = 'write-source-' + size, idempotency = 'event-proof-' + size
    await messages.insert({...sample,id:source,revision:1,createdAt:size+2000})
    const seeds = await operation.transaction(tx=>seedWideChatSources(tx,scope,source,size))
    const refs = [{messageId:source,revision:1,future:{nested:null}}]
    const local = db.prepare('SELECT id,revision FROM life_grants WHERE world_id=? AND instance_id=? AND module_id=?').get(scope.worldId,scope.instanceId,'todo')
    const tag = {grantId:local.id,instanceId:scope.instanceId,moduleId:'todo',revision:local.revision,fingerprint:'f'.repeat(64)}
    const fields = {...move('来源顺序'),sourceRefs:refs,causedByEventIds:[seeds.eventId],
      visibility:'public', participantIds:['g4-origin-'+size+'-0',scope.instanceId],
      future:{nested:[null,3,{key:'保留'}]}, action:{instanceId:scope.instanceId,location:'来源顺序',future:null},
      lifeSources:[{...tag,instanceId:'wrong-owner',future:'old'},{...tag,future:'last'}]}
    let maxRows=0, fullReads=0
    state.observeRows=(sql,rows)=>{
      maxRows=Math.max(maxRows,rows)
      if (/SELECT \* FROM world_events|SELECT id,at,previous_json/.test(sql)) fullReads++
    }
    state.queries.length=0
    const {id}=await domains.events.proposeAcknowledged(fields,idempotency)
    assert.deepEqual(await domains.events.proposeAcknowledged(fields,idempotency),{id})
    state.failCommit=true
    await assert.rejects(()=>domains.events.commitAcknowledged(scope.worldId,id,1),/injected commit failure/)
    state.failCommit=false
    assert.equal((await domains.events.managedEvent(scope.worldId,id)).revision,1)
    const allowed=await domains.events.commitAcknowledged(scope.worldId,id,1)
    assert.deepEqual(allowed,{id})
    assert.deepEqual(await domains.events.commitAcknowledged(scope.worldId,id,1),{id})
    assert.equal(fullReads,0)
    assert.ok(maxRows<=50)
    t.diagnostic(JSON.stringify({size,maxRows,fullReads,queries:state.queries.length}))
    state.observeRows=undefined
    const audit=(await testEventAudits(db,scope.worldId,id)).audits
    assert.equal(audit.length,1)
    const before=audit[0].previous
    assert.deepEqual(before.sourceRefs,refs)
    assert.deepEqual(before.participantIds,fields.participantIds)
    assert.deepEqual(before.future,fields.future)
    assert.deepEqual(before.action,fields.action)
    assert.equal(before.lifeSources.length,size+1)
    assert.deepEqual(before.lifeSources[0],{...tag,future:'last'})
    const oldOrder=db.prepare('SELECT grant_id FROM message_life_sources WHERE world_id=? AND message_id=? ORDER BY grant_id').all(scope.worldId,source).map(row=>row.grant_id)
    assert.deepEqual(before.lifeSources.slice(1).map(value=>value.grantId),oldOrder)
    const current=await testEvent(db,scope.worldId,id)
    assert.deepEqual(audit[0].next,current)
    assert.deepEqual((await testEventEffects(db,scope.worldId,id)).map(effect=>effect.value),['来源顺序'])
    const plan=(await domains.events.openRevocation(scope.worldId,id)).plan
    state.observeRows=(sql)=>{
      if (/SELECT \* FROM world_events|SELECT id,at,previous_json/.test(sql)) fullReads++
    }
    const replacement=await domains.events.correctConfirmed(plan,undefined,idempotency+'-correct','合成修正')
    assert.deepEqual(await domains.events.correctConfirmed(plan,undefined,idempotency+'-correct','合成修正'),replacement)
    assert.equal(fullReads,0)
    state.observeRows=undefined
    const corrected=await testEvent(db,scope.worldId,replacement.id)
    assert.equal(corrected.replacesEventId,id)
    assert.deepEqual(corrected.sourceRefs,refs)
    assert.deepEqual(corrected.lifeSources,current.lifeSources)
    assert.equal((await domains.events.revocationAudits(scope.worldId,id)).entries.length,1)
    await domains.autonomy.setGrant(scope.worldId,seeds.deniedActor,'todo',1,{read:false,remember:false,share:false})
    state.queries.length=0
    await assert.rejects(()=>domains.events.readFor(scope.worldId,seeds.eventId,{instanceId:scope.instanceId,group:false}),/KANATA_LIFE_PERMISSION_DENIED/)
    assert.equal(state.queries.some(sql=>sql.startsWith('SELECT * FROM world_events')),false)
    await assert.rejects(()=>domains.events.proposeAcknowledged(fields,idempotency+'-denied'),/KANATA_LIFE_PERMISSION_DENIED/)
    await assert.rejects(()=>domains.events.proposeAcknowledged({...fields,sourceRefs:[{messageId:source,revision:2}]},idempotency+'-stale'),/KANATA_SOURCE_STALE/)
    await assert.rejects(()=>domains.events.proposeAcknowledged({...fields,worldId:other.worldId},idempotency+'-cross-world'),/KANATA_SOURCE_STALE/)
  }
})

test('MR2 rejects duplicate or damaged event relation hints before publishing state', async t => {
  const {db,domains,scope,move}=await setup(t)
  const {worldId,instanceId}=scope
  const other=db.prepare('SELECT id FROM participants WHERE world_id=? AND id<>? LIMIT 1').get(worldId,instanceId).id
  const fields={...move('合成完整性'),participantIds:[other,instanceId]}
  const changeHint=db.prepare("UPDATE world_events SET extensions_json=json_set(extensions_json,'$.participantIds',json(?)) WHERE world_id=? AND id=?")
  for(const [index,hint] of [[0,[instanceId,instanceId]],[1,[instanceId]],[2,[instanceId,'missing-role']],[3,null]]) {
    const {id}=await domains.events.proposeAcknowledged(fields,'invalid-event-hint-'+index)
    changeHint.run(JSON.stringify(hint),worldId,id)
    await assert.rejects(()=>domains.events.commitAcknowledged(worldId,id,1),/KANATA_SQLITE_INTEGRITY_FAILED/)
    assert.equal((await domains.events.managedEvent(worldId,id)).revision,1)
    assert.deepEqual(await testEventEffects(db,worldId,id),[])
  }
})

test('MR2 event reads page 1k/10k relations, Effects and audits without hydrating snapshots', async t => {
  const {seedWideChatSources,eventReadEffects,eventReadAudits,eventReadRevision}=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {db,state,fixture,domains,messages,scope,move,operation}=await setup(t)
  const {worldId,instanceId}=scope
  const viewer={instanceId,group:false}
  const {lifeSources:_life,...sample}=fixture.messages[0]
  const {events,autonomy}=domains
  await autonomy.setGrant(worldId,instanceId,'todo',2,{read:true,remember:true,share:true})
  for(const size of [1000,10000]){
    const source='event-read-source-'+size
    await messages.insert({...sample,id:source,revision:1,createdAt:size+3000})
    const seeds=await operation.transaction(tx=>seedWideChatSources(tx,scope,source,size))
    const ref={messageId:source,revision:1,extension:'界😀'.repeat(3500)}
    const {id}=await events.proposeAcknowledged({...move('读取'),causedByEventIds:[seeds.eventId],sourceRefs:[ref],
      future:{missing:null,value:'界😀'.repeat(4500)}},'read-page-'+size)
    await events.commitAcknowledged(worldId,id,1)
    await operation.transaction(async tx=>{
      await tx.execute(eventReadEffects,[size-1,'zz-effect-'+size+'-',worldId,id,instanceId,instanceId])
      await tx.execute(eventReadRevision,[size+2,worldId,id])
      await tx.execute(eventReadAudits,[size-1,'zz-audit-'+size+'-',worldId,id])
    })
    const oracle=await testEvent(db,worldId,id)
    const audit=(await testEventAudits(db,worldId,id)).audits[0]
    let maxRows=0
    state.queries.length=0
    state.observeRows=(_sql,count)=>{maxRows=Math.max(maxRows,count)}
    const header=await events.readFor(worldId,id,viewer)
    assert.equal(header.status,'committed')
    assert.equal(Object.hasOwn(header,'lifeSources'),false)
    assert.ok((await events.list(worldId)).events.every(event=>!Object.hasOwn(event,'sourceRefs')))
    let cursor
    let index=0
    do {
      const page=await events.relations(worldId,id,'lifeSources',null,cursor)
      assert.ok(page.entries.length<=50)
      for(const entry of page.entries)assert.deepEqual(entry.value,oracle.lifeSources[index++])
      cursor=page.cursor??undefined
    } while(cursor)
    assert.equal(index,size)
    const refs=await events.relations(worldId,id,'sourceRefs',viewer)
    assert.deepEqual(refs.entries,[{position:0,chunked:true}])
    async function stream(selection,scope=null){
      let cursor, json=''
      do{
        const chunk=await events.jsonChunk(worldId,id,selection,scope,cursor)
        assert.ok(Array.from(chunk.part).length<=4096)
        json+=chunk.part
        cursor=chunk.cursor??undefined
      }while(cursor)
      return JSON.parse(json)
    }
    assert.deepEqual(await stream({kind:'relation',relation:'sourceRefs',position:0},viewer),ref)
    assert.deepEqual((await stream({kind:'extensions'})).future,oracle.future)
    assert.deepEqual(await stream({kind:'audit',auditId:audit.id,side:'next',snapshotRevision:2}),audit.next)
    assert.deepEqual(await stream({kind:'audit',auditId:audit.id,side:'previous',snapshotRevision:1,field:'sourceRefs'}),audit.previous.sourceRefs)
    const firstEffect=await events.effects(worldId,id)
    await assert.rejects(()=>events.audits(worldId,id,firstEffect.cursor),/EVENT_READ_CURSOR_STALE/)
    for(const kind of ['effects','audits']){
      let count=0, cursor
      do{
        const page=await events[kind](worldId,id,cursor)
        count+=page.entries.length
        assert.ok(page.entries.every(value=>!Object.hasOwn(value,'previous')&&!Object.hasOwn(value,'next')))
        cursor=page.cursor??undefined
      }while(cursor)
      assert.equal(count,size+1)
    }
    const first=await events.relations(worldId,id,'lifeSources',null)
    await assert.rejects(()=>events.relations(worldId,id,'lifeSources',viewer,first.cursor),/EVENT_READ_CURSOR_STALE/)
    await autonomy.setGrant(worldId,seeds.deniedActor,'todo',1,{read:false,remember:false,share:false})
    const queries=state.queries.length
    await assert.rejects(()=>events.readFor(worldId,id,viewer),/KANATA_LIFE_PERMISSION_DENIED/)
    assert.ok(!state.queries.slice(queries).some(sql=>sql.includes('AS action_type')))
    db.prepare('UPDATE world_events SET revision=revision+1 WHERE world_id=? AND id=?').run(worldId,id)
    await assert.rejects(()=>events.relations(worldId,id,'lifeSources',null,first.cursor),/EVENT_READ_CURSOR_STALE/)
    assert.ok(maxRows<=51)
    t.diagnostic(JSON.stringify({size,maxRows,queries:state.queries.length,relations:index}))
  }
})

test('MR2 historical action oracle preserves UTF-16 object spread and JSON kinds', async t=>{
  const {db,domains,scope,move}=await setup(t)
  const {worldId}=scope
  const {events}=domains
  const inputs=['','ascii','界','😀','\ud800','x😀界\udc00',null,['😀',null],{future:'界'},undefined]
  for(const [index,input] of inputs.entries()){
    const {id}=await events.proposeAcknowledged({...move('oracle'),kind:'note',action:{}},'read-action-'+index)
    const raw={participantIds:[scope.instanceId],causedByEventIds:[],sourceRefs:[]}
    if(input!==undefined)raw.action=input
    db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?').run(JSON.stringify(raw),worldId,id)
    const before=await testEvent(db,worldId,id)
    if(input===undefined)assert.equal(Object.hasOwn(before,'action'),false)
    else assert.deepEqual(before.action,{...input})
    await events.commitAcknowledged(worldId,id,1)
    const [audit]=(await testEventAudits(db,worldId,id)).audits
    assert.deepEqual(audit.previous,before)
    assert.deepEqual(audit.next,{...before,status:'committed',revision:2})
  }
})

test('MR2 relationship header and reverse event pages preserve exact IDs and reject stale cursors',async t=>{
  const {db,domains,scope,move}=await setup(t)
  const {worldId,instanceId}=scope
  const {events}=domains
  const {id,to_id:toId}=db.prepare('SELECT id,to_id FROM relationships WHERE world_id=? AND from_id=? LIMIT 1').get(worldId,instanceId)
  for(const n of [1,2]){
    const {id:eventId}=await events.proposeAcknowledged({...move('relationship'),kind:'support',
      participantIds:[instanceId,toId],action:{relationshipId:id}},'relationship-event-'+n)
    await events.commitAcknowledged(worldId,eventId,1)
  }
  const legacy=await testRelationship(db,worldId,id)
  const {sourceEventIds,...header}=legacy
  assert.deepEqual(await events.relationship(worldId,id),header)
  const first=await events.relationshipEvents(worldId,id,undefined,1)
  assert.deepEqual(first.entries,sourceEventIds.slice(0,1))
  assert.deepEqual((await events.relationshipEvents(worldId,id,first.cursor,1)).entries,sourceEventIds.slice(1))
  db.prepare('UPDATE relationships SET revision=revision+1 WHERE world_id=? AND id=?').run(worldId,id)
  await assert.rejects(()=>events.relationshipEvents(worldId,id,first.cursor,1),/RELATIONSHIP_EVENT_CURSOR_STALE/)
})

test('MR2 event read deep, wide and mixed graphs retain all 1k/10k nodes and pure-domain confirmation order',async t=>{
  const {eventRows,seedEventReadShape,chatEventActor}=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {operation,domains,scope,state}=await setup(t)
  const {worldId,instanceId}=scope
  const {events}=domains
  for(const size of [1000,10000])for(const shape of ['deep','wide','mixed']){
    const prefix='read-'+shape+'-'+size+'-'
    await operation.transaction(async tx=>{
      assert.equal((await tx.execute(eventRows,[size,prefix,worldId])).affectedRows,size+1)
      assert.equal((await seedEventReadShape(tx,size,worldId,prefix,shape)).affectedRows,size)
      await tx.execute(chatEventActor,[worldId,prefix+'0',instanceId])
    })
    state.queries.length=0
    assert.equal((await events.readFor(worldId,prefix+'0',{instanceId,group:false})).id,prefix+'0')
    let cursor,count=0
    do{
      const page=await events.graphPage(worldId,prefix+'0','cause',cursor)
      count+=page.entries.length
      cursor=page.cursor??undefined
    }while(cursor)
    assert.equal(count,size)
    const leaf=prefix+size
    const {previewKanataEventRevoke}=await import('../src/features/chat/experience/kanataEvents.js')
    // Test-only metadata Oracle, ordered by the retained source array ordinal.
    const rows=await operation.transaction(tx=>tx.query(`SELECT e.id,e.status,e.effective_at,e.causality
      FROM event_array_order o JOIN world_events e ON e.world_id=o.world_id AND e.id=o.entity_id
      WHERE o.world_id=? ORDER BY o.ordinal`,[worldId]))
    const edges=await operation.transaction(tx=>tx.query('SELECT event_id,cause_event_id FROM event_causes WHERE world_id=?',[worldId]))
    const causes=new Map()
    for(const edge of edges){const values=causes.get(edge.event_id)??[];values.push(edge.cause_event_id);causes.set(edge.event_id,values)}
    const oracle=previewKanataEventRevoke({events:rows.map(row=>({id:row.id,worldId,status:row.status,
      effectiveAt:row.effective_at,causality:row.causality,causedByEventIds:causes.get(row.id)??[]})),effects:[],effectBaselines:[]},leaf)
    const {eventRevocationQueries}=await import('../src/features/chat/storage/sqlite/kanataEventRevocation.js')
    const first=await events.openRevocation(worldId,leaf)
    const plan=first.plan,ids=[]
    let after='',lastAfter=''
    // Inspect bounded SQL pages inside their actual plan lifetime, then exercise
    // public first/last pages including a full incremental world signature.
    const {withEventPlan}=await import('../src/features/chat/storage/sqlite/kanataEventPlanOrder.js')
    await operation.transaction(tx=>withEventPlan(tx,worldId,leaf,async()=>{for(;;){
      const rows=await tx.query(eventRevocationQueries[1],[worldId,leaf,after,51])
      ids.push(...rows.slice(0,50).filter(row=>row.disposition==='revoke').map(row=>row.id))
      lastAfter=after
      if(rows.length<=50)break
      after=String(rows[49].sort_key)
    }}))
    if(lastAfter){
      const last=await events.openRevocation(worldId,leaf,{plan,after:lastAfter})
      assert.equal(last.cursor,null)
      assert.deepEqual(last.entries.filter(row=>row.disposition==='revoke').map(row=>row.id),ids.slice(-last.entries.length))
    }
    assert.deepEqual(ids,oracle.revokeIds)
    t.diagnostic(JSON.stringify({size,shape,nodes:count,confirm:plan.revokeCount,queries:state.queries.length}))
  }
})

test('MR2 cached event integrity rejects same-revision mutations and rolls back a failed read transaction',async t=>{
  const {db,domains,scope,move,state}=await setup(t)
  const {events}=domains,{worldId}=scope
  const {id}=await events.proposeAcknowledged(move('缓存完整性'),'integrity-cache')
  await events.relations(worldId,id,'participantIds',null)
  const stored=db.prepare('SELECT extensions_json FROM world_events WHERE world_id=? AND id=?').get(worldId,id).extensions_json
  const update=db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?')
  const bad={...JSON.parse(stored),participantIds:[scope.instanceId,scope.instanceId]}
  update.run(JSON.stringify(bad),worldId,id)
  await assert.rejects(()=>events.relations(worldId,id,'participantIds',null),/KANATA_SQLITE_INTEGRITY_FAILED/)
  update.run(stored,worldId,id)
  state.failCommit=true
  await assert.rejects(()=>events.relations(worldId,id,'participantIds',null),/injected commit failure/)
  state.failCommit=false
  assert.deepEqual((await events.relations(worldId,id,'participantIds',null)).entries,[{position:0,value:scope.instanceId}])
  assert.equal(db.prepare('SELECT count(*) AS n FROM temp.kanata_event_integrity').get().n,1)
})

test('MR2 integrity proof invalidates on another SQLite connection commit',async t=>{
  const {mkdtempSync,rmSync,rmdirSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const folder=mkdtempSync(join(tmpdir(),'kanata-event-integrity-'))
  const path=join(folder,'synthetic.sqlite')
  const {db,domains,scope,move}=await setup(t,path)
  const external=new DatabaseSync(path)
  external.exec('PRAGMA foreign_keys=ON')
  t.after(()=>{
    if(external.isOpen)external.close()
    if(db.isOpen)db.close()
    for(const suffix of ['', '-wal', '-shm'])rmSync(path+suffix,{force:true})
    rmdirSync(folder)
  })
  const {events}=domains,{worldId}=scope
  const {id}=await events.proposeAcknowledged(move('跨连接完整性'),'external-integrity')
  await events.relations(worldId,id,'participantIds',null)
  const {extensions_json:raw}=db.prepare('SELECT extensions_json FROM world_events WHERE world_id=? AND id=?').get(worldId,id)
  const originalChanges=db.prepare('SELECT total_changes() AS n').get().n
  external.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?')
    .run(JSON.stringify({...JSON.parse(raw),participantIds:[]}),worldId,id)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,originalChanges)
  await assert.rejects(()=>events.relations(worldId,id,'participantIds',null),/KANATA_SQLITE_INTEGRITY_FAILED/)
  await assert.rejects(()=>events.jsonChunk(worldId,id,{kind:'summary'},null),/KANATA_SQLITE_INTEGRITY_FAILED/)
})

test('MR2 event read keeps the legacy depth limit for unknown extension JSON',async t=>{
  const {db,domains,scope,move}=await setup(t)
  const {events}=domains,{worldId}=scope
  const {id}=await events.proposeAcknowledged(move('扩展深度'),'extension-depth')
  let value=null
  for(let i=0;i<65;i++)value={child:value}
  const raw={participantIds:[scope.instanceId],sourceRefs:[],causedByEventIds:[],future:value}
  db.prepare('UPDATE world_events SET extensions_json=? WHERE world_id=? AND id=?').run(JSON.stringify(raw),worldId,id)
  await assert.rejects(()=>events.commitAcknowledged(worldId,id,1),/KANATA_SQLITE_INTEGRITY_FAILED/)
  await assert.rejects(()=>events.relations(worldId,id,'participantIds',null),/KANATA_SQLITE_INTEGRITY_FAILED/)
  await assert.rejects(()=>events.jsonChunk(worldId,id,{kind:'summary'},null),/KANATA_SQLITE_INTEGRITY_FAILED/)
})

test('MR2 role reads cannot opt into internal shared-memory event privileges',async t=>{
  const {grantOriginActors}=await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  const {operation,domains,scope,move}=await setup(t)
  const {events}=domains,{worldId,instanceId}=scope
  await operation.transaction(tx=>tx.execute(grantOriginActors,[0,'unlisted-reader-',worldId,instanceId]))
  const {id}=await events.proposeAcknowledged(move('仅原参与者可读'),'scope-extra')
  await events.commitAcknowledged(worldId,id,1)
  const injected={instanceId:'unlisted-reader-0',group:false,sharedMemory:true}
  await assert.rejects(()=>events.readFor(worldId,id,injected),/EVENT_CONTEXT_DENIED/)
  await assert.rejects(()=>events.jsonChunk(worldId,id,{kind:'summary'},injected),/EVENT_CONTEXT_DENIED/)
  await assert.rejects(()=>events.relations(worldId,id,'participantIds',injected),/EVENT_CONTEXT_DENIED/)
})
