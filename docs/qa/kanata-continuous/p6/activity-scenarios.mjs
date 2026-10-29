import {appData} from '../p3/management-scenarios.mjs'
export {initializeApp,unlockApp,appData,PASSWORD} from '../p3/management-scenarios.mjs'
const assert=(value,message)=>{if(!value)throw Error('P6_ASSERT:'+message)}
export async function verifyActivity(page,record,{nativeNotification=false}={}){
  let requests=0
  await page.unroute('https://api.deepseek.com/**')
  await page.route('https://api.deepseek.com/**',async route=>{
    requests++;const payload=route.request().postDataJSON(),content=payload.messages[0].content.includes('同伴')?'合成角色独立观点：我们可以按书的类别整理。':'合成的主动问候，不要求用户立刻回复。'
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,prompt_cache_hit_tokens:0}})})
  })
  const initial=await appData(page),worldId=initial.worlds[0].id
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  await record('initial-history-empty-and-switches-off',async()=>{assert(initial.messages.length===0&&initial.events.length===0&&!initial.worlds[0].autonomyEnabled&&!initial.worlds[0].proactiveEnabled&&!initial.worlds[0].notificationsEnabled,'seed');return true})
  await click('世界日常与视角')
  await record('independent-world-switches-real-ui',async()=>{
    await page.getByLabel('自主世界发展',{exact:true}).check();await click('保存世界开关')
    const data=await appData(page);assert(data.worlds[0].autonomyEnabled&&!data.worlds[0].proactiveEnabled&&!data.worlds[0].notificationsEnabled,'independent flags');return true
  })
  // Isolated synthetic fixture age and explicit virtual schedules. Production Store validates
  // the graph; UI then invokes the actual protected runtime, not a second test implementation.
  await page.evaluate(async worldId=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata')
    await store.update(d=>{
      d.worlds[0].createdAt=Date.now()-24*3600000;d.worlds[0].lastSimulatedAt=Date.now()-3600000
      d.autonomyPolicies=[{worldId,revision:1,dailyDialogueLimit:0,maxCatchUpHours:3,freedom:'strict',quietStartMinute:0,quietEndMinute:0}]
      d.virtualSchedules=d.instances.slice(0,2).map((i,n)=>{i.autonomyEnabled=true;return{id:'qa-schedule-'+n,worldId,instanceId:i.id,days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,location:'合成资料室',activity:'整理合成书架',resting:false,revision:1}})
    })
    const settings=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings');settings.aiApiKey='synthetic-p6-not-a-key';settings.aiModel='deepseek-flash'
  },worldId)
  await record('zero-scenes-only-lightweight-rule-events',async()=>{
    await click('现在有限补算');await page.getByText('本次有限补算已结束。原文和每次模型调用均独立记录。',{exact:true}).waitFor()
    const data=await appData(page);assert(data.events.length===2&&data.messages.length===0&&!data.conversations.some(c=>c.type==='character')&&requests===0,'zero scene cap');return true
  })
  await page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await store.update(d=>{d.autonomyPolicies[0].dailyDialogueLimit=1;d.autonomyPolicies[0].revision++;d.worlds[0].lastSimulatedAt=Date.now()-1800000})
  })
  await record('two-real-speakers-one-linked-private-scene',async()=>{
    await click('现在有限补算');await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.social&&t.state==='succeeded'))
    const data=await appData(page),task=data.tasks.find(t=>t.social);assert(data.messages.length===2&&task.sourceRefs.length===2&&task.resultEventIds.length===1&&data.conversations.find(c=>c.id===task.conversationId).type==='character','scene graph');assert(requests===2,'two requests');return true
  })
  await record('ordinary-god-view-does-not-grant-npc-knowledge',async()=>{
    assert(!await page.getByRole('button',{name:'查看关联角色会话',exact:true}).count(),'ordinary conceals scene')
    await click('上帝视角');await click('查看关联角色会话')
    assert(await page.locator('[aria-label="用户管理角色间交流"] .kanata-chat-message').count()===2,'god transcript')
    await click('普通视角');assert(!await page.locator('[aria-label="用户管理角色间交流"]').count(),'ordinary removes transcript');return true
  })
  await record('same-window-retry-no-extra-transcript-or-charge',async()=>{
    await click('现在有限补算');await page.getByRole('button',{name:'现在有限补算',exact:true}).waitFor()
    const data=await appData(page);assert(data.messages.length===2&&requests===2,'idempotency');return true
  })
  await record('proactive-independent-of-autonomy-and-notification',async()=>{
    await page.getByLabel('自主世界发展',{exact:true}).uncheck();await page.getByLabel('角色主动联系',{exact:true}).check();await click('保存世界开关')
    await page.getByLabel('允许主动联系',{exact:true}).first().check();await click('保存角色与日程')
    await click('检查主动联系');await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.contact))
    let data=await appData(page);assert(!data.worlds[0].autonomyEnabled&&data.worlds[0].proactiveEnabled&&!data.worlds[0].notificationsEnabled&&requests===2,'queue independent')
    await page.evaluate(async notify=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await s.update(d=>{d.worlds[0].notificationsEnabled=notify;const task=d.tasks.find(t=>t.contact);task.notBefore=Date.now()-1000;task.contact.expiresAt=Date.now()+600000})},nativeNotification)
    await click('检查主动联系');await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.contact&&t.state==='succeeded'))
    if(nativeNotification)await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.contact?.notificationState==='sent'))
    data=await appData(page);assert(data.messages.length===3&&data.messages.every(m=>m.role==='assistant')&&data.usageEvents.length===3&&requests===3,'actual contact without fake user');if(nativeNotification)assert(data.tasks.find(t=>t.contact).contact.notificationState==='sent','native notification actually scheduled');return true
  })
  await record('expired-contact-cancelled-without-api',async()=>{
    await page.evaluate(async()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await s.update(d=>{const t=JSON.parse(JSON.stringify(d.tasks.find(t=>t.contact)));t.id='synthetic-expired-contact';t.idempotencyKey='synthetic-expired-contact';t.state='pending';t.contact.date='2026-10-01';t.notBefore=Date.now()-3*3600000;t.contact.expiresAt=Date.now()-3600000;t.contact.notificationId++;d.tasks.push(t)})})
    await click('检查主动联系');const data=await appData(page);assert(data.tasks.find(t=>t.id==='synthetic-expired-contact').state==='cancelled'&&requests===3,'expired');return true
  })
  await click('我的世界');await page.locator('.kanata-conversation-list').getByRole('button',{name:initial.conversations[0].title,exact:true}).click()
  await record('delayed-reply-persists-and-explicit-cancel-makes-no-request',async()=>{
    await click('回复等待：立即');await page.locator('.feedback-options').getByText('15 秒',{exact:true}).click()
    await page.getByLabel('流式预览',{exact:true}).uncheck();await page.getByLabel('发送文字',{exact:true}).fill('普通合成延迟测试');await click('发送消息')
    await page.getByRole('button',{name:'取消等待中的回复',exact:true}).waitFor()
    assert((await appData(page)).tasks.some(t=>t.deferredReply&&t.state==='pending')&&requests===3,'saved before HTTP')
    await click('取消等待中的回复');await page.getByRole('button',{name:'取消等待中的回复',exact:true}).waitFor({state:'hidden'})
    assert((await appData(page)).tasks.find(t=>t.deferredReply).state==='cancelled'&&requests===3,'explicit cancel');return true
  })
  await record('delayed-reply-new-owner-foreground-resume-no-duplicate-user',async()=>{
    await click('重试最近一轮');await page.getByRole('button',{name:'取消等待中的回复',exact:true}).waitFor()
    await page.evaluate(async()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await s.update(d=>{d.tasks.find(t=>t.deferredReply).notBefore=Date.now()-1})})
    await click('返回世界')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.deferredReply&&t.state==='succeeded'),null,{timeout:60000})
    const data=await appData(page);assert(data.messages.filter(m=>m.role==='user').length===1&&data.messages.length===5&&requests===4,'actual composition resumes delayed task once');return true
  })
  await record('explicit-existing-group-scene-has-one-event-and-navigates-to-the-same-chat',async()=>{
    await click('从预设创建世界');await page.locator('.feedback-options button').first().click();await click('创建独立世界')
    const data=await appData(page),newWorldId=data.worlds.find(w=>w.id!==worldId).id
    await page.evaluate(async worldId=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await s.update(d=>{
      const world=d.worlds.find(w=>w.id===worldId);world.createdAt=Date.now()-24*3600000;world.lastSimulatedAt=Date.now()-1800000;world.autonomyEnabled=true
      ;(d.autonomyPolicies||=[]).push({worldId,revision:1,dailyDialogueLimit:1,maxCatchUpHours:3,freedom:'strict',quietStartMinute:0,quietEndMinute:0,socialChannel:'group'})
      for(const [n,i] of d.instances.filter(i=>i.worldId===worldId).slice(0,2).entries()){i.autonomyEnabled=true;(d.virtualSchedules||=[]).push({id:'qa-group-schedule-'+n,worldId,instanceId:i.id,days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,location:'合成群聊阅览室',activity:'一起整理合成资料',resting:false,revision:1})}
    })},newWorldId)
    await click('世界日常与视角');await click('现在有限补算')
    await page.waitForFunction(worldId=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.worldId===worldId&&t.social&&t.state==='succeeded'),newWorldId)
    const after=await appData(page),task=after.tasks.find(t=>t.worldId===newWorldId&&t.social),conversation=after.conversations.find(c=>c.id===task.conversationId)
    assert(conversation.type==='group'&&after.messages.filter(m=>m.conversationId===conversation.id).length===2&&task.resultEventIds.length===1&&requests===6,'group scene single source')
    await click('打开关联群聊');await page.getByRole('heading',{name:conversation.title,exact:true}).waitFor()
    assert(await page.locator('.kanata-chat-timeline .kanata-chat-message').count()===2,'event opens same chat')
    await click('返回世界');return true
  })
  const final=await appData(page)
  return{worlds:final.worlds.length,instances:final.instances.length,messages:final.messages.length,attempts:final.usageEvents.length,requests}
}
