// Real production UI/runtime, with clearly controlled provider replies. No live model claims.
export const GROUP_REPLY='第一段合成回应。\n\n第二段合成回应。\n\n第三段合成回应。'
const assert=(condition,code)=>{if(!condition)throw Error(code)}
export async function attachGroupRuntime(page,asset){
  await page.evaluate(async asset=>{
    const module=await import('/'+asset),namespace=Object.values(module).find(value=>value&&typeof value==='object'&&typeof value.createFullBackupRuntime==='function')
    if(!namespace)throw Error('PRODUCT_RUNTIME_MISSING')
    window.__groupTest={runtime:namespace.createFullBackupRuntime()}
  },asset)
  await page.evaluate(()=>{const access=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('protectedAccess');window.__groupTest.run=action=>access.runOperation(access.moduleIds,action)})
}
export const groupExport=page=>page.evaluate(()=>window.__groupTest.run(()=>window.__groupTest.runtime.exportFull()))
export async function groupRestore(page,backup,password){
  await page.evaluate(async({backup,password})=>{await window.__groupTest.run(()=>window.__groupTest.runtime.restore(backup,password))},{backup,password})
}
export async function openGroup(page,scope){
  if(await page.getByRole('button',{name:'返回世界',exact:true}).count())await page.getByRole('button',{name:'返回世界',exact:true}).click()
  const index=await page.evaluate(worldId=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.worlds.findIndex(w=>w.id===worldId),scope.worldId)
  await page.locator('.kanata-world-toolbar button').click()
  await page.locator('.feedback-options button').nth(index).click()
  await page.locator('.kanata-conversation-list').getByRole('button',{name:scope.title,exact:true}).click()
}
export async function groupScope(page){
  return page.evaluate(()=>{
    const data=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot,world=data.worlds.at(-1),group=data.conversations.find(c=>c.worldId===world.id&&c.type==='group')
    return{worldId:world.id,conversationId:group.id,title:group.title}
  })
}
export async function setGroupUI(page,maxSpeakers,maxMessages){
  await page.getByRole('button',{name:'群聊回复限制',exact:true}).click()
  await page.getByLabel('每轮参与角色上限',{exact:true}).fill(String(maxSpeakers))
  await page.getByLabel('每轮 AI 回复条数上限',{exact:true}).fill(String(maxMessages))
  await page.getByRole('button',{name:'保存群聊限制',exact:true}).click()
  await page.getByRole('form',{name:'群聊回复限制',exact:true}).waitFor({state:'hidden'})
}
export async function verifyGroupLimits(page,record,network,password,selectedScope){
  const scope=selectedScope||await groupScope(page)
  await page.evaluate(async scope=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,store=stores.get('kanata')
    await window.__groupTest.run(()=>store.update(data=>{
      data.memoryPolicies=[...(data.memoryPolicies||[]).filter(p=>p.worldId!==scope.worldId),{worldId:scope.worldId,strategy:'standard',enabled:false,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1}]
      const actor=data.instances.find(i=>i.worldId===scope.worldId);actor.overrides.name='合成 多词角色';actor.revision++
    }))
    const settings=stores.get('settings');settings.aiApiKey='synthetic-p7-group-not-real';settings.aiProviderUrl='https://api.deepseek.com';settings.aiModel='deepseek-chat'
  },scope)
  await openGroup(page,scope)
  await page.getByLabel('流式预览',{exact:true}).uncheck()
  const names=(await page.getByRole('button',{name:/^@/}).allTextContents()).map(name=>name.trim().slice(1))
  const text=names.map(name=>'@'+name).join(' ')+' 请回应本轮合成测试。'
  await record('three-actor-four-message-policy-and-validation',async()=>{
    await page.getByRole('button',{name:'群聊回复限制',exact:true}).click()
    await page.getByLabel('每轮参与角色上限',{exact:true}).fill('3')
    await page.getByLabel('每轮 AI 回复条数上限',{exact:true}).fill('2')
    await page.getByRole('button',{name:'保存群聊限制',exact:true}).click()
    assert(await page.getByLabel('每轮 AI 回复条数上限',{exact:true}).getAttribute('aria-invalid')==='true','INVALID_POLICY_NOT_EXPLAINED')
    await page.getByLabel('每轮 AI 回复条数上限',{exact:true}).fill('4')
    await page.getByRole('button',{name:'保存群聊限制',exact:true}).click()
    await page.getByRole('form',{name:'群聊回复限制',exact:true}).waitFor({state:'hidden'})
    assert(network.requests===0,'CONFIGURATION_CALLED_MODEL')
    return{speakers:3,messages:4,noConfigModelCall:true}
  })
  await record('third-provider-failure-keeps-two-actor-batches-and-original-source',async()=>{
    network.failAt=3
    await page.getByLabel('发送文字',{exact:true}).fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.waitForFunction(scope=>{const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot;return d.messages.filter(m=>m.conversationId===scope.conversationId&&m.role==='assistant').length===3},scope)
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    assert(network.requests===3,'UNEXPECTED_AUTOMATIC_RETRY')
    return{completedAiRows:3,providerAttempts:3}
  })
  await record('retry-fills-only-third-actor-and-preserves-every-paragraph',async()=>{
    await page.getByRole('button',{name:'重试最近一轮',exact:true}).click()
    await page.waitForFunction(scope=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messages.filter(m=>m.conversationId===scope.conversationId&&m.role==='assistant').length===4,scope)
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    const proof=await page.evaluate(({scope,body})=>{
      const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot,rows=d.messages.filter(m=>m.conversationId===scope.conversationId),replies=rows.filter(m=>m.role==='assistant'),actors=[...new Set(replies.map(m=>m.senderId))]
      if(rows.length!==5||actors.length!==3||actors.some(id=>replies.filter(m=>m.senderId===id).map(m=>m.content).join('\n\n')!==body))throw Error('GROUP_BODY_OR_BUDGET_LOST')
      return{actors:3,aiRows:4,sourceRows:1,paragraphsPreserved:true}
    },{scope,body:GROUP_REPLY})
    assert(network.requests===4,'COMPLETED_ACTOR_PAID_AGAIN')
    await page.getByRole('button',{name:'重试最近一轮',exact:true}).click()
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    assert(network.requests===4,'IDEMPOTENT_RETRY_CALLED_MODEL')
    return proof
  })
  await record('one-actor-one-message-policy-keeps-history-and-merges-new-full-reply',async()=>{
    await setGroupUI(page,1,1)
    await page.getByLabel('发送文字',{exact:true}).fill(text+' 第二轮。');await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.waitForFunction(scope=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messages.filter(m=>m.conversationId===scope.conversationId).length===7,scope)
    await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
    assert(network.requests===5,'ONE_ACTOR_LIMIT_NOT_ENFORCED')
    const ok=await page.evaluate(({scope,body})=>{const rows=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messages.filter(m=>m.conversationId===scope.conversationId);return rows.at(-1).content===body&&rows.filter(m=>m.role==='assistant').length===5},{scope,body:GROUP_REPLY})
    assert(ok,'LIMIT_TRUNCATED_BODY_OR_DELETED_HISTORY');return{newAiRows:1,previousAiRows:4,bodyPreserved:true}
  })
  await record('actual-full-coordinator-restores-scoped-policy-and-entire-conversation',async()=>{
    const backup=await groupExport(page)
    await setGroupUI(page,2,2)
    await groupRestore(page,backup,password)
    const after=await groupExport(page)
    assert(JSON.stringify(after.data.chat.conversations.find(c=>c.id===scope.conversationId).replyLimits)===JSON.stringify({maxSpeakers:1,maxMessages:1}),'FULL_RESTORE_LOST_GROUP_POLICY')
    const expected=backup.data.chat.messages.filter(m=>m.conversationId===scope.conversationId),actual=after.data.chat.messages.filter(m=>m.conversationId===scope.conversationId)
    assert(JSON.stringify(actual)===JSON.stringify(expected),'FULL_RESTORE_LOST_GROUP_HISTORY')
    return{actualCoordinator:true,policyPreserved:true,exactRows:actual.length}
  })
  return scope
}
