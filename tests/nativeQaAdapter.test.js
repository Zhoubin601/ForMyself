import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  computeChatSendReply,
  resolveFullBackupRuntimeFactory,
  resolveRestoreJournal,
  resolveRestoreState,
  verifyKanataPreservedData
} from '../docs/qa/architecture-20261026/native/runtimeAdapter.mjs'

test('M-01: 仅视图可见或模块已加载不得判定 chatSendReply 为 true', () => {
  assert.equal(computeChatSendReply({
    chatModuleLoaded: true,
    chatViewReady: true,
    chatUserMessageSent: false,
    chatAssistantReplied: false
  }), false)
  assert.equal(computeChatSendReply({
    chatModuleLoaded: true,
    chatViewReady: true,
    chatUserMessageSent: true,
    chatAssistantReplied: false
  }), false)
  assert.equal(computeChatSendReply({
    chatModuleLoaded: true,
    chatViewReady: false,
    chatUserMessageSent: true,
    chatAssistantReplied: true
  }), false)
  assert.equal(computeChatSendReply({
    chatModuleLoaded: true,
    chatViewReady: true,
    chatUserMessageSent: true,
    chatAssistantReplied: true
  }), true)
})

test('M-02: Kanata 密码变更后的数据保留必须核对稳定 ID 与内容一致', () => {
  const expected = {
    worldId: 'world-synthetic-1',
    worldName: '阿拜多斯 · 对策委员会日常',
    conversationId: 'private-synthetic-1',
    userMessageId: 'msg-user-1',
    userMessageContent: '合成原生测试消息',
    assistantMessageId: 'msg-assistant-1',
    assistantMessageContent: '合成回复：原生验证已收到消息。'
  }
  const matchingSnapshot = {
    worlds: [{ id: 'world-synthetic-1', name: '阿拜多斯 · 对策委员会日常' }],
    conversations: [{ id: 'private-synthetic-1', worldId: 'world-synthetic-1' }],
    messages: [
      {
        id: 'msg-user-1',
        conversationId: 'private-synthetic-1',
        role: 'user',
        status: 'complete',
        content: '合成原生测试消息'
      },
      {
        id: 'msg-assistant-1',
        conversationId: 'private-synthetic-1',
        role: 'assistant',
        status: 'complete',
        replyToMessageId: 'msg-user-1',
        content: '合成回复：原生验证已收到消息。'
      }
    ]
  }
  assert.deepEqual(verifyKanataPreservedData(matchingSnapshot, expected), {
    ok: true,
    worldFound: true,
    conversationFound: true,
    userMessageMatched: true,
    assistantMessageMatched: true
  })

  // 仅有空世界或内容被篡改、ID 不一致均必须判定失败
  assert.equal(verifyKanataPreservedData({ worlds: [], conversations: [], messages: [] }, expected).ok, false)
  assert.equal(verifyKanataPreservedData({
    ...matchingSnapshot,
    messages: [
      matchingSnapshot.messages[0],
      { ...matchingSnapshot.messages[1], content: '内容已被篡改' }
    ]
  }, expected).ok, false)
  assert.equal(verifyKanataPreservedData({
    ...matchingSnapshot,
    messages: [
      { ...matchingSnapshot.messages[0], id: 'msg-user-other' },
      matchingSnapshot.messages[1]
    ]
  }, expected).ok, false)
})

test('L-01: resolveFullBackupRuntimeFactory 绝不无参调用无关导出函数', () => {
  let unrelatedCalls = 0
  const unrelatedValidator = () => {
    unrelatedCalls += 1
    throw new Error('KanataValidationError: INVALID_JSON_VALUE:data')
  }
  const factory = () => ({ createFullBackupSnapshot: () => ({}) })

  const viteChunkShape = {
    a: unrelatedValidator,
    i: unrelatedValidator,
    n: Object.freeze({ createFullBackupRuntime: factory }),
    r: unrelatedValidator,
    t: factory
  }
  assert.equal(resolveFullBackupRuntimeFactory(viteChunkShape), factory)
  assert.equal(unrelatedCalls, 0)

  const directShape = {
    helper: unrelatedValidator,
    createFullBackupRuntime: factory
  }
  assert.equal(resolveFullBackupRuntimeFactory(directShape), factory)
  assert.equal(unrelatedCalls, 0)

  assert.throws(() => resolveFullBackupRuntimeFactory({ a: unrelatedValidator }), /Missing createFullBackupRuntime export/)
  assert.equal(unrelatedCalls, 0)

  assert.throws(() => resolveFullBackupRuntimeFactory({
    n1: { createFullBackupRuntime: factory },
    n2: { createFullBackupRuntime: () => ({}) }
  }), /Ambiguous createFullBackupRuntime exports/)
})

test('L-01: resolveRestoreState 与 resolveRestoreJournal 仅做属性形状检查而不调用函数', () => {
  let invoked = 0
  const decoyFn = () => { invoked += 1 }
  const fakeState = { blocked: false, busy: false, syncError: '' }
  assert.equal(resolveRestoreState({ a: decoyFn, n: fakeState, t: decoyFn }), fakeState)
  assert.equal(invoked, 0)

  const fakeJournal = { inspect: decoyFn, commit: decoyFn, prepare: decoyFn }
  assert.equal(resolveRestoreJournal({ x: decoyFn, j: fakeJournal }), fakeJournal)
  assert.equal(invoked, 0)
})

test('verify.mjs 使用确定性 QA adapter 且消除虚假 chatSendReply 与盲目候选扫描', () => {
  const verifySource = readFileSync(
    resolve(process.cwd(), 'docs/qa/architecture-20261026/native/verify.mjs'),
    'utf8'
  )
  assert.doesNotMatch(verifySource, /\.\.\.Object\.values\(mod/)
  assert.match(verifySource, /resolveFullBackupRuntimeFactory/)
  assert.match(verifySource, /computeChatSendReply\(results\)/)
  assert.match(verifySource, /verifyKanataPreservedData/)
  assert.doesNotMatch(verifySource, /results\.chatSendReply\s*=\s*true/)
})
