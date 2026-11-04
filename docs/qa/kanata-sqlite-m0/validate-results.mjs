// Validate completeness/provenance of retained formal host evidence, without rerunning performance.
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root=new URL('.',import.meta.url),evidence=new URL('./evidence/',root)
const r=JSON.parse(await fs.readFile(new URL('host-final.json',evidence),'utf8'))
assert.equal(r.status,'HOST_COMPLETED_ANDROID_BLOCKED');assert.equal(r.repetitions,5);assert.equal(r.runs.length,30)
for(const [name,sha] of Object.entries(r.harnessHashes))assert.equal(createHash('sha256').update(await fs.readFile(new URL(name,root))).digest('hex'),sha,`QA_SOURCE_CHANGED_${name}`)
for(const count of [1000,10000,100000])for(const engine of ['json-archive','sqlcipher']){
  const runs=r.runs.filter(x=>x.count===count&&x.engine===engine)
  assert.equal(runs.length,5);assert.equal(new Set(runs.map(x=>x.repeat)).size,5)
  for(const run of runs){
    assert.equal(run.queried.batch.total,count);assert(run.queried.batch.maxRows<=50)
    assert.equal(run.imported.meta.fingerprint,r.datasets.find(d=>d.count===count).fingerprint)
    for(const phase of ['imported','queried']){assert.equal(run[phase].exitCode,0);assert.equal(run[phase].secretInCapturedOutput,false);assert(run[phase].sampledTreePeakRssKiB>0)}
    assert.equal(new Set([...run.imported.records,...run.queried.records].map(s=>s.operation)).size,12)
    if(engine==='sqlcipher'){
      assert.deepEqual(run.queried.integrity,{integrity:[['ok']],cipher_integrity:[],journal:'wal'})
      for(const p of Object.values(run.queried.proof)){assert.equal(p.rows,50);assert(p.vmInstructions<3000)}
      assert(run.queried.plan.some(p=>p.at(-1).includes('qa_scope_time')))
    }
  }
}
const rows=JSON.parse(await fs.readFile(new URL('performance-summary.json',evidence),'utf8'))
assert.equal(rows.length,72);assert(rows.every(r=>r.n===5&&r.p95Ms>=r.p50Ms))
for(const version of ['8.3.1','8.4.1']){
  const build=JSON.parse(await fs.readFile(new URL(`android-${version}-result.json`,evidence),'utf8'))
  assert.equal(build.exitCode,0);assert.equal(build.runtime,'NOT RUN')
}
console.log('PASS: 30 host runs, 360 operation samples, hashes, bounds, plans, integrity. This validates the original host/build evidence only; consult emulator supplement for device runs. M0 acceptance remains BLOCKED.')
