import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  encryptKanataData, KANATA_DATA_PATH, KANATA_BACKUP_PATH, KANATA_TEMP_PATH, KANATA_RECOVERY_KEY,
} from '../src/features/chat/storage/kanataRepository.js'
import { decryptPassphraseAes, encryptPassphraseAes } from '../src/shared/crypto/passphraseAes.js'
import { createKanataDataMigrator } from '../src/features/chat/storage/sqlite/kanataDataMigrator.js'
import { KANATA_MIGRATION_TABLES } from '../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'
import { migrateKanataSchema } from '../src/features/chat/storage/sqlite/kanataSchemaMigrator.js'
import { kanataSqliteFixture } from './helpers/kanataSqliteFixture.js'
import { schemaHarness } from './helpers/kanataSqliteHarness.js'
import { ARCHIVE_PASSWORD as password } from './helpers/kanataArchiveFixture.js'
import { archivePath, kanataSqliteEncryptedLegacySource } from './helpers/kanataSqliteEncryptedLegacySource.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const errorCode = code => ({ code })
const seal = (t, legacy, pending = false) => {
  legacy.seal(t)
  t.after(async () => {
    if (pending) await assert.rejects(legacy.release(), errorCode('KANATA_PENDING_SAVE'))
    else await legacy.release()
  })
}

async function fixture(version = 2) {
  const legacy = kanataSqliteEncryptedLegacySource()
  const data = kanataSqliteFixture()
  data.version = version
  const active = data.messages[0]
  active.m5Extension = { text: '合成🚀', array: [null, { enabled: false }] }
  const { worldId, conversationId } = active
  const history = [], descriptors = []
  if (version === 2) {
    for (let page = 0; page < 2; page++) {
      const items = ['a', 'b', 'c'].map((suffix, offset) => ({
        ...active, id: 'm5-history-' + page + '-' + suffix, createdAt: 100 * (page + 1) + Math.min(offset, 1),
        content: '合成归档🚀 Cafe\u0301 ' + page + suffix, revision: offset + 1,
      }))
      history.push(...items)
      descriptors.push(await legacy.repository.archives.write(items.reverse(), password, { worldId, conversationId }))
    }
    // Store the later page first so the test also exercises ordering between descriptors.
    data.messageArchives = [...descriptors].reverse()
  }
  legacy.files.set(KANATA_DATA_PATH, encryptKanataData(data, password))
  return { ...legacy, data, history, descriptors }
}

async function target(t, legacy, options = {}) {
  const { db, connection, writes, close } = schemaHarness(':memory:', { beforeExecute: options.beforeExecute })
  t.after(close)
  const operation = {
    transaction: action => connection.transaction(tx => action({
      query: tx.query,
      async execute(sql, parameters) {
        await tx.execute(sql, parameters)
        return { affectedRows: db.prepare('SELECT changes() AS n').get().n }
      },
    })),
  }
  await migrateKanataSchema(operation)
  writes.length = 0
  const migrator = createKanataDataMigrator({
    operation, source: legacy.source, syntheticOnly: true, batchSize: 2, assertCurrent: options.assertCurrent,
  })
  return { db, writes, migrate: (key = password) => migrator.migrate(key) }
}

function assertUntouched({ db, writes }) {
  assert.deepEqual(writes, [], 'no target write was attempted')
  for (const table of [...KANATA_MIGRATION_TABLES, 'data_migrations']) {
    assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table)
  }
}

const archiveReads = legacy => legacy.calls
  .filter(({ operation, path }) => operation === 'read' && path !== KANATA_DATA_PATH)
  .map(({ path }) => path)

for (const version of [1, 2]) {
  test('M5-05 encrypted KanataData v' + version + ' migrates and verifies without changing the legacy source', async t => {
    const legacy = await fixture(version)
    const ciphertext = legacy.files.get(KANATA_DATA_PATH)
    // A previously committed recovery record is valid and redundant. Reading it must leave it byte-identical.
    legacy.values.set(KANATA_RECOVERY_KEY, JSON.stringify({
      type: 'kanata-recovery', version: 1, baseFingerprint: hash(ciphertext), ciphertext,
    }))
    seal(t, legacy)
    for (const descriptor of legacy.descriptors) {
      const value = legacy.files.get(archivePath(descriptor))
      assert.equal(hash(value), descriptor.key)
      assert.equal(Buffer.byteLength(value), descriptor.bytes)
    }
    const { db, writes, migrate } = await target(t, legacy)
    const result = await migrate()
    assert.equal(result.status, 'complete')
    assert.equal(result.verifiedTableCount, KANATA_MIGRATION_TABLES.length)
    assert.equal(db.prepare('SELECT data_version FROM dataset_metadata').get().data_version, version)
    assert.equal(result.counts.archived_message_marks, legacy.history.length)
    const { extensions_json: manifestJson } = db.prepare("SELECT extensions_json FROM data_migrations WHERE collection='__manifest__'").get()
    const manifest = JSON.parse(manifestJson)
    for (const table of KANATA_MIGRATION_TABLES) {
      const count = db.prepare('SELECT count(*) AS n FROM ' + table).get().n
      assert.equal(result.counts[table], count, table)
      if (count) {
        assert.equal(manifest.tables[table].count, count, table)
        assert.match(manifest.tables[table].digest, /^[a-f0-9]{64}$/)
      }
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM data_migrations WHERE state<>'complete'").get().n, 0)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('SELECT message_id FROM archived_message_marks ORDER BY rowid').all().map(r => r.message_id),
      legacy.history.map(m => m.id))
    const messages = db.prepare('SELECT id,content,revision,created_at,extensions_json FROM messages ORDER BY rowid').all()
    assert.deepEqual(messages.map(row => [row.id, row.content, row.revision, row.created_at, JSON.parse(row.extensions_json).m5Extension]),
      [...legacy.history, ...legacy.data.messages].map(m => [m.id, m.content, m.revision, m.createdAt, m.m5Extension]))
    const paths = legacy.descriptors.map(archivePath)
    assert.deepEqual(archiveReads(legacy), [...paths].reverse().concat(paths))

    writes.length = 0
    const repeat = await migrate()
    assert.equal(repeat.status, 'already-complete')
    assert.equal(repeat.sourceFingerprint, result.sourceFingerprint)
    assert.deepEqual(repeat.counts, result.counts)
    assert.deepEqual(writes, [])
    // Change one value without changing any row count. The completed target must fail hash verification.
    db.prepare("UPDATE messages SET content='synthetic changed target', revision=revision+1 WHERE id='message-one'").run()
    await assert.rejects(migrate(), errorCode('KANATA_MIGRATION_TABLE_HASH_MISMATCH'))
    assert.deepEqual(writes, [])
  })
}

const invalidHeader = (legacy, change) => {
  change(legacy.data)
  // Repository encryption rejects invalid graphs, so use its wire encoder to construct the negative fixture.
  legacy.files.set(KANATA_DATA_PATH, encryptPassphraseAes(JSON.stringify(legacy.data), password))
}
const replacePageCiphertext = (legacy, transform) => {
  const descriptor = legacy.descriptors[0]
  const previousPath = archivePath(descriptor)
  const value = transform(legacy.files.get(previousPath))
  legacy.files.delete(previousPath)
  Object.assign(descriptor, { key: hash(value), bytes: Buffer.byteLength(value) })
  legacy.files.set(archivePath(descriptor), value)
  legacy.files.set(KANATA_DATA_PATH, encryptKanataData(legacy.data, password))
}
const rewritePage = (legacy, change) => replacePageCiphertext(legacy, ciphertext => {
  const page = JSON.parse(decryptPassphraseAes(ciphertext, password))
  change(page)
  return encryptPassphraseAes(JSON.stringify(page), password)
})
const replacePrimary = (legacy, value) => legacy.files.set(KANATA_DATA_PATH, value)
const rewriteDescriptor = (legacy, change) => {
  change(legacy.descriptors[0])
  replacePrimary(legacy, encryptKanataData(legacy.data, password))
}

const invalidPrimary = [
  ['wrong password', 'KANATA_DECRYPT_FAILED', () => {}, 'wrong-synthetic-password'],
  ['corrupted primary ciphertext', 'KANATA_DECRYPT_FAILED', f => replacePrimary(f, f.files.get(KANATA_DATA_PATH).slice(1))],
  ['encrypted malformed JSON', 'KANATA_DATA_CORRUPTED', f => replacePrimary(f, encryptPassphraseAes('{', password))],
  ['future data version even with a usable backup', 'UNSUPPORTED_KANATA_VERSION', f => {
    f.files.set(KANATA_BACKUP_PATH, f.files.get(KANATA_DATA_PATH))
    invalidHeader(f, data => { data.version = 99 })
  }],
  ['orphan conversation', 'ORPHAN_CONVERSATION', f => invalidHeader(f, data => { data.messages[0].conversationId = 'absent-conversation' })],
  ['duplicate entity ID', 'DUPLICATE_ID', f => invalidHeader(f, data => { data.messages[1].id = data.messages[0].id })],
  ['cross-world message', 'CROSS_WORLD_REFERENCE', f => invalidHeader(f, data => {
    data.messages[0].worldId = data.worlds[1].id
  })],
  ['reply across conversations', 'INVALID_REPLY_REFERENCE', f => invalidHeader(f, data => {
    const other = data.conversations.find(c => c.type === 'private' && c.worldId === data.messages[0].worldId
      && c.id !== data.messages[0].conversationId)
    data.messages[0].conversationId = other.id
  })],
]

for (const [name, code, prepare, key] of invalidPrimary) {
  test('M5-05 rejects ' + name + ' before writing to SQLite', async t => {
    const legacy = await fixture(1)
    prepare(legacy)
    seal(t, legacy)
    const candidate = await target(t, legacy)
    await assert.rejects(candidate.migrate(key), errorCode(code))
    assertUntouched(candidate)
    assert.deepEqual(archiveReads(legacy), [])
  })
}

const invalidArchive = [
  ['missing page', 'KANATA_ARCHIVE_MISSING', f => f.files.delete(archivePath(f.descriptors[0]))],
  ['changed byte length', 'KANATA_ARCHIVE_VERIFY_FAILED', f => {
    const path = archivePath(f.descriptors[0])
    f.files.set(path, f.files.get(path) + 'A')
  }],
  ['same-length ciphertext tampering', 'KANATA_ARCHIVE_VERIFY_FAILED', f => {
    const path = archivePath(f.descriptors[0])
    f.files.set(path, 'X' + f.files.get(path).slice(1))
  }],
  ['archive encrypted under another password', 'KANATA_ARCHIVE_DECRYPT_FAILED', f => replacePageCiphertext(f, ciphertext =>
    encryptPassphraseAes(decryptPassphraseAes(ciphertext, password), 'wrong-synthetic-archive-password'))],
  ['encrypted malformed page JSON', 'KANATA_ARCHIVE_DECRYPT_FAILED', f => replacePageCiphertext(f, () => encryptPassphraseAes('{', password))],
  ['future descriptor version', 'UNSUPPORTED_KANATA_ARCHIVE_VERSION', f => invalidHeader(f, () => {
    f.descriptors[0].version = 99
  })],
  ['future page version', 'UNSUPPORTED_KANATA_ARCHIVE_VERSION', f => rewritePage(f, p => { p.version = 99 })],
  ['wrong page scope', 'KANATA_ARCHIVE_SCOPE_DENIED', f => rewritePage(f, p => { p.conversationId = 'wrong-scope' })],
  ['wrong message scope', 'KANATA_ARCHIVE_SCOPE_DENIED', f => rewritePage(f, p => { p.messages[0].worldId = 'wrong-world' })],
  ['mismatched Bloom index', 'KANATA_ARCHIVE_INDEX_MISMATCH', f => rewriteDescriptor(f, d => { d.index = '0'.repeat(1024) })],
  ['mismatched descriptor message revision', 'KANATA_ARCHIVE_INVALID', f => rewriteDescriptor(f, d => { d.messages[0].revision++ })],
  ['mismatched descriptor message ID', 'KANATA_ARCHIVE_INVALID', f => rewriteDescriptor(f, d => { d.messages[0].id = 'm5-wrong-id' })],
  ['mismatched descriptor message time', 'KANATA_ARCHIVE_INVALID', f => rewriteDescriptor(f, d => { d.messages[0].createdAt-- })],
  ['reversed page message order', 'KANATA_ARCHIVE_INVALID', f => rewritePage(f, p => { p.messages.reverse() })],
  ['reversed descriptor message order', 'KANATA_ARCHIVE_ORDER_INVALID', f => invalidHeader(f, () => {
    f.descriptors[0].messages.reverse()
  })],
]

for (const [name, code, prepare] of invalidArchive) {
  test('M5-05 rejects ' + name + ' before writing to SQLite', async t => {
    const legacy = await fixture()
    prepare(legacy)
    seal(t, legacy)
    const candidate = await target(t, legacy)
    await assert.rejects(candidate.migrate(), errorCode(code))
    assertUntouched(candidate)
  })
}

for (const [name, path, corrupt] of [
  ['backup after missing primary', KANATA_BACKUP_PATH, false],
  ['temporary copy after damaged primary', KANATA_TEMP_PATH, true],
]) {
  test('M5-05 refuses a recovered ' + name, async t => {
    const legacy = await fixture()
    legacy.files.set(path, legacy.files.get(KANATA_DATA_PATH))
    if (corrupt) replacePrimary(legacy, 'damaged-synthetic-primary')
    else legacy.files.delete(KANATA_DATA_PATH)
    seal(t, legacy)
    const candidate = await target(t, legacy)
    await assert.rejects(candidate.migrate(), errorCode('KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'))
    assertUntouched(candidate)
    assert.deepEqual(archiveReads(legacy), [path])
  })
}

test('M5-05 refuses a pending recovery journal with a newer encrypted snapshot', async t => {
  const legacy = await fixture()
  const ciphertext = legacy.files.get(KANATA_DATA_PATH)
  legacy.values.set(KANATA_RECOVERY_KEY, JSON.stringify({
    type: 'kanata-recovery', version: 1, baseFingerprint: hash(ciphertext),
    ciphertext: encryptKanataData({ ...legacy.data, m5Extension: 'newer recovery snapshot' }, password),
  }))
  seal(t, legacy, true)
  const candidate = await target(t, legacy)
  await assert.rejects(candidate.migrate(), errorCode('KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'))
  assertUntouched(candidate)
  assert.equal(legacy.repository.getState().hasPendingSave, true)
  assert.equal(legacy.repository.getState().saveError, 'KANATA_PENDING_RECOVERY')
  assert.deepEqual(archiveReads(legacy), [])
})

test('M5-05 refuses a real Repository pending save after fixture-only persistence failure', async t => {
  const legacy = await fixture()
  await legacy.repository.read(password)
  legacy.control.failure = { operation: 'write', contains: KANATA_TEMP_PATH }
  await assert.rejects(legacy.repository.write({ ...legacy.data, m5Extension: 'pending save' }, password),
    errorCode('KANATA_SAVE_FAILED'))
  legacy.control.failure = null
  assert.equal(legacy.repository.getState().saveError, 'KANATA_SAVE_FAILED')
  assert.equal(legacy.repository.getState().hasPendingSave, true)
  seal(t, legacy, true)
  const candidate = await target(t, legacy)
  await assert.rejects(candidate.migrate(), errorCode('KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'))
  assertUntouched(candidate)
  assert.deepEqual(archiveReads(legacy), [])
})

const assertNotCancelled = cancelled => {
  if (cancelled) throw Object.assign(new Error('synthetic cancellation'), { code: 'KANATA_MIGRATION_CANCELLED' })
}

test('M5-05 cancellation during archive validation prevents later page reads and any target writes', async t => {
  const legacy = await fixture()
  const first = archivePath(legacy.descriptors[1])
  let cancelled = false
  legacy.control.pause = {
    operation: 'read', contains: first, wait: Promise.resolve(),
    onEnter: () => { cancelled = true },
  }
  seal(t, legacy)
  const candidate = await target(t, legacy, { assertCurrent: () => assertNotCancelled(cancelled) })
  await assert.rejects(candidate.migrate(), errorCode('KANATA_MIGRATION_CANCELLED'))
  assertUntouched(candidate)
  assert.deepEqual(archiveReads(legacy), [first])
})

test('M5-05 cancellation inside a batch rolls back rows and cursor, then resumes', async t => {
  const legacy = await fixture()
  seal(t, legacy)
  let cancelled = false, cancelOnCommit = true, messageInserts = 0
  const { db, migrate } = await target(t, legacy, {
    assertCurrent: () => assertNotCancelled(cancelled),
    beforeExecute(sql) {
      if (sql.startsWith('INSERT INTO messages(')) messageInserts++
      if (cancelOnCommit && messageInserts === 3 && sql.startsWith("UPDATE data_migrations SET state='running'")) cancelled = true
    },
  })
  await assert.rejects(migrate(), errorCode('KANATA_MIGRATION_CANCELLED'))
  for (const table of ['messages', 'message_life_sources', 'archived_message_marks']) {
    assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 2, table)
  }
  const row = db.prepare("SELECT state, cursor_json, imported_count, extensions_json FROM data_migrations WHERE collection='messages.archive'").get()
  assert.equal(row.state, 'failed')
  assert.equal(row.imported_count, 2)
  assert.deepEqual(JSON.parse(row.cursor_json), { archiveIndex: 0, messageOffset: 2 })
  assert.equal(JSON.parse(row.extensions_json).lastFailureCode, 'KANATA_MIGRATION_CANCELLED')
  const [first, second] = legacy.descriptors.map(archivePath)
  assert.deepEqual(archiveReads(legacy), [second, first, first])

  cancelled = false
  cancelOnCommit = false
  const resumed = await migrate()
  assert.equal(resumed.status, 'complete')
  assert.equal(resumed.counts.messages, legacy.data.messages.length + legacy.history.length)
  assert.equal(resumed.counts.archived_message_marks, legacy.history.length)
})
