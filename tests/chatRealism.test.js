import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySelfEvolutionProposals,
  buildChatBehaviorPlanPrompt,
  normalizeChatBehaviorPlan,
  parsePlannedReplyOutput,
  planChatBehavior,
  generateCompanionWorldDraft
} from '../src/features/chat/chatRealism.js'
import {
  generateDailyCompanionWorld,
  parseRelationshipUpdate
} from '../src/features/chat/chatRelationship.js'

test('行为计划只保留合法引用并在规划失败时使用本地安全计划', async () => {
  const normalized = normalizeChatBehaviorPlan({
    focus: '先回应考试焦虑',
    stance: 'disagree',
    memoryIds: ['memory-ok', 'memory-made-up'],
    eventIds: ['event-ok', 'event-made-up'],
    characterIds: ['cast-ok', 'cast-made-up'],
    bubbleCount: 99,
    followup: { enabled: true, delaySeconds: 999, brief: '再补一句' }
  }, {
    memories: [{ id: 'memory-ok' }],
    virtualEvents: [{ id: 'event-ok' }],
    socialCast: [{ id: 'cast-ok' }]
  })

  assert.deepEqual(normalized.memoryIds, ['memory-ok'])
  assert.deepEqual(normalized.eventIds, ['event-ok'])
  assert.deepEqual(normalized.characterIds, ['cast-ok'])
  assert.equal(normalized.bubbleCount, 3)
  assert.equal(normalized.followup.delaySeconds, 90)

  const fallback = await planChatBehavior({ replyMode: 'normal' }, async () => '不是 JSON')
  assert.equal(fallback.stance, 'neutral')
  assert.equal(fallback.bubbleCount, 1)
  assert.equal(fallback.followup.enabled, false)

  const prompt = buildChatBehaviorPlanPrompt({
    pendingUserMessages: [{ content: '我的密码是 123456' }],
    recentMessages: [{ id: 'm1', role: 'user', content: 'API Key 是 sk-secret' }]
  })
  assert.doesNotMatch(prompt, /123456|sk-secret/)
  assert.match(prompt, /已过滤的敏感内容/)
})

test('第三轮轻微矛盾强制进入修复，修复完成后清空情绪链', () => {
  const plan = normalizeChatBehaviorPlan({ stance: 'jealous', tone: 'playful' }, {
    emotionArc: { kind: 'jealous', turns: 3, repairDue: true }
  })
  assert.equal(plan.stance, 'repair')
  assert.equal(plan.tone, 'warm')

  const update = parseRelationshipUpdate({
    companionState: {
      mood: '还有点别扭',
      emotionArc: { kind: 'jealous', intensity: 2, reason: '刚才的玩笑', turns: 3, repairDue: true }
    }
  }, {
    currentState: { emotionArc: { kind: 'jealous', intensity: 1, reason: '刚才的玩笑', turns: 3, repairDue: true } },
    now: Date.parse('2026-08-01T12:00:00Z')
  })
  assert.equal(update.companionState.emotionArc.kind, 'none')
  assert.equal(update.companionState.emotionArc.turns, 0)
})

test('自我变化必须累计三个完成轮次并跨两个日期才生效', () => {
  let state = { profile: {}, candidates: [], log: [] }
  for (const [sourceMessageId, date] of [['m1', '2026-08-01'], ['m2', '2026-08-01']]) {
    state = applySelfEvolutionProposals({
      ...state,
      proposals: [{ field: 'interests', value: '收集蓝色贴纸', reason: '连续聊到手账' }],
      sourceMessageId,
      date,
      now: Date.parse(`${date}T12:00:00Z`)
    })
  }
  assert.deepEqual(state.profile.interests, [])
  assert.equal(state.log.length, 0)

  state = applySelfEvolutionProposals({
    ...state,
    proposals: [{ field: 'interests', value: '收集蓝色贴纸', reason: '连续聊到手账' }],
    sourceMessageId: 'm3',
    date: '2026-08-02',
    now: Date.parse('2026-08-02T12:00:00Z')
  })
  assert.deepEqual(state.profile.interests, ['收集蓝色贴纸'])
  assert.equal(state.log.length, 1)
  assert.deepEqual(state.log[0].sourceMessageIds, ['m1', 'm2', 'm3'])
})

test('主回复与延迟补话严格分离，名单外人物引用会被每日事件过滤', async () => {
  assert.deepEqual(parsePlannedReplyOutput('先抱抱你。\n<DELAYED_FOLLOWUP>对了，明天也要告诉我结果。'), {
    main: '先抱抱你。',
    followup: '对了，明天也要告诉我结果。'
  })

  const world = await generateDailyCompanionWorld({
    now: new Date('2026-08-01T08:00:00Z'),
    socialCast: [{ id: 'cast-ok', name: '阿梨' }]
  }, async () => JSON.stringify({
    state: { mood: '开心', virtualMoment: '在温馨小家贴手账' },
    virtualEvent: { title: '贴手账', detail: '和阿梨在虚拟小家整理贴纸', characterIds: ['cast-ok', 'cast-fake'] }
  }))
  assert.deepEqual(world.virtualEvent.characterIds, ['cast-ok'])
})

test('历史初始化按每25条分块且过滤明显敏感消息，确认前只返回草案', async () => {
  const messages = Array.from({ length: 51 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `第${index + 1}条聊天`
  }))
  messages.push({ role: 'assistant', content: '我的密码是 123456' })
  const prompts = []
  const draft = await generateCompanionWorldDraft({
    messages,
    memories: [{ content: 'API Key 是 sk-secret' }, { content: '两人喜欢一起做手账' }],
    ask: async prompt => {
      prompts.push(prompt)
      if (prompt.includes('历史观察')) return JSON.stringify({
        selfProfile: { summary: '喜欢手账，也会直说自己的意见', interests: ['手账'] },
        socialCast: [{ name: '阿梨', relationship: '虚拟手账朋友', traits: ['爽快'] }],
        virtualEvents: [{ date: '2026-08-01', title: '整理贴纸', detail: '在温馨小家整理贴纸', characterIds: ['阿梨'] }]
      })
      return JSON.stringify({ observations: ['她稳定地喜欢手账'] })
    }
  })

  assert.equal(prompts.length, 4)
  assert.equal(prompts.some(prompt => prompt.includes('123456')), false)
  assert.equal(prompts.at(-1).includes('sk-secret'), false)
  assert.equal(draft.socialCast.length, 1)
  assert.deepEqual(draft.virtualEvents[0].characterIds, [draft.socialCast[0].id])
})

test('历史初始化会跳过连续畸形分块，不再让单个分块拖垮整份草案', async () => {
  const messages = Array.from({ length: 26 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `历史消息${index + 1}`
  }))
  let firstChunkAttempts = 0
  const draft = await generateCompanionWorldDraft({
    messages,
    retryDelay: 0,
    ask: async prompt => {
      if (prompt.includes('历史观察')) return JSON.stringify({
        selfProfile: { summary: '她喜欢收集贴纸', interests: ['贴纸'] },
        socialCast: [{ name: '阿梨', relationship: '固定虚拟朋友' }],
        virtualEvents: [{ date: '2026-08-01', title: '整理贴纸', detail: '在温馨小家整理贴纸' }]
      })
      if (prompt.includes('待修复输出')) return '仍然不是 JSON'
      if (prompt.includes('历史消息1')) {
        firstChunkAttempts += 1
        return '不是 JSON'
      }
      return JSON.stringify({ findings: ['她经常整理贴纸'] })
    }
  })

  assert.equal(firstChunkAttempts, 1)
  assert.equal(draft.generationMeta.completedChunks, 1)
  assert.equal(draft.generationMeta.failedChunks, 1)
  assert.equal(draft.generationMeta.usedLocalFallback, false)
  assert.equal(draft.selfProfile.summary, '她喜欢收集贴纸')
})

test('最终合并连续返回畸形内容时使用成功观察生成可编辑草案', async () => {
  const draft = await generateCompanionWorldDraft({
    messages: [{ role: 'assistant', content: '她经常整理蓝色贴纸，也喜欢手账。' }],
    retryDelay: 0,
    ask: async prompt => {
      if (prompt.includes('从下面的既有恋爱聊天')) {
        return JSON.stringify({ observations: ['她经常整理蓝色贴纸', '她喜欢手账'] })
      }
      return '格式损坏'
    }
  })

  assert.equal(draft.generationMeta.usedLocalFallback, true)
  assert.match(draft.selfProfile.summary, /蓝色贴纸/)
  assert.equal(draft.socialCast.length, 1)
  assert.equal(draft.virtualEvents.length, 1)
})

test('完全缺少 AI Key 时明确报错，不伪装成历史草案', async () => {
  await assert.rejects(generateCompanionWorldDraft({
    messages: [{ role: 'user', content: '测试历史' }],
    retryDelay: 0,
    ask: async () => { throw new Error('MISSING_KEY') }
  }), error => error?.code === 'MISSING_KEY')
})
