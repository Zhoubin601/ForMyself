export const CHAT_BACKUP_TYPE = 'formyself-chat-backup'
export const CHAT_BACKUP_VERSION = 4
export const CHAT_DATA_VERSION = 4
export const DEFAULT_COMPANION_NAME = '小暖'
export const MAX_COMPANION_AVATAR_LENGTH = 1_500_000
export const CHAT_MEMORY_SCOPES = Object.freeze(['user', 'companion', 'relationship'])
export const CHAT_OPEN_LOOP_TYPES = Object.freeze(['topic', 'question', 'promise'])
export const CHAT_PROACTIVE_ORIGINS = Object.freeze(['chat', 'entry', 'proactive', 'followup'])
export const CHAT_MESSAGE_TYPES = Object.freeze(['text', 'poke'])
export const CHAT_REACTION_ACTORS = Object.freeze(['user', 'assistant'])
export const CHAT_REACTION_EMOJIS = Object.freeze(['❤️', '😂', '🥺', '😤', '👍', '👀'])

export const DEFAULT_COMPANION_STATE = Object.freeze({
  date: '',
  mood: '温柔',
  energy: '平稳',
  statusText: '陪着你',
  currentThought: '',
  virtualMoment: '',
  attitude: '想和哥哥自然地说说话',
  emotionArc: Object.freeze({
    kind: 'none',
    intensity: 0,
    reason: '',
    turns: 0,
    repairDue: false
  }),
  updatedAt: 0
})

export const DEFAULT_COMPANION_SELF_PROFILE = Object.freeze({
  summary: '',
  interests: Object.freeze([]),
  dislikes: Object.freeze([]),
  opinions: Object.freeze([]),
  habits: Object.freeze([]),
  updatedAt: 0
})

export const DEFAULT_CHAT_REALISM_SETTINGS = Object.freeze({
  followupEnabled: true,
  followupFrequency: 'occasional',
  pacing: 'balanced'
})

export const DEFAULT_CHAT_PROACTIVE_SETTINGS = Object.freeze({
  enabled: true,
  dailyMin: 0,
  dailyMax: 3,
  activeStart: '09:00',
  activeEnd: '23:00'
})

export const CHAT_MEMORY_CATEGORIES = Object.freeze([
  '身份',
  '偏好',
  '习惯',
  '目标',
  '经历',
  '关系',
  '边界'
])

const VALID_ROLES = new Set(['user', 'assistant'])
const VALID_STATUSES = new Set(['complete', 'stopped'])
const VALID_MESSAGE_ORIGINS = new Set(CHAT_PROACTIVE_ORIGINS)
const VALID_MESSAGE_TYPES = new Set(CHAT_MESSAGE_TYPES)
const VALID_REACTION_ACTORS = new Set(CHAT_REACTION_ACTORS)
const VALID_REACTION_EMOJIS = new Set(CHAT_REACTION_EMOJIS)
const VALID_MEMORY_SCOPES = new Set(CHAT_MEMORY_SCOPES)
const VALID_OPEN_LOOP_TYPES = new Set(CHAT_OPEN_LOOP_TYPES)
const VALID_EMOTION_ARCS = new Set(['none', 'tease', 'disagree', 'jealous'])
const VALID_SELF_FIELDS = new Set(['interests', 'dislikes', 'opinions', 'habits'])
const SENSITIVE_MEMORY_PATTERN = /(?:密码|口令|验证码|api[\s_-]*key|access[\s_-]*token|secret|银行卡|信用卡|账号凭据|私钥)/i
const SAFE_AVATAR_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
const cleanText = value => String(value || '').trim()
export const containsSensitiveChatText = value => SENSITIVE_MEMORY_PATTERN.test(cleanText(value))
const normalizeCompanionAvatar = value => {
  const avatar = cleanText(value)
  return (
    avatar.length <= MAX_COMPANION_AVATAR_LENGTH &&
    SAFE_AVATAR_PATTERN.test(avatar)
  ) ? avatar : ''
}

const normalizeReplyTo = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const content = cleanText(value.content).slice(0, 4000)
  if (!content) return null
  return {
    messageId: cleanText(value.messageId),
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content
  }
}
const safeTimestamp = (value, fallback = Date.now()) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
const optionalTimestamp = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}
const cleanLimitedText = (value, maxLength) => cleanText(value).slice(0, maxLength)

export function normalizeChatReactions(values = []) {
  if (!Array.isArray(values)) return []
  const byActor = new Map()
  values.forEach(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const actor = VALID_REACTION_ACTORS.has(value.actor) ? value.actor : ''
    const emoji = VALID_REACTION_EMOJIS.has(value.emoji) ? value.emoji : ''
    if (!actor || !emoji) return
    const reaction = {
      actor,
      emoji,
      createdAt: safeTimestamp(value.createdAt)
    }
    const previous = byActor.get(actor)
    if (!previous || reaction.createdAt >= previous.createdAt) byActor.set(actor, reaction)
  })
  return [...byActor.values()].sort((a, b) => a.createdAt - b.createdAt || a.actor.localeCompare(b.actor))
}

export function normalizeChatMessage(value = {}, idFactory = () => makeId('msg')) {
  const role = VALID_ROLES.has(value.role) ? value.role : 'user'
  const content = cleanText(value.content)
  if (!content) return null
  return {
    id: cleanText(value.id) || idFactory(),
    role,
    content,
    createdAt: safeTimestamp(value.createdAt),
    status: VALID_STATUSES.has(value.status) ? value.status : 'complete',
    type: VALID_MESSAGE_TYPES.has(value.type) ? value.type : 'text',
    replyTo: normalizeReplyTo(value.replyTo),
    reactions: normalizeChatReactions(value.reactions),
    origin: VALID_MESSAGE_ORIGINS.has(value.origin) ? value.origin : 'chat',
    proactiveId: cleanLimitedText(value.proactiveId, 100)
  }
}

export function normalizeChatMessages(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byId = new Map()
  const messageVersion = item => Math.max(
    item.createdAt,
    ...(item.reactions || []).map(reaction => reaction.createdAt)
  )
  values.forEach(value => {
    const normalized = normalizeChatMessage(value, idFactory)
    if (!normalized) return
    const previous = byId.get(normalized.id)
    if (!previous || messageVersion(normalized) >= messageVersion(previous)) byId.set(normalized.id, normalized)
  })
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

const normalizeMemoryCategory = value => (
  CHAT_MEMORY_CATEGORIES.includes(cleanText(value)) ? cleanText(value) : '经历'
)

const memoryKeyFrom = (category, content) => (
  `${category}:${cleanText(content).toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').slice(0, 120)}`
)

export function normalizeChatMemory(value = {}, idFactory = () => makeId('memory')) {
  const content = cleanText(value.content)
  if (!content || SENSITIVE_MEMORY_PATTERN.test(content)) return null
  const category = normalizeMemoryCategory(value.category)
  const scope = VALID_MEMORY_SCOPES.has(value.scope) ? value.scope : 'user'
  const createdAt = safeTimestamp(value.createdAt)
  const updatedAt = safeTimestamp(value.updatedAt, createdAt)
  return {
    id: cleanText(value.id) || idFactory(),
    key: cleanText(value.key) || memoryKeyFrom(category, content),
    scope,
    category,
    content,
    sourceMessageId: cleanText(value.sourceMessageId),
    createdAt,
    updatedAt
  }
}

export function normalizeChatMemories(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byKey = new Map()
  values.forEach(value => {
    const normalized = normalizeChatMemory(value, idFactory)
    if (!normalized) return
    const scopedKey = `${normalized.scope}:${normalized.key}`
    const previous = byKey.get(scopedKey)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byKey.set(scopedKey, normalized)
  })
  return [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
}

const normalizeStringValues = (values, { limit = 12, itemLength = 80 } = {}) => {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values.map(value => cleanLimitedText(value, itemLength))
    .filter(value => value && !SENSITIVE_MEMORY_PATTERN.test(value))
    .filter(value => {
      const key = value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

export function normalizeCompanionSelfProfile(value = {}) {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    summary: cleanLimitedText(profile.summary, 300),
    interests: normalizeStringValues(profile.interests),
    dislikes: normalizeStringValues(profile.dislikes),
    opinions: normalizeStringValues(profile.opinions),
    habits: normalizeStringValues(profile.habits),
    updatedAt: optionalTimestamp(profile.updatedAt)
  }
}

export function normalizeSocialCharacter(value = {}, idFactory = () => makeId('cast')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = cleanLimitedText(value.name, 30)
  const relationship = cleanLimitedText(value.relationship, 50)
  if (!name || !relationship || SENSITIVE_MEMORY_PATTERN.test(`${name}${relationship}${value.notes || ''}`)) return null
  const createdAt = safeTimestamp(value.createdAt)
  return {
    id: cleanText(value.id) || idFactory(),
    name,
    relationship,
    traits: normalizeStringValues(value.traits, { limit: 6, itemLength: 40 }),
    notes: cleanLimitedText(value.notes, 200),
    createdAt,
    updatedAt: safeTimestamp(value.updatedAt, createdAt)
  }
}

export function normalizeSocialCast(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byName = new Map()
  values.forEach(value => {
    const normalized = normalizeSocialCharacter(value, idFactory)
    if (!normalized) return
    const key = normalized.name.toLocaleLowerCase('zh-CN')
    const previous = byName.get(key)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byName.set(key, normalized)
  })
  return [...byName.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)
}

export function normalizeVirtualEvent(value = {}, idFactory = () => makeId('event')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const title = cleanLimitedText(value.title, 80)
  const detail = cleanLimitedText(value.detail, 300)
  if (!title || !detail || SENSITIVE_MEMORY_PATTERN.test(`${title}${detail}`)) return null
  const createdAt = safeTimestamp(value.createdAt)
  const rawDate = cleanText(value.date)
  return {
    id: cleanText(value.id) || idFactory(),
    date: DATE_PATTERN.test(rawDate) ? rawDate : new Date(createdAt).toISOString().slice(0, 10),
    title,
    detail,
    characterIds: normalizeStringValues(value.characterIds, { limit: 3, itemLength: 100 }),
    status: value.status === 'resolved' ? 'resolved' : 'active',
    createdAt,
    updatedAt: safeTimestamp(value.updatedAt, createdAt)
  }
}

export function normalizeVirtualEvents(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byId = new Map()
  let previousArchive = null
  values.forEach(value => {
    const normalized = normalizeVirtualEvent(value, idFactory)
    if (!normalized) return
    if (normalized.id === 'event-archive') {
      previousArchive = normalized
      return
    }
    const key = normalized.id || `${normalized.date}:${normalized.title}`
    const previous = byId.get(key)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byId.set(key, normalized)
  })
  const byDate = new Map()
  ;[...byId.values()].forEach(event => {
    const previous = byDate.get(event.date)
    if (!previous || event.updatedAt >= previous.updatedAt) byDate.set(event.date, event)
  })
  const detailed = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
  if (!detailed.length) return previousArchive ? [previousArchive] : []
  const newestAt = new Date(`${detailed[0].date}T00:00:00Z`).getTime()
  const cutoffAt = newestAt - 29 * 24 * 60 * 60 * 1000
  const recent = detailed.filter(event => new Date(`${event.date}T00:00:00Z`).getTime() >= cutoffAt)
  const older = detailed.filter(event => new Date(`${event.date}T00:00:00Z`).getTime() < cutoffAt)
  if (!older.length && !previousArchive) return recent
  const archiveTitles = normalizeStringValues([
    ...(previousArchive ? [previousArchive.detail.replace(/^更早发生过：/, '')] : []),
    ...older.map(event => event.title)
  ], { limit: 20, itemLength: 80 })
  const oldest = older.at(-1) || previousArchive
  const archive = normalizeVirtualEvent({
    id: 'event-archive',
    date: oldest.date,
    title: '更早的虚拟生活概览',
    detail: `更早发生过：${archiveTitles.join('、')}`,
    characterIds: [],
    status: 'resolved',
    createdAt: oldest.createdAt,
    updatedAt: Math.max(previousArchive?.updatedAt || 0, ...older.map(event => event.updatedAt))
  })
  return archive ? [...recent, archive] : recent
}

export function normalizeEvolutionEntry(value = {}, idFactory = () => makeId('evolution')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const field = VALID_SELF_FIELDS.has(value.field) ? value.field : ''
  const nextValue = cleanLimitedText(value.nextValue, 100)
  if (!field || !nextValue || SENSITIVE_MEMORY_PATTERN.test(nextValue)) return null
  return {
    id: cleanText(value.id) || idFactory(),
    field,
    previousValue: cleanLimitedText(value.previousValue, 100),
    nextValue,
    reason: cleanLimitedText(value.reason, 200),
    sourceMessageIds: normalizeStringValues(value.sourceMessageIds, { limit: 12, itemLength: 100 }),
    createdAt: safeTimestamp(value.createdAt),
    revertedAt: optionalTimestamp(value.revertedAt)
  }
}

export function normalizeEvolutionLog(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  return values.map(value => normalizeEvolutionEntry(value, idFactory))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100)
}

export function normalizeEvolutionCandidate(value = {}, idFactory = () => makeId('candidate')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const field = VALID_SELF_FIELDS.has(value.field) ? value.field : ''
  const candidateValue = cleanLimitedText(value.value, 100)
  if (!field || !candidateValue || SENSITIVE_MEMORY_PATTERN.test(candidateValue)) return null
  return {
    id: cleanText(value.id) || idFactory(),
    field,
    value: candidateValue,
    reason: cleanLimitedText(value.reason, 200),
    evidenceDates: normalizeStringValues(value.evidenceDates, { limit: 10, itemLength: 10 })
      .filter(item => DATE_PATTERN.test(item)),
    sourceMessageIds: normalizeStringValues(value.sourceMessageIds, { limit: 12, itemLength: 100 }),
    updatedAt: optionalTimestamp(value.updatedAt)
  }
}

export function normalizeEvolutionCandidates(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byKey = new Map()
  values.forEach(value => {
    const normalized = normalizeEvolutionCandidate(value, idFactory)
    if (!normalized) return
    const key = `${normalized.field}:${normalized.value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')}`
    const previous = byKey.get(key)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byKey.set(key, normalized)
  })
  return [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
}

export function normalizeChatRealismSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    followupEnabled: settings.followupEnabled !== false,
    followupFrequency: ['occasional'].includes(cleanText(settings.followupFrequency))
      ? cleanText(settings.followupFrequency)
      : DEFAULT_CHAT_REALISM_SETTINGS.followupFrequency,
    pacing: ['balanced'].includes(cleanText(settings.pacing))
      ? cleanText(settings.pacing)
      : DEFAULT_CHAT_REALISM_SETTINGS.pacing
  }
}

export function normalizeFollowupItem(value = {}, idFactory = () => makeId('followup')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const content = cleanLimitedText(value.content, 300)
  const scheduledAt = optionalTimestamp(value.scheduledAt)
  if (!content || !scheduledAt || SENSITIVE_MEMORY_PATTERN.test(content)) return null
  const createdAt = safeTimestamp(value.createdAt)
  const notificationId = Number(value.notificationId)
  return {
    id: cleanText(value.id) || idFactory(),
    sourceMessageId: cleanLimitedText(value.sourceMessageId, 100),
    content,
    intentBrief: cleanLimitedText(value.intentBrief, 160),
    scheduledAt,
    notificationId: Number.isInteger(notificationId) ? notificationId : 0,
    createdAt
  }
}

export function normalizeFollowupOutbox(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byId = new Map()
  values.forEach(value => {
    const normalized = normalizeFollowupItem(value, idFactory)
    if (!normalized) return
    byId.set(normalized.id, normalized)
  })
  return [...byId.values()].sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, 12)
}

export function normalizeCompanionState(value = {}) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    date: DATE_PATTERN.test(cleanText(state.date)) ? cleanText(state.date) : '',
    mood: cleanLimitedText(state.mood, 12) || DEFAULT_COMPANION_STATE.mood,
    energy: ['低', '平稳', '高'].includes(cleanText(state.energy))
      ? cleanText(state.energy)
      : DEFAULT_COMPANION_STATE.energy,
    statusText: cleanLimitedText(state.statusText, 24) || DEFAULT_COMPANION_STATE.statusText,
    currentThought: cleanLimitedText(state.currentThought, 160),
    virtualMoment: cleanLimitedText(state.virtualMoment, 200),
    attitude: cleanLimitedText(state.attitude, 160) || DEFAULT_COMPANION_STATE.attitude,
    emotionArc: {
      kind: VALID_EMOTION_ARCS.has(cleanText(state.emotionArc?.kind))
        ? cleanText(state.emotionArc.kind)
        : DEFAULT_COMPANION_STATE.emotionArc.kind,
      intensity: Math.max(0, Math.min(2, Math.round(Number(state.emotionArc?.intensity) || 0))),
      reason: cleanLimitedText(state.emotionArc?.reason, 120),
      turns: Math.max(0, Math.min(3, Math.round(Number(state.emotionArc?.turns) || 0))),
      repairDue: state.emotionArc?.repairDue === true
    },
    updatedAt: optionalTimestamp(state.updatedAt)
  }
}

export function normalizeOpenLoop(value = {}, idFactory = () => makeId('loop')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const content = cleanLimitedText(value.content, 500)
  if (!content || SENSITIVE_MEMORY_PATTERN.test(content)) return null
  const createdAt = safeTimestamp(value.createdAt)
  return {
    id: cleanText(value.id) || idFactory(),
    key: cleanLimitedText(value.key, 160) || cleanLimitedText(content.toLocaleLowerCase('zh-CN'), 160),
    type: VALID_OPEN_LOOP_TYPES.has(value.type) ? value.type : 'topic',
    content,
    sourceMessageId: cleanLimitedText(value.sourceMessageId, 100),
    createdAt,
    updatedAt: safeTimestamp(value.updatedAt, createdAt)
  }
}

export function normalizeOpenLoops(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byKey = new Map()
  values.forEach(value => {
    const normalized = normalizeOpenLoop(value, idFactory)
    if (!normalized) return
    const previous = byKey.get(normalized.key)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byKey.set(normalized.key, normalized)
  })
  const byContent = new Map()
  ;[...byKey.values()].forEach(normalized => {
    const fingerprint = cleanText(normalized.content)
      .toLocaleLowerCase('zh-CN')
      .replace(/[^\p{Script=Han}a-z0-9]+/gu, '')
      .slice(0, 240)
    const previous = byContent.get(fingerprint)
    if (!previous || normalized.updatedAt >= previous.updatedAt) {
      byContent.set(fingerprint, normalized)
    }
  })
  return [...byContent.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
    .slice(0, 30)
}

export function pruneStaleOpenLoops(values = [], messages = []) {
  const normalized = normalizeOpenLoops(values)
  const messageList = Array.isArray(messages) ? messages : []
  const messageIndexes = new Map(messageList.map((item, index) => [String(item?.id || ''), index]))
  const thresholds = { question: 3, topic: 6, promise: 8 }
  return normalized.filter(item => {
    const sourceIndex = messageIndexes.get(String(item.sourceMessageId || ''))
    if (!Number.isInteger(sourceIndex)) return true
    const newerUserMessages = messageList
      .slice(sourceIndex + 1)
      .filter(message => message?.role === 'user').length
    return newerUserMessages < (thresholds[item.type] || thresholds.topic)
  })
}

export function normalizeChatProactiveSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rawMax = Number(settings.dailyMax)
  const dailyMax = Number.isInteger(rawMax)
    ? Math.max(0, Math.min(5, rawMax))
    : DEFAULT_CHAT_PROACTIVE_SETTINGS.dailyMax
  const rawMin = Number(settings.dailyMin)
  const dailyMin = Number.isInteger(rawMin)
    ? Math.max(0, Math.min(dailyMax, rawMin))
    : DEFAULT_CHAT_PROACTIVE_SETTINGS.dailyMin
  return {
    enabled: settings.enabled !== false,
    dailyMin,
    dailyMax,
    activeStart: TIME_PATTERN.test(cleanText(settings.activeStart))
      ? cleanText(settings.activeStart)
      : DEFAULT_CHAT_PROACTIVE_SETTINGS.activeStart,
    activeEnd: TIME_PATTERN.test(cleanText(settings.activeEnd))
      ? cleanText(settings.activeEnd)
      : DEFAULT_CHAT_PROACTIVE_SETTINGS.activeEnd
  }
}

export function normalizeProactiveItem(value = {}, idFactory = () => makeId('proactive')) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const content = cleanLimitedText(value.content, 500)
  const scheduledAt = optionalTimestamp(value.scheduledAt)
  if (!content || !scheduledAt || SENSITIVE_MEMORY_PATTERN.test(content)) return null
  return {
    id: cleanText(value.id) || idFactory(),
    content,
    scheduledAt,
    createdAt: safeTimestamp(value.createdAt),
    dayKey: DATE_PATTERN.test(cleanText(value.dayKey)) ? cleanText(value.dayKey) : '',
    sequence: Number(value.sequence) === 2 ? 2 : 1,
    reason: ['daily', 'follow-up', 'entry'].includes(value.reason) ? value.reason : 'daily',
    notificationId: Number.isInteger(Number(value.notificationId)) ? Number(value.notificationId) : 0
  }
}

export function normalizeProactiveOutbox(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byId = new Map()
  values.forEach(value => {
    const normalized = normalizeProactiveItem(value, idFactory)
    if (!normalized) return
    byId.set(normalized.id, normalized)
  })
  return [...byId.values()]
    .sort((a, b) => a.scheduledAt - b.scheduledAt || a.id.localeCompare(b.id))
    .slice(0, 20)
}

export function normalizeChatReadState(value = {}, messages = []) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const latestLegacyMessageAt = (Array.isArray(messages) ? messages : [])
    .reduce((latest, item) => Math.max(latest, Number(item?.createdAt) || 0), 0)
  const hasExplicitLastReadAt = Object.prototype.hasOwnProperty.call(state, 'lastReadAt')
  return {
    lastReadAt: hasExplicitLastReadAt
      ? optionalTimestamp(state.lastReadAt)
      : latestLegacyMessageAt
  }
}

export function normalizeChatData(value = {}) {
  const messages = normalizeChatMessages(value?.messages)
  const socialCast = normalizeSocialCast(value?.socialCast)
  const allowedCharacterIds = new Set(socialCast.map(item => item.id))
  const virtualEvents = normalizeVirtualEvents(value?.virtualEvents).map(event => ({
    ...event,
    characterIds: event.characterIds.filter(id => allowedCharacterIds.has(id))
  }))
  return {
    version: CHAT_DATA_VERSION,
    profile: {
      companionName: cleanText(value?.profile?.companionName).slice(0, 20) || DEFAULT_COMPANION_NAME,
      companionAvatar: normalizeCompanionAvatar(value?.profile?.companionAvatar)
    },
    messages,
    memories: normalizeChatMemories(value?.memories),
    selfProfile: normalizeCompanionSelfProfile(value?.selfProfile),
    socialCast,
    virtualEvents,
    evolutionLog: normalizeEvolutionLog(value?.evolutionLog),
    evolutionCandidates: normalizeEvolutionCandidates(value?.evolutionCandidates),
    companionState: normalizeCompanionState(value?.companionState),
    openLoops: pruneStaleOpenLoops(value?.openLoops, messages),
    proactiveOutbox: normalizeProactiveOutbox(value?.proactiveOutbox),
    followupOutbox: normalizeFollowupOutbox(value?.followupOutbox),
    proactiveSettings: normalizeChatProactiveSettings(value?.proactiveSettings),
    realismSettings: normalizeChatRealismSettings(value?.realismSettings),
    readState: normalizeChatReadState(value?.readState, messages)
  }
}

export function buildChatBackupSnapshot(value = {}, createdAt = new Date().toISOString()) {
  const data = normalizeChatData(value)
  return {
    type: CHAT_BACKUP_TYPE,
    version: CHAT_BACKUP_VERSION,
    createdAt: String(createdAt),
    data: {
      ...data,
      proactiveOutbox: [],
      followupOutbox: []
    }
  }
}

export function normalizeChatBackupSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CHAT_BACKUP')
  if (value.type !== CHAT_BACKUP_TYPE) throw new Error('INVALID_CHAT_BACKUP_TYPE')
  if (![1, 2, 3, CHAT_BACKUP_VERSION].includes(value.version)) throw new Error('UNSUPPORTED_CHAT_BACKUP_VERSION')
  if (!value.createdAt || Number.isNaN(Date.parse(value.createdAt))) throw new Error('INVALID_CHAT_BACKUP_DATE')
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('INVALID_CHAT_BACKUP_DATA')
  return buildChatBackupSnapshot(value.data, value.createdAt)
}

export function mergeChatData(current = {}, incoming = {}, { preserveCompanionName = true } = {}) {
  const local = normalizeChatData(current)
  const imported = normalizeChatData(incoming)
  return normalizeChatData({
    profile: {
      companionName: preserveCompanionName
        ? local.profile.companionName
        : imported.profile.companionName,
      companionAvatar: preserveCompanionName
        ? local.profile.companionAvatar
        : imported.profile.companionAvatar
    },
    messages: [...local.messages, ...imported.messages],
    memories: [...local.memories, ...imported.memories],
    selfProfile: imported.selfProfile.updatedAt > local.selfProfile.updatedAt
      ? imported.selfProfile
      : local.selfProfile,
    socialCast: normalizeSocialCast([...local.socialCast, ...imported.socialCast]),
    virtualEvents: normalizeVirtualEvents([...local.virtualEvents, ...imported.virtualEvents]),
    evolutionLog: normalizeEvolutionLog([...local.evolutionLog, ...imported.evolutionLog]),
    evolutionCandidates: normalizeEvolutionCandidates([
      ...local.evolutionCandidates,
      ...imported.evolutionCandidates
    ]),
    companionState: imported.companionState.updatedAt > local.companionState.updatedAt
      ? imported.companionState
      : local.companionState,
    openLoops: [...local.openLoops, ...imported.openLoops],
    proactiveOutbox: local.proactiveOutbox,
    followupOutbox: local.followupOutbox,
    proactiveSettings: local.proactiveSettings,
    realismSettings: local.realismSettings,
    readState: {
      lastReadAt: Math.max(local.readState.lastReadAt, imported.readState.lastReadAt)
    }
  })
}

const extractJsonObject = value => {
  const text = cleanText(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('INVALID_MEMORY_RESPONSE')
  return JSON.parse(text.slice(start, end + 1))
}

export function parseMemoryExtraction(value, sourceMessageId = '', now = Date.now()) {
  const parsed = typeof value === 'string' ? extractJsonObject(value) : value
  const candidates = Array.isArray(parsed?.upserts)
    ? parsed.upserts
    : Array.isArray(parsed?.memories) ? parsed.memories : []
  return normalizeChatMemories(candidates.map(item => ({
    ...item,
    sourceMessageId: cleanText(item.sourceMessageId) || sourceMessageId,
    createdAt: item.createdAt || now,
    updatedAt: now
  })))
}

export function createChatMessage(role, content, options = {}) {
  return normalizeChatMessage({
    id: options.id || makeId('msg'),
    role,
    content,
    createdAt: options.createdAt || Date.now(),
    status: options.status || 'complete',
    type: options.type,
    replyTo: options.replyTo,
    reactions: options.reactions,
    origin: options.origin,
    proactiveId: options.proactiveId
  })
}

export function createChatMemory(value = {}) {
  return normalizeChatMemory({
    ...value,
    id: value.id || makeId('memory'),
    createdAt: value.createdAt || Date.now(),
    updatedAt: value.updatedAt || Date.now()
  })
}
