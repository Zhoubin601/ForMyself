// @ts-check
import { canUseKanataLifeSources } from '../../experience/kanataKnowledge.js'
import { domainTable } from './kanataDomainRows.js'
import { messageQueries } from './kanataRepositorySql.js'
import { requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */
/** @typedef {import('../../domain/kanataTypes').LifeGrant} LifeGrant */
/** @typedef {import('../../domain/kanataTypes').SourceRef} SourceRef */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */

export const grantTable = /** @type {ReturnType<typeof domainTable<LifeGrant>>} */ (domainTable('life_grants', {
  world_id: 'worldId', instance_id: 'instanceId', module_id: 'moduleId', id: 'id',
  can_read: 'read:flag', can_remember: 'remember:flag', can_share: 'share:flag', revision: 'revision',
}, ['world_id', 'instance_id', 'module_id']))
export const grantById = `SELECT ${grantTable.stored} FROM life_grants WHERE world_id=? AND id=?`
const member = `SELECT c.type FROM conversations c JOIN conversation_participants p
  ON p.world_id=c.world_id AND p.conversation_id=c.id
  WHERE c.world_id=? AND c.id=? AND p.participant_id=? AND p.kind='character'`
const activeActor = `SELECT i.id FROM character_instances i JOIN worlds w ON w.id=i.world_id
  WHERE i.world_id=? AND i.id=? AND coalesce(w.archived,0)=0`
export const provenanceQueries = [grantTable.get, grantById, member, activeActor]

/** @param {Tx} tx @param {string} worldId @param {string} actor */
export async function assertActor(tx, worldId, actor) {
  need((await tx.query(activeActor, [worldId, actor])).length === 1, 'KANATA_CONTEXT_SCOPE_DENIED')
}

/** @param {Tx} tx @param {string} worldId @param {string} conversationId @param {string} actor */
export async function conversationAccess(tx, worldId, conversationId, actor) {
  const [row] = await tx.query(member, [worldId, conversationId, actor])
  return row ? { group: row.type === 'group' } : null
}

/** Only metadata and normalized grants are read before the caller is allowed to read a body.
 * @param {Tx} tx @param {string} worldId @param {SourceRef} ref */
export async function sourceMetadata(tx, worldId, ref) {
  const seen = new Set()
  const sources = []
  let next = ref.messageId
  let revision = ref.revision
  let conversationId = ''
  for (;;) {
    need(!seen.has(next), 'KANATA_SOURCE_STALE')
    seen.add(next)
    const [row] = await tx.query(messageQueries.provenance, [worldId, next])
    need(row && row.revision === revision && row.status === 'complete' && row.deleted !== 1, 'KANATA_SOURCE_STALE')
    conversationId ||= String(row.conversation_id)
    need(row.conversation_id === conversationId, 'KANATA_SOURCE_STALE')
    sources.push(.../** @type {LifeSource[]} */ (JSON.parse(String(row.life_sources))))
    if (row.reply_to_message_id === null) return { conversationId, sources: uniqueLifeSources(sources) }
    next = String(row.reply_to_message_id)
    revision = Number(row.reply_to_revision ?? 1)
  }
}

/** @param {LifeSource[]} sources */
export function uniqueLifeSources(sources) {
  return [...new Map(sources.map(source => [JSON.stringify([source.grantId, source.revision, source.fingerprint]), source])).values()]
}

/** @param {Tx} tx @param {LifeSource[]} sources @param {{worldId:string, instanceId:string, group:boolean, remember?:boolean, share?:boolean}} scope */
export async function requireLifeSources(tx, sources, scope) {
  /** @type {Map<string,LifeGrant>} */
  const grants = new Map()
  for (const source of sources) {
    const [row] = await tx.query(grantById, [scope.worldId, source.grantId])
    need(row, 'KANATA_LIFE_PERMISSION_DENIED')
    const origin = grantTable.decode(row)
    need(!scope.share || origin.share, 'KANATA_LIFE_PERMISSION_DENIED')
    grants.set(origin.id, origin)
    const receiver = await grantTable.read(tx, [scope.worldId, scope.instanceId, source.moduleId])
    if (receiver) grants.set(receiver.id, receiver)
  }
  need(canUseKanataLifeSources({ lifeGrants: [...grants.values()] }, sources, scope), 'KANATA_LIFE_PERMISSION_DENIED')
}
