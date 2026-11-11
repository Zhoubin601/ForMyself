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

it('closing a revocation preview invalidates an in-flight next page and its guard',async()=>{
  const pending=Promise.withResolvers()
  let pageGuard
  const model={
    eventDetail:async()=>({id:'event',status:'committed',revision:1,summary:'合成事件'}),
    openRevocation:vi.fn(async(_id,cursor,guard)=>{
      if(cursor){pageGuard=guard;return pending.promise}
      return {plan:{revokeCount:60,uncertainCount:0},entries:[],cursor:{after:'page-1'}}
    }),
  }
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('预览撤销')
  await click('下一页撤销范围')
  await click('关闭撤销预览')
  expect(()=>pageGuard()).toThrow(/EXPIRED/)
  pending.resolve({plan:{revokeCount:60,uncertainCount:0},entries:[{id:'late'}],cursor:null})
  await flushPromises()
  expect(wrapper.find('[aria-label="撤销范围"]').exists()).toBe(false)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.findAll('button').find(button=>button.text()==='预览撤销').attributes('disabled')).toBeUndefined()
})

it('closing the event choice panel invalidates an in-flight next page',async()=>{
  const pending=Promise.withResolvers()
  let pageGuard
  const model={worldId:'world',list:vi.fn(async(_kind,cursor,guard)=>{
    if(cursor){pageGuard=guard;return pending.promise}
    return {entries:[],cursor:'page-1'}
  })}
  wrapper=mount(KanataCandidateEventLedger,{props:{model}})
  await click('选择事件角色')
  await click('载入下一页资料')
  await click('关闭选择')
  expect(()=>pageGuard()).toThrow(/EXPIRED/)
  pending.resolve({entries:[{id:'late',title:'迟到资料'}],cursor:null})
  await flushPromises()
  expect(wrapper.find('[aria-label="选择事件资料"]').exists()).toBe(false)
})

it.each(['audit','effectAudit'])('closing %s cancels its pending page without cancelling a new request',async panel=>{
  const pending=Promise.withResolvers()
  let pageGuard
  const model={
    eventDetail:async()=>({id:'event',status:'revoked',revision:2,summary:'合成事件'}),
    revocationAudits:vi.fn(async(_id,cursor,guard)=>{
      if(panel==='audit'&&cursor){pageGuard=guard;return pending.promise}
      return {entries:[{id:'audit',previousRevision:1,nextRevision:2,effectCount:60}],cursor:'audit-page'}
    }),
    revocationEffectAudit:vi.fn(async(_id,_auditId,cursor,guard)=>{
      if(cursor){pageGuard=guard;return pending.promise}
      return {complete:true,total:60,entries:[],cursor:{after:'effect-page'}}
    }),
  }
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('查看撤销审计')
  if(panel==='effectAudit'){
    await click('查看逐项影响')
    await click('下一页逐项影响')
    await click('关闭逐项影响')
  }else{
    await click('下一页审计')
    await click('关闭撤销审计')
  }
  expect(()=>pageGuard()).toThrow(/EXPIRED/)
  // A cancelled request may settle after its replacement. It must not reset busy
  // or republish its previous panel into the replacement's state.
  await click('查看撤销审计')
  pending.resolve({entries:[{id:'late'}],cursor:null})
  await flushPromises()
  expect(wrapper.text()).not.toContain('late')
  expect(wrapper.find('[aria-label="逐项影响审计"]').exists()).toBe(false)
})

it('a successful revocation releases the old hidden Effect audit page',async()=>{
  let revoked=false
  const model={
    eventDetail:async()=>({id:'event',status:revoked?'revoked':'committed',revision:revoked?2:1,summary:'合成事件'}),
    revocationAudits:async()=>({entries:[{id:'audit',effectCount:1}],cursor:null}),
    revocationEffectAudit:async()=>({complete:true,total:1,entries:[{id:'effect',value:'旧审计正文'}],cursor:null}),
    openRevocation:async()=>({plan:{revokeCount:1,uncertainCount:0},entries:[],cursor:null}),
    confirmRevocation:async()=>{revoked=true},
  }
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('查看撤销审计')
  await click('查看逐项影响')
  expect(wrapper.vm.$.setupState.effectAudit.entries).toHaveLength(1)
  await click('预览撤销')
  await click('确认撤销范围')
  resolveFeedbackDialog(true)
  await flushPromises()
  // Inspect actual local state: merely hiding the audit section does not prove
  // that its Effect DTOs have been released.
  expect(wrapper.vm.$.setupState.effectAudit).toBe(null)
  expect(wrapper.vm.$.setupState.audits).toBe(null)
})
