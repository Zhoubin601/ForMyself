import {it,expect,vi,afterEach} from 'vitest'
import {webcrypto} from 'node:crypto'
import {setActivePinia,createPinia} from 'pinia'
import {archiveData,archiveFilesystem,ARCHIVE_PASSWORD as password} from './helpers/kanataArchiveFixture.js'
import {createArchiveFilesystem} from '../src/platform/storage/archiveFileBatch.js'
import {createMessageArchiveRepository,KANATA_ARCHIVE_DIRECTORY} from '../src/features/chat/storage/messageArchiveRepository.js'
import {createKanataStore} from '../src/features/chat/kanataStore.js'
import {KANATA_DATA_PATH,encryptKanataData} from '../src/features/chat/storage/kanataRepository.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
afterEach(()=>{vi.unstubAllGlobals()})
async function harness(corrupt=false){
  vi.stubGlobal('crypto',webcrypto);setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})
  const h=archiveFilesystem(),data=archiveData(1002),batches=[]
  h.files.set(KANATA_DATA_PATH,encryptKanataData(data,password))
  const batched=createArchiveFilesystem(h.filesystem,'DATA',{enabled:true,batch:{execute:async({operations})=>{
    batches.push(operations.map(op=>op.operation))
    return{results:await Promise.all(operations.map(async op=>{
      const path=KANATA_ARCHIVE_DIRECTORY+'/'+op.key+'.enc'
      try{
        if(op.operation==='write'){await h.filesystem.writeFile({path,data:op.data});return{ok:true}}
        if(op.operation==='delete'){await h.filesystem.deleteFile({path});return{ok:true}}
        const value=await h.filesystem.readFile({path})
        return{ok:true,data:corrupt?'corrupt synthetic read-back':value.data}
      }catch{return{ok:false}}
    }))}
  }}})
  const store=createKanataStore(h.repository(),'batched-archive',{archives:createMessageArchiveRepository({filesystem:batched,directory:'DATA'})})()
  expect(await store.load(password)).toBe(true)
  return{...h,data,batches,store}
}
it('actual Store keeps source bodies through batched restore, backup, both canonical rekey copies and cold reload',async()=>{
  const h=await harness();await h.store.restoreSnapshot(h.data)
  expect(h.store.snapshot.messages).toHaveLength(200)
  await h.store.prepareBackup()
  const proof=value=>value.messages.map(m=>[m.id,m.revision,m.content,m.replyToMessageId]).sort((a,b)=>a[0].localeCompare(b[0]))
  expect(proof(h.store.backupSnapshot())).toEqual(proof(h.data))
  await h.store.reencrypt('synthetic-batched-next')
  await h.store.release();expect(await h.store.load(password)).toBe(false)
  expect(await h.store.load('synthetic-batched-next')).toBe(true)
  await h.store.prepareBackup();expect(proof(h.store.backupSnapshot())).toEqual(proof(h.data))
  expect(h.batches.every(batch=>batch.length<=(batch.every(op=>op==='delete')?64:4))).toBe(true)
  expect(h.batches.some(batch=>batch.length===4)).toBe(true)
})
it('batched native read-back corruption cannot commit a partial archive header or discard original messages',async()=>{
  const h=await harness(true),original=h.files.get(KANATA_DATA_PATH)
  await expect(h.store.restoreSnapshot(h.data)).rejects.toThrow('KANATA_ARCHIVE_VERIFY_FAILED')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(original)
  expect(h.store.snapshot.messages).toHaveLength(1002)
  expect(h.store.snapshot.messageArchives).toBeUndefined()
})
