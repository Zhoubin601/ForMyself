import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
const appListeners = []
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event, cb) => {
      if (event === 'appStateChange') appListeners.push(cb)
      return { remove: async () => {} }
    }),
  },
}))
import KanataCandidateMemoryDetail from '../src/features/chat/KanataCandidateMemoryDetail.vue'
import KanataCandidateEventLedger from '../src/features/chat/KanataCandidateEventLedger.vue'
import KanataCandidateWorkspace from '../src/features/chat/KanataCandidateWorkspace.vue'
import KanataCandidateLoreEditor from '../src/features/chat/KanataCandidateLoreEditor.vue'
import KanataCandidateActivityPanel from '../src/features/chat/autonomy/KanataCandidateActivityPanel.vue'
import KanataCandidateCardLibrary from '../src/features/chat/cards/KanataCandidateCardLibrary.vue'
import KanataLifeCompanion from '../src/components/KanataLifeCompanion.vue'
import { createKanataSqliteCandidate } from '../src/application/kanataSqliteCandidate.js'
import { resetNativeActivityGuard, withNativeActivityGuard } from '../src/services/nativeActivityGuard.js'
import { resolveFeedbackDialog, uiFeedbackState } from '../src/services/uiFeedback.js'
import { dispatchBackAction, resetBackHandlersForTests } from '../src/services/backNavigation.js'

let wrapper
afterEach(() => { wrapper?.unmount(); wrapper=null; resolveFeedbackDialog(null); resetBackHandlersForTests() })
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

it.each(['detail','audit','unmount'])('closing %s releases a long Effect audit fragment and rejects its late page',async panel=>{
  const pending=Promise.withResolvers()
  let lateGuard
  const model={eventDetail:async()=>({id:'event',status:'revoked',revision:2,summary:'合成事件'}),
    revocationAudits:async()=>({entries:[{id:'audit',effectCount:1}],cursor:null}),
    revocationEffectAudit:async()=>({complete:true,total:1,entries:[{id:'effect',valueChunked:true}],cursor:null}),
    revocationEffectAuditChunk:async(_id,_auditId,_effectId,_field,cursor,guard)=>{
      if(cursor){lateGuard=guard;return pending.promise}
      return {part:'第一段',cursor:{offset:4096}}
    }}
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('查看撤销审计');await click('查看逐项影响');await click('查看影响值')
  const state=wrapper.vm.$.setupState
  expect(state.effectPart.part).toBe('第一段')
  await click('下一段')
  if(panel==='unmount'){wrapper.unmount();wrapper=null}
  else await click(panel==='detail'?'关闭影响详情':'关闭逐项影响')
  expect(()=>lateGuard()).toThrow(/EXPIRED/)
  expect(state.effectPart).toBe(null)
  pending.resolve({part:'迟到明文',cursor:null});await flushPromises()
  expect(state.effectPart).toBe(null)
})

it('replaces the displayed Effect fragment instead of accumulating earlier parts',async()=>{
  const model={eventDetail:async()=>({id:'event',status:'revoked',revision:2,summary:'合成事件'}),
    revocationAudits:async()=>({entries:[{id:'audit',effectCount:1}],cursor:null}),
    revocationEffectAudit:async()=>({complete:true,total:1,entries:[{id:'effect',pathChunked:true}],cursor:null}),
    revocationEffectAuditChunk:async(_id,_auditId,_effectId,_field,cursor)=>cursor
      ?{part:'B'.repeat(4096),cursor:null}:{part:'A'.repeat(4096),cursor:{offset:4096}}}
  wrapper=mount(KanataCandidateEventLedger,{props:{model,eventId:'event'}})
  await flushPromises()
  await click('查看撤销审计');await click('查看逐项影响');await click('查看路径');await click('下一段')
  expect(wrapper.vm.$.setupState.effectPart.part).toBe('B'.repeat(4096))
  expect(wrapper.find('pre').text()).not.toContain('A')
})

it('MR3 A/B workspace copies worlds, adds characters, edits overrides and rejects late requests on switch',async()=>{
  const copyDeferred=Promise.withResolvers()
  const detailDeferred=Promise.withResolvers()
  let copyGuard
  const owner={
    read:async()=>({world:{name:'原世界',rules:'',timeZone:'UTC',defaultChatMode:'daily',revision:1},identity:{displayName:'旅人',background:'',revision:1}}),
    overview:async()=>({id:'w1',title:'原世界',archived:false,revision:1}),
    list:async section=>section==='actors'?{entries:[{id:'inst1',title:'白子'}],cursor:null}:{entries:[],cursor:null},
    grants:async()=>[],
    availableCards:async()=>({entries:[{id:'c1',name:'全局白子',archived:false}],cursor:null}),
    addCharacter:vi.fn(async()=>({id:'inst2'})),
    instanceDetail:vi.fn(async(_id,guard)=>{copyGuard=guard;return detailDeferred.promise}),
    updateInstance:vi.fn(async()=>({})),
    previewCardLore:async()=>[{key:'0',keys:['k'],content:'设定',conflictId:'existing'}],
    attachCardLore:vi.fn(async()=>({created:['l1']})),
  }
  const worlds={
    listWorlds:async()=>({entries:[{id:'w1',title:'原世界',archived:false,revision:1}],cursor:null}),
    copyWorld:vi.fn(async(_id,_name,_opts,guard)=>{copyGuard=guard;return copyDeferred.promise}),
    select:()=>owner,
    clearSelection:vi.fn(),
    dispose:vi.fn(),
  }
  const lifecycle={generation:{value:0},isAvailable:()=>true,release:async()=>{}}
  wrapper=mount(KanataCandidateWorkspace,{props:{worlds,lifecycle,createChat:()=>({})}})
  await flushPromises()
  await click('原世界')
  await click('复制设定')
  await wrapper.find('form[aria-label="复制世界设定"]').trigger('submit.prevent')
  expect(()=>copyGuard()).not.toThrow()
  await click('返回世界列表')
  expect(()=>copyGuard()).toThrow(/EXPIRED/)
  copyDeferred.resolve('w2')
  await flushPromises()
  expect(worlds.copyWorld).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('彼方世界')

  await click('原世界')
  await click('角色与授权')
  await click('白子')
  await click('实例设定')
  wrapper.unmount();wrapper=null
  expect(()=>copyGuard()).toThrow(/EXPIRED/)
  detailDeferred.resolve({instance:{revision:1,overrides:{}},resolved:{name:'滞后明文',summary:'s',speechStyle:'t'}})
  await flushPromises()
})

it('MR3 B card library syncs selected world instance and cleans up on close/unmount',async()=>{
  const syncDeferred=Promise.withResolvers()
  const model={
    list:async()=>({entries:[{id:'c1',name:'角色卡',archived:false,currentVersionId:'v2'}],cursor:null}),
    read:async()=>({cardId:'c1',id:'v2',currentVersionId:'v2',archived:false,revision:2,definition:{name:'角色卡',summary:'摘要',speechStyle:'平静',anchors:['锚点']}}),
    previewSync:vi.fn(async()=>({entries:[{instanceId:'i1',worldId:'w1',worldTitle:'活跃世界',fields:['summary'],retainedOverrides:['name'],fromVersionId:'v1',toVersionId:'v2',instanceRevision:1}],cursor:null})),
    sync:vi.fn(async()=>syncDeferred.promise),
    dispose:vi.fn(),
  }
  wrapper=mount(KanataCandidateCardLibrary,{props:{model}})
  await flushPromises()
  await click('角色卡')
  await click('同步世界实例')
  await click('同步 活跃世界')
  expect(uiFeedbackState.dialog.open).toBe(true)
  resolveFeedbackDialog(true)
  await flushPromises()
  expect(model.sync).toHaveBeenCalledTimes(1)
  await click('关闭卡详情')
  syncDeferred.resolve([])
  await flushPromises()
  expect(wrapper.text()).not.toContain('所选世界实例已同步')
})

it('MR5 F candidate activity panel and life companion enforce ownership, grants and cleanup',async()=>{
  const lateAdvance=Promise.withResolvers()
  const model={
    readConfig:async()=>({world:{id:'w1',revision:1,autonomyEnabled:true,proactiveEnabled:true,notificationsEnabled:false},
      policy:{worldId:'w1',revision:1,dailyDialogueLimit:2,maxCatchUpHours:6,freedom:'standard',socialChannel:'private'}}),
    actorFlagsPage:async()=>({entries:[{id:'a1',name:'白子',autonomyEnabled:true,proactiveEnabled:true}],cursor:null}),
    schedulesPage:async()=>({entries:[],cursor:null}),
    advance:vi.fn(async()=>lateAdvance.promise),
    runSocial:vi.fn(async()=>({status:'succeeded'})),
    runContact:vi.fn(async()=>({status:'not-needed'})),
    cancel:vi.fn(),
  }
  const worlds={listWorlds:async()=>({entries:[{id:'w1',title:'活跃世界',archived:false,revision:1}],cursor:null}),
    select:()=>({overview:async()=>({id:'w1',title:'活跃世界',archived:false,revision:1}),list:async()=>({entries:[],cursor:null}),grants:async()=>[]}),
    clearSelection:vi.fn(),dispose:vi.fn()}
  const autonomy={select:()=>model,cancel:vi.fn(),dispose:vi.fn()}
  wrapper=mount(KanataCandidateWorkspace,{props:{worlds,lifecycle:{generation:{value:0},isAvailable:()=>true,release:async()=>{}},createChat:()=>({}),autonomy}})
  await flushPromises()
  await click('活跃世界')
  await click('自治任务')
  await click('生成角色交流')
  expect(model.runSocial).toHaveBeenCalledTimes(1)
  await click('现在有限补算')
  wrapper.unmount();wrapper=null
  expect(autonomy.cancel).toHaveBeenCalled()
  lateAdvance.resolve({windows:1,skippedMs:0})
  await flushPromises()

  const runtime={request:vi.fn(async()=>({status:'permission-required'})),cancel:vi.fn(),dispose:vi.fn(),isCurrent:()=>true}
  wrapper=mount(KanataLifeCompanion,{props:{moduleId:'todo',candidate:{create:()=>runtime}}})
  await click('让所选角色回应')
  expect(wrapper.text()).toContain('请先给这个实例授予本模块读取权限')
  wrapper.unmount();wrapper=null
  expect(runtime.dispose).toHaveBeenCalled()
})

it('MR6 card library file picker handles cancel, oversized avatar, corrupt card and clears state on unmount',async()=>{
  const model={
    list:async()=>({entries:[{id:'c1',name:'测试卡',archived:false,currentVersionId:'v1'}],cursor:null}),
    read:async()=>({cardId:'c1',id:'v1',currentVersionId:'v1',archived:false,revision:1,definition:{name:'测试卡',summary:'s',speechStyle:'t',anchors:['a']}}),
    importCard:vi.fn(),versions:async()=>({entries:[],cursor:null}),dispose:vi.fn(),
  }
  wrapper=mount(KanataCandidateCardLibrary,{props:{model}})
  await flushPromises()
  // Cancel card chooser
  await click('导入 JSON 或 PNG 角色卡')
  const cardInput=wrapper.findAll('input[type="file"]')[0]
  await cardInput.trigger('cancel')
  await flushPromises()
  expect(wrapper.text()).not.toContain('确认导入角色卡')
  // Malicious/invalid JSON file rejected cleanly
  await click('导入 JSON 或 PNG 角色卡')
  const badBytes=new TextEncoder().encode('not json <script>alert(1)</script>')
  const badFile=Object.assign(new File([badBytes],'bad.json',{type:'application/json'}),{arrayBuffer:async()=>badBytes.buffer})
  Object.defineProperty(cardInput.element,'files',{configurable:true,value:[badFile]})
  await cardInput.trigger('change')
  await flushPromises()
  expect(wrapper.text()).toContain('角色卡操作未完成')
  expect(model.importCard).not.toHaveBeenCalled()
  // Oversized >2MB avatar rejected cleanly
  await click('测试卡')
  await click('替换自定义 PNG 头像')
  const avatarInput=wrapper.findAll('input[type="file"]')[1]
  const bigPng=Object.assign(new File([new Uint8Array(2*1024*1024+8)],'big.png',{type:'image/png'}),{arrayBuffer:async()=>new ArrayBuffer(2*1024*1024+8)})
  Object.defineProperty(avatarInput.element,'files',{configurable:true,value:[bigPng]})
  await avatarInput.trigger('change')
  await flushPromises()
  expect(wrapper.text()).toContain('角色卡操作未完成')
  // Valid JSON card imported, then unmount cleans up without retain
  await click('关闭卡详情')
  await click('导入 JSON 或 PNG 角色卡')
  const okJson=JSON.stringify({name:'合成新卡',description:'简介',mes_example:'温和',personality:'稳重'})
  const okBytes=new TextEncoder().encode(okJson)
  const okFile=Object.assign(new File([okBytes],'ok.json',{type:'application/json'}),{arrayBuffer:async()=>okBytes.buffer})
  Object.defineProperty(cardInput.element,'files',{configurable:true,value:[okFile]})
  await cardInput.trigger('change')
  await flushPromises()
  expect(wrapper.text()).toContain('确认导入角色卡')
  wrapper.unmount();wrapper=null
  expect(model.dispose).toHaveBeenCalledTimes(1)
})

it('MR6 workspace system back closes nested panels/drafts before returning to directory',async()=>{
  const worlds={
    listWorlds:async()=>({entries:[{id:'w1',title:'主世界',archived:false,revision:1}],cursor:null}),
    select:()=>({
      overview:async()=>({id:'w1',title:'主世界',archived:false,revision:1}),
      list:async section=>section==='actors'?{entries:[{id:'a1',title:'角色甲'}],cursor:null}:{entries:[],cursor:null},
      grants:async()=>[{moduleId:'todo',read:true,remember:false,share:false,revision:1}],
      readInstanceDetail:async()=>({instance:{revision:1,overrides:{}},resolved:{name:'角色甲',summary:'s',speechStyle:'t'}}),
      instanceDetail:async()=>({instance:{revision:1,overrides:{}},resolved:{name:'角色甲',summary:'s',speechStyle:'t'}}),
    }),
    openCards:()=>({list:async()=>({entries:[],cursor:null}),dispose:vi.fn()}),
    clearSelection:vi.fn(),dispose:vi.fn(),
  }
  wrapper=mount(KanataCandidateWorkspace,{props:{worlds,lifecycle:{generation:{value:0},isAvailable:()=>true,release:async()=>{}},createChat:()=>({})}})
  await flushPromises()
  // Open card editor, system back closes editor without exiting workspace
  await click('全局角色卡库')
  expect(wrapper.text()).toContain('关闭角色卡库')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('关闭角色卡库')
  // Select world -> open actors -> open instance override form -> back closes draft, then actor, then world
  await click('主世界')
  await click('角色与授权')
  await click('角色甲')
  await click('实例设定')
  expect(wrapper.text()).toContain('保存实例设定')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('保存实例设定')
  expect(wrapper.text()).toContain('生活资料授权')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('生活资料授权')
  expect(wrapper.text()).toContain('复制设定')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(worlds.clearSelection).toHaveBeenCalled()
})

it('MR8 CardLibrary applySync refreshes remaining instances and hierarchical Back works across subviews',async()=>{
  let remaining=[
    {instanceId:'i1',worldId:'w1',worldTitle:'世界一',instanceName:'实例1',fields:['summary'],retainedOverrides:[]},
    {instanceId:'i2',worldId:'w2',worldTitle:'世界二',instanceName:'实例2',fields:['summary'],retainedOverrides:[]},
  ]
  const cardModel={
    list:async()=>({entries:[{id:'c1',name:'测试卡',archived:false,currentVersionId:'v2'}],cursor:null}),
    read:async()=>({cardId:'c1',id:'v2',currentVersionId:'v2',revision:2,archived:false,definition:{name:'测试卡',summary:'s',speechStyle:'t',anchors:['a']}}),
    versions:async()=>({entries:[],cursor:null}),
    previewSync:async()=>({entries:remaining,cursor:null}),
    sync:vi.fn(async()=>{remaining=remaining.filter(i=>i.instanceId!=='i1')}),
    dispose:vi.fn(),
  }
  wrapper=mount(KanataCandidateCardLibrary,{props:{model:cardModel}})
  await flushPromises()
  await click('测试卡')
  await click('同步世界实例')
  expect(wrapper.text()).toContain('同步 世界一')
  expect(wrapper.text()).toContain('同步 世界二')
  await click('同步 世界一')
  expect(uiFeedbackState.dialog.open).toBe(true)
  resolveFeedbackDialog(true)
  await flushPromises()
  expect(cardModel.sync).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).not.toContain('同步 世界一')
  expect(wrapper.text()).toContain('同步 世界二')
  // Hierarchical back closes card detail first without closing CardLibrary (parent workspace owns library close)
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('关闭卡详情')
  expect(wrapper.text()).toContain('关闭角色卡库')
  expect(await dispatchBackAction()).toBe(false)
  wrapper.unmount();wrapper=null

  // LoreEditor hierarchical back closes preview before editor
  const loreModel={
    list:async()=>({entries:[{id:'a1',title:'角色甲'}],cursor:null}),
    previewLore:async()=>({entries:[{id:'m1',content:'匹配消息'}],cursor:null}),
  }
  wrapper=mount(KanataCandidateLoreEditor,{props:{world:{id:'w1',archived:false},model:loreModel}})
  await flushPromises()
  await click('选择所属角色或知情角色')
  await click('角色甲 预览')
  expect(wrapper.text()).toContain('关闭预览')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('关闭预览')
  expect(wrapper.text()).toContain('保存世界书条目')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.emitted('close')?.length).toBe(1)
  wrapper.unmount();wrapper=null

  // MemoryDetail hierarchical back closes conflicts -> sharing -> detail
  const memModel={
    list:async()=>({entries:[{id:'a1',title:'角色甲'},{id:'a2',title:'角色乙'}],cursor:null}),
    memoryDetail:async()=>({id:'mem1',status:'active',revision:1,key:'k',layer:'L2',content:'正文',canManage:true}),
    memorySources:async()=>({entries:[],cursor:null}),
    memoryConflicts:async()=>({plan:{count:0},entries:[],cursor:null}),
  }
  wrapper=mount(KanataCandidateMemoryDetail,{props:{model:memModel,memoryId:'mem1'}})
  await flushPromises()
  await click('角色甲')
  await click('核对候选和冲突')
  expect(wrapper.text()).toContain('关闭冲突')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('关闭冲突')
  await click('分享这条记忆')
  expect(wrapper.text()).toContain('取消分享')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('取消分享')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.emitted('close')?.length).toBe(1)
  wrapper.unmount();wrapper=null

  // EventLedger hierarchical back closes choices -> ledger
  const ledgerModel={
    list:async()=>({entries:[{id:'a1',title:'角色甲'}],cursor:null}),
  }
  wrapper=mount(KanataCandidateEventLedger,{props:{model:ledgerModel}})
  await flushPromises()
  await click('选择事件角色')
  expect(wrapper.text()).toContain('关闭选择')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.text()).not.toContain('关闭选择')
  expect(wrapper.text()).toContain('保存候选事件')
  expect(await dispatchBackAction()).toBe(true)
  await flushPromises()
  expect(wrapper.emitted('close')?.length).toBe(1)
})

it('MR8 ActivityPanel preserves >50 actors/schedules across pages on save and toggles weekday chips',async()=>{
  const page1Actors=Array.from({length:50},(_,i)=>({id:`a-${i+1}`,name:`角色${i+1}`,autonomyEnabled:true,proactiveEnabled:false}))
  const page2Actors=[{id:'a-51',name:'角色51',autonomyEnabled:true,proactiveEnabled:true}]
  const page1Schedules=Array.from({length:50},(_,i)=>({id:`s-${i+1}`,worldId:'w1',instanceId:'a-1',days:[1],startMinute:60,endMinute:120,location:`地点${i+1}`,activity:`活动${i+1}`,resting:false,revision:1}))
  const page2Schedules=[{id:'s-51',worldId:'w1',instanceId:'a-1',days:[2,4],startMinute:180,endMinute:240,location:'地点51',activity:'活动51',resting:false,revision:1}]
  const configure=vi.fn(async()=>{})
  const model={
    readConfig:async()=>({world:{id:'w1',revision:1,autonomyEnabled:true,proactiveEnabled:true,notificationsEnabled:false},policy:{worldId:'w1',revision:1,dailyDialogueLimit:2,maxCatchUpHours:6,freedom:'standard',quietStartMinute:0,quietEndMinute:0,socialChannel:'private'}}),
    actorFlagsPage:vi.fn(async cursor=>cursor==='p2'?{entries:page2Actors,cursor:null}:{entries:page1Actors,cursor:'p2'}),
    schedulesPage:vi.fn(async cursor=>cursor==='s2'?{entries:page2Schedules,cursor:null}:{entries:page1Schedules,cursor:'s2'}),
    configure,
    cancel:vi.fn(),
  }
  wrapper=mount(KanataCandidateActivityPanel,{props:{model,worldId:'w1'}})
  await flushPromises()
  expect(wrapper.text()).toContain('下一页虚拟日程')
  // Open schedule draft for s-1 and toggle weekday chip 周三 (day 3)
  await wrapper.findAll('button').find(b=>b.text()==='编辑虚拟日程').trigger('click')
  await flushPromises()
  await click('周三')
  await wrapper.find('form[aria-label="编辑虚拟日程"]').trigger('submit')
  await flushPromises()
  await wrapper.find('form[aria-label="自治策略与虚拟日程"]').trigger('submit')
  await flushPromises()
  expect(configure).toHaveBeenCalledTimes(1)
  const payload=configure.mock.calls[0][0]
  expect(payload.instanceFlags).toHaveLength(51)
  expect(payload.schedules).toHaveLength(51)
  expect(payload.schedules.find(s=>s.id==='s-1').days).toEqual([1,3])
  expect(payload.schedules.find(s=>s.id==='s-51')).toBeTruthy()
})

it('MR8 candidate preserves active generation while native file picker guard is held',async()=>{
  appListeners.length=0
  const candidate=createKanataSqliteCandidate({
    syntheticOnly:true,
    access:{runOperation:async()=>true},
    auth:{sessionRevision:1,isLocked:false},
    bridge:{open:async()=>{},close:async()=>{},begin:async()=>{},commit:async()=>{},rollback:async()=>{},query:async()=>({rows:[]}),execute:async()=>({affectedRows:0}),destroy:async()=>{}},
  })
  try{
    const initialGen=candidate.generation.value
    const stateCb=appListeners.at(-1)
    expect(stateCb).toBeTypeOf('function')
    await withNativeActivityGuard(async()=>{
      stateCb({isActive:false})
      expect(candidate.generation.value).toBe(initialGen)
      expect(candidate.isAvailable()).toBe(true)
    })
    // Outside guard (after grace window resets), background pause releases candidate and bumps generation
    resetNativeActivityGuard()
    stateCb({isActive:false})
    expect(candidate.generation.value).toBe(initialGen+1)
    expect(candidate.isAvailable()).toBe(false)
  }finally{
    await candidate.dispose()
  }
})

it('MR8 saveGrant refreshes grant revision without kicking workspace back to world directory',async()=>{
  let grantList=[{moduleId:'todo',read:false,remember:false,share:false,revision:1}]
  const clearSelection=vi.fn()
  const gen=vi.fn(()=>0)
  const setGrant=vi.fn(async(_actor,moduleId,rev,flags)=>{
    grantList=[{moduleId,read:flags.read,remember:flags.remember,share:flags.share,revision:(rev??0)+1}]
    return grantList[0]
  })
  const worlds={
    listWorlds:async()=>({entries:[{id:'w1',title:'主世界',archived:false,revision:1}],cursor:null}),
    select:()=>({
      overview:async()=>({id:'w1',title:'主世界',archived:false,revision:1}),
      list:async section=>section==='actors'?{entries:[{id:'a1',title:'角色甲'}],cursor:null}:{entries:[],cursor:null},
      grants:async()=>[...grantList],
      readInstanceDetail:async()=>({instance:{revision:1,overrides:{}},resolved:{name:'角色甲',summary:'s',speechStyle:'t'}}),
      setGrant,
    }),
    clearSelection,dispose:vi.fn(),
  }
  wrapper=mount(KanataCandidateWorkspace,{props:{worlds,lifecycle:{generation:{get value(){return gen()}},isAvailable:()=>true,release:async()=>{}},createChat:()=>({})}})
  await flushPromises()
  await click('主世界')
  await click('角色与授权')
  await click('角色甲')
  const todoBoxes=wrapper.findAll('[data-module="todo"] input[type="checkbox"]')
  expect(todoBoxes).toHaveLength(3)
  clearSelection.mockClear()
  await todoBoxes[0].setValue(true)
  await flushPromises()
  expect(setGrant).toHaveBeenCalledWith('a1','todo',1,{read:true,remember:false,share:false},expect.any(Function))
  expect(wrapper.text()).toContain('生活资料授权')
  expect(clearSelection).not.toHaveBeenCalled()
  // Second click sees refreshed revision 2
  await todoBoxes[1].setValue(true)
  await flushPromises()
  expect(setGrant).toHaveBeenLastCalledWith('a1','todo',2,{read:true,remember:true,share:false},expect.any(Function))
  expect(clearSelection).not.toHaveBeenCalled()

  // Real candidate separates lifecycle.generation from grantVersion on setGrant
  const { App }=await import('@capacitor/app')
  expect(App).toBeTruthy()
  const cand=createKanataSqliteCandidate({
    syntheticOnly:true,
    access:{runOperation:async()=>true},
    auth:{sessionRevision:1,isLocked:false},
    bridge:{open:async()=>{},close:async()=>{},begin:async()=>{},commit:async()=>{},rollback:async()=>{},query:async()=>({rows:[]}),execute:async()=>({affectedRows:0}),destroy:async()=>{}},
  })
  try{
    expect(cand.grantVersion.value).toBe(0)
    const g0=cand.generation.value
    expect(g0).toBeTypeOf('number')
  }finally{
    await cand.dispose()
  }
  expect(cand.generation.value).toBe(1)
})
