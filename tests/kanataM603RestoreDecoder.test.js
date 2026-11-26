import test from 'node:test'
import assert from 'node:assert/strict'
import { PORTABLE_ERROR_CODES, PORTABLE_FRAME_FLAG, PORTABLE_FRAME_TYPE, PORTABLE_STREAM_ID } from '../src/features/chat/backup/portable/constants.js'
import { createBoundedBackupSource, decodeKpb1ToStaging, normalizePortableRestoreError } from '../src/features/chat/backup/portable/restoreDecoder.js'
import { createNodeCryptoProvider } from '../docs/qa/kanata-sqlite-m6/portable/nodeCryptoProvider.mjs'
import {
  createIsolatedKanata005Db,
  createSqliteStagingSink,
  exportSyntheticPortableBackup,
  readPortableSnapshotFromSqlite,
} from '../docs/qa/kanata-sqlite-m6/portable/syntheticCodec.mjs'
import { encodeManifestPayload } from '../src/features/chat/backup/portable/containerCodec.js'
import { buildCustomPortablePackage, buildRawLogicalStream, encodeFooterBuffer } from '../docs/qa/kanata-sqlite-m6/portable/adversarialBuilder.mjs'

const cryptoProvider = createNodeCryptoProvider()
const BACKUP_PASSWORD = 'M603-Synthetic-Restore-Pw-\ufeff🔐'

async function buildValidKpb1Bytes(password = BACKUP_PASSWORD) {
  const srcDb = createIsolatedKanata005Db(':memory:')
  try {
    srcDb.exec('BEGIN IMMEDIATE;')
    srcDb.exec(`
      INSERT INTO dataset_metadata VALUES(1, 'u-m603', 2, '{"m603Ext":true,"keepKeyOrder":[3,2,1]}');
      INSERT INTO worlds VALUES('w-m603', 'M603 测试世界', 'synthetic-rules', 1, 'Asia/Shanghai', 1700000000000, 1700000001000, 1, 1, 1, 'daily', 0, 'id-m603', '{"unknownField":"preserved"}');
      INSERT INTO world_identities VALUES('id-m603', 'w-m603', 'u-m603', '测试用户', '合成背景', 1, '{}');
      INSERT INTO character_cards VALUES('card-m603', 'cv-m603', 0, 'preset-m603', '{}');
      INSERT INTO card_versions VALUES('cv-m603', 'card-m603', 1, '{"name":"星野"}', '{"raw":1}', 'preset', NULL, '{}');
      INSERT INTO character_instances VALUES('inst-m603', 'w-m603', 'card-m603', 'cv-m603', 1, '{}', 'calm', 0.85, 'library', 1, 1, '{}');
      INSERT INTO conversations VALUES('conv-m603', 'w-m603', 'private', '私聊', 'daily', 1, 1700000001000, NULL, NULL, NULL, NULL, '{}');
      INSERT INTO conversation_participants VALUES('w-m603', 'conv-m603', 'id-m603', 'user', 0);
      INSERT INTO conversation_participants VALUES('w-m603', 'conv-m603', 'inst-m603', 'character', 1);
      INSERT INTO messages VALUES('msg-1', 'w-m603', 'conv-m603', 'user', 'user', 'id-m603', '测试用户', '\ufeffhello 原始文本', 1700000002000, 1, 'complete', 't1', 'b1', 0, NULL, NULL, '{"extraProp":42}');
      INSERT INTO messages VALUES('msg-2', 'w-m603', 'conv-m603', 'assistant', 'character', 'inst-m603', '星野', '收到回复', 1700000003000, 1, 'complete', 't1', 'b1', 0, 'msg-1', 1, '{}');
      UPDATE messages SET reply_to_message_id = 'msg-2', reply_to_revision = 1 WHERE id = 'msg-1';
      INSERT INTO world_events VALUES('ev-1', 'w-m603', 'committed', 'private', '散步事件', 1700000004000, 1700000004000, 1, 'explicit', 'move', 'inst-m603', NULL, 'park', NULL, '{}');
      INSERT INTO world_events VALUES('ev-2', 'w-m603', 'committed', 'participants', '替换事件', 1700000005000, 1700000005000, 1, 'explicit', 'move', 'inst-m603', NULL, 'home', 'ev-1', '{}');
      INSERT INTO world_effects VALUES('ef-1', 'w-m603', 'ev-1', 'instance', 'inst-m603', 'inst-m603', NULL, 'set', 'state.mood', '"happy"', 1, '{}');
      INSERT INTO effect_baselines VALUES('bl-1', 'w-m603', 'instance', 'inst-m603', 'inst-m603', NULL, 'state.mood', '"calm"', '{}');
    `)
    srcDb.exec('COMMIT;')
    const snap = await readPortableSnapshotFromSqlite(srcDb, cryptoProvider)
    const { bytes } = await exportSyntheticPortableBackup({
      password,
      getTableSource: snap.getTableSource,
      derivedVerifiers: snap.derivedVerifiers,
      cryptoProvider,
    })
    return bytes
  } finally {
    srcDb.close()
  }
}

test('M6-03 Work Package A: valid KPB1 stream-decodes into isolated Schema 005 SQLite staging with full 50-table verification', async () => {
  const kpb1Bytes = await buildValidKpb1Bytes()
  const phases = []
  const sink = createSqliteStagingSink({ cryptoProvider })
  const res = await decodeKpb1ToStaging({
    source: createBoundedBackupSource(kpb1Bytes, 4096),
    password: BACKUP_PASSWORD,
    stagingSink: sink,
    cryptoProvider,
    onProgress: p => phases.push(p.phase),
  })

  assert.equal(sink.state, 'committed')
  assert.equal(res.footer.verifiers.length, 50)
  assert.equal(res.metrics.tablesDecoded, 45)
  assert.equal(res.metrics.bytesRead, kpb1Bytes.byteLength)
  assert.ok(phases.includes('reading_kpb1'))
  assert.ok(phases.includes('authenticating'))
  assert.ok(phases.includes('staging_import'))
  assert.ok(phases.includes('verifying_staging'))
  assert.ok(phases.includes('staging_ready'))

  // Verify unknown JSON extensions, raw BOM/NUL text, 3 ordinal tables, and 3 empty runtime tables
  const worldRow = sink.database.prepare("SELECT extensions_json FROM worlds WHERE id = 'w-m603'").get()
  assert.equal(worldRow.extensions_json, '{"unknownField":"preserved"}')
  const ordRows = sink.database.prepare('SELECT entity_id, ordinal FROM event_array_order ORDER BY ordinal').all()
  assert.deepEqual(ordRows.map(r => [r.entity_id, r.ordinal]), [['ev-1', 0], ['ev-2', 1]])
  for (const rt of ['data_migrations', 'schema_migration_applications', 'schema_migrations']) {
    const cnt = sink.database.prepare(`SELECT count(*) AS c FROM ${rt}`).get().c
    assert.equal(cnt, 0, `${rt} must remain excluded/empty`)
  }
  sink.database.close()
})

test('M6-03 Work Package A: full 13-scenario negative rejection matrix with zero secret leakage and staging abort', async () => {
  const validBytes = await buildValidKpb1Bytes()

  // 1. Wrong password -> AUTH_FAILED
  {
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: validBytes, password: 'wrong-password-secret', stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.AUTH_FAILED && !String(err.message).includes('wrong-password-secret'),
    )
    assert.equal(sink.state, 'aborted')
  }

  // 2. Unknown format version -> UNSUPPORTED_FORMAT
  {
    const badVer = validBytes.slice()
    badVer[9] = 2 // format u16 = 2
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: badVer, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.UNSUPPORTED_FORMAT,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 3. Corrupted DATA frame byte -> AUTH_FAILED
  {
    const corruptData = validBytes.slice()
    // 124 prefix + 20 manifest hdr + 56 manifest cipher = 200; DATA frame starts at 200
    corruptData[225] ^= 0xff
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: corruptData, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.AUTH_FAILED,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 4. Footer tampered -> AUTH_FAILED
  {
    const badFooter = validBytes.slice()
    badFooter[badFooter.length - 5] ^= 0x5a
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: badFooter, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.AUTH_FAILED,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 5. Manifest tampered -> AUTH_FAILED
  {
    const badManifest = validBytes.slice()
    badManifest[150] ^= 0x01
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: badManifest, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.AUTH_FAILED,
    )
    assert.equal(sink.state, 'aborted')
  }

  const emptyLogical = buildRawLogicalStream(new Map())
  const validManifest = Buffer.from(encodeManifestPayload())
  const emptyVerifiers = [...emptyLogical.verifiers.values()].sort((a, b) => a.tableId - b.tableId)
  const makeFooter = info => encodeFooterBuffer({ ...info, verifiers: emptyVerifiers })

  // Build a valid 65536-byte first frame (table 1 header + partial large row body continuing into frame 1)
  const validFirstFrame = Buffer.alloc(65536)
  validFirstFrame.writeUInt16BE(1, 0) // tableId = 1 (archived_message_marks)
  validFirstFrame.writeBigUInt64BE(1n, 2) // rowCount = 1
  validFirstFrame.writeUInt32BE(70000, 10) // bodyLen = 70000 (spans into next frame)

  // 6. Missing chunk (adversarial package with frame gap index 0 -> index 2) -> INVALID_CONTAINER
  {
    const missingChunkPkg = buildCustomPortablePackage({
      password: BACKUP_PASSWORD,
      manifestPayload: validManifest,
      dataFrames: [
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.CONTINUE, index: 0, plaintext: validFirstFrame },
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.FINAL, index: 2, plaintext: Buffer.alloc(16) },
      ],
      footerPayloadBuilder: makeFooter,
    })
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: missingChunkPkg, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.INVALID_CONTAINER,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 7. Duplicate chunk (repeated index 0) -> INVALID_CONTAINER
  {
    const dupChunkPkg = buildCustomPortablePackage({
      password: BACKUP_PASSWORD,
      manifestPayload: validManifest,
      dataFrames: [
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.CONTINUE, index: 0, plaintext: validFirstFrame },
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.FINAL, index: 0, plaintext: Buffer.alloc(16) },
      ],
      footerPayloadBuilder: makeFooter,
    })
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: dupChunkPkg, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.INVALID_CONTAINER,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 8. Out-of-order chunk (index 1 before index 0) -> INVALID_CONTAINER
  {
    const oooPkg = buildCustomPortablePackage({
      password: BACKUP_PASSWORD,
      manifestPayload: validManifest,
      dataFrames: [
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.CONTINUE, index: 1, plaintext: validFirstFrame },
        { streamId: PORTABLE_STREAM_ID.DATA, type: PORTABLE_FRAME_TYPE.DATA, flags: PORTABLE_FRAME_FLAG.FINAL, index: 0, plaintext: Buffer.alloc(16) },
      ],
      footerPayloadBuilder: makeFooter,
    })
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: oooPkg, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.INVALID_CONTAINER,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 9. Truncated file -> INVALID_CONTAINER
  {
    const truncated = validBytes.subarray(0, validBytes.length - 32)
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: truncated, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.INVALID_CONTAINER,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 10. Trailing bytes appended -> INVALID_CONTAINER
  {
    const trailing = new Uint8Array(validBytes.length + 1)
    trailing.set(validBytes, 0)
    trailing[validBytes.length] = 0x42
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: trailing, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.INVALID_CONTAINER,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 11. Resource limit exceeded (frame plainLen > 65536) -> RESOURCE_LIMIT
  {
    const oversizedFrameHdr = validBytes.slice()
    // Overwrite DATA frame header plaintextLen at offset 200+12 = 212 to 0x00010001 (65537)
    oversizedFrameHdr[212] = 0x00
    oversizedFrameHdr[213] = 0x01
    oversizedFrameHdr[214] = 0x00
    oversizedFrameHdr[215] = 0x01
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: oversizedFrameHdr, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider }),
      err => err.code === PORTABLE_ERROR_CODES.RESOURCE_LIMIT,
    )
    assert.equal(sink.state, 'aborted')
  }

  // 12. Active cancel via AbortSignal -> CANCELLED
  {
    const ctrl = new AbortController()
    ctrl.abort()
    const sink = createSqliteStagingSink({ cryptoProvider })
    await assert.rejects(
      decodeKpb1ToStaging({ source: validBytes, password: BACKUP_PASSWORD, stagingSink: sink, cryptoProvider, signal: ctrl.signal }),
      err => err.code === PORTABLE_ERROR_CODES.CANCELLED,
    )
  }

  // 13. Error normalization never leaks raw secret strings
  {
    const norm = normalizePortableRestoreError(new Error('raw secret password=TOP_SECRET_123'))
    assert.equal(norm.code, PORTABLE_ERROR_CODES.IO_FAILED)
    assert.equal(norm.message.includes('TOP_SECRET_123'), false)
  }
})
