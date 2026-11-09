// @ts-check
import { validateId } from '../../domain/kanataValidation.js'
import { deferredReplyQueries as query, deferredReplyWrites as write } from './kanataDeferredReplySql.js'
import { messageQueries } from './kanataRepositorySql.js'
import { requireSqliteValue as need, safeInteger, scopeBindings } from './kanataRepositoryValues.js'

/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('./kanataRepositoryTypes').KanataDeferredReply} Task */
/** @typedef {import('./kanataSchemaTypes').KanataSqlRow} Row */
/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteTransaction} Transaction */

/** @param {Row} row @returns {Task} */
function taskFromRow(row) {
  const metadata = JSON.parse(String(row.metadata_json))
  return {
    id: String(row.id), sourceId: String(row.deferred_message_id), sourceRevision: Number(row.deferred_revision),
    notBefore: Number(row.not_before), expiresAt: Number(row.deferred_expires_at),
    activityDelay: metadata.deferredReply?.activityDelay === true,
  }
}

/** @param {Transaction} tx @param {string[]} bindings @param {Pick<Task,'sourceId'|'sourceRevision'>} expected */
async function currentSource(tx, bindings, expected) {
  const [source] = await tx.query(messageQueries.latest, [...bindings, 'user'])
  return source?.id === expected.sourceId && source.revision === expected.sourceRevision
    && source.status === 'complete' && source.deleted !== 1
}

/** Only reply delays owned by this message slice. Other task kinds have no access here.
 * @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation */
export function createKanataDeferredReplyRepository(operation) {
  const run = operation.transaction
  return {
    /** @param {Scope} scope */
    pending: scope => run(async tx => {
      const [row] = await tx.query(query.pending, scopeBindings(scope))
      return row ? taskFromRow(row) : null
    }),
    /** @param {Scope} scope @param {Task} task @param {boolean} retry */
    schedule: (scope, task, retry) => run(async tx => {
      validateId(task.id, 'taskId')
      validateId(task.sourceId, 'messageId')
      need(safeInteger(task.sourceRevision, 1) && safeInteger(task.notBefore) && safeInteger(task.expiresAt, task.notBefore),
        'KANATA_DEFERRED_INVALID')
      const bindings = scopeBindings(scope)
      need(await currentSource(tx, bindings, task), 'STALE_TURN')
      await tx.execute(write.superseded, [...bindings, task.sourceId])
      const key = `deferred-reply-v1:${task.sourceId}:${task.sourceRevision}`
      const [previous] = await tx.query(query.prior, [...bindings, key])
      const metadata = JSON.stringify({ deferredReply: { activityDelay: task.activityDelay } })
      if (!previous) {
        need((await tx.execute(write.create, [task.id, ...bindings, key, task.sourceRevision, task.notBefore,
          task.sourceId, task.sourceRevision, task.expiresAt, metadata])).affectedRows === 1, 'KANATA_DEFERRED_INVALID')
        need((await tx.execute(write.source, [scope.worldId, task.id, task.sourceId, task.sourceRevision])).affectedRows === 1,
          'KANATA_DEFERRED_INVALID')
      } else if (retry && (previous.state === 'failed' || previous.state === 'cancelled')) {
        await tx.execute(write.reschedule, [task.notBefore, task.expiresAt, metadata, ...bindings, previous.id])
      }
    }),
    /** @param {Scope} scope */
    cancel: scope => run(async tx => { await tx.execute(write.cancel, scopeBindings(scope)) }),
    /** @param {Scope} scope @param {number} now */
    accelerate: (scope, now) => run(async tx => { await tx.execute(write.accelerate, [now, ...scopeBindings(scope)]) }),
    /** @param {Scope} scope @param {number} now */
    claim: (scope, now) => run(async tx => {
      const bindings = scopeBindings(scope)
      await tx.execute(write.expireLease, [...bindings, now])
      const [row] = await tx.query(query.pending, bindings)
      if (!row) return null
      const task = taskFromRow(row)
      if (task.notBefore > now) return null
      if (task.expiresAt < now || !await currentSource(tx, bindings, task)) {
        await tx.execute(write.abandon, [...bindings, task.id])
        return null
      }
      need((await tx.execute(write.claim, [now + 120000, ...bindings, task.id])).affectedRows === 1, 'KANATA_DEFERRED_INVALID')
      return task
    }),
    /** @param {Scope} scope @param {string} taskId @param {boolean} success */
    finish: (scope, taskId, success) => run(async tx => {
      await tx.execute(write.finish, [success ? 'succeeded' : 'failed',
        success ? '' : 'DEFERRED_REPLY_FAILED', ...scopeBindings(scope), taskId])
    }),
  }
}
