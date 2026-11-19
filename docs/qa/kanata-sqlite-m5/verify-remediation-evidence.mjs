import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { KANATA_MIGRATION_TABLES } from '../../../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex')
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const pid = value => typeof value === 'string' && /^[1-9]\d*$/.test(value)
const integer = value => Number.isSafeInteger(value) && value >= 0

export function verifyTableProof(proof, messages) {
  assert.equal(proof.tableAlgorithm, 'kanata-m5-table-v1')
  assert.equal(proof.aggregateAlgorithm, 'm5-table-receipt-v1')
  // Exact sequence from the frozen migration table list rejects missing,
  // repeated, swapped and unknown tables without trusting the receipt's order.
  assert.deepEqual(proof.tables.map(table => table.name), [...KANATA_MIGRATION_TABLES])
  const counts = new Map()
  const payload = proof.tables.map(({ name, count, empty, sha256 }) => {
    assert.ok(integer(count) && isSha(sha256), 'invalid table count or SHA-256')
    assert.equal(empty, count === 0, name)
    if (empty) assert.equal(sha256, sha('kanata-m5-empty-v1:' + name))
    counts.set(name, count)
    return [name, count, empty, sha256]
  })
  assert.equal(proof.aggregateSha256, sha(JSON.stringify(payload)), 'mismatched table aggregate')
  assert.equal(counts.get('messages'), messages)
  assert.equal(counts.get('archived_message_marks'), messages - 2)
  assert.equal(counts.get('event_causes'), 1)
  assert.equal(counts.get('message_life_sources'), 4)
  for (const empty of ['memory_links', 'relationship_events', 'task_social_participants', 'domain_command_receipts']) {
    assert.equal(counts.get(empty), 0)
  }
}

export function verifySourceReceipt(source, archiveCount) {
  const { before, after, calls } = source
  assert.ok(isSha(before.primarySha256) && isSha(before.archivesSha256) && isSha(before.journalSha256))
  assert.equal(before.archiveCount, archiveCount)
  assert.deepEqual(after, before)
  for (const key of ['read', 'stat', 'list', 'write', 'rename', 'delete']) assert.ok(integer(calls[key]), key)
  assert.ok(calls.read > 0)
  for (const action of ['write', 'rename', 'delete']) assert.equal(calls[action], 0)
}

const faultExpected = [
  ['before-first-commit', 0, 0, 0, 0, 'pending', 'pending'],
  ['during-batch', 1, 0, 0, 0, 'pending', 'running'],
  ['after-batch-commit', 1, 50, 50, 1, 'running', 'running'],
  ['before-verification', 1, 55, 53, 2, 'complete', 'running'],
]

export function verifyRemediationEvidence(evidence) {
  assert.equal(evidence.version, 1)
  assert.match(evidence.implementation, /^[a-f0-9]{40}$/)
  const rejection = evidence.staleManifest
  assert.equal(rejection.reason, 'M5_AVD_IDENTITY_UNCONFIRMED')
  assert.deepEqual(rejection.rejected, ['install', 'clear', 'kill', 'stop', 'data-directory-mismatch', 'transport-changed', 'expired'])
  assert.equal(rejection.destructiveCalls, 0)
  for (const key of ['unchanged', 'packagesUnchanged', 'avdUnchanged']) assert.equal(rejection[key], true)
  assert.ok(isSha(rejection.databaseBefore))
  assert.equal(rejection.databaseAfter, rejection.databaseBefore)
  assert.deepEqual(evidence.runs.map(run => run.mode), ['smoke', 'full', '100k'])
  const first = evidence.runs[0]
  const { instance, artifacts } = first
  assert.match(instance.id, /^[a-f0-9]{32}$/)
  assert.ok(Number.isSafeInteger(instance.launcherPid) && instance.launcherPid > 0)
  assert.match(instance.launcherStarted, /^\d+$/)
  assert.match(instance.transport, /^\d+$/)
  assert.ok(isSha(instance.dataDirectorySha256) && isSha(instance.manifestSha256))
  for (const name of ['app', 'testApk', 'catalog', 'bundle', 'nativePlugin']) assert.ok(isSha(artifacts[name]), name)
  for (const run of evidence.runs) {
    assert.deepEqual(run.instance, instance)
    assert.deepEqual(run.artifacts, artifacts)
    assert.equal(run.api, 34)
    assert.equal(run.android, '14')
    assert.equal(run.serial, 'emulator-5582')
    assert.equal(run.emulator, 'kanata_m5_' + instance.id)
    assert.equal(run.exit, 0)
    assert.ok(isSha(run.logSha256))
    assert.deepEqual(run.cleanup, { exit: 0, pidGone: true })
  }
  assert.equal(evidence.instrumentation.passed, 2)
  assert.equal(evidence.instrumentation.exit, 0)
  const { smoke } = evidence
  const causalFieldsSha256 = smoke.causalFieldsSha256
  assert.equal(smoke.smoke, 'PASS')
  assert.equal(smoke.idempotent, true)
  assert.equal(smoke.leaseRevoked, true)
  assert.equal(smoke.health.cipher, '4.17.0 community')
  assert.ok(isSha(causalFieldsSha256))
  function verified(row, count) {
    verifyTableProof(row.tableProof, count)
    verifySourceReceipt(row.source, Math.ceil((count - 2) / 50))
    assert.equal(row.causalFieldsSha256, causalFieldsSha256)
    assert.equal(row.foreignKeyViolations, 0)
    assert.equal(row.integrity, 'ok')
    assert.ok(isSha(row.fingerprint))
  }
  verified(smoke, 55)
  assert.deepEqual(smoke.counts, Object.fromEntries(smoke.tableProof.tables.map(row => [row.name, row.count])))
  assert.equal(evidence.interruptions.length, faultExpected.length)
  evidence.interruptions.forEach((row, index) => {
    const [fault, dataset, messages, marks, archiveIndex, state, manifest] = faultExpected[index]
    assert.equal(row.fault, fault)
    assert.equal(row.hookReached, true)
    assert.equal(row.oldPidGone, true)
    assert.equal(row.oldCdpDisconnected, true)
    assert.ok(pid(row.oldPid) && pid(row.newPid) && row.oldPid !== row.newPid)
    const db = row.candidateDb.before
    assert.equal(db.instanceId, instance.id)
    assert.equal(db.package, 'com.yubin.formyself.m2qa')
    assert.equal(db.path, 'no_backup/kanata-sqlite-v1/kanata.db')
    assert.ok(pid(db.inode))
    assert.deepEqual(row.candidateDb.after, db)
    assert.equal(row.candidateDb.create, false)
    assert.deepEqual(row.before, {
      dataset, messages, marks, manifest, lifeSources: messages === 0 ? 0 : messages === 50 ? 3 : 4,
      archive: { cursor_json: { archiveIndex, messageOffset: 0 }, imported_count: marks, state },
    })
    assert.equal(row.status, 'complete')
    assert.equal(row.repeated, 'already-complete')
    verifySourceReceipt(row.sourceBeforeKill, 2)
    assert.deepEqual(row.sourceBeforeKill.before, row.source.before)
    verified(row, 55)
  })
  assert.deepEqual(evidence.capacity.map(row => row.capacity), [1000, 10000, 100000])
  for (const row of evidence.capacity) {
    verified(row, row.capacity)
    assert.equal(row.maxBatch, 50)
    assert.equal(row.messageBatches, Math.ceil((row.capacity - 2) / 50) + 1)
    assert.equal(row.health.cipher, '4.17.0 community')
    assert.equal(row.leaseRevoked, true)
    assert.equal(row.sqlTableCount, 50)
    assert.equal(row.primaryCiphertextSha256, row.source.before.primarySha256)
    assert.ok(isSha(row.fixtureSha256))
    assert.ok(row.samples > 0 && row.dbBytes > 0
      && row.peakRssBytes === (row.peak.appRssKiB + row.peak.rendererRssKiB) * 1024)
    for (const metric of [row.totalMs, row.fixtureMs, row.recentMs, row.olderMs,
      row.messageBatchTimingMs.min, row.messageBatchTimingMs.max, row.messageBatchTimingMs.mean]) {
      assert.ok(Number.isFinite(metric) && metric >= 0)
    }
  }
  assert.deepEqual(evidence.negative.filter(row => row.negative).map(row => [row.negative, row.code]), [
    ['corrupt-page', 'KANATA_ARCHIVE_VERIFY_FAILED'],
    ['recovered', 'KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'],
    ['occupied', 'KANATA_MIGRATION_TARGET_NOT_EMPTY'],
  ])
  const rejectedSource = evidence.negative.find(row => row.wrongKey)
  assert.equal(rejectedSource.wrongKey, 'KANATA_SQLITE_UNLOCK_FAILED')
  assert.equal(rejectedSource.changedSource, 'KANATA_MIGRATION_SOURCE_CHANGED')
  for (const row of evidence.negative) {
    assert.equal(row.writes, 0)
    assert.deepEqual(row.after, row.before)
    assert.deepEqual(row.source.before, row.source.after)
    for (const action of ['write', 'rename', 'delete']) assert.equal(row.source.calls[action], 0)
  }
  return { verified: true, targetReceipts: 1 + evidence.interruptions.length + evidence.capacity.length,
    uniqueTablesPerReceipt: KANATA_MIGRATION_TABLES.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node verify-remediation-evidence.mjs <machine-evidence.json>')
  console.log(JSON.stringify(verifyRemediationEvidence(JSON.parse(await readFile(process.argv[2], 'utf8')))))
}
