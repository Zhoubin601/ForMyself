import type {
  KanataDataMigrationSource, KanataDataMigratorOptions, KanataSqliteOperation, MessageArchiveDescriptor,
} from '../../src/application/contracts'

declare const operation: KanataSqliteOperation
declare const source: KanataDataMigrationSource
declare const descriptors: MessageArchiveDescriptor[]

const options: KanataDataMigratorOptions = { operation, source, syntheticOnly: true }
source.inspectArchives?.(descriptors, 'synthetic', () => {})
// @ts-expect-error archive inspection must receive the current operation guard
source.inspectArchives?.(descriptors, 'synthetic')
// @ts-expect-error even a source conforming to the read contract requires synthetic authorization
const unauthorized: KanataDataMigratorOptions = { ...options, syntheticOnly: false }
// @ts-expect-error a source may not omit the Repository pending and save error flags
const invalidRead: KanataDataMigrationSource['read'] = async () => ({
  status: 'missing', data: null, fingerprint: '', recovered: false,
})
void invalidRead
void unauthorized
