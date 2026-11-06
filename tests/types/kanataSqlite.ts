import {migrateKanataSchema} from '../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import {KANATA_SCHEMA_MIGRATIONS} from '../../src/features/chat/storage/sqlite/kanataSchema.js'
import type {KanataSchemaConnection,KanataSchemaTransaction,KanataSchemaResult,KanataSchemaMigrator,KanataSchemaMigration} from '../../src/application/contracts'
declare const connection: KanataSchemaConnection
declare const transaction: KanataSchemaTransaction
const migrate: KanataSchemaMigrator = migrateKanataSchema
const result: Promise<KanataSchemaResult> = migrate(connection)
const ordered: readonly KanataSchemaMigration[] = KANATA_SCHEMA_MIGRATIONS
void result
void ordered
transaction.execute('SELECT ?', ['synthetic'])
// @ts-expect-error a preference driver is not an exclusive SQL transaction connection
migrateKanataSchema({get: async () => ({value:null}), set: async () => {}})
// @ts-expect-error keys/lease objects cannot be bound as SQL values
transaction.execute('SELECT ?', [{password:'synthetic-only'}])
// @ts-expect-error SQL bindings must be an ordered list, not text coercion
transaction.query('SELECT ?', 'synthetic')
// @ts-expect-error a callback body returning void cannot fulfill a generic transaction contract
const broken: KanataSchemaConnection = {transaction: async (_operation) => undefined}
void broken
// @ts-expect-error consumers cannot mutate the migration chain
KANATA_SCHEMA_MIGRATIONS.push({version:3,name:'unsafe',statements:[]})
// @ts-expect-error migration results do not expose a writable connection or credential
result.then(r => r.password)
