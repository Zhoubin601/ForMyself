import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const evidence=new URL('./evidence/',import.meta.url)
const direct=JSON.parse(await fs.readFile(process.argv[2]??new URL('direct/results.json',evidence),'utf8'))
const target=JSON.parse(await fs.readFile(new URL('target/summary.json',evidence),'utf8'))
const keystore=await fs.readFile(new URL('target/keystore-native.txt',evidence),'utf8')
assert.equal(direct.complete,true)
assert.equal(direct.repetitions,5)
assert.equal(direct.runs.length,5)
assert.match(direct.apkSha256,/^[0-9a-f]{64}$/)
assert.match(keystore,/OK \(1 test\)/)
for(const count of [1000,10000,100000]){
  const json=target.samples[count+'-json-archive'],sql=target.samples[count+'-sqlcipher']
  assert.equal(json.status,'PASS_TARGET_SAMPLE')
  assert.equal(sql.status,'PASS_TARGET_SAMPLE')
  assert.equal(json.pageFingerprint,sql.pageFingerprint)
}
for(const {seed,resume} of direct.runs){
  assert.equal(seed.status,'PASS_DIRECT_SEED')
  assert.equal(resume.status,'PASS_DIRECT_RESUME')
  assert.notEqual(seed.pid,resume.pid)
  assert.equal(resume.interruptedTransaction.priorPid,seed.pid)
  assert.equal(resume.interruptedTransaction.forceStop,true)
  assert.equal(resume.interruptedTransaction.uncommittedRowAbsent,true)
  assert.equal(resume.pause,'PASS_DIRECT_PAUSE')
  assert(resume.closedDatabaseBytes>16)
  for(const phase of [seed,resume]){
    const {verified,audit,processes}=phase
    assert.equal(verified.rows,100000)
    assert.match(verified.cipher,/^4\.17\.0/)
    assert.equal(verified.integrity,true)
    assert.match(verified.plan,/SEARCH.*scope_time.*\(created_at,id\)<\(\?,\?\)/)
    assert.deepEqual([verified.wal,verified.synchronous,verified.cacheSize,verified.checkpoint],['wal','2','-2048','1000'])
    assert.equal(audit.portableEnvelope,true)
    assert.equal(audit.logCanary,true)
    assert.equal(audit.passwordKekDekAbsent,true)
    assert(audit.prefsFilesScanned>0)
    assert.deepEqual(new Set(processes.map(p=>p.type)),new Set(['browser','renderer']))
    assert(processes.every(p=>p.peakRssKiB>0&&p.cpuSeconds>=0&&p.cpuSeconds!==null))
  }
}
function stats(values,count){
  assert.equal(values.length,count)
  assert(values.every(value=>Number.isFinite(value)&&value>0))
  const sorted=[...values].sort((a,b)=>a-b)
  return {n:count,p50Ms:sorted[Math.ceil(count*0.5)-1],p95Ms:sorted[Math.ceil(count*0.95)-1]}
}
const metric=(name,phase,count)=>stats(direct.runs.flatMap(run=>
  run[phase].timings.filter(timing=>timing.name===name).map(timing=>timing.ms)),count)
const summary={
  bulk:metric('bulk_write','seed',5),
  coldKdf:metric('kdf','resume',5),
  coldUnlock:metric('unlock','resume',5),
  coldPageReady:stats(direct.runs.map(run=>run.resume.pageReadyMs),5),
  recent:metric('recent_50','resume',5),
  next:metric('next_50','resume',5),
  deep:metric('deep_50','resume',5),
  write:metric('single_write','seed',25),
  update:metric('single_update','seed',25),
  maxProcessRssMiB:Math.max(...direct.runs.flatMap(run=>
    [run.seed,run.resume].flatMap(phase=>phase.processes.map(process=>process.peakRssKiB))))/1024
}
console.log(JSON.stringify(summary,(_key,value)=>typeof value==='number'?Math.round(value*10)/10:value,2))
for(const name of ['recent','next','deep'])assert(summary[name].p95Ms<=50,name)
for(const name of ['write','update'])assert(summary[name].p95Ms<=100,name)
assert(summary.coldUnlock.p95Ms<=1000)
assert(summary.maxProcessRssMiB<=512)
assert(summary.write.p95Ms<target.samples['100000-json-archive'].operations.single_write.p95Ms)
