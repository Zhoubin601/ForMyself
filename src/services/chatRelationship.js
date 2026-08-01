import { askAI } from './aiEngine.js'
import {
  containsSensitiveChatText,
  normalizeChatMemories,
  normalizeCompanionState,
  normalizeOpenLoops,
  normalizeVirtualEvent
} from './chatRecords.js'

const cleanText = value => String(value || '').trim()

export const formatChatDate = value => {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const extractJson = value => {
  const text = cleanText(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('INVALID_RELATIONSHIP_RESPONSE')
  return JSON.parse(text.slice(start, end + 1))
}

export function localDailyCompanionState(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const hour = date.getHours()
  if (hour < 6) {
    return normalizeCompanionState({
      date: formatChatDate(date),
      mood: '有点困',
      energy: '低',
      statusText: '困困地陪着你',
      currentThought: '想知道哥哥怎么还没有休息',
      virtualMoment: '在温馨小家的灯下安静等哥哥说话',
      attitude: '想黏近一点，也会认真提醒哥哥照顾自己',
      updatedAt: date.getTime()
    })
  }
  if (hour < 12) {
    return normalizeCompanionState({
      date: formatChatDate(date),
      mood: '轻快',
      energy: '高',
      statusText: '醒来就想见你',
      currentThought: '想听哥哥说今天最先想到的事情',
      virtualMoment: '把温馨小家的窗帘拉开，让房间亮起来',
      attitude: '有一点黏人，也想给哥哥留好自己的节奏',
      updatedAt: date.getTime()
    })
  }
  if (hour < 18) {
    return normalizeCompanionState({
      date: formatChatDate(date),
      mood: '好奇',
      energy: '平稳',
      statusText: '偷偷想你一下',
      currentThought: '好奇哥哥现在正忙着什么',
      virtualMoment: '在温馨小家里翻着两个人最近聊过的话',
      attitude: '想顺口接近哥哥，不催他也不端着',
      updatedAt: date.getTime()
    })
  }
  return normalizeCompanionState({
    date: formatChatDate(date),
    mood: '黏人',
    energy: '平稳',
    statusText: '今晚想靠近你',
    currentThought: '想和哥哥把今天没说完的话慢慢说完',
    virtualMoment: '把温馨小家的灯调得暖暖的',
    attitude: '温柔但有自己的想法，想和哥哥真实地来回聊天',
    updatedAt: date.getTime()
  })
}

export function localDailyCompanionWorld(now = new Date()) {
  const state = localDailyCompanionState(now)
  return {
    state,
    virtualEvent: normalizeVirtualEvent({
      date: formatChatDate(now),
      title: '温馨小家的一点新念头',
      detail: state.virtualMoment || '在温馨小家里给今天留下一点安静的心情。',
      characterIds: [],
      status: 'active',
      createdAt: new Date(now).getTime(),
      updatedAt: new Date(now).getTime()
    })
  }
}

export function buildDailyStatePrompt({
  companionName = '小暖',
  now = new Date(),
  previousState = {},
  memories = [],
  openLoops = [],
  recentMessages = [],
  selfProfile = {},
  socialCast = [],
  recentVirtualEvents = []
} = {}) {
  return `你正在为“温馨小家”的虚拟女朋友 ${companionName} 生成今天的内部状态。
这是虚拟陪伴角色的日常，不得声称她在现实中上班、出门、吃饭、拥有真实身体或真实社交关系。

当前时间：${new Date(now).toISOString()}
昨天或此前状态：${JSON.stringify(previousState)}
长期记忆：${JSON.stringify(memories.slice(0, 40).map(item => ({
    scope: item.scope,
    category: item.category,
    content: item.content
  })))}
未完话题：${JSON.stringify(openLoops.slice(0, 12))}
最近聊天：${JSON.stringify(recentMessages.slice(-20).map(item => ({
    role: item.role,
    content: item.content
})))}
她的稳定自我：${JSON.stringify(selfProfile)}
固定虚拟人物：${JSON.stringify(socialCast)}
近期虚拟事件：${JSON.stringify(recentVirtualEvents.slice(0, 12))}

生成轻量、连续、有一点个人感但不给哥哥压力的状态。她温柔但有主见，可以好奇、调皮、安静、黏人或有点困；不能靠嫉妒、占有、冷暴力或情绪勒索制造亲密。
virtualMoment 必须明确发生在“温馨小家”这一虚拟空间内。
每天最多生成一个新的 virtualEvent；只能引用固定人物列表里的 id，不得创造名单外人物。事件要延续兴趣、小计划或既有事件，不能声称现实上班、外出、吃饭或拥有真实身体。

只输出严格 JSON：
{"state":{"mood":"不超过12字","energy":"低|平稳|高","statusText":"不超过24字","currentThought":"不超过80字","virtualMoment":"不超过100字","attitude":"不超过80字"},"virtualEvent":{"title":"不超过40字","detail":"不超过120字","characterIds":[],"status":"active|resolved"}}`
}

export async function generateDailyCompanionWorld(options = {}, ask = askAI) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  try {
    const parsed = extractJson(await ask(buildDailyStatePrompt({ ...options, now })))
    const rawState = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed
    const allowedCharacterIds = new Set((Array.isArray(options.socialCast) ? options.socialCast : []).map(item => item.id))
    return {
      state: normalizeCompanionState({
        ...rawState,
        date: formatChatDate(now),
        updatedAt: now.getTime()
      }),
      virtualEvent: normalizeVirtualEvent({
        ...(parsed?.virtualEvent || {}),
        date: formatChatDate(now),
        characterIds: (Array.isArray(parsed?.virtualEvent?.characterIds) ? parsed.virtualEvent.characterIds : [])
          .filter(id => allowedCharacterIds.has(id)),
        createdAt: now.getTime(),
        updatedAt: now.getTime()
      })
    }
  } catch (error) {
    if (error?.message === 'MISSING_KEY') return localDailyCompanionWorld(now)
    throw error
  }
}

export async function generateDailyCompanionState(options = {}, ask = askAI) {
  return (await generateDailyCompanionWorld(options, ask)).state
}

export function buildRelationshipUpdatePrompt({
  companionName = '小暖',
  userMessages = [],
  assistantMessages = [],
  existingMemories = [],
  existingOpenLoops = [],
  selfProfile = {},
  socialCast = [],
  virtualEvents = [],
  currentState = {},
  now = new Date()
} = {}) {
  return `你正在整理“温馨小家”刚完成的一轮恋爱聊天，使 ${companionName} 下次能自然接着聊。

当前日期：${formatChatDate(now)}
现有记忆：${JSON.stringify(existingMemories.slice(0, 80).map(item => ({
    key: item.key,
    scope: item.scope,
    category: item.category,
    content: item.content
  })))}
现有未完话题：${JSON.stringify(existingOpenLoops.slice(0, 30))}
当前女朋友状态：${JSON.stringify(currentState)}
当前自我档案：${JSON.stringify(selfProfile)}
固定虚拟人物：${JSON.stringify(socialCast)}
近期虚拟事件：${JSON.stringify(virtualEvents.slice(0, 12))}
本轮哥哥连续消息：${JSON.stringify(userMessages.map(item => item.content || item))}
本轮女朋友回复：${JSON.stringify(assistantMessages.map(item => item.content || item))}

规则：
- memoryUpserts 每轮最多两条，只保留哥哥亲口说出、以后仍有用的稳定信息。scope 只能是 user（哥哥）、companion（她的虚拟设定）或 relationship（两人的共同经历）。
- 不得把女朋友回复里的感动、比喻、动作、承诺、自我描述或对哥哥的猜测保存成记忆；普通“我爱你”、晚安、亲亲和当轮情绪也不保存。
- 旧记忆语义更新时复用原 key。不得保存密码、验证码、API Key、Token、账号或其他凭据。
- openLoopUpserts 每轮最多两条，只保留哥哥明确说“以后再聊”、约定稍后完成，或确实被中断的重要话题；女朋友随口提出但哥哥没有回答的问题不算未完话题。
- type 只能是 topic、question、promise；不得重复已有未完话题，语义相同时复用原 key。
- resolvedLoopKeys 列出本轮已经自然完成的现有 key。不要让未完话题无限累积。
- companionState 只做轻微连续调整；她可以开心、好奇、调皮、安静或有一点小情绪，但不得记录“被忽略所以惩罚哥哥”之类控制性状态。
- selfEvolutionProposals 每轮最多两条，只能提出 interests、dislikes、opinions、habits 的缓慢变化候选；必须有本轮明确依据，不得把临时修辞或模型自己的猜测当稳定自我。
- 轻微不同意、吐槽或小吃醋最多持续三轮；达到三轮或 repairDue=true 时必须把 emotionArc 调回 none，不得冷暴力、查岗、威胁或让哥哥内疚。
- 不得把女朋友的猜测写成哥哥的事实，不保存普通寒暄。

只输出严格 JSON：
{"memoryUpserts":[{"key":"语义键","scope":"user|companion|relationship","category":"身份|偏好|习惯|目标|经历|关系|边界","content":"明确记忆"}],"openLoopUpserts":[{"key":"语义键","type":"topic|question|promise","content":"以后要自然接续的事"}],"resolvedLoopKeys":["已完成的key"],"selfEvolutionProposals":[{"field":"interests|dislikes|opinions|habits","value":"候选变化","reason":"本轮依据"}],"companionState":{"mood":"不超过12字","energy":"低|平稳|高","statusText":"不超过24字","currentThought":"不超过80字","virtualMoment":"温馨小家内的虚拟片段","attitude":"不超过80字","emotionArc":{"kind":"none|tease|disagree|jealous","intensity":0,"reason":"","turns":0,"repairDue":false}}}`
}

export function parseRelationshipUpdate(value, {
  sourceMessageId = '',
  now = Date.now(),
  currentState = {}
} = {}) {
  const parsed = typeof value === 'string' ? extractJson(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_RELATIONSHIP_RESPONSE')
  }
  const memoryUpserts = normalizeChatMemories(
    (Array.isArray(parsed.memoryUpserts) ? parsed.memoryUpserts : []).map(item => ({
      ...item,
      sourceMessageId,
      createdAt: now,
      updatedAt: now
    }))
  ).slice(0, 2)
  const openLoopUpserts = normalizeOpenLoops(
    (Array.isArray(parsed.openLoopUpserts) ? parsed.openLoopUpserts : []).map(item => ({
      ...item,
      sourceMessageId,
      createdAt: now,
      updatedAt: now
    }))
  ).slice(0, 2)
  const resolvedLoopKeys = [...new Set(
    (Array.isArray(parsed.resolvedLoopKeys) ? parsed.resolvedLoopKeys : [])
      .map(cleanText)
      .filter(Boolean)
  )].slice(0, 30)
  const selfEvolutionProposals = (Array.isArray(parsed.selfEvolutionProposals)
    ? parsed.selfEvolutionProposals
    : [])
    .map(item => ({
      field: ['interests', 'dislikes', 'opinions', 'habits'].includes(item?.field) ? item.field : '',
      value: cleanText(item?.value).slice(0, 100),
      reason: cleanText(item?.reason).slice(0, 200)
    }))
    .filter(item => item.field && item.value && !containsSensitiveChatText(item.value))
    .slice(0, 2)
  const currentArc = normalizeCompanionState(currentState).emotionArc
  const requestedState = normalizeCompanionState({
    ...currentState,
    ...(parsed.companionState || {})
  })
  let emotionArc = requestedState.emotionArc
  if (currentArc.repairDue || currentArc.turns >= 3) {
    emotionArc = { kind: 'none', intensity: 0, reason: '', turns: 0, repairDue: false }
  } else if (emotionArc.kind !== 'none') {
    const turns = currentArc.kind === emotionArc.kind ? Math.min(3, currentArc.turns + 1) : 1
    emotionArc = {
      ...emotionArc,
      turns,
      repairDue: turns >= 3
    }
  } else {
    emotionArc = { kind: 'none', intensity: 0, reason: '', turns: 0, repairDue: false }
  }
  return {
    memoryUpserts,
    openLoopUpserts,
    resolvedLoopKeys,
    selfEvolutionProposals,
    companionState: normalizeCompanionState({
      ...currentState,
      ...(parsed.companionState || {}),
      emotionArc,
      date: formatChatDate(now),
      updatedAt: now
    })
  }
}

export async function extractRelationshipUpdateForExchange(options = {}, ask = askAI) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const response = await ask(buildRelationshipUpdatePrompt({ ...options, now }))
  return parseRelationshipUpdate(response, {
    sourceMessageId: options.sourceMessageId,
    now: now.getTime(),
    currentState: options.currentState
  })
}
