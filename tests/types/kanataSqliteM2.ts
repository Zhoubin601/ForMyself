import type { KanataSqliteDriver, KanataSqliteOperation, KanataMessageCursor, KanataMessageScope } from '../../src/application/contracts'
import { createAndroidKanataSqliteDriver } from '../../src/platform/storage/androidKanataSqliteDriver.js'
import { kanataSchemaAdapter } from '../../src/features/chat/storage/sqlite/kanataSchemaAdapter.js'
import { createKanataMessageRepository } from '../../src/features/chat/storage/sqlite/kanataMessageRepository.js'
import { createKanataConversationRepository } from '../../src/features/chat/storage/sqlite/kanataConversationRepository.js'
import { migrateKanataSchema } from '../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'

const driver: KanataSqliteDriver = createAndroidKanataSqliteDriver({
  initialize: async operation => { await migrateKanataSchema(kanataSchemaAdapter(operation)) },
})
declare const operation: KanataSqliteOperation
const messages = createKanataMessageRepository(operation, { id: () => 'synthetic-id', clock: () => 0 })
const conversations = createKanataConversationRepository(operation)
const scope: KanataMessageScope = { worldId: 'world', conversationId: 'conversation' }
const cursor: KanataMessageCursor = { ...scope, version: 1, createdAt: 0, id: 'anchor' }
void messages.older(scope, cursor)
void messages.revise(scope,'message',1,{content:'edited',deleted:false}).then(receipt=>{
  const result: import('../../src/application/contracts').KanataMessageWriteReceipt = receipt
  void result.revision
  // @ts-expect-error Ordinary write receipts must not expose full provenance or opaque extensions.
  void result.lifeSources
  // @ts-expect-error A write receipt does not carry a message body.
  void result.content
})
void conversations.get(scope)
void operation.transaction(async transaction => {
  const result: number = (await transaction.execute('known write', [1, null, 'bound'])).affectedRows
  // @ts-expect-error A transaction cannot open a nested transaction.
  await transaction.transaction(async () => result)
  // @ts-expect-error SQL parameters are scalar, not arbitrary JSON objects.
  await transaction.execute('known write', [{ payload: 'invalid' }])
  return result
})
// @ts-expect-error The M1 adapter returns void and cannot stand in for a CAS operation.
createKanataMessageRepository(kanataSchemaAdapter(operation), { id: () => 'synthetic-id', clock: () => 0 })
// @ts-expect-error A conversation ID alone is not a message scope.
void messages.recent({ conversationId: 'conversation' })
// @ts-expect-error Other cursor versions are rejected.
void messages.older(scope, { ...cursor, version: 2 })
// @ts-expect-error Unsupported in-flight statuses cannot persist.
void messages.setStatus(scope, 'message', 1, 'streaming')
// @ts-expect-error Opening requires a scoped protected context.
void driver.open({ password: 'synthetic' }, { create: false })
