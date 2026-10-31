import assert from 'node:assert/strict'
import test from 'node:test'
import {webcrypto} from 'node:crypto'
import {restoreJsonChunks,encodeRestorePayload,decodeRestorePayload,MAX_RESTORE_PLAIN_BYTES} from '../src/platform/storage/restorePayloadCodec.js'
import {sealRestoreRecord,openRestoreRecord} from '../src/platform/storage/restoreJournal.js'
const password='synthetic-p7-journal-only'
const code=expected=>error=>error.code===expected
const record=()=>({version:1,previous:{records:[{id:'before',content:'合成旧资料🚀'.repeat(25000)}]},target:{records:[{id:'after',content:'合成新资料𠮷'.repeat(25000)}]}})
const decryptOuter=async(value,pwd)=>{
  const e=JSON.parse(value),bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0))
  const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(pwd),'PBKDF2',false,['deriveKey'])
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(e.salt),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt'])
  return new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv)},key,bytes(e.ciphertext)))
}
test('P7 inert JSON streaming matches native JSON including surrogate boundaries, keys and null prototypes',()=>{
  const data=Object.assign(Object.create(null),JSON.parse('{"__proto__":{"kept":true},"key":"value"}'))
  data.body='a'.repeat(8190)+'🚀𠮷'.repeat(10000);data.rows=[null,true,false,-0,1.25,'\ud800']
  const chunks=[...restoreJsonChunks(data)]
  assert.equal(chunks.join(''),JSON.stringify(data));assert(chunks.every(c=>c.length<=8192))
  assert.deepEqual(JSON.parse(chunks.join('')),JSON.parse(JSON.stringify(data)))
})
test('P7 streaming JSON rejects runtime/accessor/cycle/sparse inputs before any hidden getter executes',()=>{
  let calls=0;const getter={get secret(){calls++;return'synthetic'}};const cycle={};cycle.self=cycle
  for(const value of [getter,cycle,new Date(),Array(2),{hidden:undefined},{func:()=>1},{n:Infinity},{[Symbol('synthetic')]:1}])assert.throws(()=>[...restoreJsonChunks(value)],code('RESTORE_PAYLOAD_INVALID_JSON'))
  assert.equal(calls,0)
})
test('P7 small payload stays legacy plain JSON; large codec preserves every original byte/field without plaintext logs',async()=>{
  const small={version:1,previous:{rows:[1]},target:{rows:[2]}}
  assert.equal(await encodeRestorePayload(small),JSON.stringify(small));assert.deepEqual(await decodeRestorePayload(JSON.stringify(small)),small)
  const original=record(),encoded=await encodeRestorePayload(original),wrapper=JSON.parse(encoded)
  assert.equal(wrapper.type,'formyself-restore-payload');assert.equal(wrapper.version,2);assert.equal(wrapper.encoding,'gzip-json-v1')
  assert.equal(wrapper.plainBytes,new TextEncoder().encode(JSON.stringify(original)).length);assert(encoded.length<JSON.stringify(original).length/10)
  assert.deepEqual(await decodeRestorePayload(encoded),original)
})
test('P7 authenticated payload length/budget, unknown codec and corrupt gzip reject without partial records',async()=>{
  const wrapper=JSON.parse(await encodeRestorePayload(record()))
  for(const change of [{plainBytes:1},{plainBytes:wrapper.plainBytes+1}])await assert.rejects(decodeRestorePayload(JSON.stringify({...wrapper,...change})),code('RESTORE_PAYLOAD_SIZE_MISMATCH'))
  await assert.rejects(decodeRestorePayload(JSON.stringify({...wrapper,plainBytes:MAX_RESTORE_PLAIN_BYTES+1})),code('RESTORE_PAYLOAD_TOO_LARGE'))
  for(const change of [{version:99},{encoding:'unknown'}])await assert.rejects(decodeRestorePayload(JSON.stringify({...wrapper,...change})),code('UNSUPPORTED_RESTORE_PAYLOAD'))
  await assert.rejects(decodeRestorePayload(JSON.stringify({...wrapper,data:'AAAA'+wrapper.data.slice(4)})),code('RESTORE_PAYLOAD_INVALID_COMPRESSION'))
  await assert.rejects(decodeRestorePayload(JSON.stringify({...wrapper,data:'not-base64'})),code('RESTORE_PAYLOAD_INVALID_ENCODING'))
  await assert.rejects(decodeRestorePayload('{"synthetic-private-marker":'),error=>!error.message.includes('synthetic-private-marker')&&error.code==='RESTORE_PAYLOAD_INVALID_JSON')
})
test('P7 no compression support fails explicitly instead of dropping data or writing a plaintext recovery file',async()=>{
  const original=globalThis.CompressionStream
  try{globalThis.CompressionStream=undefined;await assert.rejects(encodeRestorePayload(record()),code('RESTORE_COMPRESSION_UNAVAILABLE'))}
  finally{globalThis.CompressionStream=original}
})
test('P7 encoder enforces the real 256MiB streaming budget without constructing the complete oversized JSON',async()=>{
  const repeated='x'.repeat(512*1024),oversized={version:1,previous:{records:[]},target:{records:Array(600).fill(repeated)}}
  await assert.rejects(encodeRestorePayload(oversized),code('RESTORE_PAYLOAD_TOO_LARGE'))
})
test('P7 outer AES-GCM/PBKDF2 version1 protocol is unchanged; old small and new compressed records authenticate before unpack',async()=>{
  const original=record(),encrypted=await sealRestoreRecord(original,password),envelope=JSON.parse(encrypted)
  assert.equal(envelope.version,1);assert.deepEqual(Object.keys(envelope),['version','salt','iv','ciphertext'])
  assert.equal(encrypted.includes(password),false);assert.equal(encrypted.includes('合成旧资料'),false)
  const inner=JSON.parse(await decryptOuter(encrypted,password));assert.equal(inner.version,2);assert.equal(inner.type,'formyself-restore-payload')
  assert.deepEqual(await openRestoreRecord(encrypted,password),original)
  const small={version:1,previous:{records:[]},target:{records:[{id:'synthetic'}]}}
  assert.deepEqual(JSON.parse(await decryptOuter(await sealRestoreRecord(small,password),password)),small)
  let decompressions=0;const normal=globalThis.DecompressionStream
  try{
    globalThis.DecompressionStream=class{constructor(){decompressions++;throw Error('must not reach decompression')}}
    await assert.rejects(openRestoreRecord(encrypted,'wrong-synthetic-password'));assert.equal(decompressions,0)
    const changed={...envelope,ciphertext:'AAAA'+envelope.ciphertext.slice(4)}
    await assert.rejects(openRestoreRecord(JSON.stringify(changed),password));assert.equal(decompressions,0)
  }finally{globalThis.DecompressionStream=normal}
})
