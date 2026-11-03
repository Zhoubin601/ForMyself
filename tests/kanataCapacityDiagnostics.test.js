import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {installCapacityIODiagnostics} from '../docs/qa/kanata-continuous/p7/capacity-io-diagnostics.mjs'

test('capacity I/O diagnostic preserves native results/failures while evidence contains only aggregate labels',async()=>{
  const sensitive='synthetic-private-argument-never-record',output={data:sensitive},failure=new Error(sensitive)
  let finish,time=0,calls=0
  const cap={nativePromise(plugin,method,options){
    assert.equal(this,cap);++calls
    if(options.fail)throw failure
    if(options.wait)return new Promise(resolve=>{finish=()=>resolve(output)})
    return Promise.resolve(output)
  }}
  const context={window:{Capacitor:cap},performance:{now:()=>++time}}
  const original=cap.nativePromise
  await installCapacityIODiagnostics({evaluate:fn=>vm.runInNewContext('('+fn.toString()+')()',context)})
  const monitor=context.window.__capacityIO
  assert.equal(await cap.nativePromise('Filesystem','readFile',{path:'formyself/kanata-pages-v1/'+sensitive}),output)
  assert.equal(await cap.nativePromise('ArchiveFileBatch','execute',{operations:[{operation:'write',data:sensitive}]}),output)
  assert.equal(await cap.nativePromise('NativeBiometric','getSecureCredentials',{password:sensitive}),output)
  assert.throws(()=>cap.nativePromise('Filesystem','writeFile',{path:sensitive,fail:true}),error=>error===failure)
  const pending=cap.nativePromise('Filesystem','deleteFile',{path:sensitive,wait:true})
  assert.throws(()=>monitor.reset(),/DIAGNOSTIC_IO_STILL_ACTIVE/)
  finish();assert.equal(await pending,output)
  const evidence=JSON.parse(JSON.stringify(monitor.snapshot()))
  assert.equal(evidence.active,0);assert.equal(calls,5)
  assert.equal(evidence.rows['writeFile:other'].failed,1)
  assert.deepEqual(Object.keys(evidence.rows),['readFile:archive','execute:batch','writeFile:other','deleteFile:other'])
  assert(!JSON.stringify(evidence).includes(sensitive))
  monitor.reset();assert.deepEqual(JSON.parse(JSON.stringify(monitor.snapshot())),{rows:{},active:0,peakConcurrentCalls:0})
  monitor.dispose();assert.equal(cap.nativePromise,original);assert.equal(context.window.__capacityIO,undefined)
})
