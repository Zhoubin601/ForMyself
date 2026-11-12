import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {gzipSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../../../../src/features/chat/storage/sqlite/kanataSchema.js'
const manifestPath=resolve(process.argv[2]),manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
assert.equal(manifest.syntheticOnly,true);assert.equal(manifest.createdBy,'M2 Windows/WHPX preflight')
assert.equal(manifest.serial,'emulator-5582');assert.equal(manifest.avdName,'kanata_m2_api34')
assert.equal(dirname(manifestPath),resolve(manifest.root));assert.match(basename(manifest.root),/^kanata-m2-synthetic-[a-f0-9]{8}$/)
const evidence=dirname(fileURLToPath(import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sha=file=>hash(readFileSync(file))
const put=(name,bytes)=>{const file=join(evidence,name);if(existsSync(file))assert.equal(sha(file),hash(bytes));else writeFileSync(file,bytes,{flag:'wx'})}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
const adb=(...args)=>execFileSync(join(manifest.sdk,'platform-tools/adb.exe'),['-s',manifest.serial,...args],{encoding:'utf8',timeout:15000}).trim()
assert.equal(adb('emu','avd','path').split(/\r?\n/)[0].trim(),join(manifest.avdHome,manifest.avdName+'.avd'))
assert.equal(adb('shell','getprop','ro.build.version.sdk'),'34')
const archives={}
for(const folder of ['event-semantics-20261112','event-semantics-20261112-retry']){
  for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt']){
    const raw=readFileSync(join(manifest.root,folder,name)),bytes=gzipSync(raw),output=folder+'-'+name+'.gz'
    put(output,bytes);archives[output]={sha256:hash(bytes),uncompressedSha256:hash(raw)}
  }
}
const files=git('ls-files','--cached','--others','--exclude-standard','--','src','tests','scripts','android/app/src','android/app/build.gradle').split(/\r?\n/)
files.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs','docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1','docs/qa/kanata-sqlite-m4/completion/fixture.mjs',
  'docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/event-semantics-device.mjs')
const sourceFiles=Object.fromEntries([...new Set(files)].sort().map(file=>[file,sha(file)]))
const installed={}
for(const id of ['com.yubin.formyself.m2qa','com.yubin.formyself.m2qa.test']){
  const remote=adb('shell','pm','path',id).replace(/^package:/,'');assert.match(remote,/^\/data\/app\/\S+\/base.apk$/)
  installed[id]=adb('shell','sha256sum',remote).split(/\s/)[0]
  assert.equal(installed[id],sha(join(manifest.root,'event-semantics-20261112-retry',id+'-base.apk')))
}
const catalog=JSON.parse(readFileSync('android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json','utf8'))
const report={sourceBase:git('rev-parse','HEAD'),sourceFingerprint:hash(JSON.stringify(sourceFiles)),sourceFiles,
  device:{serial:manifest.serial,fingerprint:adb('shell','getprop','ro.build.fingerprint'),api:34,avd:manifest.avdName},installed,
  catalogSha256:sha('android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json'),schemaVersion:catalog.version,
  journal:KANATA_SCHEMA_MIGRATIONS.map(m=>({version:m.version,checksum:hash(JSON.stringify([m.version,m.name,m.statements]))})),archives,
  note:'E consumer checkpoint, not final M4 integration. First device run reproduced an overbroad QA counter; retry passed. Full Android final regression and Facade removal remain outstanding. Source hashes bind this checkpoint before its ordinary commit.'}
put('event-consumer-fingerprints.json',Buffer.from(JSON.stringify(report,null,2)+'\n'))
console.log(JSON.stringify({sourceFingerprint:report.sourceFingerprint,installed,archives:Object.keys(archives).length}))
