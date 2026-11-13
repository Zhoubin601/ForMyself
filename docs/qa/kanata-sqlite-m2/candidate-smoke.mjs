import { auditOracle,correctionOracle } from '../kanata-sqlite-m4/m4-r/event-compat/final-closeout/bounded-event-oracle.mjs'
import { runEventSemanticsDevice } from '../kanata-sqlite-m4/m4-r/event-compat/final-closeout/event-semantics-device.mjs'
import { memoryRows, memoryEdges, memoryWideSources, eventRows, eventEdges, seedFanoutLinks, replayEventRows, replayEffectRows, fanoutAuditInspection, grantOriginActors, grantOrigins, grantMessageTags, seedWideChatSources, chatReplyTagCheck, eventReadEffects, eventReadAudits, eventReadRevision, eventReadShapeEdges, eventReadPublic, seedEventReadShape, chatEventActor, chatEventSource } from '../kanata-sqlite-m4/completion/fixture.mjs'
import { growthSeedSql } from '../kanata-sqlite-m4/fixture.mjs'
import { eventRevocationQueries, eventRevocationWrites } from '../../../src/features/chat/storage/sqlite/kanataEventRevocation.js'
import { eventPlanDdl,eventPlanWrites } from '../../../src/features/chat/storage/sqlite/kanataEventPlanOrder.js'
import { installSchema005Device, schema005AfterExecute, schema005BeforeCommit } from '../kanata-sqlite-m4/m4-r/event-compat/final-closeout/schema005-device.mjs'
import { eventReadQueries } from '../../../src/features/chat/storage/sqlite/kanataEventRead.js'
import { eventProofDdl, eventProofWrites } from '../../../src/features/chat/storage/sqlite/kanataEventProof.js'
import { replyProofDdl } from '../../../src/features/chat/storage/sqlite/kanataReplyProvenance.js'
import { receiptQuery, receiptWrite } from '../../../src/features/chat/storage/sqlite/kanataDomainRows.js'
import { sha256Text } from '../../../src/shared/crypto/sha256Text.js'
import { restoreState } from '../../../src/platform/storage/restoreState.js'
import { runM3DeviceScenario } from '../kanata-sqlite-m3/device-scenario.mjs'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick, ref } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { useAuthStore } from '../../../src/stores/auth.js'
import { createProtectedAccessStore } from '../../../src/stores/protectedAccess.js'
import { createProtectedModuleRegistry } from '../../../src/application/protectedModules.js'
import { createKanataSqliteCandidate } from '../../../src/application/kanataSqliteCandidate.js'
import { createKanataMessageRepository } from '../../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { deriveKanataSqliteKek } from '../../../src/platform/security/kanataSqliteKek.js'
import { createKanataSqliteChatRuntime } from '../../../src/application/kanataSqliteChatRuntime.js'
import { resolveKanataCharacter } from '../../../src/features/chat/domain/kanataManagementCore.js'
import AppFeedbackHost from '../../../src/components/AppFeedbackHost.vue'
import KanataCandidateHistoryPanel from '../../../src/features/chat/KanataCandidateHistoryPanel.vue'
import KanataCandidateWorkspace from '../../../src/features/chat/KanataCandidateWorkspace.vue'
import KanataConversationView from '../../../src/features/chat/KanataConversationView.vue'
import conversationStyle from '../../../src/features/chat/kanataManagement.css'

if (document.title !== 'M2_SQLCIPHER_SYNTHETIC' || !window.Capacitor?.isNativePlatform()) {
  throw new Error('SYNTHETIC_ANDROID_PAGE_REQUIRED')
}

const pinia = createPinia()
setActivePinia(pinia)
const auth = useAuthStore()
const target = {
  isDataLoaded: false, loadError: '',
  release() { this.isDataLoaded = false },
  suspendPersistence() {}, reencrypt() {}, flush() {},
}
const registry = createProtectedModuleRegistry([{
  id: 'chat', resolve: async () => target,
  load: async store => { store.isDataLoaded = true },
}])
const access = createProtectedAccessStore(registry, 'm2QaAccess')()
const bridge = registerPlugin('KanataSqlite')
let trace
let eventProfile
const profileNames = new Map([...eventRevocationQueries, ...eventRevocationWrites].map((sql, index) =>
  [sha256Text(sql), ['root', 'projected', 'selectionBatch', 'effectProof', 'baselineProof', 'completedEffects',
    'auditHeaders', 'auditEffectHeader', 'auditEffectPage', 'executionBatch', 'planCursor', 'stageAudit', 'writeAudit', 'staleMemories'][index]]))
async function profileBridge(name, command, action) {
  if (!eventProfile) return action(command)
  const label = profileNames.get(command.statement) ?? command.statement ?? name
  const arity = command.parameters?.length ?? 0
  const start = performance.now()
  console.info('MR1_START', JSON.stringify({ phase: eventProfile, name: label, arity,
    parameterChars: command.parameters?.reduce((total, value) => total + String(value).length, 0) ?? 0 }))
  const result = await action(command)
  console.info('MR1_END', JSON.stringify({ phase: eventProfile, name: label,
    elapsedMs: Math.round(performance.now() - start), rows: result?.rows?.length ?? result?.affectedRows ?? 0 }))
  return result
}
let groupCommitFault
let eventCommitFault
let replyCommitFault
let suspendCommit = false
let fanoutCrashArmed = false
let crashState = 'idle'
const candidate = createKanataSqliteCandidate({
  syntheticOnly: true, auth, access, bridge: {
    prepare: bridge.prepare, unlock: bridge.unlock, begin: options => profileBridge("begin", options, bridge.begin),
    async execute(command) {
      if (trace) {
        trace.writes++
        trace.observeWrite?.(command)
      }
      const result = await profileBridge("execute", command, bridge.execute)
      if (fanoutCrashArmed && command.statement === sha256Text(eventRevocationWrites[1])) {
        check(result.affectedRows===128, 'MR1_FIRST_AUDIT_BATCH')
        fanoutCrashArmed=false
        crashState='mr1-first-batch-uncommitted'
        return new Promise(()=>{})
      }
      if (eventCommitFault && command.statement===sha256Text(eventProofDdl[1])) {
        const statement=eventCommitFault
        eventCommitFault=undefined
        await bridge.execute({...command,statement,parameters:['g4-event-orphan','absent-card',1,'{}','{}','synthetic']})
      }
      if (replyCommitFault && command.statement===sha256Text(replyProofDdl[1])) {
        const statement=replyCommitFault
        replyCommitFault=undefined
        await bridge.execute({...command,statement,parameters:['g4-reply-orphan','absent-card',1,'{}','{}','synthetic']})
      }
      if (groupCommitFault && command.statement===sha256Text(receiptWrite) && command.parameters[0].includes('group:edit-members')) {
        const statement = groupCommitFault
        groupCommitFault = undefined
        await bridge.execute({...command,statement,parameters:['group-edit-orphan','absent-card',1,'{}','{}','synthetic']})
      }
      return schema005AfterExecute(command,result)
    },
    async query(command) {
      if(trace?.failQuery===command.statement)throw new Error('EVENT_READ_QUERY_INJECTED')
      const started=performance.now()
      const result = await profileBridge("query", command, bridge.query)
      if (trace) {
        trace.queries++
        if(trace.profile){
          const profile=trace.profile[command.statement]??={queries:0,elapsedMs:0,maxMs:0}
          const elapsed=performance.now()-started
          profile.queries++
          profile.elapsedMs+=elapsed
          profile.maxMs=Math.max(profile.maxMs,elapsed)
        }
        trace.maxRows = Math.max(trace.maxRows, result.rows.length)
        trace.observeQuery?.(result.rows, command)
      }
      return result
    },
    close: bridge.close, health: bridge.health, rollback: bridge.rollback, completeOpen: bridge.completeOpen,
    commit: async options => {
      await schema005BeforeCommit(options,bridge)
      if (!suspendCommit) return profileBridge("commit", options, bridge.commit)
      crashState = 'uncommitted-write-and-audit'
      return new Promise(() => {})
    },
  },
})
window.m2QaSmoke = async (password, create) => {
  // Isolated in-memory auth state, with the actual protected module lease queue.
  auth.savedMasterPwd = password
  auth.isLocked = false
  try { return await candidate.run({ create }, operation => operation.health()) }
  finally { auth.expireSession() }
}

function check(condition, code) {
  if (!condition) throw new Error(code)
}
window.m3QaScenario = async (password, fixture, failCommitSql) => {
  auth.savedMasterPwd = password
  auth.isLocked = false
  const runtime = candidate.createWorldRuntime(() => 1800000)
  try {
    const result = await runM3DeviceScenario(candidate, fixture, failCommitSql)
    const first = runtime.select(fixture.worlds[0].id)
    const pending = first.read()
    const second = runtime.select(fixture.worlds[1].id)
    await rejects(() => pending, 'KANATA_WORLD_OWNER_EXPIRED')
    check((await second.read()).world.id === fixture.worlds[1].id, 'WORLD_OWNER_READ')
    return { ...result, ownerSwitch: 'PASS' }
  }
  catch (error) { return { error: error.code ?? error.message } }
  finally { runtime.dispose(); auth.expireSession(); await candidate.release() }
}

window.m3QaArmWindow = (password, plan) => {
  auth.savedMasterPwd = password
  auth.isLocked = false
  crashState = 'idle'
  void candidate.withDomains({}, domains => {
    suspendCommit = true
    return domains.autonomy.completeWindow(plan, 3600000)
  }).catch(error => {
    crashState = error.code ?? error.message
  })
  return 'armed'
}

window.m3QaReopenWindow = async (password, plan) => {
  auth.savedMasterPwd = password
  auth.isLocked = false
  try {
    return await candidate.withDomains({}, async domains => {
      const before = await domains.worlds.get(plan.worldId)
      const tasks = await domains.autonomy.listTasks(plan.worldId)
      const absent = !tasks.tasks.some(task => task.idempotencyKey === plan.idempotencyKey)
      const committed = await domains.autonomy.completeWindow(plan, 3600000)
      return { before: before.world.lastSimulatedAt, absent, eventCount: committed.resultEventIds.length,
        after: (await domains.worlds.get(plan.worldId)).world.lastSimulatedAt }
    })
  } finally { auth.expireSession(); await candidate.release() }
}

const tools = { id: () => 'm2-qa-audit-' + crypto.randomUUID(), clock: () => 1300 }

async function rejects(action, code) {
  try { await action() }
  catch (failure) {
    check((failure.code ?? failure.message) === code, 'UNEXPECTED_' + (failure.code ?? failure.message))
    return
  }
  throw new Error('MISSING_' + code)
}

window.m2QaScenario = async (password, { commands, inspection, deferredCommit, sample, group }) => {
  const passed = []
  auth.savedMasterPwd = password
  auth.isLocked = false
  const { worldId, conversationId } = sample
  const scope = { worldId, conversationId }
  try {
    const health = await candidate.run({ create: true }, async operation => {
      await operation.transaction(async tx => {
        for (const { sql, parameters } of commands) await tx.execute(sql, parameters)
      })
      return operation.health()
    })
    passed.push('schema-js-bridge-and-synthetic-seed')
    const batch = Array.from({ length: 256 }, (_, i) => ({
      ...sample, id: 'm2-android-' + String(i).padStart(3, '0'), lifeSources: [], createdAt: 1100, revision: 1,
    }))
    await candidate.withRepositories({}, async (messages, conversations) => {
      check(await messages.insert(batch[0]) === 'inserted', 'INSERT')
      check(await messages.insert(batch[0]) === 'existing', 'IDEMPOTENCY')
      check((await messages.insertBatch(batch.slice(0, 50))).length === 50, 'BATCH_50')
      check((await messages.insertBatch(batch)).length === 256, 'BATCH_256')
      await rejects(() => messages.insertBatch([...batch, batch[0]]), 'KANATA_MESSAGE_BATCH_INVALID')
      await rejects(() => messages.insert({ ...batch[0], content: 'different' }), 'KANATA_MESSAGE_ID_CONFLICT')
      const first = await messages.recent(scope)
      const second = await messages.older(scope, first.cursor)
      check(first.messages.length === 50 && second.messages[0].id === 'm2-android-205'
        && first.messages[0].id === 'm2-android-255', 'KEYSET')
      await rejects(() => messages.older({ ...scope, conversationId: 'other' }, first.cursor), 'KANATA_MESSAGE_CURSOR_INVALID')
      check((await messages.locate(scope, sample.id)).messages[0].id === sample.id, 'LOCATE')
      check((await messages.quote(scope, sample.id)).id === sample.id, 'QUOTE')
      check(await messages.count(scope) === 258, 'COUNT')
      await rejects(() => messages.insertBatch([
        { ...batch[0], id: 'should-rollback' }, { ...batch[0], id: 'bad-foreign-key', senderId: 'invalid-member' },
      ]), 'KANATA_SQLITE_TRANSACTION_FAILED')
      check(await messages.get(scope, 'should-rollback') === null, 'FK_ROLLBACK')
      const conversation = { ...group, id: 'm2-android-group', participantIds: [...group.participantIds].reverse() }
      await conversations.create(conversation)
      const groupScope = { worldId: conversation.worldId, conversationId: conversation.id }
      check((await conversations.get(groupScope)).participantIds.join() === conversation.participantIds.join(), 'MEMBER_ORDER')
      await conversations.update(groupScope, conversation.revision, { ...conversation, title: '合成群聊' })
      await rejects(() => conversations.update(groupScope, conversation.revision, conversation), 'KANATA_CONVERSATION_REVISION_CONFLICT')
    })
    passed.push('repository-batches-keyset-quote-locate-fk-and-conversation')
    const competing = await Promise.allSettled([1, 2].map(() => candidate.withRepositories({}, messages =>
      messages.setStatus(scope, batch[0].id, 1, 'stopped'))))
    check(competing.filter(result => result.status === 'fulfilled').length === 1
      && competing.some(result => result.status === 'rejected' && result.reason.message === 'KANATA_MESSAGE_REVISION_CONFLICT'), 'CAS_RACE')
    await candidate.run({}, async operation => {
      await rejects(() => operation.transaction(tx => tx.execute('DROP TABLE messages')), 'KANATA_SQLITE_STATEMENT_DENIED')
      const faulting = {
        transaction: action => operation.transaction(async tx => {
          const result = await action(tx)
          await tx.execute(deferredCommit, ['deferred-orphan', 'absent-card', 1, '{}', '{}', 'synthetic'])
          return result
        }),
      }
      const repository = createKanataMessageRepository(faulting, tools)
      await rejects(() => repository.revise(scope, sample.id, sample.revision, { content: '', deleted: true }), 'KANATA_SQLITE_TRANSACTION_FAILED')
      const messages = createKanataMessageRepository(operation, tools)
      check((await messages.get(scope, sample.id)).revision === sample.revision, 'COMMIT_ROLLBACK')
      const changed = await messages.revise(scope, sample.id, sample.revision, { content: '', deleted: true })
      check(changed.deleted === true && await messages.quote(scope, sample.id) === null, 'DELETE')
      check((await messages.get(scope, 'message-two')).status === 'stopped', 'REPLY_INVALIDATION')
      const query = sql => operation.transaction(tx => tx.query(sql, [scope.worldId]))
      const audit = (await query(inspection.messages)).find(row => row.id === 'message-audit-one')
      check(JSON.parse(audit.previous_json).content === '（已删除的原始记录）'
        && JSON.parse(audit.next_json).syntheticExtra.nested[0] === '保留', 'AUDIT_REDACTION')
      check((await query(inspection.eventRows)).find(row => row.id === 'event-dependent').status === 'needsReview', 'EVENT_INVALIDATION')
      check((await query(inspection.memories)).find(row => row.id === 'memory-one').revision === 3, 'MEMORY_INVALIDATION')
      check((await query(inspection.tasks)).find(row => row.id === 'task-one').error_code === 'SOURCE_REVISED', 'TASK_INVALIDATION')
    })
    passed.push('concurrent-cas-real-commit-failure-and-derived-delete')
    await candidate.release()
    await candidate.withRepositories({}, async messages => {
      check((await messages.get(scope, sample.id)).deleted === true, 'REOPEN')
    })
    await candidate.release()
    auth.savedMasterPwd = password + 'wrong'
    await rejects(() => candidate.run({}, operation => operation.health()), 'KANATA_SQLITE_UNLOCK_FAILED')
    const owner = { sessionRevision: auth.sessionRevision, ownerGeneration: 99 }
    const { token, salt } = await bridge.prepare({ ...owner, create: false })
    const bytes = await deriveKanataSqliteKek(password, salt)
    const kek = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    bytes.fill(0)
    const unlocked = await bridge.unlock({ ...owner, token, kek })
    await rejects(() => bridge.unlock({ ...owner, token, kek }), 'KANATA_SQLITE_CHALLENGE_INVALID')
    const nativeOwner = { ...owner, lease: unlocked.lease }
    await rejects(() => bridge.begin({ ...nativeOwner, sessionRevision: owner.sessionRevision + 1 }), 'KANATA_SQLITE_LEASE_REVOKED')
    await bridge.close()
    await rejects(() => bridge.begin(nativeOwner), 'KANATA_SQLITE_LEASE_REVOKED')
    passed.push('close-reopen-wrong-password-replay-and-lease')
    return { passed, health }
  } catch (failure) {
    return { passed, error: failure.code ?? failure.message }
  } finally { auth.expireSession() }
}

const session = password => { auth.savedMasterPwd = password; auth.isLocked = false }
installSchema005Device({ candidate, bridge, auth, session })

window.m2QaArmCrash = (password, scope) => {
  session(password)
  void candidate.run({}, async operation => {
    const repository = createKanataMessageRepository(operation, tools)
    suspendCommit = true
    await repository.setStatus(scope, 'm2-android-123', 1, 'stopped')
  }).catch(failure => { crashState = failure.code ?? failure.message })
}
window.m2QaCrashState = () => crashState

window.m2QaCheckCrash = async (password, scope, auditSql) => {
  session(password)
  try {
    return await candidate.run({}, async operation => {
      const row = await createKanataMessageRepository(operation, tools).get(scope, 'm2-android-123')
      const audit = await operation.transaction(tx => tx.query(auditSql, [scope.worldId]))
      return { status: row.status, revision: row.revision, auditAbsent: audit.every(entry =>
        JSON.parse(entry.next_json).id !== row.id) }
    })
  } finally { auth.expireSession() }
}

let prepared
let leasedOwner
window.m2QaChallenge = async (action, password) => {
  if (action === 'prepare') {
    await candidate.release()
    const owner = { sessionRevision: auth.sessionRevision, ownerGeneration: 123 }
    const { token, salt } = await bridge.prepare({ ...owner, create: false })
    prepared = { owner, token, salt }
    return 'prepared'
  }
  if (action === 'expired') {
    const { owner, token } = prepared
    prepared = undefined
    await rejects(() => bridge.unlock({ ...owner, token }), 'KANATA_SQLITE_CHALLENGE_INVALID')
    return 'expired-rejected'
  }
  if (action === 'lease') {
    const { owner, token, salt } = prepared
    prepared = undefined
    const bytes = await deriveKanataSqliteKek(password, salt)
    const kek = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    bytes.fill(0)
    const { lease } = await bridge.unlock({ ...owner, token, kek })
    leasedOwner = { ...owner, lease }
    await bridge.completeOpen(leasedOwner)
    return 'leased'
  }
  if (action === 'revoked') {
    await rejects(() => bridge.begin(leasedOwner), 'KANATA_SQLITE_LEASE_REVOKED')
    return 'background-lease-rejected'
  }
  throw new Error('UNEXPECTED_CHALLENGE_ACTION')
}

window.m2QaFuture = async (action, password, sql) => {
  session(password)
  try {
    if (action === 'mark') {
      await candidate.run({}, operation => operation.transaction(tx => tx.execute(sql)))
      await candidate.release()
      return 'future-marked'
    }
    await rejects(() => candidate.run({}, operation => operation.health()), 'KANATA_SCHEMA_FUTURE_VERSION')
    return 'future-rejected'
  } finally { auth.expireSession() }
}

window.m2QaInventory = async expected => {
  await candidate.release()
  await rejects(() => bridge.prepare({ sessionRevision: 0, ownerGeneration: 0, create: false }), expected)
  return expected
}

window.m2QaUi = async (password, { metadata, originalId, groupId, alternateId }) => {
  session(password)
  const passed = []
  const selected = ref(originalId)
  let calls = 0
  let failNext = false
  let late, delayed
  let clockAdvance = 0
  const group = metadata.conversations.find(item => item.id === groupId)
  const instanceIds = group.participantIds.filter(id => metadata.instances.some(item => item.id === id))
  const character = {
    id: 'm2-character', worldId: group.worldId, type: 'character', title: '合成角色会话',
    participantIds: instanceIds.slice(0, 2), mode: 'daily', revision: 1, lastReadAt: 0,
  }
  const runtime = createKanataSqliteChatRuntime({
    candidate, auth, clock: () => Date.now() + clockAdvance,
    completion: async options => {
      calls++
      check(options.messages.every(message => !message.content.includes('其他会话隔离文本')), 'CROSS_CONVERSATION_CONTEXT')
      check(options.messages.length <= 41, 'BOUNDED_CONTEXT')
      if (failNext) { failNext = false; throw new Error('SYNTHETIC_PROVIDER_FAILURE') }
      if (options.messages.some(message => message.role === 'user' && message.content.includes('迟到测试'))) {
        late = true
        return new Promise(resolve => { delayed = resolve })
      }
      options.onDelta?.('合成流式预览')
      return { content: '合成回复第一段\n\n合成回复第二段' }
    },
  })
  let runtimeError
  const viewRuntime = { ...runtime, async send(...args) {
    try { return await runtime.send(...args) }
    catch (error) { runtimeError = error.code ?? error.message; throw error }
  } }
  const style = document.createElement('style')
  style.textContent = conversationStyle
  document.head.append(style)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(KanataConversationView, {
      conversationId: selected.value,
      candidate: { runtime: viewRuntime, scope: { worldId: metadata.conversations.find(row => row.id === selected.value).worldId } },
    }),
  }).use(pinia)
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  const rendered = () => [...container.querySelectorAll('article[data-message-id]')]
  const settle = async predicate => {
    const end = performance.now() + 12000
    while (!predicate()) {
      if (performance.now() > end) throw new Error('UI_TIMEOUT')
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  const submit = async value => {
    const input = container.querySelector('textarea[placeholder]')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    input.closest('form').requestSubmit()
  }
  try {
    await candidate.withRepositories({}, async (messages, conversations) => {
      await conversations.create(character)
      const alternate = metadata.conversations.find(item => item.id === alternateId)
      const identity = metadata.identities.find(item => item.worldId === alternate.worldId)
      await messages.insert({
        id: 'm2-ui-other-world', worldId: alternate.worldId, conversationId: alternate.id, role: 'user', senderType: 'user',
        senderId: identity.id, senderNameSnapshot: identity.displayName, content: '其他会话隔离文本',
        createdAt: 1000, revision: 1, status: 'complete', turnId: 'm2-other-turn', batchId: 'm2-other-batch',
      })
    })
    metadata.conversations.push(character)
    app.mount(container)
    await settle(() => rendered().length === 50)
    const timeline = container.querySelector('.kanata-chat-timeline')
    timeline.scrollTop = 0
    const anchor = rendered()[0]
    const before = anchor.getBoundingClientRect().top - timeline.getBoundingClientRect().top
    button('加载更早消息').click()
    await settle(() => rendered().length === 100)
    await nextTick()
    check(Math.abs(anchor.getBoundingClientRect().top - timeline.getBoundingClientRect().top - before) <= 2, 'SCROLL_ANCHOR')
    button('加载更早消息').click()
    await settle(() => rendered()[0]?.dataset.messageId === 'm2-android-106')
    check(rendered().length === 100, 'WINDOW_CAP')
    button('回到最近').click()
    await settle(() => rendered().length === 50)
    rendered().at(-1).querySelector('button').click()
    await settle(() => Boolean(button('取消引用')))
    check(container.querySelector('.kanata-notice').textContent.includes('回复'), 'QUOTE_PREVIEW')
    button('取消引用').click()
    button('查找会话历史').click()
    await nextTick()
    const history = container.querySelector('section[aria-label="会话历史"]')
    history.querySelector('form').requestSubmit()
    await settle(() => history.querySelectorAll('article').length === 50)
    history.querySelector('article button').click()
    await settle(() => !history.isConnected && Boolean(button('回到最近')))
    button('回到最近').click()
    await settle(() => rendered().length === 50 && !button('回到最近'))
    passed.push('bounded-window-scroll-anchor-quote-and-history')

    selected.value = groupId
    await settle(() => container.querySelector('textarea[placeholder]')?.disabled === false && rendered().length === 0)
    const names = instanceIds.slice(0, 2).map(id => resolveKanataCharacter({ ...metadata, messages: [] }, id).name)
    const mentions = names.map(name => '@' + name).join(' ')
    failNext = true
    await submit(mentions + ' 合成重试')
    await settle(() => rendered().length === 1 && Boolean(button('重试最近一轮')) && !button('重试最近一轮').disabled)
    button('重试最近一轮').click()
    await settle(() => rendered().length >= 5 || Boolean(container.querySelector('.kanata-error')))
    if (button('立即显示全部回复')) button('立即显示全部回复').click()
    await settle(() => rendered().length === 5)
    const bubbles = rendered().slice(1)
    check(new Set(bubbles.map(row => row.dataset.senderId)).size === 2 && new Set(bubbles.map(row => row.dataset.batchId)).size === 2,
      'SPEAKER_BATCH')
    check(bubbles[0].textContent.includes('第一段') && bubbles[1].textContent.includes('第二段'), 'BUBBLE_ORDER')
    const quoteJump = bubbles[0].querySelector('button')
    quoteJump.click()
    await settle(() => Boolean(button('回到最近')))
    passed.push('group-speakers-atomic-bubbles-retry-and-jump')

    button('回到最近').click()
    await settle(() => !button('回到最近'))
    const groupScope = { worldId: group.worldId, conversationId: group.id }
    const beforeDeferred = calls
    const waiting = await runtime.send(groupId, { text: '@' + names[0] + ' 合成延迟回复', delayMs: 15000, persistDelay: true })
    check(waiting.deferred === true && calls === beforeDeferred, 'DEFERRED_DID_NOT_WAIT')
    await candidate.release()
    const restoredTask = await candidate.withRepositories({}, (_messages, _conversations, deferred) => deferred.pending(groupScope))
    check(restoredTask?.sourceId === waiting.messageId, 'DEFERRED_NOT_DURABLE')
    clockAdvance = 15000
    await runtime.runDue()
    check(calls === beforeDeferred + 1, 'DEFERRED_NOT_RESUMED')
    const afterDeferred = await candidate.withRepositories({}, async (messages, _conversations, deferred) => ({
      replies: await messages.replies(groupScope, waiting.messageId),
      pending: await deferred.pending(groupScope),
    }))
    check(afterDeferred.replies.messages.length === 2 && afterDeferred.pending === null, 'DEFERRED_COMPLETION')
    passed.push('deferred-reply-persists-and-resumes')
    button('重试载入会话').click()
    await settle(() => container.querySelector('textarea[placeholder]')?.disabled === false)

    await submit('@' + names[0] + ' 迟到测试')
    await settle(() => late)
    selected.value = alternateId
    await settle(() => rendered().length === 1 && rendered()[0].dataset.messageId === 'm2-ui-other-world')
    delayed({ content: '绝不能保存的迟到结果' })
    await new Promise(resolve => setTimeout(resolve, 150))
    const latest = await candidate.withRepositories({}, async messages => {
      const source = await messages.latest(groupScope, 'user')
      return messages.replies(groupScope, source.id)
    })
    check(latest.messages.length === 0 && rendered().length === 1, 'LATE_RESULT')
    selected.value = character.id
    await settle(() => container.querySelector('h3')?.textContent === character.title)
    check(!container.querySelector('textarea[placeholder]'), 'CHARACTER_UI_MANUAL_DENIED')
    await rejects(() => runtime.send(character.id, { text: '手动发送' }), 'CONVERSATION_UNAVAILABLE')
    selected.value = originalId
    await settle(() => rendered().length === 50)
    auth.expireSession()
    await settle(() => rendered().length === 0)
    passed.push('fast-world-switch-late-completion-character-and-lock')
    return { passed, controlledModelCalls: calls, realModelCalls: 0 }
  } catch (error) {
    return { passed, error: error.code ?? error.message, runtimeError, calls, rows: rendered().length,
      pageError: container.querySelector('.kanata-error')?.textContent }
  } finally {
    app.unmount()
    container.remove()
    style.remove()
    auth.expireSession()
  }
}

window.m4QaGrowth = async (password, { base, senderId }) => {
  session(password)
  const samples = []
  let controlledModelCalls = 0
  let revocationWhilePending = 'NOT RUN'
  const promptGrowth = []
  const countStateObjects = root => {
    const seen=new WeakSet()
    const walk=value=>{
      if(!value||typeof value!=='object'||seen.has(value))return 0
      seen.add(value)
      return 1+Object.values(value).reduce((count,child)=>count+walk(child),0)
    }
    return walk(root)
  }
  const stringify = JSON.stringify
  const clone = globalThis.structuredClone
  let fullGraphCalls = 0
  const observe = value => {
    if (value && typeof value === 'object' && ['worlds', 'cards', 'conversations', 'messages'].every(key =>
      Object.prototype.hasOwnProperty.call(value, key))) fullGraphCalls++
  }
  const { worldId } = base
  try {
    for (const size of [1000, 10000]) {
      const conversationId = 'm4-growth-' + size
      const scope = { worldId, conversationId }
      await candidate.withRepositories({}, (_messages, conversations) => conversations.create({
        ...base, id: conversationId, lastReadAt: 0, revision: 1,
      }))
      const seeded = await candidate.run({}, operation => operation.transaction(tx => tx.execute(growthSeedSql,
        [size, conversationId, worldId, conversationId, senderId])))
      check(seeded.affectedRows === size, 'M4_SEED_COUNT')
      let failure = true, deltas = 0, resumeProvider, promptSystem
      const runtime = createKanataSqliteChatRuntime({
        candidate, auth, clock: () => 90000,
        lifeReaders: { home: async () => [{ value: '合成生活资料授权标记' }] },
        completion: async options => {
          controlledModelCalls++
          promptSystem = options.messages[0].content
          check(options.messages.length <= 41, 'M4_PROMPT_UNBOUNDED')
          if (failure) { failure = false; throw new Error('M4_CONTROLLED_PROVIDER_FAILURE') }
          if (options.messages.findLast(item => item.role === 'user')?.content.includes('合成授权迟到')) {
            check(options.messages.some(item => item.content.includes('合成生活资料授权标记')), 'M4_AUTHORIZED_CONTEXT_ABSENT')
            return new Promise(resolve => { resumeProvider = resolve })
          }
          options.onDelta?.('合成增量')
          return { content: '合成回复甲\n\n合成回复乙' }
        },
      })
      const view = runtime.createViewModel()
      trace = { queries: 0, writes: 0, maxRows: 0 }
      JSON.stringify = (value, ...args) => { observe(value); return stringify(value, ...args) }
      if (clone) globalThis.structuredClone = (...args) => { observe(args[0]); return clone(...args) }
      try {
        runtime.activate(scope)
        await view.open(conversationId)
        check(view.window.messages.value.length === 50, 'M4_RECENT_LIMIT')
        check(await view.window.older() && view.window.messages.value.length === 100, 'M4_WINDOW_LIMIT')
        let source
        try { await runtime.send(conversationId, { text: '合成原文', timing: 'immediate' }) }
        catch (error) { check(error.code === 'M4_CONTROLLED_PROVIDER_FAILURE' && error.sourceSaved, 'M4_SOURCE_NOT_DURABLE') }
        source = await candidate.withRepositories({}, messages => messages.latest(scope, 'user'))
        check(source?.content === '合成原文', 'M4_SOURCE_MISSING')
        await runtime.send(conversationId, { retryMessageId: source.id, timing: 'immediate', onDelta: () => { deltas++ } })
        check(deltas === 1, 'M4_STREAM_DELTA')
        const replies = await candidate.withRepositories({}, messages => messages.replies(scope, source.id))
        check(replies.messages.length === 2, 'M4_RETRY_BATCH')
        await runtime.reviseMessage(source.id, 1, { content: '合成修订', deleted: false })
        await runtime.reviseMessage(source.id, 2, { content: '', deleted: true })
        const removed = await candidate.withRepositories({}, messages => messages.get(scope, source.id))
        check(removed.deleted && removed.revision === 3, 'M4_DELETE_CAS')
        check(fullGraphCalls === 0 && trace.maxRows <= 51, 'M4_FULL_GRAPH_PATH')
        samples.push({ seedRows: size, ...trace, retainedWindow: view.window.messages.value.length })
        const queries = trace.queries, writes = trace.writes
        restoreState.busy = true
        try {
          check(view.overview.value === null && view.window.messages.value.length === 0, 'M4_RESTORE_CACHE')
          await rejects(() => runtime.send(conversationId, { text: '禁止写入' }), 'KANATA_SQLITE_SESSION_CHANGED')
          check(trace.queries === queries && trace.writes === writes, 'M4_RESTORE_ACCESS')
        } finally { restoreState.busy = false }
        if (size === 10000) {
          const actor = base.participantIds.find(id => id !== senderId)
          const worlds = candidate.createWorldRuntime()
          try {
            const granted = await worlds.select(worldId).setGrant(actor, 'home', null, { read: true, remember: false, share: false })
            const pending = runtime.send(conversationId, { text: '合成授权迟到', timing: 'immediate' })
            void pending.catch(() => {})
            const until = performance.now() + 12000
            while (!resumeProvider && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 20))
            check(resumeProvider, 'M4_PROVIDER_NOT_PENDING')
            const owner = worlds.select(worldId)
            const revoked = await owner.setGrant(actor, 'home', granted.revision, { read: false, remember: false, share: false })
            check(revoked.revision === granted.revision + 1 && view.overview.value === null, 'M4_GRANT_CACHE_NOT_REVOKED')
            resumeProvider({ content: '不应保存的合成授权迟到结果' })
            await rejects(() => pending, 'KANATA_SQLITE_SESSION_CHANGED')
            const replies = await candidate.withRepositories({}, async messages => {
              const latest = await messages.latest(scope, 'user')
              return messages.completedReplies(scope, latest.id)
            })
            check(!replies.length, 'M4_REVOKED_PROVIDER_WROTE')
            revocationWhilePending = 'PASS'
          } finally { worlds.dispose() }
        }
        const instanceId = base.participantIds.find(id => id !== senderId)
        const prefix = 'qa-prompt-' + size + '-'
        const memoryId = prefix + '0'
        await candidate.run({}, operation => operation.transaction(async tx => {
          await tx.execute(memoryRows, [0, prefix, worldId, instanceId, instanceId])
          check((await tx.execute(memoryWideSources, [memoryId, worldId, conversationId, conversationId+'-history-*'])).affectedRows===size,
            'M4_PROMPT_SEED')
        }))
        let arrayObjects = 0
        let maxEncodedRefs = 0
        JSON.stringify = (value, ...args) => {
          observe(value)
          if (Array.isArray(value)) for (const entry of value) arrayObjects += entry?.sourceRefs?.length ?? 0
          if (value && Object.hasOwn(value,'messageId') && Object.hasOwn(value,'revision') && Object.keys(value).length===2) maxEncodedRefs=1
          return stringify(value, ...args)
        }
        let bodyReads = 0, pages = 0, pageObjects = 0, canceledAt = 0, cancelOnPage = false
        const beforeHeap = performance.memory?.usedJSHeapSize ?? null
        let heapSample = beforeHeap
        trace = { queries: 0, writes: 0, maxRows: 0, observeQuery(rows) {
          if (performance.memory) heapSample = Math.max(heapSample, performance.memory.usedJSHeapSize)
          const [row] = rows
          if (!row) return
          if ('confidence' in row && 'content' in row && 'layer' in row) bodyReads += rows.length
          if ('message_id' in row && 'message_revision' in row && Object.keys(row).length === 2) {
            pages++
            pageObjects = Math.max(pageObjects, rows.length)
            if (cancelOnPage) {
              canceledAt=trace.queries
              runtime.cancel()
            }
          }
        } }
        const callsBefore = controlledModelCalls
        await rejects(() => runtime.send(conversationId,{text:'合成宽来源预算',timing:'immediate'}),'CONTEXT_BUDGET_EXCEEDED')
        check(controlledModelCalls===callsBefore&&pages>1&&pages*51<size&&bodyReads===1,'M4_PROMPT_EARLY_BUDGET')
        const wide = { queries:trace.queries, sqlMaxRows:trace.maxRows, bodyReads, pages, pageObjects }
        cancelOnPage=true
        await rejects(() => runtime.send(conversationId,{text:'合成宽来源取消',timing:'immediate'}),'ABORTED')
        check(canceledAt>0&&trace.queries===canceledAt&&controlledModelCalls===callsBefore,'M4_PROMPT_AFTER_CANCEL')
        const noQueriesAfterCancel=trace.queries-canceledAt
        cancelOnPage=false
        await candidate.withDomains({}, domains => domains.memories.removeOwned({worldId,instanceId},memoryId,1,prefix+'delete'))
        const narrowPrefix = prefix+'small-'
        const narrowId = narrowPrefix+'0'
        await candidate.run({}, operation => operation.transaction(async tx => {
          await tx.execute(memoryRows,[0,narrowPrefix,worldId,instanceId,instanceId])
          for(const pattern of ['[1-9]','[1-5][0-9]']) {
            await tx.execute(memoryWideSources,[narrowId,worldId,conversationId,conversationId+'-history-'+pattern])
          }
        }))
        await runtime.send(conversationId,{text:'合成来源恢复',timing:'immediate'})
        check(controlledModelCalls===callsBefore+1,'M4_PROMPT_RECOVERY')
        const promptJson=promptSystem.split('\n').find(line=>line.startsWith('可追溯的动态记忆')).split('：')[1]
        const entry=JSON.parse(promptJson).find(memory=>memory.id===narrowId)
        const expected=Array.from({length:59},(_,index)=>conversationId+'-history-'+(index+1)).sort()
        check(stringify(entry.sourceRefs)===stringify(expected.map(messageId=>({messageId,revision:1})))&&arrayObjects===0,
          'M4_PROMPT_EXACT_REFS')
        await candidate.withDomains({}, domains=>domains.memories.removeOwned({worldId,instanceId},narrowId,1,prefix+'small-delete'))
        promptGrowth.push({size,wide,maxEncodedRefs,arrayObjects,noQueriesAfterCancel,recovered:true,
          retainedWindow:view.window.messages.value.length,piniaStores:pinia._s.size,
          piniaStateObjects:countStateObjects(pinia.state.value),
          heapUsedAtStart:beforeHeap,heapUsedHighSample:heapSample})
      } finally {
        JSON.stringify = stringify
        if (clone) globalThis.structuredClone = clone
        trace = undefined
        view.dispose()
        await runtime.dispose()
      }
    }
    check(samples[0].queries === samples[1].queries && samples[0].writes === samples[1].writes, 'M4_SQL_GROWTH')
    check(fullGraphCalls === 0, 'M4_FULL_GRAPH_PATH')
    return { samples, promptGrowth, fullGraphCalls, controlledModelCalls, realModelCalls: 0, restoreGate: 'PASS', revocationWhilePending }
  } catch (error) {
    return { error: error.code ?? error.message, samples, fullGraphCalls, controlledModelCalls }
  } finally { auth.expireSession(); await candidate.release() }
}
window.m4QaArchive = async (password,{base,senderId,extensionWrite})=>{
  session(password)
  const worldId=base.worldId,conversationId='m4-archive-ui'
  const scope={worldId,conversationId}
  const runtime=createKanataSqliteChatRuntime({candidate,auth,releaseOnDispose:false,
    completion:async()=>{throw new Error('M4_ARCHIVE_PROVIDER_CALL')}})
  const container=document.createElement('div')
  document.body.append(container)
  const app=createApp({render:()=>[h(KanataCandidateHistoryPanel,{
    search:(text,cursor,guard)=>runtime.searchHistory(conversationId,text,cursor,guard),
    previewArchive:guard=>runtime.previewArchive(conversationId,guard),
    confirmArchive:(plan,key,guard)=>runtime.confirmArchive(conversationId,plan,key,guard),
  }),h(AppFeedbackHost)]}).use(pinia)
  const locate=(root,label)=>[...root.querySelectorAll('button')].find(item=>item.textContent.trim()===label)
  const settle=async condition=>{
    const deadline=performance.now()+15000
    while(!condition()){
      if(performance.now()>deadline)throw new Error('M4_ARCHIVE_UI_TIMEOUT')
      await new Promise(resolve=>setTimeout(resolve,30))
    }
  }
  try {
    await candidate.withRepositories({},(_messages,conversations)=>conversations.create({...base,id:conversationId,revision:1,lastReadAt:0}))
    await candidate.run({},operation=>operation.transaction(async tx=>{
      await tx.execute(growthSeedSql,[250,conversationId,worldId,conversationId,senderId])
      const result=await tx.execute(extensionWrite,[JSON.stringify({legacyNested:[{unknownKey:conversationId+'-history-1'}]}),
        conversationId+'-history-249'])
      check(result.affectedRows===1,'M4_ARCHIVE_UNKNOWN_REFERENCE_SEED')
    }))
    runtime.activate(scope)
    app.mount(container)
    locate(container,'预览整理较早聊天').click()
    await settle(()=>Boolean(locate(container,'确认整理历史')))
    check(container.querySelector('[aria-label="历史整理预览"]').textContent.includes('49 条'),'M4_ARCHIVE_UI_PREVIEW_COUNT')
    locate(container,'确认整理历史').click()
    await settle(()=>Boolean(locate(document,'整理这些消息')))
    locate(document,'整理这些消息').click()
    await settle(()=>container.textContent.includes('已整理 49 条消息'))
    const older=await candidate.withRepositories({},messages=>messages.quote(scope,conversationId+'-history-1'))
    check(older?.content==='合成历史消息','M4_ARCHIVE_QUOTE_LOST')
    check((await runtime.previewArchive(conversationId,()=>{})).count===0,'M4_ARCHIVE_RECEIPT_MISMATCH')
    const marks=await candidate.run({},operation=>operation.transaction(async tx=>{
      const sql='SELECT 1 FROM archived_message_marks WHERE world_id=? AND conversation_id=? AND message_id=?'
      const retained=await tx.query(sql,[worldId,conversationId,conversationId+'-history-1'])
      const archived=await tx.query(sql,[worldId,conversationId,conversationId+'-history-2'])
      return [retained,archived]
    }))
    check(marks[0].length===0&&marks[1].length===1,'M4_ARCHIVE_UNKNOWN_REFERENCE_PROTECTED')
    return {archivedCount:49,retainedRecent:200,quotePreserved:true,unknownReferenceProtected:true}
  }catch(error){return {error:error.code??error.message}}
  finally{
    app.unmount()
    container.remove()
    await runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}
window.m4QaWorkspace = async (password, { worldId, worldName, conversationId, actorId, membership }) => {
  session(password)
  const passed = []
  let stage = 'open'
  const worlds = candidate.createWorldRuntime()
  const lifecycle = { generation: candidate.generation, isAvailable: candidate.isAvailable, release: candidate.release }
  const createChat = () => createKanataSqliteChatRuntime({
    candidate, auth, releaseOnDispose: false,
    completion: async () => { throw new Error('M4_WORKSPACE_UNEXPECTED_PROVIDER') },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => [h(KanataCandidateWorkspace, { worlds, lifecycle, createChat }), h(AppFeedbackHost)] }).use(pinia)
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  const entry = id => container.querySelector('[data-entry-id="' + id + '"] button')
  const settle = async predicate => {
    const end = performance.now() + 10000
    while (!predicate()) {
      if (performance.now() > end) throw new Error('M4_WORKSPACE_TIMEOUT')
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  try {
    app.mount(container)
    await settle(() => Boolean(button(worldName)))
    button(worldName).click()
    await settle(() => Boolean(entry(conversationId)))
    entry(conversationId).click()
    await settle(() => container.querySelectorAll('article[data-message-id]').length === 50)
    button('返回世界').click()
    await settle(() => Boolean(button('角色与授权')))
    passed.push('workspace-directory-scoped-conversation-and-return')
    if (globalThis.m4QaCompletion) {
      stage = 'identity-read'
      button('查看世界身份').click()
      await settle(() => Boolean(button('保存世界身份')))
      stage = 'identity-save'
      button('保存世界身份').click()
      await settle(() => !button('保存世界身份'))
      button('世界书').click()
      await settle(() => Boolean(button('新建世界书设定')))
      stage = 'lore-open'
      button('新建世界书设定').click()
      await settle(() => Boolean(button('保存世界书条目')))
      const form = container.querySelector('[aria-label="候选世界书编辑"] form')
      const fill = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles:true })) }
      fill(form.querySelector('textarea'), '合成 Completion 世界书条目')
      fill(form.querySelector('input:not([type])'), '合成关键词')
      await nextTick()
      stage = 'lore-submit'
      form.requestSubmit()
      await settle(() => !container.querySelector('[aria-label="候选世界书编辑"]') && Boolean(container.querySelector('ul[aria-label="世界书"]')))
      const record = await candidate.withDomains({}, domains => domains.lorebook.list(worldId))
      check(record.entries.some(row=>row.content==='合成 Completion 世界书条目'), 'C3_LORE_SAVE')
    }
    stage = 'sections'
    for (const label of ['世界书', '记忆', '事件', '自治任务']) {
      button(label).click()
      await settle(() => Boolean(container.querySelector('ul[aria-label="' + label + '"]')))
    }
    button('角色与授权').click()
    await settle(() => Boolean(entry(actorId)))
    entry(actorId).click()
    await settle(() => Boolean(container.querySelector('[data-module="mood"] input')))
    container.querySelector('[data-module="mood"] input').click()
    await settle(() => !container.querySelector('fieldset') && Boolean(button(worldName)))
    const grant = await candidate.withDomains({}, domains => domains.autonomy.getGrant(worldId, actorId, 'mood'))
    check(grant?.read === true, 'M4_WORKSPACE_GRANT_CAS')
    button(worldName).click()
    await settle(() => Boolean(button('角色与授权')))
    button('角色与授权').click()
    await settle(() => Boolean(entry(actorId)))
    entry(actorId).click()
    await settle(() => container.querySelector('[data-module="mood"] input')?.checked === true)
    container.querySelector('[data-module="mood"] input').click()
    await settle(() => !container.querySelector('fieldset') && Boolean(button(worldName)))
    const revoked = await candidate.withDomains({}, domains => domains.autonomy.getGrant(worldId, actorId, 'mood'))
    check(revoked?.read === false && revoked.revision > grant.revision, 'M4_WORKSPACE_REVOKE_CAS')
    stage = 'global-binding'
    button('生活角色绑定').click()
    await settle(() => Boolean(container.querySelector('[aria-label="候选生活角色绑定"]') && button(worldName)))
    button(worldName).click()
    await settle(() => [...container.querySelectorAll('button')].some(node=>node.textContent.trim().startsWith('绑定 ')))
    const bindButton = [...container.querySelectorAll('button')].find(node=>node.textContent.trim().startsWith('绑定 '))
    bindButton.click()
    await settle(() => !container.querySelector('[aria-label="候选生活角色绑定"]') && Boolean(button('全局角色卡库')))
    const binding = await candidate.withDomains({}, domains => domains.roleBindings.resolve('home'))
    check(binding.status==='ready' && binding.binding.worldId===worldId, 'C3_GLOBAL_BINDING')
    stage = 'card-detail'
    button('全局角色卡库').click()
    await settle(() => Boolean(container.querySelector('[aria-label="候选角色卡库"]')))
    const cardPane = container.querySelector('[aria-label="候选角色卡库"]')
    await settle(() => Boolean(cardPane.querySelector('ul button')))
    cardPane.querySelector('ul button').click()
    await settle(() => Boolean(button('查看卡版本历史')))
    button('查看卡版本历史').click()
    await settle(() => Boolean(cardPane.querySelector('article ul button')))
    button('关闭角色卡库').click()
    await settle(() => Boolean(button(worldName)))
    stage = 'new-group'
    button(worldName).click()
    await settle(() => Boolean(button('新建独立群聊')))
    button('新建独立群聊').click()
    const groupPane = () => container.querySelector('[aria-label="候选创建群聊"]')
    await settle(() => (groupPane()?.querySelectorAll('input[type=checkbox]').length??0)>=2)
    const groupTitle = groupPane().querySelector('input:not([type])')
    groupTitle.value = '合成 Completion 群聊'
    groupTitle.dispatchEvent(new Event('input',{bubbles:true}))
    const [firstMember, secondMember] = groupPane().querySelectorAll('input[type=checkbox]')
    firstMember.click()
    secondMember.click()
    await nextTick()
    groupPane().querySelector('form').requestSubmit()
    await settle(() => !groupPane() && Boolean(button('合成 Completion 群聊')))
    passed.push('workspace-domain-summaries-grant-and-revoke-invalidation')
    const groupCases = []
    if (membership) {
      const { actors:[a,b,c], foreign, sample, failCommitSql } = membership
      const editing=()=>container.querySelector('[aria-label="候选编辑群聊成员"]')
      const dialogButton=text=>[...document.querySelectorAll('[role=dialog] button')].find(node=>node.textContent.trim()===text)
      const create=async id=>{
        await candidate.withDomains({},domains=>domains.conversations.createGroup(worldId,
          {title:id,instanceIds:[a,b]},{id,commandId:id}))
        return {worldId,conversationId:id}
      }
      const get=scope=>candidate.withDomains({},domains=>domains.conversations.get(scope))
      const start=async id=>{
        button('会话').click()
        const edit=()=>container.querySelector('[data-entry-id="'+id+'"] button[aria-label]')
        await settle(()=>Boolean(edit()&&!edit().disabled))
        edit().click()
        await settle(()=>editing()?.querySelector('[data-actor-id="'+b+'"]')?.checked===true)
        editing().querySelector('[data-actor-id="'+b+'"]').click()
        editing().querySelector('[data-actor-id="'+c+'"]').click()
        await nextTick()
      }
      const submit=()=>editing().querySelector('form').requestSubmit()
      const send=async (scope,id,change={})=>{
        const row={...sample,...change,id,conversationId:scope.conversationId,lifeSources:[]}
        await candidate.withRepositories({},messages=>messages.insertBatch([row]))
        return row
      }
      const invalid=scope=>candidate.withDomains({},domains=>domains.conversations.editGroupMembers(scope,{
        expectedHistory:scope.conversationId==='qa-group-history',expectedRevision:1,instanceIds:[a,foreign],
        commandId:'invalid-'+scope.conversationId,newGroupId:'invalid-result-'+scope.conversationId,
      }))
      const fresh=async prior=>{
        const result=await candidate.withDomains({},domains=>domains.managementView.list(worldId,'conversations'))
        return {worldId,conversationId:result.entries.find(row=>row.id!==prior.conversationId&&row.title===prior.conversationId)?.id}
      }
      stage='GROUP-01'
      const empty=await create('qa-group-empty')
      const before=await get(empty), identity=before.participantIds[0]
      await start(empty.conversationId)
      check(!editing().querySelector('[data-actor-id="'+foreign+'"]'),'GROUP_FOREIGN_PICKER')
      await rejects(()=>invalid(empty),'INVALID_GROUP_PARTICIPANTS')
      check((await get(empty)).revision===before.revision,'GROUP_FOREIGN_EMPTY_MUTATION')
      submit()
      await settle(()=>!editing())
      check(JSON.stringify((await get(empty)).participantIds)===JSON.stringify([identity,a,c]),'GROUP_EMPTY_MEMBERS')
      check(await candidate.withRepositories({},messages=>messages.count(empty))===0,'GROUP_EMPTY_HISTORY')
      groupCases.push('GROUP-01')

      stage='GROUP-02/03/04'
      const prior=await create('qa-group-history')
      const root=await send(prior,'qa-group-root')
      const reply=await send(prior,'qa-group-quote',{replyToMessageId:root.id,replyToRevision:root.revision})
      await rejects(()=>invalid(prior),'INVALID_GROUP_PARTICIPANTS')
      const original=await get(prior)
      const originalMessages=await candidate.withRepositories({},messages=>messages.recent(prior))
      await start(prior.conversationId)
      submit()
      await settle(()=>Boolean(dialogButton('另建空群')))
      dialogButton('另建空群').click()
      await settle(()=>!editing()&&Boolean(button('返回世界')))
      const created=await fresh(prior)
      check(created.conversationId&&created.conversationId!==prior.conversationId,'GROUP_HISTORY_NOT_SPLIT')
      check(JSON.stringify(await get(prior))===JSON.stringify(original),'GROUP_HISTORY_CHANGED')
      check(JSON.stringify((await get(created)).participantIds)===JSON.stringify([identity,a,c]),'GROUP_HISTORY_MEMBER_ORDER')
      await candidate.withRepositories({},async messages=>{
        check(JSON.stringify(await messages.recent(prior))===JSON.stringify(originalMessages),'GROUP_ORIGINAL_MESSAGES')
        check((await messages.get(prior,reply.id)).replyToMessageId===root.id,'GROUP_ORIGINAL_QUOTE')
        check((await messages.historyForSpeaker(prior,b,10)).some(row=>row.id===root.id),'GROUP_ORIGINAL_ROLE_HISTORY')
        check(await messages.count(created)===0,'GROUP_NEW_NOT_EMPTY')
        check((await messages.searchHistory(created,root.content)).messages.length===0,'GROUP_NEW_SEARCH_LEAK')
        check(await messages.locate(created,root.id)===null&&await messages.quote(created,root.id)===null,'GROUP_NEW_REFERENCE_LEAK')
        check((await messages.historyForSpeaker(created,c,10)).length===0,'GROUP_NEW_ROLE_HISTORY_LEAK')
      })
      groupCases.push('GROUP-02','GROUP-03','GROUP-04')
      button('返回世界').click()
      await settle(()=>Boolean(button('会话')))

      stage='GROUP-05'
      const race=await create('qa-group-race')
      await start(race.conversationId)
      const arrival=await send(race,'qa-group-arrival')
      submit()
      await settle(()=>Boolean(dialogButton('另建空群')))
      dialogButton('取消').click()
      await settle(()=>!dialogButton('另建空群')&&!editing()?.querySelector('button[type=submit]').disabled)
      check(!(await fresh(race)).conversationId,'GROUP_CANCEL_CREATED')
      check(JSON.stringify((await get(race)).participantIds)===JSON.stringify([identity,a,b]),'GROUP_RACE_REWROTE')
      await candidate.withDomains({},domains=>domains.memories.archiveSource(worldId,{messageId:arrival.id,revision:arrival.revision}))
      submit()
      await settle(()=>Boolean(dialogButton('另建空群')))
      groupCommitFault=sha256Text(failCommitSql)
      dialogButton('另建空群').click()
      await settle(()=>Boolean(editing()?.querySelector('[role=alert]')))
      check(!groupCommitFault&&!(await fresh(race)).conversationId,'GROUP_COMMIT_FAILURE_LEFT_COPY')
      check(JSON.stringify((await get(race)).participantIds)===JSON.stringify([identity,a,b]),'GROUP_COMMIT_FAILURE_REWROTE')
      submit()
      await settle(()=>Boolean(dialogButton('另建空群')))
      dialogButton('另建空群').click()
      await settle(()=>!editing()&&Boolean(button('返回世界')))
      check((await fresh(race)).conversationId,'GROUP_RACE_COPY_MISSING')
      const copies=await candidate.withDomains({},domains=>domains.managementView.list(worldId,'conversations'))
      check(copies.entries.filter(row=>row.title===race.conversationId).length===2,'GROUP_DUPLICATE_COPY')
      button('返回世界').click()
      await settle(()=>Boolean(button('会话')))
      const deleted=await create('qa-group-deleted')
      const deletedMessage=await send(deleted,'qa-group-deleted-message')
      await candidate.withRepositories({},messages=>messages.revise(deleted,deletedMessage.id,deletedMessage.revision,{content:'',deleted:true}))
      await start(deleted.conversationId)
      submit()
      await settle(()=>Boolean(dialogButton('另建空群')))
      dialogButton('取消').click()
      await settle(()=>!dialogButton('另建空群')&&!editing()?.querySelector('button[type=submit]').disabled)
      check(!(await fresh(deleted)).conversationId,'GROUP_TOMBSTONE_CANCEL_CREATED')
      groupCases.push('GROUP-05')
      stage='R3-event-ledger'
      button('事件').click()
      await settle(()=>Boolean(button('提议事件')&&!button('提议事件').disabled))
      button('提议事件').click()
      const eventPanel=()=>container.querySelector('[aria-label="候选事件账本"]')
      await settle(()=>Boolean(eventPanel()?.querySelector('textarea')))
      eventPanel().querySelector('input[value=move]').click()
      await nextTick()
      button('选择事件角色').click()
      const eventActor=()=>eventPanel()?.querySelector('[data-event-choice="'+a+'"]')
      await settle(()=>Boolean(eventActor()))
      eventActor().click()
      const place=eventPanel().querySelector('input[maxlength="200"]')
      place.value='合成界面移动地点'
      place.dispatchEvent(new Event('input',{bubbles:true}))
      const draft=eventPanel().querySelector('textarea')
      draft.value='合成候选账本事件'
      draft.dispatchEvent(new Event('input',{bubbles:true}))
      await nextTick()
      eventPanel().querySelector('form').requestSubmit()
      await settle(()=>Boolean(button('确认记入账本')))
      button('确认记入账本').click()
      await settle(()=>Boolean(dialogButton('记入账本')))
      dialogButton('记入账本').click()
      await settle(()=>eventPanel()?.textContent.includes('已记入'))
      button('预览撤销').click()
      await settle(()=>Boolean(button('确认撤销范围')&&!button('确认撤销范围').disabled))
      button('确认撤销范围').click()
      await settle(()=>Boolean(dialogButton('撤销所列事件')))
      dialogButton('撤销所列事件').click()
      await settle(()=>eventPanel()?.textContent.includes('已撤销'))
      button('查看撤销审计').click()
      await settle(()=>Boolean(eventPanel()?.querySelector('[aria-label="撤销审计"] li')))
      button('查看逐项影响').click()
      await settle(()=>eventPanel()?.querySelector('[aria-label="逐项影响审计"] li')?.textContent.includes('合成界面移动地点'))

      stage='R4-memory-management'
      const memoryBase={worldId,ownerType:'character',ownerId:a,layer:'L3',key:'合成冲突管理',
        sourceRefs:[],status:'active',revision:1,visibility:'private'}
      const oldId='qa-memory-old',newId='qa-memory-new'
      await candidate.withDomains({},async domains=>{
        await domains.memories.save({...memoryBase,id:oldId,content:'合成旧内容'},null)
        await domains.memories.save({...memoryBase,id:newId,content:'合成新内容'},null)
      })
      button('记忆').click()
      await settle(()=>Boolean(entry(newId)&&!entry(newId).disabled))
      entry(newId).click()
      const memoryPanel=()=>container.querySelector('[aria-label="候选记忆来源"]')
      const asActor=()=>memoryPanel()?.querySelector('[data-memory-actor="'+a+'"]')
      await settle(()=>Boolean(asActor()))
      asActor().click()
      await settle(()=>Boolean(button('核对候选和冲突')))
      button('核对候选和冲突').click()
      await settle(()=>Boolean(button('自定义正文并合并来源')))
      button('自定义正文并合并来源').click()
      await settle(()=>Boolean(dialogButton('确认合并')))
      const mergeInput=document.querySelector('input.feedback-input')
      mergeInput.value='合成自定义正文'
      mergeInput.dispatchEvent(new Event('input',{bubbles:true}))
      await nextTick()
      dialogButton('确认合并').click()
      await settle(()=>Boolean(button('分享这条记忆')))
      const managed=await candidate.withDomains({},domains=>domains.memories.managedDetailFor({worldId,instanceId:a},oldId))
      check(managed.status==='stale'&&managed.content==='合成旧内容','R4_CONFLICT_RETAINED')
      button('分享这条记忆').click()
      const shareTo=()=>memoryPanel()?.querySelector('[data-share-recipient="'+c+'"]')
      await settle(()=>Boolean(shareTo()))
      shareTo().click()
      await nextTick()
      button('分享给选定角色').click()
      await settle(()=>Boolean(dialogButton('确认分享')))
      dialogButton('确认分享').click()
      await settle(()=>!memoryPanel()?.querySelector('[aria-label="选择分享对象"]'))
      const shared=await candidate.withDomains({},domains=>domains.memories.listFor({worldId,instanceId:c}))
      const copy=shared.entries.find(item=>item.sharedFromId===newId)
      check(copy?.content==='合成自定义正文','R4_SHARED_COPY')
      button('查看已分享对象').click()
      const revoke=()=>memoryPanel()?.querySelector('[data-share-copy="'+copy.id+'"]')
      await settle(()=>Boolean(revoke()))
      revoke().click()
      await settle(()=>Boolean(dialogButton('撤回此分享')))
      dialogButton('撤回此分享').click()
      await settle(()=>!memoryPanel()&&Boolean(button(worldName)))
      await rejects(()=>candidate.withDomains({},domains=>domains.memories.readDetailFor({worldId,instanceId:c},copy.id)),
        'KANATA_MEMORY_CONTEXT_DENIED')
      button(worldName).click()
      await settle(()=>Boolean(button('世界书')&&!button('世界书').disabled))

      stage='R5-role-lore-preview'
      await candidate.withDomains({},domains=>domains.lorebook.save({id:'qa-role-lore',worldId,scope:'world',ownerId:worldId,
        content:'合成世界书角色预览',keys:['红叶'],secondaryKeys:['北桥'],priority:99999,activationRule:'keyword',
        visibility:'public',knownBy:[],sourceTag:'synthetic',enabled:true,revision:1},null))
      button('世界书').click()
      await settle(()=>Boolean(button('新建世界书设定')&&!button('新建世界书设定').disabled))
      button('新建世界书设定').click()
      await settle(()=>Boolean(button('选择所属角色或知情角色')))
      button('选择所属角色或知情角色').click()
      const actorPreview=()=>[...container.querySelectorAll('[aria-label="候选世界书编辑"] button')].find(el=>el.textContent.endsWith(' 预览'))
      await settle(()=>Boolean(actorPreview()))
      actorPreview().click()
      await settle(()=>Boolean(button('运行角色预览')))
      const preview=()=>container.querySelector('[aria-label="角色世界书预览"]')
      const text=preview().querySelector('input')
      text.value='红叶 北桥'
      text.dispatchEvent(new Event('input',{bubbles:true}))
      await nextTick()
      button('运行角色预览').click()
      await settle(()=>preview()?.querySelector('li')?.textContent.includes('合成世界书角色预览'))

      stage='R5-create-world'
      button('返回世界列表').click()
      await settle(()=>Boolean(button('新建空白世界')&&!button('新建空白世界').disabled))
      button('新建空白世界').click()
      const worldForm=()=>container.querySelector('form[aria-label="新建空白世界"]')
      await settle(()=>Boolean(worldForm()))
      for(const [input,value] of [...worldForm().querySelectorAll('input')].map((node,index)=>[node,['合成新世界','合成身份'][index]])){
        input.value=value
        input.dispatchEvent(new Event('input',{bubbles:true}))
      }
      await nextTick()
      worldForm().requestSubmit()
      await settle(()=>container.querySelector('h3')?.textContent==='合成新世界')
      await candidate.withDomains({},async domains=>{
        const page=await domains.managementView.worlds()
        const created=page.entries.find(item=>item.title==='合成新世界')
        check(created,'R5_WORLD_CREATED')
        const value=await domains.worlds.get(created.id)
        const original=await domains.worlds.get(worldId)
        check(value.identity.userId===original.identity.userId&&value.identity.displayName==='合成身份','R5_WORLD_IDENTITY')
        check((await domains.managementView.list(created.id,'conversations')).entries.length===0,'R5_WORLD_EMPTY')
      })
      stage='R5-world-settings'
      button('编辑世界设置').click()
      const settings=()=>container.querySelector('form[aria-label="世界设置"]')
      await settle(()=>Boolean(settings()))
      const rules=settings().querySelector('textarea')
      rules.value='合成世界规则更新'
      rules.dispatchEvent(new Event('input',{bubbles:true}))
      const zone=settings().querySelector('input[placeholder="Asia/Shanghai"]')
      zone.value='Asia/Shanghai'
      zone.dispatchEvent(new Event('input',{bubbles:true}))
      settings().querySelector('input[value="roleplay"]').click()
      await nextTick()
      settings().requestSubmit()
      await settle(()=>!settings())
      await candidate.withDomains({},async domains=>{
        const created=(await domains.managementView.worlds()).entries.find(item=>item.title==='合成新世界')
        const value=await domains.worlds.get(created.id)
        check(value.world.rules==='合成世界规则更新'&&value.world.timeZone==='Asia/Shanghai'&&value.world.defaultChatMode==='roleplay',
          'R5_WORLD_SETTINGS')
      })
    }
    return { passed, groupCases, ...(membership && { groupCommitFailure:'PASS', softDeletedHistory:'PASS',
      eventLedger:'PASS', memoryManagement:'PASS', shareWithdrawal:'PASS', roleLorePreview:'PASS', createWorld:'PASS', worldSettings:'PASS' }) }
  } catch (error) {
    return { error: error.code ?? error.message, passed, stage, uiError: container.querySelector('[role=alert]')?.textContent }
  } finally {
    app.unmount()
    container.remove()
    auth.expireSession()
    await candidate.release()
  }
}
window.mr2QaChatProvenance = async (password, { commands, scope, sample, commitFault }) => {
  session(password)
  const results=[]
  const provider=[]
  let ignoreAbort, providerStarted
  const entered=new Promise(resolve=>{providerStarted=resolve})
  const runtime=createKanataSqliteChatRuntime({candidate,auth,clock:()=>50000,
    completion:async ({messages})=>{
      provider.push(JSON.stringify(messages))
      if (messages.at(-1).content.includes('合成挂起结果')) {
        const late=new Promise(resolve=>{ignoreAbort=resolve})
        providerStarted()
        return late
      }
      return {content:'合成宽授权回复'}
    }})
  try {
    const health=await candidate.run({create:true},async operation=>{
      await operation.transaction(async tx=>{
        for(const {sql,parameters} of commands) await tx.execute(sql,parameters)
      })
      return operation.health()
    })
    await candidate.withDomains({},domains=>domains.autonomy.setGrant(scope.worldId,scope.instanceId,'todo',2,
      {read:true,remember:true,share:true}))
    runtime.activate(scope)
    for(const size of [1000,10000]){
      const source='g4-wide-source-'+size
      const {lifeSources:_tags,...base}=sample
      await candidate.withRepositories({},messages=>messages.insert({...base,id:source,revision:1,createdAt:size+2000}))
      const seeds=await candidate.run({},operation=>operation.transaction(tx=>seedWideChatSources(tx,scope,source,size)))
      let completeDtos=0,largestTagPage=0
      const heapStart=performance.memory?.usedJSHeapSize??null
      let heapSample=heapStart
      trace={queries:0,writes:0,maxRows:0,observeQuery(rows){
        largestTagPage=Math.max(largestTagPage,rows.filter(row=>Object.hasOwn(row,'grant_id')).length)
        for(const row of rows){
          if(typeof row.life_sources==='string'&&row.life_sources!=='[]')completeDtos++
        }
        if(performance.memory)heapSample=Math.max(heapSample??0,performance.memory.usedJSHeapSize)
      }}
      const started=performance.now()
      const turn=await runtime.send(scope.conversationId,{text:'合成宽授权测试'})
      const result={queries:trace.queries,writes:trace.writes,maxRows:trace.maxRows,largestTagPage,completeDtos,heapStart,heapSample,
        elapsedMs:Math.round(performance.now()-started)}
      trace=undefined
      const body=JSON.parse(provider.at(-1))[0].content
      check(body.includes(source)&&body.includes(seeds.memoryId)&&body.includes(seeds.eventId),'G4_WIDE_PROMPT_ROOTS')
      check(result.completeDtos===0&&result.largestTagPage<=50&&result.maxRows<=51,'G4_WIDE_PROJECTION')
      const [reply]=await candidate.withRepositories({},messages=>messages.completedReplies(scope,turn.messageId))
      check(reply,'G4_WIDE_REPLY')
      const [order]=await candidate.run({},operation=>operation.transaction(tx=>tx.query(chatReplyTagCheck,[scope.worldId,source,reply.id,scope.instanceId])))
      check(order.tags===2*size+2&&order.ordered_matches===order.tags&&order.links===size+1,'G4_WIDE_REPLY_ORDER')
      const taskFields={...scope,kind:'memory',state:'pending',sourceRevision:1,attempt:0,notBefore:0,leaseUntil:0,
        sourceRefs:[{messageId:source,revision:1}],resultEventIds:[]}
      const taskId='g4-task-'+size
      const deniedTaskId='g4-task-denied-'+size
      await candidate.withDomains({},async ({autonomy})=>{
        for(const id of [taskId,deniedTaskId]) await autonomy.enqueue({...taskFields,id,idempotencyKey:id})
        const now=Date.now()
        const lease=await autonomy.claim(scope.worldId,taskId,now,now+30000)
        const result={status:'succeeded',events:[]}
        check((await autonomy.finish(scope.worldId,taskId,lease,result)).state==='succeeded','G4_TASK_FINISH')
        check((await autonomy.finish(scope.worldId,taskId,lease,result)).state==='succeeded','G4_TASK_FINISH_RECEIPT')
        await autonomy.setGrant(scope.worldId,seeds.deniedActor,'todo',1,{read:false,remember:false,share:false})
        await rejects(()=>autonomy.claim(scope.worldId,deniedTaskId,now,now+30000),'KANATA_LIFE_PERMISSION_DENIED')
      })
      let revokedBodyReads=0
      const blocked=new Set([source,seeds.memoryId,seeds.eventId,reply.id])
      trace={queries:0,writes:0,maxRows:0,observeQuery(rows,command){
        for(const row of rows){
          if((Object.hasOwn(row,'content')||Object.hasOwn(row,'summary'))
            && (blocked.has(row.id)||command.parameters.some(value=>blocked.has(value))))revokedBodyReads++
        }
      }}
      await runtime.send(scope.conversationId,{text:'合成撤权之后'})
      trace=undefined
      check(!provider.at(-1).includes(source)&&!provider.at(-1).includes(seeds.memoryId)&&!provider.at(-1).includes(seeds.eventId)
        &&revokedBodyReads===0,'G4_WIDE_REVOKED_PROMPT')
      results.push({size,...result,order,providerJsonSha256:sha256Text(provider.at(-2)),
        providerMessages:JSON.parse(provider.at(-2)),revokedBodyReads,taskGrantAndReceipt:true})
    }
    replyCommitFault=sha256Text(commitFault)
    await rejects(()=>runtime.send(scope.conversationId,{text:'合成提交故障'}),'KANATA_SQLITE_TRANSACTION_FAILED')
    const failedSource=await candidate.withRepositories({},messages=>messages.latestState(scope,'user'))
    const replies=()=>candidate.withRepositories({},messages=>messages.completedReplies(scope,failedSource.id))
    check((await replies()).length===0,'G4_COMMIT_LEFT_REPLY')
    await runtime.send(scope.conversationId,{retryMessageId:failedSource.id})
    const persisted=await replies()
    const calls=provider.length
    await runtime.send(scope.conversationId,{retryMessageId:failedSource.id})
    check(persisted.length===1&&JSON.stringify(await replies())===JSON.stringify(persisted)&&provider.length===calls,'G4_RETRY_DUPLICATED_REPLY')
    trace={queries:0,writes:0,maxRows:0}
    const pending=runtime.send(scope.conversationId,{text:'合成挂起结果'}).then(()=>null,error=>error.code??error.message)
    check(await Promise.race([entered.then(()=>true),pending.then(()=>false)]),'G4_PROVIDER_NOT_REACHED')
    runtime.cancel()
    const before={queries:trace.queries,writes:trace.writes}
    ignoreAbort({content:'合成迟到结果'})
    check(await pending==='ABORTED','G4_LATE_PROVIDER_RESULT')
    const afterCancel={queries:trace.queries-before.queries,writes:trace.writes-before.writes}
    trace=undefined
    check(afterCancel.queries===0&&afterCancel.writes===0,'G4_LATE_PROVIDER_IO')
    return {health,results,afterCancel,commitFailureRolledBack:true,idempotentRetry:true,syntheticModelCalls:provider.length,realModelCalls:0}
  } catch(error) {
    return {error:error.code??error.message,results}
  } finally {
    trace=undefined
    await runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}

window.mr2QaWideGrantProof = async (password, { commands, scope, sample }) => {
  session(password)
  const {worldId,instanceId,conversationId}=scope
  const samples=[]
  try {
    const health=await candidate.run({create:true},async operation=>{
      await operation.transaction(async tx=>{
        for (const {sql,parameters} of commands) await tx.execute(sql,parameters)
      })
      return operation.health()
    })
    await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,instanceId,'todo',2,
      {read:true,remember:true,share:true}))
    for(const size of [1000,10000]){
      const prefix='mr2-origin-'+size+'-'
      const source='mr2-source-'+size, reply='mr2-reply-'+size, memory='mr2-memory-'+size+'-'
      await candidate.withRepositories({},async messages=>{
        await messages.insert({...sample,id:source,revision:1,lifeSources:[]})
        await messages.insert({...sample,id:reply,revision:1,lifeSources:[],replyToMessageId:source,replyToRevision:1})
      })
      await candidate.run({},operation=>operation.transaction(async tx=>{
        check((await tx.execute(grantOriginActors,[size-1,prefix,worldId,instanceId])).affectedRows===size,'MR2_ORIGIN_ACTORS')
        check((await tx.execute(grantOrigins,[worldId,prefix+'*'])).affectedRows===size,'MR2_ORIGIN_GRANTS')
        check((await tx.execute(grantMessageTags,[source,worldId,prefix+'*'])).affectedRows===size,'MR2_MESSAGE_TAGS')
        check((await tx.execute(memoryRows,[0,memory,worldId,instanceId,instanceId])).affectedRows===1,'MR2_MEMORY')
        check((await tx.execute(memoryWideSources,[memory+'0',worldId,conversationId,reply])).affectedRows===1,'MR2_MEMORY_SOURCE')
      }))
      const ref={messageId:reply,revision:1}
      const read=domains=>domains.memories.readDetailFor(scope,memory+'0')
      const resolve=domains=>domains.memories.resolveSource(scope,memory+'0',ref)
      let projectedTags=0,bodyReads=0
      const observation=()=>({queries:0,writes:0,maxRows:0,observeQuery(rows){
        for(const row of rows){
          if(Object.hasOwn(row,'grant_id'))projectedTags++
          if(Object.hasOwn(row,'content'))bodyReads++
        }
      }})
      trace=observation()
      const started=performance.now()
      check((await candidate.withDomains({},read)).content==='synthetic','MR2_MEMORY_AUTHORIZATION')
      check((await candidate.withDomains({},resolve)).content===sample.content,'MR2_EXACT_MESSAGE_REVISION')
      const allowed={queries:trace.queries,maxRows:trace.maxRows,projectedTags,bodyReads,elapsedMs:Math.round(performance.now()-started)}
      check(projectedTags===0&&bodyReads===2&&trace.maxRows<=50,'MR2_AUTHORIZED_PROJECTIONS')
      trace=undefined
      await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,prefix+(size-1),'todo',1,
        {read:false,remember:false,share:false}))
      trace=observation()
      bodyReads=0
      for(const action of [read,resolve]) await rejects(()=>candidate.withDomains({},action),'KANATA_LIFE_PERMISSION_DENIED')
      const denied={queries:trace.queries,bodyReads,projectedTags,maxRows:trace.maxRows}
      check(bodyReads===0&&projectedTags===0,'MR2_REVOKED_BODY_OR_TAGS')
      trace=undefined
      samples.push({size,allowed,denied})
    }
    check(samples[0].allowed.queries===samples[1].allowed.queries
      &&samples[0].denied.queries===samples[1].denied.queries,'MR2_GRANT_QUERY_GROWTH')
    return {health,samples}
  } catch(error) {
    return {error:error.code??error.message,samples}
  } finally {
    trace=undefined
    auth.expireSession()
    await candidate.release()
  }
}

window.mr1QaFanout = async (password, { commands, scope, verify }, size) => {
  check([1000,10000].includes(size), 'M4_GROWTH_SIZE')
  session(password)
  const prefix='mr1-fanout-'+size+'-', root=prefix+size
  const commandId=prefix+'confirm'
  const phases={}
  const measure=async (phase, action)=>{
    eventProfile=phase
    trace={queries:0,writes:0,maxRows:0}
    const start=performance.now()
    try { return await action() }
    finally {
      phases[phase]={...trace,elapsedMs:Math.round(performance.now()-start)}
      console.info('MR1_PHASE', JSON.stringify({size,phase,...phases[phase]}))
      eventProfile=undefined
      trace=undefined
    }
  }
  try {
    const health=await candidate.run({create:!!commands}, async operation=>{
      if (commands) await operation.transaction(async tx=>{
        for (const command of commands) await tx.execute(command.sql,command.parameters)
      })
      return operation.health()
    })
    if (verify && commands) {
      await candidate.withDomains({},async domains=>{
        const retained=await domains.events.proposeAcknowledged({worldId:scope.worldId,participantIds:[scope.instanceId],
          sourceRefs:[],causedByEventIds:[],visibility:'private',summary:'合成保留位置',effectiveAt:0,
          kind:'move',action:{instanceId:scope.instanceId,location:'合成保留位置'}},'mr1-retained-effect')
        await domains.events.commitAcknowledged(scope.worldId,retained.id,1)
      })
    }
    await measure('seed',()=>candidate.run({},operation=>operation.transaction(async tx=>{
      check((await tx.execute(eventRows,[size,prefix,scope.worldId])).affectedRows===size+1,'M4_FANOUT_SEED')
      const links=await seedFanoutLinks(tx,size,scope.worldId,prefix,root)
      console.info('MR1_SEED_PLAN',JSON.stringify({size,...links}))
      check(links.affectedRows===size,'M4_FANOUT_LINKS')
      if (verify) {
        check((await tx.execute(replayEffectRows,[size,prefix+'effect-',scope.worldId,prefix,scope.instanceId,scope.instanceId])).affectedRows===size+1,
          'MR1_OWNED_EFFECTS_SEED')
      }
    })))
      const plans=await candidate.run({},operation=>operation.transaction(async tx=>{
        for(const [index,ddl] of eventPlanDdl.entries()){
          console.info('MR1_PLAN_DDL',JSON.stringify({index,statement:sha256Text(ddl)}))
          await tx.execute(ddl)
        }
      const statements=[...eventRevocationQueries.slice(1,6),...eventRevocationWrites]
      const bindings=[[scope.worldId,root,'',51],...Array.from({length:3},()=>[scope.worldId,root,'']),
        [scope.worldId,'signature','','','',''],[scope.worldId,'[]','signature'],[scope.worldId,'[]','signature'],
        [scope.worldId,'signature']]
      const result={}
      for(const [index,sql] of statements.entries()){
        console.info('MR1_PLAN_QUERY',JSON.stringify({index,statement:sha256Text('EXPLAIN QUERY PLAN '+sql),arity:bindings[index].length}))
        const rows=await tx.query('EXPLAIN QUERY PLAN '+sql,bindings[index])
        result[profileNames.get(sha256Text(sql))]=rows.map(row=>row.detail)
      }
      return result
    }))
    console.info('MR1_PLANS', JSON.stringify({size,plans}))
    const first=await measure('preview',()=>candidate.withDomains({},domains=>domains.events.openRevocation(scope.worldId,root)))
    check(first.plan.revokeCount===size+1&&first.plan.uncertainCount===0&&first.entries.length===50,'M4_FANOUT_PREVIEW')
    const second=await measure('continuation',()=>candidate.withDomains({},domains=>domains.events.openRevocation(scope.worldId,root,first.cursor)))
    check(second.entries[0].id>first.entries.at(-1).id&&second.plan.signature===first.plan.signature,'M4_FANOUT_CONTINUATION')
    const execute=()=>candidate.withDomains({},domains=>domains.events.confirmRevocation(first.plan,'keep-independent',commandId))
    if (verify) return { size,health,plans,phases,plan:first.plan }
    const confirmed=await measure('confirmation',execute)
    check(confirmed.revoked===size+1&&confirmed.needsReview===0&&phases.confirmation.maxRows<=128,'M4_FANOUT_EXECUTION')
    const replay=await measure('idempotent',execute)
    check(replay.revoked===confirmed.revoked&&replay.needsReview===confirmed.needsReview,'M4_FANOUT_RETRY')
    const audit=await candidate.withDomains({},domains=>domains.events.revocationAudits(scope.worldId,root))
    check(audit.entries.length===1&&audit.entries[0].status==='revoked','M4_FANOUT_AUDIT')
    return { size,health,plans,phases,confirmed,replay }
  } catch(error) {
    return { size,phases,error:error.code??error.message }
  } finally {
    auth.expireSession()
    await candidate.release()
  }
}

window.mr1QaArmFanout = (password, plan, size) => {
  session(password)
  crashState='idle'
  fanoutCrashArmed=true
  void candidate.withDomains({}, domains => domains.events.confirmRevocation(plan,'keep-independent','mr1-fanout-'+size+'-confirm'))
    .catch(error=>{crashState=error.code??error.message})
  return 'armed'
}

window.mr1QaResumeFanout = async (password, scope, plan, size) => {
  session(password)
  const prefix='mr1-fanout-'+size+'-', commandId=prefix+'confirm'
  const receiptKey=JSON.stringify(['event:revoke-confirmed',scope.worldId,plan.eventId,commandId])
  const inspect=()=>candidate.run({},operation=>operation.transaction(async tx=>{
    const [audit]=await tx.query(fanoutAuditInspection,[scope.worldId,prefix])
    const [receipt]=await tx.query(receiptQuery,[receiptKey])
    return {audit,receipt}
  }))
  try {
    const before=await inspect()
    check(before.audit.events===size+1&&before.audit.original===size+1&&before.audit.audits===0&&!before.receipt,'MR1_CRASH_ROLLBACK')
    const execute=()=>candidate.withDomains({}, domains => domains.events.confirmRevocation(plan,'keep-independent',commandId))
    trace={queries:0,writes:0,maxRows:0}
    eventProfile='resume-confirmation'
    const start=performance.now()
    const confirmed=await execute()
    const confirmation={...trace,elapsedMs:Math.round(performance.now()-start)}
    eventProfile=undefined
    trace=undefined
    check(confirmed.revoked===size+1&&confirmed.needsReview===0&&confirmation.maxRows<=128,'MR1_RESUME_COUNT')
    const after=await inspect()
    check(after.audit.revoked===size+1&&after.audit.audits===size+1&&after.audit.exactAudits===size+1&&after.receipt?.result_id===plan.eventId,
      'MR1_PERSISTED_AUDITS_RECEIPT')
    const replay=await execute()
    const final=await inspect()
    check(replay.revoked===confirmed.revoked&&replay.needsReview===confirmed.needsReview&&JSON.stringify(after)===JSON.stringify(final),
      'MR1_IDEMPOTENT_AUDITS_RECEIPT')
    const actor=await candidate.withDomains({},domains=>domains.characters.getInstance(scope.worldId,scope.instanceId))
    check(actor.state.location==='合成保留位置','MR1_FINAL_STATE')
    return { size,confirmed,confirmation,crashRollback:true,audits:after.audit,persistedReceipt:true,idempotent:true }
  } catch(error) {
    return { size,error:error.code??error.message }
  } finally {
    eventProfile=undefined
    trace=undefined
    auth.expireSession()
    await candidate.release()
  }
}

window.m4QaCompletion = async (password, scope, requestedSize) => {
  session(password)
  const samples = []
  try {
    check([1000,10000].includes(requestedSize),'M4_GROWTH_SIZE')
    for (const size of [requestedSize]) {
      const started=performance.now()
      const stage=name=>console.info('MR1_STAGE',JSON.stringify({size,name,elapsedMs:Math.round(performance.now()-started)}))
      stage('start')
      const memory = 'm4c-memory-' + size + '-', event = 'm4c-event-' + size + '-'
      await candidate.run({}, operation => operation.transaction(async tx => {
        check((await tx.execute(memoryRows, [size, memory, scope.worldId, scope.instanceId, scope.instanceId])).affectedRows === size+1, 'C2_MEMORY_SEED')
        check((await tx.execute(memoryEdges, [size-1, scope.worldId, memory, memory])).affectedRows === size, 'C2_MEMORY_EDGE_SEED')
        check((await tx.execute(eventRows, [size, event, scope.worldId])).affectedRows === size+1, 'C2_EVENT_SEED')
        check((await tx.execute(eventEdges, [size-1, scope.worldId, event, event])).affectedRows === size, 'C2_EVENT_EDGE_SEED')
      }))
      stage('deep-chain-seeded')
      trace = { queries:0, writes:0, maxRows:0 }
      const item = await candidate.withDomains({}, domains => domains.memories.readDetailFor(scope, memory+'0'))
      check(item?.id === memory+'0', 'C2_MEMORY_AUTHORIZATION')
      const memoryTrace = {...trace}
      trace=undefined
      stage('deep-memory-read')
      const wide='m4c-wide-'+size+'-'
      await candidate.run({},operation=>operation.transaction(async tx=>{
        check((await tx.execute(growthSeedSql,[size,wide,scope.worldId,scope.conversationId,scope.senderId])).affectedRows===size,'R4_SOURCE_SEED')
        check((await tx.execute(memoryRows,[0,wide,scope.worldId,scope.instanceId,scope.instanceId])).affectedRows===1,'R4_WIDE_MEMORY')
        for(const id of [wide+'0',memory+size]){
          check((await tx.execute(memoryWideSources,[id,scope.worldId,scope.conversationId,wide+'-history-*'])).affectedRows===size,'R4_SOURCE_FANOUT')
        }
      }))
      trace={queries:0,writes:0,maxRows:0}
      const wideResult=await candidate.withDomains({},domains=>domains.memories.readDetailFor(scope,wide+'0'))
      check(wideResult.id===wide+'0'&&trace.maxRows<=50,'R4_WIDE_AUTH')
      const wideTrace={...trace,total:size}
      trace={queries:0,writes:0,maxRows:0}
      const mixedResult=await candidate.withDomains({},domains=>domains.memories.readDetailFor(scope,memory+'0'))
      check(mixedResult.id===memory+'0'&&trace.maxRows<=50,'R4_MIXED_AUTH')
      const mixedTrace={...trace,edges:size,sources:size}
      stage('wide-and-mixed-memory-read')
      trace = { queries:0, writes:0, maxRows:0 }
      let cursor, count=0, last=''
      do {
        const page = await candidate.withDomains({}, domains => domains.events.graphPage(scope.worldId, event+'0', 'cause', cursor))
        for (const row of page.entries) {
          check(row.id>last&&row.revision===1, 'C2_EVENT_ORDER')
          last=row.id
          count++
        }
        cursor=page.cursor??undefined
      } while(cursor)
      check(count===size && trace.maxRows<=51, 'C2_EVENT_CONTINUATION')
      const eventTrace={...trace,total:count}
      trace=undefined
      stage('event-graph-paged')
      const revocable=await candidate.withDomains({},async domains=>{
        const proposal=await domains.events.proposeAcknowledged({worldId:scope.worldId,participantIds:[scope.instanceId],
          sourceRefs:[],causedByEventIds:[],visibility:'private',summary:'合成可撤销位置',effectiveAt:20000+size,
          kind:'move',action:{instanceId:scope.instanceId,location:'合成可撤销位置'}},'m4-replay-'+size)
        return domains.events.commitAcknowledged(scope.worldId,proposal.id,1)
      })
      const earlier=await candidate.withDomains({},async domains=>(await domains.events.openRevocation(scope.worldId,revocable.id)).plan)
      await candidate.run({},operation=>operation.transaction(async tx=>{
        const prefix=event+'replay-'
        check((await tx.execute(replayEventRows,[size-1,prefix,scope.worldId,size])).affectedRows===size,'M4_EFFECT_EVENT_SEED')
        check((await tx.execute(replayEffectRows,[size-1,event+'effect-',scope.worldId,prefix,scope.instanceId,scope.instanceId])).affectedRows===size,'M4_EFFECT_SEED')
      }))
      stage('replay-seeded')
      eventProfile='combined-effect-stale'
      await rejects(()=>candidate.withDomains({},domains=>domains.events.confirmRevocation(earlier,'keep-independent','replay-stale-'+size)),'EVENT_REVOKE_PREVIEW_STALE')
      stage('replay-stale-rejected')
      eventProfile='combined-effect-preview'
      const plan=await candidate.withDomains({},async domains=>(await domains.events.openRevocation(scope.worldId,revocable.id)).plan)
      stage('replay-preview')
      const beforeTarget=await candidate.withDomains({},domains=>domains.characters.getInstance(scope.worldId,scope.instanceId))
      eventProfile='combined-effect-confirmation'
      trace={queries:0,writes:0,maxRows:0}
      const confirmed=await candidate.withDomains({},domains=>domains.events.confirmRevocation(plan,'keep-independent','replay-confirm-'+size))
      check(confirmed.revoked===1&&confirmed.needsReview===0,'M4_EFFECT_PLAN_SCOPE')
      const replay={...trace,total:size}
      stage('replay-confirmed')
      eventProfile=undefined
      trace=undefined
      check(replay.maxRows<=128,'M4_EFFECT_BATCH')
      const replayed=await candidate.withDomains({},domains=>domains.characters.getInstance(scope.worldId,scope.instanceId))
      check(replayed.state.location==='synthetic-location-'+(size-1),'M4_EFFECT_FOLD')
      const audit=await candidate.withDomains({},domains=>domains.events.revocationAudits(scope.worldId,revocable.id))
      check(audit.entries.length===1&&audit.entries[0].effectCount===1,'M4_EFFECT_AUDIT')
      const owned=await candidate.withDomains({},domains=>domains.events.revocationEffectAudit(scope.worldId,revocable.id,audit.entries[0].id))
      check(owned.complete&&owned.total===1&&owned.entries[0].value==='合成可撤销位置','M4_EFFECT_AUDIT_ENTRY')
      console.info('MR1_EFFECT_AUDIT',JSON.stringify({size,beforeExpected:beforeTarget.state.location,
        before:owned.entries[0].before,after:owned.entries[0].after,ownerRevision:owned.entries[0].ownerRevision,
        nextOwnerRevision:owned.entries[0].nextOwnerRevision,idempotencyKey:owned.entries[0].idempotencyKey}))
      check(owned.entries[0].before===beforeTarget.state.location&&owned.entries[0].after==='synthetic-location-'+(size-1)
        &&owned.entries[0].ownerRevision===2&&owned.entries[0].nextOwnerRevision===3
        &&owned.entries[0].idempotencyKey.includes('replay-confirm-'+size),'M4_EFFECT_BEFORE_AFTER_COMMAND')
      const fanoutPrefix='m4c-fanout-'+size+'-',fanoutRoot=fanoutPrefix+size
      await candidate.run({},operation=>operation.transaction(async tx=>{
        check((await tx.execute(eventRows,[size,fanoutPrefix,scope.worldId])).affectedRows===size+1,'M4_FANOUT_SEED')
        stage('fanout-rows-seeded')
        const links=await seedFanoutLinks(tx,size,scope.worldId,fanoutPrefix,fanoutRoot)
        console.info('MR1_SEED_PLAN',JSON.stringify({size,...links}))
        check(links.affectedRows===size,'M4_FANOUT_LINKS')
      }))
      stage('fanout-seeded')
      eventProfile='combined-fanout-preview'
      const first=await candidate.withDomains({},domains=>domains.events.openRevocation(scope.worldId,fanoutRoot))
      check(first.plan.revokeCount===size+1&&first.plan.uncertainCount===0&&first.entries.length===50,'M4_FANOUT_PREVIEW')
      stage('fanout-preview')
      eventProfile='combined-fanout-continuation'
      const second=await candidate.withDomains({},domains=>domains.events.openRevocation(scope.worldId,fanoutRoot,first.cursor))
      check(second.entries[0].id>first.entries.at(-1).id&&second.plan.signature===first.plan.signature,'M4_FANOUT_CONTINUATION')
      let planWrites=0
      const planStatements=new Set(eventPlanWrites.map(sha256Text))
      trace={queries:0,writes:0,maxRows:0,observeWrite(command){if(planStatements.has(command.statement))planWrites++}}
      const execute=()=>candidate.withDomains({},domains=>domains.events.confirmRevocation(first.plan,'keep-independent','m4c-fanout-confirm-'+size))
      stage('fanout-continuation')
      eventProfile='combined-fanout-confirmation'
      const fanout=await execute()
      stage('fanout-confirmed')
      eventProfile=undefined
      const fanoutTrace={...trace,confirmed:fanout.revoked,planWrites,persistentWrites:trace.writes-planWrites}
      trace=undefined
      console.info('MR1_FANOUT_IO',JSON.stringify({size,...fanoutTrace}))
      check(fanout.revoked===size+1&&fanout.needsReview===0&&fanoutTrace.maxRows<=128
        &&fanoutTrace.persistentWrites<=2*Math.ceil((size+1)/128)+1
        &&fanoutTrace.planWrites<=5&&fanoutTrace.writes<=2*Math.ceil((size+1)/128)+6,'M4_FANOUT_EXECUTION')
      check((await execute()).revoked===size+1,'M4_FANOUT_RETRY')
      const fanoutAudit=await candidate.withDomains({},domains=>domains.events.revocationAudits(scope.worldId,fanoutRoot))
      check(fanoutAudit.entries.length===1&&fanoutAudit.entries[0].status==='revoked','M4_FANOUT_AUDIT')
      samples.push({ size, memory:memoryTrace, wideMemory:wideTrace, mixedMemory:mixedTrace, event:eventTrace, replay,
        confirmationFanout:fanoutTrace,elapsedMs:Math.round(performance.now()-started) })
    }
    return { samples }
  } catch(error) {
    return { error:error.code??error.message, samples }
  } finally { eventProfile=undefined; trace=undefined; auth.expireSession(); await candidate.release() }
}
window.mr2QaEventProvenance = async (password, {commands,scope,sample,commitFault}) => {
  session(password)
  const {worldId,instanceId}=scope
  const runtime=candidate.createWorldRuntime(()=>50000)
  const results=[], observations=[]
  try {
    const health=await candidate.run({create:true},async operation=>{
      await operation.transaction(async tx=>{
        for (const {sql,parameters} of commands) await tx.execute(sql,parameters)
      })
      return operation.health()
    })
    await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,instanceId,'todo',2,
      {read:true,remember:true,share:true}))
    const model=runtime.select(worldId)
    const guard=()=>{}
    for (const size of [1000,10000]) {
      const source='mr2-event-source-'+size
      const {lifeSources:_life,...base}=sample
      await candidate.withRepositories({},messages=>messages.insert({...base,id:source,revision:1,createdAt:size+2000}))
      const seeds=await candidate.run({},operation=>operation.transaction(tx=>seedWideChatSources(tx,scope,source,size)))
      const refs=[{messageId:source,revision:1,future:{nested:null}}]
      const fields={worldId,participantIds:[instanceId],sourceRefs:refs,causedByEventIds:[seeds.eventId],
        visibility:'private',summary:'合成事件来源',effectiveAt:1200,kind:'move',
        action:{instanceId,location:'合成位置',future:null},future:{nested:[null,3,{key:'保留'}]}}
      let fullDtos=0,maxTagRows=0,maxStagedTags=0
      const heapStart=performance.memory?.usedJSHeapSize??null
      let heapSample=heapStart
      trace={queries:0,writes:0,maxRows:0,observeQuery(rows) {
        fullDtos+=rows.filter(row=>(Object.hasOwn(row,'extensions_json')&&Object.hasOwn(row,'summary')&&Object.hasOwn(row,'recorded_at'))
          ||Object.hasOwn(row,'previous_json')).length
        maxTagRows=Math.max(maxTagRows,rows.filter(row=>Object.hasOwn(row,'grant_id')).length)
        if(performance.memory)heapSample=Math.max(heapSample??0,performance.memory.usedJSHeapSize)
      },observeWrite(command){
        if(command.statement===sha256Text(eventProofWrites[0])) {
          maxStagedTags=Math.max(maxStagedTags,JSON.parse(command.parameters[0]).length)
        }
      }}
      let cancellation
      if(size===1000) {
        const observeWrite=trace.observeWrite
        let closed=false, ioAtClose
        trace.observeWrite=command=>{
          observeWrite(command)
          if(!closed&&command.statement===sha256Text(eventProofWrites[0])) {
            closed=true
            ioAtClose=[trace.queries,trace.writes]
          }
        }
        await rejects(()=>model.proposeEventAcknowledged(fields,'mr2-event-'+size,()=>{
          if(closed)throw new Error('EVENT_QA_CLOSED')
        }),'EVENT_QA_CLOSED')
        cancellation={queries:trace.queries-ioAtClose[0],writes:trace.writes-ioAtClose[1]}
        check(cancellation.queries===0&&cancellation.writes===0,'EVENT_PROPOSAL_IO_AFTER_CLOSE')
        trace.observeWrite=observeWrite
        trace.queries=0
        trace.writes=0
      }
      const started=performance.now()
      const {id}=await model.proposeEventAcknowledged(fields,'mr2-event-'+size,guard)
      check((await model.proposeEventAcknowledged(fields,'mr2-event-'+size,guard)).id===id,'EVENT_PROPOSE_RECEIPT')
      eventCommitFault=sha256Text(commitFault)
      await rejects(()=>model.commitEventAcknowledged(id,1,guard),'KANATA_SQLITE_TRANSACTION_FAILED')
      check((await model.eventDetail(id,guard)).revision===1,'EVENT_COMMIT_ROLLBACK')
      check((await model.commitEventAcknowledged(id,1,guard)).id===id,'EVENT_COMMIT_ACK')
      check((await model.commitEventAcknowledged(id,1,guard)).id===id,'EVENT_COMMIT_RECEIPT')
      await rejects(()=>model.commitEventAcknowledged(id,2,guard),'EVENT_COMMIT_CONFLICT')
      const observation={queries:trace.queries,writes:trace.writes,maxRows:trace.maxRows,maxTagRows,maxStagedTags,
        fullDtos,heapStart,heapSample,elapsedMs:Math.round(performance.now()-started)}
      trace=undefined
      observations.push({size,...observation})
      check(fullDtos===0&&observation.maxRows<=50&&maxTagRows===50&&maxStagedTags===50,'EVENT_PROVENANCE_BOUNDS')
      const snapshot=await candidate.withDomains({},async ({events})=>{
        const audits=await auditOracle(events,worldId,id)
        check(audits.length===1,'EVENT_AUDIT_COUNT')
        const {previous,next}=audits[0]
        check(previous.lifeSources.length===size&&next.lifeSources.length===size,'EVENT_TAG_TAIL')
        check(JSON.stringify(previous.sourceRefs)===JSON.stringify(refs)
          &&JSON.stringify(next.future)===JSON.stringify(fields.future)&&next.action.future===null,'EVENT_LEGACY_JSON')
        const grants=next.lifeSources.map(tag=>tag.grantId)
        check(grants[0]==='grant-'+seeds.deniedActor.replace(/\d+$/,'0')&&new Set(grants).size===size,'EVENT_LEGACY_TAG_ORDER')
        const {entries:effects,cursor:effectTail}=await events.effects(worldId,id)
        check(!effectTail,'EVENT_EFFECT_SINGLE_PAGE')
        check(effects.length===1&&effects[0].value===fields.action.location&&effects[0].eventId===id,'EVENT_EFFECT_OWNER')
        return {count:grants.length,sha256:sha256Text(JSON.stringify(grants))}
      })
      const opened=await model.openRevocation(id,undefined,guard)
      trace={queries:0,writes:0,maxRows:0,observeQuery(rows){
        fullDtos+=rows.filter(row=>(Object.hasOwn(row,'extensions_json')&&Object.hasOwn(row,'summary')&&Object.hasOwn(row,'recorded_at'))
          ||Object.hasOwn(row,'previous_json')).length
      }}
      const correction=await model.correctConfirmedEvent(opened.plan,undefined,'mr2-event-correct-'+size,'合成修正',guard)
      check((await model.correctConfirmedEvent(opened.plan,undefined,'mr2-event-correct-'+size,'合成修正',guard)).id===correction.id,
        'EVENT_CORRECTION_RECEIPT')
      const correctionIo={queries:trace.queries,writes:trace.writes,maxRows:trace.maxRows,fullDtos}
      trace=undefined
      check(fullDtos===0&&correctionIo.maxRows<=128,'EVENT_CORRECTION_BOUNDS')
      await candidate.withDomains({},async ({events})=>{
        const replacement=await correctionOracle(events,worldId,correction.id)
        check(replacement.replacesEventId===id&&replacement.lifeSources.length===size
          &&JSON.stringify(replacement.sourceRefs)===JSON.stringify(refs),'EVENT_CORRECTION_RELATIONS')
        check((await events.revocationAudits(worldId,id)).entries.length===1,'EVENT_CORRECTION_AUDIT')
      })
      await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,seeds.deniedActor,'todo',1,
        {read:false,remember:false,share:false}))
      let deniedBodyReads=0
      trace={queries:0,writes:0,maxRows:0,observeQuery(rows){
        deniedBodyReads+=rows.filter(row=>Object.hasOwn(row,'summary')).length
      }}
      await rejects(()=>candidate.withDomains({},domains=>domains.events.readFor(worldId,seeds.eventId,{instanceId,group:false})),'KANATA_LIFE_PERMISSION_DENIED')
      await rejects(()=>model.proposeEventAcknowledged(fields,'mr2-event-denied-'+size,guard),'KANATA_LIFE_PERMISSION_DENIED')
      await rejects(()=>model.proposeEventAcknowledged({...fields,sourceRefs:[{messageId:source,revision:2}]},
        'mr2-event-stale-'+size,guard),'KANATA_SOURCE_STALE')
      check(deniedBodyReads===0,'EVENT_DENIED_BODY')
      trace=undefined
      results.push({size,...observation,correctionIo,snapshot,deniedBodyReads,cancellation,commitFailure:true,idempotentReplay:true})
    }
    return {health,results,realModelCalls:0}
  } catch(error) {
    return {error:error.code??error.message,results,observations}
  } finally {
    trace=undefined
    eventCommitFault=undefined
    runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}

window.mr2QaArmEventCrash = async (password, {worldId,instanceId}) => {
  session(password)
  const runtime=candidate.createWorldRuntime(()=>50000)
  const model=runtime.select(worldId), guard=()=>{}
  const {id}=await model.proposeEventAcknowledged({worldId,participantIds:[instanceId],sourceRefs:[],causedByEventIds:[],
    visibility:'private',summary:'合成强停事件',effectiveAt:9000,kind:'move',action:{instanceId,location:'强停恢复位置'}},
  'mr2-event-crash',guard)
  crashState='idle'
  suspendCommit=true
  void model.commitEventAcknowledged(id,1,guard).catch(error=>{crashState=error.code??error.message})
  return id
}
window.mr2QaRecoverEventCrash = async (password, worldId, id) => {
  session(password)
  const runtime=candidate.createWorldRuntime(()=>50000)
  const model=runtime.select(worldId), guard=()=>{}
  try {
    const inspect=()=>candidate.withDomains({},async ({events})=>({
      revision:(await events.managedEvent(worldId,id)).revision,
      audits:(await events.audits(worldId,id)).entries.length,
      effects:(await events.effects(worldId,id)).entries.length,
    }))
    const before=await inspect()
    check(before.revision===1&&before.audits===0&&before.effects===0,'EVENT_CRASH_ROLLBACK')
    check((await model.commitEventAcknowledged(id,1,guard)).id===id,'EVENT_CRASH_RETRY')
    check((await model.commitEventAcknowledged(id,1,guard)).id===id,'EVENT_CRASH_RECEIPT')
    const after=await inspect()
    check(after.revision===2&&after.audits===1&&after.effects===1,'EVENT_CRASH_REPLAY')
    return {before,after}
  } finally {
    runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}

window.mr2QaEventRead = async (password,{commands,scope,sample},size) => {
  window.mr2EventReadPhase='seed'
  session(password)
  const {worldId,instanceId}=scope
  const viewer={instanceId,group:false}
  const runtime=candidate.createWorldRuntime(()=>50000)
  try{
    const health=await candidate.run({create:!!commands},async operation=>{
      if(commands)await operation.transaction(async tx=>{
        for(const {sql,parameters} of commands)await tx.execute(sql,parameters)
      })
      return operation.health()
    })
    if(commands)await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,instanceId,'todo',2,
      {read:true,remember:true,share:true}))
    const source='event-read-source-'+size
    const {lifeSources:_life,...base}=sample
    await candidate.withRepositories({},messages=>messages.insert({...base,id:source,revision:1,createdAt:5000+size}))
    const seeds=await candidate.run({},operation=>operation.transaction(tx=>seedWideChatSources(tx,scope,source,size)))
    let model=runtime.select(worldId)
    const guard=()=>{}
    const ref={messageId:source,revision:1,future:'界😀'.repeat(3200)}
    const fields={worldId,participantIds:[instanceId],sourceRefs:[ref],causedByEventIds:[seeds.eventId],
      visibility:'private',summary:'合成事件读取',effectiveAt:5000,kind:'move',action:{instanceId,location:'合成读取位置'},
      future:{value:'界😀'.repeat(4400),nil:null}}
    const {id}=await model.proposeEventAcknowledged(fields,'mr2-read-'+size,guard)
    await model.commitEventAcknowledged(id,1,guard)
    await candidate.run({},operation=>operation.transaction(async tx=>{
      await tx.execute(eventReadEffects,[size-1,'zz-read-effect-'+size+'-',worldId,id,instanceId,instanceId])
      await tx.execute(eventReadRevision,[size+2,worldId,id])
      await tx.execute(eventReadAudits,[size-1,'zz-read-audit-'+size+'-',worldId,id])
    }))
    let fullDtos=0,maxPageObjects=0,maxChunk=0,revokedBodyReads=0
    let previousId='',tagHash=''
    trace={queries:0,writes:0,maxRows:0,profile:{},observeQuery(rows){
      fullDtos+=rows.filter(row=>Object.hasOwn(row,'previous_json')||Object.hasOwn(row,'next_json')
        ||(Object.hasOwn(row,'summary')&&Object.hasOwn(row,'extensions_json'))).length
    }}
    window.mr2EventReadPhase='read'
    const started=performance.now()
    const injected={instanceId:'g4-origin-'+size+'-0',group:false,sharedMemory:true}
    await rejects(()=>model.eventReadFor(id,injected,guard),'EVENT_CONTEXT_DENIED')
    await rejects(()=>model.eventJsonChunk(id,{kind:'summary'},injected,undefined,guard),'EVENT_CONTEXT_DENIED')
    const header=await model.eventReadFor(id,viewer,guard)
    check(header.revision===size+2&&header.summary===fields.summary,'EVENT_READ_HEADER')
    let initial=await model.eventRelations(id,'lifeSources',null,undefined,guard)
    const old=model
    model=runtime.select(worldId)
    await rejects(()=>model.eventRelations(id,'lifeSources',null,initial.cursor,guard),'EVENT_READ_CURSOR_STALE')
    await rejects(()=>old.eventReadFor(id,viewer,guard),'KANATA_WORLD_OWNER_EXPIRED')
    initial=null
    window.mr2EventReadPhase='read-tags'
    let cursor,tagCount=0
    do {
      const page=await model.eventRelations(id,'lifeSources',null,cursor,guard)
      maxPageObjects=Math.max(maxPageObjects,page.entries.length)
      for(const entry of page.entries){
        const value=entry.value
        check(value&&previousId<value.grantId,'EVENT_READ_TAG_ORDER')
        previousId=value.grantId
        tagHash=sha256Text(tagHash+previousId)
        tagCount++
      }
      cursor=page.cursor
    }while(cursor)
    check(tagCount===size,'EVENT_READ_TAG_COUNT')
    window.mr2EventReadPhase='read-reference'
    const refs=await model.eventRelations(id,'sourceRefs',viewer,undefined,guard)
    check(refs.entries[0].chunked===true,'EVENT_READ_REFERENCE_CHUNK')
    async function inspectChunk(selection,access,expected){
      let cursor,offset=0
      do {
        const page=await model.eventJsonChunk(id,selection,access,cursor,guard)
        const n=Array.from(page.part).length
        maxChunk=Math.max(maxChunk,n)
        if(expected){
          const part=Array.from(expected).slice(offset,offset+n).join('')
          check(page.part===part,'EVENT_READ_CHUNK_ORACLE')
        }
        offset+=n
        cursor=page.cursor
      }while(cursor)
      if(expected)check(offset===Array.from(expected).length,'EVENT_READ_CHUNK_TAIL')
      return offset
    }
    await inspectChunk({kind:'relation',relation:'sourceRefs',position:0},viewer,JSON.stringify(ref))
    window.mr2EventReadPhase='read-effects'
    let effectCount=0
    cursor=undefined
    do{
      const page=await model.eventEffects(id,cursor,guard)
      maxPageObjects=Math.max(maxPageObjects,page.entries.length)
      effectCount+=page.entries.length
      cursor=page.cursor
    }while(cursor)
    window.mr2EventReadPhase='read-audits'
    let auditCount=0,firstAudit
    cursor=undefined
    do{
      const page=await model.eventAudits(id,cursor,guard)
      maxPageObjects=Math.max(maxPageObjects,page.entries.length)
      firstAudit??=page.entries[0]
      auditCount+=page.entries.length
      cursor=page.cursor
    }while(cursor)
    check(auditCount===size+1&&effectCount===size+1,'EVENT_READ_EFFECT_AUDIT_COUNTS')
    window.mr2EventReadPhase='read-snapshot'
    const snapshotCharacters=await inspectChunk({kind:'audit',auditId:firstAudit.id,side:'next',snapshotRevision:2},null)
    const measured={queries:trace.queries,maxRows:trace.maxRows,elapsedMs:Math.round(performance.now()-started),
      fullDtos,maxPageObjects,maxChunk,profile:trace.profile}
    trace=undefined
    check(measured.maxRows<=51&&maxPageObjects<=50&&maxChunk<=4096&&fullDtos===0,'EVENT_READ_BOUNDS')
    window.mr2EventReadPhase='faults'
    const afterClose={}
    for(const [kind,read] of [
      ['header',guard=>model.eventReadFor(id,viewer,guard)],
      ['relation',guard=>model.eventRelations(id,'lifeSources',null,undefined,guard)],
      ['effect',guard=>model.eventEffects(id,undefined,guard)],
      ['audit',guard=>model.eventAudits(id,undefined,guard)],
      ['snapshot',guard=>model.eventJsonChunk(id,{kind:'audit',auditId:firstAudit.id,side:'next',snapshotRevision:2},null,undefined,guard)],
    ]){
      let closed=false,readAtClose
      trace={queries:0,writes:0,maxRows:0,observeQuery(){
        if(!closed){closed=true;readAtClose=trace.queries}
      }}
      await rejects(()=>read(()=>{if(closed)throw new Error('EVENT_READ_CLOSED')}),'EVENT_READ_CLOSED')
      afterClose[kind]=trace.queries-readAtClose
      trace=undefined
      check(afterClose[kind]===0,'EVENT_READ_AFTER_CLOSE')
    }
    const auditStatement=eventReadQueries.find(sql=>sql.includes('AS effect_count'))
    trace={queries:0,writes:0,maxRows:0,failQuery:sha256Text(auditStatement)}
    let queryFailure
    try{await model.eventAudits(id,undefined,guard)}
    catch(error){queryFailure=error.code??error.message}
    trace=undefined
    check(queryFailure&&((await model.eventAudits(id,undefined,guard)).entries[0].id===firstAudit.id),'EVENT_READ_QUERY_RECOVERY')
    await candidate.withDomains({},domains=>domains.autonomy.setGrant(worldId,seeds.deniedActor,'todo',1,
      {read:false,remember:false,share:false}))
    trace={queries:0,writes:0,maxRows:0,observeQuery(rows){
      revokedBodyReads+=rows.filter(row=>Object.hasOwn(row,'summary')||Object.hasOwn(row,'item')||Object.hasOwn(row,'part')).length
    }}
    await rejects(()=>model.eventReadFor(id,viewer,guard),'KANATA_LIFE_PERMISSION_DENIED')
    await rejects(()=>model.eventRelations(id,'lifeSources',viewer,undefined,guard),'KANATA_LIFE_PERMISSION_DENIED')
    const afterRevoke=trace.queries
    trace=undefined
    check(revokedBodyReads===0,'EVENT_READ_REVOKED_BODY')
    trace={queries:0,writes:0,maxRows:0}
    auth.expireSession()
    await rejects(()=>model.eventReadFor(id,viewer,guard),'KANATA_WORLD_OWNER_EXPIRED')
    const afterLock=trace.queries
    check(afterLock===0,'EVENT_READ_AFTER_LOCK')
    trace=undefined
    session(password)
    const recovered=runtime.select(worldId)
    check((await recovered.eventDetail(id,guard)).id===id,'EVENT_READ_UNLOCK_RECOVERY')
    return {health,size,id,...measured,afterLock,tagCount,tagHash,effectCount,auditCount,snapshotCharacters,afterClose,afterRevoke,revokedBodyReads,queryFailure}
  }catch(error){
    return {size,error:error.code??error.message}
  }finally{
    trace=undefined
    runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}

window.mr2QaEventReadShape = async (password,{scope,sample},size,shape) => {
  session(password)
  window.mr2EventReadPhase='seed'
  const {worldId,instanceId}=scope
  const runtime=candidate.createWorldRuntime(()=>50000)
  try{
    const prefix='event-read-'+shape+'-'+size+'-',root=prefix+'0'
    const source='event-read-'+shape+'-source-'+size
    const second='g4-origin-'+size+'-0'
    const {lifeSources:_life,...base}=sample
    await candidate.withRepositories({},messages=>messages.insert({...base,id:source,revision:1,
      lifeSources:[{grantId:'grant-'+second,instanceId:second,moduleId:'todo',revision:1,fingerprint:'0'.repeat(64)}]}))
    let seedPlans
    await candidate.run({},operation=>operation.transaction(async tx=>{
      check((await tx.execute(eventRows,[size,prefix,worldId])).affectedRows===size+1,'EVENT_SHAPE_SEED')
      seedPlans=await seedEventReadShape(tx,size,worldId,prefix,shape)
      check(seedPlans.affectedRows===size,'EVENT_SHAPE_EDGES')
      for(const actor of [instanceId,second])await tx.execute(chatEventActor,[worldId,root,actor])
      await tx.execute(eventReadPublic,[worldId,root])
      await tx.execute(chatEventSource,[worldId,prefix+size,source])
    }))
    const model=runtime.select(worldId),guard=()=>{}
    let fullDtos=0,graphCount=0,maxPage=0,firstPage
    trace={queries:0,writes:0,maxRows:0,observeQuery(rows){
      fullDtos+=rows.filter(row=>Object.hasOwn(row,'extensions_json')||Object.hasOwn(row,'previous_json')).length
    }}
    window.mr2EventReadPhase='read'
    const start=performance.now()
    for(const actor of [instanceId,second]){
      const header=await model.eventReadFor(root,{instanceId:actor,group:true},guard)
      check(header.id===root,'EVENT_SHAPE_AUTHORIZED')
    }
    let cursor
    do{
      const page=await model.eventGraph(root,'cause',cursor,guard)
      firstPage??=page.cursor
      graphCount+=page.entries.length
      maxPage=Math.max(maxPage,page.entries.length)
      cursor=page.cursor
    }while(cursor)
    check(graphCount===size&&maxPage<=50&&trace.maxRows<=51&&fullDtos===0,'EVENT_SHAPE_BOUNDS')
    const io={queries:trace.queries,maxRows:trace.maxRows,elapsedMs:Math.round(performance.now()-start),graphCount,maxPage,fullDtos}
    trace=undefined
    await candidate.run({},operation=>operation.transaction(tx=>tx.execute(eventReadRevision,[2,worldId,root])))
    await rejects(()=>model.eventGraph(root,'cause',firstPage,guard),'EVENT_GRAPH_CURSOR_STALE')
    return {size,shape,...io,stale:true,seedPlans}
  }catch(error){
    return {size,shape,error:error.code??error.message}
  }finally{
    trace=undefined
    runtime.dispose()
    auth.expireSession()
    await candidate.release()
  }
}

window.eventSemanticsQa = async(password,fixture,commands)=>{
  session(password)
  try{return await runEventSemanticsDevice(candidate,fixture,commands)}
  catch(error){return {error:error.code??error.message,stack:error.stack}}
  finally{auth.expireSession();await candidate.release()}
}
