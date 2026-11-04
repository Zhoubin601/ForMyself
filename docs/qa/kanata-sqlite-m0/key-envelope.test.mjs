import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {wrapKey,unwrapKey} from './key-envelope.mjs'
test('random 256-bit DEK: correct/wrong password, AAD/cipher corruption, version, rewrap preserves DEK',async()=>{
  const oldPassword=randomBytes(24).toString('base64'),newPassword=randomBytes(24).toString('base64'),dek=randomBytes(32)
  const times=[]
  for(let i=0;i<5;i++){
    const start=performance.now(),envelope=await wrapKey(oldPassword,dek);times.push(performance.now()-start)
    const plain=await unwrapKey(oldPassword,envelope);assert(timingSafeEqual(Buffer.from(plain),dek),'QA_DEK_ROUNDTRIP_FAILED');plain.fill(0)
    await assert.rejects(unwrapKey(newPassword,envelope),/QA_ENVELOPE_AUTH_FAILED/)
    for(const changed of [{...envelope,version:99},{...envelope,salt:randomBytes(16).toString('base64')},{...envelope,ciphertext:randomBytes(48).toString('base64')},{...envelope,purpose:'another-module'}])await assert.rejects(unwrapKey(oldPassword,changed),/QA_ENVELOPE_AUTH_FAILED/)
    // Copy-on-write: interrupted candidate preparation never invalidates old envelope.
    const next=await wrapKey(newPassword,dek)
    const recovered=await unwrapKey(oldPassword,envelope),rewrapped=await unwrapKey(newPassword,next)
    assert(timingSafeEqual(Buffer.from(recovered),dek),'QA_OLD_ENVELOPE_RECOVERY_FAILED');assert(timingSafeEqual(Buffer.from(rewrapped),dek),'QA_REWRAP_FAILED')
    await assert.rejects(unwrapKey(oldPassword,next),/QA_ENVELOPE_AUTH_FAILED/)
    assert(!JSON.stringify(next).includes(oldPassword));assert(!JSON.stringify(next).includes(newPassword));assert(!JSON.stringify(next).includes(dek.toString('hex')))
    recovered.fill(0);rewrapped.fill(0)
  }
  times.sort((a,b)=>a-b)
  console.log(JSON.stringify({test:'QA_ENVELOPE_HOST_ONLY',samples:5,wrapMs:times,p50:times[2],p95:times[4],androidKDF:'BLOCKED',globalChangeJournal:'NOT IMPLEMENTED M6'}))
  dek.fill(0)
})
