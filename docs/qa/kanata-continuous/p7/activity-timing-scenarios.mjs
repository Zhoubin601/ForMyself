import {appData} from '../p3/management-scenarios.mjs'
import {groupExport,groupRestore,openGroup} from './group-limits-scenarios.mjs'
const assert=(condition,code)=>{if(!condition)throw Error(code)}
export async function verifyActivityTiming(initialPage,groupScope,record,network,password,reconnect){
  let page=initialPage,scope,source
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  const send=async text=>{await page.getByLabel('发送文字',{exact:true}).fill(text);await click('发送消息');await page.getByRole('button',{name:'立即回复最近一轮',exact:true}).waitFor()}
  const beforeRequests=network.requests
  await page.evaluate(async worldId=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata')
    await window.__groupTest.run(()=>store.update(data=>{
      const world=data.worlds.find(w=>w.id===worldId),actor=data.instances.find(i=>i.worldId===worldId)
      world.autonomyEnabled=true;world.lastSimulatedAt=Date.now();world.revision++
      actor.autonomyEnabled=true;actor.state.energy=0.2;actor.revision++
    }))
  },groupScope.worldId)
  const data=await appData(page),privateChat=data.conversations.find(c=>c.worldId===groupScope.worldId&&c.type==='private')
  scope={worldId:privateChat.worldId,conversationId:privateChat.id,title:privateChat.title}
  await openGroup(page,scope);await page.getByLabel('流式预览',{exact:true}).uncheck()
  await record('activity-setting-persists-with-inline-error-and-no-model-request',async()=>{
    await click('活动等待设置');await page.getByLabel('根据角色活动等待',{exact:true}).check()
    await page.getByLabel('活动等待毫秒',{exact:true}).fill('999');await click('保存活动等待')
    assert(await page.getByLabel('活动等待毫秒',{exact:true}).getAttribute('aria-invalid')==='true','ACTIVITY_INLINE_ERROR_MISSING')
    await page.getByLabel('活动等待毫秒',{exact:true}).fill('30000');await click('保存活动等待')
    await page.getByRole('form',{name:'活动等待设置',exact:true}).waitFor({state:'hidden'})
    assert(network.requests===beforeRequests,'TIMING_CONFIG_CALLED_MODEL')
    return{enabled:true,waitMs:30000,requests:0}
  })
  await record('busy-source-is-durable-before-charge-and-explicit-immediate-replies-once',async()=>{
    await send('第一条合成活动等待问题。')
    const d=await appData(page),task=d.tasks.find(t=>t.conversationId===scope.conversationId&&t.deferredReply&&t.state==='pending')
    assert(task?.deferredReply.activityDelay&&d.messages.filter(m=>m.conversationId===scope.conversationId).length===1&&network.requests===beforeRequests,'WAITING_NOT_DURABLE_OR_FAKE_REPLY')
    await click('立即回复最近一轮')
    await page.waitForFunction(id=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messages.filter(m=>m.conversationId===id&&m.role==='assistant').length===3,scope.conversationId)
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    const after=await appData(page)
    assert(after.tasks.find(t=>t.id===task.id).state==='cancelled'&&after.messages.filter(m=>m.conversationId===scope.conversationId&&m.role==='user').length===1&&network.requests===beforeRequests+1,'IMMEDIATE_DUPLICATED_SOURCE_OR_CALL')
    return{durableBeforeRequest:true,noInventedBusyMessage:true,cancelledPending:true,userRows:1,requests:1}
  })
  await record('cold-owner-loads-pending-activity-task-and-real-foreground-composition-completes-once',async()=>{
    await send('第二条合成活动等待问题。')
    const d=await appData(page);source=d.messages.filter(m=>m.conversationId===scope.conversationId&&m.role==='user').at(-1).id
    page=await reconnect();await openGroup(page,scope)
    const loaded=await appData(page),task=loaded.tasks.find(t=>t.deferredReply?.sourceMessageId===source)
    assert(task?.deferredReply.activityDelay,'COLD_ACTIVITY_TASK_LOST')
    assert(loaded.conversations.find(c=>c.id===scope.conversationId).replyTiming.waitMs===30000,'COLD_ACTIVITY_CONFIG_LOST')
    // No clock rewrite, direct executor call or forced GC: wait for the actual composition tick.
    await page.waitForFunction(id=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.deferredReply?.sourceMessageId===id&&t.state==='succeeded'),source,{timeout:70000})
    const after=await appData(page),rows=after.messages.filter(m=>m.conversationId===scope.conversationId)
    assert(network.requests===beforeRequests+2&&rows.filter(m=>m.role==='user').length===2&&rows.filter(m=>m.role==='assistant').length===6,'RESUME_DUPLICATED_SOURCE_OR_CALL')
    return{loadedTask:true,savedConfig:true,actualForegroundLifecycle:true,userRows:2,aiRows:6,requests:1}
  })
  await record('external-full-restore-retains-activity-policy-but-pauses-the-waiting-send',async()=>{
    await send('第三条合成活动等待问题。')
    const d=await appData(page),task=d.tasks.find(t=>t.conversationId===scope.conversationId&&t.deferredReply&&t.state==='pending')
    const backup=await groupExport(page)
    assert(backup.data.chat.tasks.find(t=>t.id===task.id).state==='cancelled','EXPORTED_WAIT_WOULD_REPLAY')
    await groupRestore(page,backup,password)
    const after=await appData(page)
    assert(after.tasks.find(t=>t.id===task.id).state==='cancelled'&&after.conversations.find(c=>c.id===scope.conversationId).replyTiming.enabled&&network.requests===beforeRequests+2,'RESTORE_REPLAYED_OR_LOST_CONFIG')
    await openGroup(page,scope)
    return{actualCoordinator:true,pendingSendPaused:true,policyPreserved:true,noAdditionalRequest:true}
  })
  return page
}
