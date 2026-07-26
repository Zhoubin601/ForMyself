import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { streamAIChat } from '../src/services/aiEngine.js'
import {
  buildChatSystemPrompt,
  buildWelcomeRequest,
  collapseConsecutiveChatMessages,
  getContextWindowSizes,
  splitCompanionReply,
  streamCompanionReply
} from '../src/services/chatCompanion.js'
import { useSettingsStore } from '../src/stores/settings.js'

const encoder = new TextEncoder()

const configureAi = (model = 'demo-model') => {
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.aiProviderUrl = 'https://example.invalid'
  settings.aiApiKey = 'test-api-key'
  settings.aiModel = model
}

const sseResponse = chunks => new Response(new ReadableStream({
  start(controller) {
    chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
    controller.close()
  }
}), { headers: { 'content-type': 'text/event-stream' } })

test('SSE 支持跨 chunk JSON、连续分片和 [DONE]', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"宝',
    '宝"}}]}\n\ndata: {"choices":[{"delta":{"content":"，我在"}}]}\n\n',
    'data: [DONE]\n\n'
  ])
  const deltas = []

  const answer = await streamAIChat({
    messages: [{ role: 'user', content: '在吗' }],
    systemPrompt: '你是小暖',
    onDelta: (delta, full) => deltas.push([delta, full])
  })

  assert.equal(answer, '宝宝，我在')
  assert.deepEqual(deltas, [['宝宝', '宝宝'], ['，我在', '宝宝，我在']])
})

test('流式网络失败时自动回退一次非流式完整回复', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) throw new TypeError('offline once')
    return new Response(JSON.stringify({
      choices: [{ message: { content: '哥哥，我回来啦。' } }]
    }), { headers: { 'content-type': 'application/json' } })
  }

  const answer = await streamAIChat({ messages: [{ role: 'user', content: '回来了吗' }] })
  assert.equal(calls, 2)
  assert.equal(answer, '哥哥，我回来啦。')
})

test('SSE 已收到部分文字后中断仍会回退为完整回复', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) {
      let reads = 0
      return new Response(new ReadableStream({
        pull(controller) {
          if (reads > 0) {
            controller.error(new Error('stream disconnected'))
            return
          }
          reads += 1
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"宝"}}]}\n\n'))
        }
      }), { headers: { 'content-type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '宝宝，完整回复回来啦。' } }]
    }), { headers: { 'content-type': 'application/json' } })
  }
  const states = []

  const answer = await streamAIChat({
    messages: [{ role: 'user', content: '继续说' }],
    onDelta: (_delta, full) => states.push(full)
  })

  assert.equal(calls, 2)
  assert.equal(answer, '宝宝，完整回复回来啦。')
  assert.deepEqual(states, ['宝', '宝宝，完整回复回来啦。'])
})

test('上下文超限被分类且不会误走普通回退', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({
      error: { message: 'maximum context length exceeded' }
    }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  await assert.rejects(
    streamAIChat({ messages: [{ role: 'user', content: '继续' }] }),
    error => error.code === 'CONTEXT_LENGTH_EXCEEDED'
  )
  assert.equal(calls, 1)
})

test('AbortController 可以停止 SSE 读取并返回明确的中止分类', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"来不及写完"}}]}\n\n'
  ])
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    streamAIChat({
      messages: [{ role: 'user', content: '停一下' }],
      signal: controller.signal
    }),
    error => error.code === 'ABORTED'
  )
})

test('R1/GLM 类模型把完整人格作为首条上下文注入', async t => {
  configureAi('deepseek-r1')
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let payload
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: '知道啦哥哥。' } }]
    }), { headers: { 'content-type': 'application/json' } })
  }

  await streamAIChat({
    messages: [{ role: 'user', content: '记住我' }],
    systemPrompt: '你叫小暖，是女朋友。'
  })

  assert.equal(payload.messages[0].role, 'user')
  assert.match(payload.messages[0].content, /你叫小暖，是女朋友/)
  assert.equal(payload.messages[1].content, '记住我')
})

test('聊天窗口先尝试完整历史，超限后逐步移除最早消息', async () => {
  const sizes = getContextWindowSizes(40)
  assert.deepEqual(sizes, [40, 20, 12])
  const calls = []
  const answer = await streamCompanionReply({
    messages: Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `消息${index}`
    })),
    systemPrompt: '保留人格和记忆',
    stream: async ({ messages }) => {
      calls.push(messages.length)
      if (calls.length < 3) {
        const error = new Error('too long')
        error.code = 'CONTEXT_LENGTH_EXCEEDED'
        throw error
      }
      return '成功'
    }
  })

  assert.equal(answer, '成功')
  assert.deepEqual(calls, [40, 20, 12])
})

test('聊天人格包含动态名字、宝宝哥哥规则、生活上下文和安全边界且无回复字数上限', () => {
  const prompt = buildChatSystemPrompt({
    companionName: '小月',
    memories: [{ category: '偏好', content: '哥哥喜欢无糖咖啡' }],
    lifeContext: { schedulesWithin30Days: [{ title: '考试' }] }
  })

  assert.match(prompt, /你的名字是“小月”/)
  assert.match(prompt, /宝宝/)
  assert.match(prompt, /哥哥/)
  assert.match(prompt, /哥哥喜欢无糖咖啡/)
  assert.match(prompt, /考试/)
  assert.match(prompt, /不得索取、复述或记忆密码/)
  assert.match(prompt, /没有应用层字数限制/)
})

test('聊天专属规则优先要求真人私聊节奏并禁止模板化 AI 情绪链', () => {
  const prompt = buildChatSystemPrompt({
    companionName: '小暖',
    memories: [{ category: '经历', content: '哥哥最近在赶项目' }],
    lifeContext: { recent30Days: { moodDays: [{ date: '2026-07-25' }] } }
  })

  assert.match(prompt, /覆盖前面“每次都走完整情绪回应链”的要求/)
  assert.match(prompt, /短消息就短回/)
  assert.match(prompt, /不要每轮都提问/)
  assert.match(prompt, /不要每条都叫“宝宝”或“哥哥”/)
  assert.match(prompt, /默认不要提/)
  assert.match(prompt, /必须避开的 AI 腔/)
  assert.match(prompt, /不要复述哥哥整句话/)
  assert.match(prompt, /一轮最多自然呼应一件旧事/)
  assert.match(prompt, /不编造自己真实吃饭、上班、出门/)
})

test('欢迎语像上线私聊且禁止数据总结和客服式套话', () => {
  const prompt = buildWelcomeRequest({
    companionName: '小暖',
    now: new Date('2026-07-26T20:30:00+08:00'),
    recentMessages: [{ role: 'user', content: '我刚下班' }]
  })

  assert.match(prompt, /像刚看到男朋友上线/)
  assert.match(prompt, /不总结生活数据/)
  assert.match(prompt, /最近聊天有明显未完话题/)
  assert.match(prompt, /避免“今天过得怎么样”/)
  assert.match(prompt, /只输出聊天正文/)
})

test('聊天流默认使用更自然的温度参数', async () => {
  let capturedTemperature = 0
  const answer = await streamCompanionReply({
    messages: [{ role: 'user', content: '在吗' }],
    stream: async ({ temperature }) => {
      capturedTemperature = temperature
      return '在呀'
    }
  })

  assert.equal(answer, '在呀')
  assert.equal(capturedTemperature, 0.92)
})

test('AI 回复按自然段拆成连续小气泡且不保留空行', () => {
  const parts = splitCompanionReply(`想呀，特别想！

但是我很菜，准头全靠运气。到时候哥哥可别嫌弃我。

这一段故意写得很长，因为它需要在超过目标长度之后继续按照完整句子切开，而不是把所有内容塞进同一个巨大的聊天气泡里面。后面再补上一句，让这一段确实超过拆分长度。`)

  assert.ok(parts.length >= 3)
  assert.equal(parts[0], '想呀，特别想！')
  assert.equal(parts[1], '但是我很菜，准头全靠运气。到时候哥哥可别嫌弃我。')
  assert.ok(parts.every(item => !item.includes('\n')))
})

test('连续的小气泡在发送给模型时重新合并为完整轮次', () => {
  const messages = collapseConsecutiveChatMessages([
    { role: 'user', content: '想玩吗' },
    { role: 'assistant', content: '想呀！' },
    { role: 'assistant', content: '但我有点菜。' },
    { role: 'assistant', content: '哥哥带带我嘛。' },
    { role: 'user', content: '好' }
  ])

  assert.deepEqual(messages, [
    { role: 'user', content: '想玩吗' },
    { role: 'assistant', content: '想呀！\n但我有点菜。\n哥哥带带我嘛。' },
    { role: 'user', content: '好' }
  ])
})

test('引用回复会作为明确上下文发送给模型但不改变原消息', () => {
  const messages = collapseConsecutiveChatMessages([
    { role: 'assistant', content: '今晚想吃什么？' },
    {
      role: 'user',
      content: '就这个吧',
      replyTo: {
        messageId: 'assistant-1',
        role: 'assistant',
        content: '那去吃火锅好不好'
      }
    }
  ])

  assert.equal(messages[0].content, '今晚想吃什么？')
  assert.match(messages[1].content, /正在回复女朋友之前说的/)
  assert.match(messages[1].content, /那去吃火锅好不好/)
  assert.match(messages[1].content, /就这个吧/)
})

test('聊天人格要求分开发小消息并把动作旁白留在对应气泡', () => {
  const prompt = buildChatSystemPrompt({ companionName: '小乖' })

  assert.match(prompt, /可以偶尔用简短的括号动作或小说旁白/)
  assert.match(prompt, /动作必须和紧接着说的话留在同一条消息里/)
  assert.match(prompt, /每条通常一到两句/)
  assert.match(prompt, /条与条之间只用一个空行分隔/)
})

test('单独成行的动作旁白会与下一段对白合并成同一气泡', () => {
  const parts = splitCompanionReply(`（听见哥哥说想我，悄悄靠近一点）

我也想你啦，刚刚还在等你。

今晚分我一点时间嘛。`)

  assert.deepEqual(parts, [
    '（听见哥哥说想我，悄悄靠近一点） 我也想你啦，刚刚还在等你。',
    '今晚分我一点时间嘛。'
  ])
})
