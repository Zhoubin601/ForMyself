import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
const state=vi.hoisted(()=>({f:null,world:null,social:null}))
vi.mock('../src/features/chat/kanataStore.js',async original=>({...await original(),useKanataStore:()=>state.f.store}))
vi.mock('../src/application/kanataWorldRuntime.js',async original=>{const real=await original();return{...real,createKanataWorldRuntime:adapters=>adapters?real.createKanataWorldRuntime(adapters):state.world}})
vi.mock('../src/application/kanataSocialRuntime.js',async original=>{const real=await original();return{...real,createKanataSocialRuntime:adapters=>adapters?real.createKanataSocialRuntime(adapters):state.social}})
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {createKanataWorldRuntime} from '../src/application/kanataWorldRuntime.js'
import {createKanataSocialRuntime} from '../src/application/kanataSocialRuntime.js'
import KanataActivityPanel from '../src/features/chat/autonomy/KanataActivityPanel.vue'
let wrapper
const click=async text=>{const button=wrapper.findAll('button').find(b=>b.text()===text);if(button.element.type==='submit')await wrapper.findAll('form').find(f=>f.element===button.element.form).trigger('submit');else await button.trigger('click');await flushPromises()}
beforeEach(async()=>{setActivePinia(createPinia());state.f=await experienceFixture();state.world=createKanataWorldRuntime(state.f.adapters);state.social=createKanataSocialRuntime(state.f.adapters);wrapper=mount(KanataActivityPanel,{props:{worldId:state.f.binding.worldId}})})
afterEach(()=>{wrapper.unmount();state.f.dispose()})
describe('P6 activity management with actual runtime',()=>{
  it('independently saves world switches without requesting a model',async()=>{
    const boxes=wrapper.find('fieldset').findAll('input');await boxes[2].setValue(true)
    await click('保存世界开关')
    expect(state.f.store.snapshot.worlds[0].notificationsEnabled).toBe(true)
    expect(state.f.store.snapshot.worlds[0].autonomyEnabled).toBe(false)
    expect(state.f.store.snapshot.worlds[0].proactiveEnabled).toBe(false)
    expect(state.f.completion).not.toHaveBeenCalled()
  })
  it('normal view conceals NPC history and god view is read-only user management',async()=>{
    await state.f.store.update(d=>{d.events.push({id:'private-scene-event',worldId:state.f.binding.worldId,participantIds:d.instances.slice(0,2).map(i=>i.id),sourceRefs:[],causedByEventIds:[],status:'committed',visibility:'participants',summary:'SYNTHETIC_PRIVATE_EVENT_84',effectiveAt:1000,recordedAt:1000,revision:1})})
    await flushPromises();expect(wrapper.text()).not.toContain('SYNTHETIC_PRIVATE_EVENT_84')
    await click('上帝视角');expect(wrapper.text()).toContain('SYNTHETIC_PRIVATE_EVENT_84')
    await click('普通视角');expect(wrapper.text()).not.toContain('SYNTHETIC_PRIVATE_EVENT_84')
    expect(state.f.completion).not.toHaveBeenCalled()
  })
  it('invalid daily cap is rejected by the runtime and the last stored policy survives',async()=>{
    const input=wrapper.find('input[type="number"]');await input.setValue(100)
    await click('保存角色与日程')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(state.f.disk().autonomyPolicies).toBeUndefined()
  })
})
