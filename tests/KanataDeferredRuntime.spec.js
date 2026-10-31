import {afterEach,beforeEach,describe,it,expect} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {createKanataChatRuntime} from '../src/application/kanataChatRuntime.js'
import {createKanataDeferredRuntime} from '../src/application/kanataDeferredRuntime.js'
import {buildKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
describe('P6 persisted delayed replies',()=>{
  let f,chat,resumed,deferred,now
  beforeEach(async()=>{
    setActivePinia(createPinia());f=await experienceFixture();now=Date.UTC(2026,9,29,4)
    const adapters={...f.adapters,clock:()=>now,lifeReaders:{}}
    chat=createKanataChatRuntime(adapters);resumed=createKanataChatRuntime(adapters)
    deferred=createKanataDeferredRuntime({...f.adapters,chat:resumed,clock:()=>now})
  })
  afterEach(()=>{chat.dispose();deferred.dispose();f.dispose()})
  const queue=()=>chat.send(f.data.conversations[0].id,{text:'普通合成问候',delayMs:2000,persistDelay:true})
  const activity=async(waitMs=5000)=>{
    await f.store.update(d=>{d.worlds[0].autonomyEnabled=true;d.instances[0].autonomyEnabled=true;d.instances[0].state.energy=0.2})
    const c=f.store.snapshot.conversations[0];await chat.setReplyTiming(c.id,c.revision,{enabled:true,waitMs})
  }
  it('P7 automatic activity delay is durable even without a caller persistence flag; no fake busy reply or paid call',async()=>{
    await activity();const result=await chat.send(f.data.conversations[0].id,{text:'合成活动问题'})
    expect(result).toMatchObject({deferred:true,activityDelayed:true});expect(f.completion).not.toHaveBeenCalled()
    expect(f.disk().tasks[0]).toMatchObject({state:'pending',notBefore:now+5000,deferredReply:{activityDelay:true}})
    expect(f.store.snapshot.messages).toHaveLength(1);expect(f.store.snapshot.messages[0].role).toBe('user')
    now+=4999;await deferred.run();expect(f.completion).not.toHaveBeenCalled()
    now++;await deferred.run();expect(f.store.snapshot.tasks[0].state).toBe('succeeded');expect(f.completion).toHaveBeenCalledTimes(1)
    expect(f.store.snapshot.tasks.filter(t=>t.deferredReply)).toHaveLength(1)
  })
  it('P7 an explicit immediate response cancels the same pending source and never charges it again on resume',async()=>{
    await activity();const result=await chat.send(f.data.conversations[0].id,{text:'合成活动问题'})
    await chat.send(f.data.conversations[0].id,{retryMessageId:result.messageId,timing:'immediate',delayMs:15000})
    expect(f.completion).toHaveBeenCalledTimes(1);expect(f.store.snapshot.tasks[0].state).toBe('cancelled')
    now+=5001;await deferred.run();expect(f.completion).toHaveBeenCalledTimes(1)
    expect(f.store.snapshot.messages.filter(m=>m.role==='user')).toHaveLength(1)
    await chat.send(f.data.conversations[0].id,{retryMessageId:result.messageId})
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('P7 manual wait wins and a newer immediate turn cancels older waiting work',async()=>{
    await activity();await queue();expect(f.disk().tasks[0].notBefore).toBe(now+2000)
    expect(f.disk().tasks[0].deferredReply.activityDelay).toBe(false)
    await chat.send(f.data.conversations[0].id,{text:'合成新问题',timing:'immediate'})
    expect(f.disk().tasks[0].state).toBe('cancelled');expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('P7 turning off activity waiting releases an existing bounded task and current permissions still apply',async()=>{
    await activity();await chat.send(f.data.conversations[0].id,{text:'合成活动问题'})
    const c=f.store.snapshot.conversations[0];await chat.setReplyTiming(c.id,c.revision,{enabled:false,waitMs:5000})
    expect(f.disk().tasks[0].notBefore).toBe(now);await deferred.run();expect(f.completion).toHaveBeenCalledTimes(1)
    expect(f.disk().tasks[0].state).toBe('succeeded')
  })
  it('P7 stale configuration, expired owner and rejected operation cannot write timing settings',async()=>{
    const c=f.store.snapshot.conversations[0]
    await expect(chat.setReplyTiming(c.id,c.revision+1,{enabled:true,waitMs:5000})).rejects.toThrow('STALE_REPLY_TIMING')
    expect(f.disk().conversations[0].replyTiming).toBeUndefined()
    f.access.runOperation.mockResolvedValueOnce(false)
    await expect(chat.setReplyTiming(c.id,c.revision,{enabled:true,waitMs:5000})).rejects.toThrow('KANATA_OPERATION_CANCELLED')
    f.auth.sessionRevision++
    await expect(chat.setReplyTiming(c.id,c.revision,{enabled:true,waitMs:5000})).rejects.toThrow('KANATA_SESSION_EXPIRED')
  })
  it('P7 failed timing save retains the newest configuration; failed deferred writes never call the model',async()=>{
    const c=f.store.snapshot.conversations[0];f.fail()
    await expect(chat.setReplyTiming(c.id,c.revision,{enabled:true,waitMs:5000})).rejects.toThrow()
    expect(f.store.snapshot.conversations[0].replyTiming).toEqual({enabled:true,waitMs:5000});expect(f.store.hasPendingSave).toBe(true)
    await expect(chat.send(c.id,{text:'不得调用的合成问题'})).rejects.toThrow()
    expect(f.completion).not.toHaveBeenCalled()
  })
  it('saves user text and delayed task before charging, then a new owner resumes without duplicating the user',async()=>{
    const result=await queue();expect(result.deferred).toBe(true);expect(f.completion).not.toHaveBeenCalled()
    expect(f.disk().tasks[0].state).toBe('pending');chat.dispose();now+=2001
    await deferred.run();expect(f.store.snapshot.tasks[0].state).toBe('succeeded')
    expect(f.store.snapshot.messages.filter(m=>m.role==='user')).toHaveLength(1)
    expect(f.store.snapshot.messages.filter(m=>m.role==='assistant')).toHaveLength(1)
    expect(f.completion).toHaveBeenCalledTimes(1)
    await deferred.run();expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('does not send before the saved due time',async()=>{await queue();await deferred.run();expect(f.completion).not.toHaveBeenCalled()})
  it('new user message makes an old queued reply stale',async()=>{
    await queue();await f.addUser('新的普通合成问题');now+=2001;await deferred.run()
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.completion).not.toHaveBeenCalled()
  })
  it('two-hour expired replies are cancelled rather than replayed on reopen',async()=>{
    await queue();now+=3*3600000;await deferred.run()
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');expect(f.completion).not.toHaveBeenCalled()
  })
  it('external backups pause delayed sends instead of replaying them after restoration',async()=>{
    await queue();const backup=buildKanataChatBackupSnapshot(f.store.snapshot)
    expect(backup.data.tasks[0].state).toBe('cancelled');expect(f.store.snapshot.tasks[0].state).toBe('pending')
  })
  it('explicit cancel stops pending work and explicit retry requeues the same source without duplication',async()=>{
    const result=await queue();await chat.cancelDeferred(f.data.conversations[0].id)
    expect(f.store.snapshot.tasks[0].state).toBe('cancelled');now+=2001;await deferred.run();expect(f.completion).not.toHaveBeenCalled()
    await chat.send(f.data.conversations[0].id,{retryMessageId:result.messageId,delayMs:2000,persistDelay:true})
    expect(f.store.snapshot.tasks).toHaveLength(1);expect(f.store.snapshot.tasks[0].state).toBe('pending')
    now+=2001;await deferred.run();expect(f.completion).toHaveBeenCalledTimes(1);expect(f.store.snapshot.messages.filter(m=>m.role==='user')).toHaveLength(1)
  })
  it('interrupted running leases become observable failure, never an automatic paid retry',async()=>{
    await queue();await f.store.update(d=>{d.tasks[0].state='running';d.tasks[0].leaseUntil=now+1000})
    now+=2001;await deferred.run()
    expect(f.store.snapshot.tasks[0].state).toBe('failed');expect(f.store.snapshot.tasks[0].errorCode).toBe('DEFERRED_REPLY_INTERRUPTED');expect(f.completion).not.toHaveBeenCalled()
  })
})
