import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReadonly } from 'vue'
import preset from '../src/features/chat/presets/abydos.v1.json'
import { createKanataStore } from '../src/features/chat/kanataStore.js'
import { createKanataRepository } from '../src/features/chat/storage/kanataRepository.js'
import { restoreState } from '../src/platform/storage/restoreState.js'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
const options = { initializationKey: 'first', now: 1000, timeZone: 'Asia/Shanghai', idFactory: (kind, key) => kind + '-' + [...key].reduce((h,c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 17).toString(16) }
const seeded = () => instantiateWorldPreset(createEmptyKanataData('user-local'), preset, options)
const copy = value => JSON.parse(JSON.stringify(value))
function harness() {
  let disk = null, pending = null
  const state = { loaded: false, loadError: '', saveError: '', hasPendingSave: false }
  const controls = { readError: false, writeError: false, waitRead: null, canInitialize: true }
  const repository = {
    getState: () => state,
    read: vi.fn(async () => { if(controls.waitRead) await controls.waitRead; if(controls.readError) throw Object.assign(new Error('private-driver-detail'),{code:'KANATA_READ_FAILED'}); state.loaded=true;return {status:pending?'recovered':disk?'ready':'missing',data:pending?copy(pending):disk?copy(disk):null,recovered:Boolean(pending)} }),
    write: vi.fn(async value => { pending=copy(value);state.hasPendingSave=true;if(controls.writeError){state.saveError='KANATA_SAVE_FAILED';throw Object.assign(new Error('private-driver-detail'),{code:'KANATA_SAVE_FAILED'})}disk=pending;pending=null;state.hasPendingSave=false;state.saveError='' }),
    flush: vi.fn(async () => {if(!state.loaded)throw Object.assign(new Error('not loaded'),{code:'KANATA_NOT_LOADED'});if(controls.writeError)throw new Error('failed');if(pending)disk=pending;pending=null;state.hasPendingSave=false;state.saveError=''}),
    release: vi.fn(async()=>{state.loaded=false;if(pending)throw Object.assign(new Error('pending save'),{code:'KANATA_PENDING_SAVE'})}),
    reencrypt: vi.fn(async()=>{if(controls.writeError)throw new Error('failed')})
  }
  const useStore=createKanataStore(repository,'synthetic-'+Math.random(),{canInitialize:()=>controls.canInitialize})
  return {store:useStore(),repository,controls,disk:()=>disk,setDisk:value=>{disk=copy(value)}}
}
beforeEach(()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
it('P2-store missing loads explicitly without seed, write or AI',async()=>{const h=harness();expect(await h.store.load('synthetic')).toBe(true);expect(h.store.needsInitialization).toBe(true);expect(h.store.snapshot.worlds).toEqual([]);expect(h.repository.write).not.toHaveBeenCalled();expect(isReadonly(h.store.snapshot)).toBe(true)})
it('P2-store failed read is not ready and cannot mutate or initialize',async()=>{const h=harness();h.controls.readError=true;expect(await h.store.load('synthetic')).toBe(false);expect(h.store.isDataLoaded).toBe(false);expect(h.store.loadError).toBe('KANATA_READ_FAILED');await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_NOT_LOADED');expect(h.repository.write).not.toHaveBeenCalled()})
it('P2-store initializer requires cleanup guard; three retries do not duplicate or rewrite',async()=>{const h=harness();await h.store.load('synthetic');h.controls.canInitialize=false;await expect(h.store.initializePreset(preset,options)).rejects.toThrow('KANATA_CLEANUP_REQUIRED');h.controls.canInitialize=true;await h.store.initializePreset(preset,options);for(let i=0;i<3;i++)await h.store.initializePreset(preset,options);expect(h.store.snapshot.instances).toHaveLength(5);expect(h.repository.write).toHaveBeenCalledTimes(1)})
it('P2-store ordinary mutations enforce restore barrier but internal restore can run under it',async()=>{const h=harness();h.setDisk(seeded());await h.store.load('synthetic');restoreState.blocked=true;await expect(h.store.update(d=>{d.worlds[0].name='blocked'})).rejects.toThrow();await h.store.restoreSnapshot(seeded());expect(h.store.snapshot.worlds[0].name).toContain('阿拜多斯')})
it('P2-store latest draft survives failed save and flush retry',async()=>{const h=harness();h.setDisk(seeded());await h.store.load('synthetic');h.controls.writeError=true;await expect(h.store.update(d=>{d.worlds[0].name='latest'})).rejects.toThrow();expect(h.store.snapshot.worlds[0].name).toBe('latest');expect(h.store.hasPendingSave).toBe(true);h.controls.writeError=false;await h.store.retrySave();expect(h.disk().worlds[0].name).toBe('latest');expect(h.store.saveError).toBe('')})
it('P2-store validation rejects invalid draft before changing view or writing',async()=>{const h=harness();h.setDisk(seeded());await h.store.load('synthetic');await expect(h.store.update(d=>{d.instances[0].worldId='missing'})).rejects.toThrow('ORPHAN_WORLD');expect(h.repository.write).not.toHaveBeenCalled();expect(h.store.snapshot.instances[0].worldId).toBe(h.store.snapshot.worlds[0].id)})
it('P2-store release during read clears plaintext and rejects late response',async()=>{const h=harness();h.setDisk(seeded());let resume;h.controls.waitRead=new Promise(r=>{resume=r});const loading=h.store.load('synthetic');await Promise.resolve();await h.store.release();resume();expect(await loading).toBe(false);expect(h.store.snapshot).toBe(null);expect(h.store.isDataLoaded).toBe(false)})
it('P2-store reencrypt failure blocks normal edits but supports password compensation',async()=>{const h=harness();h.setDisk(seeded());await h.store.load('synthetic');h.controls.writeError=true;await expect(h.store.reencrypt('new-synthetic')).rejects.toThrow();await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_REENCRYPT_RECOVERY_REQUIRED');h.controls.writeError=false;await h.store.reencrypt('old-synthetic');await expect(h.store.update(()=>{})).resolves.toBeTruthy()})
it('P2-store suspend and release do not claim loaded or retain snapshots',async()=>{const h=harness();h.setDisk(seeded());await h.store.load('synthetic');h.store.suspendPersistence();await expect(h.store.update(()=>{})).rejects.toThrow('KANATA_PERSISTENCE_SUSPENDED');await expect(h.store.flush()).rejects.toThrow('KANATA_PERSISTENCE_SUSPENDED');await h.store.release();expect(h.store.snapshot).toBe(null)})

it('P2-store review: reauthentication can reload encrypted pending data after failed release', async () => {
  const h = harness(); h.setDisk(seeded()); await h.store.load('synthetic')
  h.controls.writeError = true
  await expect(h.store.update(d => { d.worlds[0].name = 'latest session draft' })).rejects.toThrow()
  await expect(h.store.release()).rejects.toThrow('pending save')
  expect(h.store.snapshot).toBe(null)
  h.controls.writeError = false
  expect(await h.store.load('synthetic')).toBe(true)
  expect(h.store.snapshot.worlds[0].name).toBe('latest session draft')
  await h.store.retrySave()
  expect(h.disk().worlds[0].name).toBe('latest session draft')
})

it('P2-store review: retrying an initialized but unsaved seed settles the actual save', async () => {
  const h = harness(); await h.store.load('synthetic'); h.controls.writeError = true
  await expect(h.store.initializePreset(preset, options)).rejects.toThrow()
  expect(h.disk()).toBe(null)
  h.controls.writeError = false
  await h.store.initializePreset(preset, options)
  expect(h.disk().instances).toHaveLength(5)
  expect(h.store.hasPendingSave).toBe(false)
  expect(h.store.saveError).toBe('')
})

it('P2-store review: an incomplete password change rejects snapshot restore until compensation', async () => {
  const h = harness(); h.setDisk(seeded()); await h.store.load('synthetic'); h.controls.writeError = true
  await expect(h.store.reencrypt('new-synthetic')).rejects.toThrow()
  h.controls.writeError = false
  await expect(h.store.restoreSnapshot(seeded())).rejects.toThrow('KANATA_REENCRYPT_RECOVERY_REQUIRED')
  await expect(h.store.flush()).rejects.toThrow('KANATA_REENCRYPT_RECOVERY_REQUIRED')
  await h.store.reencrypt('old-synthetic')
  await expect(h.store.restoreSnapshot(seeded())).resolves.toBeTruthy()
})

it('P2-store review: asynchronous mutation is rejected before any snapshot or disk commit', async () => {
  const h = harness(); h.setDisk(seeded()); await h.store.load('synthetic')
  const before = copy(h.store.snapshot)
  await expect(h.store.update(async draft => { draft.worlds[0].name = 'not a synchronous edit' })).rejects.toThrow('KANATA_ASYNC_MUTATOR')
  expect(h.store.snapshot).toEqual(before)
  expect(h.repository.write).not.toHaveBeenCalled()
  await expect(h.store.update(async () => { throw new Error('synthetic async exception') })).rejects.toThrow('KANATA_ASYNC_MUTATOR')
})

it('P2-store review: an early repository rejection remains visible and retry persists the latest draft', async () => {
  const h = harness(); h.setDisk(seeded()); await h.store.load('synthetic')
  h.repository.write.mockRejectedValueOnce(Object.assign(new Error('private exception detail'), { code: 'KANATA_WRITE_REJECTED' }))
  await expect(h.store.update(d => { d.worlds[0].name = 'recover latest unqueued draft' })).rejects.toThrow()
  expect(h.store.saveError).toBe('KANATA_WRITE_REJECTED')
  expect(h.store.saveStatus).toBe('error')
  await h.store.retrySave()
  expect(h.disk().worlds[0].name).toBe('recover latest unqueued draft')
  expect(h.store.saveError).toBe('')
})

it('P2-store review: release reports an unqueued save failure while still removing plaintext', async () => {
  const h = harness(); h.setDisk(seeded()); await h.store.load('synthetic')
  h.repository.write.mockRejectedValueOnce(Object.assign(new Error('synthetic write rejection'), { code: 'KANATA_WRITE_REJECTED' }))
  await expect(h.store.update(d => { d.worlds[0].name = 'unsaved in memory' })).rejects.toThrow()
  await expect(h.store.release()).rejects.toThrow('KANATA_PENDING_SAVE')
  expect(h.store.snapshot).toBe(null)
  expect(h.store.isDataLoaded).toBe(false)
  expect(h.store.saveError).toBe('KANATA_WRITE_REJECTED')
})

it('P2-store real repository: release/reauthentication recovers pending ciphertext and resaves latest draft', async () => {
  const files = new Map(), preferences = new Map()
  let failWrites = false
  const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  const drivers = {
    filesystem: {
      stat: async ({ path }) => { if (!files.has(path)) throw missing(); return {} },
      readFile: async ({ path }) => { if (!files.has(path)) throw missing(); return { data: files.get(path) } },
      writeFile: async ({ path, data }) => { if (failWrites) throw new Error('synthetic disk full'); files.set(path, data) },
      mkdir: async () => {},
      deleteFile: async ({ path }) => { if (!files.has(path)) throw missing(); files.delete(path) },
      rename: async ({ from, to }) => { if (!files.has(from)) throw missing(); files.set(to, files.get(from)); files.delete(from) }
    },
    journal: {
      get: async ({ key }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }) => { preferences.set(key, value) },
      remove: async ({ key }) => { preferences.delete(key) }
    }
  }
  const repository = createKanataRepository(drivers)
  const store = createKanataStore(repository, 'synthetic-real-repository', { canInitialize: () => true })()
  await store.load('synthetic-password')
  await store.initializePreset(preset, options)
  failWrites = true
  await expect(store.update(d => { d.worlds[0].name = 'newest encrypted draft' })).rejects.toThrow('KANATA_SAVE_FAILED')
  await expect(store.release()).rejects.toThrow('KANATA_PENDING_SAVE')
  expect(store.snapshot).toBe(null)
  failWrites = false
  expect(await store.load('synthetic-password')).toBe(true)
  expect(store.snapshot.worlds[0].name).toBe('newest encrypted draft')
  await store.retrySave()
  const newRepository = createKanataRepository(drivers)
  expect((await newRepository.read('synthetic-password')).data.worlds[0].name).toBe('newest encrypted draft')
  expect(repository.getState().hasPendingSave).toBe(false)
  expect(store.saveError).toBe('')
})
