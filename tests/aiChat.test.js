import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { streamAIChat } from '../src/services/aiEngine.js'
import {
  buildCompanionTurnContext,
  buildChatLifeContext,
  buildChatSystemPrompt,
  buildWelcomeRequest,
  classifyCompanionReplyMode,
  collapseConsecutiveChatMessages,
  getContextWindowSizes,
  isCompanionReplyComplete,
  sanitizeCompanionReply,
  selectTurnLifeContext,
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

test('SSE 明确因 token 上限结束时拒绝保存半截回复', async t => {
  configureAi('deepseek-v4-flash')
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"reasoning_content":"思考中"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"content":"【抬手"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n'
  ])

  await assert.rejects(
    streamAIChat({ messages: [{ role: 'user', content: '继续' }], maxTokens: 160 }),
    error => error.code === 'OUTPUT_TRUNCATED' && error.partialContent === '【抬手'
  )
})

test('流式网络失败时自动回退一次非流式完整回复', async t => {
  configureAi()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let calls = 0
  const payloads = []
  globalThis.fetch = async (_url, options) => {
    calls += 1
    payloads.push(JSON.parse(options.body))
    if (calls === 1) throw new TypeError('offline once')
    return new Response(JSON.stringify({
      choices: [{ message: { content: '哥哥，我回来啦。' } }]
    }), { headers: { 'content-type': 'application/json' } })
  }

  const answer = await streamAIChat({
    messages: [{ role: 'user', content: '回来了吗' }],
    maxTokens: 160
  })
  assert.equal(calls, 2)
  assert.equal(answer, '哥哥，我回来啦。')
  assert.ok(payloads.every(payload => payload.max_tokens === 160))
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

test('聊天窗口只发送最近24条历史，超限后缩至12条', async () => {
  const sizes = getContextWindowSizes(40)
  assert.deepEqual(sizes, [24, 12])
  const calls = []
  const answer = await streamCompanionReply({
    messages: Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `消息${index}`
    })),
    systemPrompt: '保留人格和记忆',
    stream: async ({ messages }) => {
      calls.push(messages.length)
      if (calls.length < 2) {
        const error = new Error('too long')
        error.code = 'CONTEXT_LENGTH_EXCEEDED'
        throw error
      }
      return '成功'
    }
  })

  assert.equal(answer, '成功')
  assert.deepEqual(calls, [24, 12])
})

test('聊天生活上下文保留近期完整记录并将久远数据压缩为月度概览', () => {
  const context = buildChatLifeContext({
    moodRecords: [
      {
        id: 'recent-mood',
        date: '2026-07-20',
        mood: 'good',
        tags: ['学习'],
        note: '最近完整心情正文',
        autoFilled: false
      },
      {
        id: 'old-mood',
        date: '2026-05-12',
        mood: 'bad',
        tags: ['工作'],
        note: '久远心情只进入月度重点',
        autoFilled: false
      },
      {
        id: 'old-placeholder',
        date: '2026-05-13',
        mood: 'normal',
        note: '',
        autoFilled: true
      }
    ],
    weightRecords: [
      { date: '2026-07-18', weight: 70, note: '近期体重备注' },
      { date: '2026-05-01', weight: 72, note: '月初' },
      { date: '2026-05-30', weight: 71, note: '月底' }
    ],
    scheduleOccurrences: [{
      title: '近期考试',
      type: 'event',
      categoryId: 'study',
      occurrenceDate: '2026-08-01',
      occurrenceEndDate: '2026-08-01',
      startTime: '09:00',
      endTime: '11:00',
      location: '教学楼',
      note: '带准考证',
      startAt: new Date('2026-08-01T09:00:00+08:00').getTime()
    }],
    scheduleSeries: [
      {
        id: 'weekly-study',
        title: '每周复习',
        type: 'task',
        categoryId: 'study',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        startTime: '20:00',
        endTime: '21:00',
        recurrence: { type: 'weekly', weekdays: [6] },
        note: '整理错题'
      },
      {
        id: 'old-event',
        title: '旧日旅行计划',
        type: 'event',
        categoryId: 'study',
        startDate: '2026-03-03',
        endDate: '2026-03-03',
        recurrence: { type: 'none' }
      }
    ],
    scheduleOccurrenceStates: [{
      key: 'old-event@2026-03-03',
      status: 'completed'
    }],
    scheduleCategories: [{ id: 'study', name: '学习' }]
  }, '2026-07-27')

  assert.equal(context.recent30Days.moodDays.length, 1)
  assert.equal(context.recent30Days.moodDays[0].events[0].note, '最近完整心情正文')
  assert.equal(context.recent30Days.weightRecords.length, 1)
  assert.equal(context.schedulesWithin30Days[0].category, '学习')
  assert.equal(context.schedulesWithin30Days[0].note, '带准考证')
  assert.equal(context.longTermOverviewBefore30Days.moodByMonth[0].month, '2026-05')
  assert.equal(context.longTermOverviewBefore30Days.moodByMonth[0].total, 1)
  assert.equal(context.longTermOverviewBefore30Days.weightByMonth[0].change, -1)
  assert.equal(context.longTermOverviewBefore30Days.schedules.recurringRules[0].title, '每周复习')
  assert.equal(context.longTermOverviewBefore30Days.schedules.distantOneOffByMonth[0].completed, 1)
})

test('聊天人格包含动态名字、相关上下文、安全边界和本轮硬上限', () => {
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
  assert.match(prompt, /最多约 120 个中文字符、3 个短气泡/)
  assert.match(prompt, /与本轮直接相关的生活背景/)
})

test('聊天专属规则使用独立真人私聊节奏并禁止模板化 AI 情绪链', () => {
  const prompt = buildChatSystemPrompt({
    companionName: '小暖',
    memories: [{ category: '经历', content: '哥哥最近在赶项目' }],
    lifeContext: { recent30Days: { moodDays: [{ date: '2026-07-25' }] } }
  })

  assert.match(prompt, /你的任务只是顺着哥哥刚发来的话自然接一句/)
  assert.match(prompt, /一句能接住就停/)
  assert.match(prompt, /不要每轮提问/)
  assert.match(prompt, /隔几轮才自然出现一次/)
  assert.match(prompt, /不要模仿其中的长篇、诗化、动作旁白/)
  assert.match(prompt, /不复述原话/)
  assert.match(prompt, /不编造现实身体、手机、房间/)
  assert.match(prompt, /普通回复最多一个 emoji/)
  assert.doesNotMatch(prompt, /完整的情绪回应/)
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
  assert.equal(capturedTemperature, 0.78)
})

test('聊天流对长度截断自动提高生成预算并重试完整回复', async () => {
  const budgets = []
  const answers = ['【抬手', '【抬手轻轻敲了敲你的气泡】哼，才不许躲。']
  const answer = await streamCompanionReply({
    messages: [{ role: 'user', content: '你是坏人' }],
    maxTokens: 160,
    stream: async ({ maxTokens }) => {
      budgets.push(maxTokens)
      const next = answers.shift()
      if (next === '【抬手') {
        const error = new Error('OUTPUT_TRUNCATED')
        error.code = 'OUTPUT_TRUNCATED'
        error.partialContent = next
        throw error
      }
      return next
    }
  })

  assert.equal(answer, '【抬手轻轻敲了敲你的气泡】哼，才不许躲。')
  assert.deepEqual(budgets, [256, 1024])
})

test('服务端未给 finish_reason 时也会拦截结构残缺的回复', async () => {
  let calls = 0
  const answer = await streamCompanionReply({
    messages: [{ role: 'user', content: '在吗' }],
    stream: async () => {
      calls += 1
      return calls === 1 ? '【抬手' : '在呀，刚刚正想找你。'
    }
  })

  assert.equal(calls, 2)
  assert.equal(answer, '在呀，刚刚正想找你。')
  assert.equal(isCompanionReplyComplete('【抬手'), false)
  assert.equal(isCompanionReplyComplete('在呀，刚刚正想找你。'), true)
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

test('聊天人格要求短气泡并将动作旁白降为极少数点缀', () => {
  const prompt = buildChatSystemPrompt({ companionName: '小乖' })

  assert.match(prompt, /括号动作是极少数点缀/)
  assert.match(prompt, /本轮不要再写括号动作|确实自然时才允许一个很短的动作/)
  assert.match(prompt, /最多约 120 个中文字符、3 个短气泡/)
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

test('本轮上下文限制历史、记忆和生活数据并按话题选择', () => {
  const messages = Array.from({ length: 60 }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `历史消息${index}`,
    createdAt: index + 1
  }))
  const memories = Array.from({ length: 15 }, (_, index) => ({
    id: `memory-${index}`,
    key: `key-${index}`,
    scope: 'user',
    category: index < 3 ? '偏好' : '经历',
    content: index === 8 ? '哥哥最近在记录体重' : `长期记忆${index}`,
    updatedAt: index + 1
  }))
  const context = buildCompanionTurnContext({
    messages,
    userMessages: [{ content: '我今天称体重了' }],
    memories,
    lifeContext: {
      recent30Days: {
        moodDays: [{ date: '2026-07-29' }],
        weightRecords: Array.from({ length: 12 }, (_, index) => ({ weight: 70 + index })),
        savingsPlans: [{ name: '旅行' }]
      },
      schedulesWithin30Days: [{ title: '考试' }]
    }
  })

  assert.equal(context.history.length, 24)
  assert.equal(context.memories.length, 8)
  assert.equal(context.lifeContext.recent30Days.weightRecords.length, 8)
  assert.equal(context.lifeContext.recent30Days.moodDays, undefined)
  assert.equal(context.lifeContext.schedulesWithin30Days, undefined)
})

test('普通回复清理重复动作、称呼和 emoji 并限制为三个气泡', () => {
  const recentMessages = [
    { role: 'assistant', content: '（轻轻抱住你） 哥哥，我在。' },
    { role: 'user', content: '我也想你' },
    { role: 'assistant', content: '宝宝，刚刚也在想你。' },
    { role: 'user', content: '亲亲' }
  ]
  const cleaned = sanitizeCompanionReply(
    '（心跳一下子漏了一拍） 哥哥，我也想你，真的特别特别想。🥺💕❤️\n\n你一出现整个世界都亮了。\n\n我会一直一直陪着你。\n\n还想再抱一会儿。',
    { mode: 'normal', recentMessages }
  )
  const parts = splitCompanionReply(cleaned, { maxParts: 3 })

  assert.doesNotMatch(cleaned, /^（/)
  assert.doesNotMatch(cleaned, /^哥哥/)
  assert.ok((cleaned.match(/\p{Extended_Pictographic}/gu) || []).length <= 1)
  assert.ok(Array.from(cleaned).length <= 120)
  assert.ok(parts.length <= 3)
})

test('已有完整句时移除模型意外中止留下的悬空尾句', () => {
  assert.equal(
    sanitizeCompanionReply('亲亲收好啦！亲亲也飞回', { mode: 'normal' }),
    '亲亲收好啦！'
  )
  assert.equal(
    sanitizeCompanionReply('好呀！我等你回来', { mode: 'normal' }),
    '好呀！我等你回来'
  )
})

test('字符收束只在完整句边界停止，不再制造带省略号的半句话', () => {
  const cleaned = sanitizeCompanionReply(
    `${'这是一句完整但稍长的话'.repeat(6)}。后面这句话不应该被从中间切开，而应该整体省略。`,
    { mode: 'normal' }
  )

  assert.match(cleaned, /。$/)
  assert.doesNotMatch(cleaned, /…$/)
  assert.equal(isCompanionReplyComplete(cleaned), true)
})

test('回复模式区分普通、复杂问题和明确安全风险', () => {
  assert.equal(classifyCompanionReplyMode([{ content: '我也想你' }]), 'normal')
  assert.equal(classifyCompanionReplyMode([{ content: '这件事我想了很久，你觉得我该不该继续？' }]), 'complex')
  assert.equal(classifyCompanionReplyMode([{
    content: '这阵子我一直有点低落，脑子里事情很多，睡得也不太好。我知道自己该慢慢来，但有时候还是会突然觉得很累，不知道怎么跟身边的人解释。'
  }]), 'complex')
  assert.equal(classifyCompanionReplyMode([{ content: '我真的不想活了' }]), 'safety')
  assert.deepEqual(selectTurnLifeContext({
    recent30Days: { moodDays: [{ date: '2026-07-29' }], weightRecords: [{ weight: 70 }] }
  }, [{ content: '亲亲' }]), {})
})
