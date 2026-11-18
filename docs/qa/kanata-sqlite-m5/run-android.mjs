import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { kanataSqliteFixture } from '../../../tests/helpers/kanataSqliteFixture.js'
import { m5Catalog } from './catalog.mjs'
import { seed } from './fixture.mjs'

const pkg = 'com.yubin.formyself.m2qa'
const testPkg = pkg + '.test'
const manifestPath = path.resolve(process.argv[2])
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const mode = process.argv[3]
assert.ok(['smoke', 'full', '100k'].includes(mode))
assert.equal(process.platform, 'win32')
assert.equal(manifest.syntheticOnly, true)
assert.equal(manifest.createdBy, 'M2 Windows/WHPX preflight')
assert.equal(manifest.avdName, 'kanata_m2_api34')
assert.equal(manifest.serial, 'emulator-5582')
assert.equal(manifest.api, 34)
assert.equal(path.resolve(manifest.root), path.dirname(manifestPath))
assert.match(path.basename(manifest.root), /^kanata-m2-synthetic-[a-f0-9]{8}$/)
assert.equal(path.resolve(manifest.avdHome), path.join(manifest.root, 'avd'))
const adbPath = path.join(manifest.sdk, 'platform-tools', 'adb.exe')
const adb = (...args) => execFileSync(adbPath, ['-s', manifest.serial, ...args], {
  encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
}).trim()
assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), manifest.avdName)
assert.equal(adb('shell', 'getprop', 'sys.boot_completed'), '1')
assert.equal(adb('shell', 'getprop', 'ro.build.version.sdk'), '34')
const installed = () => adb('shell', 'pm', 'list', 'packages', '-3').split(/\r?\n/).filter(Boolean).map(line => line.slice(8))
assert.ok(installed().every(id => [pkg, testPkg].includes(id)), 'non-QA package present')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = value => console.log(JSON.stringify(value))
const aapt = path.join(manifest.sdk, 'build-tools', '35.0.0', 'aapt.exe')
const apkSpecs = [
  [pkg, 'android/app/build/outputs/apk/debug/app-debug.apk'],
  [testPkg, 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'],
]
for (const [id, apk] of apkSpecs) {
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8', windowsHide: true })
  assert.equal(badging.match(/^package: name='([^']+)'/m)?.[1], id)
  const bytes = await readFile(apk)
  assert.match(adb('install', '-r', '-t', path.resolve(apk)), /Success/)
  const installedPath = adb('shell', 'pm', 'path', id).replace(/^package:/, '')
  assert.match(installedPath, /^\/data\/app\/[a-zA-Z0-9._=~/+-]+\/base\.apk$/)
  const readback = execFileSync(adbPath, ['-s', manifest.serial, 'exec-out', 'cat', installedPath], {
    maxBuffer: bytes.length + 1024, timeout: 30000, windowsHide: true,
  })
  assert.equal(hash(readback), hash(bytes))
  receipt({ apk: id, sha256: hash(bytes) })
}
assert.deepEqual(installed().sort(), [pkg, testPkg].sort())
const android = adb('shell', 'getprop', 'ro.build.version.release')
const webView = adb('shell', 'dumpsys', 'webviewupdate').split(/\r?\n/).find(line => /Current WebView package/.test(line))?.trim()
const catalog = await readFile('android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json')
receipt({ mode, seed, android, api: 34, emulator: manifest.avdName, serial: manifest.serial, webView, catalogSha256: hash(catalog) })
receipt({ nativePluginSha256: hash(await readFile('android/app/src/main/java/com/yubin/formyself/KanataSqlitePlugin.java')) })

if (mode === 'smoke') {
  const result = adb('shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
    'com.yubin.formyself.KanataM5CipherTest,com.yubin.formyself.KanataSqliteTransactionTest',
    testPkg + '/androidx.test.runner.AndroidJUnitRunner')
  console.log(result)
  assert.match(result, /OK \(2 tests\)/)
}

const bundle = (await build({
  entryPoints: ['docs/qa/kanata-sqlite-m5/device.mjs'], bundle: true, write: false,
  format: 'esm', target: 'chrome113', define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0]
const oracle = await m5Catalog()
receipt({ bundleSha256: hash(bundle.contents) })

function memory() {
  // The newly created AVD allows only the QA app and its test package.
  const processes = adb('shell', 'ps', '-A', '-o', 'PID,RSS,NAME')
    .split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line))
    .filter(Boolean)
  const app = processes.find(row => row[3] === pkg)
  const renderers = processes.filter(row => row[3].startsWith('com.google.android.webview:sandboxed_process'))
  return { appRssKiB: Number(app?.[2] ?? 0), rendererRssKiB: renderers.reduce((n, row) => n + Number(row[2]), 0),
    rendererCount: renderers.length }
}
const rssBytes = peak => (peak.appRssKiB + peak.rendererRssKiB) * 1024

async function start() {
  const activity = pkg + '/com.yubin.formyself.MainActivity'
  assert.match(adb('shell', 'am', 'start', '-W', '-n', activity), /Status: ok/)
  let port, socket
  try {
    let pid, page
    for (let attempt = 0; attempt < 40 && !page; attempt++) {
      pid = adb('shell', 'pidof ' + pkg + ' || true')
      const name = 'webview_devtools_remote_' + pid
      if (!port && /^\d+$/.test(pid)
        && adb('shell', 'cat', '/proc/net/unix').split(/\r?\n/).some(line => line.endsWith('@' + name))) {
        port = adb('forward', 'tcp:0', 'localabstract:' + name)
        assert.match(port, /^\d+$/)
      }
      if (port) {
        const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json()
        page = pages.find(target => target.type === 'page' && target.title === 'M2_SQLCIPHER_SYNTHETIC')
      }
      if (!page) await delay(250)
    }
    assert.equal(page?.url, 'https://localhost/')
    assert.equal(new URL(page.webSocketDebuggerUrl).host, '127.0.0.1:' + port)
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('M5_CDP_OPEN_TIMEOUT')), 5000)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('M5_CDP_OPEN_FAILED')) }, { once: true })
    })
    let id = 0
    function evaluate(expression, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const request = ++id
        const finish = (error, value) => {
          clearTimeout(timer)
          socket.removeEventListener('message', onMessage)
          socket.removeEventListener('close', onClose)
          if (error) reject(error)
          else resolve(value)
        }
        const onClose = () => finish(Error('M5_CDP_CLOSED'))
        const timer = setTimeout(() => finish(Error('M5_CDP_TIMEOUT')), timeoutMs)
        function onMessage(event) {
          const reply = JSON.parse(event.data)
          if (reply.id !== request) return
          // CDP errors may contain the evaluation expression. Do not print them.
          finish(reply.error || reply.result.exceptionDetails ? Error('M5_CDP_EVALUATION_FAILED') : null,
            reply.result?.result?.value)
        }
        socket.addEventListener('close', onClose, { once: true })
        socket.addEventListener('message', onMessage)
        socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true } }))
      })
    }
    assert.equal(await evaluate('(async()=>{const u=URL.createObjectURL(new Blob([' + JSON.stringify(bundle.text)
      + '],{type:"text/javascript"}));try{await import(u);return typeof window.m5Qa}finally{URL.revokeObjectURL(u)}})()'), 'object')
    return { pid, evaluate, close() { socket.close(); adb('forward', '--remove', 'tcp:' + port) } }
  } catch (error) {
    socket?.close()
    if (port) adb('forward', '--remove', 'tcp:' + port)
    throw error
  }
}

let page
const randomSecret = () => {
  const bytes = randomBytes(32)
  try { return bytes.toString('base64') } finally { bytes.fill(0) }
}
const password = randomSecret(), key = randomSecret()
const call = (method, args = [], timeout) => page.evaluate('window.m5Qa.' + method
  + '(' + args.map(value => JSON.stringify(value)).join(',') + ')', timeout)
const setup = (count, exportFixture = false) => call('setup', [kanataSqliteFixture(), count, password, exportFixture], 120000)
const run = options => call('run', [{ key, password, ...options }], mode === '100k' ? 25 * 60000 : 12 * 60000)
async function cleanStart() {
  page?.close()
  page = undefined
  // The whole package was installed in this task's newly created AVD.
  assert.equal(adb('shell', 'pm', 'clear', pkg), 'Success')
  page = await start()
}
const committedState = {
  'before-first-commit': { messages: 0, marks: 0, lifeSources: 0, archiveIndex: 0, state: 'pending', archiveImported: 0, manifest: 'pending' },
  'during-batch': { messages: 0, marks: 0, lifeSources: 0, archiveIndex: 0, state: 'pending', archiveImported: 0, manifest: 'running' },
  'after-batch-commit': { messages: 50, marks: 50, lifeSources: 3, archiveIndex: 1, state: 'running', archiveImported: 50, manifest: 'running' },
  'before-verification': { messages: 55, marks: 53, lifeSources: 4, archiveIndex: 2, state: 'complete', archiveImported: 53, manifest: 'running' },
}
function verifyResult(result, count) {
  if (result.error) throw Error(result.error)
  assert.equal(result.result.verifiedTableCount, 50)
  assert.equal(result.result.counts.messages, count)
  assert.equal(result.result.counts.archived_message_marks, count - 2)
  assert.equal(result.result.counts.message_life_sources, 4)
  assert.equal(result.rows.foreignKeyViolations, 0)
  assert.equal(result.rows.integrity, 'ok')
  assert.match(result.health.cipher, /^4\.17\.0/)
  assert.equal(result.sourceUnchanged, true)
  assert.equal(result.leaseRevoked, true)
  if (count === 55) {
    assert.deepEqual(result.result.counts, oracle.counts)
    assert.deepEqual(result.rows.tables, oracle.oracle.tables)
  }
}

async function capacity(count) {
  await cleanStart()
  let peak = memory(), samples = 1, stopped = false
  const sample = async () => {
    while (!stopped) {
      await delay(1000)
      if (stopped) return
      const current = memory()
      samples++
      if (rssBytes(current) > rssBytes(peak)) peak = current
    }
  }
  const sampling = sample()
  const started = performance.now()
  let fixture, result
  try {
    fixture = await setup(count)
    const fixtureMs = performance.now() - started
    const fixtureSha256 = await call('sourceFilesSha', [], 120000)
    receipt({ capacityStarted: count, fixtureMs, fixturePrimarySha256: fixture.primaryHash, fixtureSha256 })
    result = await run({ create: true })
    verifyResult(result, count)
    const dbBytes = Number(adb('shell', 'run-as', pkg, 'stat', '-c', '%s', 'no_backup/kanata-sqlite-v1/kanata.db'))
    const { batchMs, rows, result: migrated, ...rest } = result
    receipt({ capacity: count, ...rest, fixtureMs, fixtureSha256, fingerprint: migrated.sourceFingerprint,
      sqlTableCount: migrated.verifiedTableCount, recentMs: rows.recentMs, olderMs: rows.olderMs, integrity: rows.integrity,
      foreignKeyViolations: rows.foreignKeyViolations, dbBytes, peakRssBytes: rssBytes(peak), peak, samples,
      messageBatchTimingMs: { min: Math.min(...batchMs), max: Math.max(...batchMs), mean: batchMs.reduce((a, b) => a + b, 0) / batchMs.length },
    })
  } finally {
    stopped = true
    await sampling
  }
}

try {
  if (mode === 'smoke') {
    await cleanStart()
    await setup(55)
    const result = await run({ create: true, repeat: true })
    verifyResult(result, 55)
    assert.equal(result.repeated, 'already-complete')
    receipt({ smoke: 'PASS', fingerprint: result.result.sourceFingerprint, counts: result.result.counts,
      verifiedTableDigestSha256: hash(JSON.stringify(result.rows.tables)), health: result.health,
      sourceUnchanged: result.sourceUnchanged, leaseRevoked: result.leaseRevoked, idempotent: true })
  } else if (mode === 'full') {
    for (const [fault, expected] of Object.entries(committedState)) {
      await cleanStart()
      const fixture = await setup(55, true)
      const pending = run({ create: true, fault }).then(value => ({ value }), error => ({ error }))
      let phase
      for (let attempt = 0; attempt < 240; attempt++) {
        phase = await call('phase')
        if (phase === fault || phase === 'finished') break
        await delay(250)
      }
      assert.equal(phase, fault)
      assert.equal(await call('assertPausedSource'), true)
      const oldPid = page.pid
      adb('shell', 'run-as', pkg, 'kill', '-9', oldPid)
      for (let i = 0; i < 16 && adb('shell', 'pidof ' + pkg + ' || true'); i++) await delay(250)
      assert.equal(adb('shell', 'pidof ' + pkg + ' || true'), '')
      page.close()
      assert.equal((await pending).error?.message, 'M5_CDP_CLOSED')
      page = await start()
      assert.notEqual(oldPid, page.pid)
      await call('load', [fixture])
      const result = await run({ create: false, repeat: true })
      verifyResult(result, 55)
      assert.equal(result.result.status, 'complete')
      assert.equal(result.repeated, 'already-complete')
      const before = result.before
      assert.deepEqual(before, {
        messages: expected.messages, marks: expected.marks, lifeSources: expected.lifeSources, manifest: expected.manifest,
        dataset: fault === 'before-first-commit' ? 0 : 1,
        archive: { imported_count: expected.archiveImported, state: expected.state,
          cursor_json: { archiveIndex: expected.archiveIndex, messageOffset: 0 } },
      })
      receipt({ fault, oldPid, newPid: page.pid, before, status: result.result.status, repeated: result.repeated,
        sourceUnchangedBeforeKill: true, sourceUnchangedAfterRecovery: result.sourceUnchanged,
        fingerprint: result.result.sourceFingerprint })
    }
    const wrong = await run({ create: false, negative: 'wrong-key' })
    assert.equal(wrong.error, 'KANATA_SQLITE_UNLOCK_FAILED')
    await setup(55)
    const changed = await run({ create: false })
    assert.equal(changed.error, 'KANATA_MIGRATION_SOURCE_CHANGED')
    assert.deepEqual(changed.before, changed.after)
    assert.equal(changed.writes, 0)
    for (const [negative, expected] of [
      ['corrupt-page', 'KANATA_ARCHIVE_VERIFY_FAILED'],
      ['recovered', 'KANATA_MIGRATION_SOURCE_RECOVERY_REQUIRED'],
      ['occupied', 'KANATA_MIGRATION_TARGET_NOT_EMPTY'],
    ]) {
      await cleanStart()
      await setup(55)
      const result = await run({ create: true, negative })
      assert.equal(result.error, expected)
      assert.deepEqual(result.before, result.after)
      assert.deepEqual(result.after, { archive: null, manifest: null, dataset: negative === 'occupied' ? 1 : 0,
        messages: 0, marks: 0, lifeSources: 0 })
      assert.equal(result.writes, 0)
      assert.equal(result.sourceUnchanged, true)
      assert.equal(result.leaseRevoked, true)
      receipt({ negative, code: result.error, before: result.before, after: result.after })
    }
    receipt({ wrongKey: wrong.error, changedSource: changed.error })
    await capacity(1000)
    await capacity(10000)
  } else await capacity(100000)
} finally {
  page?.close()
  // The host retains no fixture files or secrets. Only the task's own app is stopped.
  const result = spawn(adbPath, ['-s', manifest.serial, 'shell', 'am', 'force-stop', pkg],
    { windowsHide: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => { result.once('error', reject); result.once('exit', resolve) })
}
