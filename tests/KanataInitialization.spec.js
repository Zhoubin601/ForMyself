import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createKanataRuntime } from '../src/application/kanataRuntime.js'
import { createKanataStore } from '../src/features/chat/kanataStore.js'
import { createKanataRepository, KANATA_DATA_PATH } from '../src/features/chat/storage/kanataRepository.js'
import { isKanataInitializationAllowed } from '../src/features/chat/domain/initializationGate.js'
import { LEGACY_CHAT_FILES, LEGACY_CHAT_RECOVERY_KEY } from '../src/features/chat/legacy/legacyChatCleanup.js'
beforeEach(()=>setActivePinia(createPinia()))
const missing=()=>Object.assign(new Error('File does not exist.'),{code:'ENOENT'})
function harness(){
  const files=new Map(LEGACY_CHAT_FILES.map(p=>[p,'synthetic legacy ciphertext'])), values=new Map([[LEGACY_CHAT_RECOVERY_KEY,'synthetic recovery'],['other-data','keep']])
  const control={failNewWrite:false,stopped:false,session:1}, state={blocked:false,busy:false}
  const filesystem={
    async stat({path}){if(!files.has(path))throw missing();return{}},
    async readFile({path}){if(!files.has(path))throw missing();return{data:files.get(path)}},
    async writeFile({path,data}){if(control.failNewWrite&&path.includes('kanata'))throw new Error('synthetic disk failed');files.set(path,data)},
    async mkdir(){},async deleteFile({path}){if(!files.has(path))throw missing();files.delete(path)},
    async rename({from,to}){if(!files.has(from))throw missing();files.set(to,files.get(from));files.delete(from)}
  }
  const preferences={async get({key}){return{value:values.get(key)??null}},async set({key,value}){values.set(key,value)},async remove({key}){values.delete(key)}}
  const repo=createKanataRepository({filesystem,journal:preferences})
  const store=createKanataStore(repo,'init-test',{canInitialize:isKanataInitializationAllowed})()
  const access={authenticated:true,async ensureModule(){return store.isDataLoaded||store.load('synthetic-only-password')},
    async runOperation(_ids,action){if(state.blocked)throw new Error('blocked');return action('synthetic-only-password',control.session)}}
  const runtime=createKanataRuntime({store,protectedAccess:access,auth:{get sessionRevision(){return control.session}},restoreState:state,
    filesystem,preferences,inspectRestoreJournal:async()=>null,
    legacyStore:{async retireForKanata(){control.stopped=true},isRetiredForKanata:()=>control.stopped},
    notifications:{getPending:async()=>({notifications:[]}),cancel:async()=>{},listChannels:async()=>({channels:[]}),deleteChannel:async()=>{}}})
  return{runtime,store,files,values,control,state}
}
it('P2 first-use cancel is zero-delete and zero-seed; ordinary init scope remains closed',async()=>{
  const h=harness(),initial=[...h.files]
  expect(await h.runtime.initialize({confirm:async()=>false})).toEqual({status:'cancelled'})
  expect([...h.files]).toEqual(initial);expect(h.control.stopped).toBe(false);expect(h.store.snapshot.worlds).toHaveLength(0)
  expect(isKanataInitializationAllowed()).toBe(false)
})
it('P2 first-use authentic confirmation retires only old files and persists one five-character seed',async()=>{
  const h=harness()
  expect(await h.runtime.initialize({confirm:async()=>true})).toEqual({status:'initialized'})
  expect(LEGACY_CHAT_FILES.every(p=>!h.files.has(p))).toBe(true)
  expect(h.files.has(KANATA_DATA_PATH)).toBe(true);expect(h.values.get('other-data')).toBe('keep')
  expect(h.store.snapshot.instances).toHaveLength(5);expect(h.store.snapshot.conversations).toHaveLength(6)
  expect(h.store.snapshot.messages).toHaveLength(0);expect(h.store.snapshot.events).toHaveLength(0);expect(isKanataInitializationAllowed()).toBe(false)
  expect(await h.runtime.initialize({confirm:async()=>true})).toEqual({status:'already-initialized'})
  expect(h.store.snapshot.instances).toHaveLength(5)
})
it('P2 first-use failed seed does not report initialized; retry flushes retained encrypted draft',async()=>{
  const h=harness();h.control.failNewWrite=true
  await expect(h.runtime.initialize({confirm:async()=>true})).rejects.toThrow()
  expect(h.store.saveError).toBeTruthy();expect(h.files.has(KANATA_DATA_PATH)).toBe(false);expect(isKanataInitializationAllowed()).toBe(false)
  h.control.failNewWrite=false
  expect(await h.runtime.initialize({confirm:async()=>true})).toEqual({status:'already-initialized'})
  expect(h.files.has(KANATA_DATA_PATH)).toBe(true);expect(h.store.saveError).toBe('');expect(h.store.snapshot.instances).toHaveLength(5)
})
it('P2 first-use recovery barrier refuses before requesting confirmation',async()=>{
  const h=harness();h.state.blocked=true
  let asked=false
  await expect(h.runtime.initialize({confirm:async()=>{asked=true;return true}})).rejects.toThrow('RESTORE_RECOVERY_REQUIRED')
  expect(asked).toBe(false);expect(h.files.size).toBe(3)
})
