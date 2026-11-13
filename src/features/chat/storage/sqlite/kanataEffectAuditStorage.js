// @ts-check
import {eventSnapshotSql,eventSnapshotValidSql,eventScalarFieldsSql} from './kanataEventSnapshot.js'
export const effectAuditDdl=[
  `CREATE TEMP TABLE IF NOT EXISTS kanata_effect_audit_before (
    world_id TEXT NOT NULL,event_id TEXT NOT NULL,effect_id TEXT NOT NULL,before_json TEXT NOT NULL,
    PRIMARY KEY(world_id,event_id,effect_id),
    FOREIGN KEY(event_id) REFERENCES kanata_event_plan(id) ON DELETE CASCADE)`,
  `CREATE TEMP TABLE IF NOT EXISTS kanata_event_audit_plan (
    world TEXT NOT NULL,event TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,
    old_revision INTEGER NOT NULL,old_status TEXT NOT NULL,next_status TEXT NOT NULL,
    effect_count INTEGER NOT NULL,command_id TEXT NOT NULL,PRIMARY KEY(world,event),
    FOREIGN KEY(event) REFERENCES kanata_event_plan(id) ON DELETE CASCADE)`,
  'CREATE INDEX IF NOT EXISTS temp.kanata_effect_audit_before_event ON kanata_effect_audit_before(event_id)',
  'CREATE INDEX IF NOT EXISTS temp.kanata_event_audit_plan_event ON kanata_event_audit_plan(event)',
  `CREATE TEMP TRIGGER IF NOT EXISTS kanata_event_audit_stage AFTER INSERT ON kanata_event_audit_plan BEGIN
    SELECT RAISE(ABORT,'EVENT_REVOKE_PREVIEW_STALE') WHERE NOT EXISTS (
      SELECT 1 FROM world_events e WHERE e.world_id=NEW.world AND e.id=NEW.event
        AND e.revision=NEW.old_revision AND e.status=NEW.old_status);
    SELECT RAISE(ABORT,'KANATA_SQLITE_INTEGRITY_FAILED') WHERE EXISTS (
      SELECT 1 FROM world_events e WHERE e.world_id=NEW.world AND e.id=NEW.event AND NOT (${eventSnapshotValidSql}));
    UPDATE world_events SET status=NEW.next_status,revision=revision+1,
      extensions_json=(SELECT json_remove(${eventSnapshotSql},${eventScalarFieldsSql}) FROM world_events e
        WHERE e.world_id=NEW.world AND e.id=NEW.event)
      WHERE world_id=NEW.world AND id=NEW.event AND revision=NEW.old_revision AND status=NEW.old_status;
  END`,
]
export const clearEffectAuditBefore='DELETE FROM temp.kanata_effect_audit_before'
export const clearEventAuditPlan='DELETE FROM temp.kanata_event_audit_plan'
export const effectAuditClear=[clearEffectAuditBefore,clearEventAuditPlan]
// The same stage applies the whole frozen set. Before/after are the target path
// values before and after that stage, not a fictitious per-Effect undo sequence.
/** @param {string} world @param {string} target @param {string} path */
export function effectTargetJson(world,target,path){
  return `CASE ${path} ${[
    ['state.mood','character_instances','mood'],['state.energy','character_instances','energy'],
    ['state.location','character_instances','location'],['dimensions.trust','relationships','trust'],
    ['dimensions.intimacy','relationships','intimacy'],['dimensions.understanding','relationships','understanding'],
  ].map(([field,table,column])=>`WHEN '${field}' THEN (SELECT json_quote(${column}) FROM ${table}
      WHERE world_id=${world} AND id=${target})`).join(' ')} END`
}
export const captureEffectAuditBefore=`INSERT INTO temp.kanata_effect_audit_before(world_id,event_id,effect_id,before_json)
  SELECT f.world_id,f.event_id,f.id,coalesce(${effectTargetJson('f.world_id','f.target_id','f.path')},'null')
  FROM world_effects f JOIN temp.kanata_event_plan p ON p.id=f.event_id
  WHERE f.world_id=? AND p.disposition=?`
// Unknown paths are rejected by the existing executable-Effect validator during
// replay. Staging must not replace that error with a NOT NULL constraint error.
export const stagedAuditPage=`SELECT a.event AS id,a.id AS auditId,a.at,a.old_revision AS revision,
    a.old_status AS status,a.next_status AS next,a.effect_count AS effectCount,a.command_id AS commandId,p.exec_key
  FROM temp.kanata_event_audit_plan a JOIN temp.kanata_event_plan p ON p.id=a.event
  WHERE a.world=? AND p.disposition=? AND p.exec_key>? ORDER BY p.exec_key LIMIT 128`
export const effectAuditStorageQueries=[stagedAuditPage]
export const anyEffectAuditBefore=`SELECT 1 FROM temp.kanata_event_plan p
  CROSS JOIN world_effects f INDEXED BY effects_by_event ON f.event_id=p.id
  WHERE f.world_id=? AND p.disposition=? LIMIT 1`
export const anyEffectAuditMemory=`SELECT 1 FROM temp.kanata_event_plan p
  CROSS JOIN memory_events l ON l.event_id=p.id
  WHERE l.world_id=? AND p.disposition=? LIMIT 1`
effectAuditStorageQueries.push(anyEffectAuditBefore,anyEffectAuditMemory)
export const effectAuditStorageWrites=[...effectAuditClear,captureEffectAuditBefore]
