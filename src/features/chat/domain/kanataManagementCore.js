// @ts-check
import { cloneKanataJson, validateKanataData, validateCharacterDefinition, requireKanata as need } from './kanataValidation.js'
import { normalizeCharacterCard, KANATA_CARD_SPEECH_EXTENSION } from '../cards/characterCardImport.js'

/** @typedef {import('./kanataTypes').KanataData} KanataData */
/** @typedef {import('./kanataTypes').CharacterDefinition} Definition */
/** @typedef {{key:string,now:number,timeZone:string,idFactory:(kind:string,key:string)=>string}} CreationOptions */
/** @param {KanataData} input @param {(data:KanataData)=>void} apply */
const change = (input, apply) => { const data = validateKanataData(input); apply(data); return validateKanataData(data) }
/** @param {KanataData} data @param {string} id */
const worldIn = (data, id) => {
  const world = data.worlds.find(w => w.id === id)
  need(world, 'WORLD_NOT_FOUND', 'worldId')
  return /** @type {import('./kanataTypes').World} */(world)
}
/** @param {KanataData} data @param {string} id */
const activeWorld = (data, id) => { const world = worldIn(data, id); need(!world.archived, 'WORLD_ARCHIVED', 'worldId'); return world }
/** @param {CreationOptions} options @param {string} kind @param {string} suffix */
const newId = (options, kind, suffix) => {
  need(options && typeof options.idFactory === 'function' && typeof options.key === 'string' && options.key.trim(), 'ID_FACTORY_REQUIRED', 'creation')
  return options.idFactory(kind, JSON.stringify([options.key, suffix]))
}
/** Create only a fresh conversation: no history or permissions are copied between participants.
 * Membership editing of an existing historical group is deliberately a separate policy.
 * @param {KanataData} input @param {string} worldId
 * @param {{title:string,instanceIds:string[]}} fields @param {CreationOptions} options */
export const createKanataGroup = (input,worldId,fields,options) => change(input,data=>{
  activeWorld(data,worldId)
  const value=cloneKanataJson(fields)
  need(value&&typeof value.title==='string'&&value.title.trim().length>0&&value.title.length<=200,'INVALID_GROUP_TITLE','group.title')
  need(Array.isArray(value.instanceIds)&&value.instanceIds.length>=2&&new Set(value.instanceIds).size===value.instanceIds.length,'INVALID_GROUP_PARTICIPANTS','group.instanceIds')
  need(value.instanceIds.every(id=>data.instances.some(i=>i.id===id&&i.worldId===worldId)),'GROUP_PARTICIPANT_SCOPE','group.instanceIds')
  const identity=data.identities.find(i=>i.worldId===worldId)
  need(identity,'WORLD_IDENTITY_REQUIRED','group.worldId')
  data.conversations.push({id:newId(options,'group',worldId),worldId,type:'group',title:value.title.trim(),participantIds:[/** @type {NonNullable<typeof identity>} */(identity).id,...value.instanceIds],mode:'inherit',revision:1,lastReadAt:0})
})
/** @param {KanataData} data @param {CreationOptions} options @param {{name:string,rules:string,displayName:string,background:string}} fields */
function appendWorld(data, options, fields) {
  const id = newId(options, 'world', 'world')
  data.worlds.push({ id, name: fields.name.trim(), rules: fields.rules, revision: 1, timeZone: options.timeZone, createdAt: options.now, lastSimulatedAt: options.now,
    autonomyEnabled: false, proactiveEnabled: false, notificationsEnabled: false, defaultChatMode: 'daily', archived: false })
  data.identities.push({ id: newId(options, 'identity', id), worldId: id, userId: data.userId, displayName: fields.displayName.trim(), background: fields.background, revision: 1 })
  return id
}
/** @param {KanataData} input @param {{name:string,rules:string,displayName:string,background:string}} fields @param {CreationOptions} options */
export const createKanataWorld = (input, fields, options) => change(input, data => { appendWorld(data, options, fields) })
/** @param {KanataData} input @param {string} worldId @param {string} name */
export const renameKanataWorld = (input, worldId, name) => change(input, data => { const world = worldIn(data, worldId); world.name = name.trim(); world.revision++ })
/** Archive is reversible and disables automatic work; it never deletes history or turns it back on.
 * @param {KanataData} input @param {string} worldId @param {boolean} archived
 */
export const archiveKanataWorld = (input, worldId, archived) => change(input, data => {
  const world = worldIn(data, worldId); world.archived = archived; world.revision++
  if (archived) {
    world.autonomyEnabled = false; world.proactiveEnabled = false; world.notificationsEnabled = false
    data.instances.filter(i => i.worldId === worldId).forEach(i => { i.autonomyEnabled = false; i.proactiveEnabled = false; i.revision++ })
  }
})
/** @param {KanataData} input @param {string} worldId @param {{displayName:string,background:string}} fields */
export const updateKanataIdentity = (input, worldId, fields) => change(input, data => {
  activeWorld(data, worldId)
  const identity = data.identities.find(i => i.worldId === worldId)
  if (identity) { identity.displayName = fields.displayName.trim(); identity.background = fields.background; identity.revision++ }
})
/** Independent instance/private conversation; no experience or grants are copied from another world.
 * @param {KanataData} input @param {string} worldId @param {string} cardId @param {CreationOptions} options
 */
export const addKanataCharacter = (input, worldId, cardId, options) => change(input, data => {
  activeWorld(data, worldId)
  const card = data.cards.find(c => c.id === cardId)
  need(card && !card.archived, 'CARD_UNAVAILABLE', 'cardId')
  const current = /** @type {import('./kanataTypes').CharacterCard} */(card)
  const version = data.cardVersions.find(v => v.id === current.currentVersionId)
  const instanceId = newId(options, 'instance', worldId + ':' + cardId)
  data.instances.push({ id: instanceId, worldId, cardId, cardVersionId: current.currentVersionId, revision: 1, overrides: {},
    state: { mood: '平静', energy: 1, location: '' }, autonomyEnabled: false, proactiveEnabled: false })
  data.conversations.push({ id: newId(options, 'private', instanceId), worldId, type: 'private', title: version?.definition.name || '角色私聊',
    participantIds: [/** @type {import('./kanataTypes').WorldUserIdentity} */(data.identities.find(i => i.worldId === worldId)).id, instanceId], mode: 'inherit', revision: 1, lastReadAt: 0 })
})
/** Copy settings and static knowledge only. Source histories, grants, moods and dynamic relations stay isolated.
 * @param {KanataData} input @param {string} sourceId @param {string} name @param {CreationOptions} options
 */
export const copyKanataWorld = (input, sourceId, name, options) => change(input, data => {
  const source = worldIn(data, sourceId), identity = /** @type {import('./kanataTypes').WorldUserIdentity} */(data.identities.find(i => i.worldId === sourceId))
  const worldId = appendWorld(data, options, { name, rules: source.rules, displayName: identity.displayName, background: identity.background })
  const map = new Map([[sourceId, worldId], [identity.id, /** @type {import('./kanataTypes').WorldUserIdentity} */(data.identities.find(i => i.worldId === worldId)).id]])
  for (const instance of data.instances.filter(i => i.worldId === sourceId)) {
    const id = newId(options, 'instance', instance.id); map.set(instance.id, id)
    data.instances.push({ ...cloneKanataJson(instance), id, worldId, revision: 1, state: { mood: '平静', energy: 1, location: '' }, autonomyEnabled: false, proactiveEnabled: false })
  }
  for (const conversation of data.conversations.filter(c => c.worldId === sourceId && c.type !== 'character')) {
    data.conversations.push({ ...cloneKanataJson(conversation), id: newId(options, conversation.type, conversation.id), worldId, participantIds: conversation.participantIds.map(id => /** @type {string} */(map.get(id))), revision: 1, lastReadAt: 0 })
  }
  for (const entry of data.lorebookEntries.filter(l => l.worldId === sourceId)) {
    data.lorebookEntries.push({ ...cloneKanataJson(entry), id: newId(options, 'lore', entry.id), worldId, ownerId: /** @type {string} */(map.get(entry.ownerId)), knownBy: entry.knownBy.map(id => /** @type {string} */(map.get(id))), revision: 1 })
  }
  for (const edge of data.relationships.filter(r => r.worldId === sourceId && r.sourceEventIds.length === 0 && r.kind === 'teammate')) {
    data.relationships.push({ ...cloneKanataJson(edge), id: newId(options, 'relationship', edge.id), worldId, fromId: /** @type {string} */(map.get(edge.fromId)), toId: /** @type {string} */(map.get(edge.toId)),
      dimensions: { trust: 0, intimacy: 0, understanding: 0 }, sourceEventIds: [], revision: 1 })
  }
})
/** @param {KanataData} input @param {import('../cards/characterCardTypes').ParsedCharacterCard} parsed @param {CreationOptions} options */
export const importKanataCard = (input, parsed, options) => change(input, data => {
  const canonical = normalizeCharacterCard(/** @type {Record<string,any>} */(parsed.rawData))
  if (data.cardVersions.some(v => v.imported?.sourceBase64 === parsed.asset.sourceBase64)) return
  const id = newId(options, 'card', 'import'), versionId = newId(options, 'card-version', id)
  // The parsed UI preview is not trusted as a privilege-bearing runtime object.
  validateCharacterDefinition(parsed.definition)
  const preview = cloneKanataJson(parsed.definition); delete preview.avatarDataUrl
  need(JSON.stringify(canonical.definition) === JSON.stringify(preview), 'CARD_PREVIEW_CHANGED', 'card')
  data.cards.push({ id, currentVersionId: versionId, archived: false })
  data.cardVersions.push({ id: versionId, cardId: id, revision: 1, definition: cloneKanataJson(parsed.definition), rawData: cloneKanataJson(parsed.rawData), imported: cloneKanataJson(parsed.asset), source: 'local-import:' + parsed.asset.fileName })
})
/** @param {KanataData} input @param {string} cardId @param {boolean} archived */
export const archiveKanataCard = (input, cardId, archived) => change(input, data => {
  const card = data.cards.find(c => c.id === cardId); need(card, 'CARD_NOT_FOUND', 'cardId')
  const target = /** @type {import('./kanataTypes').CharacterCard} */(card)
  target.archived = archived
})
/** @param {KanataData} input @param {string} instanceId @returns {Definition} */
export function resolveKanataCharacter(input, instanceId) {
  const instance = input.instances.find(i => i.id === instanceId)
  need(instance, 'INSTANCE_NOT_FOUND', 'instanceId')
  const owner = /** @type {import('./kanataTypes').CharacterInstance} */(instance)
  const version = input.cardVersions.find(v => v.id === owner.cardVersionId)
  need(version?.cardId === owner.cardId, 'ORPHAN_CARD_VERSION', 'instanceId')
  const definition = { ...cloneKanataJson(/** @type {import('./kanataTypes').CharacterCardVersion} */(version).definition), ...cloneKanataJson(owner.overrides) }
  validateCharacterDefinition(definition)
  return definition
}
/** @param {KanataData} input @param {string} instanceId @param {Partial<Definition>} overrides */
export const updateKanataCharacter = (input, instanceId, overrides) => change(input, data => {
  const instance = data.instances.find(i => i.id === instanceId); need(instance, 'INSTANCE_NOT_FOUND', 'instanceId')
  const target = /** @type {import('./kanataTypes').CharacterInstance} */(instance)
  activeWorld(data, target.worldId)
  const allowed = new Set(Object.keys(resolveKanataCharacter(data, instanceId)).concat('avatarDataUrl'))
  need(Object.keys(overrides).every(k => allowed.has(k)), 'UNSUPPORTED_CHARACTER_OVERRIDE', 'overrides')
  target.overrides = cloneKanataJson(overrides); target.revision++
})
/** @param {KanataData} input @param {string} cardId @param {Definition} definition @param {string} expectedVersionId @param {CreationOptions} options */
export const updateKanataCard = (input, cardId, definition, expectedVersionId, options) => change(input, data => {
  const card = data.cards.find(c => c.id === cardId); need(card && !card.archived, 'CARD_UNAVAILABLE', 'cardId')
  const target = /** @type {import('./kanataTypes').CharacterCard} */(card)
  need(target.currentVersionId === expectedVersionId, 'CARD_VERSION_CONFLICT', 'cardId')
  validateCharacterDefinition(definition)
  const previous = /** @type {import('./kanataTypes').CharacterCardVersion} */(data.cardVersions.find(v => v.id === expectedVersionId))
  const original = cloneKanataJson(previous.rawData)
  const raw = /** @type {Record<string, any>} */(original && typeof original === 'object' && !Array.isArray(original) ? original : { kanataOriginal: original })
  /** @param {Record<string, any>} target */
  const updateWire = target => {
    Object.assign(target, { name: definition.name, description: definition.summary, personality: definition.anchors.join('\n') })
    if (definition.scenario !== undefined) target.scenario = definition.scenario
    if (definition.exampleDialogue !== undefined) target.mes_example = definition.exampleDialogue
    if (definition.greetings !== undefined) { target.first_mes = definition.greetings[0] || ''; target.alternate_greetings = definition.greetings.slice(1) }
    if (definition.groupGreetings !== undefined && raw.spec === 'chara_card_v3') target.group_only_greetings = definition.groupGreetings
    const extensions = target.extensions && typeof target.extensions === 'object' && !Array.isArray(target.extensions) ? target.extensions : {}
    need(extensions[KANATA_CARD_SPEECH_EXTENSION] === undefined || typeof extensions[KANATA_CARD_SPEECH_EXTENSION] === 'string', 'CARD_EXTENSION_CONFLICT', 'card.extensions')
    target.extensions = { ...extensions, [KANATA_CARD_SPEECH_EXTENSION]: definition.speechStyle }
  }
  if (raw?.spec === 'chara_card_v2' || raw?.spec === 'chara_card_v3') updateWire(raw.data)
  else if (typeof raw?.name === 'string') updateWire(raw)
  else raw.definition = cloneKanataJson(definition)
  const id = newId(options, 'card-version', cardId)
  data.cardVersions.push({ ...cloneKanataJson(previous), id, revision: Math.max(...data.cardVersions.filter(v => v.cardId === cardId).map(v => v.revision)) + 1,
    definition: cloneKanataJson(definition), rawData: raw })
  target.currentVersionId = id
})
/** @param {KanataData} input @param {string} cardId */
export function previewKanataCardSync(input, cardId) {
  const card = input.cards.find(c => c.id === cardId); need(card, 'CARD_NOT_FOUND', 'cardId')
  const target = /** @type {import('./kanataTypes').CharacterCard} */(card)
  const version = /** @type {import('./kanataTypes').CharacterCardVersion} */(input.cardVersions.find(v => v.id === target.currentVersionId))
  return input.instances.filter(i => i.cardId === cardId && i.cardVersionId !== target.currentVersionId).map(instance => {
    const old = /** @type {import('./kanataTypes').CharacterCardVersion} */(input.cardVersions.find(v => v.id === instance.cardVersionId))
    const fields = /** @type {(keyof Definition)[]} */(Object.keys(version.definition)).filter(key => JSON.stringify(old.definition[key]) !== JSON.stringify(version.definition[key]))
    return { instanceId: instance.id, worldId: instance.worldId, fromVersionId: instance.cardVersionId, toVersionId: version.id,
      fields, retainedOverrides: Object.keys(instance.overrides), instanceRevision: instance.revision }
  })
}
/** Apply only the explicit preview selection; local overrides and experiences are never overwritten.
 * @param {KanataData} input @param {string} cardId @param {ReturnType<typeof previewKanataCardSync>} selected
 */
export const syncKanataCard = (input, cardId, selected) => change(input, data => {
  need(Array.isArray(selected) && selected.length > 0 && new Set(selected.map(x => x.instanceId)).size === selected.length, 'CARD_SYNC_SELECTION_REQUIRED', 'selection')
  const current = previewKanataCardSync(data, cardId)
  for (const item of selected) {
    const available = current.find(x => x.instanceId === item.instanceId)
    need(available && available.fromVersionId === item.fromVersionId && available.toVersionId === item.toVersionId && available.instanceRevision === item.instanceRevision, 'CARD_SYNC_CONFLICT', 'selection')
    const instance = /** @type {import('./kanataTypes').CharacterInstance} */(data.instances.find(i => i.id === item.instanceId))
    activeWorld(data, instance.worldId); instance.cardVersionId = item.toVersionId; instance.revision++
  }
})
