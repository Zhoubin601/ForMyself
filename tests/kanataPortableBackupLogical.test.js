import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createNodeCryptoProvider } from '../docs/qa/kanata-sqlite-m6/portable/nodeCryptoProvider.mjs'
import {
  computeSyntheticDerivedVerifiers,
  createBoundedCounterStagingSink,
  createSyntheticTableSource,
} from '../docs/qa/kanata-sqlite-m6/portable/syntheticCodec.mjs'
import {
  decodeStrictUtf8,
  encodeStrictUtf8,
  readF64BE,
  writeF64BE,
} from '../src/features/chat/backup/portable/bytes.js'
import {
  encodeSchema005CanonicalSequence,
  KANATA_SCHEMA_005_FINGERPRINT,
  PORTABLE_BUSINESS_TABLES,
  PORTABLE_DERIVED_TABLES,
  PORTABLE_FOOTER_TABLES,
  PORTABLE_RUNTIME_TABLES,
  PORTABLE_TABLES,
  PORTABLE_TABLES_BY_NAME,
} from '../src/features/chat/backup/portable/catalog.js'
import { PORTABLE_LIMITS } from '../src/features/chat/backup/portable/constants.js'
import {
  assertTaskPauseSendingV1,
  createLogicalStreamDecoder,
  decodeLogicalRowBody,
  encodeLogicalRowBody,
  encodeLogicalStreamChunks,
  projectTaskPauseSendingV1,
} from '../src/features/chat/backup/portable/logicalCodec.js'
import { KANATA_SCHEMA_MIGRATIONS } from '../src/features/chat/storage/sqlite/kanataSchema.js'

const cryptoProvider = createNodeCryptoProvider()
const shaFactory = () => cryptoProvider.createSha256()
const expectCode = code => err => err?.code === code && err?.message === code

test('C01-05 static 53-table catalog and schema-005 fingerprint match actual SQLite DDL', () => {
  const seq = encodeSchema005CanonicalSequence(KANATA_SCHEMA_MIGRATIONS)
  const fp = createHash('sha256').update(seq).digest('hex')
  assert.equal(fp, KANATA_SCHEMA_005_FINGERPRINT)

  assert.equal(PORTABLE_TABLES.length, 53)
  assert.equal(PORTABLE_BUSINESS_TABLES.length, 45)
  assert.equal(PORTABLE_DERIVED_TABLES.length, 5)
  assert.equal(PORTABLE_RUNTIME_TABLES.length, 3)
  assert.equal(PORTABLE_FOOTER_TABLES.length, 50)

  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  for (const m of KANATA_SCHEMA_MIGRATIONS) {
    for (const s of m.statements) db.exec(s)
  }
  const actualTables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name")
    .all()
    .map(r => r.name)

  assert.deepEqual(
    PORTABLE_TABLES.map(t => t.name),
    actualTables,
  )

  for (const tableDef of PORTABLE_TABLES) {
    const info = db.prepare(`PRAGMA table_info(${tableDef.name})`).all()
    assert.equal(tableDef.columns.length, info.length)
    for (let i = 0; i < info.length; i++) {
      assert.deepEqual(tableDef.columns[i], {
        name: info[i].name,
        cid: info[i].cid,
        type: info[i].type,
        notnull: info[i].notnull === 1,
        pk: info[i].pk,
      })
    }
  }
  db.close()
})

test('C01-02 logical row codec preserves UTF-8 edge cases, i64 extremes, JSON lexemes and normalizes -0', () => {
  const worldsDef = PORTABLE_TABLES_BY_NAME.get('worlds')
  const rawWorld = {
    id: 'world-edge',
    name: ' 中文📦 e\u0301 \u0000\ufeff  ',
    rules: 'NFC:é vs NFD:e\u0301',
    revision: 1,
    time_zone: 'Asia/Shanghai',
    created_at: PORTABLE_LIMITS.MIN_I64,
    last_simulated_at: PORTABLE_LIMITS.MAX_I64,
    autonomy_enabled: 1,
    proactive_enabled: 0,
    notifications_enabled: 1,
    default_chat_mode: 'daily',
    archived: null,
    identity_id: 'id-edge',
    extensions_json: '{  "b": 1.000,   "a": [true, null] }',
  }
  const encoded = encodeLogicalRowBody(worldsDef, rawWorld)
  const decoded = decodeLogicalRowBody(worldsDef, encoded.body)
  assert.equal(decoded.row.name, rawWorld.name)
  assert.equal(decoded.row.rules, rawWorld.rules)
  assert.equal(decoded.row.created_at, PORTABLE_LIMITS.MIN_I64)
  assert.equal(decoded.row.last_simulated_at, PORTABLE_LIMITS.MAX_I64)
  assert.equal(decoded.row.archived, null)
  assert.equal(decoded.row.extensions_json, rawWorld.extensions_json)

  // REAL -0.0 normalization on write, rejection on read
  const instDef = PORTABLE_TABLES_BY_NAME.get('character_instances')
  const rawInst = {
    id: 'inst-1',
    world_id: 'world-edge',
    card_id: 'card-1',
    card_version_id: 'ver-1',
    revision: 1,
    overrides_json: '{}',
    mood: 'ok',
    energy: -0.0,
    location: 'home',
    autonomy_enabled: 1,
    proactive_enabled: 1,
    extensions_json: '{}',
  }
  const encInst = encodeLogicalRowBody(instDef, rawInst)
  const decInst = decodeLogicalRowBody(instDef, encInst.body)
  assert.equal(Object.is(decInst.row.energy, 0), true)
  assert.equal(Object.is(decInst.row.energy, -0), false)

  const f64Buf = new Uint8Array(8)
  writeF64BE(f64Buf, 0, -0.0)
  assert.equal(Object.is(readF64BE(f64Buf, 0), 0), true)
  f64Buf[0] = 0x80 // -0.0 bit pattern
  assert.throws(() => readF64BE(f64Buf, 0), expectCode('INVALID_LOGICAL'))
  assert.throws(() => writeF64BE(f64Buf, 0, Number.NaN), expectCode('INVALID_LOGICAL'))
  assert.throws(() => writeF64BE(f64Buf, 0, Number.POSITIVE_INFINITY), expectCode('INVALID_LOGICAL'))

  // Strict UTF-8 rejects lone surrogates and invalid byte sequences, keeps BOM
  assert.throws(() => encodeStrictUtf8('\ud800'), expectCode('INVALID_LOGICAL'))
  assert.throws(() => encodeStrictUtf8('\udc00'), expectCode('INVALID_LOGICAL'))
  assert.throws(() => decodeStrictUtf8(new Uint8Array([0xff, 0xfe])), expectCode('INVALID_LOGICAL'))
  assert.throws(() => decodeStrictUtf8(new Uint8Array([0xed, 0xa0, 0x80])), expectCode('INVALID_LOGICAL'))
  assert.equal(decodeStrictUtf8(encodeStrictUtf8('\ufeffhello\u0000')), '\ufeffhello\u0000')
})

test('C01-02 pause-sending-v1 projects tasks cleanly without mutating source and decoder verifies projection', () => {
  const taskDef = PORTABLE_TABLES_BY_NAME.get('background_tasks')
  const base = {
    id: 't1',
    world_id: 'w1',
    kind: 'reply',
    state: 'running',
    idempotency_key: 'k1',
    source_revision: 1,
    attempt: 1,
    not_before: 100,
    lease_until: 9999,
    conversation_id: null,
    instance_id: null,
    error_code: null,
    metadata_json: '{}',
    window_task_id: null,
    deferred_message_id: null,
    deferred_revision: null,
    deferred_expires_at: null,
    notification_id: null,
    extensions_json: '{}',
  }
  const origSnapshot = structuredClone(base)
  const projected = projectTaskPauseSendingV1(base)
  assert.deepEqual(base, origSnapshot)
  assert.equal(projected.state, 'cancelled')
  assert.equal(projected.lease_until, 0n)

  const memTask = { ...base, kind: 'memory', state: 'running' }
  assert.equal(projectTaskPauseSendingV1(memTask).state, 'pending')

  const succeededTask = { ...base, kind: 'proactive', state: 'succeeded', lease_until: 500 }
  assert.equal(projectTaskPauseSendingV1(succeededTask).state, 'succeeded')
  assert.equal(projectTaskPauseSendingV1(succeededTask).lease_until, 0n)

  assert.throws(() => assertTaskPauseSendingV1(base), expectCode('INVALID_LOGICAL'))
  assert.throws(() => encodeLogicalRowBody(taskDef, base, { applyTaskPolicy: false }), expectCode('INVALID_LOGICAL'))

  const encoded = encodeLogicalRowBody(taskDef, base, { applyTaskPolicy: true })
  const decoded = decodeLogicalRowBody(taskDef, encoded.body)
  assert.equal(decoded.row.state, 'cancelled')
  assert.equal(decoded.row.lease_until, 0n)
})

test('C01-02/C01-04 logical streaming handles records crossing arbitrary byte splits and enforces 2 MiB / 4 MiB bounds', async () => {
  const datasetRow = { singleton: 1, user_id: 'u1', data_version: 2, extensions_json: '{}' }
  // Large valid TEXT near 2 MiB (2,097,152 bytes) inside a valid row (< 4 MiB)
  const maxText = 'A'.repeat(PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES)
  const bigCardVersion = {
    id: 'cv-big',
    card_id: 'c1',
    revision: 1,
    definition_json: '{}',
    raw_data_json: JSON.stringify({ pad: 'B'.repeat(1000) }),
    source: maxText,
    imported_json: null,
    extensions_json: '{}',
  }

  const getSource = createSyntheticTableSource({
    dataset_metadata: [datasetRow],
    card_versions: [bigCardVersion],
  })

  const chunks = []
  let businessVerifiers
  const gen = encodeLogicalStreamChunks(getSource, shaFactory, {
    frameLimit: 65536,
    onBusinessVerifiers: v => {
      businessVerifiers = v
    },
  })
  for await (const c of gen) chunks.push(c)

  assert.equal(businessVerifiers.length, 45)
  const fullStream = Buffer.concat(chunks)

  // Re-split into irregular tiny/uneven pieces (17 bytes, 1 byte, 131 bytes...) so rows cross many boundaries
  const sink = createBoundedCounterStagingSink({
    expectedDerivedVerifiers: await computeSyntheticDerivedVerifiers({}, cryptoProvider),
    cryptoProvider,
    captureRows: true,
  })
  const decoder = createLogicalStreamDecoder(sink, shaFactory)
  let offset = 0
  const sizes = [1, 3, 7, 17, 64, 513, 4096, 32771]
  let idx = 0
  while (offset < fullStream.byteLength) {
    const step = sizes[idx % sizes.length]
    idx++
    const end = Math.min(offset + step, fullStream.byteLength)
    await decoder.push(fullStream.subarray(offset, end))
    offset = end
  }
  const decodedVerifiers = decoder.finish()
  assert.deepEqual(decodedVerifiers, businessVerifiers)
  sink.commit()
  assert.equal(sink.capturedTables.get('card_versions')[0].source.length, PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES)

  // +1 over 2 MiB TEXT limit rejected cleanly
  assert.throws(
    () => encodeStrictUtf8('A'.repeat(PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES + 1)),
    expectCode('RESOURCE_LIMIT'),
  )

  // +1 over 4 MiB row body limit (two 2 MiB TEXT columns + overhead > 4 MiB) rejected cleanly
  const oversizedRow = {
    ...bigCardVersion,
    definition_json: JSON.stringify({ x: 'C'.repeat(PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES - 10) }),
    raw_data_json: JSON.stringify({ y: 'D'.repeat(200) }),
  }
  assert.throws(
    () => encodeLogicalRowBody(PORTABLE_TABLES_BY_NAME.get('card_versions'), oversizedRow),
    expectCode('RESOURCE_LIMIT'),
  )
})

test('C01-03 logical stream decoder rejects non-ascending PK, duplicate PK, 005 ordinal gaps, non-zero starts and invalid columns', async () => {
  const encodeStreamFromRaw = async overrides => {
    const chunks = []
    for await (const c of encodeLogicalStreamChunks(createSyntheticTableSource(overrides), shaFactory)) {
      chunks.push(c)
    }
    return Buffer.concat(chunks)
  }

  // Valid baseline
  const validEvent0 = {
    ordinal: 0,
    id: 'e1',
    world_id: 'w1',
    status: 'committed',
    visibility: 'private',
    summary: 's1',
    effective_at: 1,
    recorded_at: 1,
    revision: 1,
    causality: null,
    kind: null,
    action_instance_id: null,
    action_relationship_id: null,
    action_location: null,
    replaces_event_id: null,
    extensions_json: '{}',
  }
  const validEvent1 = { ...validEvent0, ordinal: 1, id: 'e2' }
  const goodBuf = await encodeStreamFromRaw({ world_events: [validEvent0, validEvent1] })
  assert.ok(goodBuf.byteLength > 450)

  // Encoder itself enforces ordinal and PK order
  await assert.rejects(
    encodeStreamFromRaw({ world_events: [{ ...validEvent0, ordinal: 1 }] }),
    expectCode('INVALID_LOGICAL'),
  )
  await assert.rejects(
    encodeStreamFromRaw({ world_events: [validEvent0, { ...validEvent1, ordinal: 2 }] }),
    expectCode('INVALID_LOGICAL'),
  )
  await assert.rejects(
    encodeStreamFromRaw({
      world_events: [
        { ...validEvent0, world_id: 'w2', ordinal: 0 },
        { ...validEvent1, world_id: 'w1', ordinal: 0 },
      ],
    }),
    expectCode('INVALID_LOGICAL'),
  )
  await assert.rejects(
    encodeStreamFromRaw({
      dataset_metadata: [
        { singleton: 1, user_id: 'u1', data_version: 2, extensions_json: '{}' },
        { singleton: 1, user_id: 'u2', data_version: 2, extensions_json: '{}' },
      ],
    }),
    expectCode('INVALID_LOGICAL'),
  )
  await assert.rejects(
    encodeStreamFromRaw({
      role_bindings: [
        { scope: 'todo', state_id: 1, world_id: null, instance_id: null, extensions_json: '{}' },
        { scope: 'home', state_id: 1, world_id: null, instance_id: null, extensions_json: '{}' },
      ],
    }),
    expectCode('INVALID_LOGICAL'),
  )

  // Trailing byte after 45th table in logical stream rejected
  const sink = createBoundedCounterStagingSink({ cryptoProvider })
  const decoder = createLogicalStreamDecoder(sink, shaFactory)
  await assert.rejects(
    decoder.push(Buffer.concat([goodBuf, Buffer.from([0x00])])),
    expectCode('INVALID_LOGICAL'),
  )

  // Truncated logical stream rejected on finish()
  const sink2 = createBoundedCounterStagingSink({ cryptoProvider })
  const decoder2 = createLogicalStreamDecoder(sink2, shaFactory)
  await decoder2.push(goodBuf.subarray(0, goodBuf.byteLength - 1))
  assert.throws(() => decoder2.finish(), expectCode('INVALID_LOGICAL'))
})
