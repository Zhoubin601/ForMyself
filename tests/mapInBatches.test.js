import assert from 'node:assert/strict'
import test from 'node:test'
import {mapInBatches} from '../src/shared/async/mapInBatches.js'
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
test('bounded I/O preserves input ordering and never starts more than four operations',async()=>{
  let active=0,peak=0
  const result=await mapInBatches(Array.from({length:11},(_,n)=>n),async n=>{
    active++;peak=Math.max(peak,active)
    await Promise.resolve();await Promise.resolve();active--
    return n*2
  })
  assert.equal(peak,4);assert.equal(active,0)
  assert.deepEqual(result,Array.from({length:11},(_,n)=>n*2))
})
test('a failed batch settles every outstanding operation before rejecting and never starts later writes',async()=>{
  const gates=Array.from({length:8},deferred),started=[],failure=Error('synthetic write rejected')
  let finished=false
  const task=mapInBatches(gates,async(gate,n)=>{started.push(n);await gate.promise;if(n===1)throw failure;return n})
  task.then(()=>{finished=true},()=>{finished=true})
  await Promise.resolve();assert.deepEqual(started,[0,1,2,3])
  gates[1].resolve();await Promise.resolve();await Promise.resolve()
  assert.equal(finished,false)
  gates[3].resolve();gates[2].resolve();gates[0].resolve()
  await assert.rejects(task,error=>error===failure)
  assert.equal(finished,true);assert.deepEqual(started,[0,1,2,3])
})
test('invalid concurrency and synchronous failures cannot start an unbounded or later batch',async()=>{
  for(const count of [0,9,Infinity,1.5])await assert.rejects(mapInBatches([1],()=>{},count),/INVALID_IO_BATCH/)
  const started=[]
  await assert.rejects(mapInBatches([0,1,2,3,4],n=>{started.push(n);if(n===0)throw Error('synthetic sync failure');return n}),/synthetic sync failure/)
  assert.deepEqual(started,[0,1,2,3])
})
