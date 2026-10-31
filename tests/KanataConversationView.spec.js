import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {reactive} from 'vue'
import preset from '../src/features/chat/presets/abydos.v1.json'
import {instantiateWorldPreset} from '../src/features/chat/domain/presetCore.js'
import {createEmptyKanataData} from '../src/features/chat/domain/kanataCore.js'
const mocks=vi.hoisted(()=>({store:null,settings:null,runtime:null,choose:vi.fn()}))
vi.mock('../src/features/chat/kanataStore.js',()=>({useKanataStore:()=>mocks.store}))
vi.mock('../src/stores/settings.js',()=>({useSettingsStore:()=>mocks.settings}))
vi.mock('../src/application/kanataChatRuntime.js',()=>({createKanataChatRuntime:()=>mocks.runtime}))
vi.mock('../src/services/uiFeedback.js',()=>({appChoose:(...args)=>mocks.choose(...args),cancelOwnedFeedbackDialog:vi.fn()}))
import KanataConversationView from '../src/features/chat/KanataConversationView.vue'
const button=(wrapper,text)=>wrapper.findAll('button').find(b=>b.text()===text)
let seq=0
beforeEach(()=>{
  vi.useFakeTimers()
  const snapshot=instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++seq)})
  mocks.store=reactive({snapshot,isDataLoaded:true,saveError:'',hasPendingSave:false})
  mocks.settings=reactive({aiApiKey:'synthetic'})
  mocks.runtime={send:vi.fn(async()=>({messageId:'synthetic'})),setMode:vi.fn(async()=>{}),setGroupLimits:vi.fn(async()=>{}),setReplyTiming:vi.fn(async()=>{}),cancel:vi.fn(),dispose:vi.fn()};mocks.choose.mockReset()
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})
const appendBubbles=(conversation,count=3)=>{
  const actor=mocks.store.snapshot.instances.find(i=>conversation.participantIds.includes(i.id))
  mocks.store.snapshot.messages.push(...Array.from({length:count},(_,index)=>({id:'bubble-'+index,worldId:conversation.worldId,conversationId:conversation.id,role:'assistant',senderType:'character',senderId:actor.id,senderNameSnapshot:'合成角色',content:'合成气泡'+index,createdAt:2000+index,revision:1,status:'complete',turnId:'one-turn',batchId:'one-batch'})))
}
describe('P4 conversation interaction and lifetime',()=>{
  it('P7 activity timing settings are durable facade calls with inline validation, focus and no key requirement',async()=>{
    mocks.settings.aiApiKey=''
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id},attachTo:document.body})
    await button(w,'活动等待设置').trigger('click')
    const form=w.get('form[aria-label="活动等待设置"]'),field=form.get('input[type="number"]')
    await form.get('input[type="checkbox"]').setValue(true);await field.setValue('999');await form.trigger('submit')
    expect(mocks.runtime.setReplyTiming).not.toHaveBeenCalled();expect(field.attributes('aria-invalid')).toBe('true');expect(document.activeElement).toBe(field.element)
    await field.setValue('30000');await form.trigger('submit');await flushPromises()
    expect(mocks.runtime.setReplyTiming).toHaveBeenCalledWith(c.id,c.revision,{enabled:true,waitMs:30000});expect(mocks.runtime.send).not.toHaveBeenCalled()
    expect(w.find('form[aria-label="活动等待设置"]').exists()).toBe(false);w.unmount()
  })
  it('P7 activity configuration failures retain the draft and cannot claim success',async()=>{
    mocks.runtime.setReplyTiming.mockRejectedValueOnce({code:'STALE_REPLY_TIMING'})
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    await button(w,'活动等待设置').trigger('click');await w.get('form[aria-label="活动等待设置"]').trigger('submit');await flushPromises()
    expect(w.text()).toContain('会话已变化');expect(w.get('form[aria-label="活动等待设置"]').exists()).toBe(true)
    await button(w,'取消活动等待设置').trigger('click');expect(mocks.runtime.setReplyTiming).toHaveBeenCalledTimes(1);w.unmount()
  })
  it('P7 a waiting source has an explicit immediate action and the activity notice never invents an assistant message',async()=>{
    const c=mocks.store.snapshot.conversations[0]
    mocks.store.snapshot.messages.push({id:'waiting-source',worldId:c.worldId,conversationId:c.id,role:'user',senderType:'user',senderId:mocks.store.snapshot.identities[0].id,content:'合成问题',createdAt:2000,revision:1,status:'complete',turnId:'waiting-turn',batchId:'waiting-turn'})
    mocks.store.snapshot.tasks.push({conversationId:c.id,state:'pending',deferredReply:{sourceMessageId:'waiting-source'}})
    const w=mount(KanataConversationView,{props:{conversationId:c.id}})
    await button(w,'立即回复最近一轮').trigger('click');await flushPromises()
    expect(mocks.runtime.send).toHaveBeenCalledWith(c.id,expect.objectContaining({retryMessageId:'waiting-source',delayMs:0,timing:'immediate'}))
    expect(mocks.store.snapshot.messages).toHaveLength(1);w.unmount()
  })
  it('no key makes no chargeable call, no invented greetings',()=>{
    mocks.settings.aiApiKey='';const w=mount(KanataConversationView,{props:{conversationId:mocks.store.snapshot.conversations[0].id}})
    expect(button(w,'发送消息').attributes('disabled')).toBeDefined();expect(w.findAll('.kanata-chat-message')).toHaveLength(0)
    expect(mocks.runtime.send).not.toHaveBeenCalled();w.unmount()
  })
  it('rapid short submissions combine in one paid send',async()=>{
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    await w.find('textarea').setValue('第一句');await w.find('form').trigger('submit')
    await w.find('textarea').setValue('第二句');await w.find('form').trigger('submit')
    expect(mocks.runtime.send).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(601)
    expect(mocks.runtime.send).toHaveBeenCalledTimes(1);expect(mocks.runtime.send).toHaveBeenCalledWith(c.id,expect.objectContaining({text:'第一句\n第二句'}));w.unmount()
  })
  it('unmount cancels queued inputs, active requests and runtime watch',async()=>{
    const w=mount(KanataConversationView,{props:{conversationId:mocks.store.snapshot.conversations[0].id}})
    await w.find('textarea').setValue('尚未发送');await w.find('form').trigger('submit');w.unmount()
    await vi.advanceTimersByTimeAsync(1000);expect(mocks.runtime.send).not.toHaveBeenCalled();expect(mocks.runtime.dispose).toHaveBeenCalledOnce();expect(mocks.runtime.cancel).toHaveBeenCalled()
  })
  it('failed request keeps source UI and explains retry without claiming success',async()=>{
    mocks.runtime.send.mockRejectedValueOnce(Object.assign(Error('TIMEOUT'),{code:'TIMEOUT'}))
    const w=mount(KanataConversationView,{props:{conversationId:mocks.store.snapshot.conversations[0].id}})
    await w.find('textarea').setValue('合成消息');await w.find('form').trigger('submit');await vi.advanceTimersByTimeAsync(601)
    expect(w.find('[role="alert"]').text()).toContain('请求超时');expect(w.find('.kanata-preview-message').exists()).toBe(false);w.unmount()
  })
  it('cancelled or late mode dialog cannot mutate an unmounted conversation',async()=>{
    let finish;mocks.choose.mockImplementation(()=>new Promise(r=>{finish=r}))
    const w=mount(KanataConversationView,{props:{conversationId:mocks.store.snapshot.conversations[0].id}})
    await button(w,'对话模式：日常聊天').trigger('click');w.unmount();finish('roleplay');await flushPromises()
    expect(mocks.runtime.setMode).not.toHaveBeenCalled()
  })
  it('saved batch stays intact while bubbles reveal in order, and show-all never sends another request',async()=>{
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    appendBubbles(c);await flushPromises()
    expect(mocks.store.snapshot.messages).toHaveLength(3)
    expect(w.findAll('.kanata-chat-message')).toHaveLength(1)
    expect(w.find('[role="status"]').text()).toContain('正在输入')
    await vi.advanceTimersByTimeAsync(650)
    expect(w.findAll('.kanata-chat-message')).toHaveLength(2)
    await button(w,'立即显示全部回复').trigger('click')
    expect(w.findAll('.kanata-chat-message')).toHaveLength(3)
    expect(mocks.runtime.send).not.toHaveBeenCalled()
    expect(mocks.store.snapshot.messages.every(m=>m.batchId==='one-batch'&&m.revision===1)).toBe(true)
    w.unmount();expect(vi.getTimerCount()).toBe(0)
  })
  it('existing saved history and reduced-motion replies appear immediately',async()=>{
    const c=mocks.store.snapshot.conversations[0]
    appendBubbles(c)
    const remove=vi.fn(),add=vi.fn()
    vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:add,removeEventListener:remove}))
    const w=mount(KanataConversationView,{props:{conversationId:c.id}})
    expect(w.findAll('.kanata-chat-message')).toHaveLength(3)
    mocks.store.snapshot.messages.push({...mocks.store.snapshot.messages[0],id:'later',createdAt:3000})
    await flushPromises();expect(w.findAll('.kanata-chat-message')).toHaveLength(4)
    expect(button(w,'立即显示全部回复')).toBeUndefined()
    w.unmount();expect(remove).toHaveBeenCalledWith('change',expect.any(Function))
  })
  it('background and unmount clear presentation queues without modifying durable replies',async()=>{
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    appendBubbles(c);await flushPromises()
    vi.spyOn(document,'hidden','get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'));await flushPromises()
    expect(w.findAll('.kanata-chat-message')).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0);expect(mocks.store.snapshot.messages).toHaveLength(3)
    w.unmount();await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.runtime.send).not.toHaveBeenCalled()
  })
  it('a hidden reply invalidated by source revision becomes visible as stopped immediately',async()=>{
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    appendBubbles(c);await flushPromises()
    mocks.store.snapshot.messages[1].status='stopped';mocks.store.snapshot.messages[1].revision=2
    await flushPromises()
    expect(w.text()).toContain('来源修订后已停用')
    expect(mocks.store.snapshot.messages).toHaveLength(3)
    w.unmount();expect(vi.getTimerCount()).toBe(0)
  })
  it('P7 group limits are available without a key; invalid fields link errors and focus before saving',async()=>{
    mocks.settings.aiApiKey=''
    const c=mocks.store.snapshot.conversations.find(c=>c.type==='group'),w=mount(KanataConversationView,{props:{conversationId:c.id},attachTo:document.body})
    await button(w,'群聊回复限制').trigger('click')
    const form=w.get('form[aria-label="群聊回复限制"]'),fields=form.findAll('input')
    await fields[0].setValue('3');await fields[1].setValue('2');await form.trigger('submit')
    expect(mocks.runtime.setGroupLimits).not.toHaveBeenCalled()
    expect(fields[1].attributes('aria-invalid')).toBe('true');expect(document.activeElement).toBe(fields[1].element)
    expect(form.text()).toContain('不少于参与角色上限')
    await fields[1].setValue('4');await form.trigger('submit');await flushPromises()
    expect(mocks.runtime.setGroupLimits).toHaveBeenCalledWith(c.id,c.revision,{maxSpeakers:3,maxMessages:4})
    expect(w.find('form[aria-label="群聊回复限制"]').exists()).toBe(false)
    expect(mocks.runtime.send).not.toHaveBeenCalled();w.unmount()
  })
  it('P7 stale group settings show an actionable error and retain the draft; cancel does not write',async()=>{
    mocks.runtime.setGroupLimits.mockRejectedValueOnce({code:'STALE_GROUP_LIMITS'})
    const c=mocks.store.snapshot.conversations.find(c=>c.type==='group'),w=mount(KanataConversationView,{props:{conversationId:c.id}})
    await button(w,'群聊回复限制').trigger('click')
    const form=w.get('form[aria-label="群聊回复限制"]');await form.findAll('input')[0].setValue('3')
    await form.trigger('submit');await flushPromises()
    expect(form.text()).toContain('关闭表单后重新打开');expect(form.findAll('input')[0].element.value).toBe('3')
    await button(w,'取消群聊配置').trigger('click');expect(mocks.runtime.setGroupLimits).toHaveBeenCalledTimes(1)
    expect(w.find('form[aria-label="群聊回复限制"]').exists()).toBe(false);w.unmount()
  })
  it('P7 private conversations expose no group policy editor',()=>{
    const c=mocks.store.snapshot.conversations[0],w=mount(KanataConversationView,{props:{conversationId:c.id}})
    expect(button(w,'群聊回复限制')).toBeUndefined();w.unmount()
  })
})
