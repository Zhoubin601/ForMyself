import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
beforeEach(()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
describe('P5 actual Store/runtime knowledge and life permission chain',()=>{
  it('passive ordinary page never prompts for protected loading',async()=>{
    const h=await experienceFixture();h.access.authenticated=false;h.access.status.chat='idle'
    expect((await h.life.request('mood','合成任务')).status).toBe('requires-unlock')
    expect(h.access.ensureModule).not.toHaveBeenCalled();expect(h.readers.mood).not.toHaveBeenCalled();h.dispose()
  })
  it('unselected binding or denied grant invokes no source or model',async()=>{
    const h=await experienceFixture()
    expect((await h.life.request('mood','合成任务')).status).toBe('unselected')
    await h.runtime.setBinding('global',h.binding)
    expect((await h.life.request('mood','合成任务')).status).toBe('permission-required')
    expect(h.readers.mood).not.toHaveBeenCalled();expect(h.completion).not.toHaveBeenCalled();h.dispose()
  })
  it('read-only reply records usage without inventing L0 or long-term memory',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant()
    const result=await h.life.request('mood','理解我的已授权心情',{allowPrompt:true})
    expect(result.status).toBe('succeeded');expect(result.speakerName).toBe('小鸟游星野')
    expect(h.readers.mood).toHaveBeenCalled();expect(h.readers.todo).not.toHaveBeenCalled()
    expect(h.store.snapshot.memories).toHaveLength(0);expect(h.store.snapshot.messages).toHaveLength(0)
    expect(h.store.snapshot.usageEvents[0].purpose).toBe('life')
    expect(h.completion.mock.calls[0][0].messages[0].content).toContain('只有授权后可读的合成记录');h.dispose()
  })
  it('remember grants produce a private candidate with module provenance, never an active fact',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant('mood',{read:true,remember:true,share:false})
    await h.life.request('mood','合成任务')
    const m=h.store.snapshot.memories[0];expect(m.status).toBe('candidate');expect(m.visibility).toBe('private');expect(m.lifeSources[0].moduleId).toBe('mood');expect(m.lifeSources[0].fingerprint).toMatch(/^[a-f0-9]{64}$/)
    await h.grant('mood',{read:false,remember:false,share:false});expect(h.store.snapshot.memories[0].status).toBe('stale');h.dispose()
  })
  it('explicit module disable and invalid bound instance never fall back to the global name',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.runtime.setBinding('mood',null)
    expect((await h.life.request('mood','合成任务')).status).toBe('unselected')
    await h.store.update(d=>{d.roleBindings.modules.mood={worldId:h.binding.worldId,instanceId:'missing-instance'}})
    expect((await h.life.request('mood','合成任务')).status).toBe('unavailable');expect(h.completion).not.toHaveBeenCalled();h.dispose()
  })
  it('revocation during lazy source read blocks the provider, rather than trusting a captured graph',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant()
    h.readers.mood.mockImplementationOnce(async()=>{await h.grant('mood',{read:false,remember:false,share:false});return[{id:'synthetic',note:'must not send'}]})
    await expect(h.life.request('mood','合成任务')).rejects.toThrow('LIFE_PERMISSION_REVISED')
    expect(h.completion).not.toHaveBeenCalled();h.dispose()
  })
  it('a source changing after a response prevents stale display and candidate persistence',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant('mood',{read:true,remember:true,share:false})
    h.readers.mood.mockResolvedValueOnce([{id:'synthetic',note:'before'}]).mockResolvedValueOnce([{id:'synthetic',note:'after'}])
    await expect(h.life.request('mood','合成任务')).rejects.toThrow('LIFE_PERMISSION_REVISED')
    expect(h.store.snapshot.memories).toHaveLength(0);h.dispose()
  })
  it('expiry clears output ownership and rejects a late provider result',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant()
    let release,started;const ready=new Promise(r=>{started=r})
    h.completion.mockImplementationOnce(async()=>{started();return new Promise(r=>{release=r})})
    const task=h.life.request('mood','合成任务');await ready;h.auth.sessionRevision++;release({content:'迟到合成回应'})
    await expect(task).rejects.toThrow('KANATA_SESSION_EXPIRED');expect(h.onRelease).toHaveBeenCalled();expect(h.life.isCurrent()).toBe(false);h.dispose()
  })
  it('successful organization is idempotent and its candidates are distinct from event truth',async()=>{
    const h=await experienceFixture();await h.addUser()
    expect((await h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory')).status).toBe('succeeded')
    expect((await h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory')).status).toBe('not-needed')
    expect(h.completion).toHaveBeenCalledTimes(1);expect(h.store.snapshot.memories).toHaveLength(1);expect(h.store.snapshot.events).toHaveLength(0);expect(h.store.snapshot.memories[0].status).toBe('candidate');h.dispose()
  })
  it('failed JSON organization preserves raw messages and records a retryable error',async()=>{
    const h=await experienceFixture();await h.addUser();const before=JSON.stringify(h.store.snapshot.messages)
    h.completion.mockResolvedValueOnce({content:'invalid JSON'})
    await expect(h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory')).rejects.toThrow('INVALID_MEMORY_RESPONSE')
    expect(JSON.stringify(h.store.snapshot.messages)).toBe(before);expect(h.store.snapshot.tasks[0].state).toBe('failed')
    await h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory');expect(h.store.snapshot.tasks[0].attempt).toBe(2);h.dispose()
  })
  it('Store save failure before generation does not invoke the provider, and recovery blocks facade writes',async()=>{
    const h=await experienceFixture();await h.addUser();h.fail()
    await expect(h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory')).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(h.completion).not.toHaveBeenCalled();expect(h.store.saveError).toBeTruthy()
    restoreState.blocked=true
    await expect(h.runtime.setBinding('global',h.binding)).rejects.toThrow('RESTORE_RECOVERY_REQUIRED');h.dispose()
  })
  it('new provenance, bindings, policy, usage and task fields roundtrip through actual backup format',async()=>{
    const h=await experienceFixture();await h.runtime.setBinding('global',h.binding);await h.grant('mood',{read:true,remember:true,share:false});await h.life.request('mood','合成任务')
    await h.addUser();await h.runtime.organize(h.data.conversations[0].id,h.binding.instanceId,'memory')
    const backup=buildKanataChatBackupSnapshot(h.store.snapshot),read=readKanataChatBackupSnapshot(backup)
    expect(read.data).toEqual(JSON.parse(JSON.stringify(h.store.snapshot)));h.dispose()
  })
})
