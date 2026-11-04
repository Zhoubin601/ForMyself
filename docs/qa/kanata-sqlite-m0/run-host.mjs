import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {spawn,execFileSync} from 'node:child_process'
import {randomBytes,createHash} from 'node:crypto'
import {dataset,fingerprint,scopes,fixtureVersion} from './dataset.mjs'
import assert from 'node:assert/strict'
const args=process.argv.slice(2), smoke=args.includes('--smoke')
const repetitions=smoke?1:5,counts=smoke?[1000]:[1000,10000,100000]
const qa=new URL('.',import.meta.url).pathname,work=path.resolve('work/m0')
await fs.mkdir(work,{recursive:true})
const session=await fs.mkdtemp(path.join(work,'host-'))
const python=path.join(work,'venv/bin/python')
const result={status:'RUNNING',scope:'Linux host only; NOT Android, NOT device acceptance',fixtureVersion,forcedGC:false,repetitions,counts,startedAt:new Date().toISOString(),environment:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramBytes:os.totalmem(),node:process.version,python:execFileSync(python,['--version'],{encoding:'utf8'}).trim(),git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cgroupMemoryMax:await fs.readFile('/sys/fs/cgroup/memory.max','utf8').catch(()=>null),coldDefinition:'fresh Node and Python processes; filesystem cache retained',power:'cloud VM unknown',temperature:'unavailable',storage:'overlay filesystem; physical medium unknown'},datasets:[],runs:[]}
result.harnessHashes=Object.fromEntries(await Promise.all(['dataset.mjs','file-driver.mjs','host-worker.mjs','sqlcipher-worker.py','run-host.mjs'].map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(qa,file))).digest('hex')])))
result.productionLockSha256=createHash('sha256').update(await fs.readFile('package-lock.json')).digest('hex')
const output=path.join(session,'results.json')
await fs.writeFile(output,JSON.stringify(result,null,2))
async function readRss(pid) {
  try {
    const status=await fs.readFile(`/proc/${pid}/status`,'utf8'),rss=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)
    return rss
  } catch {return 0}
}
async function run(options) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--trace-gc-nvp',path.join(qa,'host-worker.mjs')],{stdio:['pipe','pipe','pipe']})
    let stdout='',peak=0,stderr='',intervalBusy=false
    const timer=setInterval(async()=>{if(intervalBusy)return;intervalBusy=true;const nativePid=stdout.match(/"qaChildPid":(\d+)/)?.[1];peak=Math.max(peak,await readRss(child.pid)+(nativePid?await readRss(nativePid):0));intervalBusy=false},10)
    child.stdin.end(JSON.stringify({...options,python})+'\n')
    child.stdout.on('data',chunk=>{stdout+=chunk})
    child.stderr.on('data',chunk=>{stderr+=chunk})
    child.on('error',reject)
    child.on('exit',code=>{
      clearInterval(timer)
      if(stdout.includes(options.password)||stderr.includes(options.password))return reject(Error('QA_SECRET_IN_OUTPUT'))
      const lines=stdout.trim().split('\n'), payload=lines.findLast(l=>l.startsWith('{'))
      if(!payload)return reject(Error('QA_NO_RESULT'))
      const value=JSON.parse(payload),heapSizes=[...stdout.matchAll(/total_size_(?:before|after)=(\d+)/g)].map(m=>Number(m[1]))
      value.sampledTreePeakRssKiB=peak;value.gcObservedHeapPeakBytes=Math.max(0,...heapSizes,...value.records.map(r=>r.jsHeapUsed));value.gcEvents=heapSizes.length/2;value.stderrBytes=Buffer.byteLength(stderr);value.secretInCapturedOutput=false;value.exitCode=code
      if(code!==0||value.failed)return reject(Object.assign(Error('QA_RUN_FAILED'),{value}))
      resolve(value)
    })
  })
}
try {
  for(const count of counts) {
    const expected=(()=>{
      const data=dataset(count),scopeHashes=scopes(data).map(s=>{const hash=createHash('sha256');for(const m of data.messages.filter(m=>m.conversationId===s.conversationId).reverse())hash.update(JSON.stringify(m)+'\n');return hash.digest('hex')})
      return {fingerprint:fingerprint(data),scopeHashes,scopeCounts:scopes(data).map(s=>data.messages.filter(m=>m.conversationId===s.conversationId).length)}
    })()
    result.datasets.push({count,...expected,worlds:2,conversationsWithMessages:8,timestampTies:true,lengthsUTF16:[64,128,256,1024],distribution:'pairs distributed round-robin over 8 conversations, 4 each in 2 worlds; user/assistant 50/50; adjacent reply pairs; repeated timestamp every 32 global messages'})
    for(let repeat=0;repeat<repetitions;repeat++)for(const engine of (repeat%2?['sqlcipher','json-archive']:['json-archive','sqlcipher'])) {
      const root=await fs.mkdtemp(path.join(session,`${count}-${engine}-${repeat}-`)),password=randomBytes(32).toString('hex')
      const common={engine,root,count,password,expected}
      const imported=await run({...common,mode:'import'})
      const queried=await run({...common,mode:'query'})
      assert.equal(queried.batch.total,count)
      result.runs.push({count,engine,repeat,imported,queried})
      await fs.writeFile(output,JSON.stringify(result,null,2))
      console.log(JSON.stringify({count,engine,repeat,status:'PASS',importMs:imported.records[0].ms,queryMs:queried.records.find(r=>r.operation==='recent_50').ms}))
      // Only this exact fresh mkdtemp synthetic run is removed, after sizes/proofs are recorded.
      await fs.rm(root,{recursive:true})
    }
  }
  result.status='HOST_COMPLETED_ANDROID_BLOCKED'
} catch(error) {result.status='HOST_FAILED';result.failure=error.value??{code:'QA_HOST_FAILED'};process.exitCode=1}
result.finishedAt=new Date().toISOString()
await fs.writeFile(output,JSON.stringify(result,null,2))
console.log(output)
