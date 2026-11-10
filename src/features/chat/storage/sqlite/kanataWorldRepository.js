// @ts-check
import { createEmptyKanataData } from '../../domain/kanataCore.js'
import { archiveKanataWorld, createKanataWorld, renameKanataWorld, updateKanataIdentity, updateKanataWorldSettings } from '../../domain/kanataManagementCore.js'
import { validateId } from '../../domain/kanataValidation.js'
import { messageQueries } from './kanataRepositorySql.js'
import { executeOnce, found, domainTable, writeOne } from './kanataDomainRows.js'
import { pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').World} World */
/** @typedef {import('../../domain/kanataTypes').WorldUserIdentity} Identity */
/** @typedef {World & {identityId:string}} StoredWorld */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */

export const worldTable = /** @type {ReturnType<typeof domainTable<StoredWorld>>} */ (domainTable('worlds', {
  id: 'id', name: 'name', rules: 'rules', revision: 'revision', time_zone: 'timeZone', created_at: 'createdAt',
  last_simulated_at: 'lastSimulatedAt', autonomy_enabled: 'autonomyEnabled:flag', proactive_enabled: 'proactiveEnabled:flag',
  notifications_enabled: 'notificationsEnabled:flag', default_chat_mode: 'defaultChatMode',
  archived: 'archived:flag', identity_id: 'identityId',
}, ['id']))
export const identityTable = /** @type {ReturnType<typeof domainTable<Identity>>} */ (domainTable('world_identities', {
  world_id: 'worldId', id: 'id', user_id: 'userId', display_name: 'displayName', background: 'background', revision: 'revision',
}, ['world_id', 'id']))
const list = `SELECT ${worldTable.stored},rowid AS ordinal FROM worlds WHERE rowid>? ORDER BY rowid LIMIT ?`
const dataset = 'SELECT user_id FROM dataset_metadata WHERE singleton=1'
const init = 'INSERT INTO dataset_metadata(singleton,user_id,data_version) VALUES(1,?,1)'
const disableActors = 'UPDATE character_instances SET autonomy_enabled=0,proactive_enabled=0,revision=revision+1 WHERE world_id=?'
export const worldQueries = [worldTable.get, identityTable.get, list, dataset]
export const worldWrites = [...worldTable.writeStatements, ...identityTable.writeStatements, init, disableActors]

/** @param {Tx} tx @param {string} id */
export async function readWorld(tx, id) {
  validateId(id, 'worldId')
  const stored = await worldTable.read(tx, [id])
  if (!stored) return null
  const { identityId, ...world } = stored
  const identity = found(await identityTable.read(tx, [id, identityId]), 'WORLD_IDENTITY_REQUIRED')
  return { world, identity }
}

/** @param {Tx} tx @param {string} id */
export async function assertWritableWorld(tx, id) {
  validateId(id, 'worldId')
  const [row] = await tx.query(messageQueries.world, [id])
  need(row && row.archived !== 1, 'WORLD_ARCHIVED')
}

/** @param {NonNullable<Awaited<ReturnType<typeof readWorld>>>} record */
function projection({ world, identity }) {
  return { ...createEmptyKanataData(identity.userId), worlds: [world], identities: [identity] }
}

/** @param {Tx} tx @param {string} userId @param {Parameters<typeof createKanataWorld>[1]} fields
 * @param {Parameters<typeof createKanataWorld>[2]} options @param {boolean} initialize */
async function createWorld(tx,userId,fields,options,initialize) {
  const id=await executeOnce(tx,['world:create',userId,options.key],{fields,now:options.now,timeZone:options.timeZone},async()=>{
    const data=createKanataWorld(createEmptyKanataData(userId),fields,options)
    const [world]=data.worlds,[identity]=data.identities
    if(initialize)await writeOne(tx,init,[userId])
    await worldTable.create(tx,{...world,identityId:identity.id})
    await identityTable.create(tx,identity)
    return world.id
  })
  return found(await readWorld(tx,id),'WORLD_NOT_FOUND')
}

/** @param {Operation} operation */
export function createKanataWorldRepository(operation) {
  return {
    /** @param {number} afterOrdinal @param {number} limit */
    list: (afterOrdinal = 0, limit = 50) => operation.transaction(async tx => {
      need(safeInteger(afterOrdinal), 'KANATA_WORLD_CURSOR_INVALID')
      const rows = await tx.query(list, [afterOrdinal, pageLimit(limit) + 1])
      const worlds = rows.slice(0, limit).map(row => {
        const { identityId: _identityId, ...world } = worldTable.decode(row)
        return world
      })
      return { worlds, cursor: rows.length > limit ? Number(rows[limit - 1].ordinal) : null }
    }),
    /** @param {string} worldId */
    get: worldId => operation.transaction(tx => readWorld(tx, worldId)),
    /** @param {string} userId @param {Parameters<typeof createKanataWorld>[1]} fields @param {Parameters<typeof createKanataWorld>[2]} options */
    create: (userId, fields, options) => operation.transaction(async tx => {
      validateId(userId, 'userId')
      const [owner]=await tx.query(dataset)
      need(!owner||owner.user_id===userId,'KANATA_DATASET_OWNER_CONFLICT')
      return createWorld(tx,userId,fields,options,!owner)
    }),
    /** @param {Parameters<typeof createKanataWorld>[1]} fields @param {Parameters<typeof createKanataWorld>[2]} options */
    createForDataset: (fields,options) => operation.transaction(async tx=>{
      const [owner]=await tx.query(dataset)
      const userId=owner?.user_id
      if(typeof userId!=='string') throw new Error('KANATA_DATASET_OWNER_REQUIRED')
      return createWorld(tx,userId,fields,options,false)
    }),
    /** @param {string} worldId @param {number} expectedRevision @param {string} name */
    rename: (worldId, expectedRevision, name) => operation.transaction(async tx => {
      const previous = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      need(previous.world.revision === expectedRevision, 'KANATA_WORLD_REVISION_CONFLICT')
      const [world] = renameKanataWorld(projection(previous), worldId, name).worlds
      await worldTable.replace(tx, { ...world, identityId: previous.identity.id }, [worldId], expectedRevision)
      return world
    }),
    /** @param {string} worldId @param {number} expectedRevision @param {Parameters<typeof updateKanataWorldSettings>[2]} fields */
    updateSettings: (worldId, expectedRevision, fields) => operation.transaction(async tx => {
      const previous = found(await readWorld(tx,worldId),'WORLD_NOT_FOUND')
      need(previous.world.revision===expectedRevision,'KANATA_WORLD_REVISION_CONFLICT')
      const [world]=updateKanataWorldSettings(projection(previous),worldId,fields).worlds
      await worldTable.replace(tx,{...world,identityId:previous.identity.id},[worldId],expectedRevision)
      return world
    }),
    /** @param {string} worldId @param {number} expectedRevision @param {boolean} archived */
    archive: (worldId, expectedRevision, archived) => operation.transaction(async tx => {
      await executeOnce(tx, ['world:archive', worldId, String(expectedRevision)], archived, async () => {
        const previous = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
        need(previous.world.revision === expectedRevision, 'KANATA_WORLD_REVISION_CONFLICT')
        const [world] = archiveKanataWorld(projection(previous), worldId, archived).worlds
        await worldTable.replace(tx, { ...world, identityId: previous.identity.id }, [worldId], expectedRevision)
        if (archived) await tx.execute(disableActors, [worldId])
        return worldId
      })
      return found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND').world
    }),
    /** @param {string} worldId @param {number} expectedRevision @param {Parameters<typeof updateKanataIdentity>[2]} fields */
    updateIdentity: (worldId, expectedRevision, fields) => operation.transaction(async tx => {
      const previous = found(await readWorld(tx, worldId), 'WORLD_NOT_FOUND')
      need(previous.identity.revision === expectedRevision, 'KANATA_IDENTITY_REVISION_CONFLICT')
      const [identity] = updateKanataIdentity(projection(previous), worldId, fields).identities
      await identityTable.replace(tx, identity, [worldId, identity.id], expectedRevision)
      return identity
    }),
  }
}
