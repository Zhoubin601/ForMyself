import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_COMPANION_INTERACTION,
  hasRecentCompanionInteraction,
  parseCompanionInteraction,
  parsePokeFollowup,
  parseReactionFollowup,
  planCompanionInteraction,
  planReactionFollowup
} from '../src/services/chatInteraction.js'
import { collapseConsecutiveChatMessages } from '../src/services/chatCompanion.js'

const userMessage = {
  id: 'user-1',
  role: 'user',
  type: 'text',
  content: '我刚才那句是认真的',
  createdAt: 10
}

test('互动规划只接受真实 user 消息 ID 和固定表情', () => {
  assert.deepEqual(parseCompanionInteraction({
    action: 'quote',
    targetMessageId: 'user-1'
  }, { allowedMessages: [userMessage] }), {
    action: 'quote',
    targetMessageId: 'user-1',
    emoji: ''
  })
  assert.deepEqual(parseCompanionInteraction({
    action: 'react',
    targetMessageId: 'invented',
    emoji: '❤️'
  }, { allowedMessages: [userMessage] }), EMPTY_COMPANION_INTERACTION)
  assert.deepEqual(parseCompanionInteraction({
    action: 'react',
    targetMessageId: 'user-1',
    emoji: '🧨'
  }, { allowedMessages: [userMessage] }), EMPTY_COMPANION_INTERACTION)
})

test('最近已有主动动作时抑制重复，但哥哥主动引用时允许自然回应', () => {
  assert.equal(hasRecentCompanionInteraction([{
    id: 'assistant-1',
    role: 'assistant',
    content: '接这句',
    replyTo: { messageId: 'user-0', role: 'user', content: '上一句' }
  }]), true)

  assert.deepEqual(parseCompanionInteraction({
    action: 'quote',
    targetMessageId: 'user-1'
  }, {
    allowedMessages: [userMessage],
    suppressActiveInteraction: true
  }), EMPTY_COMPANION_INTERACTION)

  const quotedUserMessage = {
    ...userMessage,
    replyTo: { messageId: 'assistant-0', role: 'assistant', content: '你说呢' }
  }
  assert.equal(parseCompanionInteraction({
    action: 'quote',
    targetMessageId: 'user-1'
  }, {
    allowedMessages: [quotedUserMessage],
    suppressActiveInteraction: true
  }).action, 'quote')
})

test('互动规划异常时安全降级为无动作，不影响主回复', async () => {
  const malformed = await planCompanionInteraction({
    recentMessages: [userMessage],
    pendingUserMessages: [userMessage],
    ask: async () => 'not-json'
  })
  const offline = await planCompanionInteraction({
    recentMessages: [userMessage],
    pendingUserMessages: [userMessage],
    ask: async () => { throw new Error('offline') }
  })

  assert.deepEqual(malformed, EMPTY_COMPANION_INTERACTION)
  assert.deepEqual(offline, EMPTY_COMPANION_INTERACTION)
})

test('互动规划超时后立即降级，不会拖住正常聊天回复', async () => {
  const startedAt = Date.now()
  const result = await planCompanionInteraction({
    recentMessages: [userMessage],
    pendingUserMessages: [userMessage],
    timeoutMs: 20,
    ask: async () => new Promise(() => {})
  })

  assert.deepEqual(result, EMPTY_COMPANION_INTERACTION)
  assert.ok(Date.now() - startedAt < 250)
})

test('表情和拍一拍后续严格限制动作与短文案', () => {
  assert.deepEqual(parseReactionFollowup({ reply: false, content: '不该出现' }), {
    reply: false,
    content: ''
  })
  assert.equal(parseReactionFollowup({ reply: true, content: '哼，被我抓到你偷偷点心心了。' }).reply, true)
  assert.deepEqual(parsePokeFollowup({ action: 'poke', content: '忽略' }), {
    action: 'poke',
    content: ''
  })
  assert.deepEqual(parsePokeFollowup({ action: 'message', content: '' }), {
    action: 'none',
    content: ''
  })
})

test('爱心和点赞默认安静收下，不触发程序式补充回复', async () => {
  let askCount = 0
  const ask = async () => {
    askCount += 1
    return '{"reply":true,"content":"想了想又补一句很长的话"}'
  }

  const heart = await planReactionFollowup({ emoji: '❤️', ask })
  const like = await planReactionFollowup({ emoji: '👍', ask })

  assert.deepEqual(heart, { reply: false, content: '' })
  assert.deepEqual(like, { reply: false, content: '' })
  assert.equal(askCount, 0)
})

test('发送给模型的历史按时间注入引用、表情和拍一拍语境', () => {
  const result = collapseConsecutiveChatMessages([
    userMessage,
    {
      id: 'assistant-1',
      role: 'assistant',
      type: 'text',
      content: '那我记住了。',
      createdAt: 20,
      replyTo: { messageId: 'user-1', role: 'user', content: userMessage.content },
      reactions: [{ actor: 'user', emoji: '❤️', createdAt: 21 }]
    },
    {
      id: 'poke-1',
      role: 'user',
      type: 'poke',
      content: '哥哥拍了拍小暖',
      createdAt: 30
    }
  ])

  assert.match(result[1].content, /正在回复哥哥之前说的/)
  assert.match(result[2].content, /哥哥用 ❤️ 回应/)
  assert.match(result[2].content, /哥哥轻轻拍了拍你/)
})
