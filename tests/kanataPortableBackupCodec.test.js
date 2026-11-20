import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildCustomPortablePackage,
  buildRawLogicalStream,
  encodeFooterBuffer,
} from '../docs/qa/kanata-sqlite-m6/portable/adversarialBuilder.mjs'
import { openSyntheticEnvelope, sealSyntheticEnvelope } from '../docs/qa/kanata-sqlite-m6/portable/envelope.mjs'
import { createNodeCryptoProvider } from '../docs/qa/kanata-sqlite-m6/portable/nodeCryptoProvider.mjs'
import {
  computeSyntheticDerivedVerifiers,
  createBoundedCounterStagingSink,
  createIsolatedKanata005Db,
  createSqliteStagingSink,
  createSyntheticTableSource,
  exportSyntheticPortableBackup,
  importSyntheticPortableBackup,
  readCanonicalRowsFromSqlite,
  readPortableSnapshotFromSqlite,
  streamSyntheticPortableBackup,
} from '../docs/qa/kanata-sqlite-m6/portable/syntheticCodec.mjs'
import { createWebCryptoProvider } from '../docs/qa/kanata-sqlite-m6/portable/webCryptoProvider.mjs'
import { concatBytes, hexToBytes, bytesToHex } from '../src/features/chat/backup/portable/bytes.js'
import { PORTABLE_BUSINESS_TABLES, PORTABLE_FOOTER_TABLES } from '../src/features/chat/backup/portable/catalog.js'
import { PORTABLE_FRAME_LIMIT, PORTABLE_LIMITS } from '../src/features/chat/backup/portable/constants.js'
import { decodePublicHeader } from '../src/features/chat/backup/portable/containerCodec.js'

const vectors = JSON.parse(
  readFileSync(new URL('../docs/qa/kanata-sqlite-m6/portable/vectors-v1.json', import.meta.url), 'utf8'),
)
const nodeCrypto = createNodeCryptoProvider()
const webCrypto = createWebCryptoProvider()

const fixedMaterial = {
  salt: hexToBytes(vectors.material.saltHex),
  backupId: hexToBytes(vectors.material.backupIdHex),
  wrapNonce: hexToBytes(vectors.material.wrapNonceHex),
  bek: hexToBytes(vectors.material.bekHex),
}
const expectCode = code => err => err?.code === code && err?.message === code

function sha256Hex(bytes) {
  const h = nodeCrypto.createSha256()
  h.update(bytes)
  return bytesToHex(h.digest())
}

function makeCountingCryptoProvider(inner = nodeCrypto) {
  const counts = { pbkdf2: 0, hkdf: 0, encrypt: 0, decrypt: 0 }
  return {
    counts,
    provider: {
      randomBytes: len => inner.randomBytes(len),
      async pbkdf2Sha256(pw, salt, iter, len) {
        counts.pbkdf2 += 1
        return inner.pbkdf2Sha256(pw, salt, iter, len)
      },
      hkdfSha256(ikm, salt, info, len) {
        counts.hkdf += 1
        return inner.hkdfSha256(ikm, salt, info, len)
      },
      aesGcmEncrypt(k, n, p, a) {
        counts.encrypt += 1
        return inner.aesGcmEncrypt(k, n, p, a)
      },
      aesGcmDecrypt(k, n, c, a) {
        counts.decrypt += 1
        return inner.aesGcmDecrypt(k, n, c, a)
      },
      createSha256: () => inner.createSha256(),
    },
  }
}

function populatedFixtureSources() {
  const business = {
    dataset_metadata: [
      { singleton: 1, user_id: 'user-kat', data_version: 2, extensions_json: '{"k":  1}' },
    ],
    worlds: [
      {
        id: 'w1',
        name: '合成世界📦',
        rules: 'r',
        revision: 1,
        time_zone: 'UTC',
        created_at: PORTABLE_LIMITS.MIN_I64,
        last_simulated_at: PORTABLE_LIMITS.MAX_I64,
        autonomy_enabled: 1,
        proactive_enabled: 0,
        notifications_enabled: 1,
        default_chat_mode: 'daily',
        archived: null,
        identity_id: 'id-1',
        extensions_json: '{}',
      },
    ],
    world_identities: [
      {
        id: 'id-1',
        world_id: 'w1',
        user_id: 'user-kat',
        display_name: ' e\u0301 \u0000\ufeff ',
        background: 'bg',
        revision: 1,
        extensions_json: '{}',
      },
    ],
    character_instances: [
      {
        id: 'inst-1',
        world_id: 'w1',
        card_id: 'card-1',
        card_version_id: 'ver-1',
        revision: 1,
        overrides_json: '{}',
        mood: 'calm',
        energy: -0.0,
        location: 'home',
        autonomy_enabled: 1,
        proactive_enabled: 0,
        extensions_json: '{}',
      },
    ],
    world_events: [
      {
        ordinal: 0,
        id: 'evt-1',
        world_id: 'w1',
        status: 'committed',
        visibility: 'private',
        summary: '约定',
        effective_at: 1000,
        recorded_at: 1000,
        revision: 1,
        causality: null,
        kind: 'note',
        action_instance_id: null,
        action_relationship_id: null,
        action_location: null,
        replaces_event_id: null,
        extensions_json: '{}',
      },
    ],
    background_tasks: [
      {
        id: 'task-1',
        world_id: 'w1',
        kind: 'proactive',
        state: 'running',
        idempotency_key: 'k1',
        source_revision: 1,
        attempt: 1,
        not_before: 2000,
        lease_until: 99999,
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
      },
    ],
  }

  const derived = {
    entity_ids: [
      { id: 'evt-1', table_name: 'world_events' },
      { id: 'id-1', table_name: 'world_identities' },
      { id: 'inst-1', table_name: 'character_instances' },
      { id: 'task-1', table_name: 'background_tasks' },
      { id: 'w1', table_name: 'worlds' },
    ],
    event_array_order: [{ world_id: 'w1', entity_id: 'evt-1', ordinal: 0 }],
    participants: [
      { world_id: 'w1', id: 'id-1', kind: 'user', identity_id: 'id-1', instance_id: null },
      { world_id: 'w1', id: 'inst-1', kind: 'character', identity_id: null, instance_id: 'inst-1' },
    ],
  }
  return { business, derived }
}

test('C01-01 Python KAT vectors match Node and WebCrypto implementations byte-for-byte', async () => {
  const emptyDerived = await computeSyntheticDerivedVerifiers({}, nodeCrypto)

  // 1. Empty package KAT (Node Crypto + WebCrypto cross-check + envelope.mjs prefix check)
  for (const provider of [nodeCrypto, webCrypto]) {
    const exported = await exportSyntheticPortableBackup({
      password: vectors.password,
      getTableSource: createSyntheticTableSource(),
      derivedVerifiers: emptyDerived,
      cryptoProvider: provider,
      material: fixedMaterial,
    })
    assert.equal(exported.bytes.byteLength, vectors.emptyPackage.packageByteLength)
    assert.equal(sha256Hex(exported.bytes), vectors.emptyPackage.packageSha256)
    assert.equal(bytesToHex(exported.bytes), vectors.emptyPackage.packageHex)
    assert.equal(bytesToHex(exported.footer.transcript), vectors.emptyPackage.transcriptHex)

    const env = await sealSyntheticEnvelope(vectors.password, { material: fixedMaterial })
    assert.deepEqual(Buffer.from(exported.bytes.subarray(0, 124)), env.prefix)
    assert.deepEqual(await openSyntheticEnvelope(vectors.password, Buffer.from(exported.bytes.subarray(0, 124))), Buffer.from(fixedMaterial.bek))
  }

  // Decode empty Python vector via both providers
  for (const provider of [nodeCrypto, webCrypto]) {
    const sink = createBoundedCounterStagingSink({
      expectedDerivedVerifiers: emptyDerived,
      cryptoProvider: provider,
    })
    const res = await importSyntheticPortableBackup({
      source: hexToBytes(vectors.emptyPackage.packageHex),
      password: vectors.password,
      stagingSink: sink,
      cryptoProvider: provider,
    })
    assert.equal(sink.state, 'committed')
    assert.equal(sink.begunTables.length, 45)
    assert.equal(sink.finishedTables.length, 45)
    assert.equal(sink.totalRows, 0n)
    assert.equal(res.footer.dataFrameCount, 1)
    assert.equal(res.footer.totalPlaintextBytes, 450n)
  }

  // 2. Populated package KAT (Node Crypto + WebCrypto cross-check)
  const { business, derived } = populatedFixtureSources()
  const popDerived = await computeSyntheticDerivedVerifiers(derived, nodeCrypto)
  for (const provider of [nodeCrypto, webCrypto]) {
    const exported = await exportSyntheticPortableBackup({
      password: vectors.password,
      getTableSource: createSyntheticTableSource(business),
      derivedVerifiers: popDerived,
      cryptoProvider: provider,
      material: fixedMaterial,
    })
    assert.equal(exported.bytes.byteLength, vectors.populatedPackage.packageByteLength)
    assert.equal(sha256Hex(exported.bytes), vectors.populatedPackage.packageSha256)
    assert.equal(bytesToHex(exported.bytes), vectors.populatedPackage.packageHex)

    const sink = createBoundedCounterStagingSink({
      expectedDerivedVerifiers: popDerived,
      cryptoProvider: provider,
      captureRows: true,
    })
    await importSyntheticPortableBackup({
      source: hexToBytes(vectors.populatedPackage.packageHex),
      password: vectors.password,
      stagingSink: sink,
      cryptoProvider: provider,
    })
    assert.equal(sink.state, 'committed')
    assert.equal(sink.capturedTables.get('worlds')[0].created_at, PORTABLE_LIMITS.MIN_I64)
    assert.equal(sink.capturedTables.get('worlds')[0].last_simulated_at, PORTABLE_LIMITS.MAX_I64)
    assert.equal(sink.capturedTables.get('world_identities')[0].display_name, ' e\u0301 \u0000\ufeff ')
    assert.equal(Object.is(sink.capturedTables.get('character_instances')[0].energy, 0), true)
    assert.equal(Object.is(sink.capturedTables.get('character_instances')[0].energy, -0), false)
    assert.equal(sink.capturedTables.get('background_tasks')[0].state, 'cancelled')
    assert.equal(sink.capturedTables.get('background_tasks')[0].lease_until, 0n)
  }
})

test('C01-02 full SQLite Schema 005 round-trip preserves 45+5 tables, two-pass FKs, 2-node cycles, 005 ordinals and task policy', async () => {
  const sourceDb = createIsolatedKanata005Db()
  sourceDb.exec('BEGIN IMMEDIATE;')
  sourceDb.prepare('INSERT INTO dataset_metadata VALUES(1, ?, 2, ?)').run('user-synth', '{"v":1}')
  sourceDb
    .prepare(
      'INSERT INTO worlds VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run('w1', '世界一', 'rule', 1, 'Asia/Shanghai', 100, 200, 1, 1, 1, 'daily', null, 'id1', '{}')
  sourceDb
    .prepare('INSERT INTO world_identities VALUES(?,?,?,?,?,?,?)')
    .run('id1', 'w1', 'user-synth', '哥哥', 'bg', 1, '{}')
  sourceDb.prepare('INSERT INTO character_cards VALUES(?,?,?,?,?)').run('card1', 'cv1', 0, null, '{}')
  sourceDb
    .prepare('INSERT INTO card_versions VALUES(?,?,?,?,?,?,?,?)')
    .run('cv1', 'card1', 1, '{"name":  "小暖"}', '{"ext": [1, 2]}', 'manual', null, '{}')
  sourceDb
    .prepare('INSERT INTO character_instances VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('inst1', 'w1', 'card1', 'cv1', 1, '{}', 'happy', 0.85, 'classroom', 1, 1, '{}')
  sourceDb
    .prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('conv1', 'w1', 'private', '私聊', 'daily', 1, 100, null, null, 1, 3000, '{}')
  sourceDb
    .prepare('INSERT INTO conversation_participants VALUES(?,?,?,?,?)')
    .run('w1', 'conv1', 'id1', 'user', 0)
  sourceDb
    .prepare('INSERT INTO conversation_participants VALUES(?,?,?,?,?)')
    .run('w1', 'conv1', 'inst1', 'character', 1)

  // Two messages with forward reply reference (m1 replies to m2 which sorts lexicographically AFTER m1)
  sourceDb
    .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('m2', 'w1', 'conv1', 'user', 'user', 'id1', '哥哥', '第二句', 200, 1, 'complete', 't2', 'b2', null, null, null, '{}')
  sourceDb
    .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('m1', 'w1', 'conv1', 'assistant', 'character', 'inst1', '小暖', '第一句回复', 100, 1, 'complete', 't1', 'b1', null, 'm2', 1, '{}')
  sourceDb.prepare('INSERT INTO archived_message_marks VALUES(?,?,?)').run('w1', 'conv1', 'm1')

  // Two-node replaces_event_id cycle in world_events (DEFERRABLE FK + 005 ordinal!)
  sourceDb
    .prepare('INSERT INTO world_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e1', 'w1', 'committed', 'private', '事件1', 100, 100, 1, 'explicit', 'note', 'inst1', null, null, 'e2', '{}')
  sourceDb
    .prepare('INSERT INTO world_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('e2', 'w1', 'committed', 'private', '事件2', 200, 200, 1, 'explicit', 'note', 'inst1', null, null, 'e1', '{}')

  sourceDb
    .prepare('INSERT INTO world_effects VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ef1', 'w1', 'e1', 'instance', 'inst1', 'inst1', null, 'set', 'state.mood', '"cheerful"', 1, '{}')
  sourceDb
    .prepare('INSERT INTO effect_baselines VALUES(?,?,?,?,?,?,?,?,?)')
    .run('eb1', 'w1', 'instance', 'inst1', 'inst1', null, 'state.energy', '0.5', '{}')

  // Background tasks with window_task_id forward reference + active lease/running state
  sourceDb
    .prepare('INSERT INTO background_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('wt2', 'w1', 'world', 'running', 'wkey2', 1, 1, 500, 9999, 'conv1', 'inst1', null, '{}', null, null, null, null, null, '{}')
  sourceDb
    .prepare('INSERT INTO background_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('wt1', 'w1', 'world', 'pending', 'wkey1', 1, 0, 400, 8888, 'conv1', 'inst1', null, '{}', 'wt2', null, null, null, null, '{}')
  sourceDb
    .prepare('INSERT INTO background_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('pt1', 'w1', 'proactive', 'running', 'pkey1', 1, 1, 600, 7777, 'conv1', 'inst1', null, '{}', null, null, null, null, 910000001, '{}')

  sourceDb
    .prepare('INSERT INTO domain_command_receipts VALUES(?,?,?)')
    .run('["createWorld","w1"]', 'a'.repeat(64), 'w1')
  sourceDb.exec('COMMIT;')

  const snapshot = await readPortableSnapshotFromSqlite(sourceDb, nodeCrypto)
  // Verify source DB itself was NOT mutated by pause-sending-v1 export projection
  assert.equal(sourceDb.prepare("SELECT state FROM background_tasks WHERE id='pt1'").get().state, 'running')
  assert.equal(sourceDb.prepare("SELECT lease_until FROM background_tasks WHERE id='pt1'").get().lease_until, 7777)

  const exported = await exportSyntheticPortableBackup({
    password: 'synth-sqlite-roundtrip',
    getTableSource: snapshot.getTableSource,
    derivedVerifiers: snapshot.derivedVerifiers,
    cryptoProvider: nodeCrypto,
  })

  // Import into a brand new isolated SQLite DB via SqliteStagingSink
  const targetSink = createSqliteStagingSink({ cryptoProvider: nodeCrypto })
  await importSyntheticPortableBackup({
    source: exported.bytes,
    password: 'synth-sqlite-roundtrip',
    stagingSink: targetSink,
    cryptoProvider: nodeCrypto,
  })
  assert.equal(targetSink.state, 'committed')

  const targetSnapshot = await readPortableSnapshotFromSqlite(targetSink.database, nodeCrypto)
  for (const tableDef of PORTABLE_BUSINESS_TABLES) {
    assert.deepEqual(
      readCanonicalRowsFromSqlite(targetSink.database, tableDef),
      snapshot.businessRows[tableDef.name],
      `mismatch in business table ${tableDef.name}`,
    )
  }
  assert.deepEqual(targetSnapshot.derivedRows, snapshot.derivedRows)
  assert.equal(targetSink.database.prepare("SELECT state, lease_until FROM background_tasks WHERE id='pt1'").get().state, 'cancelled')
  assert.equal(targetSink.database.prepare("SELECT state, lease_until FROM background_tasks WHERE id='wt2'").get().state, 'pending')

  targetSink.database.close()
  sourceDb.close()
})

test('C01-02 exact 65536-byte single DATA frame and 65537-byte two-frame boundaries set final flags correctly', async () => {
  // 45 empty table headers = 450 B. Add 1 role_binding_state row + 1 character_cards/card_versions row
  // to land on exact 65536 bytes and 65537 bytes!
  // Compute exact size needed in card_versions.source:
  // dataset_metadata row = 1(singleton)+8 + 1(user_id)+4+2 + 1(data_version)+8 + 1(ext)+4+2 = 31 bytes + 4 len = 35
  // Base 450 bytes + card_versions overhead:
  // card_versions columns: id(1+4+2=7), card_id(1+4+2=7), revision(9), definition_json(1+4+2=7), raw_data_json(1+4+2=7),
  // source(1+4+N = 5+N), imported_json(1), extensions_json(1+4+2=7) => body = 50 + N, + 4 len = 54 + N.
  // Total = 450 + 54 + N = 504 + N. Need 65536 => N = 65032!
  const makeSizedBackup = async textLen => {
    const row = {
      id: 'c1',
      card_id: 'k1',
      revision: 1,
      definition_json: '{}',
      raw_data_json: '{}',
      source: 'X'.repeat(textLen),
      imported_json: null,
      extensions_json: '{}',
    }
    const derived = await computeSyntheticDerivedVerifiers(
      { entity_ids: [{ id: 'c1', table_name: 'card_versions' }] },
      nodeCrypto,
    )
    const exp = await exportSyntheticPortableBackup({
      password: 'boundary-password',
      getTableSource: createSyntheticTableSource({ card_versions: [row] }),
      derivedVerifiers: derived,
      cryptoProvider: nodeCrypto,
    })
    const sink = createBoundedCounterStagingSink({ expectedDerivedVerifiers: derived, cryptoProvider: nodeCrypto })
    const res = await importSyntheticPortableBackup({
      source: exp.bytes,
      password: 'boundary-password',
      stagingSink: sink,
      cryptoProvider: nodeCrypto,
    })
    assert.equal(sink.state, 'committed')
    return { exp, res }
  }

  const exact65536 = await makeSizedBackup(65032)
  assert.equal(exact65536.exp.footer.dataFrameCount, 1)
  assert.equal(exact65536.exp.footer.totalPlaintextBytes, BigInt(PORTABLE_FRAME_LIMIT))
  assert.equal(exact65536.res.footer.dataFrameCount, 1)

  const exact65537 = await makeSizedBackup(65033)
  assert.equal(exact65537.exp.footer.dataFrameCount, 2)
  assert.equal(exact65537.exp.footer.totalPlaintextBytes, BigInt(PORTABLE_FRAME_LIMIT + 1))
  assert.equal(exact65537.res.footer.dataFrameCount, 2)
})

test('C01-03/C01-04 negative container, crypto, truncation, trailing data and adversarial AEAD checks abort staging', async () => {
  const emptyBytes = hexToBytes(vectors.emptyPackage.packageHex)
  const emptyDerived = await computeSyntheticDerivedVerifiers({}, nodeCrypto)

  const runDecode = async (sourceBytes, expectedErr, password = vectors.password, provider = nodeCrypto) => {
    const sink = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
    await assert.rejects(
      importSyntheticPortableBackup({
        source: sourceBytes,
        password,
        stagingSink: sink,
        cryptoProvider: provider,
      }),
      expectCode(expectedErr),
    )
    assert.equal(sink.state, 'aborted')
  }

  // Wrong passwords & Unicode variants
  await runDecode(emptyBytes, 'AUTH_FAILED', 'wrong-password')
  await runDecode(emptyBytes, 'AUTH_FAILED', vectors.password.normalize('NFC'))
  await runDecode(emptyBytes, 'AUTH_FAILED', vectors.password.trim())

  // Pre-KDF rejections (0 PBKDF2 calls)
  const { counts, provider: countingProvider } = makeCountingCryptoProvider()
  for (const pw of ['', '\ud800', '\udc00', '合'.repeat(342)]) {
    await runDecode(emptyBytes, 'INVALID_PASSWORD_INPUT', pw, countingProvider)
  }
  for (const headerOffset of [0, 9, 11, 13, 15, 19, 52, 53, 57, 63]) {
    const mut = emptyBytes.slice()
    mut[headerOffset] ^= 1
    await runDecode(mut, 'UNSUPPORTED_FORMAT', vectors.password, countingProvider)
  }
  const prodProfile = emptyBytes.slice()
  prodProfile[12] = 0x00
  prodProfile[13] = 0x01
  await runDecode(prodProfile, 'UNSUPPORTED_FORMAT', vectors.password, countingProvider)
  assert.equal(counts.pbkdf2, 0)

  // Prefix / envelope mutations -> AUTH_FAILED
  for (const offset of [20, 36, 64, 76, 123]) {
    const mut = emptyBytes.slice()
    mut[offset] ^= 1
    await runDecode(mut, 'AUTH_FAILED')
  }

  // Manifest / Data / Footer ciphertext & tag mutations -> AUTH_FAILED, never leaks plaintext rows
  for (const offset of [144, 199, 220, 680, emptyBytes.byteLength - 1, emptyBytes.byteLength - 20]) {
    const mut = emptyBytes.slice()
    mut[offset] ^= 1
    await runDecode(mut, 'AUTH_FAILED')
  }

  // Arbitrary prefix truncation (every critical boundary + random sample)
  for (const len of [0, 63, 64, 123, 124, 143, 144, 200, 219, 685, 700, emptyBytes.byteLength - 1]) {
    await runDecode(emptyBytes.subarray(0, len), 'INVALID_CONTAINER')
  }

  // Trailing 1 byte or concatenated second package
  await runDecode(concatBytes(emptyBytes, new Uint8Array([0x00])), 'INVALID_CONTAINER')
  await runDecode(concatBytes(emptyBytes, emptyBytes), 'INVALID_CONTAINER')

  // Cross-package frame swap (manifest or data ciphertext transplanted from package B into package A)
  const other = await exportSyntheticPortableBackup({
    password: vectors.password,
    getTableSource: createSyntheticTableSource(),
    derivedVerifiers: emptyDerived,
    cryptoProvider: nodeCrypto,
  })
  const swappedManifest = emptyBytes.slice()
  swappedManifest.set(other.bytes.subarray(144, 200), 144)
  await runDecode(swappedManifest, 'AUTH_FAILED')

  // Adversarial valid-AEAD packages via independent adversarialBuilder.mjs
  const { logical: emptyLogical, verifiers: emptyVerifiersMap } = buildRawLogicalStream(new Map())
  const emptyVerifierList = PORTABLE_FOOTER_TABLES.map(t => emptyVerifiersMap.get(t.tableId))
  const adv = opts =>
    buildCustomPortablePackage({
      password: vectors.password,
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) =>
        encodeFooterBuffer({
          dataFrameCount,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript,
          verifiers: emptyVerifierList,
        }),
      ...opts,
    })

  // 1) 0 DATA frames (MANIFEST immediately followed by FOOTER)
  await runDecode(adv({ dataFrames: [] }), 'INVALID_CONTAINER')

  // Build a valid 2-frame logical payload (>65536 bytes) so frame 0 passes logical decoding before frame 1 errors hit
  const validBigRow = Buffer.concat([
    Buffer.from([1]), // singleton not null
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), // singleton=1
    Buffer.from([1, 0, 0, 0, 2]),
    Buffer.from('u1'), // user_id='u1'
    Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 2]), // data_version=2
    Buffer.from([1]),
    (() => {
      const s = `{"p":"${'X'.repeat(65536)}"}`
      const b = Buffer.alloc(4 + s.length)
      b.writeUInt32BE(s.length, 0)
      Buffer.from(s).copy(b, 4)
      return b
    })(),
  ])
  const { logical: twoFrameLogical } = buildRawLogicalStream(new Map([[11, [validBigRow]]]))
  const validFirstChunk = twoFrameLogical.subarray(0, 65536)
  const validSecondChunk = twoFrameLogical.subarray(65536)

  // 2) DATA frames out of order (index 1 then index 0)
  await runDecode(
    adv({
      dataFrames: [
        { flags: 0, index: 1, plaintext: validFirstChunk },
        { flags: 1, index: 0, plaintext: validSecondChunk },
      ],
    }),
    'INVALID_CONTAINER',
  )

  // 3) Missing middle DATA chunk (index 0 then index 2)
  await runDecode(
    adv({
      dataFrames: [
        { flags: 0, index: 0, plaintext: validFirstChunk },
        { flags: 1, index: 2, plaintext: validSecondChunk },
      ],
    }),
    'INVALID_CONTAINER',
  )

  // 4) Duplicate DATA chunk (two index 0)
  await runDecode(
    adv({
      dataFrames: [
        { flags: 0, index: 0, plaintext: validFirstChunk },
        { flags: 1, index: 0, plaintext: validSecondChunk },
      ],
    }),
    'INVALID_CONTAINER',
  )

  // 5) Missing final flag (flags=0 on sole 65536-byte DATA frame)
  await runDecode(
    adv({
      dataFrames: [{ flags: 0, index: 0, plaintext: validFirstChunk }],
    }),
    'INVALID_CONTAINER',
  )

  // 6) Non-final DATA frame with < 65536 bytes
  await runDecode(
    adv({
      dataFrames: [
        { flags: 0, index: 0, plaintext: emptyLogical.subarray(0, 100) },
        { flags: 1, index: 1, plaintext: emptyLogical.subarray(100) },
      ],
    }),
    'INVALID_CONTAINER',
  )

  // 7) Extra DATA frame after flags=1 final block
  await runDecode(
    adv({
      dataFrames: [
        { flags: 1, index: 0, plaintext: emptyLogical },
        { flags: 1, index: 1, plaintext: Buffer.from([1]) },
      ],
    }),
    'INVALID_CONTAINER',
  )

  // 8) Valid AEAD but wrong Footer transcript / counts
  await runDecode(
    adv({
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) => {
        const badTranscript = Buffer.from(transcript)
        badTranscript[0] ^= 1
        return encodeFooterBuffer({
          dataFrameCount,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript: badTranscript,
          verifiers: emptyVerifierList,
        })
      },
    }),
    'INVALID_CONTAINER',
  )
  await runDecode(
    adv({
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) =>
        encodeFooterBuffer({
          dataFrameCount: dataFrameCount + 1,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript,
          verifiers: emptyVerifierList,
        }),
    }),
    'INVALID_CONTAINER',
  )

  // 9) Valid AEAD but wrong MANIFEST schemaFingerprint / schema / applicationId
  const badFpManifest = Buffer.alloc(40)
  badFpManifest.writeUInt32BE(0x4b4e5441, 0)
  badFpManifest.writeUInt16BE(5, 4)
  badFpManifest[38] = 1
  await runDecode(
    adv({
      manifestPayload: badFpManifest,
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
    }),
    'INVALID_LOGICAL',
  )
  const badVerManifest = Buffer.from(badFpManifest)
  Buffer.from('8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a', 'hex').copy(badVerManifest, 6)
  badVerManifest.writeUInt16BE(4, 4)
  await runDecode(
    adv({
      manifestPayload: badVerManifest,
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
    }),
    'UNSUPPORTED_FORMAT',
  )

  // 10) Valid AEAD but corrupted business / derived table verifier in Footer
  const badVerifierList = emptyVerifierList.map((v, i) =>
    i === 0 ? { ...v, digest: Buffer.alloc(32, 0x11) } : v,
  )
  await runDecode(
    adv({
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) =>
        encodeFooterBuffer({
          dataFrameCount,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript,
          verifiers: badVerifierList,
        }),
    }),
    'INVALID_LOGICAL',
  )

  // 11) Valid AEAD but runtime table (10) in Footer verifier table list
  const runtimeVerifierList = emptyVerifierList.map((v, i) => (i === 0 ? { ...v, tableId: 10 } : v))
  await runDecode(
    adv({
      dataFrames: [{ flags: 1, index: 0, plaintext: emptyLogical }],
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) =>
        encodeFooterBuffer({
          dataFrameCount,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript,
          verifiers: runtimeVerifierList,
        }),
    }),
    'INVALID_LOGICAL',
  )

  // 12) Valid AEAD but out-of-order business table segments (table 2 before table 1)
  const swappedOrder = PORTABLE_BUSINESS_TABLES.map(t => t.tableId)
  ;[swappedOrder[0], swappedOrder[1]] = [swappedOrder[1], swappedOrder[0]]
  const { logical: badOrderLogical, verifiers: badOrderVerifiersMap } = buildRawLogicalStream(new Map(), swappedOrder)
  await runDecode(
    adv({
      dataFrames: [{ flags: 1, index: 0, plaintext: badOrderLogical }],
      footerPayloadBuilder: ({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript }) =>
        encodeFooterBuffer({
          dataFrameCount,
          totalPlaintextBytes,
          totalCiphertextBytes,
          transcript,
          verifiers: PORTABLE_FOOTER_TABLES.map(t => badOrderVerifiersMap.get(t.tableId)),
        }),
    }),
    'INVALID_LOGICAL',
  )

  // 13) Valid AEAD but derived/runtime/unknown table segment inside DATA stream
  const withRuntimeTableOrder = [10, ...PORTABLE_BUSINESS_TABLES.map(t => t.tableId)]
  const { logical: withRuntimeLogical } = buildRawLogicalStream(new Map(), withRuntimeTableOrder)
  await runDecode(
    adv({ dataFrames: [{ flags: 1, index: 0, plaintext: withRuntimeLogical }] }),
    'INVALID_LOGICAL',
  )

  // 14) Valid AEAD but invalid logical row contents (bad nullFlag, notnull violation, invalid UTF-8, -0, unprojected task)
  const makeBadDatasetRow = body => {
    const { logical } = buildRawLogicalStream(new Map([[11, [body]]]))
    return adv({ dataFrames: [{ flags: 1, index: 0, plaintext: logical }] })
  }
  await runDecode(makeBadDatasetRow(Buffer.from([2])), 'INVALID_LOGICAL') // invalid nullFlag
  await runDecode(makeBadDatasetRow(Buffer.from([0])), 'INVALID_LOGICAL') // NOT NULL column set to NULL
  await runDecode(
    makeBadDatasetRow(
      Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 1]),
        Buffer.from([1, 0, 0, 0, 2, 0xff, 0xfe]), // invalid UTF-8 in user_id
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 2]),
        Buffer.from([1, 0, 0, 0, 2]),
        Buffer.from('{}'),
      ]),
    ),
    'INVALID_LOGICAL',
  )

  // 15) Valid AEAD but declared oversized row body length (4 MiB + 1) or rowCount > 2^24 rejected before allocation
  const oversizedRowClaim = Buffer.concat([
    Buffer.from([0, 1]), // tableId 1 (archived_message_marks)
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), // rowCount = 1
    Buffer.from([0, 0x40, 0x00, 0x01]), // bodyLength = 4 MiB + 1 (4,194,305)
  ])
  await runDecode(
    adv({ dataFrames: [{ flags: 1, index: 0, plaintext: oversizedRowClaim }] }),
    'RESOURCE_LIMIT',
  )

  const oversizedRowCountClaim = Buffer.concat([
    Buffer.from([0, 1]), // tableId 1
    Buffer.from([0, 0, 0, 0, 0x01, 0x00, 0x00, 0x01]), // rowCount = 2^24 + 1
  ])
  await runDecode(
    adv({ dataFrames: [{ flags: 1, index: 0, plaintext: oversizedRowCountClaim }] }),
    'RESOURCE_LIMIT',
  )

  // 16) Unauthenticated DATA frame never leaks plaintext rows to StagingSink
  const populatedBytes = hexToBytes(vectors.populatedPackage.packageHex)
  const tamperedData = populatedBytes.slice()
  tamperedData[230] ^= 1 // flip ciphertext inside DATA frame 0
  let leakedBegin = 0
  let leakedWrite = 0
  let leakedAbort = 0
  const spySink = {
    beginTable() {
      leakedBegin += 1
    },
    writeRow() {
      leakedWrite += 1
    },
    finishTable() {},
    verify() {},
    commit() {
      throw new Error('MUST_NOT_COMMIT')
    },
    abort() {
      leakedAbort += 1
    },
  }
  await assert.rejects(
    importSyntheticPortableBackup({
      source: tamperedData,
      password: vectors.password,
      stagingSink: spySink,
      cryptoProvider: nodeCrypto,
    }),
    expectCode('AUTH_FAILED'),
  )
  assert.equal(leakedBegin, 0)
  assert.equal(leakedWrite, 0)
  assert.equal(leakedAbort, 1)
})

test('C01-04 oversized frame claims, u32 overflow, short reads, zero-progress I/O, RNG failure and bounded streaming memory', async () => {
  const emptyBytes = hexToBytes(vectors.emptyPackage.packageHex)
  const emptyDerived = await computeSyntheticDerivedVerifiers({}, nodeCrypto)

  // Oversized / u32-overflow frame header length rejected BEFORE allocating payload buffer
  const bigFrame = emptyBytes.slice()
  // Manifest frame header starts at offset 124; plaintextLen at +12 (136), ciphertextLen at +16 (140)
  const dv = new DataView(bigFrame.buffer, bigFrame.byteOffset, bigFrame.byteLength)
  dv.setUint32(136, 0xffffffff, false)
  dv.setUint32(140, 0x0000000f, false)
  const sinkOv = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  await assert.rejects(
    importSyntheticPortableBackup({ source: bigFrame, password: vectors.password, stagingSink: sinkOv, cryptoProvider: nodeCrypto }),
    expectCode('RESOURCE_LIMIT'),
  )
  assert.equal(sinkOv.state, 'aborted')

  // Short-read 1-byte/random-chunk AsyncIterable succeeds cleanly
  async function* oneByteStream() {
    for (let i = 0; i < emptyBytes.byteLength; i += 3) {
      yield emptyBytes.subarray(i, Math.min(i + 3, emptyBytes.byteLength))
    }
  }
  const sinkShort = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  await importSyntheticPortableBackup({
    source: oneByteStream(),
    password: vectors.password,
    stagingSink: sinkShort,
    cryptoProvider: nodeCrypto,
  })
  assert.equal(sinkShort.state, 'committed')

  // Zero-progress I/O stream rejects cleanly as IO_FAILED instead of hanging
  async function* zeroProgressStream() {
    for (let i = 0; i < 20; i++) yield new Uint8Array(0)
  }
  const sinkZero = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  await assert.rejects(
    importSyntheticPortableBackup({
      source: zeroProgressStream(),
      password: vectors.password,
      stagingSink: sinkZero,
      cryptoProvider: nodeCrypto,
    }),
    expectCode('IO_FAILED'),
  )
  assert.equal(sinkZero.state, 'aborted')

  // CSPRNG failure stops export immediately
  const failingRngProvider = {
    ...nodeCrypto,
    randomBytes() {
      throw new Error('ENTROPY_UNAVAILABLE')
    },
  }
  await assert.rejects(
    exportSyntheticPortableBackup({
      password: vectors.password,
      getTableSource: createSyntheticTableSource(),
      derivedVerifiers: emptyDerived,
      cryptoProvider: failingRngProvider,
    }),
    expectCode('IO_FAILED'),
  )

  // Streaming large multi-frame (~6 MiB, ~96 DATA frames) with bounded O(1) memory sink
  const largeRowCount = 6
  const payloadText = 'Z'.repeat(1_000_000) // 1 MB TEXT per row -> ~6 MB total across ~96 frames
  const makeLargeSource = () =>
    createSyntheticTableSource({
      card_versions: {
        rowCount: largeRowCount,
        rows: (function* () {
          for (let i = 0; i < largeRowCount; i++) {
            yield {
              id: `cv-${String(i).padStart(4, '0')}`,
              card_id: 'c1',
              revision: 1,
              definition_json: '{}',
              raw_data_json: '{}',
              source: payloadText,
              imported_json: null,
              extensions_json: '{}',
            }
          }
        })(),
      },
    })
  const largeDerived = await computeSyntheticDerivedVerifiers(
    {
      entity_ids: Array.from({ length: largeRowCount }, (_, i) => ({
        id: `cv-${String(i).padStart(4, '0')}`,
        table_name: 'card_versions',
      })),
    },
    nodeCrypto,
  )
  const boundedSink = createBoundedCounterStagingSink({
    expectedDerivedVerifiers: largeDerived,
    cryptoProvider: nodeCrypto,
    captureRows: false,
  })
  const stream = streamSyntheticPortableBackup({
    password: 'stream-memory-test',
    getTableSource: makeLargeSource(),
    derivedVerifiers: largeDerived,
    cryptoProvider: nodeCrypto,
  })
  let totalStreamedBytes = 0
  const decodedResult = await importSyntheticPortableBackup({
    source: (async function* () {
      for await (const chunk of stream) {
        totalStreamedBytes += chunk.byteLength
        yield chunk
      }
    })(),
    password: 'stream-memory-test',
    stagingSink: boundedSink,
    cryptoProvider: nodeCrypto,
  })
  assert.equal(boundedSink.state, 'committed')
  assert.equal(boundedSink.totalRows, BigInt(largeRowCount))
  assert.ok(decodedResult.footer.dataFrameCount >= 90)
  assert.ok(totalStreamedBytes > 6_000_000)

  // B-03 UTF-16 boundary (262144 / 262145), 2 MiB TEXT + composite large row across multiple frames
  const utf16At262144 = '测'.repeat(262144)
  const utf16At262145 = '测'.repeat(262145)
  const near2MiB = '中'.repeat(Math.floor(PORTABLE_LIMITS.MAX_TEXT_FIELD_BYTES / 3))
  const compositeCardVersions = [
    {
      id: 'cv-b03-1',
      card_id: 'c1',
      revision: 1,
      definition_json: JSON.stringify({ text: utf16At262144 }),
      raw_data_json: JSON.stringify({ text: utf16At262145 }),
      source: near2MiB,
      imported_json: null,
      extensions_json: '{}',
    },
  ]
  const compositeDerived = await computeSyntheticDerivedVerifiers(
    { entity_ids: [{ id: 'cv-b03-1', table_name: 'card_versions' }] },
    nodeCrypto,
  )
  const heapBefore = process.memoryUsage().heapUsed
  const compositeExport = await exportSyntheticPortableBackup({
    password: 'b03-composite-password',
    getTableSource: createSyntheticTableSource({ card_versions: compositeCardVersions }),
    derivedVerifiers: compositeDerived,
    cryptoProvider: nodeCrypto,
  })
  const compositeSink = createBoundedCounterStagingSink({
    expectedDerivedVerifiers: compositeDerived,
    cryptoProvider: nodeCrypto,
    captureRows: true,
  })
  await importSyntheticPortableBackup({
    source: compositeExport.bytes,
    password: 'b03-composite-password',
    stagingSink: compositeSink,
    cryptoProvider: nodeCrypto,
  })
  const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024)
  assert.equal(compositeSink.state, 'committed')
  assert.equal(JSON.parse(compositeSink.capturedTables.get('card_versions')[0].definition_json).text.length, 262144)
  assert.equal(JSON.parse(compositeSink.capturedTables.get('card_versions')[0].raw_data_json).text.length, 262145)
  assert.equal(compositeSink.capturedTables.get('card_versions')[0].source.length, near2MiB.length)
  assert.ok(heapDeltaMiB < 128, `expected bounded heap delta, got ${heapDeltaMiB.toFixed(2)} MiB`)

  // Incomplete write (cancelled stream mid-export) fails decode as INVALID_CONTAINER and aborts staging
  const partialChunks = []
  const abortCtrl = new AbortController()
  const partialGen = streamSyntheticPortableBackup({
    password: 'partial-write',
    getTableSource: makeLargeSource(),
    derivedVerifiers: largeDerived,
    cryptoProvider: nodeCrypto,
    signal: abortCtrl.signal,
  })
  await assert.rejects(async () => {
    for await (const chunk of partialGen) {
      partialChunks.push(chunk)
      if (partialChunks.length >= 3) abortCtrl.abort()
    }
  }, expectCode('CANCELLED'))
  const partialSink = createBoundedCounterStagingSink({ expectedDerivedVerifiers: largeDerived, cryptoProvider: nodeCrypto })
  await assert.rejects(
    importSyntheticPortableBackup({
      source: concatBytes(...partialChunks),
      password: 'partial-write',
      stagingSink: partialSink,
      cryptoProvider: nodeCrypto,
    }),
    expectCode('INVALID_CONTAINER'),
  )
  assert.equal(partialSink.state, 'aborted')

  // Full container KDF single-flight limit, cancellation and clean recovery
  const kdfCtrl = new AbortController()
  const slowSink1 = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  const slowSink2 = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  const pending = importSyntheticPortableBackup({
    source: emptyBytes,
    password: vectors.password,
    stagingSink: slowSink1,
    cryptoProvider: nodeCrypto,
    signal: kdfCtrl.signal,
  })
  await assert.rejects(
    importSyntheticPortableBackup({
      source: emptyBytes,
      password: vectors.password,
      stagingSink: slowSink2,
      cryptoProvider: nodeCrypto,
    }),
    expectCode('RESOURCE_LIMIT'),
  )
  kdfCtrl.abort()
  await assert.rejects(pending, expectCode('CANCELLED'))
  assert.equal(slowSink1.state, 'aborted')
  assert.equal(slowSink2.state, 'aborted')
  const recoveredSink = createBoundedCounterStagingSink({ expectedDerivedVerifiers: emptyDerived, cryptoProvider: nodeCrypto })
  await importSyntheticPortableBackup({
    source: emptyBytes,
    password: vectors.password,
    stagingSink: recoveredSink,
    cryptoProvider: nodeCrypto,
  })
  assert.equal(recoveredSink.state, 'committed')
})

test('C01-05 production bundles and composition roots do not import portable synthetic modules', () => {
  const prodFiles = [
    '../src/main.js',
    '../src/application/fullBackupRuntime.js',
    '../src/application/kanataBackupRuntime.js',
    '../src/features/chat/backup/kanataBackup.js',
    '../src/composables/settings/useBackupSettings.js',
  ]
  for (const rel of prodFiles) {
    const content = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.equal(content.includes('backup/portable'), false, `${rel} must not import portable codec`)
    assert.equal(content.includes('KPB1/'), false, `${rel} must not contain portable domain strings`)
    assert.equal(content.includes('0xff01'), false, `${rel} must not reference synthetic profile`)
  }
  const headerCheck = decodePublicHeader(hexToBytes(vectors.emptyPackage.prefixHex).subarray(0, 64))
  assert.equal(headerCheck.profile, 0xff01)
})
