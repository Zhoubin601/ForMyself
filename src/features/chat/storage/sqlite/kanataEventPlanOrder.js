// @ts-check
import { assertDomainArrayOrder } from './kanataArrayOrder.js'
import { validateId } from '../../domain/kanataValidation.js'
import { requireSqliteValue as need, safeInteger } from './kanataRepositoryValues.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Tx */
export const eventPlanDdl = [
  `CREATE TEMP TABLE IF NOT EXISTS kanata_event_plan (
    id TEXT PRIMARY KEY,ordinal INTEGER NOT NULL,round INTEGER NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition IN ('revoke','uncertain')),
    sort_key TEXT NOT NULL,exec_key TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS temp.kanata_event_plan_frontier ON kanata_event_plan(disposition,round)',
  'CREATE UNIQUE INDEX IF NOT EXISTS temp.kanata_event_plan_preview ON kanata_event_plan(sort_key)',
  'CREATE UNIQUE INDEX IF NOT EXISTS temp.kanata_event_plan_execution ON kanata_event_plan(exec_key)',
]
const clear = 'DELETE FROM temp.kanata_event_plan'
const seed = `INSERT INTO temp.kanata_event_plan(id,ordinal,round,disposition,sort_key,exec_key)
  SELECT e.id,o.ordinal,-1,'revoke','0',printf('0:%016d',o.ordinal)
  FROM event_array_order o JOIN world_events e ON e.world_id=o.world_id AND e.id=o.entity_id
  WHERE o.world_id=? AND e.id=? AND e.status<>'revoked'`
// One pure-domain scan adds every seed reachable from the previous scan, plus
// its strictly forward ordinal closure. A backward edge waits for the next scan.
// UNION deduplicates IDs within a round; no path/whole-graph array reaches JS.
const advance = `WITH RECURSIVE args(world,round) AS (VALUES(?,?)), next(id,ordinal) AS (
  SELECT child.entity_id,child.ordinal FROM args
    CROSS JOIN temp.kanata_event_plan p INDEXED BY kanata_event_plan_frontier
    CROSS JOIN event_causes l INDEXED BY event_causes_reverse ON l.world_id=args.world AND l.cause_event_id=p.id
    CROSS JOIN event_array_order child ON child.world_id=args.world AND child.entity_id=l.event_id
    WHERE p.disposition='revoke' AND p.round=args.round-1
      AND NOT EXISTS(SELECT 1 FROM temp.kanata_event_plan present WHERE present.id=child.entity_id)
  UNION
  SELECT child.entity_id,child.ordinal FROM next parent CROSS JOIN args
    CROSS JOIN event_causes l INDEXED BY event_causes_reverse ON l.world_id=args.world AND l.cause_event_id=parent.id
    CROSS JOIN event_array_order child ON child.world_id=args.world AND child.entity_id=l.event_id
    WHERE child.ordinal>parent.ordinal
      AND NOT EXISTS(SELECT 1 FROM temp.kanata_event_plan present WHERE present.id=child.entity_id)
)
INSERT INTO temp.kanata_event_plan(id,ordinal,round,disposition,sort_key,exec_key)
SELECT n.id,n.ordinal,args.round,'revoke',printf('1:%016d:%016d',args.round,n.ordinal),printf('0:%016d',n.ordinal)
FROM next n CROSS JOIN args`
const uncertain = `WITH args(world,root) AS (VALUES(?,?))
  INSERT INTO temp.kanata_event_plan(id,ordinal,round,disposition,sort_key,exec_key)
  SELECT e.id,o.ordinal,0,'uncertain',printf('2:%016d',o.ordinal),printf('1:%016d',o.ordinal)
  FROM args JOIN world_events original ON original.world_id=args.world AND original.id=args.root
    JOIN event_array_order o ON o.world_id=args.world
    JOIN world_events e ON e.world_id=args.world AND e.id=o.entity_id
  WHERE e.status='committed' AND e.causality IS NOT 'explicit' AND e.effective_at>=original.effective_at
    AND NOT EXISTS(SELECT 1 FROM temp.kanata_event_plan p WHERE p.id=e.id)`
export const eventPlanWrites = [clear,seed,advance,uncertain]

/** Caller owns one protected BEGIN IMMEDIATE. Success clears the workspace;
 * failure rolls it back to its initially empty state. A revoked connection loses
 * its MEMORY temp tables. No plan state survives a successful operation.
 * @template T @param {Tx} tx @param {string} worldId @param {string} eventId
 * @param {()=>Promise<T>} action */
export async function withEventPlan(tx,worldId,eventId,action) {
  validateId(worldId,'worldId')
  validateId(eventId,'eventId')
  await assertDomainArrayOrder(tx,worldId)
  for(const ddl of eventPlanDdl)await tx.execute(ddl)
  await tx.execute(clear)
  need((await tx.execute(seed,[worldId,eventId])).affectedRows===1,'EVENT_UNAVAILABLE')
  for(let round=0;;round++){
    need(safeInteger(round),'KANATA_SQLITE_INTEGRITY_FAILED')
    if((await tx.execute(advance,[worldId,round])).affectedRows===0)break
  }
  await tx.execute(uncertain,[worldId,eventId])
  const result=await action()
  await tx.execute(clear)
  return result
}
