import { registerPlugin } from '@capacitor/core'
import { createAndroidKanataSqliteDriver } from '../../../src/platform/storage/androidKanataSqliteDriver.js'
import { deriveKanataSqliteKek } from '../../../src/platform/security/kanataSqliteKek.js'
import { migrateKanataSchema } from '../../../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { createKanataDataMigrator } from '../../../src/features/chat/storage/sqlite/kanataDataMigrator.js'
import { kanataMigrationInsert } from '../../../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'
import { sha256Text } from '../../../src/shared/crypto/sha256Text.js'
import { KANATA_DATA_PATH, KANATA_BACKUP_PATH, KANATA_RECOVERY_KEY } from '../../../src/features/chat/storage/kanataRepository.js'
import { encryptedFixture, unpackFixture, inspectSql, nativeQuery } from './fixture.mjs'

if (document.title !== 'M2_SQLCIPHER_SYNTHETIC' || location.origin !== 'https://localhost'
    || !window.Capacitor?.isNativePlatform()) throw Error('M5_ISOLATED_ANDROID_PAGE_REQUIRED')

const bridge = registerPlugin('KanataSqlite')
const driver = createAndroidKanataSqliteDriver({ bridge, initialize: migrateKanataSchema })
let revision = 0
let prepared
let phase = 'idle'
let checkPausedSource
const ensure = (condition, code) => { if (!condition) throw Error(code) }
const block = reason => {
  phase = reason
  return new Promise(() => {})
}

function operationFor(native, fault, trace) {
  return {
    async transaction(action) {
      let archiveBatch = false, datasetBatch = false, inserted = 0, cursorCount = 0, messageBatch = false
      const started = performance.now()
      const result = await native.transaction(tx => action({
        async query(sql, values) {
          if (fault === 'before-verification' && sql.includes('FROM data_migrations ORDER BY collection')) await block(fault)
          return tx.query(nativeQuery(sql), values)
        },
        async execute(sql, values) {
          const result = await tx.execute(sql, values)
          trace.writes++
          if (sql.startsWith('INSERT INTO dataset_metadata(')) datasetBatch = true
          if (datasetBatch && fault === 'before-first-commit' && sql.startsWith("UPDATE data_migrations SET state='running'")) {
            await block(fault)
          }
          if (sql.startsWith('INSERT INTO archived_message_marks(')) {
            archiveBatch = true
            if (fault === 'during-batch') await block(fault)
          }
          if (sql.startsWith('INSERT INTO messages(')) {
            messageBatch = true
            inserted += result.affectedRows
          }
          if (sql.startsWith('UPDATE data_migrations SET cursor_json=')) cursorCount++
          return result
        },
      }))
      if (messageBatch) {
        ensure(inserted > 0 && inserted <= 50 && cursorCount === 1, 'M5_NATIVE_BATCH_NOT_ATOMIC')
        trace.messageBatches++
        trace.maxBatch = Math.max(trace.maxBatch, inserted)
        trace.batchMs.push(performance.now() - started)
      }
      if (archiveBatch && fault === 'after-batch-commit') await block(fault)
      return result
    },
  }
}

async function open(key, create) {
  const generation = ++revision
  return driver.open({
    sessionRevision: generation, ownerGeneration: generation,
    assertCurrent() { ensure(revision === generation, 'M5_NATIVE_OWNER_REVOKED') },
    deriveKey: salt => deriveKanataSqliteKek(key, salt),
  }, { create })
}

async function audit(operation) {
  return operation.transaction(async tx => {
    const [manifest] = await tx.query(inspectSql.manifest)
    const [archive] = await tx.query(inspectSql.archive)
    return {
      manifest: manifest?.state ?? null,
      dataset: (await tx.query(inspectSql.dataset))[0].count,
      archive: archive ? { ...archive, cursor_json: JSON.parse(archive.cursor_json) } : null,
      messages: (await tx.query(inspectSql.messages))[0].count,
      marks: (await tx.query(inspectSql.marks))[0].count,
      lifeSources: (await tx.query(inspectSql.lifeSources))[0].count,
    }
  })
}

async function verifyRows(operation, scope, count) {
  return operation.transaction(async tx => {
    const [manifest] = await tx.query(inspectSql.manifest)
    const [row] = await tx.query(inspectSql.first, ['m5-history-000000'])
    const scopeParams = [scope.worldId, scope.conversationId]
    let start = performance.now()
    const recent = await tx.query(inspectSql.recent, scopeParams)
    const recentMs = performance.now() - start
    const last = recent.at(-1)
    start = performance.now()
    const older = await tx.query(inspectSql.older, [...scopeParams, last.created_at, last.id])
    const olderMs = performance.now() - start
    ensure(manifest.state === 'complete' && manifest.extensions_json, 'M5_NATIVE_MANIFEST_NOT_COMPLETE')
    ensure(row?.content === '合成历史🚀 Café 0' && JSON.parse(row.extensions_json).m5Extension?.seed === 'm5-06-v1',
      'M5_NATIVE_PAYLOAD_MISMATCH')
    ensure(recent.length === Math.min(count, 50) && older.length === Math.min(count - recent.length, 50)
      && recent[0].id === 'message-two' && new Set([...recent, ...older].map(message => message.id)).size === recent.length + older.length,
    'M5_NATIVE_PAGE_MISMATCH')
    return { recentMs, olderMs, recentRows: recent.length, olderRows: older.length,
      tables: JSON.parse(manifest.extensions_json).tables,
      foreignKeyViolations: (await tx.query(nativeQuery('PRAGMA foreign_key_check'))).length,
      integrity: (await tx.query(nativeQuery('PRAGMA integrity_check')))[0].integrity_check,
    }
  })
}

window.m5Qa = {
  async setup(data, count, password, exportFixture) {
    const { legacy, primaryHash, scope } = await encryptedFixture(data, count, password)
    const journal = legacy.values.get(KANATA_RECOVERY_KEY)
    const files = [...legacy.files]
    await legacy.release()
    prepared = { files, journal, scope, count, primaryHash }
    return exportFixture ? prepared : { primaryHash }
  },
  load(fixture) { prepared = fixture },
  phase: () => phase,
  assertPausedSource() {
    checkPausedSource()
    return true
  },
  async run({ password, key, create, fault, negative, repeat = false }) {
    phase = 'opening'
    const timing = { messageBatches: 0, maxBatch: 0, batchMs: [], writes: 0 }
    let native, legacy, assertReadOnly, summary
    try {
      native = await open(negative === 'wrong-key' ? key + '-different' : key, create)
      const operation = operationFor(native, fault, timing)
      if (negative === 'occupied') {
        const command = kanataMigrationInsert('dataset_metadata', {
          singleton: 1, user_id: 'm5-occupied', data_version: 1, extensions_json: '{}',
        })
        await operation.transaction(tx => tx.execute(command.sql, command.values))
      }
      const before = await audit(operation)
      const writesBefore = timing.writes
      legacy = unpackFixture(prepared, (files, values) => {
        if (negative === 'recovered') {
          files.set(KANATA_BACKUP_PATH, files.get(KANATA_DATA_PATH))
          files.delete(KANATA_DATA_PATH)
          values.delete(KANATA_RECOVERY_KEY)
        }
        if (negative !== 'corrupt-page') return
        const page = [...files.keys()].find(path => path.includes('/kanata-pages-v1/'))
        const ciphertext = files.get(page)
        files.set(page, (ciphertext[0] === 'X' ? 'Y' : 'X') + ciphertext.slice(1))
      })
      assertReadOnly = legacy.seal()
      checkPausedSource = assertReadOnly
      const migrator = createKanataDataMigrator({ operation, source: legacy.source, syntheticOnly: true })
      phase = 'importing'
      const started = performance.now()
      let result
      try {
        result = await migrator.migrate(password)
      } catch (error) {
        assertReadOnly()
        summary = { before, after: await audit(operation), error: error.code ?? 'M5_QA_UNEXPECTED_IMPORT_ERROR',
          writes: timing.writes - writesBefore, sourceUnchanged: true }
        return summary
      }
      const totalMs = performance.now() - started
      const rows = await verifyRows(operation, prepared.scope, prepared.count)
      const writesBeforeRepeat = timing.writes
      const repeated = repeat ? await migrator.migrate(password) : undefined
      ensure(!repeat || timing.writes === writesBeforeRepeat, 'M5_NATIVE_REPEAT_WROTE_ROWS')
      assertReadOnly()
      summary = { result, before, rows, repeated: repeated?.status, totalMs, ...timing,
        health: await native.health(), sourceUnchanged: true }
      return summary
    } catch (error) {
      return { error: error.code ?? (/^M5_[A-Z_]+$/.test(error.message) ? error.message : 'M5_QA_UNEXPECTED_ERROR') }
    } finally {
      checkPausedSource = undefined
      await legacy?.release()
      if (native) {
        await driver.release()
        let closed = false
        try { await native.health() }
        catch (error) { closed = error.code === 'KANATA_SQLITE_LEASE_REVOKED' }
        ensure(closed, 'M5_NATIVE_LEASE_RETAINED')
        if (summary) summary.leaseRevoked = closed
      }
      phase = 'finished'
    }
  },
  sourceFilesSha() {
    return sha256Text(JSON.stringify([prepared.files.map(([path, wire]) => [path, sha256Text(wire)]), sha256Text(prepared.journal)]))
  },
}
