import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {performance} from 'node:perf_hooks'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {createPinia,setActivePinia} from 'pinia'
import {createKanataStore} from '../../../src/features/chat/kanataStore.js'
import {createKanataRepository} from '../../../src/features/chat/storage/kanataRepository.js'
import {dataset,header,message,scopes,fingerprint} from './dataset.mjs'
import {fileDriver} from './file-driver.mjs'

const line=await new Promise(resolve=>createInterface({input:process.stdin}).once('line',resolve))
const options=JSON.parse(line), {engine,root,count,password,mode,expected}=options
assert(path.resolve(root).startsWith(path.resolve('work/m0')+path.sep),'QA_ROOT_DENIED')
let sql,queue=[],sqlCPU=0,sqlRss=0,store,driver,engineVersion
const base=header(), allScopes=scopes(base)
async function rpc(request) {
  return new Promise((resolve,reject)=>{
    queue.push({resolve,reject}); sql.stdin.write(JSON.stringify(request)+'\n')
  })
}
if(engine==='sqlcipher') {
  sql=spawn(options.python,[new URL('./sqlcipher-worker.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
  process.stdout.write(JSON.stringify({qaChildPid:sql.pid})+'\n')
  createInterface({input:sql.stdout}).on('line',line=>{
    const response=JSON.parse(line),item=queue.shift()
    sqlCPU+=response.cpuUs;sqlRss=Math.max(sqlRss,response.maxRssKiB)
    if(response.ok)item.resolve(response.value);else item.reject(Error(response.code))
  })
  // Native engine diagnostics could include sensitive SQL: expose only exit status.
  sql.stderr.on('data',()=>{})
  sql.on('exit',code=>{for(const q of queue.splice(0))q.reject(Error(`QA_SQL_WORKER_EXIT_${code}`))})
} else {
  setActivePinia(createPinia());driver=fileDriver(root)
  store=createKanataStore(createKanataRepository({...driver,directory:'DATA'}),'qa-m0')()
}
async function open(initial=false) {
  if(sql) return initial ? (engineVersion=await rpc({op:'init',path:path.join(root,'qa.db'),key:password})) : rpc({op:'open'})
  assert.equal(await store.load(password),true,store.loadError)
}
async function close() {if(sql)await rpc({op:'close'});else await store.release()}
const records=[]
async function measured(operation,fn) {
  const startCPU=process.cpuUsage(), startSQL=sqlCPU, before=process.memoryUsage(),io=driver?{...driver.counters}:null,start=performance.now()
  const value=await fn(),ms=performance.now()-start,cpu=process.cpuUsage(startCPU),memory=process.memoryUsage()
  const size=async suffix=>fs.stat(path.join(root,'qa.db'+suffix)).then(s=>s.size).catch(()=>0)
  records.push({operation,ms,cpuMs:(cpu.user+cpu.system+sqlCPU-startSQL)/1000,jsHeapUsed:memory.heapUsed,jsHeapDelta:memory.heapUsed-before.heapUsed,jsExternal:memory.external,nodePeakRssKiB:process.resourceUsage().maxRSS,enginePeakRssKiB:sqlRss,dbBytes:sql?await size(''):null,walBytes:sql?await size('-wal'):null,io:io?Object.fromEntries(Object.keys(io).map(k=>[k,driver.counters[k]-io[k]])):null})
  return value
}
async function recent(scope,before=null,cursor=null) {
  if(sql)return {messages:await rpc({op:before?'page':'recent',...scope,before})}
  return store.readHistory({...scope,limit:50,cursor})
}
async function scan() {
  let total=0,maxRows=0
  for(let i=0;i<allScopes.length;i++) {
    const scope=allScopes[i],hash=createHash('sha256');let before=null,cursor=null,previous=null
    for(;;) {
      const result=await recent(scope,before,cursor),rows=result.messages
      assert(rows.length<=50);maxRows=Math.max(maxRows,rows.length)
      for(const m of rows) {
        assert.equal(m.worldId,scope.worldId);assert.equal(m.conversationId,scope.conversationId)
        if(previous)assert(m.createdAt<previous.createdAt||(m.createdAt===previous.createdAt&&m.id<previous.id),'UNSTABLE_CURSOR')
        previous=m;hash.update(JSON.stringify(m)+'\n');total++
      }
      if(!rows.length)break
      before={createdAt:rows.at(-1).createdAt,id:rows.at(-1).id};cursor=result.cursor
      if(!sql&&!cursor)break
    }
    assert.equal(hash.digest('hex'),expected.scopeHashes[i],'PAYLOAD_OR_CURSOR_MISMATCH')
  }
  assert.equal(total,count)
  return {total,maxRows}
}
try {
  if(mode==='import') {
    await open(true)
    let meta
    await measured('bulk_write',async()=>{
      if(sql) {
        // Generate the same fixture in bounded chunks; full DTO graph is not materialized.
        for(let i=0;i<count;i+=256)await rpc({op:'insert',messages:Array.from({length:Math.min(256,count-i)},(_,j)=>message(i+j,base))})
        meta={fingerprint:expected.fingerprint,scopeHashes:expected.scopeHashes}
      } else {
        const data=dataset(count);assert.equal(fingerprint(data),expected.fingerprint)
        await store.restoreSnapshot(data);await store.flush()
        meta={fingerprint:expected.fingerprint,active:store.snapshot.messages.length,archiveMetadata:store.snapshot.messageArchives?.reduce((n,p)=>n+p.messages.length,0)??0,pages:store.snapshot.messageArchives?.length??0}
      }
    })
    await close()
    process.stdout.write(JSON.stringify({records,meta,engineVersion})+'\n')
  } else {
    await measured('cold_open',()=>open(true)) // fresh Node/engine process, OS page cache NOT dropped
    const first=await measured('recent_50',()=>recent(allScopes[0]))
    assert.equal(first.messages.length,50)
    const before={id:first.messages.at(-1).id,createdAt:first.messages.at(-1).createdAt}
    const second=await measured('history_page_50',()=>recent(allScopes[0],before,first.cursor))
    assert.equal(second.messages.length,50)
    const old=message(0,base)
    if(sql)assert.equal(await rpc({op:'locate',worldId:allScopes[4].worldId,conversationId:old.conversationId,id:old.id}),null,'QA_CROSS_WORLD_LEAK')
    else await assert.rejects(store.readHistory({worldId:allScopes[4].worldId,conversationId:old.conversationId,limit:50}),e=>e.code==='KANATA_ARCHIVE_SCOPE_DENIED')
    await measured('locate_id',async()=>{
      let found
      if(sql)found=await rpc({op:'locate',...allScopes[0],id:old.id})
      else {
        found=store.snapshot.messages.find(m=>m.id===old.id)
        if(!found){const d=store.snapshot.messageArchives.find(p=>p.messages.some(m=>m.id===old.id));found=(await createKanataRepository({...driver,directory:'DATA'}).archives.read(d,password,allScopes[0])).find(m=>m.id===old.id)}
      }
      assert.deepEqual(JSON.parse(JSON.stringify(found)),old)
    })
    const stats=await measured('conversation_count',async()=>{
      if(sql)return rpc({op:'count',...allScopes[0]})
      return store.snapshot.messages.filter(m=>m.conversationId===allScopes[0].conversationId).length+(store.snapshot.messageArchives??[]).filter(p=>p.conversationId===allScopes[0].conversationId).reduce((n,p)=>n+p.messages.length,0)
    })
    assert.equal(stats,expected.scopeCounts[0])
    const batch=await measured('batch_read_all',scan)
    const extra=message(count,base)
    await measured('single_write',async()=>{
      if(sql)await rpc({op:'insert',messages:[extra]})
      else {await store.update(data=>{data.messages.push(extra)});await store.flush()}
    })
    await measured('single_update',async()=>{
      if(sql)await rpc({op:'update',worldId:extra.worldId,conversationId:extra.conversationId,id:extra.id,content:'M0 synthetic edited'})
      else {await store.update(data=>{const m=data.messages.find(m=>m.id===extra.id);m.content='M0 synthetic edited';m.revision++});await store.flush()}
    })
    await measured('single_delete',async()=>{
      if(sql)await rpc({op:'delete',worldId:extra.worldId,conversationId:extra.conversationId,id:extra.id})
      else {await store.update(data=>{data.messages=data.messages.filter(m=>m.id!==extra.id)});await store.flush()}
    })
    const deep=message(Math.floor(count/32)*16,base), deepBefore={id:deep.id,createdAt:deep.createdAt}
    const proof=sql?{near:await rpc({op:'proof',...allScopes[0],before}),deep:await rpc({op:'proof',...allScopes[0],before:deepBefore})}:{active:store.snapshot.messages.length,archiveMetadata:store.snapshot.messageArchives?.reduce((n,p)=>n+p.messages.length,0)??0}
    if(sql)for(const p of Object.values(proof)){assert.equal(p.rows,50);assert(p.vmInstructions<3000,'QA_INDEX_SCAN_NOT_BOUNDED')}
    const plan=sql?await rpc({op:'plan',...allScopes[0],...deepBefore}):null
    const integrity=sql?await rpc({op:'integrity'}):null
    await measured('close',close)
    await measured('hot_open',()=>open())
    await close()
    const sizes=async dir=>{let bytes=0;for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);bytes+=e.isDirectory()?await sizes(p):(await fs.stat(p)).size}return bytes}
    const stat=async p=>fs.stat(p).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e})
    process.stdout.write(JSON.stringify({records,batch,proof,plan,integrity,engineVersion,files:{totalBytes:await sizes(root),dbBytes:sql?await stat(path.join(root,'qa.db')):null,walBytesAfterClose:sql?await stat(path.join(root,'qa.db-wal')):null}})+'\n')
  }
} catch(e) {
  // Only controlled error codes, never SQL, data or credentials.
  process.stdout.write(JSON.stringify({failed:true,code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'QA_HOST_FAILED',location:e.stack?.split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3),records})+'\n');process.exitCode=1
} finally {if(sql)sql.stdin.end();process.stdin.destroy()}
