export const CHAT_BACKUP_TYPE = 'formyself-chat-backup'
export const CHAT_BACKUP_VERSION = 1
export const DEFAULT_COMPANION_NAME = '小暖'
export const MAX_COMPANION_AVATAR_LENGTH = 1_500_000

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
const SENSITIVE_MEMORY_PATTERN = /(?:密码|口令|验证码|api[\s_-]*key|access[\s_-]*token|secret|银行卡|信用卡|账号凭据|私钥)/i
const SAFE_AVATAR_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i

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
    replyTo: normalizeReplyTo(value.replyTo)
  }
}

export function normalizeChatMessages(values = [], idFactory) {
  if (!Array.isArray(values)) return []
  const byId = new Map()
  values.forEach(value => {
    const normalized = normalizeChatMessage(value, idFactory)
    if (!normalized) return
    const previous = byId.get(normalized.id)
    if (!previous || normalized.createdAt >= previous.createdAt) byId.set(normalized.id, normalized)
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
  const createdAt = safeTimestamp(value.createdAt)
  const updatedAt = safeTimestamp(value.updatedAt, createdAt)
  return {
    id: cleanText(value.id) || idFactory(),
    key: cleanText(value.key) || memoryKeyFrom(category, content),
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
    const previous = byKey.get(normalized.key)
    if (!previous || normalized.updatedAt >= previous.updatedAt) byKey.set(normalized.key, normalized)
  })
  return [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
}

export function normalizeChatData(value = {}) {
  return {
    profile: {
      companionName: cleanText(value?.profile?.companionName).slice(0, 20) || DEFAULT_COMPANION_NAME,
      companionAvatar: normalizeCompanionAvatar(value?.profile?.companionAvatar)
    },
    messages: normalizeChatMessages(value?.messages),
    memories: normalizeChatMemories(value?.memories)
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
  if (value.version !== CHAT_BACKUP_VERSION) throw new Error('UNSUPPORTED_CHAT_BACKUP_VERSION')
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
    memories: [...local.memories, ...imported.memories]
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
    replyTo: options.replyTo
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
