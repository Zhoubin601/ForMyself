import { askAI } from './aiEngine.js'
import {
  containsSensitiveChatText,
  normalizeCompanionSelfProfile,
  normalizeEvolutionCandidates,
  normalizeEvolutionLog,
  normalizeSocialCast,
  normalizeVirtualEvents
} from './chatRecords.js'

export const DELAYED_FOLLOWUP_TAG = '<DELAYED_FOLLOWUP>'
const PLAN_STANCES = new Set(['agree', 'support', 'tease', 'disagree', 'jealous', 'repair', 'neutral'])
const PLAN_TONES = new Set(['warm', 'playful', 'quiet', 'direct', 'serious'])
const SELF_FIELDS = new Set(['interests', 'dislikes', 'opinions', 'habits'])
const cleanText = value => String(value || '').trim()
const limited = (value, maximum) => Array.from(cleanText(value)).slice(0, maximum).join('')
const uniqueStrings = (values, maximum = 12) => [...new Set(
  (Array.isArray(values) ? values : []).map(cleanText).filter(Boolean)
)].slice(0, maximum)

const extractJson = value => {
  const text = cleanText(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('INVALID_BEHAVIOR_PLAN')
  return JSON.parse(text.slice(start, end + 1))
}

const timeout = (promise, milliseconds, code) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error(code)
    error.code = code
    reject(error)
  }, milliseconds)
  Promise.resolve(promise).then(
    value => { clearTimeout(timer); resolve(value) },
    error => { clearTimeout(timer); reject(error) }
  )
})

export function defaultChatBehaviorPlan(replyMode = 'normal', emotionArc = {}) {
  const repairDue = emotionArc?.repairDue === true || Number(emotionArc?.turns) >= 3
  return {
    focus: '回应哥哥刚刚最明确的那一点',
    stance: repairDue ? 'repair' : replyMode === 'safety' ? 'support' : 'neutral',
    tone: replyMode === 'safety' ? 'serious' : repairDue ? 'warm' : 'warm',
    askQuestion: replyMode === 'safety',
    memoryIds: [],
    eventIds: [],
    characterIds: [],
    bubbleCount: replyMode === 'normal' ? 1 : 2,
    useEmoji: false,
    useAddress: false,
    followup: { enabled: false, delaySeconds: 30, brief: '' }
  }
}

export function normalizeChatBehaviorPlan(value = {}, {
  replyMode = 'normal',
  memories = [],
  virtualEvents = [],
  socialCast = [],
  emotionArc = {}
} = {}) {
  const fallback = defaultChatBehaviorPlan(replyMode, emotionArc)
  const plan = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const allowedMemoryIds = new Set(memories.map(item => item.id))
  const allowedEventIds = new Set(virtualEvents.map(item => item.id))
  const allowedCharacterIds = new Set(socialCast.map(item => item.id))
  const repairDue = emotionArc?.repairDue === true || Number(emotionArc?.turns) >= 3
  const stance = repairDue
    ? 'repair'
    : PLAN_STANCES.has(plan.stance) ? plan.stance : fallback.stance
  return {
    focus: limited(plan.focus, 100) || fallback.focus,
    stance,
    tone: repairDue ? 'warm' : PLAN_TONES.has(plan.tone) ? plan.tone : fallback.tone,
    askQuestion: repairDue ? false : plan.askQuestion === true,
    memoryIds: uniqueStrings(plan.memoryIds).filter(id => allowedMemoryIds.has(id)),
    eventIds: uniqueStrings(plan.eventIds).filter(id => allowedEventIds.has(id)),
    characterIds: uniqueStrings(plan.characterIds).filter(id => allowedCharacterIds.has(id)),
    bubbleCount: Math.max(1, Math.min(replyMode === 'normal' ? 3 : 5, Math.round(Number(plan.bubbleCount) || fallback.bubbleCount))),
    useEmoji: replyMode !== 'safety' && plan.useEmoji === true,
    useAddress: plan.useAddress === true,
    followup: {
      enabled: replyMode !== 'safety' && !repairDue && plan.followup?.enabled === true,
      delaySeconds: Math.max(10, Math.min(90, Math.round(Number(plan.followup?.delaySeconds) || 30))),
      brief: limited(plan.followup?.brief, 120)
    }
  }
}

export function buildChatBehaviorPlanPrompt({
  companionName = '小暖',
  replyMode = 'normal',
  pendingUserMessages = [],
  recentMessages = [],
  memories = [],
  selfProfile = {},
  socialCast = [],
  virtualEvents = [],
  companionState = {},
  deferredFollowupBrief = ''
} = {}) {
  const safeMessageContent = value => containsSensitiveChatText(value)
    ? '[已过滤的敏感内容]'
    : limited(value, 1200)
  return `你是“温馨小家”虚拟女朋友 ${companionName} 的聊天行为规划器，只决定可观察的聊天行为，不写隐藏心理过程。

哥哥刚发来的消息：${JSON.stringify(pendingUserMessages.map(item => safeMessageContent(item?.content || item)))}
最近聊天：${JSON.stringify(recentMessages.slice(-24).map(item => ({ id: item.id, role: item.role, content: safeMessageContent(item.content) })))}
本轮模式：${replyMode}
她的稳定自我：${JSON.stringify(selfProfile)}
固定虚拟人物：${JSON.stringify(socialCast)}
近期虚拟事件：${JSON.stringify(virtualEvents.slice(0, 12))}
当前状态：${JSON.stringify(companionState)}
可用记忆：${JSON.stringify(memories.map(item => ({ id: item.id, content: item.content })))}
被新消息打断的旧补话意图：${deferredFollowupBrief || '无'}

要求：
- 只选哥哥这轮最值得回应的一点，不补齐客服式共情链。
- 可以亲昵、吐槽、轻微不同意或小吃醋；最多持续三轮，repairDue 时必须自然缓和。
- 只能引用上面真实存在的 id，不得创造名单外人物或现实经历。
- 普通聊天优先 1–2 个气泡，不必每轮提问、称呼、emoji 或补话。
- 延迟补话只用于第二个念头、纠正、突然想起旧事或情绪回转；只写 brief，不写完整正文。
- 不输出分析、解释或心理独白。

严格输出 JSON：
{"focus":"本轮重点","stance":"agree|support|tease|disagree|jealous|repair|neutral","tone":"warm|playful|quiet|direct|serious","askQuestion":false,"memoryIds":[],"eventIds":[],"characterIds":[],"bubbleCount":1,"useEmoji":false,"useAddress":false,"followup":{"enabled":false,"delaySeconds":30,"brief":""}}`
}

export async function planChatBehavior(options = {}, ask = askAI) {
  const fallback = defaultChatBehaviorPlan(options.replyMode, options.companionState?.emotionArc)
  try {
    const response = await timeout(ask(buildChatBehaviorPlanPrompt(options)), 5000, 'CHAT_BEHAVIOR_PLAN_TIMEOUT')
    return normalizeChatBehaviorPlan(extractJson(response), {
      replyMode: options.replyMode,
      memories: options.memories,
      virtualEvents: options.virtualEvents,
      socialCast: options.socialCast,
      emotionArc: options.companionState?.emotionArc
    })
  } catch (error) {
    console.warn('聊天行为规划失败，已使用本地安全计划', error)
    return fallback
  }
}

export function behaviorPlanPromptFragment(plan = {}) {
  return `【本轮已确认的聊天行为】
${JSON.stringify(plan)}
- focus 是唯一优先回应点；不要把其他背景逐项说出来。
- stance=repair 时自然缓和，不解释自己在修复关系。
- bubbleCount 是本轮气泡上限，不要为了凑数补话。
- useAddress=false 时不要用“哥哥/宝宝”开头；useEmoji=false 时不要使用 emoji。
- askQuestion=false 时说完就停。
${plan.followup?.enabled && plan.followup?.brief
    ? `- 主回复后另起一行输出 ${DELAYED_FOLLOWUP_TAG}，标签后写一条围绕“${plan.followup.brief}”的完整短补话；主回复不要提前说完这层意思。`
    : `- 不得输出 ${DELAYED_FOLLOWUP_TAG}。`}`
}

export function parsePlannedReplyOutput(value) {
  const text = cleanText(value)
  const index = text.indexOf(DELAYED_FOLLOWUP_TAG)
  if (index < 0) return { main: text, followup: '' }
  return {
    main: cleanText(text.slice(0, index)),
    followup: limited(text.slice(index + DELAYED_FOLLOWUP_TAG.length), 220)
  }
}

const stableHash = value => [...String(value || '')].reduce((result, character) => (
  (result * 33 + character.charCodeAt(0)) >>> 0
), 5381)

export function shouldKeepDelayedFollowup({ sourceMessageId = '', plan = {}, settings = {} } = {}) {
  if (settings.followupEnabled === false || !plan.followup?.enabled || !plan.followup?.brief) return false
  return stableHash(sourceMessageId) % 100 < 15
}

export function naturalPacingTarget(sourceMessageId = '') {
  return 1000 + (stableHash(sourceMessageId) % 4001)
}

export function bubblePacingDelay(content = '') {
  return Math.max(600, Math.min(2500, 520 + Array.from(String(content || '')).length * 24))
}

export function applySelfEvolutionProposals({
  profile = {},
  candidates = [],
  log = [],
  proposals = [],
  sourceMessageId = '',
  date = new Date().toISOString().slice(0, 10),
  now = Date.now()
} = {}) {
  let nextProfile = normalizeCompanionSelfProfile(profile)
  let nextCandidates = normalizeEvolutionCandidates(candidates)
  let nextLog = normalizeEvolutionLog(log)
  for (const raw of Array.isArray(proposals) ? proposals.slice(0, 2) : []) {
    const field = SELF_FIELDS.has(raw?.field) ? raw.field : ''
    const value = limited(raw?.value, 100)
    if (!field || !value || containsSensitiveChatText(value) || nextProfile[field].includes(value)) continue
    const key = `${field}:${value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')}`
    const existing = nextCandidates.find(item => `${item.field}:${item.value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')}` === key)
    const candidate = {
      ...(existing || {}),
      field,
      value,
      reason: limited(raw.reason, 200),
      evidenceDates: uniqueStrings([...(existing?.evidenceDates || []), date], 10),
      sourceMessageIds: uniqueStrings([...(existing?.sourceMessageIds || []), sourceMessageId], 12),
      updatedAt: now
    }
    nextCandidates = normalizeEvolutionCandidates([
      ...nextCandidates.filter(item => item.id !== existing?.id),
      candidate
    ])
    const storedCandidate = nextCandidates.find(item => (
      `${item.field}:${item.value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')}` === key
    )) || candidate
    if (storedCandidate.sourceMessageIds.length >= 3 && storedCandidate.evidenceDates.length >= 2) {
      nextProfile = normalizeCompanionSelfProfile({
        ...nextProfile,
        [field]: [...nextProfile[field], value],
        updatedAt: now
      })
      nextLog = normalizeEvolutionLog([{
        field,
        previousValue: '',
        nextValue: value,
        reason: storedCandidate.reason,
        sourceMessageIds: storedCandidate.sourceMessageIds,
        createdAt: now
      }, ...nextLog])
      nextCandidates = nextCandidates.filter(item => item.id !== storedCandidate.id)
    }
  }
  return { profile: nextProfile, candidates: nextCandidates, log: nextLog }
}

const collapseHistory = messages => (Array.isArray(messages) ? messages : [])
  .filter(item => ['user', 'assistant'].includes(item?.role) && item?.type !== 'poke')
  .filter(item => !containsSensitiveChatText(item.content))
  .reduce((result, item) => {
    const previous = result.at(-1)
    if (previous?.role === item.role) previous.content += `\n${limited(item.content, 1200)}`
    else result.push({ role: item.role, content: limited(item.content, 1200) })
    return result
  }, [])

const parseWorldDraft = value => {
  const parsed = typeof value === 'string' ? extractJson(value) : value
  const source = parsed?.worldDraft || parsed?.draft || parsed?.data || parsed
  const socialCast = normalizeSocialCast(source?.socialCast)
  const characterIdsByName = new Map(socialCast.map(item => [item.name, item.id]))
  return {
    selfProfile: normalizeCompanionSelfProfile(source?.selfProfile),
    socialCast,
    virtualEvents: normalizeVirtualEvents((Array.isArray(source?.virtualEvents) ? source.virtualEvents : []).map(item => ({
      ...item,
      characterIds: (Array.isArray(item?.characterIds) ? item.characterIds : [])
        .map(value => characterIdsByName.get(value) || value)
        .filter(value => socialCast.some(character => character.id === value))
    })))
  }
}

const observationValuesOf = value => uniqueStrings([
  ...(Array.isArray(value?.observations) ? value.observations : []),
  ...(Array.isArray(value?.findings) ? value.findings : []),
  ...(Array.isArray(value?.items) ? value.items : [])
], 20)

const waitForRetry = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const requestWorldJson = async ({ ask, prompt, retryDelay = 350, schemaHint = '' }) => {
  let response = ''
  let lastError = null
  try {
    response = await ask(prompt)
    return extractJson(response)
  } catch (error) {
    lastError = error
  }
  if (retryDelay > 0) await waitForRetry(retryDelay)
  try {
    if (!response) return extractJson(await ask(prompt))
    const repairPrompt = `把下面的模型输出修复为严格 JSON。不得补充解释、Markdown 或代码围栏，不得加入原文没有的现实经历。${schemaHint ? `\n目标结构：${schemaHint}` : ''}\n待修复输出：${limited(response, 6000)}`
    return extractJson(await ask(repairPrompt))
  } catch (error) {
    if (!response && error?.code) throw error
    if (!response && ['MISSING_KEY', 'NETWORK_ERROR'].includes(error?.message)) throw error
    const failure = new Error('WORLD_DRAFT_JSON_INVALID')
    failure.code = 'WORLD_DRAFT_JSON_INVALID'
    failure.cause = error || lastError
    throw failure
  }
}

const usableWorldDraft = draft => Boolean(
  draft?.selfProfile?.summary ||
  draft?.selfProfile?.interests?.length ||
  draft?.selfProfile?.dislikes?.length ||
  draft?.selfProfile?.opinions?.length ||
  draft?.selfProfile?.habits?.length
) && draft.socialCast.length >= 1 && draft.virtualEvents.length >= 1

const observationsMatching = (observations, pattern, maximum = 4) => observations
  .filter(item => pattern.test(item))
  .slice(0, maximum)
  .map(item => limited(item.replace(/^她(?:稳定地|反复|经常|总是|会)?/, ''), 80))

const localWorldDraftFromObservations = ({ companionName, observations }) => {
  const safeObservations = uniqueStrings(observations, 16)
    .filter(item => !containsSensitiveChatText(item))
  const summaryDetails = safeObservations.slice(0, 3).join('；')
  return {
    selfProfile: normalizeCompanionSelfProfile({
      summary: summaryDetails
        ? `${companionName}在既有聊天里稳定表现为：${summaryDetails}`
        : `${companionName}会在温馨小家里保持熟悉、黏人又有自己看法的相处方式。`,
      interests: observationsMatching(safeObservations, /喜欢|爱好|兴趣|手账|贴纸|收藏/),
      dislikes: observationsMatching(safeObservations, /不喜欢|讨厌|反感|厌恶/),
      opinions: observationsMatching(safeObservations, /认为|觉得|坚持|看法|意见|主张/),
      habits: observationsMatching(safeObservations, /习惯|总会|常常|经常|反复/)
    }),
    socialCast: normalizeSocialCast([{
      name: '阿梨',
      relationship: '温馨小家里的固定虚拟朋友',
      traits: ['爽快', '愿意听她说话'],
      notes: '合并草案降级生成的初始人物，启用前可修改或删除。'
    }]),
    virtualEvents: normalizeVirtualEvents([{
      date: new Date().toISOString().slice(0, 10),
      title: '整理新的生活手账',
      detail: '在温馨小家里把最近聊天留下的小线索整理成一页虚拟生活手账。',
      characterIds: [],
      status: 'active'
    }])
  }
}

export async function generateCompanionWorldDraft({
  companionName = '小暖',
  messages = [],
  memories = [],
  ask = askAI,
  retryDelay = 350
} = {}) {
  const history = collapseHistory(messages).slice(-200)
  const chunks = []
  for (let index = 0; index < history.length; index += 25) chunks.push(history.slice(index, index + 25))
  const observations = []
  let completedChunks = 0
  let failedChunks = 0
  let lastChunkError = null
  for (const chunk of chunks) {
    const prompt = `从下面的既有恋爱聊天中提取虚拟女朋友 ${companionName} 已经稳定表现出的兴趣、厌恶、观点、习惯，以及反复出现的固定虚拟人物线索。不要保存哥哥的密码、账号或敏感凭据，不要把修辞动作当作事实。只输出简洁 JSON：{"observations":["..."]}\n聊天：${JSON.stringify(chunk)}`
    try {
      const parsed = await requestWorldJson({
        ask,
        prompt,
        retryDelay,
        schemaHint: '{"observations":["..."]}'
      })
      observations.push(...observationValuesOf(parsed))
      completedChunks += 1
    } catch (error) {
      failedChunks += 1
      lastChunkError = error
    }
  }
  const finalPrompt = `为“温馨小家”虚拟女朋友 ${companionName} 生成一份可供用户确认的自我世界草案。她是熟悉、黏人、有主见的虚拟女朋友，不冒充现实真人。
已有长期记忆：${JSON.stringify((Array.isArray(memories) ? memories : []).filter(item => !containsSensitiveChatText(item.content)).slice(0, 60))}
历史观察：${JSON.stringify(observations.slice(0, 120))}
要求：固定人物 1–3 个，只能是明确的虚拟人物；初始虚拟事件 1–3 个且明确发生在温馨小家。所有列表最多 8 项。
严格输出 JSON：{"selfProfile":{"summary":"","interests":[],"dislikes":[],"opinions":[],"habits":[]},"socialCast":[{"name":"","relationship":"","traits":[],"notes":""}],"virtualEvents":[{"date":"YYYY-MM-DD","title":"","detail":"","characterIds":[],"status":"active"}]}`
  try {
    const parsed = await requestWorldJson({
      ask,
      prompt: finalPrompt,
      retryDelay,
      schemaHint: '{"selfProfile":{"summary":"","interests":[],"dislikes":[],"opinions":[],"habits":[]},"socialCast":[{"name":"","relationship":"","traits":[],"notes":""}],"virtualEvents":[{"date":"YYYY-MM-DD","title":"","detail":"","characterIds":[],"status":"active"}]}'
    })
    const draft = parseWorldDraft(parsed)
    if (!usableWorldDraft(draft)) throw new Error('WORLD_DRAFT_EMPTY')
    return {
      ...draft,
      generationMeta: { completedChunks, failedChunks, usedLocalFallback: false }
    }
  } catch (error) {
    if (!completedChunks && !observations.length) {
      const missingKey = error?.code === 'MISSING_KEY' || error?.message === 'MISSING_KEY'
      const failure = new Error(missingKey ? 'MISSING_KEY' : 'WORLD_DRAFT_AI_UNAVAILABLE')
      failure.code = missingKey ? 'MISSING_KEY' : 'WORLD_DRAFT_AI_UNAVAILABLE'
      failure.cause = error || lastChunkError
      throw failure
    }
    return {
      ...localWorldDraftFromObservations({ companionName, observations }),
      generationMeta: { completedChunks, failedChunks, usedLocalFallback: true }
    }
  }
}
