// @ts-check
import { cloneKanataJson, requireKanata as need, validateCharacterDefinition, validateId, validateKanataData } from './kanataValidation.js'
/** @param {unknown} value @returns {import('./kanataTypes').WorldPreset} */
export function validateWorldPreset(value) {
  const p = /** @type {import('./kanataTypes').WorldPreset} */(cloneKanataJson(value))
  need(p && typeof p === 'object' && !Array.isArray(p), 'INVALID_PRESET', 'preset')
  need(p.type === 'kanata-preset' && p.version === 1, 'UNSUPPORTED_PRESET_VERSION', 'preset.version')
  validateId(p.id, 'preset.id')
  need(Number.isSafeInteger(p.presetVersion) && p.presetVersion > 0, 'INVALID_PRESET_VERSION', 'preset.presetVersion')
  for (const v of [p.name, p.rules, p.sourceNotice]) need(typeof v === 'string' && v.trim(), 'INVALID_PRESET_TEXT', 'preset')
  need(Array.isArray(p.sources) && p.sources.length > 0 && p.sources.every(s => typeof s === 'string' && /^https:\/\//.test(s)), 'INVALID_PRESET_SOURCE', 'preset.sources')
  need(p.userIdentity && typeof p.userIdentity.displayName === 'string' && p.userIdentity.displayName.trim() && typeof p.userIdentity.background === 'string', 'INVALID_PRESET_IDENTITY', 'preset.userIdentity')
  need(Array.isArray(p.characters) && p.characters.length > 0, 'INVALID_PRESET_CHARACTERS', 'preset.characters')
  const keys = new Set()
  p.characters.forEach(c => {
    need(c && typeof c === 'object', 'INVALID_PRESET_CHARACTER', 'preset.characters')
    validateId(c.key, 'character.key'); need(!keys.has(c.key), 'DUPLICATE_PRESET_CHARACTER', 'preset.characters'); keys.add(c.key)
    validateCharacterDefinition(c.definition)
    need(typeof c.source === 'string' && p.sources.includes(c.source), 'INVALID_PRESET_SOURCE', 'character.source')
  })
  need(Array.isArray(p.lorebook), 'INVALID_PRESET_LORE', 'preset.lorebook')
  const loreKeys = new Set()
  p.lorebook.forEach(l => {
    need(l && typeof l === 'object', 'INVALID_PRESET_LORE', 'preset.lorebook')
    validateId(l.key, 'lore.key'); need(!loreKeys.has(l.key), 'DUPLICATE_PRESET_LORE', 'preset.lorebook'); loreKeys.add(l.key)
    need(['world', 'system', 'character'].includes(l.scope), 'INVALID_PRESET_LORE', 'lore.scope')
    need(Array.isArray(l.keys) && l.keys.length > 0 && l.keys.every(k => typeof k === 'string' && k.trim()), 'INVALID_PRESET_LORE', 'lore.keys')
    need(typeof l.content === 'string' && l.content.trim(), 'INVALID_PRESET_LORE', 'lore.content')
    need(Number.isSafeInteger(l.priority) && l.priority >= 0, 'INVALID_PRESET_LORE', 'lore.priority')
    need(['keyword', 'always'].includes(l.activationRule) && ['public', 'private', 'participants'].includes(l.visibility), 'INVALID_PRESET_LORE', 'lore.activation')
    need(typeof l.sourceTag === 'string' && l.sourceTag.trim(), 'INVALID_PRESET_LORE', 'lore.sourceTag')
    need(Array.isArray(l.knownBy) && new Set(l.knownBy).size === l.knownBy.length && l.knownBy.every(k => keys.has(k)), 'INVALID_PRESET_KNOWLEDGE', 'lore.knownBy')
    need(l.scope !== 'character' || l.knownBy.length === 1, 'INVALID_PRESET_KNOWLEDGE', 'lore.owner')
    need(l.visibility !== 'private' || l.knownBy.length > 0, 'INVALID_PRESET_KNOWLEDGE', 'lore.visibility')
  })
  need(Array.isArray(p.relationships), 'INVALID_PRESET_RELATIONSHIPS', 'preset.relationships')
  const edges = new Set()
  p.relationships.forEach(r => {
    need(r && keys.has(r.fromKey) && keys.has(r.toKey) && r.fromKey !== r.toKey, 'INVALID_PRESET_RELATIONSHIP', 'preset.relationships')
    const key = JSON.stringify([r.fromKey, r.toKey].sort())
    need(!edges.has(key), 'DUPLICATE_PRESET_RELATIONSHIP', 'preset.relationships'); edges.add(key)
    need(typeof r.publicSummary === 'string' && r.publicSummary.trim(), 'INVALID_PRESET_RELATIONSHIP', 'preset.summary')
  })
  return p
}
/** Atomic pure transformation. Persistence/confirmation belongs to P2, not this function.
 * @param {import('./kanataTypes').KanataData} input
 * @param {import('./kanataTypes').WorldPreset} preset
 * @param {import('./kanataTypes').SeedOptions} options
 * @returns {import('./kanataTypes').KanataData}
 */
export function instantiateWorldPreset(input, preset, options) {
  const data = validateKanataData(input), p = validateWorldPreset(preset)
  need(options && typeof options.idFactory === 'function', 'ID_FACTORY_REQUIRED', 'options')
  need(typeof options.initializationKey === 'string' && options.initializationKey.trim(), 'INITIALIZATION_KEY_REQUIRED', 'options')
  need(Number.isSafeInteger(options.now) && options.now >= 0, 'INVALID_SEED_TIME', 'options.now')
  need(typeof options.timeZone === 'string' && options.timeZone.trim(), 'INVALID_TIMEZONE', 'options.timeZone')
  const previous = data.presetApplications.find(a => a.initializationKey === options.initializationKey)
  if (previous) {
    need(previous.presetSourceId === p.id && previous.presetVersion === p.presetVersion, 'INITIALIZATION_CONFLICT', 'presetApplication')
    return data
  }
  /** @param {string} kind @param {string[]} parts */
  const id = (kind, parts) => {
    const value = options.idFactory(kind, JSON.stringify(parts))
    validateId(value, 'idFactory.' + kind)
    return value
  }
  const worldId = id('world', [options.initializationKey]), userId = id('identity', [worldId, data.userId])
  data.worlds.push({
    id: worldId, name: p.name, rules: p.rules, revision: 1, timeZone: options.timeZone,
    createdAt: options.now, lastSimulatedAt: options.now, autonomyEnabled: false,
    proactiveEnabled: false, notificationsEnabled: false, defaultChatMode: 'daily', presetSourceId: p.id, presetVersion: p.presetVersion
  })
  data.identities.push({ id: userId, worldId, userId: data.userId, displayName: p.userIdentity.displayName, background: p.userIdentity.background, revision: 1 })
  /** @type {Map<string, string>} */
  const instanceIds = new Map()
  p.characters.forEach(c => {
    const presetKey = JSON.stringify([p.id, String(p.presetVersion), c.key])
    let card = data.cards.find(card => card.presetKey === presetKey)
    if (!card) {
      const cardId = id('card', [presetKey]), versionId = id('card-version', [cardId, '1'])
      card = { id: cardId, currentVersionId: versionId, archived: false, presetKey }
      data.cards.push(card)
      data.cardVersions.push({ id: versionId, cardId, revision: 1, definition: cloneKanataJson(c.definition),
        rawData: /** @type {import('./kanataTypes').JsonValue} */(/** @type {unknown} */(cloneKanataJson(c))), source: c.source })
    }
    need(!card.archived, 'ARCHIVED_PRESET_CARD', 'preset.character')
    const instanceId = id('instance', [worldId, c.key]); instanceIds.set(c.key, instanceId)
    data.instances.push({ id: instanceId, worldId, cardId: card.id, cardVersionId: card.currentVersionId, revision: 1,
      overrides: {}, state: { mood: '平静', energy: 1, location: '' }, autonomyEnabled: false, proactiveEnabled: false })
    data.conversations.push({ id: id('private', [worldId, instanceId]), worldId, type: 'private', title: c.definition.name,
      participantIds: [userId, instanceId], mode: 'inherit', revision: 1, lastReadAt: 0 })
  })
  /** @param {string} key */
  const instance = key => {
    const value = instanceIds.get(key); need(value, 'INVALID_PRESET_CHARACTER', 'preset.reference')
    return /** @type {string} */(value)
  }
  data.conversations.push({ id: id('group', [worldId, 'default']), worldId, type: 'group', title: p.name,
    participantIds: [userId, ...instanceIds.values()], mode: 'inherit', revision: 1, lastReadAt: 0 })
  p.lorebook.forEach(l => data.lorebookEntries.push({
    id: id('lore', [worldId, l.key]), worldId, scope: l.scope,
    ownerId: l.scope === 'character' ? instance(l.knownBy[0]) : worldId,
    keys: [...l.keys], content: l.content, priority: l.priority, activationRule: l.activationRule,
    visibility: l.visibility, knownBy: l.knownBy.map(instance), sourceTag: l.sourceTag, revision: 1
  }))
  /** Initial numeric dimensions are deltas from descriptive baseline, not invented affinity scores.
   * @param {string} fromId @param {string} toId @param {'teammate'|'teacher'} kind @param {string} summary
   */
  const relationship = (fromId, toId, kind, summary) => data.relationships.push({
    id: id('relationship', [worldId, fromId, toId]), worldId, fromId, toId, kind,
    trustBaseline: kind === 'teammate' ? 'established' : 'new', publicSummary: summary,
    dimensions: { trust: 0, intimacy: 0, understanding: 0 }, dimensionRuleVersion: 1, sourceEventIds: [], revision: 1
  })
  p.relationships.forEach(r => {
    relationship(instance(r.fromKey), instance(r.toKey), 'teammate', r.publicSummary)
    relationship(instance(r.toKey), instance(r.fromKey), 'teammate', r.publicSummary)
  })
  p.characters.forEach(c => relationship(instance(c.key), userId, 'teacher', '初次以世界身份交流，礼貌相待，信任由后续互动建立。'))
  data.presetApplications.push({ id: id('initialization', [options.initializationKey]), initializationKey: options.initializationKey,
    presetSourceId: p.id, presetVersion: p.presetVersion, worldId })
  return validateKanataData(data)
}
