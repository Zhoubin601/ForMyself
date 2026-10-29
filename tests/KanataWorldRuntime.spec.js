import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {createKanataWorldRuntime} from '../src/application/kanataWorldRuntime.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
describe('P6 protected world window persistence',()=>{
  let f,runtime
  const hour=3600000
  beforeEach(async()=>{setActivePinia(createPinia());f=await experienceFixture();runtime=createKanataWorldRuntime({...f.adapters,clock:()=>12*hour})})
  afterEach(()=>{runtime.dispose();f.dispose()})
  const enable=()=>f.store.update(d=>{d.worlds[0].autonomyEnabled=true;d.worlds[0].lastSimulatedAt=hour})
  it('persists six bounded windows, then repeated resume does no work',async()=>{
    await enable()
    expect(await runtime.advance(f.binding.worldId)).toEqual({windows:6,skippedMs:8*hour})
    expect(f.disk().worlds[0].lastSimulatedAt).toBe(12*hour)
    expect(f.disk().tasks).toHaveLength(6)
    expect(await runtime.advance(f.binding.worldId)).toEqual({windows:0,skippedMs:0})
    expect(f.completion).not.toHaveBeenCalled()
  })
  it('write failure retains pending draft but durable watermark stays unchanged and retry is blocked',async()=>{
    await enable();f.fail()
    await expect(runtime.advance(f.binding.worldId)).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(f.disk().worlds[0].lastSimulatedAt).toBe(hour)
    expect(f.disk().tasks).toHaveLength(0)
    expect(f.store.hasPendingSave).toBe(true)
    expect(f.store.snapshot.tasks).toHaveLength(1)
    await expect(runtime.advance(f.binding.worldId)).rejects.toThrow('KANATA_PENDING_SAVE')
  })
  it('expired session refuses any simulation write',async()=>{
    await enable();f.auth.sessionRevision++
    await expect(runtime.advance(f.binding.worldId)).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(f.disk().tasks).toHaveLength(0)
  })
  it('disposed owner cannot reopen background work',async()=>{
    runtime.dispose();await expect(runtime.advance(f.binding.worldId)).rejects.toThrow('KANATA_SESSION_EXPIRED')
  })
  it('simulation metadata and explicit policies round trip in the actual backup adapter',async()=>{
    await enable();await runtime.advance(f.binding.worldId)
    const backup=buildKanataChatBackupSnapshot(f.store.snapshot)
    const result=readKanataChatBackupSnapshot(backup)
    expect(result.data.tasks[0].simulationWindow).toEqual(f.store.snapshot.tasks[0].simulationWindow)
  })
})
