import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
import {KANATA_SCHEMA_MIGRATIONS} from '../../../../../../src/features/chat/storage/sqlite/kanataSchema.js'
import {messageSnapshotQueries,messageSnapshotWrites,messageSnapshotDdl} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageSnapshot.js'
import {messageDetailQueries} from '../../../../../../src/features/chat/storage/sqlite/kanataMessageDetailRead.js'
import {m2Fixture,m2FixtureCommands} from '../../../../../../tests/helpers/kanataSqliteM2Fixture.js'
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
assert.equal(git('branch','--show-current'),'M')
assert.equal(adb('emu','avd','path').split(/\r?\n/)[0].trim(),join(manifest.avdHome,manifest.avdName+'.avd'))
assert.equal(adb('shell','getprop','ro.build.version.sdk'),'34')
assert.equal(adb('shell','getprop','ro.product.cpu.abi'),'x86_64')
const folders=process.argv.slice(3)
assert(folders.length>0)
for(const folder of folders)assert.match(folder,/^message-bounded-[a-z0-9-]+-20261113$/)
const archives={},installed={}
const failedFolders=['message-bounded-device-20261113','message-bounded-device-retest-20261113',
  'message-bounded-regression-20261113','message-bounded-regression-ready-20261113','message-bounded-regression-trace-20261113',
  'message-bounded-regression-reboot-20261113']
for(const id of ['com.yubin.formyself.m2qa','com.yubin.formyself.m2qa.test']){
  const remote=adb('shell','pm','path',id).replace(/^package:/,'');assert.match(remote,/^\/data\/app\/\S+\/base.apk$/)
  installed[id]=adb('shell','sha256sum',remote).split(/\s/)[0]
}
for(const folder of folders){
  for(const id of Object.keys(installed))assert.equal(installed[id],sha(join(manifest.root,folder,id+'-base.apk')),'Installed candidate must match each claimed pass')
  for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt']){
    const raw=readFileSync(join(manifest.root,folder,name)),bytes=gzipSync(raw),output=folder+'-'+name+'.gz'
    put(output,bytes);archives[output]={sha256:hash(bytes),uncompressedSha256:hash(raw)}
  }
  assert.match(readFileSync(join(manifest.root,folder,'instrumentation.txt'),'utf8'),/OK \(1 test\)/)
}
for(const folder of failedFolders)for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt']){
  const raw=readFileSync(join(manifest.root,folder,name)),bytes=gzipSync(raw),output=folder+'-'+name+'.gz'
  put(output,bytes);archives[output]={sha256:hash(bytes),uncompressedSha256:hash(raw),failedRun:true}
}
const files=git('ls-files','--cached','--others','--exclude-standard','--','src','tests','scripts','android/app/src','android/app/build.gradle').split(/\r?\n/)
files.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs','docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1','docs/qa/kanata-sqlite-m3/device-scenario.mjs',
  'docs/qa/kanata-sqlite-m4/fixture.mjs','docs/qa/kanata-sqlite-m4/completion/fixture.mjs',
  ...['message-bounded-device.mjs','event-semantics-device.mjs','bounded-event-oracle.mjs','schema005-device.mjs',
    'collect-message-bounded.mjs','verify-default-apk.py'].map(file=>'docs/qa/kanata-sqlite-m4/m4-r/event-compat/final-closeout/'+file))
const sourceFiles=Object.fromEntries([...new Set(files)].sort().map(file=>[file,sha(file)]))
const packaged=JSON.parse(execFileSync('python',['-c',
  'import sys,json,hashlib,zipfile;z=zipfile.ZipFile(sys.argv[1]);b=z.read("assets/kanata-sqlite-catalog.json");print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"catalog":json.loads(b)}))',
  join(manifest.root,folders[0],'com.yubin.formyself.m2qa-base.apk')],{encoding:'utf8',maxBuffer:4*1024*1024}))
assert.equal(packaged.catalog.version,5)
for(const sql of [...messageSnapshotQueries,...messageSnapshotWrites,...messageSnapshotDdl,...messageDetailQueries])
  assert.equal(packaged.catalog.statements[hash(sql)]?.sql,sql)
const journal=KANATA_SCHEMA_MIGRATIONS.map(m=>({version:m.version,name:m.name,checksum:hash(JSON.stringify([m.version,m.name,m.statements]))}))
assert.deepEqual(journal,readJson(join(evidence,'schema005-final-candidate-fingerprint.json')).journal)
const ordinary=readJson(join(evidence,'message-bounded-default-gate.json'))
assert.equal(ordinary.syntheticActivation,false);assert.equal(ordinary.syntheticPageAbsent,true)
assert.equal(ordinary.syntheticStatementsAbsent,true);assert.equal(ordinary.package,'com.yubin.formyself')
const deviceLog=readFileSync(join(manifest.root,folders[0],'result.txt'),'utf8')
const cipher=deviceLog.match(/"cipher":\s*"([^"]+)"/)?.[1];assert.match(cipher,/^4\.17\.0/)
const partialFolder='message-bounded-regression-reboot-20261113'
for(const id of Object.keys(installed))assert.equal(installed[id],sha(join(manifest.root,partialFolder,id+'-base.apk')))
const partialText=readFileSync(join(manifest.root,partialFolder,'result.txt'),'utf8')
function extractObject(name){
  const marker=partialText.indexOf('"'+name+'":');assert(marker>=0)
  const start=partialText.lastIndexOf('{',marker)
  let depth=0,quoted=false,escape=false
  for(let i=start;i<partialText.length;i++){
    const c=partialText[i]
    if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue}
    if(c==='"')quoted=true
    else if(c==='{')depth++
    else if(c==='}'&&--depth===0)return JSON.parse(partialText.slice(start,i+1))[name]
  }
  assert.fail('Incomplete partial slice JSON')
}
const growth=extractObject('m4'),archive=extractObject('m4HistoryArchive')
assert.deepEqual(growth.promptGrowth.map(row=>row.size),[1000,10000])
assert(growth.promptGrowth.every(row=>row.recovered&&row.arrayObjects===0&&row.noQueriesAfterCancel===0))
assert.equal(growth.controlledModelCalls,7);assert.equal(growth.realModelCalls,0)
assert.equal(growth.revocationWhilePending,'PASS')
assert.deepEqual(archive,{archivedCount:49,retainedRecent:200,quotePreserved:true,unknownReferenceProtected:true})
const runBundles=Object.fromEntries([...folders,...failedFolders].map(folder=>[folder,
  readFileSync(join(manifest.root,folder,'result.txt'),'utf8').match(/"qaBundleSha256":\s*"([a-f0-9]{64})"/)?.[1]??null]))
const fixture=m2Fixture()
const report={sourceBase:git('rev-parse','HEAD'),sourceFingerprint:hash(JSON.stringify(sourceFiles)),sourceFiles,
  device:{serial:manifest.serial,fingerprint:adb('shell','getprop','ro.build.fingerprint'),api:34,avd:manifest.avdName,abi:'x86_64',cipher},
  installed,candidateCatalogSha256:packaged.sha256,journal,ordinary,passedRunFolders:folders,failedRunFolders:failedFolders,runBundles,
  deterministicInputs:{fixtureSha256:hash(JSON.stringify(fixture)),commandsSha256:hash(JSON.stringify(m2FixtureCommands(fixture))),
    note:'Reconstructed from the unchanged deterministic fixture sources, whose per-file hashes are above; no database or secret is read.'},
  reusedPassedSlices:{folder:partialFolder,overallRun:'FAIL_WORKSPACE_TIMEOUT',growth,archive,
    note:'Only the completed growth/archive slices are reused. Later QA changes wait for actual foreground state and for the enabled workspace button. These changes do not affect the completed message-bounds, growth or archive paths; their exact QA bundle hashes are preserved separately. All product source, APK/catalog, fixture and device scopes match. This is not a whole-run PASS.'},archives,
  note:'Internal G4 message checkpoint only; M4 remains BLOCKED. SourceBase precedes the ordinary commit; per-file hashes bind the implementation. Each supplied run must have a separately recorded successful driver exit. Earlier event/005 evidence is reused only within its unchanged scope, never relabeled as a new APK pass. No app database/key/envelope is read by this collector; ordinary APK is inspected, never installed or published.'}
put('message-bounded-fingerprints.json',Buffer.from(JSON.stringify(report,null,2)+'\n'))
console.log(JSON.stringify({sourceFingerprint:report.sourceFingerprint,installed,candidateCatalogSha256:packaged.sha256,archives:Object.keys(archives).length}))
