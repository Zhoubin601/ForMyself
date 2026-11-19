import { KANATA_MIGRATION_TABLES } from '../../../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'
import { sha256Text } from '../../../src/shared/crypto/sha256Text.js'
import { KANATA_DATA_PATH, KANATA_RECOVERY_KEY } from '../../../src/features/chat/storage/kanataRepository.js'

export const tableAlgorithm = 'kanata-m5-table-v1'
export const aggregateAlgorithm = 'm5-table-receipt-v1'
export const emptyTableText = name => 'kanata-m5-empty-v1:' + name
export const receiptInput = tables => JSON.stringify(tables.map(({ name, count, empty, sha256 }) => [name, count, empty, sha256]))
export const tableDigestSql = (name, columns) => 'SELECT rowid AS __rowid,' + columns.join(',')
  + ' FROM ' + name + ' WHERE rowid>? ORDER BY rowid LIMIT 50'
const need = (ok, code) => { if (!ok) throw Error(code) }

/** Re-read the actual SQLCipher target through the same fixed catalog. */
export async function targetReceipt(tx, manifest) {
  const tables = []
  for (const name of KANATA_MIGRATION_TABLES) {
    const expected = manifest.tables[name]
    if (!expected) {
      const [row] = await tx.query('SELECT count(*) AS count FROM ' + name)
      need(row?.count === 0, 'M5_RECEIPT_NONEMPTY_TABLE')
      tables.push({ name, count: 0, empty: true, sha256: sha256Text(emptyTableText(name)) })
      continue
    }
    const { columns } = expected
    need(Array.isArray(columns) && columns.length > 0 && columns.every(col => /^[a-z_]+$/.test(col)),
      'M5_RECEIPT_INVALID_COLUMNS')
    let sha256 = sha256Text(tableAlgorithm + ':' + name + ':' + columns.join(','))
    let count = 0, cursor = -1
    const sql = tableDigestSql(name, columns)
    while (true) {
      const rows = await tx.query(sql, [cursor])
      for (const row of rows) {
        sha256 = sha256Text(sha256 + JSON.stringify(columns.map(col => row[col])))
        cursor = row.__rowid
        count++
      }
      if (rows.length < 50) break
    }
    need(count === expected.count && sha256 === expected.digest && count > 0, 'M5_RECEIPT_TABLE_MISMATCH')
    tables.push({ name, count, empty: false, sha256 })
  }
  return { tableAlgorithm, aggregateAlgorithm, tables, aggregateSha256: sha256Text(receiptInput(tables)) }
}

export function sourceHashes(legacy) {
  const archives = [...legacy.files].filter(([name]) => name.includes('/kanata-pages-v1/'))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => [name, sha256Text(value)])
  const primary = legacy.files.get(KANATA_DATA_PATH)
  const journal = legacy.values.get(KANATA_RECOVERY_KEY)
  return { primarySha256: primary === undefined ? null : sha256Text(primary),
    archivesSha256: sha256Text(JSON.stringify(archives)), archiveCount: archives.length,
    journalSha256: journal == null ? null : sha256Text(journal) }
}

export function sourceReceipt(legacy, before, assertReadOnly) {
  assertReadOnly()
  const after = sourceHashes(legacy)
  need(JSON.stringify(before) === JSON.stringify(after), 'M5_SOURCE_RECEIPT_MISMATCH')
  const calls = Object.fromEntries(['read', 'stat', 'list', 'write', 'rename', 'delete'].map(op =>
    [op, legacy.calls.filter(call => call.operation === op).length]))
  return { before, after, calls }
}
