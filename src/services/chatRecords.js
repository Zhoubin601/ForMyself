export const CHAT_BACKUP_TYPE = 'formyself-chat-backup'
export const CHAT_BACKUP_VERSION = 3
export const CHAT_DATA_VERSION = 3
export const DEFAULT_COMPANION_NAME = '小暖'
export const MAX_COMPANION_AVATAR_LENGTH = 1_500_000
export const CHAT_MEMORY_SCOPES = Object.freeze(['user', 'companion', 'relationship'])
export const CHAT_OPEN_LOOP_TYPES = Object.freeze(['topic', 'question', 'promise'])
export const CHAT_PROACTIVE_ORIGINS = Object.freeze(['chat', 'entry', 'proactive'])
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
  updatedAt: 0
})

export const DEFAULT_CHAT_PROACTIVE_SETTINGS = Object.freeze({
  enabled: true,
  dailyMax: 2,
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
const SENSITIVE_MEMORY_PATTERN = /(?:密码|口令|验证码|api[\s_-]*key|access[\s_-]*token|secret|银行卡|信用卡|账号凭据|私钥)/i
const SAFE_AVATAR_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
const cleanText = value => String(value || '').trim()
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
  return [...byKey.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
    .slice(0, 30)
}

export function normalizeChatProactiveSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const dailyMax = Number(settings.dailyMax)
  return {
    enabled: settings.enabled !== false,
    dailyMax: dailyMax === 1 || dailyMax === 2 ? dailyMax : DEFAULT_CHAT_PROACTIVE_SETTINGS.dailyMax,
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
  return {
    version: CHAT_DATA_VERSION,
    profile: {
      companionName: cleanText(value?.profile?.companionName).slice(0, 20) || DEFAULT_COMPANION_NAME,
      companionAvatar: normalizeCompanionAvatar(value?.profile?.companionAvatar)
    },
    messages,
    memories: normalizeChatMemories(value?.memories),
    companionState: normalizeCompanionState(value?.companionState),
    openLoops: normalizeOpenLoops(value?.openLoops),
    proactiveOutbox: normalizeProactiveOutbox(value?.proactiveOutbox),
    proactiveSettings: normalizeChatProactiveSettings(value?.proactiveSettings),
    readState: normalizeChatReadState(value?.readState, messages)
  }
}

export function buildChatBackupSnapshot(value = {}, createdAt = new Date().toISOString()) {
  return {
    type: CHAT_BACKUP_TYPE,
    version: CHAT_BACKUP_VERSION,
    createdAt: String(createdAt),
    data: normalizeChatData(value)
  }
}

export function normalizeChatBackupSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CHAT_BACKUP')
  if (value.type !== CHAT_BACKUP_TYPE) throw new Error('INVALID_CHAT_BACKUP_TYPE')
  if (![1, 2, CHAT_BACKUP_VERSION].includes(value.version)) throw new Error('UNSUPPORTED_CHAT_BACKUP_VERSION')
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
    companionState: imported.companionState.updatedAt > local.companionState.updatedAt
      ? imported.companionState
      : local.companionState,
    openLoops: [...local.openLoops, ...imported.openLoops],
    proactiveOutbox: local.proactiveOutbox,
    proactiveSettings: local.proactiveSettings,
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
