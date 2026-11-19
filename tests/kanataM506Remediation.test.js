import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createRunnerGuard, qaPid, stopQa, withQaCleanup } from '../docs/qa/kanata-sqlite-m5/runner-guard.mjs'
import { verifyTableProof } from '../docs/qa/kanata-sqlite-m5/verify-remediation-evidence.mjs'
import { KANATA_MIGRATION_TABLES } from '../src/features/chat/storage/sqlite/kanataDataMigrationRows.js'

const pkg = 'com.yubin.formyself.m2qa'
const sha = value => createHash('sha256').update(value).digest('hex')
const delay = async () => {}

test('M5-06 rejects a stale manifest before touching the same-named AVD and white-listed package', t => {
  const instanceId = 'a09c2f815d114330bbedf02a910621fb'
  const root = 'E:\\Android\\kanata-m2-synthetic-a09c2f81'
  const sdk = 'E:\\Android\\Sdk'
  const avdName = 'kanata_m5_' + instanceId
  const avdHome = root + '\\avd'
  const dataDirectory = avdHome + '\\' + avdName + '.avd'
  const manifest = { identityVersion: 1, syntheticOnly: true, createdBy: 'M2 Windows/WHPX preflight',
    root, sdk, instanceId, avdHome, avdName, dataDirectory, launcherPid: 1234, launcherStarted: '639306589016505801',
    serial: 'emulator-5582', api: 34, expiresAt: 4000 }
  const manifestPath = root + '\\device-manifest.json'
  const live = { pid: 1234, started: '639306589016505800', executable: sdk + '\\emulator\\emulator.exe',
    avdName, launchAvd: avdName, launchPort: '5582', serial: manifest.serial, api: 34, booted: true,
    launchDataDirectory: dataDirectory, dataDirectory, transportId: '5' }
  const device = { avdName, serial: live.serial, packages: [pkg, pkg + '.test'],
    candidateDatabase: Buffer.from('m5-review-synthetic-database-bytes'), pid: '7001' }
  const stateBefore = { ...device, candidateDatabase: Buffer.from(device.candidateDatabase) }
  const databaseSha256 = sha(device.candidateDatabase)
  const calls = [], rejected = []
  const guard = createRunnerGuard({ manifest, manifestPath, now: () => 1000, inspect: () => live,
    execute(_transport, ...args) {
      calls.push(args[0])
      device.packages = []
      device.candidateDatabase.fill(0)
      device.pid = null
    },
  })
  guard.verify()
  live.started = '639306589026505800'
  for (const [label, args] of [
    ['install', ['install', '-r']], ['clear', ['shell', 'pm', 'clear', pkg]],
    ['kill', ['shell', 'run-as', pkg, 'kill', '-9', device.pid]], ['stop', ['shell', 'am', 'force-stop', pkg]],
  ]) {
    assert.throws(() => guard.command(...args), { code: 'M5_AVD_IDENTITY_UNCONFIRMED' })
    rejected.push(label)
  }
  live.started = manifest.launcherStarted
  live.dataDirectory = manifest.root + '\\other.avd'
  assert.throws(() => guard.command('install', '-r'), { code: 'M5_AVD_IDENTITY_UNCONFIRMED' })
  rejected.push('data-directory-mismatch')
  live.dataDirectory = manifest.dataDirectory
  live.transportId = '6'
  assert.throws(() => guard.command('install', '-r'), { code: 'M5_AVD_IDENTITY_UNCONFIRMED' })
  rejected.push('transport-changed')
  const expired = createRunnerGuard({ manifest, manifestPath, now: () => manifest.expiresAt,
    inspect: () => assert.fail('expired manifest must fail before inspecting target'), execute: () => assert.fail() })
  assert.throws(() => expired.command('install'), { code: 'M5_AVD_IDENTITY_UNCONFIRMED' })
  rejected.push('expired')
  assert.deepEqual(device, stateBefore)
  assert.deepEqual(calls, [])
  t.diagnostic(JSON.stringify({ staleManifest: { reason: 'M5_AVD_IDENTITY_UNCONFIRMED', rejected,
    destructiveCalls: calls.length, unchanged: true, databaseBefore: databaseSha256,
    databaseAfter: sha(device.candidateDatabase), packagesUnchanged: true, avdUnchanged: true } }))
})

test('M5-06 force-stop requires successful exit and verified PID disappearance', async () => {
  const commands = [], answers = ['7001', null]
  assert.deepEqual(await stopQa({ command: (...args) => commands.push(args), pid: () => answers.shift(), pkg, delay }),
    { exit: 0, pidGone: true })
  assert.deepEqual(commands, [['shell', 'am', 'force-stop', pkg]])
  assert.equal(qaPid(() => 'PID NAME\n    1 init', pkg), null)
})

test('M5-06 force-stop propagates a nonzero command exit without reporting success', async () => {
  const error = Object.assign(Error('adb refused'), { status: 1 })
  await assert.rejects(stopQa({ command() { throw error }, pid: () => assert.fail(), pkg, delay }), { status: 1 })
})

test('M5-06 force-stop fails if PID remains live', async () => {
  await assert.rejects(stopQa({ command() {}, pid: () => '7001', pkg, delay, attempts: 2 }), /M5_QA_PID_STILL_LIVE/)
})

test('M5-06 PID query failure preserves both scenario and cleanup errors', async () => {
  const queryError = new Error('pid query disconnected')
  const scenarioError = new Error('synthetic import failed')
  const cleanup = () => stopQa({ command() {}, pid: () => qaPid(() => { throw queryError }, pkg), pkg, delay })
  await assert.rejects(cleanup(), queryError)
  await assert.rejects(withQaCleanup(() => { throw scenarioError }, cleanup), error =>
    error instanceof AggregateError && error.errors[0] === scenarioError && error.errors[1] === queryError)
  assert.throws(() => qaPid(() => 'PID NAME\nmalformed process row', pkg), /M5_QA_PID_QUERY_INVALID/)
})

test('M5-06 verifier rejects incomplete, duplicate, unknown or changed table proofs', () => {
  const populated = { messages: 55, archived_message_marks: 53, event_causes: 1, message_life_sources: 4 }
  const tables = KANATA_MIGRATION_TABLES.map(name => {
    const count = populated[name] ?? 0
    return { name, count, empty: count === 0, sha256: sha(count ? name : 'kanata-m5-empty-v1:' + name) }
  })
  const proof = { tableAlgorithm: 'kanata-m5-table-v1', aggregateAlgorithm: 'm5-table-receipt-v1', tables,
    aggregateSha256: sha(JSON.stringify(tables.map(r => [r.name, r.count, r.empty, r.sha256]))) }
  verifyTableProof(proof, 55)
  for (const mutate of [
    rows => rows.pop(), rows => { rows[1] = rows[0] }, rows => { rows[0].name = 'other' },
    rows => { delete rows[0].empty }, rows => { rows[0].sha256 = sha('wrong empty proof') },
    rows => { rows.find(row => row.name === 'messages').sha256 = sha('wrong nonempty proof') },
  ]) {
    const altered = structuredClone(proof)
    mutate(altered.tables)
    assert.throws(() => verifyTableProof(altered, 55))
  }
})
