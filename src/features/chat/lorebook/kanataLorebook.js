// @ts-check
import { validateKanataData, cloneKanataJson, requireKanata as need } from '../domain/kanataValidation.js'
import { resolveKanataCharacter } from '../domain/kanataManagementCore.js'
import { normalizeCharacterCard } from '../cards/characterCardImport.js'

/** @typedef {import('../domain/kanataTypes').KanataData} KanataData */
/** @typedef {import('../domain/kanataTypes').LorebookEntry} LorebookEntry */
/** A conservative UTF8-byte upper bound, not measured model token usage. @param {string} text */
export const estimateKanataContextTokens = text => new TextEncoder().encode(text).length
/** Filter knowledge first, then activation, then budget. No recursive or regex evaluation.
 * @param {KanataData} data
 * @param {{worldId:string,instanceId:string,text:string,tokenBudget:number}} request
 */
export function selectKanataLorebook(data, { worldId, instanceId, text, tokenBudget }) {
  need(Number.isSafeInteger(tokenBudget) && tokenBudget >= 0 && tokenBudget <= 32000, 'INVALID_LORE_BUDGET', 'tokenBudget')
  need(typeof text === 'string', 'INVALID_LORE_QUERY', 'text')
  const world = data.worlds.find(w => w.id === worldId), instance = data.instances.find(i => i.id === instanceId)
  need(world && !world.archived && instance?.worldId === worldId, 'LORE_WORLD_ACCESS_DENIED', 'instanceId')
  const selected = [], skippedForBudget = []
  let usedTokens = 0
  const entries = data.lorebookEntries.filter(entry => entry.worldId === worldId && entry.enabled !== false && (
    entry.knownBy.includes(instanceId) || (entry.scope === 'character' && entry.ownerId === instanceId) ||
    (entry.visibility === 'public' && entry.knownBy.length === 0 && entry.scope !== 'character')
  )).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en'))
  for (const entry of entries) {
    const query = entry.caseSensitive ? text : text.toLowerCase()
    /** @param {string[]} keys */
    const match = keys => keys.some(key => query.includes(entry.caseSensitive ? key : key.toLowerCase()))
    const activated = entry.activationRule === 'always' || (match(entry.keys) && (!entry.secondaryKeys?.length || match(entry.secondaryKeys)))
    if (!activated) continue
    const cost = estimateKanataContextTokens(entry.content) + 8
    if (usedTokens + cost > tokenBudget) { skippedForBudget.push(entry.id); continue }
    selected.push(cloneKanataJson(entry)); usedTokens += cost
  }
  return { entries: selected, usedTokens, skippedForBudget, estimate: 'utf8-byte-upper-bound-v1' }
}
/** @param {KanataData} input @param {string} instanceId */
export function renderKanataCharacter(input, instanceId) {
  const instance = input.instances.find(i => i.id === instanceId)
  need(instance, 'INSTANCE_NOT_FOUND', 'instanceId')
  const identity = input.identities.find(i => i.worldId === instance?.worldId)
  need(identity, 'WORLD_IDENTITY_REQUIRED', 'instanceId')
  const definition = resolveKanataCharacter(input, instanceId)
  /** @param {string} text */
  const replace = text => text.replace(/\{\{(user|char)\}\}|<(user|char|bot)>/g, (_token, braces, angle) => (braces || angle) === 'user'
    ? /** @type {import('../domain/kanataTypes').WorldUserIdentity} */(identity).displayName : definition.name)
  // Assets never participate in placeholder expansion or prompt content.
  const result = /** @type {import('../domain/kanataTypes').CharacterDefinition} */(Object.fromEntries(Object.entries(definition).map(([key, value]) => [key,
    ['avatarDataUrl', 'promptPriority'].includes(key) ? value : typeof value === 'string' ? replace(value) : Array.isArray(value) ? value.map(replace) : value])))
  return result
}
/** @param {KanataData} input @param {LorebookEntry} entry @param {number|null} expectedRevision */
export function saveKanataLoreEntry(input, entry, expectedRevision = null) {
  const data = validateKanataData(input), world = data.worlds.find(w => w.id === entry.worldId)
  need(world && !world.archived, 'WORLD_ARCHIVED', 'worldId')
  const previous = data.lorebookEntries.find(l => l.id === entry.id)
  need(previous ? previous.worldId === entry.worldId && previous.revision === expectedRevision : expectedRevision === null, 'LORE_EDIT_CONFLICT', 'entryId')
  const candidate = cloneKanataJson(entry)
  candidate.revision = previous ? previous.revision + 1 : 1
  if (previous) data.lorebookEntries[data.lorebookEntries.indexOf(previous)] = candidate
  else {
    const duplicate = data.lorebookEntries.some(l => l.worldId === entry.worldId && l.ownerId === entry.ownerId && l.content === entry.content)
    need(!duplicate, 'LORE_DUPLICATE_CONTENT', 'entryId')
    data.lorebookEntries.push(candidate)
  }
  return validateKanataData(data)
}
/** Attached card knowledge is private to that instance by default; raw card remains unmodified.
 * @param {KanataData} input @param {string} instanceId
 */
export function previewKanataCardLore(input, instanceId) {
  const instance = input.instances.find(i => i.id === instanceId)
  need(instance, 'INSTANCE_NOT_FOUND', 'instanceId')
  const owner = /** @type {import('../domain/kanataTypes').CharacterInstance} */(instance)
  const version = input.cardVersions.find(v => v.id === owner.cardVersionId)
  need(version, 'ORPHAN_CARD_VERSION', 'instanceId')
  const raw = /** @type {Record<string, any>} */(version?.rawData)
  if (!raw || typeof raw !== 'object' || (!raw.spec && !raw.name)) return []
  return normalizeCharacterCard(raw).lorebook.map(entry => {
    const sourceTag = 'card:' + owner.cardVersionId + ':' + entry.key
    const existing = input.lorebookEntries.find(l => l.worldId === owner.worldId && l.ownerId === instanceId && (
      l.sourceTag === sourceTag || l.content === entry.content || entry.keys.some(k => l.keys.includes(k))
    ))
    return { ...entry, worldId: owner.worldId, instanceId, sourceTag, ...(existing ? { conflictId: existing.id } : {}) }
  })
}
/** Conflict resolution is explicit skip; no hidden overwrite of user lore or source cards.
 * @param {KanataData} input @param {string} instanceId
 * @param {{skipConflicts:boolean,idFactory:(kind:string,key:string)=>string}} options
 */
export function attachKanataCardLore(input, instanceId, { skipConflicts, idFactory }) {
  const data = validateKanataData(input), candidates = previewKanataCardLore(data, instanceId)
  const owner = /** @type {import('../domain/kanataTypes').CharacterInstance} */(data.instances.find(i => i.id === instanceId))
  need(data.worlds.some(w => w.id === owner.worldId && !w.archived), 'WORLD_ARCHIVED', 'worldId')
  need(!candidates.some(e => e.conflictId) || skipConflicts === true, 'LORE_CONFLICT_REQUIRES_DECISION', 'lorebook')
  for (const candidate of candidates.filter(e => !e.conflictId)) {
    data.lorebookEntries.push({ id: idFactory('lore', JSON.stringify([instanceId, candidate.sourceTag])), worldId: owner.worldId,
      scope: 'character', ownerId: instanceId, keys: candidate.keys, content: candidate.content || '（未提供条目内容；保持停用）', priority: candidate.priority,
      activationRule: candidate.activationRule, visibility: 'private', knownBy: [instanceId], sourceTag: candidate.sourceTag, revision: 1,
      enabled: candidate.enabled, caseSensitive: candidate.caseSensitive, secondaryKeys: candidate.secondaryKeys })
  }
  return validateKanataData(data)
}
