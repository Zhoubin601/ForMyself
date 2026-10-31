// Upgrade only this task's marked synthetic production installation. No clear/uninstall.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {unlockApp,appData} from '../p3/management-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../..'),serial='emulator-5580',pkg='com.yubin.formyself',execute=promisify(execFile)
const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000,maxBuffer:4*1024*1024})).stdout.trim()
const manifest=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(manifest,root,await run(['emu','avd','name']),serial)
if(await run(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('Unmarked installation')
const build=JSON.parse(await readFile(resolve(directory,'production-build-verification.json'),'utf8')),apk=resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')
if(build.status!=='PASS'||!build.qaHarnessAbsent||build.apkSha256!==createHash('sha256').update(await readFile(apk)).digest('hex'))throw Error('Unverified production candidate')
const prior=JSON.parse(await readFile(resolve(directory,'../p6/native-results.json'),'utf8'))
if(prior.status!=='PASS')throw Error('Passing P6 device graph required')
const device=(await _android.devices()).find(d=>d.serial()===serial),result={status:'RUNNING',at:new Date().toISOString(),apkSha256:build.apkSha256,checks:[],pageErrors:[],aiRequests:0}
let browser,page,port
try{
  if(!device)throw Error('Missing task device')
  await run(['install','-r','-t',apk]);await run(['shell','am','force-stop',pkg])
  const deadline=Date.now()+20000
  while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>deadline)throw Error('Stale WebView');await new Promise(r=>setTimeout(r,100))}
  await run(['shell','am','start','-n',pkg+'/.MainActivity'])
  const view=await device.webView({pkg});port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()])
  browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:60000});page=browser.contexts()[0].pages()[0]
  page.on('pageerror',e=>result.pageErrors.push(e.message));await page.route('https://api.deepseek.com/**',r=>{result.aiRequests++;return r.abort()})
  await unlockApp(page);const data=await appData(page)
  if(data.messages.length!==prior.finalCounts.messages||data.worlds.length!==prior.finalCounts.worlds||data.usageEvents.length!==prior.finalCounts.attempts)throw Error('Upgrade graph mismatch')
  result.checks.push('P6 graph survives production validation optimization')
  const proof=await page.evaluate(async()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),before=JSON.stringify(store.snapshot),message=store.snapshot.messages.find(m=>m.replyToMessageId)
    if(!message)throw Error('Reply proof fixture missing')
    let code='';try{await store.update(d=>{d.messages.find(m=>m.id===message.id).replyToRevision=999})}catch(error){code=error.code||error.message}
    if(!code.includes('INVALID_REPLY_SOURCE_REVISION')||JSON.stringify(store.snapshot)!==before)throw Error('Invalid proof was not atomically rejected')
    const name=store.snapshot.worlds[0].name
    await store.update(d=>{d.worlds[0].name=name+' · 合成校验'});await store.flush()
    await store.update(d=>{d.worlds[0].name=name});await store.flush()
    return{invalidRevisionRejected:true,graphUnchangedOnFailure:true,realSaveAndFlush:true}
  })
  result.checks.push(proof)
  await page.waitForTimeout(750);await run(['shell','input','keyevent','KEYCODE_HOME'])
  await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null,null,{polling:100})
  result.checks.push('background releases protected snapshot')
  if(result.aiRequests||result.pageErrors.length)throw Error('Unexpected provider request or page error')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1;console.error(error)}
finally{result.finishedAt=new Date().toISOString();await writeFile(new URL('native-validation-upgrade-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');if(page)await run(['shell','am','start','-n',pkg+'/.MainActivity']).catch(()=>{});let timer;try{await Promise.race([browser?.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,5000)})])}finally{clearTimeout(timer)}if(port)await run(['forward','--remove','tcp:'+port]).catch(()=>{});await device?.close()}
