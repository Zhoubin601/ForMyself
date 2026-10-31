import {preserveCapacityEvidence,assessCapacity} from './capacity-evidence.mjs'
// Production build, fresh private browser, actual full-backup coordinator and UI password transaction.
import {connectCapacityWeb} from './web-capacity-support.mjs'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {initializeApp,unlockApp,PASSWORD} from '../p3/management-scenarios.mjs'
const count=Number(process.argv[2]),root=process.cwd()
if(![1000,10000,100000].includes(count))throw Error('SYNTHETIC_CAPACITY_SIZE_REQUIRED')
const tag=process.argv[3]||'p7-archive-optimized',port=Number(process.argv[4]||4175)
if(!/^p7-[a-z0-9-]+$/.test(tag)||!Number.isInteger(port)||port<4175||port>4190)throw Error('INVALID_LOCAL_CAPACITY_BUILD')
const frozen=resolve(root,'.kanata-web-dist.local/'+tag),marker=JSON.parse(await readFile(resolve(frozen,'qa-build.json'),'utf8'))
if(marker.syntheticOnly!==true||!marker.productionPreview)throw Error('UNMARKED_FROZEN_BUILD')
const asset=(await readdir(resolve(frozen,'assets'))).find(name=>name.startsWith('fullBackupRuntime-')&&name.endsWith('.js'))
const result={status:'RUNNING',at:new Date().toISOString(),count,syntheticOnly:true,kind:'production-chrome-actual-coordinator',forcedGC:false,build:marker,metrics:{},pageErrors:[],aiRequests:0}
const web=await connectCapacityWeb(count,marker)
let page=web.page
const observe=async()=>{
  page.on('pageerror',error=>result.pageErrors.push(error.message));page.on('crash',()=>{result.rendererCrashed=true})
  await page.route('https://api.deepseek.com/**',route=>{++result.aiRequests;return route.abort()})
}
await observe()
result.coldBrowserProcessRestart=true
const destination=new URL(`web-capacity-${count}.json`,import.meta.url)
await preserveCapacityEvidence(destination)
const save=()=>writeFile(destination,JSON.stringify(result,null,2)+'\n')
const memory=()=>web.memory()
const measure=async(name,action)=>{
  result.activeOperation={name,at:new Date().toISOString()};await save()
  const start=performance.now();let timer
  try{
    const task=action();task.catch(()=>{})
    const value=await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CAPACITY_OPERATION_TIMEOUT:'+name)),180000)})])
    result.metrics[name]={ms:Math.round((performance.now()-start)*10)/10,value,memory:await memory()};delete result.activeOperation;console.log('MEASURED',count,name);await save();return value
  }catch(error){result.metrics[name]={status:'FAIL',ms:Math.round((performance.now()-start)*10)/10,error:error.message};await save();throw error}
  finally{clearTimeout(timer)}
}
try{
  await page.goto('http://127.0.0.1:'+port);await initializeApp(page)
  await page.evaluate(async({asset,count})=>{
    const module=await import('/assets/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
    if(!namespace)throw Error('ACTUAL_BACKUP_RUNTIME_MISSING')
    const runtime=namespace.createFullBackupRuntime(),backup=await runtime.exportFull(),data=backup.data.chat,c=data.conversations.find(c=>c.type==='private'),actor=data.instances.find(i=>c.participantIds.includes(i.id)),identity=data.identities.find(i=>i.worldId===c.worldId),now=Date.UTC(2026,9,29)
    data.messages=Array.from({length:count},(_,n)=>({id:'web-capacity-message-'+n,worldId:c.worldId,conversationId:c.id,role:n%2?'assistant':'user',senderType:n%2?'character':'user',senderId:n%2?actor.id:identity.id,senderNameSnapshot:n%2?'合成角色':'合成用户',content:('合成容量正文'+n+'，不含真实资料。').padEnd(128,'测'),createdAt:now+n,revision:1,status:'complete',turnId:'web-capacity-turn-'+Math.floor(n/2),batchId:'web-capacity-batch-'+Math.floor(n/2),...(n%2?{replyToMessageId:'web-capacity-message-'+(n-1),replyToRevision:1}:{})}))
    data.memories=Array.from({length:20},(_,n)=>({id:'web-capacity-memory-'+n,worldId:c.worldId,ownerType:'character',ownerId:actor.id,layer:'L3',key:'合成偏好'+n,content:'有来源的合成记忆'+n,sourceRefs:[{messageId:data.messages[n].id,revision:1}],status:'active',revision:1,visibility:'private'}))
    window.__kanataCapacity={runtime,backup,scope:{worldId:c.worldId,conversationId:c.id},proof:{actorId:actor.id,identityId:identity.id,now}}
  },{asset,count})
  await page.evaluate(()=>{const access=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('protectedAccess');window.__kanataCapacity.run=action=>access.runOperation(access.moduleIds,action)})
  await measure('portableImportActualCoordinator',()=>page.evaluate(async password=>{
    const state=window.__kanataCapacity,expected=state.backup.data.chat.messages.length,outcome=await state.run(()=>state.runtime.restore(state.backup,password));state.backup=null
    if(outcome===false)throw Error('SYNTHETIC_IMPORT_LEASE_NOT_GRANTED')
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await store.flush()
    if(store.snapshot.messages.length+(store.snapshot.messageArchives?.reduce((n,p)=>n+p.messages.length,0)||0)!==expected)throw Error('IMPORT_GRAPH_COUNT_MISMATCH')
    return{active:store.snapshot.messages.length,archived:store.snapshot.messageArchives?.reduce((n,p)=>n+p.messages.length,0)||0,saved:!store.hasPendingSave&&!store.saveError}
  },PASSWORD))
  const {scope,proof}=await page.evaluate(()=>({scope:window.__kanataCapacity.scope,proof:window.__kanataCapacity.proof}))
  await measure('coldPageReloadAndProtectedLoad',async()=>{
    page=await web.cold();await observe();await page.goto('http://127.0.0.1:'+port);await unlockApp(page)
    const protectedLoadMs=await page.evaluate(()=>performance.getEntriesByName('protected:chat:load','measure').at(-1)?.duration)
    if(!Number.isFinite(protectedLoadMs))throw Error('PROTECTED_COLD_LOAD_COUNTER_UNAVAILABLE')
    return{loaded:true,protectedLoadMs}
  })
  await page.evaluate(async({asset,scope,proof})=>{
    const module=await import('/assets/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
    const access=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('protectedAccess')
    window.__kanataCapacity={runtime:namespace.createFullBackupRuntime(),backup:null,scope,proof,run:action=>access.runOperation(access.moduleIds,action)}
  },{asset,scope,proof})
  await page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),scope=window.__kanataCapacity.scope
    if(!store.snapshot.messageArchives?.length)await store.archiveHistory({...scope,keepRecent:200})
    let cursor;for(let i=0;i<4;i++)cursor=(await store.readHistory({...scope,cursor})).cursor
    window.__kanataCapacity.cursor=cursor
  })
  await measure('diskPage50',()=>page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),state=window.__kanataCapacity
    const page=await store.readHistory({...state.scope,cursor:state.cursor});if(!page.pagesRead||page.messages.length!==50)throw Error('NOT_TRUE_DISK_PAGE')
    return{rows:50,pages:page.pagesRead,bytes:page.bytesRead}
  }))
  await measure('indexedExactSearch',()=>page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),found=await store.readHistory({...window.__kanataCapacity.scope,text:'合成容量正文777，'})
    if(found.messages.length!==1||found.messages[0].id!=='web-capacity-message-777'||!found.pagesRead)throw Error('INDEX_QUERY_MISMATCH')
    return{matches:1,pages:found.pagesRead,bytes:found.bytesRead}
  }))
  await measure('saveHeader',()=>page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await store.update(d=>{d.worlds[0].name+=' · 合成容量'});await store.flush();return{saved:!store.saveError&&!store.hasPendingSave}
  }))
  await measure('fullExportActualCoordinator',()=>page.evaluate(async count=>{
    const state=window.__kanataCapacity;state.backup=await state.run(()=>state.runtime.exportFull())
    if(state.backup.data.chat.messages.length!==count||state.backup.data.chat.messageArchives)throw Error('EXPORT_COUNT_MISMATCH')
    return{version:state.backup.version,messages:count,selfContained:true}
  },count))
  await measure('fullRestoreActualCoordinator',()=>page.evaluate(async({password,count})=>{
    const state=window.__kanataCapacity
    state.expectedMemories=JSON.stringify(state.backup.data.chat.memories)
    const outcome=await state.run(()=>state.runtime.restore(state.backup,password));state.backup=null
    if(outcome===false)throw Error('SYNTHETIC_RESTORE_LEASE_NOT_GRANTED')
    return{actualCoordinator:true,expectedCount:count}
  },{password:PASSWORD,count}))
  await measure('restoredMessageProofExportVerification',()=>page.evaluate(async count=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,access=stores.get('protectedAccess')
    if(!access.authenticated)throw Error('SYNTHETIC_REAUTH_REQUIRED_AFTER_RESTORE')
    const state=window.__kanataCapacity,after=await state.run(()=>state.runtime.exportFull()),{actorId,identityId,now}=state.proof,scope=state.scope
    // Regenerate the original deterministic fixture one row at a time. Do not retain a second
    // full plaintext export after restore solely for proof; real import UI also releases its input.
    const seen=new Set()
    const mismatch=after.data.chat.messages.some(m=>{
      const n=Number(m.id.slice('web-capacity-message-'.length))
      if(!m.id.startsWith('web-capacity-message-')||!Number.isSafeInteger(n)||n<0||n>=count||seen.has(n))return true
      seen.add(n)
      const expected={id:'web-capacity-message-'+n,...scope,role:n%2?'assistant':'user',senderType:n%2?'character':'user',senderId:n%2?actorId:identityId,senderNameSnapshot:n%2?'合成角色':'合成用户',content:('合成容量正文'+n+'，不含真实资料。').padEnd(128,'测'),createdAt:now+n,revision:1,status:'complete',turnId:'web-capacity-turn-'+Math.floor(n/2),batchId:'web-capacity-batch-'+Math.floor(n/2),...(n%2?{replyToMessageId:'web-capacity-message-'+(n-1),replyToRevision:1}:{})}
      return JSON.stringify(m)!==JSON.stringify(expected)
    })
    if(after.data.chat.messages.length!==count||mismatch||JSON.stringify(after.data.chat.memories)!==state.expectedMemories)throw Error('RESTORE_MESSAGE_SOURCE_PROOF_MISMATCH')
    return{messages:count,exactOriginalMessageProofs:true,memories:20,actualCoordinator:true,fixtureRegeneratedWithoutRetainedPlaintextCopy:true}
  },count))
  // The UI uses the product masterPasswordChangeTransaction and safe credential commit, not a test substitute.
  await page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata')
    if(!store.snapshot.messageArchives?.length)await store.archiveHistory({...window.__kanataCapacity.scope,keepRecent:200})
  })
  await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').openGeneralSettingsSection('security'))
  await page.getByRole('button',{name:'传统密码验证修改',exact:true}).click()
  const next='Synthetic-Kanata-P7-capacity-next'
  await page.getByPlaceholder('原主密码',{exact:true}).fill(PASSWORD);await page.getByPlaceholder('新主密码',{exact:true}).fill(next);await page.getByPlaceholder('确认新主密码',{exact:true}).fill(next)
  await measure('masterPasswordActualUiTransaction',async()=>{
    await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByPlaceholder('原主密码',{exact:true}).waitFor({state:'hidden'})
    return page.evaluate(async({next,old,scope})=>{
      const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,auth=stores.get('auth'),access=stores.get('protectedAccess'),store=stores.get('kanata')
      if(!await auth.unlockWithPassword(next)||!await access.ensureModule('chat'))throw Error('NEW_CREDENTIAL_OR_STORE_REJECTED')
      const found=await store.readHistory({...scope,text:'合成容量正文777，'});if(found.messages.length!==1)throw Error('REKEY_BODY_LOST')
      await store.release();const oldAccepted=await store.load(old);if(oldAccepted)throw Error('OLD_PASSWORD_ACCEPTED')
      if(!await store.load(next))throw Error('NEW_PASSWORD_COLD_READ_FAILED')
      return{newCredential:true,oldPasswordRejected:true,pagedBodyPreserved:true}
    },{next,old:PASSWORD,scope})
  })
  if(result.pageErrors.length||result.aiRequests||result.rendererCrashed)throw Error('UNEXPECTED_PAGE_OR_MODEL_EVENT')
  assessCapacity(result,768)
  if(result.status!=='PASS')process.exitCode=1
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1;console.error(error)}
finally{await save();await preserveCapacityEvidence(destination);await web.close()}
