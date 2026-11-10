// @ts-check
import { domainTable } from './kanataDomainRows.js'
import { requireSqliteValue as need } from './kanataRepositoryValues.js'

/** @typedef {import('../../domain/kanataTypes').LifeSource} LifeSource */
/** @typedef {import('../../domain/kanataTypes').LifeGrant} LifeGrant */
/** @typedef {import('../../domain/kanataTypes').SourceRef} SourceRef */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {{worldId:string,instanceId:string,group:boolean,remember?:boolean,share?:boolean}} GrantScope */

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
// Use the same predicate for a single supplied tag and a normalized reply chain.
const access = 'access(actor,group_scope,remember,share) AS (VALUES(?,?,?,?))'
const grantAllowed = `EXISTS(
  SELECT 1 FROM life_grants origin JOIN life_grants receiver
    ON receiver.world_id=origin.world_id AND receiver.module_id=origin.module_id AND receiver.instance_id=access.actor
  WHERE origin.world_id=s.world_id AND origin.id=s.grant_id AND origin.instance_id=s.instance_id
    AND origin.module_id=s.module_id AND origin.revision=s.grant_revision AND origin.can_read=1
    AND (access.remember=0 OR origin.can_remember=1)
    AND (origin.can_share=1 OR (access.share=0 AND access.group_scope=0 AND access.actor=s.instance_id))
    AND receiver.can_read=1 AND (access.remember=0 OR receiver.can_remember=1)
    AND (access.group_scope=0 OR receiver.can_share=1)
)`
const allowedGrant = `WITH s(world_id,grant_id,instance_id,module_id,grant_revision) AS (VALUES(?,?,?,?,?)), ${access}
  SELECT 1 FROM s CROSS JOIN access WHERE ${grantAllowed}`
const chainGrantLinks = `FROM scope CROSS JOIN chain c
  JOIN message_life_sources s ON s.world_id=scope.world AND s.message_id=c.id`
const anyChainGrant = replyChain + ' SELECT 1 ' + chainGrantLinks + ' LIMIT 1'
const deniedChainGrant = replyChain + `, ${access}
  SELECT 1 ${chainGrantLinks} CROSS JOIN access
  WHERE NOT ${grantAllowed} LIMIT 1`
export const provenanceQueries = [grantTable.get, grantById, member, activeActor, chainIntegrity, chainGrants, allowedGrant, anyChainGrant, deniedChainGrant]
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

/** @param {GrantScope} scope */
function grantBindings(scope) {
  return [scope.instanceId, Number(scope.group), Number(Boolean(scope.remember)), Number(Boolean(scope.share))]
}

/** @param {Tx} tx @param {Iterable<LifeSource>} sources @param {GrantScope} scope */
export async function requireLifeSources(tx, sources, scope) {
  const bindings = grantBindings(scope)
  for (const source of sources) {
    const rows = await tx.query(allowedGrant, [scope.worldId, source.grantId, source.instanceId, source.moduleId, source.revision, ...bindings])
    need(rows.length === 1, 'KANATA_LIFE_PERMISSION_DENIED')
  }
}

/** Validate a previously checked message/revision without returning any grant tags.
 * @param {Tx} tx @param {SourceRef} ref @param {GrantScope} scope */
export async function requireSourceGrants(tx, ref, scope) {
  const rows = await tx.query(deniedChainGrant, [scope.worldId, ref.messageId, ref.revision, ...grantBindings(scope)])
  need(rows.length === 0, 'KANATA_LIFE_PERMISSION_DENIED')
}

/** @param {Tx} tx @param {string} worldId @param {SourceRef} ref */
export async function hasSourceGrants(tx, worldId, ref) {
  return (await tx.query(anyChainGrant, [worldId, ref.messageId, ref.revision])).length > 0
}
