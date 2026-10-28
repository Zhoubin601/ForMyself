import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import preset from '../src/features/chat/presets/abydos.v1.json'
import { createKanataStore } from '../src/features/chat/kanataStore.js'
import { createKanataManagement } from '../src/application/kanataManagement.js'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { restoreState } from '../src/platform/storage/restoreState.js'

const fields={name:'合成新世界',rules:'',displayName:'旅人',background:''}
const makeFixture=()=>{
  let sequence=0,disk=null,pending=null,fail=false
  const idFactory=kind=>kind+'-'+(++sequence)
  const initial=instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory})
  disk=structuredClone(initial)
  const state={loaded:false,loadError:'',saveError:'',hasPendingSave:false,recoveryAvailable:false}
  const repository={
    getState:()=>({...state}),wait:async()=>{},
    read:async()=>{state.loaded=true;return{status:'ready',data:structuredClone(pending||disk),recovered:false,fingerprint:''}},
    write:async value=>{pending=structuredClone(value);state.hasPendingSave=true;if(fail){state.saveError='KANATA_SAVE_FAILED';throw Error('KANATA_SAVE_FAILED')}disk=pending;pending=null;state.hasPendingSave=false;state.saveError=''},
    retry:async()=>repository.flush(),
    flush:async()=>{if(fail&&pending)throw Error('KANATA_SAVE_FAILED');if(pending)disk=pending;pending=null;state.hasPendingSave=false;state.saveError=''},
    release:async()=>{state.loaded=false},reencrypt:async()=>{}
  }
  const store=createKanataStore(repository,'management-test-'+sequence)()
  const auth={sessionRevision:0}
  const access={runOperation:vi.fn(async(_ids,action)=>action())}
  const management=createKanataManagement({store,auth,access,idFactory,keyFactory:()=>String(++sequence),clock:()=>2000,timeZone:()=> 'Asia/Shanghai'})
  return{store,auth,access,management,disk:()=>disk,setFailure:value=>{fail=value},repository}
}
beforeEach(()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
describe('P3 actual management facade with Store save/session/recovery semantics',()=>{
  it('ordinary mutations require a loaded store and acquire a protected lease',async()=>{
    const h=makeFixture()
    await expect(h.management.createWorld(fields)).rejects.toThrow('KANATA_NOT_LOADED')
    expect(h.disk().worlds).toHaveLength(1)
    await h.store.load('synthetic')
    await h.management.createWorld(fields)
    expect(h.access.runOperation).toHaveBeenLastCalledWith(['chat'],expect.any(Function))
    expect(h.disk().worlds).toHaveLength(2)
  })
  it('a restore barrier blocks facade mutation at the Store even with an injected lease adapter',async()=>{
    const h=makeFixture();await h.store.load('synthetic');restoreState.blocked=true
    await expect(h.management.createWorld(fields)).rejects.toThrow('完整数据恢复尚未完成')
    expect(h.disk().worlds).toHaveLength(1)
  })
  it('expired page callbacks cannot reauthenticate and mutate a newer session',async()=>{
    const h=makeFixture();await h.store.load('synthetic');h.auth.sessionRevision++
    await expect(h.management.createWorld(fields)).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(h.access.runOperation).not.toHaveBeenCalled()
    expect(h.disk().worlds).toHaveLength(1)
  })
  it('expiry during queued lease acquisition is rechecked before any mutation',async()=>{
    const h=makeFixture();await h.store.load('synthetic')
    let resume
    h.access.runOperation.mockImplementation(async(_ids,action)=>{await new Promise(resolve=>{resume=resolve});return action()})
    const queued=h.management.createWorld(fields)
    const rejected=expect(queued).rejects.toThrow('KANATA_SESSION_EXPIRED')
    h.auth.sessionRevision++;resume();await rejected
    expect(h.disk().worlds).toHaveLength(1)
  })
  it('write failures retain the real latest draft and retry flush, without duplicating a create action',async()=>{
    const h=makeFixture();await h.store.load('synthetic');h.setFailure(true)
    await expect(h.management.createWorld(fields)).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(h.store.snapshot.worlds).toHaveLength(2);expect(h.disk().worlds).toHaveLength(1)
    expect(h.store.hasPendingSave).toBe(true);expect(h.store.saveStatus).toBe('error')
    h.setFailure(false);await h.management.retrySave()
    expect(h.disk().worlds).toHaveLength(2);expect(h.store.saveError).toBe('');expect(h.store.hasPendingSave).toBe(false)
  })
  it('manual preset creation uses the generic catalog and creates a separate empty-history world',async()=>{
    const h=makeFixture();await h.store.load('synthetic');await h.management.createPresetWorld(preset.id)
    expect(h.disk().worlds).toHaveLength(2);expect(h.disk().instances).toHaveLength(10)
    expect(h.disk().cards).toHaveLength(5);expect(h.disk().messages).toEqual([])
    expect(h.disk().memories).toEqual([]);expect(h.disk().events).toEqual([]);expect(h.disk().lifeGrants).toEqual([])
  })
  it('cancelled protected access is an observable failure and does not mutate',async()=>{
    const h=makeFixture();await h.store.load('synthetic');h.access.runOperation.mockResolvedValue(false)
    await expect(h.management.createWorld(fields)).rejects.toThrow('KANATA_OPERATION_CANCELLED')
    expect(h.disk().worlds).toHaveLength(1)
  })
})
