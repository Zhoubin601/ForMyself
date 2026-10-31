import {beforeEach,describe,it,expect,vi} from 'vitest'
import {reactive} from 'vue'
import {createPinia,setActivePinia} from 'pinia'
import preset from '../src/features/chat/presets/abydos.v1.json'
import {createKanataStore} from '../src/features/chat/kanataStore.js'
import {instantiateWorldPreset} from '../src/features/chat/domain/presetCore.js'
import {createEmptyKanataData} from '../src/features/chat/domain/kanataCore.js'
import {createKanataChatRuntime} from '../src/application/kanataChatRuntime.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
let seq=0
const fixture=async()=>{
  const initial=instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++seq)})
  let disk=initial,fail=false
  const state={loaded:false,loadError:'',saveError:'',hasPendingSave:false}
  const repo={getState:()=>state,read:async()=>{state.loaded=true;return{status:'ready',data:disk,recovered:false}},write:async d=>{if(fail){state.saveError='KANATA_SAVE_FAILED';state.hasPendingSave=true;throw Error('KANATA_SAVE_FAILED')}disk=JSON.parse(JSON.stringify(d));state.saveError='';state.hasPendingSave=false},flush:async()=>{},release:async()=>{},reencrypt:async()=>{}}
  const store=createKanataStore(repo,'p4-test-'+(++seq))();await store.load('synthetic')
  const auth=reactive({sessionRevision:0}),settings=reactive({aiApiKey:'synthetic-key'})
  const access={runOperation:vi.fn(async(_ids,action)=>action())}
  const completion=vi.fn(async options=>{
    const event={id:'attempt-'+(++seq),model:'deepseek-flash',officialProvider:true,startedAt:1000,finishedAt:null,status:'pending',transport:'json',errorCode:'',finishReason:'',usage:null,estimatedInputTokens:100,estimatedOutputTokens:0}
    await options.onAttempt(event);options.onDelta?.('合成预览')
    await options.onAttempt({...event,status:'succeeded',finishedAt:2000,finishReason:'stop',usage:{promptTokens:100,completionTokens:20,cacheHitTokens:0}})
    return{content:'第一段。\n\n第二段。',attemptId:event.id}
  })
  const runtime=createKanataChatRuntime({store,auth,settings,access,completion,idFactory:()=>String(++seq),clock:()=>2000})
  return{store,auth,access,settings,completion,runtime,c:initial.conversations[0],initial,fail:()=>{fail=true},disk:()=>disk}
}
beforeEach(()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false})})
describe('P4 actual Store + protected application runtime',()=>{
  it('saves user and real speaker bubbles with stable batch, reply source and one attempt',async()=>{
    const h=await fixture();await h.runtime.send(h.c.id,{text:'你好'})
    expect(h.disk().messages).toHaveLength(3);const [user,a,b]=h.disk().messages
    expect(a.senderId).toBe(h.initial.instances[0].id);expect(a.senderId).toBe(b.senderId)
    expect(a.batchId).toBe(b.batchId);expect(a.replyToMessageId).toBe(user.id)
    expect(h.disk().usageEvents).toHaveLength(1);expect(h.disk().usageEvents[0].status).toBe('succeeded')
    expect(h.access.runOperation).toHaveBeenCalledWith(['chat'],expect.any(Function));h.runtime.dispose()
  })
  it('no key, invalid mention and recovery barrier make zero model calls',async()=>{
    const h=await fixture();h.settings.aiApiKey=''
    await expect(h.runtime.send(h.c.id,{text:'你好'})).rejects.toThrow('MISSING_KEY')
    h.settings.aiApiKey='synthetic';restoreState.blocked=true
    await expect(h.runtime.send(h.c.id,{text:'你好'})).rejects.toThrow('RESTORE_RECOVERY_REQUIRED')
    restoreState.blocked=false
    await expect(h.runtime.send(h.initial.conversations.find(c=>c.type==='group').id,{text:'@未知角色 你好'})).rejects.toThrow('MENTION_UNKNOWN_OR_AMBIGUOUS')
    expect(h.completion).not.toHaveBeenCalled();expect(h.store.snapshot.messages).toHaveLength(0);h.runtime.dispose()
  })
  it('actual Store failed user save retains draft but never starts a chargeable call',async()=>{
    const h=await fixture();h.fail()
    await expect(h.runtime.send(h.c.id,{text:'要保留的合成消息'})).rejects.toThrow()
    expect(h.store.snapshot.messages).toHaveLength(1);expect(h.store.saveError).toBeTruthy();expect(h.completion).not.toHaveBeenCalled();h.runtime.dispose()
  })
  it('disposing a page aborts and rejects stale completion without writing another conversation',async()=>{
    const h=await fixture();let release,started
    const ready=new Promise(r=>{started=r})
    h.completion.mockImplementation(async()=>{started();return new Promise(r=>{release=r})})
    const task=h.runtime.send(h.c.id,{text:'合成等待'});await ready;h.runtime.dispose();release({content:'旧回复'})
    await expect(task).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(h.store.snapshot.messages.filter(m=>m.role==='assistant')).toHaveLength(0)
  })
  it('session expiry cancels before waiting delay calls the provider',async()=>{
    const h=await fixture(),task=h.runtime.send(h.c.id,{text:'等待',delayMs:100})
    await vi.waitFor(()=>expect(h.store.snapshot.messages).toHaveLength(1));await new Promise(resolve=>setTimeout(resolve,0));h.auth.sessionRevision++
    await expect(task).rejects.toThrow('ABORTED');expect(h.completion).not.toHaveBeenCalled();h.runtime.dispose()
  })
  it('world identity changed while waiting invalidates the response',async()=>{
    const h=await fixture();let release,started;const ready=new Promise(r=>{started=r})
    h.completion.mockImplementation(async()=>{started();return new Promise(r=>{release=r})})
    const task=h.runtime.send(h.c.id,{text:'合成等待'});await ready
    await h.store.update(d=>{d.identities[0].displayName='旅行者';d.identities[0].revision++})
    release({content:'旧身份回复'})
    await expect(task).rejects.toThrow('STALE_CONTEXT');expect(h.store.snapshot.messages).toHaveLength(1);h.runtime.dispose()
  })
  it('retry does not duplicate user or already completed speakers',async()=>{
    const h=await fixture();const result=await h.runtime.send(h.c.id,{text:'你好'})
    await h.runtime.send(h.c.id,{retryMessageId:result.messageId})
    expect(h.completion).toHaveBeenCalledTimes(1);expect(h.store.snapshot.messages).toHaveLength(3);h.runtime.dispose()
  })
  it('failure retains source, retry finishes it once; RP does not change persona or relation',async()=>{
    const h=await fixture();h.completion.mockRejectedValueOnce(Object.assign(Error('NETWORK_ERROR'),{code:'NETWORK_ERROR'}))
    await expect(h.runtime.send(h.c.id,{text:'你好'})).rejects.toThrow('NETWORK_ERROR')
    const source=h.store.snapshot.messages[0].id
    await h.runtime.setMode(h.c.id,'roleplay');await h.runtime.send(h.c.id,{retryMessageId:source})
    expect(h.store.snapshot.messages).toHaveLength(2)
    expect(h.store.snapshot.relationships).toEqual(h.initial.relationships);expect(h.store.snapshot.instances).toEqual(h.initial.instances);h.runtime.dispose()
  })
  it('queued operation rechecks session, and cancellation result is not success',async()=>{
    const h=await fixture();h.access.runOperation.mockImplementationOnce(async(_ids,action)=>{h.auth.sessionRevision++;return action()})
    await expect(h.runtime.send(h.c.id,{text:'旧会话'})).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(h.completion).not.toHaveBeenCalled();h.runtime.dispose()
    const next=await fixture();next.access.runOperation.mockResolvedValueOnce(false)
    await expect(next.runtime.send(next.c.id,{text:'取消租约'})).rejects.toThrow('KANATA_OPERATION_CANCELLED');next.runtime.dispose()
  })
  it('P7 three mentioned actors share a four-message budget without losing any paragraph',async()=>{
    const h=await fixture(),group=h.initial.conversations.find(c=>c.type==='group')
    await h.runtime.setGroupLimits(group.id,group.revision,{maxSpeakers:3,maxMessages:4})
    const text=h.initial.cardVersions.slice(0,3).map(v=>'@'+v.definition.name).join(' ')
    const result=await h.runtime.send(group.id,{text}),replies=h.store.snapshot.messages.filter(m=>m.role==='assistant')
    expect(h.completion).toHaveBeenCalledTimes(3);expect(replies).toHaveLength(4)
    for(const actor of h.initial.instances.slice(0,3))expect(replies.filter(m=>m.senderId===actor.id).map(m=>m.content).join('\n\n')).toBe('第一段。\n\n第二段。')
    expect(replies.every(m=>m.replyToMessageId===result.messageId&&m.turnId===result.turnId)).toBe(true)
    await h.runtime.send(group.id,{retryMessageId:result.messageId})
    expect(h.completion).toHaveBeenCalledTimes(3);expect(h.store.snapshot.messages).toHaveLength(5);h.runtime.dispose()
  })
  it('P7 retry counts completed actors and does not duplicate a partial group round',async()=>{
    const h=await fixture(),group=h.initial.conversations.find(c=>c.type==='group'),normal=h.completion.getMockImplementation()
    await h.runtime.setGroupLimits(group.id,1,{maxSpeakers:3,maxMessages:4})
    h.completion.mockImplementationOnce(normal).mockImplementationOnce(normal).mockRejectedValueOnce(Error('SYNTHETIC_NETWORK'))
    const text=h.initial.cardVersions.slice(0,3).map(v=>'@'+v.definition.name).join(' ')
    await expect(h.runtime.send(group.id,{text})).rejects.toThrow('SYNTHETIC_NETWORK')
    expect(h.store.snapshot.messages.filter(m=>m.role==='assistant')).toHaveLength(3)
    await h.runtime.send(group.id,{retryMessageId:h.store.snapshot.messages[0].id})
    expect(h.completion).toHaveBeenCalledTimes(4);expect(h.store.snapshot.messages.filter(m=>m.role==='assistant')).toHaveLength(4)
    expect(new Set(h.store.snapshot.messages.filter(m=>m.role==='assistant').map(m=>m.senderId)).size).toBe(3);h.runtime.dispose()
  })
  it('P7 reducing the limit never deletes completed history or pays again on retry',async()=>{
    const h=await fixture(),group=h.initial.conversations.find(c=>c.type==='group')
    const result=await h.runtime.send(group.id,{text:'@砂狼白子 你好'})
    expect(h.store.snapshot.messages).toHaveLength(3)
    await h.runtime.setGroupLimits(group.id,1,{maxSpeakers:1,maxMessages:1})
    await h.runtime.send(group.id,{retryMessageId:result.messageId})
    expect(h.completion).toHaveBeenCalledTimes(1);expect(h.store.snapshot.messages).toHaveLength(3);h.runtime.dispose()
  })
  it('P7 a deliberately deleted complete batch does not consume the visible reply budget or block explicit retry',async()=>{
    const h=await fixture(),result=await h.runtime.send(h.c.id,{text:'你好'})
    for(const row of h.store.snapshot.messages.filter(m=>m.role==='assistant'))await h.runtime.reviseMessage(row.id,row.revision,{content:'',deleted:true})
    await h.runtime.send(h.c.id,{retryMessageId:result.messageId})
    expect(h.completion).toHaveBeenCalledTimes(2)
    expect(h.store.snapshot.messages.filter(m=>m.role==='assistant'&&!m.deleted&&m.status==='complete')).toHaveLength(2)
    expect(h.store.snapshot.messageAudits.length).toBeGreaterThanOrEqual(2);h.runtime.dispose()
  })
  it('P7 configuration changes during completion invalidate the entire old request target',async()=>{
    const h=await fixture(),group=h.initial.conversations.find(c=>c.type==='group');let started,release
    const ready=new Promise(resolve=>{started=resolve})
    h.completion.mockImplementationOnce(async()=>{started();return new Promise(resolve=>{release=resolve})})
    const pending=h.runtime.send(group.id,{text:'@砂狼白子 你好'});await ready
    await h.store.update(data=>{const c=data.conversations.find(c=>c.id===group.id);c.replyLimits={maxSpeakers:1,maxMessages:1};c.revision++})
    release({content:'旧限制下的合成回复'})
    await expect(pending).rejects.toThrow('STALE_CONTEXT')
    expect(h.store.snapshot.messages).toHaveLength(1);h.runtime.dispose()
  })
  it('P7 limit writes validate scope/revision/lease and preserve a failed save draft without model calls',async()=>{
    const h=await fixture(),group=h.initial.conversations.find(c=>c.type==='group');h.settings.aiApiKey=''
    await expect(h.runtime.setGroupLimits(group.id,1,{maxSpeakers:3,maxMessages:2})).rejects.toThrow('INVALID_GROUP_REPLY_LIMITS')
    await expect(h.runtime.setGroupLimits(h.c.id,1,{maxSpeakers:1,maxMessages:1})).rejects.toThrow('GROUP_CONVERSATION_REQUIRED')
    await expect(h.runtime.setGroupLimits(group.id,9,{maxSpeakers:1,maxMessages:1})).rejects.toThrow('STALE_GROUP_LIMITS')
    h.fail();await expect(h.runtime.setGroupLimits(group.id,1,{maxSpeakers:3,maxMessages:4})).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(h.store.snapshot.conversations.find(c=>c.id===group.id).replyLimits).toEqual({maxSpeakers:3,maxMessages:4})
    expect(h.store.hasPendingSave).toBe(true);expect(h.store.saveError).toBeTruthy();expect(h.completion).not.toHaveBeenCalled();h.runtime.dispose()
    const cancelled=await fixture(),c=cancelled.initial.conversations.find(c=>c.type==='group')
    cancelled.access.runOperation.mockResolvedValueOnce(false)
    await expect(cancelled.runtime.setGroupLimits(c.id,1,{maxSpeakers:1,maxMessages:1})).rejects.toThrow('KANATA_OPERATION_CANCELLED')
    expect(cancelled.store.snapshot.conversations.find(i=>i.id===c.id).replyLimits).toBeUndefined();cancelled.runtime.dispose()
  })
})
