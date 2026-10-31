import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRestoreCoordinator } from '../src/application/restoreCoordinator.js'
import { createRestoreJournal, RESTORE_PATH, openRestoreRecord } from '../src/platform/storage/restoreJournal.js'
import { restoreState } from '../src/platform/storage/restoreState.js'
import { useWeightStore } from '../src/stores/weight.js'
const mock = vi.hoisted(() => ({ values: new Map() }))
vi.mock('../src/platform/storage/preferences.js', () => ({ preferenceStorage: {
  get: async ({ key }) => ({ value: mock.values.get(key) ?? null }),
  set: async ({ key, value }) => { mock.values.set(key, value) }
} }))
const password = 'Synthetic-restore-test-only'
let files, fs, journal
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); mock.values.clear(); setActivePinia(createPinia())
  Object.assign(restoreState, { blocked: false, busy: false, message: '', syncError: '' })
  files = new Map()
  fs = {
    readFile: vi.fn(async ({ path }) => { if (!files.has(path)) throw new Error('ENOENT'); return { data: files.get(path) } }),
    writeFile: vi.fn(async ({ path, data }) => { files.set(path, data) }),
    rename: vi.fn(async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from) }),
    deleteFile: vi.fn(async ({ path }) => { files.delete(path) })
  }
  journal = createRestoreJournal(fs)
})
afterEach(() => vi.unstubAllGlobals())
const validate = v => { if (!Array.isArray(v?.records)) throw new Error('INVALID'); return structuredClone(v) }
const runtime = async (options = {}) => {
  const store = useWeightStore(); await store.loadWeightRecords()
  const coordinator = createRestoreCoordinator({ journal, state: restoreState,
    validate,
    prepare: async () => { await store.flush() },
    capture: () => ({ records: JSON.parse(JSON.stringify(store.weightRecords)) }),
    apply: async value => { await store.restoreWeightRecords(value.records); await store.flush() }, ...options })
  return { store, ...coordinator }
}
it('P7 journal-backed rollback reopens the exact authenticated previous image instead of retaining capture identity',async()=>{
  const previous={records:[{id:'synthetic-previous'}]},target={records:[{id:'synthetic-target'}]},calls=[]
  const inspect=vi.spyOn(journal,'inspect')
  let captured,restored
  const coordinator=createRestoreCoordinator({journal,state:restoreState,journalRollback:true,prepare:async()=>{},validate,
    capture:()=>{captured=validate(previous);return captured},apply:async value=>{calls.push(value);if(value.records[0].id==='synthetic-target')throw Error('synthetic-target-failed');restored=value}})
  await expect(coordinator.restore(target,password)).rejects.toThrow('synthetic-target-failed')
  expect(restored).toEqual(previous);expect(restored).not.toBe(captured);expect(calls).toHaveLength(2)
  // prepare() uses its lexical inspect implementation; this spy observes the two
  // coordinator reads: pre-apply binding and compensation, never a mock-only third call.
  expect(inspect).toHaveBeenCalledTimes(2);expect(restoreState.blocked).toBe(false);expect(files.size).toBe(0)
})
it('P7 corrupt journal at compensation keeps the barrier and record; repairing storage permits the actual recovery path',async()=>{
  let validCipher='',current={records:[{id:'synthetic-previous'}]}
  const coordinator=createRestoreCoordinator({journal,state:restoreState,journalRollback:true,prepare:async()=>{},validate,capture:()=>current,
    apply:async value=>{if(value.records[0].id==='synthetic-target'){validCipher=files.get(RESTORE_PATH);files.set(RESTORE_PATH,'corrupt-synthetic-record');current=value;throw Error('synthetic-target-failed')}current=value}})
  await expect(coordinator.restore({records:[{id:'synthetic-target'}]},password)).rejects.toHaveProperty('rollbackFailed',true)
  expect(restoreState.blocked).toBe(true);expect(files.get(RESTORE_PATH)).toBe('corrupt-synthetic-record')
  expect(current.records[0].id).toBe('synthetic-target')
  files.set(RESTORE_PATH,validCipher);await coordinator.recover(password)
  expect(current.records[0].id).toBe('synthetic-previous');expect(restoreState.blocked).toBe(false);expect(files.size).toBe(0)
})
it('P7 a valid replacement journal cannot become the rollback source for a different prepared transaction',async()=>{
  let current={records:[{id:'synthetic-previous'}]},originalCipher
  const other=await import('../src/platform/storage/restoreJournal.js')
  const coordinator=createRestoreCoordinator({journal,state:restoreState,journalRollback:true,prepare:async()=>{},validate,capture:()=>current,
    apply:async value=>{
      if(value.records[0].id==='synthetic-target'){
        originalCipher=files.get(RESTORE_PATH)
        files.set(RESTORE_PATH,await other.sealRestoreRecord({version:1,previous:{records:[{id:'synthetic-imposter'}]},target:value},password))
        throw Error('synthetic-target-failed')
      }
      current=value
    }})
  await expect(coordinator.restore({records:[{id:'synthetic-target'}]},password)).rejects.toHaveProperty('rollbackFailed',true)
  expect(current.records[0].id).toBe('synthetic-previous');expect(restoreState.blocked).toBe(true)
  files.set(RESTORE_PATH,originalCipher);await coordinator.recover(password)
  expect(current.records[0].id).toBe('synthetic-previous');expect(restoreState.blocked).toBe(false)
})
it('P7 journal replacement immediately after prepare stops before the first business write',async()=>{
  const apply=vi.fn(),original=journal.prepare
  journal.prepare=async(...args)=>{const prepared=await original(...args);files.set(RESTORE_PATH,'synthetic-replacement');return prepared}
  const coordinator=createRestoreCoordinator({journal,state:restoreState,journalRollback:true,prepare:async()=>{},validate,capture:()=>({records:[]}),apply})
  await expect(coordinator.restore({records:[{id:'synthetic-target'}]},password)).rejects.toThrow('RESTORE_ROLLBACK_RECORD_CHANGED')
  expect(apply).not.toHaveBeenCalled();expect(restoreState.blocked).toBe(true);expect(files.get(RESTORE_PATH)).toBe('synthetic-replacement')
})
it('P7 legacy journal adapters without a verified preparation digest cannot enable journal-backed writes',async()=>{
  const apply=vi.fn(),original=journal.prepare
  journal.prepare=async(...args)=>{await original(...args)}
  const coordinator=createRestoreCoordinator({journal,state:restoreState,journalRollback:true,prepare:async()=>{},validate,capture:()=>({records:[]}),apply})
  await expect(coordinator.restore({records:[{id:'synthetic-target'}]},password)).rejects.toThrow('RESTORE_ROLLBACK_DIGEST_REQUIRED')
  expect(apply).not.toHaveBeenCalled();expect(restoreState.blocked).toBe(true);expect(files.has(RESTORE_PATH)).toBe(true)
  await coordinator.recover(password);expect(apply).toHaveBeenCalledWith({records:[]});expect(restoreState.blocked).toBe(false)
})
it('actual store: invalid input is zero-write and a normal restore survives a new Pinia instance', async () => {
  const r = await runtime(); expect(() => r.restore({}, password)).toThrow('INVALID'); expect(files.size).toBe(0)
  await r.restore({ records: [{ id: 'target' }] }, password)
  expect(restoreState.blocked).toBe(false); expect(files.size).toBe(0)
  setActivePinia(createPinia()); const s = useWeightStore(); await s.loadWeightRecords(); expect(s.weightRecords[0].id).toBe('target')
})
it('authenticated journal contains no plaintext and rejects the wrong password or tampering', async () => {
  await journal.prepare({ version: 1, previous: { records: [{ id: 'private-marker' }] }, target: { records: [] } }, password)
  const record = await journal.inspect(); expect(record.encrypted).not.toContain('private-marker'); expect(record.encrypted).not.toContain(password)
  await expect(openRestoreRecord(record.encrypted, 'wrong')).rejects.toThrow()
  const changed = JSON.parse(record.encrypted); changed.ciphertext = 'AAAA' + changed.ciphertext.slice(4)
  await expect(openRestoreRecord(JSON.stringify(changed), password)).rejects.toThrow()
})
it('journal write failure aborts before any target business write', async () => {
  const r = await runtime(); r.store.addRecord({ id: 'old' }); await r.store.flush()
  fs.writeFile.mockRejectedValueOnce(new Error('disk full'))
  await expect(r.restore({ records: [{ id: 'new' }] }, password)).rejects.toThrow('disk full')
  expect(r.store.weightRecords[0].id).toBe('old'); expect(restoreState.blocked).toBe(false)
})
it('failed target apply rolls the actual store back before exposing it', async () => {
  const r = await runtime({ apply: async value => {
    await useWeightStore().restoreWeightRecords(value.records)
    if (value.records[0]?.id === 'new') throw new Error('late participant failed')
  } })
  r.store.addRecord({ id: 'old' }); await r.store.flush()
  await expect(r.restore({ records: [{ id: 'new' }] }, password)).rejects.toThrow('late participant')
  expect(r.store.weightRecords[0].id).toBe('old'); expect(restoreState.blocked).toBe(false); expect(files.size).toBe(0)
})
it('rollback failure retains journal and blocks ordinary edits; retry restores original data', async () => {
  const r = await runtime({ apply: async () => { throw new Error('persistent failure') } })
  r.store.addRecord({ id: 'old' }); await r.store.flush()
  await expect(r.restore({ records: [{ id: 'new' }] }, password)).rejects.toHaveProperty('rollbackFailed', true)
  expect(files.has(RESTORE_PATH)).toBe(true); expect(restoreState.blocked).toBe(true)
  expect(() => r.store.addRecord({ id: 'forbidden' })).toThrow('尚未完成')
  const restarted = await runtime(); await restarted.recover(password)
  expect(restarted.store.weightRecords[0].id).toBe('old'); expect(restoreState.blocked).toBe(false)
})
it.each(['before-apply', 'after-partial-apply', 'after-commit', 'cleanup'])('restart checkpoint %s yields consistent data', async point => {
  const previous = { records: [{ id: 'old' }] }, target = { records: [{ id: 'new' }] }
  // These durable records are exactly those written by the production journal.
  await journal.prepare({ version: 1, previous, target }, password)
  if (point !== 'before-apply') mock.values.set('my_weight_records_data', JSON.stringify(target.records))
  if (['after-commit', 'cleanup'].includes(point)) await journal.commit()
  if (point === 'cleanup') {
    // A process can die after removing the data record but before removing its committed marker.
    files.delete(RESTORE_PATH)
  }
  Object.assign(restoreState, { blocked: true, busy: false })
  const r = await runtime(); await r.probe(); if (restoreState.blocked) await r.recover(password)
  expect(r.store.weightRecords[0]?.id).toBe(['after-commit', 'cleanup'].includes(point) ? 'new' : 'old')
  expect(restoreState.blocked).toBe(false)
})
it('a real in-flight restore can be abandoned and a new runtime recovers its original snapshot', async () => {
  const r = await runtime({ apply: async value => { await useWeightStore().restoreWeightRecords(value.records); await new Promise(() => {}) } })
  r.store.addRecord({ id: 'old' }); await r.store.flush()
  void r.restore({ records: [{ id: 'new' }] }, password)
  await vi.waitFor(() => expect(r.store.weightRecords[0]?.id).toBe('new'), { timeout: 3000 })
  // The old runtime cannot resume, mirroring process termination without a test-only product hook.
  Object.assign(restoreState, { busy: false }); setActivePinia(createPinia())
  const restarted = await runtime(); await restarted.recover(password)
  expect(restarted.store.weightRecords[0].id).toBe('old'); expect(files.size).toBe(0)
})
it('cleanup failure retains commit decision; recovery never rolls committed data back', async () => {
  const r = await runtime(); fs.deleteFile.mockImplementation(async ({ path }) => {
    if (path === RESTORE_PATH) throw new Error('cleanup failure'); files.delete(path)
  })
  await expect(r.restore({ records: [{ id: 'new' }] }, password)).rejects.toThrow('cleanup')
  expect((await journal.inspect()).committed).toBe(true)
  fs.deleteFile.mockImplementation(async ({ path }) => { files.delete(path) })
  await r.recover(password); expect(r.store.weightRecords[0].id).toBe('new')
})
it('derived synchronization failure is visible and retry does not reapply business data', async () => {
  const sync = vi.fn().mockRejectedValueOnce(new Error('permission')).mockResolvedValue(undefined)
  const r = await runtime({ synchronize: sync }); await r.restore({ records: [{ id: 'new' }] }, password)
  expect(restoreState.blocked).toBe(false); expect(restoreState.syncError).toContain('同步失败')
  await r.retrySynchronization(); expect(restoreState.syncError).toBe(''); expect(r.store.weightRecords).toHaveLength(1)
})
it('unreadable or mismatched journal cannot be silently discarded', async () => {
  const r = await runtime(); fs.readFile.mockRejectedValueOnce(new Error('permission'))
  await r.probe(); expect(restoreState.blocked).toBe(true)
  fs.readFile.mockImplementation(async ({ path }) => { if (!files.has(path)) throw new Error('ENOENT'); return { data: files.get(path) } })
  await journal.prepare({ version: 1, previous: { records: [] }, target: { records: [] } }, password)
  files.set('formyself/restore-v1.commit', JSON.stringify({ digest: 'wrong' }))
  await expect(r.recover(password)).rejects.toThrow('MISMATCH'); expect(files.has(RESTORE_PATH)).toBe(true)
})
