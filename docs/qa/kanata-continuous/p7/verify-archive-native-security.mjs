// Upgrade this task's 608-message synthetic graph, verify v2 cold reads and actual settings password UI.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {unlockApp,PASSWORD} from '../p3/management-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../..'),serial='emulator-5580',pkg='com.yubin.formyself',execute=promisify(execFile)
const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000,maxBuffer:4*1024*1024})).stdout.trim()
const manifest=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(manifest,root,await run(['emu','avd','name']),serial)
if(await run(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('Unmarked installation')
const build=JSON.parse(await readFile(resolve(directory,'production-build-verification.json'),'utf8')),apk=resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')
if(build.status!=='PASS'||!build.qaHarnessAbsent||build.apkSha256!==createHash('sha256').update(await readFile(apk)).digest('hex'))throw Error('Unverified production APK')
const result={status:'RUNNING',at:new Date().toISOString(),apkSha256:build.apkSha256,checks:{},pageErrors:[],aiRequests:0,realDevice:false}
const save=()=>writeFile(new URL('native-archive-security-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
const record=async(name,action)=>{const start=Date.now(),value=await action();result.checks[name]={status:'PASS',ms:Date.now()-start,result:value};console.log('PASS',name);await save();return value}
const device=(await _android.devices()).find(d=>d.serial()===serial),browsers=[],ports=[]
let page
const stopped=async()=>{const deadline=Date.now()+20000;while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>deadline)throw Error('Stale WebView');await new Promise(resolve=>setTimeout(resolve,100))}}
const attach=async()=>{
  await run(['shell','am','start','-n',pkg+'/.MainActivity'])
  const view=await device.webView({pkg}),port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()]);ports.push(port)
  const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:90000});browsers.push(browser)
  page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(90000);page.on('pageerror',e=>result.pageErrors.push(e.message))
  await page.route('https://api.deepseek.com/**',route=>{++result.aiRequests;return route.abort()})
  await unlockApp(page)
}
const changePassword=async(from,to)=>{
  await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').openGeneralSettingsSection('security'))
  await page.getByRole('button',{name:'传统密码验证修改',exact:true}).click()
  await page.getByPlaceholder('原主密码',{exact:true}).fill(from);await page.getByPlaceholder('新主密码',{exact:true}).fill(to);await page.getByPlaceholder('确认新主密码',{exact:true}).fill(to)
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByPlaceholder('原主密码',{exact:true}).waitFor({state:'hidden'})
}
try{
  if(!device)throw Error('Missing task AVD')
  await run(['install','-r','-t',apk]);await run(['shell','am','force-stop',pkg]);await stopped();await attach()
  const scope=await record('upgraded-graph-preserved-and-rearchived-with-verified-pending-semantics',async()=>page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),data=store.snapshot,source=data.messages.find(m=>m.id==='p7-history-26')
    if(!source||source.revision!==2||data.messages.length+(data.messageArchives?.reduce((n,p)=>n+p.messages.length,0)||0)!==608)throw Error('Expected prior isolated graph missing')
    const scope={worldId:source.worldId,conversationId:source.conversationId}
    await store.update(d=>{for(const world of d.worlds){world.autonomyEnabled=false;world.proactiveEnabled=false}})
    await store.archiveHistory({...scope,keepRecent:200});await store.flush()
    if(store.snapshot.version!==2||!store.snapshot.messageArchives?.length||store.saveError||store.hasPendingSave)throw Error('Not durably archived')
    return scope
  }))
  await run(['shell','am','force-stop',pkg]);await stopped();await attach()
  await record('native-version2-cold-load-uses-real-stat-and-pages-with-source-proofs',async()=>page.evaluate(async scope=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),d=store.snapshot,found=await store.readHistory({...scope,text:'合成历史正文 300'})
    if(d.version!==2||found.messages.length!==1||found.messages[0].id!=='p7-history-300'||!found.pagesRead||!d.messages.some(m=>m.id==='p7-history-0'))throw Error('Cold page/source mismatch')
    return{active:d.messages.length,pagesRead:found.pagesRead,bytesRead:found.bytesRead,sourceRetained:true}
  },scope))
  const next='Synthetic-Kanata-P7-native-next'
  await record('native-actual-master-password-ui-transaction-rekeys-pages-and-credentials',async()=>{
    await changePassword(PASSWORD,next)
    return page.evaluate(async({password,old,scope})=>{
      const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,auth=stores.get('auth'),access=stores.get('protectedAccess'),store=stores.get('kanata')
      if(!await auth.unlockWithPassword(password)||!await access.ensureModule('chat'))throw Error('New native credential rejected')
      const found=await store.readHistory({...scope,text:'合成历史正文 300'});if(found.messages.length!==1)throw Error('New password lost historical body')
      await store.release();if(await store.load(old))throw Error('Old password could read canonical/backup')
      if(!await store.load(password))throw Error('New native password cold read failed')
      return{nativeCredential:true,newPasswordReadsAllFiles:true,oldPasswordRejected:true}
    },{password:next,old:PASSWORD,scope})
  })
  await record('only-current-password-page-copies-remain-in-owned-archive-directory',async()=>{
    const keys=await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messageArchives.map(p=>p.key+'.enc'))
    const files=(await run(['shell','run-as',pkg,'ls','-1','files/formyself/kanata-pages-v1'])).split(/\r?\n/).filter(Boolean)
    if(files.length!==keys.length||files.some(file=>!keys.includes(file)))throw Error('Unretired encrypted page copies remain')
    return{referencedPages:keys.length,files:files.length,noOldOrphanCopies:true}
  })
  await record('native-real-password-transaction-back-to-original-synthetic-credential',async()=>{
    await changePassword(next,PASSWORD);await unlockApp(page)
    return page.evaluate(async scope=>{
      const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),d=store.snapshot,found=await store.readHistory({...scope,text:'合成历史正文 300'})
      if(d.messages.length+d.messageArchives.reduce((n,p)=>n+p.messages.length,0)!==608||found.messages.length!==1||!d.messageAudits.some(a=>a.messageId==='p7-history-26'))throw Error('Restored credential lost graph/audit')
      return{messages:608,audit:true,originalSyntheticCredentialRestored:true}
    },scope)
  })
  const asset=(await readdir(resolve(root,'dist/assets'))).find(name=>name.startsWith('fullBackupRuntime-')&&name.endsWith('.js'))
  await record('native-authenticated-compressed-journal-in-actual-full-backup-coordinator',async()=>page.evaluate(async({asset,password})=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,access=stores.get('protectedAccess'),module=await import('/assets/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
    if(!namespace)throw Error('Actual runtime unavailable')
    const runtime=namespace.createFullBackupRuntime(),backup=await access.runOperation(access.moduleIds,()=>runtime.exportFull())
    if(!backup||backup.data.chat.messages.length!==608||backup.data.chat.messageArchives)throw Error('Portable body capture incomplete')
    const bytes=new TextEncoder().encode(JSON.stringify(backup)).length
    if(bytes<=256*1024)throw Error('Fixture does not exercise compressed journal')
    await access.runOperation(access.moduleIds,()=>runtime.restore(backup,password))
    const after=await access.runOperation(access.moduleIds,()=>runtime.exportFull()),beforeById=new Map(backup.data.chat.messages.map(m=>[m.id,m]))
    if(after.data.chat.messages.length!==608||after.data.chat.messages.some(m=>JSON.stringify(m)!==JSON.stringify(beforeById.get(m.id)))||JSON.stringify(backup.data.chat.messageAudits)!==JSON.stringify(after.data.chat.messageAudits))throw Error('Codec roundtrip lost source/audit')
    return{messages:608,portableBytes:bytes,exactOriginals:true,exactAudits:true,actualCoordinator:true,outerCryptoProtocolVersion:1}
  },{asset,password:PASSWORD}))
  if(result.pageErrors.length||result.aiRequests)throw Error('Unexpected provider or UI error')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;console.error(error);process.exitCode=1}
finally{await save();for(const browser of browsers){let timer;try{await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,4000)})])}finally{clearTimeout(timer)}}for(const port of ports)await run(['forward','--remove','tcp:'+port]).catch(()=>{});await device?.close()}
