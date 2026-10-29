export {initializeApp,unlockApp,appData,PASSWORD} from '../p3/management-scenarios.mjs'
import {appData} from '../p3/management-scenarios.mjs'
const assert=(value,message)=>{if(!value)throw Error('P5_ASSERT:'+message)}
export async function verifyExperience(page,record){
  const initial=await appData(page),requests=[]
  await page.unroute('https://api.deepseek.com/**')
  await page.route('https://api.deepseek.com/**',async route=>{
    const payload=route.request().postDataJSON();requests.push(payload)
    const system=payload.messages.find(m=>m.role==='system')?.content||''
    const content=system.includes('文字记忆整理器')?(system.includes('{"summary"')?JSON.stringify({summary:'合成的阶段摘要，来源仅为当前会话。'}):JSON.stringify({memories:[{key:'饮品偏好',content:'用户表示喜欢合成茶。',confidence:'statement'}]})):'合成角色回应。\n\n我只使用这次明确授权的信息。'
    const usage={prompt_tokens:140,completion_tokens:30,prompt_cache_hit_tokens:20}
    const choice=payload.stream?{delta:{content},finish_reason:'stop'}:{message:{content},finish_reason:'stop'}
    await route.fulfill({status:200,contentType:payload.stream?'text/event-stream':'application/json',body:payload.stream?'data: '+JSON.stringify({choices:[choice],usage})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[choice],usage})})
  })
  const click=name=>page.getByRole('button',{name,exact:true}).click()
  const pick=label=>page.locator('.feedback-options').getByText(label,{exact:true}).click()
  const experience=async()=>{await click('记忆与权限');await page.getByRole('heading',{name:'经历与生活联动',exact:true}).waitFor()}
  const roleName=id=>initial.cardVersions.find(v=>v.id===initial.instances.find(i=>i.id===id)?.cardVersionId)?.definition.name
  const role0=roleName(initial.instances[0].id),role1=roleName(initial.instances[1].id),role2=roleName(initial.instances[2].id)
  const selectRole=async name=>{await page.getByRole('button',{name:/^管理角色：/}).click();await pick(name)}
  const memoryArticle=key=>page.locator('.kanata-experience-card').filter({has:page.getByRole('heading',{name:new RegExp('^'+key)})})
  const createMemory=async(key,content)=>{await click('新建记忆');await page.getByLabel('记忆主题',{exact:true}).fill(key);await page.getByLabel('记忆正文',{exact:true}).fill(content);await click('保存记忆')}
  await record('seed-zero-invented-experience',async()=>{
    assert(initial.worlds.length===1&&initial.instances.length===5&&initial.messages.length===0&&initial.memories.length===0&&initial.events.length===0&&initial.tasks.length===0,'empty experience seed')
    assert(requests.length===0,'no automatic AI');return true
  })
  await experience()
  await record('manual-memory-candidate-and-confirmation',async()=>{
    await createMemory('合成主题','这是用户明确填写的合成记忆')
    await memoryArticle('合成主题').getByRole('button',{name:'核对并采用',exact:true}).click()
    await page.getByText('已确认这条记忆。',{exact:true}).waitFor()
    const d=await appData(page);assert(d.memories[0].status==='active'&&d.messages.length===0&&requests.length===0,'manual confirmed fact without fake transcript');return true
  })
  await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings');s.aiApiKey='synthetic-p5-not-real';s.aiModel='deepseek-flash'})
  await record('automatic-candidate-idempotent-and-source-trace',async()=>{
    await click('我的世界');await page.locator('.kanata-conversation-list').getByRole('button',{name:initial.conversations[0].title,exact:true}).click()
    await page.getByLabel('发送文字',{exact:true}).fill('记住：我喜欢合成茶。');await click('发送消息')
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    const d=await appData(page),m=d.memories.find(m=>m.key==='饮品偏好')
    assert(m?.status==='candidate'&&m.sourceRefs.length===3&&d.tasks[0].state==='succeeded','auto source-revision candidate')
    assert(d.events.length===0&&d.lorebookEntries.length===initial.lorebookEntries.length,'not event truth or static lore')
    await click('返回世界');await experience();const before=requests.length
    await click('提取候选记忆');await pick(initial.conversations[0].title)
    await page.getByText('未达到当前整理条件，无需重复调用。',{exact:true}).waitFor()
    assert(requests.length===before,'no repeat charge or duplicate candidate');return true
  })
  await record('L0-revision-invalidates-derived-memory-and-replies',async()=>{
    await click('我的世界');await page.locator('.kanata-conversation-list').getByRole('button',{name:initial.conversations[0].title,exact:true}).click()
    await page.locator('.kanata-chat-message.is-user').getByRole('button',{name:'修订这条原文',exact:true}).click()
    await page.getByLabel('修订原文',{exact:true}).fill('修订：今天只想聊合成测试，不确认旧偏好。');await click('保存原文修订')
    await page.getByRole('button',{name:'保存原文修订',exact:true}).waitFor({state:'hidden'})
    const d=await appData(page);assert(d.memories.find(m=>m.key==='饮品偏好').status==='stale'&&d.messages.filter(m=>m.role==='assistant').every(m=>m.status==='stopped'),'invalidate whole derivation')
    assert(d.messageAudits[0].previous.content.includes('合成茶'),'old revision audit')
    await click('返回世界');await experience();await memoryArticle('饮品偏好').locator('summary').click()
    await memoryArticle('饮品偏好').getByText('记住：我喜欢合成茶。',{exact:true}).waitFor();return true
  })
  await record('memory-conflict-never-silently-overwrites',async()=>{
    await createMemory('合成主题','修正后的另一条合成记忆')
    const article=memoryArticle('合成主题').filter({hasText:'修正后的另一条合成记忆'})
    await article.getByRole('button',{name:'核对并采用',exact:true}).click();await click('采用并保留溯源')
    const d=await appData(page),facts=d.memories.filter(m=>m.key==='合成主题')
    assert(facts.filter(m=>m.status==='active').length===1&&facts.some(m=>m.supersededById),'explicit conflict resolution');return true
  })
  await record('L2-compression-preserves-L0-and-old-valid-summary-on-failure',async()=>{
    await page.getByRole('button',{name:/^整理策略：/}).click();await pick('自定义阈值')
    await page.getByLabel('近期原文条数',{exact:true}).fill('2');await page.getByLabel('摘要触发条数',{exact:true}).fill('4');await page.getByLabel('记忆提取间隔',{exact:true}).fill('100');await click('保存整理策略')
    const auto=page.getByLabel('满足条件后自动整理（使用全局 AI）',{exact:true});await auto.uncheck()
    await click('我的世界');await page.locator('.kanata-conversation-list').getByRole('button',{name:initial.conversations[0].title,exact:true}).click()
    await page.getByLabel('发送文字',{exact:true}).fill('新的普通合成闲聊');await click('发送消息');await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    await click('返回世界');await experience();const before=(await appData(page)).messages.length
    await click('压缩较早原文');await pick(initial.conversations[0].title)
    await page.getByText('整理完成；原文和先前有效摘要均保留。',{exact:true}).waitFor()
    let d=await appData(page);const summary=d.memories.find(m=>m.layer==='L2'&&m.status==='active')
    assert(summary&&d.messages.length===before,'L0 retained after compression with auto disabled')
    // Next source coverage permits a new task. A malformed provider result must not replace old L2.
    await page.unroute('https://api.deepseek.com/**')
    await page.route('https://api.deepseek.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'bad-json'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})}))
    await page.evaluate(async()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await s.update(data=>{const c=data.conversations[0],u=data.identities[0],key='extra-'+crypto.randomUUID();data.messages.push({id:key,worldId:c.worldId,conversationId:c.id,role:'user',senderType:'user',senderId:u.id,senderNameSnapshot:u.displayName,content:'附加合成压缩来源',createdAt:Date.now(),revision:1,status:'complete',turnId:key,batchId:key})})})
    const retained=JSON.stringify((await appData(page)).messages)
    await click('压缩较早原文');await pick(initial.conversations[0].title);await page.getByRole('alert').waitFor()
    d=await appData(page);assert(d.memories.find(m=>m.id===summary.id).status==='active'&&JSON.stringify(d.messages)===retained&&d.tasks.at(-1).state==='failed','failed summary preserves both layers')
    // Reinstall the deterministic provider used below without changing product configuration.
    await page.unroute('https://api.deepseek.com/**')
    await page.route('https://api.deepseek.com/**',route=>{const payload=route.request().postDataJSON();requests.push(payload);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成角色回应，我只使用已授权信息。'},finish_reason:'stop'}],usage:{prompt_tokens:140,completion_tokens:30,prompt_cache_hit_tokens:20}})})})
    return true
  })
  const eventArticle=summary=>page.locator('.kanata-experience-card').filter({has:page.getByRole('heading',{name:summary,exact:true})})
  const createSupport=async summary=>{
    await click('提议世界事件');await page.getByLabel('事件说明',{exact:true}).fill(summary)
    await click('事件类型：note');await pick('支持：小幅增加信任与理解')
    await click('关系对象：请选择');await pick(role0+' → '+role1);await click('保存候选事件')
    await eventArticle(summary).getByRole('button',{name:'核对并确认事件',exact:true}).click();await click('确认并应用规则')
    await page.getByText('事件已确认，状态按规则更新。',{exact:true}).waitFor()
  }
  await record('causal-revoke-preserves-independent-effects',async()=>{
    await click('世界事件');await createSupport('合成支持 E1');await createSupport('合成支持 E2')
    let d=await appData(page),edge=d.relationships.find(r=>r.fromId===initial.instances[0].id&&r.toId===initial.instances[1].id)
    assert(edge.dimensions.trust===0.06,'two rule effects')
    await eventArticle('合成支持 E1').getByRole('button',{name:'预览撤销影响',exact:true}).click();await click('按预览撤销并保留历史')
    await page.getByText('事件已撤销，独立效果已保留，历史审计仍可核对。',{exact:true}).waitFor()
    d=await appData(page);edge=d.relationships.find(r=>r.id===edge.id)
    assert(edge.dimensions.trust===0.03&&d.events.find(e=>e.summary==='合成支持 E2').status==='committed','independent E2 survives E1 revoke');return true
  })
  await record('event-correction-is-a-new-reviewed-candidate',async()=>{
    await eventArticle('合成支持 E2').getByRole('button',{name:'修正事件说明',exact:true}).click()
    await page.locator('.feedback-input').fill('合成修正 E2');await click('确定');await click('按预览撤销并保留历史')
    await page.getByText('旧事件已撤销，修正说明保存为新候选；再次核对后才生效。',{exact:true}).waitFor()
    const d=await appData(page),next=d.events.find(e=>e.summary==='合成修正 E2')
    assert(next.status==='candidate'&&next.replacesEventId&&d.events.find(e=>e.id===next.replacesEventId).status==='revoked','audited replacement');return true
  })
  const setGrant=async(flags)=>{
    const article=page.locator('.kanata-experience-card').filter({has:page.getByRole('heading',{name:'待办',exact:true})})
    for(const [index,key]of ['read','remember','share'].entries())await article.locator('input[type="checkbox"]').nth(index).setChecked(flags[key])
    await article.getByRole('button',{name:'保存待办授权',exact:true}).click()
    await page.getByText('独立授权已保存；旧派生内容不会绕过新权限。',{exact:true}).waitFor()
  }
  const openTodo=async()=>{await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').switchView('todo'));await page.locator('.todo-page').waitFor()}
  const backExperience=async()=>{await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').switchView('chat'));await page.locator('.kanata-manager').waitFor();await experience();await click('生活联动')}
  await click('生活联动')
  await record('exact-role-binding-and-read-only-life-reply',async()=>{
    await click('选择全局默认角色');await pick(initial.worlds[0].name+' · '+role0)
    await setGrant({read:true,remember:false,share:false})
    await page.evaluate(async()=>{const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('todo');if(!s.isDataLoaded)await s.load();await s.add({title:'仅授权后可见的合成待办',startDate:'2026-10-28',recurrence:{type:'none'}})})
    const before=(await appData(page)).memories.length
    await openTodo();await click('让所选角色回应');await page.locator('.kanata-life-companion strong').getByText(role0,{exact:true}).waitFor()
    const last=requests.at(-1),d=await appData(page)
    assert(JSON.stringify(last.messages).includes('仅授权后可见的合成待办'),'actual Todo projection')
    assert(d.memories.length===before&&d.usageEvents.at(-1).purpose==='life','read does not imply remember')
    await backExperience();return true
  })
  await record('life-memory-requires-remember-and-remains-private',async()=>{
    await setGrant({read:true,remember:true,share:false})
    await openTodo();await click('让所选角色回应');await page.locator('.kanata-life-companion strong').waitFor()
    const d=await appData(page),m=d.memories.find(m=>m.lifeSources?.some(s=>s.moduleId==='todo'))
    assert(m?.status==='candidate'&&m.visibility==='private'&&m.lifeSources[0].fingerprint.length===64,'separate memory permission and provenance')
    await backExperience();return true
  })
  await record('one-hop-share-permission-and-revocation',async()=>{
    await setGrant({read:true,remember:true,share:true})
    await selectRole(role1);await setGrant({read:true,remember:true,share:false})
    await selectRole(role2);await setGrant({read:true,remember:true,share:false})
    await selectRole(role0)
    await openTodo();await click('让所选角色回应');await page.locator('.kanata-life-companion strong').waitFor()
    await backExperience();await click('记忆')
    let d=await appData(page),m=d.memories.filter(m=>m.ownerId===initial.instances[0].id&&m.lifeSources?.some(s=>s.moduleId==='todo')&&m.status==='candidate').at(-1)
    const article=memoryArticle(m.key);await article.getByRole('button',{name:'核对并采用',exact:true}).click()
    await article.getByRole('button',{name:'分享这条记忆',exact:true}).click();await pick(role1)
    await selectRole(role1);const copy=(await appData(page)).memories.find(x=>x.sharedFromId===m.id)
    assert(copy?.status==='active','explicit share copy')
    await memoryArticle(copy.key).getByRole('button',{name:'分享这条记忆',exact:true}).click();await pick(role2)
    await page.getByRole('alert').getByText('分享需要来源角色的分享授权，以及接收角色独立的读取和记忆授权。',{exact:true}).waitFor()
    assert(!(await appData(page)).memories.some(x=>x.sharedFromId===copy.id),'recipient cannot forward')
    await click('生活联动');await selectRole(role0);await setGrant({read:false,remember:false,share:false})
    d=await appData(page);assert(d.memories.find(x=>x.id===m.id).status==='stale'&&d.memories.find(x=>x.id===copy.id).status==='stale','revocation stops descendants')
    const before=requests.length;await openTodo();await click('让所选角色回应');await page.getByText('请先给这个实例授予本模块读取权限。',{exact:true}).waitFor();assert(requests.length===before,'zero provider call after revocation')
    await backExperience();return true
  })
  const d=await appData(page)
  return{worlds:d.worlds.length,instances:d.instances.length,messages:d.messages.length,memories:d.memories.length,events:d.events.length,attempts:d.usageEvents.length,tasks:d.tasks.length,requests:requests.length,controlledProvider:true}
}
