const task = "world_id=? AND conversation_id=? AND kind='reply' AND deferred_message_id IS NOT NULL"

export const deferredReplyQueries = Object.freeze({
  pending: `SELECT id,deferred_message_id,deferred_revision,deferred_expires_at,not_before,metadata_json
    FROM background_tasks WHERE ${task} AND state='pending' ORDER BY not_before,id LIMIT 1`,
  prior: `SELECT id,state FROM background_tasks WHERE ${task} AND idempotency_key=?`,
})
export const deferredReplyWrites = Object.freeze({
  cancel: `UPDATE background_tasks SET state='cancelled',lease_until=0 WHERE ${task} AND state='pending'`,
  superseded: `UPDATE background_tasks SET state='cancelled',lease_until=0
    WHERE ${task} AND state='pending' AND deferred_message_id<>?`,
  abandon: `UPDATE background_tasks SET state='cancelled',lease_until=0 WHERE ${task} AND state='pending' AND id=?`,
  expireLease: `UPDATE background_tasks SET state='failed',lease_until=0,error_code='DEFERRED_REPLY_INTERRUPTED'
    WHERE ${task} AND state='running' AND lease_until<=?`,
  create: `INSERT INTO background_tasks(id,world_id,conversation_id,kind,state,idempotency_key,
    source_revision,attempt,not_before,lease_until,deferred_message_id,deferred_revision,deferred_expires_at,metadata_json)
    VALUES(?,?,?,'reply','pending',?,?,0,?,0,?,?,?,?)`,
  source: 'INSERT INTO task_sources(world_id,task_id,message_id,message_revision) VALUES(?,?,?,?)',
  reschedule: `UPDATE background_tasks SET state='pending',not_before=?,lease_until=0,error_code='',deferred_expires_at=?,metadata_json=?
    WHERE ${task} AND id=? AND state IN ('failed','cancelled')`,
  claim: `UPDATE background_tasks SET state='running',attempt=attempt+1,lease_until=? WHERE ${task} AND id=? AND state='pending'`,
  finish: `UPDATE background_tasks SET state=?,lease_until=0,error_code=? WHERE ${task} AND id=? AND state='running'`,
  accelerate: `UPDATE background_tasks SET not_before=min(not_before,?) WHERE ${task}
    AND state='pending' AND json_extract(metadata_json,'$.deferredReply.activityDelay')=1`,
})
