// @ts-check
import { createEmptyKanataData } from '../../domain/kanataCore.js'
import { addKanataCharacter, importKanataCard, updateKanataCard, updateKanataCharacter, syncKanataCard } from '../../domain/kanataManagementCore.js'
import { validateId } from '../../domain/kanataValidation.js'
import { createKanataConversationRepository } from './kanataConversationRepository.js'
import { domainTable, executeOnce, found, writeOne } from './kanataDomainRows.js'
import { pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { readWorld } from './kanataWorldRepository.js'

/** @typedef {import('../../domain/kanataTypes').CharacterCard} Card */
/** @typedef {import('../../domain/kanataTypes').CharacterCardVersion} Version */
/** @typedef {import('../../domain/kanataTypes').CharacterInstance} Instance */
/** @typedef {Omit<Instance,'state'> & Instance['state']} StoredInstance */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */

const cards = /** @type {ReturnType<typeof domainTable<Card>>} */ (domainTable('character_cards', {
  id: 'id', current_version_id: 'currentVersionId', archived: 'archived:flag', preset_key: 'presetKey',
}, ['id']))
const versions = /** @type {ReturnType<typeof domainTable<Version>>} */ (domainTable('card_versions', {
  card_id: 'cardId', id: 'id', revision: 'revision', definition_json: 'definition:json',
  raw_data_json: 'rawData:json', source: 'source', imported_json: 'imported:json',
}, ['card_id', 'id']))
export const instanceTable = /** @type {ReturnType<typeof domainTable<StoredInstance>>} */ (domainTable('character_instances', {
  world_id: 'worldId', id: 'id', card_id: 'cardId', card_version_id: 'cardVersionId', revision: 'revision',
  overrides_json: 'overrides:json', mood: 'mood', energy: 'energy', location: 'location',
  autonomy_enabled: 'autonomyEnabled:flag', proactive_enabled: 'proactiveEnabled:flag',
}, ['world_id', 'id']))
const instanceProfile = `SELECT world_id,id,card_id,card_version_id,revision,overrides_json,autonomy_enabled,proactive_enabled,extensions_json
  FROM character_instances WHERE world_id=? AND id=?`
const listCards = `SELECT ${cards.stored} FROM character_cards WHERE id>? ORDER BY id LIMIT ?`
const listVersions = `SELECT ${versions.stored} FROM card_versions WHERE card_id=? AND revision>? ORDER BY revision LIMIT ?`
const latestVersion = `SELECT ${versions.stored} FROM card_versions WHERE card_id=? ORDER BY revision DESC LIMIT 1`
const listInstances = `SELECT ${instanceTable.stored} FROM character_instances WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const findImported = `SELECT card_id FROM card_versions WHERE json_extract(imported_json,'$.sourceBase64')=? LIMIT 1`
const setCurrent = 'UPDATE character_cards SET current_version_id=? WHERE id=? AND current_version_id=? AND archived=0'
const setArchived = 'UPDATE character_cards SET archived=? WHERE id=? AND current_version_id=? AND archived=?'
export const characterQueries = [cards.get, versions.get, instanceTable.get, listCards, listVersions, latestVersion, listInstances, findImported, instanceProfile]
export const characterWrites = [...cards.writeStatements, versions.writeStatements[0], ...instanceTable.writeStatements, setCurrent, setArchived]

/** @param {StoredInstance} row @returns {Instance} */
export function unpackInstance({ mood, energy, location, ...rest }) {
  return { ...rest, state: { mood, energy, location } }
}
/** @param {Instance} instance @returns {StoredInstance} */
export function packInstance({ state, ...rest }) {
  return { ...rest, mood: state.mood, energy: state.energy, location: state.location }
}

/** @param {Tx} tx @param {string} cardId */
async function loadCard(tx, cardId) {
  validateId(cardId, 'cardId')
  const card = found(await cards.read(tx, [cardId]), 'CARD_NOT_FOUND')
  return { card, version: found(await versions.read(tx, [cardId, card.currentVersionId]), 'ORPHAN_CARD_VERSION') }
}

/** @param {Tx} tx @param {string} worldId */
async function worldProjection(tx, worldId) {
  const { world, identity } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  return { ...createEmptyKanataData(identity.userId), worlds: [world], identities: [identity] }
}

/** @param {Operation} operation */
export function createKanataCharacterRepository(operation) {
  return {
    /** @param {string} afterId @param {number} limit */
    listCards: (afterId = '', limit = 50) => operation.transaction(async tx => {
      if (afterId) validateId(afterId, 'cardCursor')
      const rows = await tx.query(listCards, [afterId, pageLimit(limit) + 1])
      return { cards: rows.slice(0, limit).map(cards.decode), cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} cardId @param {number} afterRevision @param {number} limit */
    versions: (cardId, afterRevision = 0, limit = 50) => operation.transaction(async tx => {
      validateId(cardId, 'cardId')
      need(safeInteger(afterRevision), 'KANATA_CARD_CURSOR_INVALID')
      const rows = await tx.query(listVersions, [cardId, afterRevision, pageLimit(limit) + 1])
      return { versions: rows.slice(0, limit).map(versions.decode), cursor: rows.length > limit ? Number(rows[limit - 1].revision) : null }
    }),
    /** @param {string} worldId @param {string} afterId @param {number} limit */
    listInstances: (worldId, afterId = '', limit = 50) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      if (afterId) validateId(afterId, 'instanceCursor')
      const rows = await tx.query(listInstances, [worldId, afterId, pageLimit(limit) + 1])
      return { instances: rows.slice(0, limit).map(row => unpackInstance(instanceTable.decode(row))), cursor: rows.length > limit ? String(rows[limit - 1].id) : null }
    }),
    /** @param {string} worldId @param {string} id */
    getInstance: (worldId, id) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(id, 'instanceId')
      const row = await instanceTable.read(tx, [worldId, id])
      return row ? unpackInstance(row) : null
    }),
    /** @param {string} worldId @param {readonly string[]} participantIds @param {ReadonlySet<string>} hiddenState */
    conversationActors: (worldId, participantIds, hiddenState = new Set()) => operation.transaction(async tx => {
      /** @type {Instance[]} */
      const instances = []
      /** @type {Version[]} */
      const cardVersions = []
      const seen = new Set()
      for (const id of participantIds) {
        const [row] = await tx.query(hiddenState.has(id) ? instanceProfile : instanceTable.get, [worldId, id])
        if (!row) continue
        // The context formatter masks state for these IDs. SQL never projects the stored values.
        const dto = unpackInstance(instanceTable.decode(hiddenState.has(id)
          ? { ...row, mood: '', energy: 0, location: '' } : row))
        instances.push(dto)
        if (!seen.has(dto.cardVersionId)) {
          cardVersions.push(found(await versions.read(tx, [dto.cardId, dto.cardVersionId]), 'ORPHAN_CARD_VERSION'))
          seen.add(dto.cardVersionId)
        }
      }
      return { instances, cardVersions }
    }),
    /** @param {Parameters<typeof importKanataCard>[1]} parsed @param {Parameters<typeof importKanataCard>[2]} options */
    importCard: (parsed, options) => operation.transaction(async tx => {
      const data = importKanataCard(createEmptyKanataData('candidate-card-library'), parsed, options)
      const id = await executeOnce(tx, ['card:import', options.key], parsed, async () => {
        const [existing] = await tx.query(findImported, [parsed.asset.sourceBase64])
        if (existing) return String(existing.card_id)
        await cards.create(tx, data.cards[0])
        await versions.create(tx, data.cardVersions[0])
        return data.cards[0].id
      })
      return loadCard(tx, id)
    }),
    /** @param {string} cardId @param {Parameters<typeof updateKanataCard>[2]} definition @param {string} expectedVersionId @param {Parameters<typeof updateKanataCard>[4]} options */
    publish: (cardId, definition, expectedVersionId, options) => operation.transaction(async tx => {
      const id = await executeOnce(tx, ['card:publish', cardId, options.key], { definition, expectedVersionId }, async () => {
        const { card, version } = await loadCard(tx, cardId)
        const [highest] = await tx.query(latestVersion, [cardId])
        const history = [version]
        if (highest.id !== version.id) history.push(versions.decode(highest))
        const data = updateKanataCard({ ...createEmptyKanataData('candidate-card-library'), cards: [card], cardVersions: history }, cardId, definition, expectedVersionId, options)
        const next = found(data.cardVersions.at(-1), 'CARD_VERSION_CONFLICT')
        await versions.create(tx, next)
        await writeOne(tx, setCurrent, [next.id, cardId, expectedVersionId])
        return next.id
      })
      return found(await versions.read(tx, [cardId, id]), 'ORPHAN_CARD_VERSION')
    }),
    /** @param {string} cardId @param {string} expectedVersionId @param {boolean} expectedArchived @param {boolean} archived */
    archiveCard: (cardId, expectedVersionId, expectedArchived, archived) => operation.transaction(async tx => {
      validateId(cardId, 'cardId')
      validateId(expectedVersionId, 'versionId')
      need(typeof expectedArchived === 'boolean' && typeof archived === 'boolean', 'KANATA_CARD_ARCHIVE_INVALID')
      await writeOne(tx, setArchived, [Number(archived), cardId, expectedVersionId, Number(expectedArchived)])
    }),
    /** @param {string} worldId @param {string} cardId @param {Parameters<typeof addKanataCharacter>[3]} options */
    addInstance: (worldId, cardId, options) => operation.transaction(async tx => {
      const id = await executeOnce(tx, ['instance:add', worldId, options.key], { cardId }, async () => {
        const projection = await worldProjection(tx, worldId)
        const { card, version } = await loadCard(tx, cardId)
        const data = addKanataCharacter({ ...projection, cards: [card], cardVersions: [version] }, worldId, cardId, options)
        await instanceTable.create(tx, packInstance(data.instances[0]))
        const repository = createKanataConversationRepository({ ...operation, transaction: action => action(tx) })
        await repository.create(data.conversations[0])
        return data.instances[0].id
      })
      return unpackInstance(found(await instanceTable.read(tx, [worldId, id]), 'INSTANCE_NOT_FOUND'))
    }),
    /** @param {string} worldId @param {string} instanceId @param {number} expectedRevision @param {Parameters<typeof updateKanataCharacter>[2]} overrides */
    updateInstance: (worldId, instanceId, expectedRevision, overrides) => operation.transaction(async tx => {
      const projection = await worldProjection(tx, worldId)
      const instance = unpackInstance(found(await instanceTable.read(tx, [worldId, instanceId]), 'INSTANCE_NOT_FOUND'))
      need(instance.revision === expectedRevision, 'KANATA_INSTANCE_REVISION_CONFLICT')
      const { card, version } = await loadCard(tx, instance.cardId)
      const history = [version]
      if (instance.cardVersionId !== version.id) history.push(found(await versions.read(tx, [card.id, instance.cardVersionId]), 'ORPHAN_CARD_VERSION'))
      const [next] = updateKanataCharacter({ ...projection, instances: [instance], cards: [card], cardVersions: history }, instanceId, overrides).instances
      await instanceTable.replace(tx, packInstance(next), [worldId, instanceId], expectedRevision)
      return next
    }),
    /** @param {string} cardId @param {Parameters<typeof syncKanataCard>[2]} selected */
    sync: (cardId, selected) => operation.transaction(async tx => {
      need(selected.length > 0 && new Set(selected.map(item => item.instanceId)).size === selected.length, 'CARD_SYNC_SELECTION_REQUIRED')
      const { card, version } = await loadCard(tx, cardId)
      const result = []
      for (const item of selected) {
        const projection = await worldProjection(tx, item.worldId)
        const instance = unpackInstance(found(await instanceTable.read(tx, [item.worldId, item.instanceId]), 'INSTANCE_NOT_FOUND'))
        const old = found(await versions.read(tx, [cardId, instance.cardVersionId]), 'ORPHAN_CARD_VERSION')
        need(old.id !== version.id, 'CARD_SYNC_SELECTION_STALE')
        const [next] = syncKanataCard({ ...projection, cards: [card], cardVersions: [version, old], instances: [instance] }, cardId, [item]).instances
        await instanceTable.replace(tx, packInstance(next), [item.worldId, item.instanceId], item.instanceRevision)
        result.push(next)
      }
      return result
    }),
  }
}
