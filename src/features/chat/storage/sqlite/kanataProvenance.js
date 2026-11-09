// @ts-check
import { canUseKanataLifeSources } from '../../experience/kanataKnowledge.js'
import { domainTable } from './kanataDomainRows.js'
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
const replyChain = `WITH RECURSIVE scope(world,id,revision) AS (VALUES(?,?,?)),
  chain(id,revision) AS (
    SELECT id,revision FROM scope UNION
    SELECT m.reply_to_message_id,coalesce(m.reply_to_revision,1)
    FROM chain c JOIN scope JOIN messages m ON m.world_id=scope.world AND m.id=c.id
    WHERE m.reply_to_message_id IS NOT NULL
  )`
const chainIntegrity = replyChain + `
  SELECT root.conversation_id FROM scope JOIN messages root ON root.world_id=scope.world AND root.id=scope.id
  WHERE NOT EXISTS (
    SELECT 1 FROM chain c LEFT JOIN messages m ON m.world_id=scope.world AND m.id=c.id
    WHERE m.id IS NULL OR m.revision IS NOT c.revision OR m.status<>'complete' OR m.deleted=1
      OR m.conversation_id<>root.conversation_id
  ) AND EXISTS (
    SELECT 1 FROM chain c JOIN messages m ON m.world_id=scope.world AND m.id=c.id
    WHERE m.reply_to_message_id IS NULL
  )`
const chainGrants = replyChain + `
  SELECT DISTINCT l.grant_id,l.grant_revision,l.fingerprint,l.instance_id,l.module_id
  FROM scope JOIN chain c JOIN message_life_sources l ON l.world_id=scope.world AND l.message_id=c.id
  WHERE (l.grant_id,l.grant_revision,l.fingerprint)>(?,?,?)
  ORDER BY l.grant_id,l.grant_revision,l.fingerprint LIMIT 50`
export const provenanceQueries = [grantTable.get, grantById, member, activeActor, chainIntegrity, chainGrants]
/** @param {Tx} tx @param {string} worldId @param {string} actor */
export async function assertActor(tx, worldId, actor) {
  need((await tx.query(activeActor, [worldId, actor])).length === 1, 'KANATA_CONTEXT_SCOPE_DENIED')
}

/** @param {Tx} tx @param {string} worldId @param {string} conversationId @param {string} actor */
export async function conversationAccess(tx, worldId, conversationId, actor) {
  const [row] = await tx.query(member, [worldId, conversationId, actor])
  return row ? { group: row.type === 'group' } : null
}

/** Exact normalized metadata proof. No message body is projected.
 * @param {Tx} tx @param {string} worldId @param {SourceRef} ref */
export async function sourceConversation(tx, worldId, ref) {
  const [row] = await tx.query(chainIntegrity, [worldId, ref.messageId, ref.revision])
  need(row, 'KANATA_SOURCE_STALE')
  return String(row.conversation_id)
}

/** @param {Tx} tx @param {string} worldId @param {SourceRef} ref */
export async function* visitSourceGrants(tx, worldId, ref) {
  /** @type {import('./kanataSchemaTypes').KanataSqlValue[]} */
  let cursor = ['', 0, '']
  for (;;) {
    const rows = await tx.query(chainGrants, [worldId, ref.messageId, ref.revision, ...cursor])
    for (const row of rows) {
      yield { grantId: String(row.grant_id), revision: Number(row.grant_revision), fingerprint: String(row.fingerprint),
        instanceId: String(row.instance_id), moduleId: /** @type {LifeSource['moduleId']} */ (row.module_id) }
    }
    if (rows.length < 50) return
    const last = rows[rows.length - 1]
    cursor = [last.grant_id, last.grant_revision, last.fingerprint]
  }
}

/** @param {Tx} tx @param {string} worldId @param {SourceRef} ref */
export async function sourceMetadata(tx, worldId, ref) {
  const conversationId = await sourceConversation(tx, worldId, ref)
  const sources = []
  for await (const source of visitSourceGrants(tx, worldId, ref)) sources.push(source)
  return { conversationId, sources }
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
