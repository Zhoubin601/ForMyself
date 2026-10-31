import {describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {reactive} from 'vue'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {createKanataGroup,copyKanataWorld} from '../src/features/chat/domain/kanataManagementCore.js'
import KanataGroupCreator from '../src/features/chat/KanataGroupCreator.vue'
const click=(w,text)=>w.findAll('button').find(b=>b.text()===text).trigger('click')
const setup=()=>{
  const data=reactive(archiveData(0)),management={createGroup:vi.fn(async(worldId,fields)=>{
    const next=createKanataGroup(data,worldId,fields,{key:'component-group',now:2000,timeZone:'Asia/Shanghai',idFactory:()=> 'group-from-component'})
    Object.assign(data,next);return next
  })}
  const w=mount(KanataGroupCreator,{props:{data,worldId:data.worlds[0].id,management},attachTo:document.body})
  return{w,data,management}
}
describe('P7 new group creation in the current world',()=>{
  it('invalid selection is explained and focused; valid creation is empty and returns its real ID',async()=>{
    const {w,data,management}=setup();await click(w,'创建群聊')
    const form=w.get('form');await form.trigger('submit')
    expect(management.createGroup).not.toHaveBeenCalled();expect(form.text()).toContain('至少两名本世界角色')
    expect(document.activeElement).toBe(form.find('fieldset').element)
    const boxes=form.findAll('input[type="checkbox"]');await boxes[0].setValue(true);await boxes[1].setValue(true)
    await form.find('input[type="text"],input:not([type])').setValue('合成新群')
    await form.trigger('submit');await flushPromises()
    expect(w.emitted('created')).toEqual([['group-from-component']]);expect(data.conversations.at(-1).participantIds).toHaveLength(3)
    expect(data.messages).toHaveLength(0);w.unmount()
  })
  it('only current-world roles appear, cancellation does not write and blocked state prevents creation',async()=>{
    const {w,data,management}=setup();let sequence=0
    Object.assign(data,copyKanataWorld(data,data.worlds[0].id,'其他世界',{key:'other',now:2000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-other-'+(++sequence)}))
    await click(w,'创建群聊');expect(w.findAll('input[type="checkbox"]')).toHaveLength(5)
    await click(w,'取消创建群聊');expect(management.createGroup).not.toHaveBeenCalled()
    await w.setProps({blocked:true});expect(w.find('button').attributes('disabled')).toBeDefined();w.unmount()
  })
  it('a persisted draft failure closes duplicate submission and points to the actual global save retry',async()=>{
    const {w,management}=setup(),save=management.createGroup.getMockImplementation()
    management.createGroup.mockImplementationOnce(async(...args)=>{await save(...args);throw Error('synthetic save failure')})
    await click(w,'创建群聊');const form=w.get('form'),boxes=form.findAll('input[type="checkbox"]')
    await boxes[0].setValue(true);await boxes[1].setValue(true);await form.trigger('submit');await flushPromises()
    expect(w.find('form').exists()).toBe(false);expect(w.emitted('created')).toBeUndefined()
    expect(w.emitted('message')[0][0]).toContain('重试保存');expect(management.createGroup).toHaveBeenCalledTimes(1);w.unmount()
  })
  it('an error before draft creation retains selection, and late completion never opens another world view',async()=>{
    const {w,management}=setup();management.createGroup.mockRejectedValueOnce(Error('scope changed'))
    await click(w,'创建群聊');const form=w.get('form'),boxes=form.findAll('input[type="checkbox"]')
    await boxes[0].setValue(true);await boxes[1].setValue(true);await form.trigger('submit');await flushPromises()
    expect(w.get('form').text()).toContain('群聊未能创建');expect(boxes[0].element.checked).toBe(true)
    let finish;management.createGroup.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await form.trigger('submit');w.unmount();finish({conversations:[{id:'late',worldId:'other',type:'group'}]});await flushPromises()
    expect(w.emitted('created')).toBeUndefined()
  })
})
