// @ts-check
import { validateKanataExperience } from '../experience/experienceValidation.js'
import { validateKanataAutonomy } from '../autonomy/autonomyValidation.js'
/** @typedef {import('./kanataTypes').KanataData} KanataData */
/** Stable codes, with structural paths only; never echo private input in errors. */
export class KanataValidationError extends Error {
  /** @param {string} code @param {string} path */
  constructor(code, path) { super(code + ':' + path); this.name = 'KanataValidationError'; this.code = code; this.path = path }
}
/** @param {unknown} condition @param {string} code @param {string} path */
export function requireKanata(condition, code, path) {
  if (!condition) throw new KanataValidationError(code, path)
}
/** @param {unknown} value @param {string} path */
const object = (value, path) => requireKanata(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT', path)
/** @param {unknown} value @param {string} path @param {boolean} [empty] */
const text = (value, path, empty = false) => requireKanata(typeof value === 'string' && (empty || value.trim().length > 0), 'INVALID_TEXT', path)
/** @param {unknown} value @param {string} path */
export const validateId = (value, path) => requireKanata(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value), 'INVALID_ID', path)
/** @param {unknown} value @param {string} path */
export const validateCharacterAvatar = (value, path) => {
  requireKanata(typeof value === 'string' && value.length <= 12 * 1024 * 1024 && value.startsWith('data:image/png;base64,'), 'INVALID_CHARACTER_AVATAR', path)
  const data = /** @type {string} */(value).slice(22)
  requireKanata(data.length > 0 && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data), 'INVALID_CHARACTER_AVATAR', path)
}
/** @param {unknown} value @param {string} path @param {number} [minimum] */
const integer = (value, path, minimum = 0) => requireKanata(Number.isSafeInteger(value) && Number(value) >= minimum, 'INVALID_INTEGER', path)
/** @param {unknown} value @param {string} path */
const bool = (value, path) => requireKanata(typeof value === 'boolean', 'INVALID_BOOLEAN', path)
/** @param {unknown} value @param {readonly string[]} values @param {string} path */
const choice = (value, values, path) => requireKanata(typeof value === 'string' && values.includes(value), 'INVALID_ENUM', path)
/** @param {unknown} value @param {string} path @returns {unknown[]} */
const rows = (value, path) => { requireKanata(Array.isArray(value), 'INVALID_COLLECTION', path); return /** @type {unknown[]} */ (value) }
/** @param {unknown} value @param {string} path */
const strings = (value, path) => { rows(value, path).forEach(v => text(v, path)); requireKanata(new Set(/** @type {string[]} */(value)).size === /** @type {string[]} */(value).length, 'DUPLICATE_REFERENCE', path) }
/** Accept inert JSON only; reject accessors, cycles, non-finite numbers and hidden runtime objects before cloning.
 * @template T @param {T} value @returns {T}
 */
export function cloneKanataJson(value) {
  /** @type {Set<object>} */
  const stack = new Set()
  /** @param {unknown} item @param {number} depth */
  const visit = (item, depth) => {
    requireKanata(depth <= 64, 'JSON_TOO_DEEP', 'data')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number') { requireKanata(Number.isFinite(item), 'INVALID_JSON_NUMBER', 'data'); return }
    requireKanata(typeof item === 'object' && item !== null, 'INVALID_JSON_VALUE', 'data')
    const obj = /** @type {object} */(item)
    requireKanata(!stack.has(obj), 'CYCLIC_JSON', 'data')
    requireKanata(Array.isArray(obj) || Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null, 'INVALID_JSON_OBJECT', 'data')
    requireKanata(Object.getOwnPropertySymbols(obj).length === 0, 'INVALID_JSON_VALUE', 'data')
    stack.add(obj)
    const descriptors = Object.getOwnPropertyDescriptors(obj)
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(obj) && key === 'length') continue
      requireKanata(Object.hasOwn(d, 'value') && d.enumerable, 'INVALID_JSON_PROPERTY', 'data')
      visit(d.value, depth + 1)
    }
    if (Array.isArray(obj)) requireKanata(Object.keys(obj).length === obj.length && Object.keys(obj).every((key, index) => key === String(index)), 'INVALID_JSON_ARRAY', 'data')
    stack.delete(obj)
  }
  visit(value, 0)
  return JSON.parse(JSON.stringify(value))
}
/** @param {unknown} value @param {string} [path] */
export function validateCharacterDefinition(value, path = 'definition') {
  object(value, path)
  const d = /** @type {import('./kanataTypes').CharacterDefinition} */(value)
  for (const key of /** @type {const} */(['name', 'summary', 'speechStyle', 'disagreementStyle', 'knowledgeBoundary', 'addressRule', 'avatarPlaceholder'])) text(d[key], path + '.' + key)
  if (d.avatarDataUrl !== undefined) validateCharacterAvatar(d.avatarDataUrl, path + '.avatarDataUrl')
  for (const key of /** @type {const} */(['scenario', 'exampleDialogue'])) if (d[key] !== undefined) text(d[key], path + '.' + key, true)
  for (const key of /** @type {const} */(['greetings', 'groupGreetings'])) if (d[key] !== undefined) {
    requireKanata(Array.isArray(d[key]) && d[key].every(value => typeof value === 'string'), 'INVALID_CHARACTER_GREETINGS', path + '.' + key)
  }
  for (const key of /** @type {const} */(['aliases', 'anchors', 'motivations', 'interests', 'driftGuards'])) strings(d[key], path + '.' + key)
  requireKanata(d.anchors.length > 0 && d.driftGuards.length > 0, 'EMPTY_PERSONA', path)
  strings(d.promptPriority, path + '.promptPriority')
  requireKanata(d.promptPriority.length === 5 && ['worldRules', 'core', 'worldIdentity', 'knowledge', 'style'].every(layer => d.promptPriority.includes(/** @type {import('./kanataTypes').CharacterDefinition['promptPriority'][number]} */(layer))), 'INVALID_PROMPT_PRIORITY', path)
}
/** Validate a whole reference graph, then return a detached value. No legacy normalizer, hidden clock or I/O.
 * @param {unknown} input @returns {KanataData}
 */
export function validateKanataData(input) {
  const copied = cloneKanataJson(input)
  object(copied, 'data')
  const data = /** @type {KanataData} */(copied)
  requireKanata(data.type === 'kanata-data', 'INVALID_KANATA_TYPE', 'type')
  requireKanata(data.version === 1, 'UNSUPPORTED_KANATA_VERSION', 'version')
  validateId(data.userId, 'userId')
  const names = /** @type {const} */(['worlds', 'cards', 'cardVersions', 'identities', 'instances', 'conversations', 'messages', 'lorebookEntries', 'memories', 'relationships', 'events', 'effects', 'tasks', 'lifeGrants', 'presetApplications'])
  /** @type {Map<string, {id: string, worldId?: string}>} */
  const entities = new Map()
  for (const name of names) {
    rows(data[name], name)
    for (const row of data[name]) {
      object(row, name); validateId(row.id, name + '.id')
      requireKanata(!entities.has(row.id), 'DUPLICATE_ID', name)
      entities.set(row.id, row)
    }
  }
  const worlds = new Map(data.worlds.map(w => [w.id, w]))
  const cards = new Map(data.cards.map(c => [c.id, c]))
  const versions = new Map(data.cardVersions.map(c => [c.id, c]))
  const identities = new Map(data.identities.map(u => [u.id, u]))
  const instances = new Map(data.instances.map(c => [c.id, c]))
  const conversations = new Map(data.conversations.map(c => [c.id, c]))
  const messages = new Map(data.messages.map(m => [m.id, m]))
  if (data.usageEvents !== undefined) {
    rows(data.usageEvents, 'usageEvents')
    const seen = new Set()
    data.usageEvents.forEach(event => {
      validateId(event.id, 'usage.id'); requireKanata(!seen.has(event.id) && !entities.has(event.id), 'DUPLICATE_ID', 'usage.id'); seen.add(event.id)
      const conversation = conversations.get(event.conversationId)
      requireKanata(conversation?.worldId === event.worldId && instances.get(event.instanceId)?.worldId === event.worldId && conversation?.participantIds.includes(event.instanceId), 'USAGE_SCOPE_DENIED', 'usage')
      validateId(event.turnId, 'usage.turnId'); text(event.model, 'usage.model'); bool(event.officialProvider, 'usage.officialProvider')
      requireKanata(/^[a-zA-Z0-9._:/-]{1,100}$/.test(event.model), 'INVALID_MODEL', 'usage.model')
      integer(event.startedAt, 'usage.startedAt'); if (event.finishedAt !== null) integer(event.finishedAt, 'usage.finishedAt')
      choice(event.transport, ['stream','json'], 'usage.transport'); choice(event.status, ['pending','succeeded','failed'], 'usage.status')
      requireKanata((event.status === 'pending') === (event.finishedAt === null), 'INVALID_USAGE_STATUS', 'usage')
      text(event.errorCode, 'usage.errorCode', true); text(event.finishReason, 'usage.finishReason', true)
      requireKanata(/^[A-Z0-9_]*$/.test(event.errorCode) && /^[a-z_]*$/.test(event.finishReason), 'INVALID_USAGE_CODE', 'usage')
      integer(event.estimatedInputTokens, 'usage.estimate'); integer(event.estimatedOutputTokens, 'usage.estimate')
      if (event.usage !== null) {
        object(event.usage, 'usage.tokens'); integer(event.usage.promptTokens, 'usage.promptTokens'); integer(event.usage.completionTokens, 'usage.completionTokens')
        if (event.usage.cacheHitTokens !== null) { integer(event.usage.cacheHitTokens, 'usage.cacheHitTokens'); requireKanata(event.usage.cacheHitTokens <= event.usage.promptTokens, 'INVALID_CACHE_USAGE', 'usage') }
      }
    })
  }
  const events = new Map(data.events.map(e => [e.id, e]))
  const relationships = new Map(data.relationships.map(r => [r.id, r]))
  /** @param {string} id @param {string} worldId @param {string} path */
  const scoped = (id, worldId, path) => {
    const target = entities.get(id)
    requireKanata(target, 'ORPHAN_REFERENCE', path)
    requireKanata(target?.worldId === worldId || (worlds.has(id) && id === worldId), 'CROSS_WORLD_REFERENCE', path)
  }
  /** @param {string} id @param {string} worldId @param {string} path */
  const participant = (id, worldId, path) => {
    requireKanata(instances.has(id) || identities.has(id), 'INVALID_PARTICIPANT', path); scoped(id, worldId, path)
  }
  /** @param {import('./kanataTypes').SourceRef[]} refs @param {string} worldId */
  const sources = (refs, worldId) => {
    rows(refs, 'sourceRefs')
    const seen = new Set()
    refs.forEach(ref => {
      object(ref, 'sourceRef'); integer(ref.revision, 'sourceRef.revision', 1)
      const msg = messages.get(ref.messageId)
      requireKanata(msg, 'ORPHAN_SOURCE', 'sourceRef.messageId'); scoped(ref.messageId, worldId, 'sourceRef')
      requireKanata(ref.revision <= Number(msg?.revision), 'FUTURE_SOURCE_REVISION', 'sourceRef.revision')
      requireKanata(!seen.has(ref.messageId), 'DUPLICATE_REFERENCE', 'sourceRefs'); seen.add(ref.messageId)
    })
  }
  for (const name of names) {
    if (['cards', 'cardVersions', 'worlds'].includes(name)) continue
    for (const row of data[name]) {
      const worldId = /** @type {{worldId: string}} */(row).worldId
      requireKanata(worlds.has(worldId), 'ORPHAN_WORLD', name + '.worldId')
    }
  }
  data.worlds.forEach(w => {
    text(w.name, 'world.name'); text(w.rules, 'world.rules', true); integer(w.revision, 'world.revision', 1)
    text(w.timeZone, 'world.timeZone')
    try { new Intl.DateTimeFormat('en', { timeZone: w.timeZone }) } catch { throw new KanataValidationError('INVALID_TIMEZONE', 'world.timeZone') }
    integer(w.createdAt, 'world.createdAt'); integer(w.lastSimulatedAt, 'world.lastSimulatedAt')
    requireKanata(w.lastSimulatedAt >= w.createdAt, 'INVALID_TIME_WATERMARK', 'world.lastSimulatedAt')
    bool(w.autonomyEnabled, 'world.autonomyEnabled'); bool(w.proactiveEnabled, 'world.proactiveEnabled'); bool(w.notificationsEnabled, 'world.notificationsEnabled')
    if (w.archived !== undefined) bool(w.archived, 'world.archived')
    choice(w.defaultChatMode, ['daily', 'roleplay'], 'world.defaultChatMode')
    requireKanata(data.identities.filter(u => u.worldId === w.id).length === 1, 'WORLD_IDENTITY_REQUIRED', 'world')
    if (w.presetSourceId !== undefined) { text(w.presetSourceId, 'world.presetSourceId'); integer(w.presetVersion, 'world.presetVersion', 1) }
  })
  const cardRevisions = new Set(), presetCardKeys = new Set()
  data.cards.forEach(c => {
    bool(c.archived, 'card.archived')
    requireKanata(versions.get(c.currentVersionId)?.cardId === c.id, 'ORPHAN_CARD_VERSION', 'card.currentVersionId')
    if (c.presetKey !== undefined) {
      text(c.presetKey, 'card.presetKey')
      requireKanata(!presetCardKeys.has(c.presetKey), 'DUPLICATE_PRESET_CARD_KEY', 'card.presetKey'); presetCardKeys.add(c.presetKey)
    }
  })
  data.cardVersions.forEach(v => {
    requireKanata(cards.has(v.cardId), 'ORPHAN_CARD', 'version.cardId'); integer(v.revision, 'cardVersion.revision', 1)
    const key = JSON.stringify([v.cardId, v.revision])
    requireKanata(!cardRevisions.has(key), 'DUPLICATE_CARD_REVISION', 'cardVersion'); cardRevisions.add(key)
    validateCharacterDefinition(v.definition); text(v.source, 'cardVersion.source')
    requireKanata(Object.hasOwn(v, 'rawData'), 'MISSING_CARD_RAW_DATA', 'cardVersion.rawData')
    if (v.imported !== undefined) {
      object(v.imported, 'cardVersion.imported')
      text(v.imported.fileName, 'cardVersion.imported.fileName')
      requireKanata(v.imported.fileName.length <= 255 && !/[\\/\u0000-\u001f]/.test(v.imported.fileName), 'INVALID_CARD_FILE_NAME', 'cardVersion.imported.fileName')
      choice(v.imported.format, ['json', 'png'], 'cardVersion.imported.format')
      const bytes = v.imported.sourceBase64
      requireKanata(typeof bytes === 'string' && bytes.length > 0 && bytes.length <= 12 * 1024 * 1024 && bytes.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(bytes), 'INVALID_CARD_SOURCE_BYTES', 'cardVersion.imported.sourceBase64')
      if (v.imported.avatarDataUrl !== undefined) validateCharacterAvatar(v.imported.avatarDataUrl, 'cardVersion.imported.avatarDataUrl')
    }
  })
  data.identities.forEach(u => {
    requireKanata(u.userId === data.userId, 'INVALID_USER_IDENTITY', 'identity.userId')
    text(u.displayName, 'identity.displayName'); text(u.background, 'identity.background', true); integer(u.revision, 'identity.revision', 1)
  })
  data.instances.forEach(c => {
    requireKanata(cards.has(c.cardId), 'ORPHAN_CARD', 'instance.cardId')
    requireKanata(versions.get(c.cardVersionId)?.cardId === c.cardId, 'ORPHAN_CARD_VERSION', 'instance.cardVersionId')
    integer(c.revision, 'instance.revision', 1); object(c.overrides, 'instance.overrides')
    validateCharacterDefinition({ ...versions.get(c.cardVersionId)?.definition, ...c.overrides }, 'instance.definition')
    object(c.state, 'instance.state'); text(c.state.mood, 'state.mood'); text(c.state.location, 'state.location', true)
    requireKanata(typeof c.state.energy === 'number' && c.state.energy >= 0 && c.state.energy <= 1, 'INVALID_ENERGY', 'instance.state')
    bool(c.autonomyEnabled, 'instance.autonomy'); bool(c.proactiveEnabled, 'instance.proactive')
  })
  data.conversations.forEach(c => {
    text(c.title, 'conversation.title'); strings(c.participantIds, 'conversation.participants')
    choice(c.type, ['private', 'group', 'character'], 'conversation.type'); choice(c.mode, ['inherit', 'daily', 'roleplay'], 'conversation.mode')
    integer(c.revision, 'conversation.revision', 1); integer(c.lastReadAt, 'conversation.lastReadAt')
    c.participantIds.forEach(id => participant(id, c.worldId, 'conversation.participants'))
    const users = c.participantIds.filter(id => identities.has(id)).length
    const characters = c.participantIds.length - users
    requireKanata(c.type === 'private' ? users === 1 && characters === 1 : c.type === 'group' ? users === 1 && characters >= 2 : users === 0 && characters >= 2, 'INVALID_CONVERSATION_MEMBERS', 'conversation')
  })
  data.messages.forEach(m => {
    const c = conversations.get(m.conversationId)
    requireKanata(c, 'ORPHAN_CONVERSATION', 'message.conversationId'); scoped(m.conversationId, m.worldId, 'message.conversation')
    choice(m.senderType, ['user', 'character'], 'message.senderType'); choice(m.role, ['user', 'assistant'], 'message.role')
    requireKanata(m.senderType === 'user' ? identities.has(m.senderId) && m.role === 'user' : instances.has(m.senderId) && m.role === 'assistant', 'INVALID_SENDER', 'message')
    requireKanata(c?.participantIds.includes(m.senderId), 'SENDER_NOT_PARTICIPANT', 'message.senderId')
    text(m.content, 'message.content'); text(m.senderNameSnapshot, 'message.senderNameSnapshot')
    validateId(m.turnId, 'message.turnId'); validateId(m.batchId, 'message.batchId')
    integer(m.createdAt, 'message.createdAt'); integer(m.revision, 'message.revision', 1); choice(m.status, ['complete', 'stopped'], 'message.status')
    if (m.replyToMessageId !== undefined) requireKanata(m.replyToMessageId !== m.id && messages.get(m.replyToMessageId)?.conversationId === m.conversationId, 'INVALID_REPLY_REFERENCE', 'message.replyTo')
  })
  data.lorebookEntries.forEach(l => {
    text(l.content, 'lore.content'); strings(l.keys, 'lore.keys'); strings(l.knownBy, 'lore.knownBy')
    choice(l.scope, ['world', 'character', 'system'], 'lore.scope'); choice(l.visibility, ['public', 'private', 'participants'], 'lore.visibility')
    requireKanata(l.scope === 'character' ? instances.has(l.ownerId) : l.ownerId === l.worldId, 'INVALID_LORE_OWNER', 'lore.ownerId'); scoped(l.ownerId, l.worldId, 'lore.owner')
    l.knownBy.forEach(id => participant(id, l.worldId, 'lore.knownBy'))
    if (l.enabled !== undefined) bool(l.enabled, 'lore.enabled')
    if (l.caseSensitive !== undefined) bool(l.caseSensitive, 'lore.caseSensitive')
    if (l.secondaryKeys !== undefined) strings(l.secondaryKeys, 'lore.secondaryKeys')
    integer(l.priority, 'lore.priority'); integer(l.revision, 'lore.revision', 1)
    choice(l.activationRule, ['keyword', 'always'], 'lore.activationRule'); text(l.sourceTag, 'lore.sourceTag')
    requireKanata(l.visibility !== 'private' || l.knownBy.length > 0, 'PRIVATE_KNOWLEDGE_REQUIRED', 'lore.knownBy')
  })
  data.memories.forEach(m => {
    choice(m.ownerType, ['world', 'character'], 'memory.ownerType')
    requireKanata(m.ownerType === 'character' ? instances.has(m.ownerId) : m.ownerId === m.worldId, 'INVALID_MEMORY_OWNER', 'memory.ownerId'); scoped(m.ownerId, m.worldId, 'memory.owner')
    text(m.key, 'memory.key'); text(m.content, 'memory.content'); integer(m.revision, 'memory.revision', 1)
    choice(m.layer, ['L2', 'L3'], 'memory.layer'); choice(m.status, ['candidate', 'active', 'stale', 'deleted'], 'memory.status')
    choice(m.visibility, ['public', 'private', 'participants'], 'memory.visibility'); sources(m.sourceRefs, m.worldId)
  })
  const edges = new Set()
  data.relationships.forEach(r => {
    participant(r.fromId, r.worldId, 'relationship.from'); participant(r.toId, r.worldId, 'relationship.to')
    requireKanata(r.fromId !== r.toId, 'SELF_RELATIONSHIP', 'relationship')
    const key = JSON.stringify([r.worldId, r.fromId, r.toId])
    requireKanata(!edges.has(key), 'DUPLICATE_RELATIONSHIP', 'relationship'); edges.add(key)
    choice(r.kind, ['teammate', 'teacher', 'acquaintance', 'friend', 'conflict', 'romantic'], 'relationship.kind'); choice(r.trustBaseline, ['new', 'established'], 'relationship.trustBaseline')
    text(r.publicSummary, 'relationship.publicSummary'); integer(r.revision, 'relationship.revision', 1)
    object(r.dimensions, 'relationship.dimensions')
    integer(r.dimensionRuleVersion, 'relationship.dimensionRuleVersion', 1)
    for (const key of /** @type {const} */(['trust', 'intimacy', 'understanding'])) {
      const value = r.dimensions[key]
      requireKanata(typeof value === 'number' && value >= -1 && value <= 1, 'INVALID_RELATIONSHIP_DIMENSION', 'relationship.dimensions')
    }
    strings(r.sourceEventIds, 'relationship.sources')
    r.sourceEventIds.forEach(id => { requireKanata(events.has(id), 'ORPHAN_EVENT', 'relationship.sources'); scoped(id, r.worldId, 'relationship.sources') })
  })
  data.events.forEach(e => {
    strings(e.participantIds, 'event.participants'); e.participantIds.forEach(id => participant(id, e.worldId, 'event.participants'))
    sources(e.sourceRefs, e.worldId); strings(e.causedByEventIds, 'event.causes')
    e.causedByEventIds.forEach(id => { requireKanata(events.has(id), 'ORPHAN_EVENT', 'event.causes'); scoped(id, e.worldId, 'event.causes') })
    choice(e.status, ['candidate', 'committed', 'revoked', 'needsReview'], 'event.status'); choice(e.visibility, ['public', 'private', 'participants'], 'event.visibility')
    text(e.summary, 'event.summary'); integer(e.effectiveAt, 'event.effectiveAt'); integer(e.recordedAt, 'event.recordedAt'); integer(e.revision, 'event.revision', 1)
  })
  // Kahn traversal is bounded by graph size; long histories cannot overflow a recursive DFS.
  const degree = new Map(data.events.map(e => [e.id, e.causedByEventIds.length]))
  /** @type {Map<string, string[]>} */
  const successors = new Map()
  data.events.forEach(e => e.causedByEventIds.forEach(id => successors.set(id, [...(successors.get(id) || []), e.id])))
  const queue = data.events.filter(e => degree.get(e.id) === 0).map(e => e.id)
  for (let index = 0; index < queue.length; index++) {
    for (const next of successors.get(queue[index]) || []) {
      const remaining = Number(degree.get(next)) - 1; degree.set(next, remaining)
      if (!remaining) queue.push(next)
    }
  }
  requireKanata(queue.length === data.events.length, 'EVENT_CAUSAL_CYCLE', 'events')
  data.effects.forEach(e => {
    const event = events.get(e.eventId)
    requireKanata(event && event.status !== 'candidate', 'UNCOMMITTED_EFFECT', 'effect.eventId'); scoped(e.eventId, e.worldId, 'effect.event')
    choice(e.targetType, ['world', 'instance', 'relationship'], 'effect.targetType')
    const targets = e.targetType === 'world' ? worlds : e.targetType === 'instance' ? instances : relationships
    requireKanata(targets.has(e.targetId), 'INVALID_EFFECT_TARGET', 'effect.targetId'); scoped(e.targetId, e.worldId, 'effect.target')
    choice(e.operation, ['set', 'increment'], 'effect.operation'); text(e.path, 'effect.path')
    requireKanata(e.path.split('.').every(p => /^[A-Za-z][A-Za-z0-9_]*$/.test(p) && !['__proto__', 'constructor', 'prototype'].includes(p)), 'UNSAFE_EFFECT_PATH', 'effect.path')
    integer(e.ruleVersion, 'effect.ruleVersion', 1)
    if (e.operation === 'increment') requireKanata(typeof e.value === 'number', 'INVALID_EFFECT_VALUE', 'effect.value')
  })
  const taskKeys = new Set()
  data.tasks.forEach(t => {
    choice(t.kind, ['reply', 'memory', 'summary', 'world', 'proactive', 'followup'], 'task.kind')
    choice(t.state, ['pending', 'running', 'succeeded', 'failed', 'cancelled'], 'task.state')
    text(t.idempotencyKey, 'task.idempotencyKey')
    const key = JSON.stringify([t.worldId, t.kind, t.idempotencyKey])
    requireKanata(!taskKeys.has(key), 'DUPLICATE_TASK_KEY', 'tasks'); taskKeys.add(key)
    sources(t.sourceRefs, t.worldId)
    integer(t.sourceRevision, 'task.sourceRevision', 1); integer(t.attempt, 'task.attempt'); integer(t.notBefore, 'task.notBefore'); integer(t.leaseUntil, 'task.leaseUntil')
    if (t.instanceId !== undefined) { requireKanata(instances.has(t.instanceId), 'ORPHAN_INSTANCE', 'task.instanceId'); scoped(t.instanceId, t.worldId, 'task.instance') }
    if (t.conversationId !== undefined) { requireKanata(conversations.has(t.conversationId), 'ORPHAN_CONVERSATION', 'task.conversationId'); scoped(t.conversationId, t.worldId, 'task.conversation') }
    if (t.instanceId !== undefined && t.conversationId !== undefined) requireKanata(conversations.get(t.conversationId)?.participantIds.includes(t.instanceId), 'TASK_SPEAKER_NOT_PARTICIPANT', 'task.instanceId')
    strings(t.resultEventIds, 'task.resultEvents')
    t.resultEventIds.forEach(id => { requireKanata(events.has(id), 'ORPHAN_EVENT', 'task.resultEvents'); scoped(id, t.worldId, 'task.resultEvents') })
  })
  const grantKeys = new Set()
  data.lifeGrants.forEach(g => {
    requireKanata(instances.has(g.instanceId), 'ORPHAN_INSTANCE', 'grant.instanceId'); scoped(g.instanceId, g.worldId, 'grant.instance')
    choice(g.moduleId, ['home', 'mood', 'weight', 'savings', 'schedule', 'todo', 'reports'], 'grant.moduleId')
    bool(g.read, 'grant.read'); bool(g.remember, 'grant.remember'); bool(g.share, 'grant.share'); integer(g.revision, 'grant.revision', 1)
    const key = JSON.stringify([g.worldId, g.instanceId, g.moduleId])
    requireKanata(!grantKeys.has(key), 'DUPLICATE_GRANT', 'grants'); grantKeys.add(key)
  })
  const initializationKeys = new Set(), initializedWorlds = new Set()
  data.presetApplications.forEach(p => {
    text(p.initializationKey, 'preset.initializationKey'); text(p.presetSourceId, 'preset.source'); integer(p.presetVersion, 'preset.version', 1)
    requireKanata(!initializationKeys.has(p.initializationKey) && !initializedWorlds.has(p.worldId), 'DUPLICATE_INITIALIZATION', 'presetApplications')
    initializationKeys.add(p.initializationKey); initializedWorlds.add(p.worldId)
    const world = worlds.get(p.worldId)
    requireKanata(world?.presetSourceId === p.presetSourceId && world.presetVersion === p.presetVersion, 'PRESET_SOURCE_MISMATCH', 'presetApplications')
  })
  validateKanataExperience(data)
  validateKanataAutonomy(data)
  return data
}
