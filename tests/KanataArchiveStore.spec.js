import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {webcrypto} from 'node:crypto'
import {createPinia,setActivePinia} from 'pinia'
import {archiveData,archiveFilesystem,ARCHIVE_PASSWORD as password} from './helpers/kanataArchiveFixture.js'
import {createKanataStore} from '../src/features/chat/kanataStore.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
import {encryptKanataData,decryptKanataData,KANATA_DATA_PATH,KANATA_BACKUP_PATH} from '../src/features/chat/storage/kanataRepository.js'
import {KANATA_ARCHIVE_DIRECTORY} from '../src/features/chat/storage/messageArchiveRepository.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
import {ownKanataRestoreImage} from '../src/features/chat/domain/kanataOwnedImage.js'
let sequence=0
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
afterEach(()=>{vi.unstubAllGlobals()})
async function harness(count=400){
  const h=archiveFilesystem(),data=archiveData(count);h.files.set(KANATA_DATA_PATH,encryptKanataData(data,password))
  const store=createKanataStore(h.repository(),'archive-store-'+(++sequence))();expect(await store.load(password)).toBe(true)
  const options={worldId:data.worlds[0].id,conversationId:data.conversations.find(c=>c.type==='private').id,keepRecent:50}
  return{...h,data,store,options}
}
const logical=value=>({...value,version:1,messages:[...value.messages].sort((a,b)=>a.id.localeCompare(b.id))})
it('P7 large portable restore writes bounded verified pages before the canonical header without an intermediate full monolith',async()=>{
  const h=await harness(1002);h.calls.length=0
  await h.store.restoreSnapshot(h.data)
  expect(h.store.snapshot.messages).toHaveLength(200);expect(h.store.snapshot.version).toBe(2)
  expect(h.store.snapshot.messageArchives.reduce((n,p)=>n+p.messages.length,200)).toBe(1002)
  expect(h.calls.filter(c=>c.operation==='write'&&c.path.endsWith('kanata-v1.tmp'))).toHaveLength(1)
  const firstHeaderWrite=h.calls.findIndex(c=>c.operation==='write'&&c.path.endsWith('kanata-v1.tmp'))
  expect(h.calls.slice(firstHeaderWrite+1).some(c=>c.operation==='write'&&c.path.includes('kanata-pages-v1'))).toBe(false)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
})
it('P7 immutable canonical restore retains sources, allows later normal Store edits and cannot mutate its rollback target',async()=>{
  const h=await harness(1002),image=ownKanataRestoreImage(h.data),name=image.worlds[0].name
  await h.store.restoreSnapshot(image)
  expect(h.store.snapshot.messages).toHaveLength(200)
  await h.store.update(data=>{data.worlds[0].name='edited after immutable restore';data.instances[0].state.mood='合成新心情'})
  expect(h.store.snapshot.worlds[0].name).toBe('edited after immutable restore')
  expect(image.worlds[0].name).toBe(name);expect(image.messages).toHaveLength(1002)
  await h.store.prepareBackup();const portable=h.store.backupSnapshot()
  expect(portable.messages).toHaveLength(1002)
  expect(portable.messages.map(m=>[m.id,m.revision,m.replyToMessageId])).toEqual(image.messages.map(m=>[m.id,m.revision,m.replyToMessageId]))
})
it('P7 actual Store archive commits verified pages, keeps old canonical backup, cold loads metadata only and pages stable IDs',async()=>{
  const h=await harness(),old=h.files.get(KANATA_DATA_PATH)
  expect(await h.store.archiveHistory(h.options)).toEqual({archivedCount:350,pages:7})
  expect(h.store.snapshot.version).toBe(2);expect(h.store.snapshot.messages).toHaveLength(50);expect(h.store.hasPendingSave).toBe(false)
  expect(h.files.get(KANATA_BACKUP_PATH)).toBe(old)
  const header=decryptKanataData(h.files.get(KANATA_DATA_PATH),password);expect(header.messages).toHaveLength(50)
  await h.store.release();h.calls.length=0;expect(await h.store.load(password)).toBe(true)
  expect(h.calls.filter(c=>c.operation==='read'&&c.path.includes('kanata-pages-v1'))).toHaveLength(0)
  expect(h.calls.filter(c=>c.operation==='list'&&c.path.includes('kanata-pages-v1'))).toHaveLength(1)
  expect(h.calls.filter(c=>c.operation==='stat'&&c.path.includes('kanata-pages-v1'))).toHaveLength(0)
  const first=await h.store.readHistory(h.options),second=await h.store.readHistory({...h.options,cursor:first.cursor})
  expect(first.messages).toHaveLength(50);expect(second.messages[0].id).toBe('synthetic-message-349');expect(second.pagesRead).toBe(2)
  await expect(h.store.readHistory({...h.options,worldId:'other',cursor:first.cursor})).rejects.toThrow('KANATA_ARCHIVE_SCOPE_DENIED')
  await h.store.update(d=>{d.worlds[0].name='合成更新'})
  await expect(h.store.readHistory({...h.options,cursor:first.cursor})).rejects.toThrow('KANATA_ARCHIVE_CURSOR_EXPIRED')
})
it('P7 archive failure before header leaves full original graph; failed header save retains latest durable-page draft and retry',async()=>{
  const h=await harness(),original=h.files.get(KANATA_DATA_PATH)
  h.control.failure={operation:'read',contains:'kanata-pages-v1'}
  await expect(h.store.archiveHistory(h.options)).rejects.toThrow('KANATA_ARCHIVE_READ_FAILED')
  expect(h.store.snapshot.messages).toHaveLength(400);expect(h.files.get(KANATA_DATA_PATH)).toBe(original)
  h.control.failure={operation:'write',contains:'kanata-v1.tmp'}
  await expect(h.store.archiveHistory(h.options)).rejects.toThrow('KANATA_SAVE_FAILED')
  expect(h.store.snapshot.messages).toHaveLength(50);expect(h.store.hasPendingSave).toBe(true);expect(h.store.saveError).not.toBe('')
  for(const page of h.store.snapshot.messageArchives)expect([...h.files.keys()].some(key=>key.includes(page.key))).toBe(true)
  h.control.failure=null;await h.store.retrySave();expect(h.store.hasPendingSave).toBe(false);expect(h.store.saveError).toBe('')
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
})
it('P7 unhydrated synchronous backup fails; actual archive backup is self contained and new restore loses no message or source revision',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  expect(()=>h.store.backupSnapshot()).toThrow('KANATA_ARCHIVE_BACKUP_NOT_PREPARED')
  await h.store.prepareBackup();const backup=buildKanataChatBackupSnapshot(h.store.backupSnapshot()),portable=readKanataChatBackupSnapshot(backup).data
  expect(()=>h.store.backupSnapshot()).toThrow('KANATA_ARCHIVE_BACKUP_NOT_PREPARED')
  expect(portable.messages[0].id).toBe('synthetic-message-0');expect(portable.messages.at(-1).id).toBe('synthetic-message-399')
  expect(portable.version).toBe(1);expect(portable.messageArchives).toBeUndefined();expect(portable.messages).toHaveLength(400)
  await h.store.restoreSnapshot(portable);expect(logical(h.store.snapshot)).toEqual(logical(h.data))
  await h.store.release();expect(()=>h.store.backupSnapshot()).toThrow('KANATA_NOT_LOADED')
})
it('P7 consumed backup image has independent ownership: mutating it cannot alter the live graph or another later export',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options);await h.store.prepareBackup()
  const first=h.store.backupSnapshot();first.messages[0].content='mutated exported synthetic body';first.worlds[0].name='mutated exported world'
  expect(h.store.snapshot.worlds[0].name).toBe(h.data.worlds[0].name);expect(h.store.snapshot.messages.some(m=>m.content==='mutated exported synthetic body')).toBe(false)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
})
it('P7 bad or missing page cannot become empty history or a successful backup; write gate closes after corrupt read',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  const descriptor=h.store.snapshot.messageArchives[0],file=[...h.files.keys()].find(key=>key.includes(descriptor.key)),old=h.files.get(KANATA_DATA_PATH)
  h.files.set(file,'x'.repeat(descriptor.bytes))
  await expect(h.store.readHistory({...h.options,text:'星河'})).rejects.toThrow('KANATA_ARCHIVE_VERIFY_FAILED')
  expect(h.store.archiveError).toBe('KANATA_ARCHIVE_VERIFY_FAILED')
  await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_ARCHIVE_VERIFY_FAILED')
  await expect(h.store.prepareBackup()).rejects.toThrow('KANATA_ARCHIVE_VERIFY_FAILED')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(old);h.files.delete(file)
  await h.store.release();expect(await h.store.load(password)).toBe(false);expect(h.store.isDataLoaded).toBe(false);expect(h.store.snapshot).toBe(null)
})
it('P7 protected release during archive cancels late plaintext/header and never saves partial history',async()=>{
  const h=await harness(),original=h.files.get(KANATA_DATA_PATH)
  let resume,entered;const hit=new Promise(resolve=>{entered=resolve})
  h.control.pause={operation:'write',contains:'kanata-pages-v1',onEnter:entered,wait:new Promise(resolve=>{resume=resolve})}
  const task=h.store.archiveHistory(h.options);await hit;await h.store.release();resume()
  await expect(task).rejects.toThrow('KANATA_NOT_LOADED')
  expect(h.store.snapshot).toBe(null);expect(h.files.get(KANATA_DATA_PATH)).toBe(original)
})
it('P7 actual main/bak reencrypt includes all archive bodies, retires orphan copies, old password rejected, and other module untouched',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  // Simulate a valid unreferenced page left by an interrupted conversion, and a non-chat file.
  const repo=h.repository();await repo.archives.write(h.data.messages.slice(0,50),password,h.options)
  h.files.set('formyself/other-module.enc','synthetic other module')
  await h.store.reencrypt('new-synthetic-password')
  expect(h.store.snapshot.messages).toHaveLength(50);expect(h.store.snapshot.messageArchives).toHaveLength(7)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
  for(const file of [KANATA_DATA_PATH,KANATA_BACKUP_PATH]){
    expect(decryptKanataData(h.files.get(file),'new-synthetic-password').messages).toHaveLength(50)
    expect(()=>decryptKanataData(h.files.get(file),password)).toThrow()
  }
  expect([...h.files.keys()].filter(key=>key.startsWith(KANATA_ARCHIVE_DIRECTORY+'/'))).toHaveLength(7)
  for(const page of h.store.snapshot.messageArchives){
    await expect(repo.archives.read(page,password,page)).rejects.toThrow('KANATA_ARCHIVE_DECRYPT_FAILED')
    await expect(repo.archives.read(page,'new-synthetic-password',page)).resolves.toHaveLength(page.messages.length)
  }
  expect(h.files.get('formyself/other-module.enc')).toBe('synthetic other module')
})
it('P7 cleanup failure after reencrypt cannot claim success; old-password compensation restores whole graph and clears gate',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  h.control.failure={operation:'delete',contains:'kanata-pages-v1'}
  await expect(h.store.reencrypt('new-synthetic-password')).rejects.toThrow('KANATA_ARCHIVE_RETIRE_FAILED')
  expect(h.store.snapshot.messages).toHaveLength(50)
  await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_REENCRYPT_RECOVERY_REQUIRED')
  h.control.failure=null;await h.store.reencrypt(password)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
  expect(decryptKanataData(h.files.get(KANATA_DATA_PATH),password).messages).toHaveLength(50)
  await expect(h.store.update(()=>{})).resolves.toBeTruthy()
})
it('P7 a corrupt rekey read-back retains both old headers and every source page; compensation removes the failed gate',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  const oldPages=[...h.store.snapshot.messageArchives],oldPaths=new Set(oldPages.map(p=>KANATA_ARCHIVE_DIRECTORY+'/'+p.key+'.enc'))
  const primary=h.files.get(KANATA_DATA_PATH),backup=h.files.get(KANATA_BACKUP_PATH),normal=h.filesystem.readFile
  h.filesystem.readFile=async options=>{const value=await normal(options);return options.path.startsWith(KANATA_ARCHIVE_DIRECTORY+'/')&&!oldPaths.has(options.path)?{data:value.data.slice(0,-1)+'!'}:value}
  await expect(h.store.reencrypt('new-synthetic-password')).rejects.toThrow('KANATA_ARCHIVE_VERIFY_FAILED')
  expect(h.files.get(KANATA_DATA_PATH)).toBe(primary);expect(h.files.get(KANATA_BACKUP_PATH)).toBe(backup)
  for(const path of oldPaths)expect(h.files.has(path)).toBe(true)
  await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_REENCRYPT_RECOVERY_REQUIRED')
  h.filesystem.readFile=normal;await h.store.reencrypt(password)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
  await expect(h.store.update(()=>{})).resolves.toBeTruthy()
})
it('P7 session release during page rekey cannot commit a new header or retain plaintext',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  const original=h.files.get(KANATA_DATA_PATH);let entered,resume
  const paused=new Promise(resolve=>{entered=resolve})
  h.control.pause={operation:'read',contains:'kanata-pages-v1',onEnter:entered,wait:new Promise(resolve=>{resume=resolve})}
  const operation=h.store.reencrypt('new-synthetic-password');await paused;await h.store.release();resume()
  await expect(operation).rejects.toThrow('KANATA_NOT_LOADED')
  expect(h.store.snapshot).toBe(null);expect(h.files.get(KANATA_DATA_PATH)).toBe(original)
})
it('P7 historical edit reactivates a complete page, keeps stable proof revisions and conservatively retains the encrypted previous copy',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  const previous=h.store.snapshot.messageArchives[0],path=KANATA_ARCHIVE_DIRECTORY+'/'+previous.key+'.enc'
  await h.store.activateHistoryMessage({...h.options,messageId:'synthetic-message-0'})
  expect(h.store.snapshot.messages).toHaveLength(100);expect(h.store.snapshot.messageArchives).toHaveLength(6)
  expect(h.store.snapshot.messages.find(m=>m.id==='synthetic-message-1').replyToMessageId).toBe('synthetic-message-0')
  expect(h.files.has(path)).toBe(true)
  await h.store.prepareBackup();expect(logical(h.store.backupSnapshot())).toEqual(logical(h.data))
  await expect(h.store.activateHistoryMessage({...h.options,worldId:'other',messageId:'synthetic-message-0'})).rejects.toThrow('KANATA_ARCHIVE_SCOPE_DENIED')
})
it('P7 archived world and global restore barriers are enforced inside archive actions, not merely by disabled UI',async()=>{
  const h=await harness(),before=h.files.get(KANATA_DATA_PATH)
  restoreState.blocked=true;await expect(h.store.archiveHistory(h.options)).rejects.toThrow();expect(h.files.get(KANATA_DATA_PATH)).toBe(before)
  restoreState.blocked=false;await h.store.update(d=>{d.worlds[0].archived=true})
  await expect(h.store.archiveHistory(h.options)).rejects.toThrow('KANATA_WORLD_ARCHIVED')
  expect(h.store.snapshot.messages).toHaveLength(400)
})
it('P7 page body arriving after session release cannot leak through history or prepared backup cache',async()=>{
  const h=await harness();await h.store.archiveHistory(h.options)
  let resume,entered;const hit=new Promise(resolve=>{entered=resolve})
  h.control.pause={operation:'read',contains:'kanata-pages-v1',onEnter:entered,wait:new Promise(resolve=>{resume=resolve})}
  const task=h.store.prepareBackup();await hit;await h.store.release();resume()
  await expect(task).rejects.toThrow('KANATA_NOT_LOADED');expect(h.store.snapshot).toBe(null)
  expect(()=>h.store.backupSnapshot()).toThrow('KANATA_NOT_LOADED')
})
