import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {createKanataContactRuntime} from '../src/application/kanataContactRuntime.js'
describe('P6 protected proactive messages',()=>{
  let f,runtime,now,notify
  beforeEach(async()=>{
    setActivePinia(createPinia());f=await experienceFixture();now=Date.UTC(2026,9,29,4)
    await f.store.update(d=>{d.worlds[0].proactiveEnabled=true;d.instances[0].proactiveEnabled=true})
    notify=vi.fn(async()=>({status:'scheduled'}));runtime=createKanataContactRuntime({...f.adapters,clock:()=>now,notify})
  })
  afterEach(()=>{runtime.dispose();f.dispose()})
  it('persists delayed contact independently of autonomy, then saves one real assistant message without fake user text',async()=>{
    await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks[0].state).toBe('pending');expect(f.completion).not.toHaveBeenCalled()
    now+=120001;expect((await runtime.run(f.binding.worldId)).status).toBe('succeeded')
    expect(f.store.snapshot.messages).toHaveLength(1);expect(f.store.snapshot.messages[0].role).toBe('assistant')
    expect(f.store.snapshot.messages[0].createdAt).toBe(now);expect(f.store.snapshot.usageEvents[0].purpose).toBe('proactive')
    expect(notify).not.toHaveBeenCalled();await runtime.run(f.binding.worldId);expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('notification switch and system permission are independent; denial retains the actual message',async()=>{
    await f.store.update(d=>{d.worlds[0].notificationsEnabled=true});notify.mockResolvedValue({status:'denied'})
    await runtime.run(f.binding.worldId);now+=120001;await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks[0].contact.notificationState).toBe('denied');expect(f.store.snapshot.messages).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('expired offline contact is cancelled rather than backdating or charging for an old greeting',async()=>{
    await runtime.run(f.binding.worldId);now+=3*3600000;await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.store.snapshot.messages).toHaveLength(0);expect(f.completion).not.toHaveBeenCalled()
  })
  it('disabling proactive contact cancels already queued work without affecting autonomy',async()=>{
    await runtime.run(f.binding.worldId);await f.store.update(d=>{d.worlds[0].proactiveEnabled=false;d.worlds[0].autonomyEnabled=true})
    now+=120001;await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.completion).not.toHaveBeenCalled()
  })
  it('quiet hours do not queue or dispatch a contact',async()=>{
    now=Date.UTC(2026,9,29,15);await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks).toHaveLength(0);expect(f.completion).not.toHaveBeenCalled()
  })
  it('write failure before HTTP leaves pending draft and makes zero provider requests',async()=>{
    f.fail();await expect(runtime.run(f.binding.worldId)).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(f.completion).not.toHaveBeenCalled();expect(f.store.hasPendingSave).toBe(true);expect(f.disk().tasks).toHaveLength(0)
  })
  it('session expiry during generation prevents late message and notification writes',async()=>{
    await runtime.run(f.binding.worldId);now+=120001
    const original=f.completion.getMockImplementation();f.completion.mockImplementationOnce(async options=>{const response=await original(options);f.auth.sessionRevision++;return response})
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(f.store.snapshot.messages).toHaveLength(0);expect(notify).not.toHaveBeenCalled()
  })
  it('provider failure is recorded and never silently retried as another paid greeting',async()=>{
    await runtime.run(f.binding.worldId);now+=120001;f.completion.mockRejectedValueOnce(Error('synthetic-failure'))
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('synthetic-failure')
    expect(f.store.snapshot.tasks[0].state).toBe('failed');await runtime.run(f.binding.worldId);expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('new conversation activity supersedes a delayed proactive greeting',async()=>{
    await runtime.run(f.binding.worldId)
    const message=await f.addUser('合成的新对话');await f.store.update(d=>{d.messages.find(m=>m.id===message.id).createdAt=now+1})
    now+=120001;await runtime.run(f.binding.worldId)
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.completion).not.toHaveBeenCalled()
  })
})
