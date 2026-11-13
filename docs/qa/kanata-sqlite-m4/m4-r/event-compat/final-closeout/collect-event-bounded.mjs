import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {eventRevocationWrites} from '../../../../../../src/features/chat/storage/sqlite/kanataEventRevocation.js'
const manifestPath=resolve(process.argv[2]),manifest=JSON.parse(readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''))
assert.equal(manifest.syntheticOnly,true);assert.equal(manifest.createdBy,'M2 Windows/WHPX preflight')
assert.equal(manifest.serial,'emulator-5582');assert.equal(manifest.avdName,'kanata_m2_api34')
assert.equal(dirname(manifestPath),resolve(manifest.root));assert.match(basename(manifest.root),/^kanata-m2-synthetic-[a-f0-9]{8}$/)
const evidence=dirname(fileURLToPath(import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sha=file=>hash(readFileSync(file))
const readJson=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))
const put=(name,bytes)=>{const file=join(evidence,name);if(existsSync(file))assert.equal(sha(file),hash(bytes));else writeFileSync(file,bytes,{flag:'wx'})}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
const adb=(...args)=>execFileSync(join(manifest.sdk,'platform-tools/adb.exe'),['-s',manifest.serial,...args],{encoding:'utf8',timeout:15000}).trim()
assert.equal(adb('emu','avd','path').split(/\r?\n/)[0].trim(),join(manifest.avdHome,manifest.avdName+'.avd'))
assert.equal(adb('shell','getprop','ro.build.version.sdk'),'34')
assert.equal(adb('shell','getprop','ro.product.cpu.abi'),'x86_64')
const archives={}
const folders=['event-bounded-20261112','event-bounded-regression-20261112','event-bounded-regression-retry-20261112',
  'event-bounded-final-20261112','event-bounded-regression-final-20261112','event-bounded-crash-final-20261112',
  'event-bounded-crash-trace-20261112','event-bounded-crash-integrated-20261112','event-bounded-integrated-20261112',
  'event-bounded-regression-integrated-20261112','event-bounded-order-integrated-20261112',
  'event-bounded-provenance-integrated-20261112','event-bounded-read-integrated-20261112']
for(const folder of folders){
  for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt']){
    const raw=readFileSync(join(manifest.root,folder,name)),bytes=gzipSync(raw),output=folder+'-'+name+'.gz'
    put(output,bytes);archives[output]={sha256:hash(bytes),uncompressedSha256:hash(raw)}
  }
}
const files=git('ls-files','--cached','--others','--exclude-standard','--','src','tests','scripts','android/app/src','android/app/build.gradle').split(/\r?\n/)
files.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs','docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1','docs/qa/kanata-sqlite-m3/device-scenario.mjs',
  'docs/qa/kanata-sqlite-m4/completion/fixture.mjs','docs/qa/kanata-sqlite-m4/m4-r/event-compat/verify-compatibility.mjs',
  ...['event-semantics-device.mjs','bounded-event-oracle.mjs','schema005-device.mjs','verify-effect-error.mjs',
    'collect-event-bounded.mjs','verify-default-apk.py'].map(file=>'docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/'+file))
const sourceFiles=Object.fromEntries([...new Set(files)].sort().map(file=>[file,sha(file)]))
const installed={}
for(const id of ['com.yubin.formyself.m2qa','com.yubin.formyself.m2qa.test']){
  const remote=adb('shell','pm','path',id).replace(/^package:/,'');assert.match(remote,/^\/data\/app\/\S+\/base.apk$/)
  installed[id]=adb('shell','sha256sum',remote).split(/\s/)[0]
  for(const folder of ['event-bounded-crash-integrated-20261112','event-bounded-integrated-20261112',
    'event-bounded-regression-integrated-20261112','event-bounded-provenance-integrated-20261112',
    'event-bounded-read-integrated-20261112']){
    assert.equal(installed[id],sha(join(manifest.root,folder,id+'-base.apk')),'Integrated installed APK identity')
  }
}
// The order runner intentionally archives its initial v4 APK, then verifies the
// in-place upgrade against the current candidate SHA before running v5 checks.
assert.equal(sha(join(manifest.root,'event-bounded-order-integrated-20261112','com.yubin.formyself.m2qa-base.apk')),
  '0dacf543a3318fa8d049d2e046f12f33fe02a45448a23f24cf2585995c4da612')
const candidatePath=join(manifest.root,'event-bounded-regression-integrated-20261112','com.yubin.formyself.m2qa-base.apk')
const packaged=JSON.parse(execFileSync('python',['-c',
  'import sys,json,hashlib,zipfile;z=zipfile.ZipFile(sys.argv[1]);b=z.read("assets/kanata-sqlite-catalog.json");print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"catalog":json.loads(b)}))',candidatePath],
  {encoding:'utf8',maxBuffer:4*1024*1024}))
assert.equal(packaged.catalog.version,5)
for(const sql of eventRevocationWrites)assert.equal(packaged.catalog.statements[hash(sql)]?.sql,sql)
const journal=KANATA_SCHEMA_MIGRATIONS.map(m=>({version:m.version,name:m.name,checksum:hash(JSON.stringify([m.version,m.name,m.statements]))}))
assert.deepEqual(journal,readJson(join(evidence,'schema005-final-candidate-fingerprint.json')).journal)
const ordinary=readJson(join(evidence,'event-bounded-default-gate.json'))
assert.equal(ordinary.syntheticActivation,false);assert.equal(ordinary.syntheticPageAbsent,true)
assert.equal(ordinary.syntheticStatementsAbsent,true);assert.equal(ordinary.package,'com.yubin.formyself')
assert.equal(ordinary.schemaVersion,5)
const crashLog=readFileSync(join(manifest.root,'event-bounded-crash-integrated-20261112','result.txt'),'utf8')
const cipher=crashLog.match(/"cipher":\s*"([^"]+)"/)?.[1]
assert.match(cipher,/^4\.17\.0/)
const report={sourceBase:git('rev-parse','HEAD'),sourceFingerprint:hash(JSON.stringify(sourceFiles)),sourceFiles,
  device:{serial:manifest.serial,fingerprint:adb('shell','getprop','ro.build.fingerprint'),api:34,avd:manifest.avdName,abi:'x86_64',cipher},
  installed,candidateCatalogSha256:packaged.sha256,journal,ordinary,archives,
  note:'Existing E checkpoint only. Earlier failures/passes are preserved and not reused as final integrated passes. Integrated candidate APK/catalog matches the 1k/10k crash, semantics, full regression and v4-to-v5 migration runs. Ordinary APK was built and inspected but never installed or published. No application database/key/envelope is read by this collector. SourceBase precedes the ordinary commit; per-file hashes bind its implementation.'}
put('event-bounded-fingerprints.json',Buffer.from(JSON.stringify(report,null,2)+'\n'))
console.log(JSON.stringify({sourceFingerprint:report.sourceFingerprint,installed,candidateCatalogSha256:packaged.sha256,archives:Object.keys(archives).length}))
