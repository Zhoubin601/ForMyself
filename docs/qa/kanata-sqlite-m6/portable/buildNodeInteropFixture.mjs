import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bytesToHex, hexToBytes } from '../../../../src/features/chat/backup/portable/bytes.js'
import {
  createIsolatedKanata005Db,
  exportSyntheticPortableBackup,
  readPortableSnapshotFromSqlite,
} from './syntheticCodec.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const db = createIsolatedKanata005Db(':memory:')
db.exec('BEGIN IMMEDIATE;')
db.exec(`INSERT INTO dataset_metadata VALUES(1, 'user-interop', 2, '{"k": 1}');`)
db.exec(`INSERT INTO worlds VALUES('w1', '合成世界📦', 'rules', 1, 'UTC', 0, 9007199254740991, 1, 0, 1, 'daily', NULL, 'id-1', '{}');`)
db.prepare(`INSERT INTO world_identities VALUES('id-1', 'w1', 'user-interop', ?, 'bg', 1, '{}')`).run('\ufeff e\u0301 \u0000\ufeff ')
db.exec(`INSERT INTO character_cards VALUES('card-1', 'ver-1', 0, NULL, '{}');`)
db.exec(`INSERT INTO card_versions VALUES('ver-1', 'card-1', 1, '{"name":"K"}', '{"raw":true}', 'import', NULL, '{}');`)
db.exec(`INSERT INTO character_instances VALUES('inst-1', 'w1', 'card-1', 'ver-1', 1, '{}', 'calm', -0.0, 'home', 1, 0, '{}');`)
db.exec(`INSERT INTO conversations VALUES('c1', 'w1', 'private', 'Interop', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}');`)
db.exec(`INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0);`)
db.exec(`INSERT INTO conversation_participants VALUES('w1', 'c1', 'inst-1', 'character', 1);`)
db.exec(`INSERT INTO messages VALUES('m1', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'hi', 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}');`)
db.exec(`INSERT INTO messages VALUES('m2', 'w1', 'c1', 'assistant', 'character', 'inst-1', 'K', 'hello', 101, 1, 'complete', 't1', 'b2', NULL, 'm1', 1, '{}');`)
db.exec(`INSERT INTO world_events VALUES('evt-1', 'w1', 'committed', 'private', '约定', 1000, 1000, 1, NULL, 'note', NULL, NULL, NULL, NULL, '{}');`)
db.exec(`INSERT INTO world_effects VALUES('eff-1', 'w1', 'evt-1', 'instance', 'inst-1', 'inst-1', NULL, 'set', 'state.mood', '"happy"', 1, '{}');`)
db.exec(`INSERT INTO effect_baselines VALUES('base-1', 'w1', 'instance', 'inst-1', 'inst-1', NULL, 'state.mood', '"calm"', '{}');`)
db.exec(`INSERT INTO background_tasks VALUES('task-1', 'w1', 'proactive', 'running', 'k1', 1, 1, 2000, 99999, 'c1', 'inst-1', NULL, '{}', NULL, NULL, NULL, NULL, NULL, '{}');`)
db.exec('COMMIT;')

const snap = await readPortableSnapshotFromSqlite(db)
// Node v24 experimental node:sqlite truncates TEXT at embedded NUL on readback; restore full UTF-8 value for wire reference parity
snap.businessRows.world_identities[0].display_name = '\ufeff e\u0301 \u0000\ufeff '
const password = ' 合成📦 e\u0301 \u0000\ufeff '
const material = {
  salt: hexToBytes('101112131415161718191a1b1c1d1e1f'),
  backupId: hexToBytes('202122232425262728292a2b2c2d2e2f'),
  wrapNonce: hexToBytes('303132333435363738393a3b'),
  bek: hexToBytes('505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f'),
}
const exported = await exportSyntheticPortableBackup({
  password,
  getTableSource: snap.getTableSource,
  derivedVerifiers: snap.derivedVerifiers,
  material,
})
const pkgSha256 = createHash('sha256').update(exported.bytes).digest('hex')
const outBin = join(dir, 'node_interop_populated.kpb1')
const outMeta = join(dir, 'node_interop_populated.json')
writeFileSync(outBin, exported.bytes)
writeFileSync(outMeta, JSON.stringify({
  password,
  saltHex: bytesToHex(material.salt),
  backupIdHex: bytesToHex(material.backupId),
  wrapNonceHex: bytesToHex(material.wrapNonce),
  bekHex: bytesToHex(material.bek),
  packageByteLength: exported.bytes.byteLength,
  packageSha256: pkgSha256,
  transcriptHex: bytesToHex(exported.footer.transcript),
  dataFrameCount: exported.footer.dataFrameCount,
}, null, 2) + '\n', 'utf8')
console.log(`Generated ${outBin} (${exported.bytes.byteLength} B, sha256=${pkgSha256})`)
