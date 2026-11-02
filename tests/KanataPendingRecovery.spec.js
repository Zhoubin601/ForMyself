import {beforeEach,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import CryptoJS from 'crypto-js'
import {createKanataStore} from '../src/features/chat/kanataStore.js'
import {KANATA_DATA_PATH,KANATA_RECOVERY_KEY,encryptKanataData,decryptKanataData} from '../src/features/chat/storage/kanataRepository.js'
import {KANATA_ARCHIVE_DIRECTORY} from '../src/features/chat/storage/messageArchiveRepository.js'
import {sha256Text} from '../src/shared/crypto/sha256Text.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
import {archiveData,archiveFilesystem,ARCHIVE_PASSWORD as password} from './helpers/kanataArchiveFixture.js'
let sequence=0
beforeEach(()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
function interrupted(data=archiveData(100)){
  const h=archiveFilesystem(),previous=structuredClone(data),latest=structuredClone(data)
  latest.worlds[0].name+=' · 最新合成待写'
  const old=encryptKanataData(previous,password)
  h.files.set(KANATA_DATA_PATH,old)
  h.values.set(KANATA_RECOVERY_KEY,JSON.stringify({type:'kanata-recovery',version:1,baseFingerprint:sha256Text(old),ciphertext:encryptKanataData(latest,password)}))
  const repository=h.repository(),store=createKanataStore(repository,'pending-cold-'+(++sequence))()
  return{...h,previous,latest,old,repository,store}
}

it('P7 cold start settles the verified encrypted pending draft before exposing ready, without changing any original message',async()=>{
  const h=interrupted()
  expect(await h.store.load(password)).toBe(true)
  expect(h.store.isDataLoaded).toBe(true);expect(h.store.saveError).toBe('');expect(h.store.hasPendingSave).toBe(false)
  expect(h.store.snapshot.worlds[0].name).toBe(h.latest.worlds[0].name)
  expect(decryptKanataData(h.files.get(KANATA_DATA_PATH),password)).toEqual(h.latest)
  expect(h.store.snapshot.messages).toEqual(h.previous.messages)
  expect(h.values.has(KANATA_RECOVERY_KEY)).toBe(false)
})

it('P7 failed cold pending save preserves the old primary and encrypted recovery, stays unready and can be retried',async()=>{
  const h=interrupted();h.control.failure={operation:'write',contains:'kanata-v1.tmp'}
  expect(await h.store.load(password)).toBe(false)
  expect(h.store.isDataLoaded).toBe(false);expect(h.store.snapshot).toBe(null);expect(h.store.loadError).toBe('KANATA_SAVE_FAILED')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(h.old);expect(h.values.has(KANATA_RECOVERY_KEY)).toBe(true)
  expect(h.repository.getState().hasPendingSave).toBe(true)
  h.control.failure=null
  expect(await h.store.load(password)).toBe(true)
  expect(h.store.snapshot.worlds[0].name).toBe(h.latest.worlds[0].name)
  expect(h.store.hasPendingSave).toBe(false)
})

it('P7 full recovery blocked/busy states leave pending ciphertext for the coordinator instead of replaying it during load',async()=>{
  for(const barrier of [{blocked:true,busy:false},{blocked:false,busy:true}]){
    Object.assign(restoreState,barrier)
    const h=interrupted()
    expect(await h.store.load(password)).toBe(true)
    expect(h.store.hasPendingSave).toBe(true);expect(h.files.get(KANATA_DATA_PATH)).toBe(h.old)
    expect(h.calls.some(c=>['write','rename','delete'].includes(c.operation))).toBe(false)
    // The existing internal coordinator capability can settle its loaded participant.
    await h.store.flush()
    expect(h.store.hasPendingSave).toBe(false)
  }
})

it('P7 pending archive metadata must pass before cold replay; missing bodies never replace a valid primary',async()=>{
  const setup=archiveFilesystem(),data=archiveData(100),repo=setup.repository(),scope={worldId:data.worlds[0].id,conversationId:data.conversations[0].id}
  const page=await repo.archives.write(data.messages.slice(0,50),password,scope)
  const h=interrupted({...data,version:2,messages:data.messages.slice(50),messageArchives:[page]})
  // h has no archive body, even though both encrypted headers are structurally valid.
  expect(h.files.has(KANATA_ARCHIVE_DIRECTORY+'/'+page.key+'.enc')).toBe(false)
  expect(await h.store.load(password)).toBe(false)
  expect(h.store.loadError).toBe('KANATA_ARCHIVE_MISSING')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(h.old);expect(h.values.has(KANATA_RECOVERY_KEY)).toBe(true)
  expect(h.calls.some(c=>['write','rename','delete'].includes(c.operation))).toBe(false)
})

it('P7 future pending versions reject before replay without replacing the current valid graph',async()=>{
  const h=interrupted(),record=JSON.parse(h.values.get(KANATA_RECOVERY_KEY))
  record.ciphertext=CryptoJS.AES.encrypt(JSON.stringify({...h.latest,version:999}),password).toString()
  h.values.set(KANATA_RECOVERY_KEY,JSON.stringify(record))
  expect(await h.store.load(password)).toBe(false)
  expect(h.store.loadError).toBe('UNSUPPORTED_KANATA_VERSION')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(h.old)
  expect(h.calls.some(c=>['write','rename','delete'].includes(c.operation))).toBe(false)
})

it('P7 release during cold replay cannot publish plaintext or a late ready result',async()=>{
  const h=interrupted();let resume,entered
  const paused=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{resume=resolve})
  h.control.pause={operation:'write',contains:'kanata-v1.tmp',onEnter:entered,wait}
  const loading=h.store.load(password)
  await paused
  expect(h.store.isDataLoaded).toBe(false);expect(h.store.snapshot).toBe(null)
  const released=h.store.release();resume()
  await released
  expect(await loading).toBe(false)
  expect(h.store.snapshot).toBe(null);expect(h.store.isDataLoaded).toBe(false)
})
