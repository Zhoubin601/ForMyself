// Synthetic fixtures through production Store; no test bundle, private data, API key or model calls.
export async function seedArchiveHistory(page,count=600){
  return page.evaluate(async count=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,store=stores.get('kanata')
    const data=store.snapshot,c=data.conversations.find(c=>c.type==='private'&&c.worldId===data.worlds[0].id),identity=data.identities.find(i=>i.worldId===c.worldId),actor=data.instances.find(i=>c.participantIds.includes(i.id))
    if(data.messages.some(m=>m.id.startsWith('p7-history-')))throw Error('Synthetic fixture already present')
    const priorMessages=data.messages.length,base=Math.max(Date.now()-200000,...data.messages.map(m=>m.createdAt))+1000
    await store.update(d=>{
      for(let i=0;i<count;i++)d.messages.push({id:'p7-history-'+i,worldId:c.worldId,conversationId:c.id,role:i%2?'assistant':'user',senderType:i%2?'character':'user',senderId:i%2?actor.id:identity.id,senderNameSnapshot:i%2?'合成角色':'合成用户',content:i===26?'合成历史唯一词：星河🚀 Café':'合成历史正文 '+i,createdAt:base+i,revision:1,status:'complete',turnId:'p7-turn-'+Math.floor(i/2),batchId:'p7-batch-'+Math.floor(i/2),...(i%2?{replyToMessageId:'p7-history-'+(i-1),replyToRevision:1}:{})})
      d.memories.push({id:'p7-memory-source',worldId:c.worldId,ownerType:'character',ownerId:actor.id,layer:'L3',key:'合成历史来源',content:'这条合成记忆的原文必须仍可溯源。',sourceRefs:[{messageId:'p7-history-0',revision:1}],status:'active',revision:1,visibility:'private'})
    })
    await store.flush()
    return{worldId:c.worldId,conversationId:c.id,title:c.title,priorMessages,count,total:priorMessages+count}
  },count)
}
export async function verifyArchiveHistory(page,record,{fullBackupAsset,password}={}){
  const target=await record('seed-synthetic-history-and-real-source',()=>seedArchiveHistory(page))
  await page.getByRole('button',{name:target.title,exact:true}).click()
  await page.getByRole('button',{name:'查找或整理历史',exact:true}).click()
  const panel=page.getByRole('region',{name:'会话历史',exact:true})
  await panel.getByRole('button',{name:'整理较早聊天',exact:true}).click()
  await page.getByRole('button',{name:'整理历史',exact:true}).click()
  await panel.getByRole('status').filter({hasText:'已整理'}).waitFor()
  await record('verified-archive-and-source-retention',async()=>page.evaluate(target=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),d=store.snapshot,pages=d.messageArchives.filter(p=>p.conversationId===target.conversationId)
    if(d.version!==2||!pages.length||d.messages.length>=target.total||d.messages.length+pages.reduce((n,p)=>n+p.messages.length,0)!==target.total||!d.messages.some(m=>m.id==='p7-history-0')||!d.messages.some(m=>m.id==='p7-history-1')||store.hasPendingSave||store.saveError)throw Error('Archive/source/save mismatch')
    return{active:d.messages.length,archived:pages.reduce((n,p)=>n+p.messages.length,0),pages:pages.length,stableSource:true}
  },target))
  await panel.getByRole('searchbox',{name:'查找历史消息'}).fill('星河🚀 café')
  await panel.getByRole('button',{name:'查询历史',exact:true}).click()
  await panel.getByText('合成历史唯一词：星河🚀 Café',{exact:true}).waitFor()
  await record('actual-disk-index-search-and-cross-world-denial',async()=>page.evaluate(async target=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),found=await store.readHistory({...target,text:'星河🚀 café'})
    if(found.messages.length!==1||found.messages[0].id!=='p7-history-26'||!found.pagesRead||!found.bytesRead)throw Error('Search/index not used')
    const other=store.snapshot.worlds.find(w=>w.id!==target.worldId)?.id||'other-synthetic-world'
    let rejected=false;try{await store.readHistory({...target,worldId:other})}catch(error){rejected=error.code==='KANATA_ARCHIVE_SCOPE_DENIED'}
    if(!rejected)throw Error('Cross-world query accepted')
    return{pages:found.pagesRead,bytes:found.bytesRead,crossWorldRejected:true}
  },target))
  await record('actual-page-cursor-and-atomic-stale-cursor-rejection',async()=>page.evaluate(async target=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata')
    let cursor
    for(let i=0;i<4;i++)cursor=(await store.readHistory({...target,cursor})).cursor
    const older=await store.readHistory({...target,cursor})
    if(older.messages.length!==50||!older.pagesRead)throw Error('No actual disk page')
    await store.update(d=>{d.conversations.find(c=>c.id===target.conversationId).revision++})
    let rejected=false;try{await store.readHistory({...target,cursor:older.cursor})}catch(error){rejected=error.code==='KANATA_ARCHIVE_CURSOR_EXPIRED'}
    if(!rejected)throw Error('Stale cursor accepted')
    return{rows:50,pages:older.pagesRead,bytes:older.bytesRead,staleCursorRejected:true}
  },target))
  await panel.getByRole('button',{name:'查询历史',exact:true}).click()
  await panel.getByText('合成历史唯一词：星河🚀 Café',{exact:true}).waitFor()
  await panel.getByRole('button',{name:'修订历史原文',exact:true}).click()
  await page.getByLabel('修订原文',{exact:true}).fill('合成历史修订：仍保留原始消息 ID。')
  await page.getByRole('button',{name:'保存原文修订',exact:true}).click()
  await page.getByLabel('修订原文',{exact:true}).waitFor({state:'hidden'})
  await record('archive-activation-uses-production-revision-and-audit',async()=>page.evaluate(()=>{
    const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot,m=d.messages.find(m=>m.id==='p7-history-26')
    if(m?.revision!==2||!d.messageAudits.some(a=>a.messageId===m.id&&a.previous.revision===1&&a.next.revision===2)||d.messages.find(m=>m.id==='p7-history-27')?.status!=='stopped')throw Error('Historical revision/audit missing')
    return{stableId:m.id,revision:m.revision,audit:true,derivedReplyStopped:true}
  }))
  if(fullBackupAsset){
    await record('product-coordinator-hydrates-and-restores-self-contained-history',async()=>page.evaluate(async({asset,password,total})=>{
      const module=await import('/assets/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
      if(!namespace)throw Error('Actual product backup module unavailable')
      const runtime=namespace.createFullBackupRuntime(),backup=await runtime.exportFull()
      if(backup.data.chat.messages.length!==total||backup.data.chat.messageArchives||backup.data.chat.version!==1)throw Error('Portable history incomplete')
      const before=JSON.stringify(backup.data.chat)
      await runtime.restore(backup,password)
      const after=await runtime.exportFull()
      if(JSON.stringify(after.data.chat)!==before)throw Error('Full restore changed source graph')
      return{version:after.version,messages:after.data.chat.messages.length,selfContained:true,actualCoordinator:true}
    },{asset:fullBackupAsset,password,total:target.total}))
  }
  return target
}
