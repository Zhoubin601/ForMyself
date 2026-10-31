// This task's marked, isolated production installation only. No clear/uninstall or real key access.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {unlockApp,PASSWORD} from '../p3/management-scenarios.mjs'
import {verifyArchiveHistory} from './archive-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../..'),serial='emulator-5580',pkg='com.yubin.formyself',execute=promisify(execFile)
const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000,maxBuffer:4*1024*1024})).stdout.trim()
const manifest=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(manifest,root,await run(['emu','avd','name']),serial)
if(await run(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('Unmarked installation')
const build=JSON.parse(await readFile(resolve(directory,'production-build-verification.json'),'utf8')),apk=resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')
if(build.status!=='PASS'||!build.qaHarnessAbsent||build.apkSha256!==createHash('sha256').update(await readFile(apk)).digest('hex'))throw Error('Unverified production candidate')
const installed=await run(['shell','dumpsys','package',pkg]);if(!installed.includes('versionName='))throw Error('Missing synthetic package')
const result={status:'RUNNING',at:new Date().toISOString(),apkSha256:build.apkSha256,checks:{},pageErrors:[],aiRequests:0,realDevice:false}
const save=()=>writeFile(new URL('native-archive-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
const record=async(name,action)=>{const start=Date.now(),value=await action();result.checks[name]={status:'PASS',ms:Date.now()-start,result:value};console.log('PASS',name);await save();return value}
const device=(await _android.devices()).find(d=>d.serial()===serial),browsers=[],ports=[]
let page
const attach=async()=>{
  await run(['shell','am','start','-n',pkg+'/.MainActivity'])
  const view=await device.webView({pkg}),port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()]);ports.push(port)
  const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:90000});browsers.push(browser)
  page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(60000);page.on('pageerror',e=>result.pageErrors.push(e.message))
  await page.route('https://api.deepseek.com/**',route=>{++result.aiRequests;return route.abort()})
  await unlockApp(page)
}
try{
  if(!device)throw Error('Missing isolated device')
  await attach()
  const asset=(await readdir(resolve(root,'dist/assets'))).find(f=>f.startsWith('fullBackupRuntime-')&&f.endsWith('.js'))
  const target=await verifyArchiveHistory(page,record,{fullBackupAsset:asset,password:PASSWORD})
  await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings').switchView('chat'))
  await page.getByRole('button',{name:target.title,exact:true}).click();await page.getByRole('button',{name:'查找或整理历史',exact:true}).click()
  const panel=page.getByRole('region',{name:'会话历史',exact:true});await panel.getByRole('button',{name:'查询历史',exact:true}).click();await panel.locator('article').first().waitFor()
  await page.screenshot({path:resolve(directory,'native-history.png')})
  await page.waitForTimeout(750);await run(['shell','input','keyevent','KEYCODE_HOME'])
  await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null,null,{polling:100})
  await record('native-background-clears-history-body-and-query',async()=>{
    if(await page.getByRole('region',{name:'会话历史',exact:true}).count())throw Error('Sensitive history panel survived background')
    return{protectedSnapshotNull:true,historyUnmounted:true}
  })
  await run(['shell','am','force-stop',pkg]);const deadline=Date.now()+20000
  while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>deadline)throw Error('Stale view after force stop');await new Promise(resolve=>setTimeout(resolve,100))}
  await attach()
  await record('native-force-stop-cold-read-preserves-entire-portable-history-and-audit',async()=>page.evaluate(target=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata'),d=store.snapshot
    if(d.messages.length!==target.total||d.messages.find(m=>m.id==='p7-history-26')?.revision!==2||!d.messageAudits.some(a=>a.messageId==='p7-history-26')||store.saveError||store.hasPendingSave)throw Error('Cold graph or persistence mismatch')
    return{messages:d.messages.length,audit:true,saved:true}
  },target))
  if(result.aiRequests||result.pageErrors.length)throw Error('Unexpected model call/page error')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;console.error(error);process.exitCode=1}
finally{await save();for(const browser of browsers){let timer;try{await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,4000)})])}finally{clearTimeout(timer)}}for(const port of ports)await run(['forward','--remove','tcp:'+port]).catch(()=>{});await device?.close()}
