import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import KanataCandidateGroupEditor from '../src/features/chat/KanataCandidateGroupEditor.vue'
import { resolveFeedbackDialog, uiFeedbackState } from '../src/services/uiFeedback.js'

let wrapper
afterEach(() => { wrapper?.unmount(); wrapper=null; resolveFeedbackDialog(null) })
const entries=['a','b','c'].map(id=>({id,title:id.toUpperCase()}))
async function setup(hasHistory){
  const model={
    list:vi.fn(async()=>({entries,cursor:null})),
    groupEdit:vi.fn(async()=>({title:'原群',revision:1,hasHistory})),
    groupMemberPage:vi.fn(async()=>({entries:entries.slice(0,2),cursor:null})),
    editGroupMembers:vi.fn(async(_id,input)=>({id:input.expectedHistory?input.newGroupId:'prior',created:input.expectedHistory})),
  }
  wrapper=mount(KanataCandidateGroupEditor,{props:{model,editId:'prior'}})
  await flushPromises()
  await wrapper.get('[data-actor-id=b]').setValue(false)
  await wrapper.get('[data-actor-id=c]').setValue(true)
  return model
}
const submit=async()=>{await wrapper.get('form').trigger('submit');await flushPromises()}

it('GROUP-01 edits the empty group in place with explicit revision and ordered selection',async()=>{
  const model=await setup(false)
  await submit()
  expect(model.editGroupMembers).toHaveBeenCalledWith('prior',expect.objectContaining({
    instanceIds:['a','c'],expectedHistory:false,expectedRevision:1,
  }),expect.any(Function))
  expect(wrapper.emitted('saved')).toEqual([['prior',true,false]])
})

it('GROUP-02/05 confirms the new empty group and never submits on cancel',async()=>{
  const model=await setup(false)
  model.editGroupMembers.mockRejectedValueOnce(Object.assign(Error('changed'),{code:'KANATA_GROUP_HISTORY_CHANGED'}))
  await submit()
  expect(uiFeedbackState.dialog.message).toContain('原群的成员、聊天和引用保持不变')
  expect(model.editGroupMembers).toHaveBeenCalledTimes(1)
  resolveFeedbackDialog(false)
  await flushPromises()
  expect(wrapper.emitted('saved')).toBeUndefined()
  await submit()
  expect(model.editGroupMembers).toHaveBeenCalledTimes(1)
  resolveFeedbackDialog(true)
  await flushPromises()
  const [,first]=model.editGroupMembers.mock.calls[0]
  const [,confirmed]=model.editGroupMembers.mock.calls[1]
  expect(confirmed).toEqual({...first,expectedHistory:true})
  expect(wrapper.emitted('saved')).toEqual([[first.newGroupId,true,true]])
})

it('GROUP-05 closes an outstanding confirmation on unmount and rejects a late answer',async()=>{
  const model=await setup(true)
  await submit()
  expect(uiFeedbackState.dialog.open).toBe(true)
  wrapper.unmount()
  wrapper=null
  resolveFeedbackDialog(true)
  await flushPromises()
  expect(model.editGroupMembers).not.toHaveBeenCalled()
  expect(uiFeedbackState.dialog.open).toBe(false)
})
