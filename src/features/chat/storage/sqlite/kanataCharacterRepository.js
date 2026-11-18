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
const promptProfile = `SELECT world_id,id,card_id,card_version_id,revision,
  json_remove(overrides_json,'$.avatarDataUrl') AS overrides_json,autonomy_enabled,proactive_enabled,'{}' AS extensions_json
  FROM character_instances WHERE world_id=? AND id=?`
const promptState = promptProfile.replace('FROM character_instances', ',mood,energy,location FROM character_instances')
const promptDefinition = "SELECT id,card_id,json_remove(definition_json,'$.avatarDataUrl') AS definition FROM card_versions WHERE card_id=? AND id=?"
const cardSummaries = `SELECT c.id,c.archived,c.current_version_id,json_extract(v.definition_json,'$.name') AS name
  FROM character_cards c JOIN card_versions v ON v.card_id=c.id AND v.id=c.current_version_id
  WHERE c.id>? ORDER BY c.id LIMIT ?`
const versionHeaders = 'SELECT id,revision,source FROM card_versions WHERE card_id=? AND revision>? ORDER BY revision LIMIT ?'
const versionDefinition = 'SELECT id,revision,definition_json FROM card_versions WHERE card_id=? AND id=?'
const listCards = `SELECT ${cards.stored} FROM character_cards WHERE id>? ORDER BY id LIMIT ?`
const listVersions = `SELECT ${versions.stored} FROM card_versions WHERE card_id=? AND revision>? ORDER BY revision LIMIT ?`
const latestVersion = `SELECT ${versions.stored} FROM card_versions WHERE card_id=? ORDER BY revision DESC LIMIT 1`
const listInstances = `SELECT ${instanceTable.stored} FROM character_instances WHERE world_id=? AND id>? ORDER BY id LIMIT ?`
const findImported = `SELECT card_id FROM card_versions WHERE json_extract(imported_json,'$.sourceBase64')=? LIMIT 1`
const findImportedByLen = `SELECT card_id,id FROM card_versions
  WHERE json_type(imported_json,'$.sourceBase64')='text'
    AND length(json_extract(imported_json,'$.sourceBase64'))=? AND id>? ORDER BY id LIMIT ?`
const sourceBase64Chunk = `SELECT substr(json_extract(imported_json,'$.sourceBase64'),?,?) AS part FROM card_versions WHERE card_id=? AND id=?`
const versionSizes = 'SELECT length(definition_json) AS def_len,length(raw_data_json) AS raw_len,length(imported_json) AS imp_len FROM card_versions WHERE card_id=? AND id=?'
const defChunk = 'SELECT substr(definition_json,?,?) AS part FROM card_versions WHERE card_id=? AND id=?'
const rawChunk = 'SELECT substr(raw_data_json,?,?) AS part FROM card_versions WHERE card_id=? AND id=?'
const impChunk = 'SELECT substr(imported_json,?,?) AS part FROM card_versions WHERE card_id=? AND id=?'
const VERSION_WRITE_CHUNK = 250000
const VERSION_READ_CHUNK = 196608
const DEF_CHUNKS = 20
const RAW_CHUNKS = 12
const IMP_CHUNKS = 46
const concatPlaceholders = (/** @type {number} */ count) => Array.from({ length: count }, () => '?').join('||')
const insertLargeVersion = `INSERT INTO card_versions(card_id,id,revision,source,definition_json,raw_data_json,imported_json)
  VALUES(?,?,?,?,(${concatPlaceholders(DEF_CHUNKS)}),(${concatPlaceholders(RAW_CHUNKS)}),(${concatPlaceholders(IMP_CHUNKS)}))`
const versionIdsByRevision = 'SELECT id,revision FROM card_versions WHERE card_id=? AND revision>? ORDER BY revision LIMIT ?'
const latestVersionId = 'SELECT id FROM card_versions WHERE card_id=? ORDER BY revision DESC LIMIT 1'
const setCurrent = 'UPDATE character_cards SET current_version_id=? WHERE id=? AND current_version_id=? AND archived=0'
const setArchived = 'UPDATE character_cards SET archived=? WHERE id=? AND current_version_id=? AND archived=?'
const syncCandidates = `SELECT i.id,i.world_id,w.name AS world_title,i.card_version_id,i.revision,i.overrides_json
  FROM character_instances i JOIN worlds w ON w.id=i.world_id
  WHERE i.card_id=? AND coalesce(w.archived,0)=0 AND i.card_version_id<>? AND i.id>? ORDER BY i.id LIMIT ?`
export const characterQueries = [cardSummaries, versionHeaders, versionDefinition, cards.get, versions.get, instanceTable.get, listCards, listVersions, latestVersion, listInstances, findImported, findImportedByLen, sourceBase64Chunk, versionSizes, defChunk, rawChunk, impChunk, versionIdsByRevision, latestVersionId, instanceProfile, promptProfile, promptState, promptDefinition, syncCandidates]
export const characterWrites = [...cards.writeStatements, versions.writeStatements[0], insertLargeVersion, ...instanceTable.writeStatements, setCurrent, setArchived]

/** @param {StoredInstance} row @returns {Instance} */
export function unpackInstance({ mood, energy, location, ...rest }) {
  return { ...rest, state: { mood, energy, location } }
}
/** @param {Instance} instance @returns {StoredInstance} */
export function packInstance({ state, ...rest }) {
  return { ...rest, mood: state.mood, energy: state.energy, location: state.location }
}

/** @param {string|null} text @param {number} slots */
function sliceVersionField(text, slots) {
  if (text === null) return Array.from({ length: slots }, (_, idx) => idx === 0 ? null : '')
  need(text.length <= slots * VERSION_WRITE_CHUNK, 'CHARACTER_CARD_TOO_LARGE')
  return Array.from({ length: slots }, (_, idx) => text.slice(idx * VERSION_WRITE_CHUNK, (idx + 1) * VERSION_WRITE_CHUNK))
}

/** @param {Tx} tx @param {Version} version */
async function createVersionRow(tx, version) {
  const defText = JSON.stringify(version.definition)
  const rawText = version.rawData === undefined ? null : JSON.stringify(version.rawData)
  const impText = version.imported === undefined ? null : JSON.stringify(version.imported)
  if (defText.length <= VERSION_WRITE_CHUNK && (rawText === null || rawText.length <= VERSION_WRITE_CHUNK)
    && (impText === null || impText.length <= VERSION_WRITE_CHUNK)) {
    await versions.create(tx, version)
    return
  }
  await tx.execute(insertLargeVersion, [
    version.cardId, version.id, version.revision, version.source,
    ...sliceVersionField(defText, DEF_CHUNKS),
    ...sliceVersionField(rawText, RAW_CHUNKS),
    ...sliceVersionField(impText, IMP_CHUNKS),
  ])
}

/** @param {Tx} tx @param {string} sql @param {string} cardId @param {string} versionId @param {number|null} total */
async function readVersionColumn(tx, sql, cardId, versionId, total) {
  if (total === null) return undefined
  let out = ''
  for (let start = 1; start <= total; start += VERSION_READ_CHUNK) {
    const [row] = await tx.query(sql, [start, VERSION_READ_CHUNK, cardId, versionId])
    if (row?.part != null) out += String(row.part)
  }
  return out
}

/** @param {Tx} tx @param {string} cardId @param {string} versionId */
async function readVersionSafe(tx, cardId, versionId) {
  const [sizeRow] = await tx.query(versionSizes, [cardId, versionId])
  if (!sizeRow) return null
  const defLen = Number(sizeRow.def_len)
  const rawLen = sizeRow.raw_len === null ? null : Number(sizeRow.raw_len)
  const impLen = sizeRow.imp_len === null ? null : Number(sizeRow.imp_len)
  if (defLen <= VERSION_READ_CHUNK && (rawLen === null || rawLen <= VERSION_READ_CHUNK)
    && (impLen === null || impLen <= VERSION_READ_CHUNK)) {
    return versions.read(tx, [cardId, versionId])
  }
  const defStr = /** @type {string} */ (await readVersionColumn(tx, defChunk, cardId, versionId, defLen))
  const rawStr = await readVersionColumn(tx, rawChunk, cardId, versionId, rawLen)
  const impStr = await readVersionColumn(tx, impChunk, cardId, versionId, impLen)
  let source = 'user-authored', revision = 1
  for (let afterRev = 0; ;) {
    const headers = await tx.query(versionHeaders, [cardId, afterRev, 50])
    const match = headers.find(h => String(h.id) === versionId)
    if (match) {
      source = String(match.source)
      revision = Number(match.revision)
      break
    }
    if (headers.length < 50) throw Object.assign(new Error('ORPHAN_CARD_VERSION'), { code: 'ORPHAN_CARD_VERSION' })
    afterRev = Number(headers[headers.length - 1].revision)
  }
  return /** @type {Version} */ ({
    cardId, id: versionId, revision, source,
    definition: JSON.parse(defStr),
    ...(rawStr !== undefined && { rawData: JSON.parse(rawStr) }),
    ...(impStr !== undefined && { imported: JSON.parse(impStr) }),
  })
}

/** @param {Tx} tx @param {string} sourceBase64 */
async function findImportedCardId(tx, sourceBase64) {
  if (sourceBase64.length <= VERSION_WRITE_CHUNK) {
    const [existing] = await tx.query(findImported, [sourceBase64])
    return existing ? String(existing.card_id) : null
  }
  let afterId = ''
  for (;;) {
    const candidates = await tx.query(findImportedByLen, [sourceBase64.length, afterId, 50])
    for (const row of candidates) {
      const cardId = String(row.card_id), id = String(row.id)
      let matched = true
      for (let start = 1; start <= sourceBase64.length; start += VERSION_READ_CHUNK) {
        const expected = sourceBase64.slice(start - 1, start - 1 + VERSION_READ_CHUNK)
        const [chunk] = await tx.query(sourceBase64Chunk, [start, expected.length, cardId, id])
        if (!chunk || String(chunk.part) !== expected) { matched = false; break }
      }
      if (matched) return cardId
    }
    if (candidates.length < 50) break
    afterId = String(candidates[candidates.length - 1].id)
  }
  return null
}

/** @param {Tx} tx @param {string} cardId */
async function loadCard(tx, cardId) {
  validateId(cardId, 'cardId')
  const card = found(await cards.read(tx, [cardId]), 'CARD_NOT_FOUND')
  return { card, version: found(await readVersionSafe(tx, cardId, card.currentVersionId), 'ORPHAN_CARD_VERSION') }
}

/** @param {Tx} tx @param {string} worldId */
async function worldProjection(tx, worldId) {
  const { world, identity } = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
  return { ...createEmptyKanataData(identity.userId), worlds: [world], identities: [identity] }
}

/** @param {Operation} operation */
export function createKanataCharacterRepository(operation) {
  return {
    /** @param {string} after */
    summaries: (after = '') => operation.transaction(async tx => {
      if (after) validateId(after, 'cardCursor')
      const rows = await tx.query(cardSummaries, [after, 51])
      const entries = rows.slice(0, 50).map(row => ({
        id: String(row.id), name: String(row.name), archived: row.archived === 1, currentVersionId: String(row.current_version_id),
      }))
      return { entries, cursor: rows.length > 50 ? entries[49].id : null }
    }),
    /** @param {string} cardId @param {string} [versionId] */
    definition: (cardId, versionId) => operation.transaction(async tx => {
      validateId(cardId, 'cardId')
      const card = found(await cards.read(tx, [cardId]), 'CARD_NOT_FOUND')
      const id = versionId ?? card.currentVersionId
      validateId(id, 'versionId')
      const version = found(await readVersionSafe(tx, cardId, id), 'CARD_VERSION_NOT_FOUND')
      return { cardId, id, currentVersionId: card.currentVersionId, archived: card.archived, revision: version.revision,
        definition: version.definition }
    }),
    /** @param {string} cardId @param {number} after */
    versionHeaders: (cardId, after = 0) => operation.transaction(async tx => {
      validateId(cardId, 'cardId')
      need(safeInteger(after), 'KANATA_CARD_CURSOR_INVALID')
      const rows = await tx.query(versionHeaders, [cardId, after, 51])
      const entries = rows.slice(0, 50).map(row => ({ id: String(row.id), revision: Number(row.revision), source: String(row.source) }))
      return { entries, cursor: rows.length > 50 ? entries[49].revision : null }
    }),
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
      const rows = await tx.query(versionIdsByRevision, [cardId, afterRevision, pageLimit(limit) + 1])
      /** @type {Version[]} */
      const decoded = []
      for (const row of rows.slice(0, limit)) {
        decoded.push(found(await readVersionSafe(tx, cardId, String(row.id)), 'ORPHAN_CARD_VERSION'))
      }
      return { versions: decoded, cursor: rows.length > limit ? Number(rows[limit - 1].revision) : null }
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
    /** @param {string} worldId @param {string} id */
    readInstanceDetail: (worldId, id) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(id, 'instanceId')
      const row = await instanceTable.read(tx, [worldId, id])
      if (!row) return null
      const instance = unpackInstance(row)
      const ver = found(await readVersionSafe(tx, instance.cardId, instance.cardVersionId), 'ORPHAN_CARD_VERSION')
      return { instance, baseDefinition: ver.definition, resolved: { ...ver.definition, ...instance.overrides } }
    }),
    /** @param {string} worldId @param {string} id @param {boolean} hidden */
    promptActor: (worldId, id, hidden) => operation.transaction(async tx => {
      validateId(worldId, 'worldId')
      validateId(id, 'instanceId')
      const [row] = await tx.query(hidden ? promptProfile : promptState, [worldId, id])
      const stored = found(row, 'SPEAKER_ACCESS_DENIED')
      const instance = unpackInstance(instanceTable.decode(hidden ? { ...stored, mood: '', energy: 0, location: '' } : stored))
      const [version] = await tx.query(promptDefinition, [instance.cardId, instance.cardVersionId])
      const { definition } = found(version, 'ORPHAN_CARD_VERSION')
      return { instances: [instance], cardVersions: [{
        id: instance.cardVersionId, cardId: instance.cardId, definition: /** @type {Version['definition']} */ (JSON.parse(String(definition))),
      }] }
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
          cardVersions.push(found(await readVersionSafe(tx, dto.cardId, dto.cardVersionId), 'ORPHAN_CARD_VERSION'))
          seen.add(dto.cardVersionId)
        }
      }
      return { instances, cardVersions }
    }),
    /** @param {Parameters<typeof importKanataCard>[1]} parsed @param {Parameters<typeof importKanataCard>[2]} options */
    importCard: (parsed, options) => operation.transaction(async tx => {
      const data = importKanataCard(createEmptyKanataData('candidate-card-library'), parsed, options)
      const id = await executeOnce(tx, ['card:import', options.key], parsed, async () => {
        const existingId = await findImportedCardId(tx, parsed.asset.sourceBase64)
        if (existingId) return existingId
        await cards.create(tx, data.cards[0])
        await createVersionRow(tx, data.cardVersions[0])
        return data.cards[0].id
      })
      return loadCard(tx, id)
    }),
    /** @param {string} cardId @param {Parameters<typeof updateKanataCard>[2]} definition @param {string} expectedVersionId @param {Parameters<typeof updateKanataCard>[4]} options */
    publish: (cardId, definition, expectedVersionId, options) => operation.transaction(async tx => {
      const id = await executeOnce(tx, ['card:publish', cardId, options.key], { definition, expectedVersionId }, async () => {
        const { card, version } = await loadCard(tx, cardId)
        const [highest] = await tx.query(latestVersionId, [cardId])
        const history = [version]
        if (String(highest.id) !== version.id) history.push(found(await readVersionSafe(tx, cardId, String(highest.id)), 'ORPHAN_CARD_VERSION'))
        const data = updateKanataCard({ ...createEmptyKanataData('candidate-card-library'), cards: [card], cardVersions: history }, cardId, definition, expectedVersionId, options)
        const next = found(data.cardVersions.at(-1), 'CARD_VERSION_CONFLICT')
        await createVersionRow(tx, next)
        await writeOne(tx, setCurrent, [next.id, cardId, expectedVersionId])
        return next.id
      })
      return found(await readVersionSafe(tx, cardId, id), 'ORPHAN_CARD_VERSION')
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
      if (instance.cardVersionId !== version.id) history.push(found(await readVersionSafe(tx, card.id, instance.cardVersionId), 'ORPHAN_CARD_VERSION'))
      const [next] = updateKanataCharacter({ ...projection, instances: [instance], cards: [card], cardVersions: history }, instanceId, overrides).instances
      await instanceTable.replace(tx, packInstance(next), [worldId, instanceId], expectedRevision)
      return next
    }),
    /** @param {string} cardId @param {string} [afterInstanceId] @param {number} [limit] */
    previewSync: (cardId, afterInstanceId = '', limit = 50) => operation.transaction(async tx => {
      validateId(cardId, 'cardId')
      if (afterInstanceId) validateId(afterInstanceId, 'instanceCursor')
      const { version } = await loadCard(tx, cardId)
      const rows = await tx.query(syncCandidates, [cardId, version.id, afterInstanceId, pageLimit(limit) + 1])
      const keys = /** @type {(keyof Version['definition'])[]} */ (Object.keys(version.definition))
      /** @type {Map<string, Version['definition']>} */
      const oldDefs = new Map()
      const entries = []
      for (const row of rows.slice(0, limit)) {
        const oldVerId = String(row.card_version_id)
        let oldDef = oldDefs.get(oldVerId)
        if (!oldDef) {
          oldDef = found(await readVersionSafe(tx, cardId, oldVerId), 'ORPHAN_CARD_VERSION').definition
          oldDefs.set(oldVerId, oldDef)
        }
        const overrides = /** @type {Record<string, unknown>} */ (JSON.parse(String(row.overrides_json)))
        const fields = keys.filter(key => JSON.stringify(oldDef[key]) !== JSON.stringify(version.definition[key]))
        entries.push({
          instanceId: String(row.id), worldId: String(row.world_id), worldTitle: String(row.world_title),
          fromVersionId: oldVerId, toVersionId: version.id,
          fields, retainedOverrides: Object.keys(overrides), instanceRevision: Number(row.revision),
        })
      }
      return { entries, cursor: rows.length > limit ? entries[limit - 1].instanceId : null }
    }),
    /** @param {string} cardId @param {Parameters<typeof syncKanataCard>[2]} selected */
    sync: (cardId, selected) => operation.transaction(async tx => {
      need(selected.length > 0 && new Set(selected.map(item => item.instanceId)).size === selected.length, 'CARD_SYNC_SELECTION_REQUIRED')
      const { card, version } = await loadCard(tx, cardId)
      const result = []
      for (const item of selected) {
        const projection = await worldProjection(tx, item.worldId)
        const instance = unpackInstance(found(await instanceTable.read(tx, [item.worldId, item.instanceId]), 'INSTANCE_NOT_FOUND'))
        const old = found(await readVersionSafe(tx, cardId, instance.cardVersionId), 'ORPHAN_CARD_VERSION')
        need(old.id !== version.id, 'CARD_SYNC_SELECTION_STALE')
        const [next] = syncKanataCard({ ...projection, cards: [card], cardVersions: [version, old], instances: [instance] }, cardId, [item]).instances
        await instanceTable.replace(tx, packInstance(next), [item.worldId, item.instanceId], item.instanceRevision)
        result.push(next)
      }
      return result
    }),
  }
}
