import { beforeEach, expect, it, vi } from 'vitest'
import { reactive, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createProtectedModuleRegistry } from '../src/application/protectedModules.js'
import { createProtectedAccessStore } from '../src/stores/protectedAccess.js'
import { createBackupRegistry } from '../src/application/backupRegistry.js'
import { changeMasterPasswordTransaction } from '../src/services/masterPasswordChange.js'
const auth = reactive({ savedMasterPwd: 'synthetic-old', isLocked: false, sessionRevision: 0, loadError: '', finalizeLegacyMigration: vi.fn() })
vi.mock('../src/stores/auth.js', () => ({ useAuthStore: () => auth }))
vi.mock('../src/services/uiFeedback.js', () => ({ appAlert: vi.fn(), appChoose: vi.fn(), appPrompt: vi.fn(), resolveFeedbackDialog: vi.fn() }))
let stores, access, backup
it('P7 export ownership preserves default JSON conversion and detached images cannot alias participant state',()=>{
  const source={rows:[{value:'synthetic'}]},date=new Date('2026-10-29T00:00:00Z'),base={ready:()=>true,restore:()=>{},flush:()=>{}}
  const registry=createBackupRegistry([{...base,id:'ordinary',export:()=>({data:source,metadata:{date,omitted:undefined}})},
    {...base,id:'detached',detachedExport:true,export:()=>({data:structuredClone(source)})}])
  const image=registry.exportAll();image.ordinary.data.rows[0].value='changed';image.detached.data.rows[0].value='changed'
  expect(source.rows[0].value).toBe('synthetic');expect(image.ordinary.metadata).toEqual({date:'2026-10-29T00:00:00.000Z'})
  expect(()=>createBackupRegistry([{...base,id:'invalid',detachedExport:'yes',export:()=>({data:[]})}])).toThrow('INVALID_BACKUP_PARTICIPANT')
})
beforeEach(() => {
  setActivePinia(createPinia()); Object.assign(auth, { savedMasterPwd: 'synthetic-old', isLocked: false, sessionRevision: 0 })
  stores = ['first', 'second', 'third'].map(id => reactive({ id, isDataLoaded: false, loadError: '', saveError: '', value: '', key: 'synthetic-old',
    release: vi.fn(async function () { this.value = ''; this.isDataLoaded = false }),
    reencrypt: vi.fn(async function (password) { this.key = password }), suspendPersistence: vi.fn(), flush: vi.fn(async () => {}) }))
  const registry = createProtectedModuleRegistry(stores.map(store => ({ id: store.id, resolve: async () => store,
    load: async (s, password) => { expect(password).toBe(s.key); s.value = `private-${s.id}`; s.isDataLoaded = true } })))
  access = createProtectedAccessStore(registry, 'capability-test')()
  backup = createBackupRegistry(stores.map(store => ({ id: store.id, ready: () => store.isDataLoaded,
    export: () => ({ data: store.value }), restore: vi.fn(async part => { store.value = part.data }), flush: () => store.flush() })))
})
it('third protected participant loads by registration and is automatically included in export and restore', async () => {
  expect(await access.ensureModules()).toBe(true); expect(access.moduleIds).toEqual(['first', 'second', 'third'])
  expect(access.status.third).toBe('ready'); expect(backup.exportAll().third.data).toBe('private-third')
  const snapshot = backup.exportAll(); stores[2].value = 'edited'; await backup.restoreAll(snapshot)
  expect(stores[2].value).toBe('private-third')
  expect(await access.ensureModule('unknown')).toBe(false)
})
it.each([0, 1, 2])('password change failure at participant %s rolls back every started module', async index => {
  await access.ensureModules()
  stores[index].reencrypt.mockImplementationOnce(async function (password) { this.key = password; throw new Error('partial reencrypt') })
  const commit = vi.fn()
  await expect(access.runOperation(access.moduleIds, async () => changeMasterPasswordTransaction({
    currentPassword: 'synthetic-old', newPassword: 'synthetic-new', reencryptors: await access.reencryptors(), commit
  }))).rejects.toThrow('partial reencrypt')
  expect(stores.map(s => s.key)).toEqual(['synthetic-old', 'synthetic-old', 'synthetic-old']); expect(commit).not.toHaveBeenCalled()
  for (let i = 0; i <= index; i++) expect(stores[i].reencrypt).toHaveBeenLastCalledWith('synthetic-old')
})
it('lease keeps third-module data until in-flight operation finishes, then releases all plaintext', async () => {
  await access.ensureModules(); let finish
  const task = access.runOperation(access.moduleIds, () => new Promise(resolve => { finish = resolve }))
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  auth.savedMasterPwd = ''; auth.sessionRevision++; await nextTick()
  expect(stores[2].value).toBe('private-third'); finish(true); await task
  await vi.waitFor(() => expect(stores.every(s => s.value === '')).toBe(true))
  expect(Object.values(access.status)).toEqual(['idle', 'idle', 'idle'])
})
it('missing participant or unread module cannot be silently exported or restored as empty', async () => {
  expect(() => backup.exportAll()).toThrow('NOT_READY'); await access.ensureModules()
  const snapshot = backup.exportAll(); delete snapshot.third
  await expect(backup.restoreAll(snapshot)).rejects.toThrow('MISSING_BACKUP_PARTICIPANT')
  expect(backup.get('first').restore).not.toHaveBeenCalled()
  await expect(backup.restoreAll({ ...backup.exportAll(), unknown: {} })).rejects.toThrow('UNKNOWN_BACKUP')
})
it('synchronous restore errors still wait for other started writes before rollback can begin', async () => {
  let finish, finished = false
  const p = id => ({ id, ready: () => true, export: () => ({}), flush: async () => {} })
  const registry = createBackupRegistry([{ ...p('fail'), restore: () => { throw new Error('sync') } },
    { ...p('late'), restore: () => new Promise(resolve => { finish = () => { finished = true; resolve() } }) }])
  let settled = false
  const task = registry.restoreAll({ fail: {}, late: {} }).catch(error => { settled = true; return error })
  await Promise.resolve(); expect(settled).toBe(false); finish(); expect((await task).message).toBe('sync'); expect(finished).toBe(true)
})
it('invalid protected runtime fails closed instead of resolving to another feature', async () => {
  const registry = createProtectedModuleRegistry([{ id: 'broken', resolve: async () => ({}), load: async () => {} }])
  await expect(registry.resolve('broken')).rejects.toThrow('INVALID_PROTECTED_RUNTIME')
  await expect(registry.resolve('unknown')).rejects.toThrow('UNKNOWN_PROTECTED_MODULE')
})
