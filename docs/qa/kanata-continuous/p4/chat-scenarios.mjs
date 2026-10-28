export {initializeApp,unlockApp,appData,PASSWORD} from '../p3/management-scenarios.mjs'
import {appData} from '../p3/management-scenarios.mjs'
const assert=(value,message)=>{if(!value)throw Error('P4_ASSERT:'+message)}
export async function verifyChat(page,record){
  const initial=await appData(page),requests=[]
  let behavior='normal',handled=0,releaseSlow=null,otherModuleCalls=0
  await page.unroute('https://api.deepseek.com/**')
  await page.route('https://api.deepseek.com/**',async route=>{
    const payload=route.request().postDataJSON()
    const system=payload.messages.find(m=>m.role==='system')?.content||''
    if(!system.includes('你自己的角色设定：')){
      otherModuleCalls++
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成测试：其他模块的固定回应。'},finish_reason:'stop'}]})})
    }
    requests.push(payload);handled++
    if(behavior==='slow')await new Promise(resolve=>{releaseSlow=resolve})
    if(behavior==='fallback'&&handled===1)return route.fulfill({status:415,body:'{}'})
    const persona=JSON.parse(system.split('你自己的角色设定：')[1].split('\n当前用户身份：')[0])
    // Controlled provider fixture: tests plumbing/identity, never claimed as live model quality.
    const content=persona.name+'的合成测试回应。\n\n保留自己的观点。'
    const finish=behavior==='truncate'&&handled===1?'length':'stop'
    const usage={prompt_tokens:123,completion_tokens:24,prompt_cache_hit_tokens:20}
    const json={choices:[{message:{content},finish_reason:finish}],usage}
    try{
      if(payload.stream&&behavior!=='fallback')await route.fulfill({status:200,contentType:'text/event-stream',body:[{choices:[{delta:{content:content.slice(0,4)}}]},{choices:[{delta:{content:content.slice(4)},finish_reason:finish}],usage},'[DONE]'].map(v=>'data: '+(typeof v==='string'?v:JSON.stringify(v))+'\n\n').join('')})
      else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)})
    }catch{if(behavior!=='slow')throw Error('Fixture fulfillment failed')}
  })
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  const open=async c=>{await page.locator('.kanata-conversation-list').getByRole('button',{name:c.title,exact:true}).click();await page.locator('.kanata-chat').waitFor()}
  const send=async text=>{await page.getByLabel('发送文字',{exact:true}).fill(text);await click('发送消息');await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})}
  await record('no-key-no-auto-call',async()=>{
    await open(initial.conversations[0]);assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),'no key send disabled')
    assert(requests.length===0,'no auto request');await click('返回世界');return true
  })
  await page.evaluate(()=>{
    const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
    s.aiApiKey='synthetic-p4-not-real';s.aiModel='deepseek-flash'
  })
  await record('five-private-speakers-and-real-usage',async()=>{
    for(const c of initial.conversations.filter(c=>c.type==='private')){
      await open(c);await send('今天有什么安排？')
      const d=await appData(page),messages=d.messages.filter(m=>m.conversationId===c.id)
      assert(messages.length===3,'one user two natural bubbles')
      assert(messages.slice(1).every(m=>m.senderId===c.participantIds.find(id=>id!==initial.identities[0].id)),'speaker identity')
      const event=d.usageEvents.find(e=>e.conversationId===c.id)
      assert(event.usage.promptTokens===123&&event.status==='succeeded','actual usage')
      await click('返回世界')
    }
    assert(new Set(requests.slice(0,5).map(p=>p.messages[0].content)).size===5,'five distinct persona prompts')
    return{speakers:5,requests:5,controlledProvider:true}
  })
  const group=initial.conversations.find(c=>c.type==='group')
  await record('group-mention-priority-and-natural-silence',async()=>{
    await open(group);await click('@砂狼白子');await page.getByLabel('发送文字',{exact:true}).fill('@砂狼白子 今天骑行吗？');await click('发送消息')
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    const d=await appData(page),assistant=d.messages.filter(m=>m.conversationId===group.id&&m.role==='assistant')
    assert(new Set(assistant.map(m=>m.senderId)).size===1&&assistant[0].senderId===initial.instances[1].id,'only mentioned role')
    await click('返回世界');return true
  })
  await record('RP-mode-and-bounded-truncation-retry',async()=>{
    await open(initial.conversations[0]);await click('对话模式：日常聊天');await page.locator('.feedback-options').getByText('角色扮演',{exact:true}).click()
    behavior='truncate';handled=0;const before=(await appData(page)).usageEvents.length
    await send('合成RP测试');const d=await appData(page)
    assert(d.usageEvents.length===before+2,'truncation separately recorded')
    assert(d.usageEvents.at(-2).errorCode==='OUTPUT_TRUNCATED','first attempt failure')
    assert(d.messages.filter(m=>m.conversationId===initial.conversations[0].id&&m.role==='assistant').length===3,'RP one full bubble, no partial saved')
    assert(JSON.stringify(d.instances)===JSON.stringify(initial.instances),'persona preserved');behavior='normal';await click('返回世界');return true
  })
  await record('stream-fallback-once-and-cost-range',async()=>{
    await open(initial.conversations[1]);behavior='fallback';handled=0
    const before=(await appData(page)).usageEvents.length;await send('合成回退测试')
    const events=(await appData(page)).usageEvents.slice(before)
    assert(events.length===2&&events[0].errorCode==='HTTP_415'&&events[1].transport==='json','fallback accounting')
    await page.locator('.kanata-usage summary').click();await page.getByText(/费用估算 ¥/).first().waitFor()
    behavior='normal';await click('返回世界');return true
  })
  await record('leaving-page-aborts-late-result',async()=>{
    await open(initial.conversations[2]);behavior='slow';releaseSlow=null
    await page.getByLabel('发送文字',{exact:true}).fill('等待时离开');await click('发送消息')
    const deadline=Date.now()+15000;while(!releaseSlow){if(Date.now()>deadline)throw Error('Provider fixture not reached');await new Promise(r=>setTimeout(r,50))}
    const before=(await appData(page)).messages.filter(m=>m.role==='assistant').length
    await click('返回世界');releaseSlow();await page.waitForTimeout(200)
    assert((await appData(page)).messages.filter(m=>m.role==='assistant').length===before,'late response not saved')
    behavior='normal';return true
  })
  await record('short-submissions-batched-one-paid-turn',async()=>{
    await open(initial.conversations[3]);const before=requests.length
    // Dispatch real DOM input/submit events in one renderer task. Sequential CDP
    // round trips on an emulator may exceed the actual 600ms batching window.
    const elapsed=await page.evaluate(async()=>{
      const started=Date.now(),input=document.querySelector('.kanata-chat textarea'),form=input.form
      for(const text of ['第一短句','第二短句']){input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();form.requestSubmit();await Promise.resolve()}
      return Date.now()-started
    })
    assert(elapsed<600,'synthetic submissions within batching window')
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    assert(requests.length===before+1,'one paid turn')
    const d=await appData(page);assert(d.messages.some(m=>m.content==='第一短句\n第二短句'),'batched content')
    await click('返回世界');return true
  })
  await record('cancel-configured-delay-before-AI',async()=>{
    await open(initial.conversations[4]);await click('回复等待：立即');await page.locator('.feedback-options').getByText('15 秒',{exact:true}).click()
    const before=requests.length
    await page.getByLabel('发送文字',{exact:true}).fill('合成延迟取消');await click('发送消息')
    await page.waitForTimeout(750);await click('停止回复');await page.waitForTimeout(100)
    assert(requests.length===before,'cancel before billing');await click('返回世界');return true
  })
  await record('world-switch-isolates-context-and-cancels-old-target',async()=>{
    await click('创建空白世界');await page.locator('.feedback-input').fill('P4合成第二世界');await click('创建世界')
    await click('加入角色');await page.locator('.feedback-options').getByText('砂狼白子',{exact:true}).click()
    let d=await appData(page);const second=d.worlds.find(w=>w.name==='P4合成第二世界'),c=d.conversations.find(c=>c.worldId===second.id)
    await open(c);await send('第二世界独有的问候')
    assert(!JSON.stringify(requests.at(-1).messages).includes('今天骑行吗'),'no first-world history')
    behavior='slow';releaseSlow=null
    await page.getByLabel('发送文字',{exact:true}).fill('切换世界时等待');await click('发送消息')
    const deadline=Date.now()+15000;while(!releaseSlow){if(Date.now()>deadline)throw Error('Second-world fixture not reached');await new Promise(r=>setTimeout(r,50))}
    const before=(await appData(page)).messages.filter(m=>m.role==='assistant').length
    await page.locator('.kanata-world-toolbar button').click();await page.locator('.feedback-options').getByText(initial.worlds[0].name,{exact:true}).click()
    releaseSlow();await page.waitForTimeout(200)
    d=await appData(page);assert(d.messages.filter(m=>m.role==='assistant').length===before,'late reply cannot enter another world')
    assert(!await page.locator('.kanata-chat').count(),'old conversation unmounted');behavior='normal';return true
  })
  const final=await appData(page)
  assert(final.messages.length>0&&final.usageEvents.length>0,'real store persisted messages and usage')
  return{worlds:final.worlds.length,instances:final.instances.length,messages:final.messages.length,attempts:final.usageEvents.length,requests:requests.length,otherModuleCalls,controlledProvider:true}
}
