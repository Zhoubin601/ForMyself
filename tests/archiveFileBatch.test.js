import assert from 'node:assert/strict'
import test from 'node:test'
import {createArchiveFilesystem} from '../src/platform/storage/archiveFileBatch.js'
const key=n=>String(n).padStart(64,'0')
const options=n=>({path:'formyself/kanata-pages-v1/'+key(n)+'.enc',directory:'DATA',encoding:'utf8'})
const noop=async()=>{throw Error('unexpected legacy I/O')}

test('native page adapter coalesces four concurrent calls and keeps at most one bounded native batch in flight',async()=>{
  const batches=[];let active=0,peak=0
  const original={readFile:noop,writeFile:noop,deleteFile:noop,stat:async()=>({size:1})}
  const adapter=createArchiveFilesystem(original,'DATA',{enabled:true,batch:{execute:async({operations})=>{
    ++active;peak=Math.max(peak,active);batches.push(operations)
    await new Promise(resolve=>setTimeout(resolve,2));--active
    return{results:operations.map(op=>({ok:true,data:'synthetic ciphertext '+op.key}))}
  }}})
  const results=await Promise.all(Array.from({length:13},(_,n)=>adapter.readFile(options(n))))
  assert.deepEqual(batches.map(b=>b.length),[4,4,4,1]);assert.equal(peak,1)
  assert.deepEqual(results,Array.from({length:13},(_,n)=>({data:'synthetic ciphertext '+key(n)})))
  assert.deepEqual(await adapter.stat({}),{size:1})
  assert.equal(Object.hasOwn(adapter,'deleteArchiveKeys'),true)
})

test('capability is explicit on the adapter and fallback methods keep the original driver receiver',async()=>{
  class Legacy {
    #calls=0
    async stat(){return ++this.#calls}
    async readFile(){return{data:String(++this.#calls)}}
  }
  const base=new Legacy(),adapter=createArchiveFilesystem(base,'DATA',{enabled:true,batch:{execute:noop}})
  assert.equal(await adapter.stat({}),1)
  assert.deepEqual(await adapter.readFile({path:'other',directory:'DATA',encoding:'utf8'}),{data:'2'})
  const fabricated=new Proxy({},{get:()=>async()=>undefined})
  assert.equal(typeof fabricated.deleteArchiveKeys,'function')
  assert.equal(Object.hasOwn(createArchiveFilesystem(fabricated,'DATA',{enabled:false}),'deleteArchiveKeys'),false)
})

test('native page adapter preserves partial failures and drains the full batch before starting the next',async()=>{
  const batches=[]
  const adapter=createArchiveFilesystem({readFile:noop},'DATA',{enabled:true,batch:{execute:async({operations})=>{
    batches.push(operations);return{results:operations.map(op=>op.key===key(0)?{ok:false}:{ok:true,data:'synthetic'})}
  }}})
  const results=await Promise.allSettled(Array.from({length:5},(_,n)=>adapter.readFile(options(n))))
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'ARCHIVE_FILE_BATCH_FAILED')
  assert(results.slice(1).every(r=>r.status==='fulfilled'));assert.deepEqual(batches.map(b=>b.length),[4,1])
})

test('native page adapter refuses malformed responses and never retries a native failure through the legacy driver',async()=>{
  let legacy=0
  const original={readFile:async()=>{++legacy;return{data:'must not read'}}}
  for(const response of [{results:[]},{results:[{ok:true}]},{results:[{ok:'yes',data:'bad'}]},{results:[{ok:true,oversized:true,data:'ambiguous'}]},{results:[{ok:true,oversized:false,data:'malformed'}]},null]){
    const adapter=createArchiveFilesystem(original,'DATA',{enabled:true,batch:{execute:async()=>response}})
    await assert.rejects(adapter.readFile(options(0)),e=>e.code==='ARCHIVE_FILE_BATCH_FAILED')
  }
  const adapter=createArchiveFilesystem(original,'DATA',{enabled:true,batch:{execute:async()=>{throw Error('synthetic private backend details')}}})
  await assert.rejects(adapter.readFile(options(0)),e=>e.code==='ARCHIVE_FILE_BATCH_FAILED'&&!e.message.includes('private'))
  assert.equal(legacy,0)
})

test('native page adapter selects the original driver for metadata, other namespaces, unsupported encodings and oversized pages',async()=>{
  const calls=[],base={readFile:async opt=>{calls.push(opt);return{data:'large synthetic'}},writeFile:async opt=>{calls.push(opt)}}
  let batches=0
  const adapter=createArchiveFilesystem(base,'DATA',{enabled:true,batch:{execute:async()=>{++batches;return{results:[{ok:true,oversized:true}]}}}})
  await adapter.readFile({...options(0),path:'formyself/kanata-v1.enc'})
  await adapter.readFile({...options(0),directory:'CACHE'})
  await adapter.readFile({...options(0),encoding:'ascii'})
  await adapter.writeFile({...options(0),data:'A'.repeat(256*1024+1)})
  assert.deepEqual(await adapter.readFile(options(0)),{data:'large synthetic'})
  assert.equal(calls.length,5);assert.equal(batches,1)
  assert.equal(createArchiveFilesystem(base,'DATA',{enabled:false}),base)
})

test('oversized legacy reads settle before the next queued native batch starts',async()=>{
  let release,entered,started=0
  const pending=new Promise(resolve=>{entered=resolve})
  const adapter=createArchiveFilesystem({readFile:async()=>{entered();await new Promise(resolve=>{release=resolve});return{data:'oversized synthetic'}}},'DATA',{enabled:true,batch:{execute:async({operations})=>{
    ++started;return{results:operations.map((_,n)=>started===1&&n===0?{ok:true,oversized:true}:{ok:true,data:'bounded'})}
  }}})
  const work=Promise.all(Array.from({length:5},(_,n)=>adapter.readFile(options(n))))
  await pending;assert.equal(started,1);release();await work;assert.equal(started,2)
})

test('retirement uses at most 64 hashes, validates all keys before deletion and settles a failed batch without starting later ones',async()=>{
  const batches=[]
  const adapter=createArchiveFilesystem({deleteFile:noop},'DATA',{enabled:true,batch:{execute:async({operations})=>{
    batches.push(operations);return{results:operations.map(op=>({ok:op.key!==key(70)}))}
  }}})
  await assert.rejects(adapter.deleteArchiveKeys([key(0),'../outside']),e=>e.code==='ARCHIVE_FILE_BATCH_FAILED')
  assert.equal(batches.length,0)
  await assert.rejects(adapter.deleteArchiveKeys(Array.from({length:140},(_,n)=>key(n))),e=>e.code==='ARCHIVE_FILE_BATCH_FAILED')
  assert.deepEqual(batches.map(b=>b.length),[64,64]);assert(batches.flat().every(op=>op.operation==='delete'))
})
