import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {restoreState} from '../src/platform/storage/restoreState.js'
const state=vi.hoisted(()=>({model:null,choose:vi.fn(),confirm:vi.fn(),prompt:vi.fn(),cancel:vi.fn()}))
vi.mock('../src/features/chat/kanataStore.js',async original=>({...await original(),useKanataStore:()=>state.model.store}))
vi.mock('../src/application/kanataExperienceRuntime.js',async original=>{const real=await original();return{...real,createKanataExperienceRuntime:adapters=>adapters?real.createKanataExperienceRuntime(adapters):state.model.runtime}})
vi.mock('../src/services/uiFeedback.js',()=>({appChoose:(...args)=>state.choose(...args),appConfirm:(...args)=>state.confirm(...args),appPrompt:(...args)=>state.prompt(...args),cancelOwnedFeedbackDialog:(...args)=>state.cancel(...args)}))
import {experienceFixture} from './helpers/kanataExperienceFixture.js'
import KanataExperiencePanel from '../src/features/chat/experience/KanataExperiencePanel.vue'
let wrapper
const button=text=>wrapper.findAll('button').find(b=>b.text()===text)
const click=async text=>{const target=button(text);if(target.element.type==='submit')await wrapper.findAll('form').find(form=>form.element===target.element.form).trigger('submit');else await target.trigger('click');await flushPromises()}
beforeEach(async()=>{setActivePinia(createPinia());Object.assign(restoreState,{blocked:false,busy:false});state.model=await experienceFixture();state.choose.mockReset();state.confirm.mockReset();state.prompt.mockReset();state.cancel.mockReset();state.choose.mockResolvedValue(null);state.confirm.mockResolvedValue(false);wrapper=mount(KanataExperiencePanel,{props:{worldId:state.model.binding.worldId}})})
afterEach(()=>{wrapper.unmount();state.model.dispose()})
describe('P5 management views with actual Store and runtime',()=>{
  it('creates a candidate and explicitly adopts it without fake history or AI calls',async()=>{
    await click('新建记忆');await wrapper.find('input[maxlength="200"]').setValue('合成主题');await wrapper.find('textarea[maxlength="4000"]').setValue('这是用户明确填写的合成内容')
    await click('保存记忆');expect(state.model.store.snapshot.memories[0].status).toBe('candidate')
    await click('核对并采用');expect(state.model.store.snapshot.memories[0].status).toBe('active')
    expect(state.model.store.snapshot.messages).toHaveLength(0);expect(state.model.completion).not.toHaveBeenCalled()
  })
  it('extracts real candidates, shows source versions and retains old text after source correction',async()=>{
    const message=await state.model.addUser('记住这条合成偏好')
    state.choose.mockResolvedValueOnce(state.model.data.conversations[0].id);await click('提取候选记忆')
    expect(wrapper.text()).toContain('合成候选偏好');expect(wrapper.text()).toContain('记住这条合成偏好')
    await state.model.runtime.reviseMessage(message.id,1,{content:'修正后的合成来源',deleted:false});await flushPromises()
    expect(wrapper.text()).toContain('来源已修订');expect(wrapper.text()).toContain('记住这条合成偏好')
    expect(state.model.store.snapshot.messageAudits[0].previous.content).toBe('记住这条合成偏好')
  })
  it('summary parse failure is visible and never discards L0',async()=>{
    await state.model.addUser();state.model.completion.mockResolvedValueOnce({content:'bad-json'})
    state.choose.mockResolvedValueOnce(state.model.data.conversations[0].id);await click('提取候选记忆')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);expect(state.model.store.snapshot.messages).toHaveLength(1);expect(wrapper.text()).toContain('INVALID_MEMORY_RESPONSE')
  })
  it('permission checkboxes stay independent and binding uses an exact instance',async()=>{
    await click('生活联动')
    const todo=wrapper.findAll('.kanata-experience-card').find(a=>a.find('h4').text()==='待办')
    await todo.findAll('input[type="checkbox"]')[0].setValue(true)
    await click('保存待办授权');const grant=state.model.store.snapshot.lifeGrants[0]
    expect([grant.read,grant.remember,grant.share]).toEqual([true,false,false])
    state.choose.mockResolvedValueOnce(JSON.stringify(state.model.binding));await click('选择待办角色')
    expect(state.model.store.snapshot.roleBindings.modules.todo).toEqual(state.model.binding)
    await state.model.store.update(d=>{d.roleBindings.modules.todo.instanceId='missing-role'});await flushPromises()
    expect(wrapper.text()).toContain('已绑定实例不可用，请重新选择')
  })
  it('event remains a candidate until confirmation, and rollback restores rule-based mood',async()=>{
    await click('世界事件');await click('提议世界事件');await wrapper.find('textarea').setValue('合成角色休息')
    state.choose.mockResolvedValueOnce('rest');await click('事件类型：note');await click('保存候选事件')
    expect(state.model.store.snapshot.instances[0].state.mood).toBe('平静')
    state.confirm.mockResolvedValueOnce(true);await click('核对并确认事件')
    expect(state.model.store.snapshot.instances[0].state.mood).toBe('放松')
    state.confirm.mockResolvedValueOnce(true);await click('预览撤销影响')
    expect(state.model.store.snapshot.instances[0].state.mood).toBe('平静');expect(wrapper.text()).toContain('revoked')
  })
  it('explicit memory removal deletes its body but explains the retained source',async()=>{
    await click('新建记忆');await wrapper.find('input[maxlength="200"]').setValue('合成主题');await wrapper.find('textarea').setValue('将删除的合成正文');await click('保存记忆')
    state.confirm.mockResolvedValueOnce(false);await click('删除记忆正文');expect(state.model.store.snapshot.memories[0].content).toBe('将删除的合成正文')
    state.confirm.mockResolvedValueOnce(true);await click('删除记忆正文');expect(state.model.store.snapshot.memories[0].status).toBe('deleted');expect(wrapper.text()).not.toContain('将删除的合成正文')
    expect(state.confirm).toHaveBeenLastCalledWith(expect.stringContaining('来源聊天'),expect.objectContaining({sensitive:true}))
  })
})
