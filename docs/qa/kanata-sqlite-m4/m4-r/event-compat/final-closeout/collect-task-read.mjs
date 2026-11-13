import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {taskReadQueries,taskReadWrites,taskReadDdl} from '../../../../../../src/features/chat/storage/sqlite/kanataTaskRead.js'
import {taskSourceProofQueries} from '../../../../../../src/features/chat/storage/sqlite/kanataTaskSourceProof.js'
import {taskFixtureWrites,taskProofPlanQuery} from './task-read-device.mjs'
import {m2Fixture,m2FixtureCommands} from '../../../../../../tests/helpers/kanataSqliteM2Fixture.js'
const manifestPath=resolve(process.argv[2]),manifest=JSON.parse(readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''))
assert.equal(manifest.syntheticOnly,true);assert.equal(manifest.createdBy,'M2 Windows/WHPX preflight')
assert.equal(manifest.serial,'emulator-5582');assert.equal(manifest.avdName,'kanata_m2_api34')
assert.equal(dirname(manifestPath),resolve(manifest.root));assert.match(basename(manifest.root),/^kanata-m2-synthetic-[a-f0-9]{8}$/)
const evidence=dirname(fileURLToPath(import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const sha=file=>hash(readFileSync(file)),readJson=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))
const put=(name,bytes)=>{const file=join(evidence,name);if(existsSync(file))assert.equal(sha(file),hash(bytes));else writeFileSync(file,bytes,{flag:'wx'})}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
const adb=(...args)=>execFileSync(join(manifest.sdk,'platform-tools/adb.exe'),['-s',manifest.serial,...args],{encoding:'utf8',timeout:15000}).trim()
assert.equal(git('branch','--show-current'),'M')
assert.equal(adb('emu','avd','path').split(/\r?\n/)[0].trim(),join(manifest.avdHome,manifest.avdName+'.avd'))
assert.equal(adb('shell','getprop','ro.build.version.sdk'),'34');assert.equal(adb('shell','getprop','ro.product.cpu.abi'),'x86_64')
const folders=process.argv.slice(3);assert(folders.length>0)
const archives={},installed={},runs={}
for(const id of ['com.yubin.formyself.m2qa','com.yubin.formyself.m2qa.test']){
  const remote=adb('shell','pm','path',id).replace(/^package:/,'');assert.match(remote,/^\/data\/app\/\S+\/base.apk$/)
  installed[id]=adb('shell','sha256sum',remote).split(/\s/)[0]
}
for(const folder of folders){
  assert.match(folder,/^task-read-[a-z0-9-]+-20261113$/)
  const driver=join(evidence,folder.replace(/-20261113$/,'')+'-exit.txt')
  const exit=Number(readFileSync(driver,'utf8').trim())
  const result=readFileSync(join(manifest.root,folder,'result.txt'),'utf8')
  runs[folder]={exit,qaBundleSha256:result.match(/"qaBundleSha256":\s*"([a-f0-9]{64})"/)?.[1]??null}
  if(exit===0){
    for(const id of Object.keys(installed))assert.equal(installed[id],sha(join(manifest.root,folder,id+'-base.apk')))
    assert.match(readFileSync(join(manifest.root,folder,'instrumentation.txt'),'utf8'),/OK \(1 test\)/)
  }
  for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt','foreground-check.txt']){
    const raw=readFileSync(join(manifest.root,folder,name)),bytes=gzipSync(raw),output=folder+'-'+name+'.gz'
    put(output,bytes);archives[output]={sha256:hash(bytes),uncompressedSha256:hash(raw)}
  }
}
const passed=folders.filter(folder=>runs[folder].exit===0);assert(passed.length>0)
const files=git('ls-files','--cached','--others','--exclude-standard','--','src','tests','scripts','android/app/src','android/app/build.gradle').split(/\r?\n/)
files.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs','docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1','docs/qa/kanata-sqlite-m3/device-scenario.mjs',
  'docs/qa/kanata-sqlite-m4/fixture.mjs','docs/qa/kanata-sqlite-m4/completion/fixture.mjs',
  ...['task-read-device.mjs','collect-task-read.mjs','message-bounded-device.mjs','event-semantics-device.mjs',
    'bounded-event-oracle.mjs','schema005-device.mjs','verify-default-apk.py'].map(file=>'docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/'+file))
const sourceFiles=Object.fromEntries([...new Set(files)].sort().map(file=>[file,sha(file)]))
const packaged=JSON.parse(execFileSync('python',['-c',
  'import sys,json,hashlib,zipfile;z=zipfile.ZipFile(sys.argv[1]);b=z.read("assets/kanata-sqlite-catalog.json");print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"catalog":json.loads(b)}))',
  join(manifest.root,passed[0],'com.yubin.formyself.m2qa-base.apk')],{encoding:'utf8',maxBuffer:4*1024*1024}))
assert.equal(packaged.catalog.version,5)
for(const sql of [...taskReadQueries,...taskReadWrites,...taskReadDdl,...taskSourceProofQueries,...taskFixtureWrites,taskProofPlanQuery])assert.equal(packaged.catalog.statements[hash(sql)]?.sql,sql)
const journal=KANATA_SCHEMA_MIGRATIONS.map(m=>({version:m.version,name:m.name,checksum:hash(JSON.stringify([m.version,m.name,m.statements]))}))
assert.deepEqual(journal,readJson(join(evidence,'schema005-final-candidate-fingerprint.json')).journal)
const ordinary=readJson(join(evidence,'task-read-default-gate.json'))
assert.equal(ordinary.syntheticActivation,false);assert.equal(ordinary.canonical,'legacy');assert.equal(ordinary.syntheticStatementsAbsent,true)
const cipher=readFileSync(join(manifest.root,passed[0],'result.txt'),'utf8').match(/"cipher":\s*"([^"]+)"/)?.[1]
assert.match(cipher,/^4\.17\.0/)
const fixture=m2Fixture()
const report={sourceBase:git('rev-parse','HEAD'),sourceFingerprint:hash(JSON.stringify(sourceFiles)),sourceFiles,
  installed,candidateCatalogSha256:packaged.sha256,journal,ordinary,runs,archives,
  device:{serial:manifest.serial,fingerprint:adb('shell','getprop','ro.build.fingerprint'),api:34,avd:manifest.avdName,abi:'x86_64',cipher},
  fixtureSha256:hash(JSON.stringify(fixture)),commandsSha256:hash(JSON.stringify(m2FixtureCommands(fixture))),
  note:'Internal F/G4 task checkpoint only. M4 remains BLOCKED; no final MR8 reviews. SourceBase precedes the ordinary commit; individual hashes bind this implementation. Earlier evidence remains frozen within its unchanged scope and is not relabeled as a new APK pass. This collector reads only APK and device identity, never app database/key/envelope. Ordinary APK is inspected, never installed or published.'}
put('task-read-fingerprints.json',Buffer.from(JSON.stringify(report,null,2)+'\n'))
console.log(JSON.stringify({sourceFingerprint:report.sourceFingerprint,installed,candidateCatalogSha256:packaged.sha256,archives:Object.keys(archives).length}))
