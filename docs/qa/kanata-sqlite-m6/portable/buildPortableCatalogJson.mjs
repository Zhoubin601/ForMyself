import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  KANATA_SCHEMA_005_FINGERPRINT,
  PORTABLE_TABLES,
  encodeSchema005CanonicalSequence,
} from '../../../../src/features/chat/backup/portable/catalog.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import { SYNTHETIC_INSTALL_ORDER } from './syntheticCodec.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const seq = encodeSchema005CanonicalSequence(KANATA_SCHEMA_MIGRATIONS)
const fp = createHash('sha256').update(seq).digest('hex')
if (fp !== KANATA_SCHEMA_005_FINGERPRINT) {
  throw new Error(`Schema fingerprint mismatch: ${fp} !== ${KANATA_SCHEMA_005_FINGERPRINT}`)
}

const payload = {
  version: 1,
  schemaVersion: 5,
  applicationId: 0x4b4e5441,
  schemaFingerprint: fp,
  installOrder: SYNTHETIC_INSTALL_ORDER,
  tables: PORTABLE_TABLES.map(t => ({
    tableId: t.tableId,
    name: t.name,
    category: t.category,
    hasOrdinal: t.hasOrdinal,
    pkColumns: t.pkColumns,
    columns: t.columns.map(c => ({
      name: c.name,
      cid: c.cid,
      type: c.type,
      notnull: c.notnull,
      pk: c.pk,
    })),
  })),
  migrations: KANATA_SCHEMA_MIGRATIONS.map(m => ({
    version: m.version,
    name: m.name,
    statements: m.statements,
  })),
}

const outPath = join(dir, 'kanata-portable-catalog-v1.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`Wrote ${outPath} (tables=${payload.tables.length}, fp=${fp})`)
