import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync,writeFileSync,existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve,join,basename } from 'node:path'

const evidence=resolve('docs/qa/kanata-sqlite-m4/m4-r/event-compat')
const manifestPath=resolve(process.argv[2])
const manifest=JSON.parse(readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''))
assert.equal(manifest.syntheticOnly,true)
assert.equal(manifest.createdBy,'M2 Windows/WHPX preflight')
assert.equal(manifest.serial,'emulator-5582')
assert.equal(manifest.avdName,'kanata_m2_api34')
assert.match(basename(manifest.root),/^kanata-m2-synthetic-[a-f0-9]{8}$/)
assert.equal(resolve(manifest.root,'device-manifest.json'),manifestPath)
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
const files={}
for(const [label,folder] of [['initial','er1-regression-20261111'],['final','er1-final-regression-20261111']]){
  for(const name of ['result.txt','logcat.txt','instrumentation.txt','apk-sha256.txt']){
    const input=join(manifest.root,folder,name)
    assert.ok(existsSync(input),input)
    const output=join(evidence,`${label}-device-${name}.gz`)
    assert.equal(existsSync(output),false,'preserve earlier evidence')
    writeFileSync(output,gzipSync(readFileSync(input)))
    files[basename(output)]={sha256:sha(output),uncompressedSha256:sha(input)}
  }
}
const sourceCommit='6118e9cd9721fa51fe7571f17fc22cf1c2e6c305'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
execFileSync('git',['diff','--quiet',sourceCommit,'--','src','tests','scripts','android/app/src/androidTest'])
const sourceTrees=Object.fromEntries(['src','tests','scripts','android/app/src/androidTest'].map(path=>[path,git('rev-parse',sourceCommit+':'+path)]))
const sources=git('ls-files','--','src','tests','scripts','android/app/src/androidTest').split('\n')
sources.push('docs/qa/kanata-sqlite-m2/candidate-smoke.mjs','docs/qa/kanata-sqlite-m2/windows-candidate-smoke.mjs',
  'docs/qa/kanata-sqlite-m2/run-windows-candidate.ps1','docs/qa/kanata-sqlite-m4/completion/fixture.mjs')
const sourceFiles=Object.fromEntries(sources.map(file=>[file,sha(file)]))
const sourceFingerprint=createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex')
const apks={}
for(const name of ['com.yubin.formyself.m2qa-base.apk','com.yubin.formyself.m2qa.test-base.apk']){
  apks[name]=sha(join(manifest.root,'er1-final-regression-20261111',name))
}
apks['ordinary-apk']=sha('android/app/build/outputs/apk/debug/app-debug.apk')
writeFileSync(join(evidence,'fingerprints.json'),JSON.stringify({sourceCommit,sourceTrees,sourceFingerprint,
  sourceFiles,apks,ordinaryCatalogSha256:sha('android/app/build/generated/kanataSqlite/assets/kanata-sqlite-catalog.json'),
  evidence:files,note:'Source tree is fixed at sourceCommit. Later commits may contain docs/evidence only. APK hashes are verified installed candidate readbacks and separately built ordinary APK. No app data is read.'},null,2)+'\n')
console.log(JSON.stringify({sourceCommit,sourceTrees,sourceFingerprint,apks,archives:Object.keys(files)}))
