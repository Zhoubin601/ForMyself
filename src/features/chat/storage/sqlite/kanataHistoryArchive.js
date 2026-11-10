// @ts-check
import { sha256Text } from '../../../../shared/crypto/sha256Text.js'
import { validateId } from '../../domain/kanataValidation.js'
import { executeOnce } from './kanataDomainRows.js'
import { visitRows } from './kanataMessageDependents.js'
import { equalDto, requireSqliteValue as need, safeInteger, scopeBindings } from './kanataRepositoryValues.js'
import { assertWritableWorld } from './kanataWorldRepository.js'

/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataRepositoryTypes').KanataHistoryArchivePlan} Plan */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */

const conversation = 'SELECT c.revision,w.archived FROM conversations c JOIN worlds w ON w.id=c.world_id WHERE c.world_id=? AND c.id=?'
// Legacy archives protect exact message IDs found in nested extension values.
// Search SQLite's stored JSON values without handing any extension graph to JS.
const extensionDocuments = [
  ...['dataset_metadata','worlds','world_identities','character_cards','card_versions','character_instances',
    'conversations','messages','lorebook_entries','memories','relationships','world_events','world_effects',
    'effect_baselines','background_tasks','life_grants','preset_applications','usage_events','virtual_schedules',
    'memory_policies','autonomy_policies','role_binding_state','role_bindings','data_migrations','message_audits','event_audits']
    .map(table => 'SELECT extensions_json FROM ' + table),
  'SELECT definition_json FROM card_versions','SELECT raw_data_json FROM card_versions','SELECT imported_json FROM card_versions',
  'SELECT overrides_json FROM character_instances','SELECT metadata_json FROM background_tasks',
  'SELECT previous_json FROM event_audits','SELECT next_json FROM event_audits',
  'SELECT previous_json FROM message_audits','SELECT next_json FROM message_audits',
].join(' UNION ALL ')
const selection = `WITH RECURSIVE p(world,conversation,keep_recent) AS (VALUES(?,?,?)),
  active(id,revision,created_at,parent) AS MATERIALIZED (
    SELECT m.id,m.revision,m.created_at,m.reply_to_message_id FROM p JOIN messages m ON m.world_id=p.world AND m.conversation_id=p.conversation
    WHERE NOT EXISTS(SELECT 1 FROM archived_message_marks a WHERE a.world_id=p.world AND a.conversation_id=p.conversation AND a.message_id=m.id)
  ), recent(id) AS (SELECT id FROM active ORDER BY created_at DESC,id DESC LIMIT (SELECT keep_recent FROM p)),
  components(root,id) AS (
    SELECT a.id,a.id FROM active a WHERE a.parent IS NULL OR NOT EXISTS(SELECT 1 FROM active b WHERE b.id=a.parent)
    UNION ALL SELECT c.root,a.id FROM components c JOIN active a ON a.parent=c.id
  ), opaque(document) AS (${extensionDocuments}), extension_refs(id) AS (
    SELECT DISTINCT a.id FROM opaque o CROSS JOIN json_tree(o.document) j
    JOIN active a ON a.id=j.atom WHERE j.type='text'
  ), protected(id) AS (
    SELECT id FROM recent UNION SELECT id FROM extension_refs
    UNION SELECT a.id FROM active a CROSS JOIN p WHERE EXISTS(
      SELECT 1 FROM memory_sources r WHERE r.world_id=p.world AND r.message_id=a.id
      UNION ALL SELECT 1 FROM event_sources r WHERE r.world_id=p.world AND r.message_id=a.id
      UNION ALL SELECT 1 FROM task_sources r WHERE r.world_id=p.world AND r.message_id=a.id
      UNION ALL SELECT 1 FROM message_audits r WHERE r.world_id=p.world AND r.message_id=a.id
      UNION ALL SELECT 1 FROM background_tasks r WHERE r.world_id=p.world AND r.deferred_message_id=a.id
    )
    UNION SELECT id FROM active a WHERE a.parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM active b WHERE b.id=a.parent)
  ), safe(root) AS (
    SELECT c.root FROM components c LEFT JOIN protected r ON r.id=c.id
    GROUP BY c.root HAVING count(*)<=50 AND count(r.id)=0
  ), eligible(id,revision,created_at) AS (
    SELECT a.id,a.revision,a.created_at FROM safe s JOIN components c ON c.root=s.root JOIN active a ON a.id=c.id
  )`
const page = selection + ' SELECT id,revision,created_at FROM eligible WHERE id>? ORDER BY id LIMIT 50'
const mark = selection + ' INSERT INTO archived_message_marks(world_id,conversation_id,message_id) SELECT p.world,p.conversation,e.id FROM eligible e CROSS JOIN p'

export const historyArchiveQueries = [conversation, page]
export const historyArchiveWrites = [mark]

/** @param {Tx} tx @param {Scope} scope @param {number} keepRecent */
async function preview(tx,scope,keepRecent) {
  need(safeInteger(keepRecent,50)&&keepRecent<=10000,'KANATA_ARCHIVE_KEEP_INVALID')
  const keys=scopeBindings(scope)
  const [current]=await tx.query(conversation,keys)
  need(current&&current.archived!==1,'KANATA_ARCHIVE_SCOPE_DENIED')
  const conversationRevision=Number(current.revision)
  let signature=sha256Text(JSON.stringify([...keys,keepRecent,conversationRevision,'archive-marks-v1']))
  let count=0
  for await(const row of visitRows(tx,page,[...keys,keepRecent],['id'],50)){
    count++
    signature=sha256Text(signature+JSON.stringify([row.id,row.revision,row.created_at]))
  }
  return {worldId:scope.worldId,conversationId:scope.conversationId,keepRecent,conversationRevision,count,signature}
}

/** @param {Operation} operation */
export function createKanataHistoryArchive(operation) {
  return {
    /** @param {Scope} scope @param {number} [keepRecent] */
    previewArchive: (scope,keepRecent=200)=>operation.transaction(tx=>preview(tx,scope,keepRecent)),
    /** @param {Scope} scope @param {Plan} plan @param {string} commandId */
    confirmArchive: (scope,plan,commandId)=>operation.transaction(async tx=>{
      const keys=scopeBindings(scope)
      validateId(commandId,'commandId')
      need(plan.worldId===scope.worldId&&plan.conversationId===scope.conversationId,'KANATA_ARCHIVE_SCOPE_DENIED')
      await assertWritableWorld(tx,scope.worldId)
      await executeOnce(tx,['message:archive',...keys,commandId],plan,async()=>{
        const current=await preview(tx,scope,plan.keepRecent)
        need(equalDto(current,plan),'KANATA_ARCHIVE_PREVIEW_STALE')
        const result=await tx.execute(mark,[...keys,plan.keepRecent])
        need(result.affectedRows===plan.count,'KANATA_ARCHIVE_PREVIEW_STALE')
        return scope.conversationId
      })
      return {archivedCount:plan.count}
    }),
  }
}
