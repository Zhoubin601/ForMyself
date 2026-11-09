import { memoryRows, memoryEdges, eventRows, eventEdges } from '../kanata-sqlite-m4/completion/fixture.mjs'
import { growthSeedSql } from '../kanata-sqlite-m4/fixture.mjs'
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
let suspendCommit = false
let crashState = 'idle'
const candidate = createKanataSqliteCandidate({
  syntheticOnly: true, auth, access, bridge: {
    prepare: bridge.prepare, unlock: bridge.unlock, begin: bridge.begin,
    async execute(command) {
      if (trace) trace.writes++
      return bridge.execute(command)
    },
    async query(command) {
      const result = await bridge.query(command)
      if (trace) {
        trace.queries++
        trace.maxRows = Math.max(trace.maxRows, result.rows.length)
      }
      return result
    },
    close: bridge.close, health: bridge.health, rollback: bridge.rollback, completeOpen: bridge.completeOpen,
    commit: options => {
      if (!suspendCommit) return bridge.commit(options)
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
      let failure = true, deltas = 0, resumeProvider
      const runtime = createKanataSqliteChatRuntime({
        candidate, auth, clock: () => 90000,
        lifeReaders: { home: async () => [{ value: '合成生活资料授权标记' }] },
        completion: async options => {
          controlledModelCalls++
          check(options.messages.length <= 41, 'M4_PROMPT_UNBOUNDED')
          if (failure) { failure = false; throw new Error('M4_CONTROLLED_PROVIDER_FAILURE') }
          if (options.messages.some(item => item.role === 'user' && item.content.includes('合成授权迟到'))) {
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
    return { samples, fullGraphCalls, controlledModelCalls, realModelCalls: 0, restoreGate: 'PASS', revocationWhilePending }
  } catch (error) {
    return { error: error.code ?? error.message, samples, fullGraphCalls, controlledModelCalls }
  } finally { auth.expireSession(); await candidate.release() }
}
window.m4QaWorkspace = async (password, { worldId, worldName, conversationId, actorId }) => {
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
  const app = createApp({ render: () => h(KanataCandidateWorkspace, { worlds, lifecycle, createChat }) }).use(pinia)
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
    return { passed }
  } catch (error) {
    return { error: error.code ?? error.message, passed, stage, uiError: container.querySelector('[role=alert]')?.textContent }
  } finally {
    app.unmount()
    container.remove()
    auth.expireSession()
    await candidate.release()
  }
}
window.m4QaCompletion = async (password, scope) => {
  session(password)
  const samples = []
  try {
    for (const size of [1000, 10000]) {
      const memory = 'm4c-memory-' + size + '-', event = 'm4c-event-' + size + '-'
      await candidate.run({}, operation => operation.transaction(async tx => {
        check((await tx.execute(memoryRows, [size, memory, scope.worldId, scope.instanceId, scope.instanceId])).affectedRows === size+1, 'C2_MEMORY_SEED')
        check((await tx.execute(memoryEdges, [size-1, scope.worldId, memory, memory])).affectedRows === size, 'C2_MEMORY_EDGE_SEED')
        check((await tx.execute(eventRows, [size, event, scope.worldId])).affectedRows === size+1, 'C2_EVENT_SEED')
        check((await tx.execute(eventEdges, [size-1, scope.worldId, event, event])).affectedRows === size, 'C2_EVENT_EDGE_SEED')
      }))
      trace = { queries:0, writes:0, maxRows:0 }
      const item = await candidate.withDomains({}, domains => domains.memories.readDetailFor(scope, memory+'0'))
      check(item?.id === memory+'0', 'C2_MEMORY_AUTHORIZATION')
      const memoryTrace = {...trace}
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
      samples.push({ size, memory:memoryTrace, event:{...trace, total:count} })
      trace=undefined
    }
    return { samples }
  } catch(error) {
    return { error:error.code??error.message, samples }
  } finally { trace=undefined; auth.expireSession(); await candidate.release() }
}