import test from 'node:test'
import assert from 'node:assert/strict'
import { createAndroidKanataSqliteDriver } from '../src/platform/storage/androidKanataSqliteDriver.js'
import { createKanataSqliteCandidate } from '../src/application/kanataSqliteCandidate.js'
import { restoreState } from '../src/platform/storage/restoreState.js'
import { useKanataMessageWindow } from '../src/features/chat/useKanataMessageWindow.js'

function harness(patch) {
  const calls = []
  const key = new Uint8Array(32).fill(7)
  const bridge = {
    async prepare() { return { token: 'challenge', salt: 'synthetic-salt' } },
    async unlock() { return { lease: 'lease' } },
    async completeOpen() {},
    async begin() { calls.push('begin'); return { transaction: 'transaction' } },
    async query() { calls.push('query'); return { rows: [] } },
    async execute() { calls.push('execute'); return { affectedRows: 1 } },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    async close() { calls.push('close') },
    ...patch,
  }
  const context = { sessionRevision: 1, ownerGeneration: 1, assertCurrent() {}, deriveKey: async () => key }
  const driver = createAndroidKanataSqliteDriver({ initialize: async () => {}, bridge })
  return { calls, key, bridge, context, driver }
}

test('releasing with a pending native query drops the result and forbids commit and reuse', async () => {
  let returnRows, queryStarted
  const started = new Promise(resolve => { queryStarted = resolve })
  const response = new Promise(resolve => { returnRows = resolve })
  const h = harness({ async query() { queryStarted(); return response } })
  const operation = await h.driver.open(h.context, { create: false })
  assert.equal(h.key.every(byte => byte === 0), true)
  const task = operation.transaction(tx => tx.query('scoped query'))
  const rejected = assert.rejects(task, /LEASE_REVOKED/)
  await started
  await h.driver.release()
  returnRows({ rows: [{ content: 'synthetic old generation' }] })
  await rejected
  assert.deepEqual(h.calls, ['begin', 'close'])
  await assert.rejects(operation.transaction(async () => undefined), /LEASE_REVOKED/)
})

test('a caught statement failure aborts the transaction and cannot be treated as success', async () => {
  const h = harness({ async execute() { throw Object.assign(new Error('sensitive-native-body'), { code: 'NOT_A_PUBLIC_CODE' }) } })
  const operation = await h.driver.open(h.context, { create: false })
  await assert.rejects(operation.transaction(async tx => {
    await assert.rejects(tx.execute('fixed write'), /^Error: KANATA_SQLITE_BRIDGE_FAILED$/)
    return true
  }), /TRANSACTION_FAILED/)
  assert.deepEqual(h.calls, ['begin', 'rollback'])
})

test('rollback failure poisons the driver even when close settles', async () => {
  const h = harness({ async rollback() { throw Error('native failure') } })
  const operation = await h.driver.open(h.context, { create: false })
  await assert.rejects(operation.transaction(async () => { throw Error('callback failed') }),
    failure => failure.code === 'KANATA_SQLITE_ROLLBACK_FAILED' && failure.rollbackFailed === true)
  assert.deepEqual(h.calls, ['begin', 'close'])
  await assert.rejects(h.driver.open(h.context, { create: false }), /LEASE_REVOKED/)
})

test('the candidate rejects recovery before the native open', async () => {
  let opened = false
  const candidate = createKanataSqliteCandidate({
    syntheticOnly: true,
    access: { runOperation: async (_modules, action) => action(undefined, 1) },
    auth: { isLocked: false, sessionRevision: 1 },
    bridge: { prepare: async () => { opened = true }, close: async () => {} },
  })
  try {
    restoreState.busy = true
    await assert.rejects(candidate.run({}, async () => {}), /STATE_UNKNOWN/)
    restoreState.blocked = true
    restoreState.busy = false
    await assert.rejects(candidate.run({}, async () => {}), /完整数据恢复尚未完成/)
    assert.equal(opened, false)
  } finally {
    restoreState.busy = restoreState.blocked = false
    await candidate.dispose()
  }
})

test('a late page and quote cannot repopulate the message window after switching scope', async () => {
  let resolveFirst, resolveQuote
  const first = new Promise(resolve => { resolveFirst = resolve })
  const quote = new Promise(resolve => { resolveQuote = resolve })
  const page = id => ({ messages: [{ id }], cursor: null, hasMore: false })
  const window = useKanataMessageWindow({
    owner: conversationId => ({ scope: { worldId: 'synthetic-world', conversationId }, assertOwner() {} }),
    read: (_owner, query) => query({
      recent: scope => scope.conversationId === 'first' ? first : Promise.resolve(page('new-scope')),
      quote: () => quote,
    }),
  })
  const pendingPage = window.activate('first')
  const pendingQuote = window.showQuote('old-scope')
  await window.activate('second')
  resolveFirst(page('old-scope'))
  resolveQuote({ id: 'old-scope', content: 'synthetic quote' })
  await Promise.all([pendingPage, pendingQuote])
  assert.deepEqual(window.messages.value, [{ id: 'new-scope' }])
  assert.equal(window.quote.value, null)
  window.reset()
  assert.deepEqual(window.messages.value, [])
})
