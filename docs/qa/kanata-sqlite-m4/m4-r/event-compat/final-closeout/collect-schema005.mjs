import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, join, dirname, basename } from 'node:path'

const evidence = resolve('docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout')
const manifestPath = resolve(process.argv[2])
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
assert.equal(manifest.syntheticOnly, true)
assert.equal(manifest.createdBy, 'M2 Windows/WHPX preflight')
assert.equal(manifest.serial, 'emulator-5582')
assert.equal(manifest.avdName, 'kanata_m2_api34')
assert.equal(dirname(manifestPath), resolve(manifest.root))
assert.match(basename(manifest.root), /^kanata-m2-synthetic-[a-f0-9]{8}$/)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sha = path => hash(readFileSync(path))
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const put = (name, bytes) => {
  const path = join(evidence, name)
  if (existsSync(path)) assert.equal(sha(path), hash(bytes), 'Preserve previous evidence')
  else writeFileSync(path, bytes, { flag: 'wx' })
}
const archives = {}
for (const folder of ['schema005-device-first', 'schema005-regression', 'schema005-regression-retry',
  'schema005-device-final', 'schema005-regression-final']) {
  for (const name of ['result.txt', 'logcat.txt', 'instrumentation.txt', 'apk-sha256.txt']) {
    const raw = readFileSync(join(manifest.root, folder, name))
    const output = folder + '-' + name + '.gz'
    const compressed = gzipSync(raw)
    put(output, compressed)
    archives[output] = { sha256: hash(compressed), uncompressedSha256: hash(raw) }
  }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const sources = git('ls-files', '--cached', '--others', '--exclude-standard', '--',
  'src', 'tests', 'scripts', 'android/app/src', 'android/app/build.gradle').split(/\r?\n/)
sources.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs', 'docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1', 'docs/qa/kanata-sqlite-m4/fixture.mjs',
  'docs/qa/kanata-sqlite-m4/completion/fixture.mjs',
  'docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/schema005-device.mjs')
const sourceFiles = Object.fromEntries([...new Set(sources)].sort().map(path => [path, sha(path)]))
const adb = (...args) => execFileSync(join(manifest.sdk, 'platform-tools/adb.exe'), ['-s', manifest.serial, ...args],
  { encoding: 'utf8', timeout: 15000 }).trim()
assert.equal(adb('emu', 'avd', 'path').split(/\r?\n/)[0].trim(), join(manifest.avdHome, manifest.avdName + '.avd'))
const fingerprint = adb('shell', 'getprop', 'ro.build.fingerprint')
const historical = readJson(join(evidence, '../android-action-spike-final/device.json'))
assert.equal(fingerprint, historical.fingerprint)
assert.equal(adb('shell', 'getprop', 'ro.build.version.sdk'), '34')
assert.equal(adb('shell', 'getprop', 'ro.product.cpu.abi'), 'x86_64')
const installed = {}
for (const id of ['com.yubin.formyself.m2qa', 'com.yubin.formyself.m2qa.test']) {
  const remote = adb('shell', 'pm', 'path', id).replace(/^package:/, '')
  assert.match(remote, /^\/data\/app\/\S+\/base\.apk$/)
  const actual = adb('shell', 'sha256sum', remote).split(/\s/)[0]
  const archive = join(manifest.root, 'schema005-regression-final', id + '-base.apk')
  assert.equal(actual, sha(archive))
  installed[id] = actual
}
const candidate = readJson(join(evidence, 'schema005-final-candidate-fingerprint.json'))
assert.equal(installed['com.yubin.formyself.m2qa'], candidate.apkSha256)
assert.equal(installed['com.yubin.formyself.m2qa.test'], candidate.testApkSha256)
const ordinary = readJson(join(evidence, 'schema005-default-gate.json'))
assert.equal(ordinary.syntheticActivation, false)
assert.equal(ordinary.schemaVersion, 5)
const report = {
  sourceBase: git('rev-parse', 'HEAD'), sourceFiles, sourceFingerprint: hash(JSON.stringify(sourceFiles)),
  device: { serial: manifest.serial, avd: manifest.avdName, path: historical.avdPath, fingerprint, api: 34, abi: 'x86_64' },
  installed, candidate, ordinary, archives,
  note: 'Implementation snapshot identified by per-file hashes; sourceBase precedes this ordinary checkpoint commit. Final candidate/full regression hashes match. Earlier count-scan implementation and failed runs are preserved, not reused as final PASS. No application database/key/envelope read by this collector.',
}
put('schema005-fingerprints.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'))
console.log(JSON.stringify({ sourceFingerprint: report.sourceFingerprint, sourceFiles: Object.keys(sourceFiles).length,
  installed, archives: Object.keys(archives).length }))
