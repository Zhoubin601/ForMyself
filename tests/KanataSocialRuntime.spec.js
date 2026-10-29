import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {createKanataWorldRuntime} from '../src/application/kanataWorldRuntime.js'
import {createKanataSocialRuntime} from '../src/application/kanataSocialRuntime.js'
describe('P6 private NPC social generation uses production persistence and knowledge gates',()=>{
  let f,runtime,worldRuntime
  const now=12*3600000
  beforeEach(async()=>{
    setActivePinia(createPinia());f=await experienceFixture()
    await f.store.update(d=>{
      const worldId=f.binding.worldId;d.worlds[0].autonomyEnabled=true;d.worlds[0].lastSimulatedAt=now-1800000
      d.autonomyPolicies=[{worldId,revision:1,dailyDialogueLimit:1,maxCatchUpHours:3,freedom:'strict',quietStartMinute:1320,quietEndMinute:480}]
      d.virtualSchedules=d.instances.slice(0,2).map((i,n)=>({id:`social-schedule-${n}`,worldId,instanceId:i.id,days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,location:'合成资料室',activity:'整理合成书架',resting:false,revision:1}))
      d.instances.slice(0,2).forEach(i=>{i.autonomyEnabled=true})
    })
    worldRuntime=createKanataWorldRuntime({...f.adapters,clock:()=>now});await worldRuntime.advance(f.binding.worldId)
    runtime=createKanataSocialRuntime({...f.adapters,clock:()=>now})
  })
  afterEach(()=>{runtime.dispose();worldRuntime.dispose();f.dispose()})
  it('saves exactly two actual role completions in an independent NPC conversation and one linked event',async()=>{
    expect((await runtime.run(f.binding.worldId)).status).toBe('succeeded')
    expect(f.completion).toHaveBeenCalledTimes(2)
    const data=f.store.snapshot,scene=data.tasks.find(t=>t.social),conversation=data.conversations.find(c=>c.id===scene.conversationId)
    expect(conversation.type).toBe('character');expect(conversation.participantIds).not.toContain(data.identities[0].id)
    const messages=data.messages.filter(m=>m.conversationId===conversation.id)
    expect(messages).toHaveLength(2);expect(messages.every(m=>m.role==='assistant'&&m.createdAt===now)).toBe(true)
    expect(scene.sourceRefs).toHaveLength(2);expect(scene.resultEventIds).toHaveLength(1)
    expect(data.events.find(e=>e.id===scene.resultEventIds[0]).sourceRefs).toEqual(scene.sourceRefs)
    expect(data.usageEvents).toHaveLength(2);expect(data.usageEvents.every(u=>u.purpose==='world'&&u.status==='succeeded')).toBe(true)
    expect((await runtime.run(f.binding.worldId)).status).toBe('not-needed');expect(f.completion).toHaveBeenCalledTimes(2)
  })
  it('daily zero means no scene, no provider request and no private NPC conversation',async()=>{
    await f.store.update(d=>{d.autonomyPolicies[0].dailyDialogueLimit=0})
    expect((await runtime.run(f.binding.worldId)).status).toBe('not-needed')
    expect(f.completion).not.toHaveBeenCalled();expect(f.store.snapshot.conversations.filter(c=>c.type==='character')).toHaveLength(0)
  })
  it('separate locations and resting actors cannot manufacture a social scene',async()=>{
    await f.store.update(d=>{d.virtualSchedules[1].location='另一个合成地点'})
    expect((await runtime.run(f.binding.worldId)).status).toBe('not-needed');expect(f.completion).not.toHaveBeenCalled()
  })
  it('one role never receives the other role persona or user-private transcript',async()=>{
    await f.addUser('SYNTHETIC_PRIVATE_MARKER_79')
    await f.store.update(d=>{d.instances[1].overrides.summary='SYNTHETIC_OTHER_PERSONA_MARKER_42'})
    await runtime.run(f.binding.worldId)
    const first=JSON.stringify(f.completion.mock.calls[0][0].messages)
    expect(first).not.toContain('SYNTHETIC_PRIVATE_MARKER_79');expect(first).not.toContain('SYNTHETIC_OTHER_PERSONA_MARKER_42')
    const second=JSON.stringify(f.completion.mock.calls[1][0].messages)
    expect(second).not.toContain('SYNTHETIC_PRIVATE_MARKER_79');expect(second).toContain('SYNTHETIC_OTHER_PERSONA_MARKER_42')
  })
  it('provider failure does not leave a half transcript and does not silently pay again on resume',async()=>{
    f.completion.mockRejectedValueOnce(Error('synthetic failure'))
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('synthetic failure')
    expect(f.store.snapshot.messages).toHaveLength(0);expect(f.store.snapshot.tasks.find(t=>t.social).state).toBe('failed')
    expect((await runtime.run(f.binding.worldId)).status).toBe('not-needed');expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('scene persistence failure makes zero model requests and keeps the latest pending draft',async()=>{
    f.fail();await expect(runtime.run(f.binding.worldId)).rejects.toThrow('KANATA_SAVE_FAILED')
    expect(f.completion).not.toHaveBeenCalled();expect(f.store.hasPendingSave).toBe(true)
    expect(f.disk().tasks.some(t=>t.social)).toBe(false)
  })
  it('a late response after session expiry cannot be saved as an NPC transcript',async()=>{
    const original=f.completion.getMockImplementation()
    f.completion.mockImplementationOnce(async options=>{const result=await original(options);f.auth.sessionRevision++;return result})
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('KANATA_SESSION_EXPIRED')
    expect(f.store.snapshot.messages).toHaveLength(0)
  })
  it('changed public knowledge rejects stale generated text rather than importing it',async()=>{
    const original=f.completion.getMockImplementation()
    f.completion.mockImplementationOnce(async options=>{const result=await original(options);await f.store.update(d=>{d.lorebookEntries.find(l=>l.activationRule==='always').content+=' 新合成规则'});return result})
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('SOCIAL_CONTEXT_CHANGED')
    expect(f.store.snapshot.messages).toHaveLength(0)
  })
  it('moving a participant during model generation discards the old scene',async()=>{
    const original=f.completion.getMockImplementation()
    f.completion.mockImplementationOnce(async options=>{const result=await original(options);await f.store.update(d=>{d.instances[0].state.location='合成新地点';d.instances[0].revision++});return result})
    await expect(runtime.run(f.binding.worldId)).rejects.toThrow('SOCIAL_SCENE_CHANGED')
    expect(f.store.snapshot.messages).toHaveLength(0);expect(f.completion).toHaveBeenCalledTimes(1)
  })
  it('explicit group mode writes one scene directly into its existing group with the same event reference',async()=>{
    await f.store.update(d=>{d.autonomyPolicies[0].socialChannel='group';d.autonomyPolicies[0].revision++})
    await runtime.run(f.binding.worldId)
    const data=f.store.snapshot,task=data.tasks.find(t=>t.social),group=data.conversations.find(c=>c.id===task.conversationId)
    expect(group.type).toBe('group');expect(data.conversations.filter(c=>c.type==='character')).toHaveLength(0)
    expect(data.messages.every(m=>m.conversationId===group.id)).toBe(true)
    expect(data.events.find(e=>e.id===task.resultEventIds[0]).participantIds).toContain(data.identities[0].id)
    await runtime.run(f.binding.worldId);expect(f.completion).toHaveBeenCalledTimes(2)
  })
  it('a live user turn in the current window is not replayed as another autonomous scene',async()=>{
    const message=await f.addUser('当前正在交流的合成发言');await f.store.update(d=>{d.messages.find(m=>m.id===message.id).createdAt=now-1000})
    expect((await runtime.run(f.binding.worldId)).status).toBe('not-needed');expect(f.completion).not.toHaveBeenCalled()
  })
})
