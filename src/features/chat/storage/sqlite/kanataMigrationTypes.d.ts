import type { JsonValue, Message, MessageArchiveDescriptor } from '../../domain/kanataTypes'
import type { KanataReadResult } from '../kanataRepositoryTypes'
import type { KanataSqliteOperation, KanataSqliteTransaction } from '../../../../platform/storage/kanataSqliteTypes'

/** Injected source for the isolated M5 importer. It does not expose persistence or cleanup. */
export interface KanataDataMigrationSource {
  read(password: string): Promise<KanataReadResult & { hasPendingSave: boolean; saveError: string }>
  inspectArchives?(descriptors: MessageArchiveDescriptor[], password: string, assertCurrent: () => void): Promise<void>
  readArchive?(descriptor: MessageArchiveDescriptor, password: string, assertCurrent: () => void): Promise<Message[]>
}
export interface KanataDataMigratorOptions {
  operation: KanataSqliteOperation
  source: KanataDataMigrationSource
  syntheticOnly: true
  batchSize?: number
  assertCurrent?: () => void
}

export interface KanataMigrationBatch<T> {
  readonly items: readonly T[]
  readonly nextCursor: JsonValue
  readonly done: boolean
}
export interface KanataMigrationCollection<T = unknown> {
  readonly name: string
  readonly expectedCount: number
  readBatch(cursor: JsonValue, limit: number): Promise<KanataMigrationBatch<T>>
  write(tx: KanataSqliteTransaction, item: T): Promise<void>
  verify(tx: KanataSqliteTransaction, context: {
    collection: string
    expectedCount: number
    importedCount: number
    sourceFingerprint: string
  }): Promise<void> | void
}
export interface KanataDataMigrationRequest {
  readonly syntheticOnly: true
  readonly sourceFingerprint: string
  readonly collections: readonly KanataMigrationCollection[]
  readonly verify: (tx: KanataSqliteTransaction, context: {
    sourceFingerprint: string
    targetSchemaVersion: number
    collections: readonly {collection: string; importedCount: number; resumed: boolean}[]
  }) => Promise<void> | void
  readonly assertCurrent?: () => void
}
export interface KanataMigrationCoordinator {
  run(request: KanataDataMigrationRequest): Promise<{
    state: 'complete'
    sourceFingerprint: string
    targetSchemaVersion: number
    collections: readonly {collection: string; importedCount: number; resumed: boolean}[]
    resumed: boolean
  }>
}
export declare function createKanataMigrationCoordinator(options: {
  operation: KanataSqliteOperation
  targetSchemaVersion?: number
  batchSize?: number
}): KanataMigrationCoordinator
export declare function kanataMigrationSourceFingerprint(
  mainCiphertextFingerprint: string,
  archives?: readonly {
    version: number
    key: string
    worldId: string
    conversationId: string
    bytes: number
    index: string
    messages: readonly {id: string; revision: number; createdAt: number}[]
  }[],
): string
