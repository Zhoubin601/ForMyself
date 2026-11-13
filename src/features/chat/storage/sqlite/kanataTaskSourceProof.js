// @ts-check
import {grantAllowed} from './kanataProvenance.js'
import {requireSqliteValue as need} from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
/** @typedef {import('../../domain/kanataTypes').SourceRef} Ref */
/** @typedef {Pick<import('../../domain/kanataTypes').BackgroundTask,'id'|'worldId'|'kind'|'instanceId'|'conversationId'>} Task */
const sourcePage=`SELECT message_id,message_revision FROM task_sources
  WHERE world_id=? AND task_id=? AND message_id>? ORDER BY message_id LIMIT 50`
// Each root keeps its own chain identity. UNION is the same finite cycle
// handling as sourceConversation; each chain must end at a real non-reply root.
// Only a marker, count and next key cross the bridge for this 50-source range.
const proof=`WITH RECURSIVE scope(world,task,actor,conversation,remember,after_id) AS (VALUES(?,?,?,?,?,?)),
  roots AS MATERIALIZED (SELECT message_id,message_revision FROM scope CROSS JOIN task_sources
    WHERE world_id=scope.world AND task_id=scope.task AND message_id>scope.after_id ORDER BY message_id LIMIT 50),
  chain(root_id,id,revision) AS (
    SELECT message_id,message_id,message_revision FROM roots UNION
    SELECT link.root_id,m.reply_to_message_id,coalesce(m.reply_to_revision,1)
    FROM chain link CROSS JOIN scope JOIN messages m ON m.world_id=scope.world AND m.id=link.id
    WHERE m.reply_to_message_id IS NOT NULL
  ), access(root_id,actor,group_scope,remember,share) AS (
    SELECT r.message_id,scope.actor,c.type='group',scope.remember,0 FROM roots r CROSS JOIN scope
    JOIN messages root ON root.world_id=scope.world AND root.id=r.message_id
    JOIN conversations c ON c.world_id=scope.world AND c.id=root.conversation_id
  )
  SELECT count(*) AS count,max(message_id) AS after_id,EXISTS(
    SELECT 1 FROM roots r CROSS JOIN scope LEFT JOIN messages root ON root.world_id=scope.world AND root.id=r.message_id
    WHERE root.id IS NULL
      OR EXISTS(SELECT 1 FROM chain link LEFT JOIN messages m ON m.world_id=scope.world AND m.id=link.id
        WHERE link.root_id=r.message_id AND (m.id IS NULL OR m.revision IS NOT link.revision
          OR m.status<>'complete' OR m.deleted=1 OR m.conversation_id<>root.conversation_id))
      OR NOT EXISTS(SELECT 1 FROM chain link JOIN messages m ON m.world_id=scope.world AND m.id=link.id
        WHERE link.root_id=r.message_id AND m.reply_to_message_id IS NULL)
      OR (scope.conversation IS NOT NULL AND scope.conversation<>root.conversation_id)
      OR (scope.actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_participants p
        WHERE p.world_id=scope.world AND p.conversation_id=root.conversation_id AND p.participant_id=scope.actor AND p.kind='character'))
      OR (scope.actor IS NULL AND EXISTS(SELECT 1 FROM chain link JOIN message_life_sources s
        ON s.world_id=scope.world AND s.message_id=link.id WHERE link.root_id=r.message_id))
      OR (scope.actor IS NOT NULL AND EXISTS(SELECT 1 FROM chain link JOIN message_life_sources s
        ON s.world_id=scope.world AND s.message_id=link.id CROSS JOIN access
        WHERE link.root_id=r.message_id AND access.root_id=r.message_id AND NOT ${grantAllowed}))
  ) AS denied FROM roots`
export const taskSourceProofQueries=[sourcePage,proof]

/** Invalid ranges use the existing ordered per-source checks, retaining exact
 * error priority and a conservative fallback for a bulk false positive.
 * @param {Tx} tx @param {Task} task @param {(refs:Iterable<Ref>)=>Promise<void>} check */
export async function checkStoredTaskSources(tx,task,check){
  let after=''
  for(;;){
    const [row]=await tx.query(proof,[task.worldId,task.id,task.instanceId??null,task.conversationId??null,
      Number(['memory','summary','world'].includes(task.kind)),after])
    need(row,'KANATA_SQLITE_INTEGRITY_FAILED')
    const count=Number(row.count)
    need(Number.isSafeInteger(count)&&count>=0&&count<=50&&(row.denied===0||row.denied===1),'KANATA_SQLITE_INTEGRITY_FAILED')
    if(row.denied===1){
      const rows=await tx.query(sourcePage,[task.worldId,task.id,after])
      await check(rows.map(value=>({messageId:String(value.message_id),revision:Number(value.message_revision)})))
    }
    if(count<50)return
    const next=String(row.after_id)
    need(next>after,'KANATA_SQLITE_INTEGRITY_FAILED');after=next
  }
}
