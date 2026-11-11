import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  KANATA_SCHEMA_APPLICATION_ID, KANATA_SCHEMA_MIGRATIONS,
  KANATA_SCHEMA_VERSION, KANATA_REGISTRY_VALIDATION_QUERIES,
} from '../src/features/chat/storage/sqlite/kanataSchema.js'
import { KANATA_AUDIT_VALIDATION_QUERIES } from '../src/features/chat/storage/sqlite/kanataSchemaHardening.js'
import { arrayOrderQueries } from '../src/features/chat/storage/sqlite/kanataArrayOrder.js'
import { KANATA_SCHEMA_SQL as schema, kanataSchemaObjectsAt } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { conversationQueries, conversationWrites, messageQueries, messageWrites } from '../src/features/chat/storage/sqlite/kanataRepositorySql.js'
import { dependentQueries, dependentWrites, updateEffectValue } from '../src/features/chat/storage/sqlite/kanataMessageDependentsSql.js'
import { historyArchiveQueries, historyArchiveWrites } from '../src/features/chat/storage/sqlite/kanataHistoryArchive.js'
import { deferredReplyQueries, deferredReplyWrites } from '../src/features/chat/storage/sqlite/kanataDeferredReplySql.js'

import { replyProofDdl, replyProofQueries, replyProofWrites } from '../src/features/chat/storage/sqlite/kanataReplyProvenance.js'
import { receiptQuery, receiptWrite } from '../src/features/chat/storage/sqlite/kanataDomainRows.js'
import { worldQueries, worldWrites } from '../src/features/chat/storage/sqlite/kanataWorldRepository.js'
import { characterQueries, characterWrites } from '../src/features/chat/storage/sqlite/kanataCharacterRepository.js'
import { lorebookQueries, lorebookWrites } from '../src/features/chat/storage/sqlite/kanataLorebookRepository.js'
import { provenanceQueries } from '../src/features/chat/storage/sqlite/kanataProvenance.js'
import { memoryQueries, memoryWrites } from '../src/features/chat/storage/sqlite/kanataMemoryRepository.js'
import { eventRevocationQueries, eventRevocationWrites } from '../src/features/chat/storage/sqlite/kanataEventRevocation.js'
import { eventReadQueries } from '../src/features/chat/storage/sqlite/kanataEventRead.js'
import { eventSnapshotQueries, eventSnapshotWrites, eventIntegrityDdl } from '../src/features/chat/storage/sqlite/kanataEventSnapshot.js'
import { eventProofDdl, eventProofQueries, eventProofWrites } from '../src/features/chat/storage/sqlite/kanataEventProof.js'
import { eventQueries, eventWrites, legacyEventDdl } from '../src/features/chat/storage/sqlite/kanataEventRepository.js'
import { autonomyQueries, autonomyWrites } from '../src/features/chat/storage/sqlite/kanataAutonomyRepository.js'
import { usageQueries, usageWrites } from '../src/features/chat/storage/sqlite/kanataUsageRepository.js'

import { chatViewQueries } from '../src/features/chat/storage/sqlite/kanataChatViewRepository.js'

import { managementViewQueries } from '../src/features/chat/storage/sqlite/kanataManagementViewRepository.js'

import { bindingQueries, bindingWrites } from '../src/features/chat/storage/sqlite/kanataRoleBindingRepository.js'

const output = process.argv[2]
if (!output) throw new Error('Catalog output directory required')
const statements = {}
const fingerprint = sql => createHash('sha256').update(sql, 'utf8').digest('hex')
function add(mode, phase, queries) {
  for (const sql of queries) {
    const id = fingerprint(sql)
    const previous = statements[id]
    if (previous && (previous.mode !== mode || previous.phase !== phase || previous.sql !== sql)) {
      throw new Error('Ambiguous SQLite catalog statement')
    }
    const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g) ?? []
    statements[id] = { mode, phase, sql, arity: tokens.filter(token => token === '?').length }
  }
}
add('query', 'schema', [
  schema.version, schema.foreignKeys, schema.applicationId, schema.objects, schema.journal, schema.times,
  schema.foreignKeyCheck, ...KANATA_AUDIT_VALIDATION_QUERIES, ...KANATA_REGISTRY_VALIDATION_QUERIES,
])
add('write', 'schema', [schema.insertJournal, schema.insertTime])
add('ddl', 'schema', [
  schema.setApplicationId,
  ...KANATA_SCHEMA_MIGRATIONS.flatMap(migration => [...migration.statements, schema.setVersion(migration.version)]),
])
add('ddl', 'business', [...replyProofDdl, ...eventProofDdl, ...legacyEventDdl, ...eventIntegrityDdl])
add('query', 'business', eventProofQueries)
add('write', 'business', eventProofWrites)
add('query', 'business', replyProofQueries)
add('write', 'business', replyProofWrites)
add('query', 'business', [...Object.values(messageQueries), ...Object.values(conversationQueries), ...Object.values(dependentQueries),
  ...Object.values(deferredReplyQueries), ...historyArchiveQueries])
add('write', 'business', [...Object.values(messageWrites), ...Object.values(conversationWrites),
  ...Object.values(dependentWrites), ...Object.values(updateEffectValue), ...Object.values(deferredReplyWrites), ...historyArchiveWrites])
add('query', 'business', [...arrayOrderQueries, receiptQuery, ...worldQueries, ...characterQueries, ...lorebookQueries, ...provenanceQueries,
  ...memoryQueries, ...eventReadQueries, ...eventSnapshotQueries, ...eventQueries, ...eventRevocationQueries, ...autonomyQueries, ...usageQueries, ...chatViewQueries, ...managementViewQueries, ...bindingQueries])
add('write', 'business', [receiptWrite, ...worldWrites, ...characterWrites, ...lorebookWrites, ...memoryWrites,
  ...eventSnapshotWrites, ...eventWrites, ...eventRevocationWrites, ...autonomyWrites, ...usageWrites, ...bindingWrites])
if (process.argv.includes('--synthetic')) {
  const { orderLegacyCounts, orderCounts, orderSchemaOrphan, orderBusinessOrphan, orderMutations } =
    await import('../docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/schema005-device.mjs')
  add('query', 'schema', [orderLegacyCounts])
  add('write', 'schema', [orderSchemaOrphan])
  add('query', 'business', [orderCounts])
  add('write', 'business', [orderBusinessOrphan, ...orderMutations])
  const { m2FixtureCommands, auditInspection, fixtureWrites, futureSchema } = await import('../tests/helpers/kanataSqliteM2Fixture.js')
  const { growthSeedSql } = await import('../docs/qa/kanata-sqlite-m4/fixture.mjs')
  add('query', 'business', Object.values(auditInspection))
  add('query', 'business', [...eventRevocationQueries.slice(1,6), ...eventRevocationWrites]
    .map(sql => 'EXPLAIN QUERY PLAN ' + sql))
  const { memoryRows, memoryEdges, memoryWideSources, eventRows, eventEdges, eventFanout, replayEventRows, replayEffectRows, fanoutAuditInspection,
    fanoutAnalyze, fanoutClearStats, fanoutReloadStats, fanoutCyclePlan, grantOriginActors, grantOrigins, grantMessageTags,
    chatEventActor, chatEventSource, chatReplyTagCheck, eventReadEffects, eventReadAudits, eventReadRevision, eventReadShapeEdges, eventReadPublic } = await import('../docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
  add('write', 'business', [eventReadEffects, eventReadAudits, eventReadRevision, eventReadShapeEdges, eventReadPublic])
  add('query', 'business', [fanoutAuditInspection, fanoutCyclePlan, chatReplyTagCheck])
  add('write', 'business', [fanoutClearStats])
  add('ddl', 'business', [fanoutAnalyze, fanoutReloadStats])
  add('write', 'business', [growthSeedSql, memoryRows, memoryEdges, memoryWideSources, eventRows, eventEdges, eventFanout, replayEventRows, replayEffectRows, grantOriginActors, grantOrigins, grantMessageTags, chatEventActor, chatEventSource])
  add('write', 'business', [...m2FixtureCommands().map(command => command.sql), ...Object.values(fixtureWrites)])
  add('ddl', 'business', [futureSchema])
}
await mkdir(output, { recursive: true })
await writeFile(join(output, 'kanata-sqlite-catalog.json'), JSON.stringify({
  applicationId: KANATA_SCHEMA_APPLICATION_ID,
  version: KANATA_SCHEMA_VERSION,
  statements,
  schemas: Array.from({ length: KANATA_SCHEMA_VERSION + 1 }, (_, version) =>
    Object.fromEntries(kanataSchemaObjectsAt(version).map(({ name, type, sql }) => [name, [type, fingerprint(sql)]]))),
  journal: KANATA_SCHEMA_MIGRATIONS.map(({ version, name, statements }) => ({
    version, name, checksum: fingerprint(JSON.stringify([version, name, statements])),
  })),
  legacyAuditChecks: KANATA_AUDIT_VALIDATION_QUERIES,
  legacyRegistryChecks: KANATA_REGISTRY_VALIDATION_QUERIES,
}) + '\n')
