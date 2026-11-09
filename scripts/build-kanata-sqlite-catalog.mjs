import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  KANATA_SCHEMA_APPLICATION_ID, KANATA_SCHEMA_MIGRATIONS,
  KANATA_SCHEMA_VERSION, KANATA_REGISTRY_VALIDATION_QUERIES,
} from '../src/features/chat/storage/sqlite/kanataSchema.js'
import { KANATA_AUDIT_VALIDATION_QUERIES } from '../src/features/chat/storage/sqlite/kanataSchemaHardening.js'
import { KANATA_SCHEMA_SQL as schema, kanataSchemaObjectsAt } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { conversationQueries, conversationWrites, messageQueries, messageWrites } from '../src/features/chat/storage/sqlite/kanataRepositorySql.js'
import { dependentQueries, dependentWrites, updateEffectValue } from '../src/features/chat/storage/sqlite/kanataMessageDependentsSql.js'
import { deferredReplyQueries, deferredReplyWrites } from '../src/features/chat/storage/sqlite/kanataDeferredReplySql.js'

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
add('query', 'business', [...Object.values(messageQueries), ...Object.values(conversationQueries), ...Object.values(dependentQueries),
  ...Object.values(deferredReplyQueries)])
add('write', 'business', [...Object.values(messageWrites), ...Object.values(conversationWrites),
  ...Object.values(dependentWrites), ...Object.values(updateEffectValue), ...Object.values(deferredReplyWrites)])
if (process.argv.includes('--synthetic')) {
  const { m2FixtureCommands, auditInspection, fixtureWrites, futureSchema } = await import('../tests/helpers/kanataSqliteM2Fixture.js')
  add('query', 'business', Object.values(auditInspection))
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
