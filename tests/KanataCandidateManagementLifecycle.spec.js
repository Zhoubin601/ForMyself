import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import KanataCandidateMemoryDetail from '../src/features/chat/KanataCandidateMemoryDetail.vue'
import KanataCandidateEventLedger from '../src/features/chat/KanataCandidateEventLedger.vue'
import { resolveFeedbackDialog, uiFeedbackState } from '../src/services/uiFeedback.js'

let wrapper
afterEach(() => { wrapper?.unmount(); wrapper=null; resolveFeedbackDialog(null) })
const click=async label=>{
  await wrapper.findAll('button').find(button=>button.text()===label).trigger('click')
  await flushPromises()
}

it('does not read sources or publish a delayed memory body after the role changes',async()=>{
  const {promise,resolve}=Promise.withResolvers()
  const model={
    list:async()=>({entries:[{id:'a',title:'甲'},{id:'b',title:'乙'}],cursor:null}),
    memoryDetail:vi.fn(async(_id,actor)=>actor==='a'?promise:{content:'乙可见',key:'乙',layer:'L3'}),
    memorySources:vi.fn(async()=>({entries:[],cursor:null})),
  }
  wrapper=mount(KanataCandidateMemoryDetail,{props:{model,memoryId:'memory'}})
  await flushPromises()
  await click('甲')
  await click('乙')
  expect(wrapper.text()).toContain('乙可见')
  resolve({content:'甲不可保留'})
  await flushPromises()
  expect(wrapper.text()).not.toContain('甲不可保留')
  expect(model.memorySources.mock.calls.map(call=>call[1])).toEqual(['b'])
})

it('cancels an event revocation confirmation when the candidate ledger unmounts',async()=>{
  const model={
    eventDetail:async()=>({id:'event',status:'committed',revision:1,summary:'合成事件'}),
    openRevocation:async()=>({plan:{revokeCount:1,uncertainCount:0},entries:[],cursor:null}),
    confirmRevocation:vi.fn(),
  }
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('预览撤销')
  await click('确认撤销范围')
  expect(uiFeedbackState.dialog.open).toBe(true)
  wrapper.unmount()
  wrapper=null
  resolveFeedbackDialog(true)
  await flushPromises()
  expect(model.confirmRevocation).not.toHaveBeenCalled()
  expect(uiFeedbackState.dialog.open).toBe(false)
})
