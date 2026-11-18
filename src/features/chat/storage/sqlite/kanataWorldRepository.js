// @ts-check
import { createEmptyKanataData } from '../../domain/kanataCore.js'
import { archiveKanataWorld, copyKanataWorld, createKanataWorld, renameKanataWorld, updateKanataIdentity, updateKanataWorldSettings } from '../../domain/kanataManagementCore.js'
import { validateId } from '../../domain/kanataValidation.js'
import { messageQueries } from './kanataRepositorySql.js'
import { executeOnce, found, domainTable, writeOne } from './kanataDomainRows.js'
import { pageLimit, requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'
import { assertDomainArrayOrder } from './kanataArrayOrder.js'

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
export const worldCopyDdl = [
  'CREATE TEMP TABLE IF NOT EXISTS kanata_world_copy_ids (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL)',
]
const clearCopyMap = 'DELETE FROM temp.kanata_world_copy_ids'
const putCopyMap = 'INSERT INTO temp.kanata_world_copy_ids(old_id,new_id) VALUES(?,?)'
const copyMapTarget = 'SELECT new_id FROM temp.kanata_world_copy_ids WHERE old_id=?'
const copyInstancesPage = 'SELECT id FROM character_instances WHERE world_id=? AND id>? ORDER BY id LIMIT 50'
const copyInstanceRow = `INSERT INTO character_instances(id,world_id,card_id,card_version_id,revision,overrides_json,mood,energy,location,autonomy_enabled,proactive_enabled,extensions_json)
  SELECT ?,?,card_id,card_version_id,1,overrides_json,'平静',1,'',0,0,extensions_json FROM character_instances WHERE world_id=? AND id=?`
const copyConversationsPage = "SELECT id,type FROM conversations WHERE world_id=? AND type<>'character' AND id>? ORDER BY id LIMIT 50"
const copyConversationRow = `INSERT INTO conversations(id,world_id,type,title,mode,revision,last_read_at,max_speakers,max_messages,reply_timing_enabled,reply_wait_ms,extensions_json)
  SELECT ?,?,type,title,mode,1,0,max_speakers,max_messages,reply_timing_enabled,reply_wait_ms,extensions_json FROM conversations WHERE world_id=? AND id=?`
const copyConvParticipants = `INSERT INTO conversation_participants(world_id,conversation_id,participant_id,kind,ordinal)
  SELECT ?,?,m.new_id,p.kind,p.ordinal FROM conversation_participants p
  JOIN temp.kanata_world_copy_ids m ON m.old_id=p.participant_id WHERE p.world_id=? AND p.conversation_id=? ORDER BY p.ordinal`
const copyLorePage = 'SELECT id,scope,owner_id FROM lorebook_entries WHERE world_id=? AND id>? ORDER BY id LIMIT 50'
const copyLoreRow = `INSERT INTO lorebook_entries(id,world_id,scope,owner_id,owner_instance_id,keys_json,secondary_keys_json,content,priority,activation_rule,visibility,source_tag,revision,enabled,case_sensitive,extensions_json)
  SELECT ?,?,scope,?,CASE WHEN scope='character' THEN ? ELSE NULL END,keys_json,secondary_keys_json,content,priority,activation_rule,visibility,source_tag,1,enabled,case_sensitive,extensions_json
  FROM lorebook_entries WHERE world_id=? AND id=?`
const copyLoreKnown = `INSERT INTO lorebook_known_by(world_id,entry_id,participant_id)
  SELECT ?,?,m.new_id FROM lorebook_known_by k JOIN temp.kanata_world_copy_ids m ON m.old_id=k.participant_id
  WHERE k.world_id=? AND k.entry_id=?`
const copyTeammatesPage = `SELECT id,from_id,to_id FROM relationships r WHERE r.world_id=? AND r.kind='teammate'
  AND NOT EXISTS (SELECT 1 FROM relationship_events re WHERE re.world_id=r.world_id AND re.relationship_id=r.id) AND r.id>? ORDER BY r.id LIMIT 50`
const copyTeammateRow = `INSERT INTO relationships(id,world_id,from_id,to_id,kind,trust_baseline,public_summary,trust,intimacy,understanding,dimension_rule_version,revision,extensions_json)
  SELECT ?,?,?,?,kind,trust_baseline,public_summary,0,0,0,dimension_rule_version,1,extensions_json FROM relationships WHERE world_id=? AND id=?`
export const worldQueries = [worldTable.get, identityTable.get, list, dataset, copyMapTarget, copyInstancesPage, copyConversationsPage, copyLorePage, copyTeammatesPage]
export const worldWrites = [...worldTable.writeStatements, ...identityTable.writeStatements, init, disableActors,
  clearCopyMap, putCopyMap, copyInstanceRow, copyConversationRow, copyConvParticipants, copyLoreRow, copyLoreKnown, copyTeammateRow]

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
  await assertDomainArrayOrder(tx, id)
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
    /** Copy static world rules, identity, instances, non-character chats, lore and initial teammate links.
     * @param {string} sourceWorldId @param {string} name @param {Parameters<typeof copyKanataWorld>[3]} options */
    copy: (sourceWorldId, name, options) => operation.transaction(async tx => {
      validateId(sourceWorldId, 'worldId')
      validateId(options.key, 'commandId')
      const previous = found(await readWorld(tx, sourceWorldId), 'WORLD_NOT_FOUND')
      const newWorldId = await executeOnce(tx, ['world:copy', previous.identity.userId, sourceWorldId, options.key],
        { name, now: options.now, timeZone: options.timeZone }, async () => {
          const copied = copyKanataWorld(projection(previous), sourceWorldId, name, options)
          const world = found(copied.worlds.at(-1), 'WORLD_NOT_FOUND')
          const identity = found(copied.identities.at(-1), 'WORLD_IDENTITY_REQUIRED')
          await worldTable.create(tx, { ...world, identityId: identity.id })
          await identityTable.create(tx, identity)
          for (const ddl of worldCopyDdl) await tx.execute(ddl)
          await tx.execute(clearCopyMap)
          const mapId = async (/** @type {string} */ kind, /** @type {string} */ oldId) => {
            const nextId = options.idFactory ? options.idFactory(kind, oldId) : crypto.randomUUID()
            validateId(nextId, kind + 'Id')
            return nextId
          }
          await tx.execute(putCopyMap, [sourceWorldId, world.id])
          await tx.execute(putCopyMap, [previous.identity.id, identity.id])
          const resolveMapped = async (/** @type {string} */ oldId) => {
            const [row] = await tx.query(copyMapTarget, [oldId])
            return String(found(row, 'WORLD_COPY_TARGET_MISSING').new_id)
          }
          for (let after = ''; ;) {
            const rows = await tx.query(copyInstancesPage, [sourceWorldId, after])
            for (const row of rows) {
              const oldId = String(row.id), nextId = await mapId('instance', oldId)
              await tx.execute(putCopyMap, [oldId, nextId])
              await writeOne(tx, copyInstanceRow, [nextId, world.id, sourceWorldId, oldId])
            }
            if (rows.length < 50) break
            after = String(rows[49].id)
          }
          for (let after = ''; ;) {
            const rows = await tx.query(copyConversationsPage, [sourceWorldId, after])
            for (const row of rows) {
              const oldId = String(row.id), nextId = await mapId(String(row.type), oldId)
              await writeOne(tx, copyConversationRow, [nextId, world.id, sourceWorldId, oldId])
              await tx.execute(copyConvParticipants, [world.id, nextId, sourceWorldId, oldId])
            }
            if (rows.length < 50) break
            after = String(rows[49].id)
          }
          for (let after = ''; ;) {
            const rows = await tx.query(copyLorePage, [sourceWorldId, after])
            for (const row of rows) {
              const oldId = String(row.id), nextId = await mapId('lore', oldId)
              const ownerId = await resolveMapped(String(row.owner_id))
              await writeOne(tx, copyLoreRow, [nextId, world.id, ownerId, row.scope === 'character' ? ownerId : null, sourceWorldId, oldId])
              await tx.execute(copyLoreKnown, [world.id, nextId, sourceWorldId, oldId])
            }
            if (rows.length < 50) break
            after = String(rows[49].id)
          }
          for (let after = ''; ;) {
            const rows = await tx.query(copyTeammatesPage, [sourceWorldId, after])
            for (const row of rows) {
              const oldId = String(row.id), nextId = await mapId('relationship', oldId)
              const fromId = await resolveMapped(String(row.from_id)), toId = await resolveMapped(String(row.to_id))
              await writeOne(tx, copyTeammateRow, [nextId, world.id, fromId, toId, sourceWorldId, oldId])
            }
            if (rows.length < 50) break
            after = String(rows[49].id)
          }
          await tx.execute(clearCopyMap)
          return world.id
        })
      return found(await readWorld(tx, newWorldId), 'WORLD_NOT_FOUND')
    }),
  }
}
