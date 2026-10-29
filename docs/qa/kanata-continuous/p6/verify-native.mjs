// Actual production APK, fresh task-owned AVD only. Never clear/uninstall user data.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { _android, chromium } from 'playwright-core'
import { assertKanataSyntheticDevice } from '../../../../scripts/kanata-device-guard.mjs'
import { PASSWORD, initializeApp, unlockApp, appData, verifyActivity } from './activity-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../..')
const execute=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself'
const adb=resolve(process.env.ANDROID_HOME||'E:/Android/Sdk','platform-tools/adb.exe')
const run=async args=>(await execute(adb,['-s',serial,...args],{timeout:120000,maxBuffer:8*1024*1024})).stdout.trim()
const manifest=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(manifest,root,await run(['emu','avd','name']),serial)
if(await run(['shell','getprop','sys.boot_completed'])!=='1')throw Error('Device not booted')
const build=JSON.parse(await readFile(resolve(directory,'production-build-verification.json'),'utf8'))
const apk=resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')
if(build.status!=='PASS'||!build.qaHarnessAbsent||build.apkSha256!==createHash('sha256').update(await readFile(apk)).digest('hex'))throw Error('Unverified production APK')
if((await run(['shell','pm','list','packages',pkg])).includes('package:'+pkg))throw Error('Fresh blank task AVD required; existing installation preserved')
const device=(await _android.devices()).find(d=>d.serial()===serial)
if(!device)throw Error('Missing isolated device')
device.setDefaultTimeout(60000)
const results={startedAt:new Date().toISOString(),status:'RUNNING',serial,avd:manifest.name,apkSha256:build.apkSha256,checks:{},pageErrors:[],aiRequests:0}
const save=()=>writeFile(resolve(directory,'native-results.json'),JSON.stringify(results,null,2)+'\n')
const record=async(label,action)=>{const start=Date.now();const value=await action();results.checks[label]={status:'PASS',elapsedMs:Date.now()-start,result:value};console.log('PASS',label);await save();return value}
const browsers=[],ports=[]
let page
const waitStopped=async()=>{const deadline=Date.now()+20000;while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>deadline)throw Error('Stale WebView after force stop');await new Promise(resolve=>setTimeout(resolve,100))}}
const attach=async()=>{
  for(let attempt=0;attempt<3;attempt++){
    try{
      await run(['shell','input','keyevent','KEYCODE_WAKEUP']);await run(['shell','wm','dismiss-keyguard'])
      await run(['shell','am','start','-n',pkg+'/.MainActivity'])
      const view=await device.webView({pkg}),port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()]);ports.push(port)
      const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:90000});browsers.push(browser)
      page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(60000)
      page.on('pageerror',e=>results.pageErrors.push(e.message))
      page.on('request',request=>{if(request.url().startsWith('https://api.deepseek.com/'))results.actualHttpRequests=(results.actualHttpRequests||0)+1})
      await page.route('https://api.deepseek.com/**',route=>{results.aiRequests++;return route.abort()})
      await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('auth')?.isDataLoaded)
      return
    }catch(error){
      if(attempt===2||!/Target page, context or browser has been closed|socket hang up|ECONNRESET/.test(error.message))throw error
      ;(results.attachRetries||=[]).push({attempt,message:error.message})
      await run(['shell','am','force-stop',pkg]);await waitStopped()
    }
  }
}
const cold=async()=>{await run(['shell','am','force-stop',pkg]);await waitStopped();await attach();await unlockApp(page)}
const bounded=async action=>{let timer;try{await Promise.race([action(),new Promise(resolve=>{timer=setTimeout(resolve,5000)})])}catch{/* retain scenario result */}finally{clearTimeout(timer)}}
try{
  results.environment={android:await run(['shell','getprop','ro.build.version.release']),api:await run(['shell','getprop','ro.build.version.sdk']),webview:await run(['shell','dumpsys','webviewupdate'])}
  await record('install-production-apk',()=>run(['install','-t',apk]))
  await run(['shell','run-as',pkg,'mkdir','-p','files'])
  await run(['shell',"run-as "+pkg+" sh -c 'printf KanataP2Synthetic34:20261028:new-empty-avd > files/kanata-qa-isolation.txt'"])
  await run(['shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS'])
  await run(['shell','svc','power','stayon','true'])
  await attach();await initializeApp(page)
  results.finalCounts=await verifyActivity(page,record,{nativeNotification:true})
  await record('native-denied-notifications-still-preserve-generated-contact',async()=>{
    await run(['shell','pm','revoke',pkg,'android.permission.POST_NOTIFICATIONS'])
    // Runtime permission revocation may kill the Android process. Reopen normally through
    // the existing auth flow; never reset the product session guard to keep CDP connected.
    await cold()
    await page.unroute('https://api.deepseek.com/**')
    await page.route('https://api.deepseek.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成的系统拒绝通知场景问候。'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,prompt_cache_hit_tokens:0}})}))
    await page.locator('.kanata-world-toolbar .kanata-selection').click();await page.locator('.feedback-options button').last().click()
    await page.getByRole('button',{name:'世界日常与视角',exact:true}).click()
    await page.getByLabel('角色主动联系',{exact:true}).check();await page.getByLabel('本地通知',{exact:true}).check()
    await page.getByRole('button',{name:'保存世界开关',exact:true}).click()
    await page.getByLabel('允许主动联系',{exact:true}).first().check();await page.getByRole('button',{name:'保存角色与日程',exact:true}).click()
    await page.getByRole('button',{name:'检查主动联系',exact:true}).click()
    const worldId=await page.evaluate(()=>{const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot;return d.worlds.at(-1).id})
    await page.evaluate(async worldId=>{const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata');await store.update(d=>{const task=d.tasks.find(t=>t.worldId===worldId&&t.contact);if(!task)throw Error('Native contact not queued');task.notBefore=Date.now()-1000;task.contact.expiresAt=Date.now()+600000})},worldId)
    await page.getByRole('button',{name:'检查主动联系',exact:true}).click()
    await page.waitForFunction(worldId=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.tasks.some(t=>t.worldId===worldId&&t.contact?.notificationState==='denied'&&t.state==='succeeded'),worldId)
    const data=await appData(page)
    if(data.messages.length!==8||data.usageEvents.length!==7)throw Error('Denied notification lost contact or duplicated requests')
    results.finalCounts={...results.finalCounts,messages:data.messages.length,attempts:data.usageEvents.length,requests:results.actualHttpRequests}
    return{savedMessage:true,systemPermissionDenied:true}
  })
  await record('native-full-backup-p6-activity-tasks-and-history',async()=>{
    const asset=(await readdir(resolve(root,'dist/assets'))).find(f=>f.startsWith('fullBackupRuntime-')&&f.endsWith('.js'))
    const restored=await page.evaluate(async({asset,password})=>{
      const module=await import('/assets/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function')
      if(!namespace)throw Error('Actual runtime export missing')
      const runtime=namespace.createFullBackupRuntime(),backup=await runtime.exportFull()
      const before=JSON.stringify(backup.data.chat)
      await runtime.restore(backup,password)
      const after=await runtime.exportFull()
      if(before!==JSON.stringify(after.data.chat))throw Error('Backup graph/asset mismatch')
      if(!after.data.chat.autonomyPolicies?.length||!after.data.chat.virtualSchedules?.length||!after.data.chat.tasks.some(t=>t.social)||!after.data.chat.tasks.some(t=>t.contact)||!after.data.chat.effectBaselines?.length)throw Error('Activity provenance missing')
      return{version:after.version,worlds:after.data.chat.worlds.length,attempts:after.data.chat.usageEvents.length,exactGraph:true}
    },{asset,password:PASSWORD})
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').switchView('chat'))
    await page.locator('.kanata-manager').waitFor();return restored
  })
  await record('native-final-cold-reload',async()=>{await cold();const d=await appData(page);if(d.worlds.length!==results.finalCounts.worlds||d.instances.length!==results.finalCounts.instances||d.messages.length!==results.finalCounts.messages||d.usageEvents.length!==results.finalCounts.attempts)throw Error('Cold final graph mismatch');return true})
  await writeFile(resolve(directory,'native-world-manager.png'),await device.screenshot())
  await record('native-background-releases-plaintext',async()=>{
    // Keychain lookup on cold startup uses the existing 500ms native-Activity guard.
    // Let that documented grace period settle before testing a genuine Home transition.
    await page.waitForTimeout(750)
    await run(['shell','input','keyevent','KEYCODE_HOME'])
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null,null,{polling:100})
    if(await page.locator('.kanata-manager').count())throw Error('Sensitive page retained in background')
    await run(['shell','am','start','-n',pkg+'/.MainActivity'])
    if(!await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').isLocked))throw Error('Unexpected unlocked foreground')
    await unlockApp(page);return{lockedAndPlaintextReleasedBeforeUnlock:true}
  })
  await record('native-owned-dialog-expiry',async()=>{
    await page.getByRole('button',{name:'重命名世界',exact:true}).click()
    await page.locator('.feedback-input').waitFor()
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
    await page.waitForFunction(()=>!document.querySelector('.kanata-manager')&&!document.querySelector('.feedback-input'))
    return true
  })
  if(results.pageErrors.length)throw Error('Unexpected page error')
  results.status='PASS'
}catch(error){results.status='FAIL';results.error=error.message;process.exitCode=1;console.error(error);if(page){results.visibleText=await page.locator('body').innerText().catch(()=>'');await writeFile(resolve(directory,'native-failure.png'),await device.screenshot()).catch(()=>{})}}
finally{
  results.finishedAt=new Date().toISOString();await save()
  for(const browser of browsers)await bounded(()=>browser.close())
  for(const port of ports)await run(['forward','--remove','tcp:'+port]).catch(()=>{})
  await bounded(()=>device.close())
}
