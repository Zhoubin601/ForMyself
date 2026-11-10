// @ts-check
import { createKanataMessageRepository } from './kanataMessageRepository.js'
import { conversationQueries } from './kanataRepositorySql.js'
import { scopeBindings } from './kanataRepositoryValues.js'
import { createKanataDeferredReplyRepository } from './kanataDeferredReplyRepository.js'

/** @typedef {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} Operation */
/** @typedef {import('./kanataRepositoryTypes').KanataMessageScope} Scope */
/** @typedef {import('../../domain/kanataTypes').Message} Message */
/** @typedef {Parameters<ReturnType<typeof createKanataDeferredReplyRepository>['schedule']>[1]} Deferred */

/** @param {Operation} operation @param {{id:()=>string,clock:()=>number}} tools */
export function createKanataTurnRepository(operation, tools) {
  return {
    /** @param {Scope} scope @param {{source:Message,retry:boolean,conversationRevision:number,deferred?:Deferred}} command */
    save: (scope, { source, retry, conversationRevision, deferred }) => operation.transaction(async tx => {
      if (source.worldId !== scope.worldId || source.conversationId !== scope.conversationId) throw new Error('KANATA_TURN_SCOPE_DENIED')
      const [conversation] = await tx.query(conversationQueries.get, scopeBindings(scope))
      if (!conversation || conversation.type === 'character' || conversation.revision !== conversationRevision) {
        throw new Error('STALE_CONTEXT')
      }
      /** @type {Operation} */
      const unit = { transaction: work => work(tx), health: operation.health }
      const messages = createKanataMessageRepository(unit, tools)
      const replies = createKanataDeferredReplyRepository(unit)
      if (!retry) await messages.insert(source)
      const latest = await messages.latestState(scope, 'user')
      if (!latest || latest.id !== source.id || latest.revision !== source.revision || latest.deleted || latest.status !== 'complete') {
        throw new Error('STALE_TURN')
      }
      if (deferred) {
        if (source.id !== deferred.sourceId || source.revision !== deferred.sourceRevision) throw new Error('KANATA_TURN_SOURCE_INVALID')
        await replies.schedule(scope, deferred, retry)
        return replies.pending(scope)
      }
      await replies.cancel(scope)
      return null
    }),
  }
}
