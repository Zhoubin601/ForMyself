import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {defineComponent,h,KeepAlive,nextTick,ref} from 'vue'
import {mount,flushPromises} from '@vue/test-utils'
const state=vi.hoisted(()=>({model:null}))
vi.mock('../src/application/kanataLifeCompanion.js',async original=>{
  const real=await original()
  return{...real,createKanataLifeCompanion:adapters=>adapters?.store?real.createKanataLifeCompanion(adapters):real.createKanataLifeCompanion({...state.model.adapters,readers:state.model.readers,onRelease:adapters?.onRelease})}
})
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import {useKanataLifeCompanion} from '../src/composables/useKanataLifeCompanion.js'
import {restoreState} from '../src/platform/storage/restoreState.js'
let port,show,wrapper
const view=defineComponent({name:'SyntheticLifeCachedPage',setup(){port=useKanataLifeCompanion('mood');return()=>h('p',port.text.value)}})
beforeEach(async()=>{
  setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false});state.model=await experienceFixture()
  await state.model.runtime.setBinding('global',state.model.binding);await state.model.grant()
  show=ref(true);wrapper=mount(defineComponent({setup:()=>()=>h(KeepAlive,null,{default:()=>show.value?h(view):h('div','ordinary other page')})}))
})
describe('P5 cached ordinary page private lifecycle',()=>{
  it('deactivation clears role plaintext and prevents inactive background generation',async()=>{
    await port.request('合成任务',true);expect(port.text.value).toContain('合成角色回应')
    show.value=false;await nextTick();expect(port.text.value).toBe('')
    expect(await port.request('隐藏页面不应调用',true)).toBe('');expect(state.model.completion).toHaveBeenCalledTimes(1)
    wrapper.unmount();state.model.dispose()
  })
  it('a delayed result from the old activation cannot fill a reactivated page',async()=>{
    let resolveOld,started;const ready=new Promise(r=>{started=r})
    state.model.completion.mockImplementationOnce(async()=>{started();return new Promise(r=>{resolveOld=r})})
    const old=port.request('旧页面合成任务',true);await ready;show.value=false;await nextTick();show.value=true;await nextTick()
    expect(port.busy.value).toBe(false)
    resolveOld({content:'旧激活的迟到明文'});await old;await flushPromises()
    expect(port.text.value).toBe('');expect(port.error.value).toBe('')
    await port.request('新激活合成任务',true);expect(port.text.value).toContain('合成角色回应')
    wrapper.unmount();state.model.dispose()
  })
  it('session expiry clears a successful response even when the ordinary page stays visible',async()=>{
    await port.request('合成任务',true);state.model.auth.sessionRevision++;await nextTick()
    expect(port.text.value).toBe('');expect(port.speaker.value).toBe('')
    wrapper.unmount();state.model.dispose()
  })
})
