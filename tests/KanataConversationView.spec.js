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
  mocks.runtime={send:vi.fn(async()=>({messageId:'synthetic'})),setMode:vi.fn(async()=>{}),cancel:vi.fn(),dispose:vi.fn()};mocks.choose.mockReset()
})
afterEach(()=>vi.useRealTimers())
describe('P4 conversation interaction and lifetime',()=>{
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
})
