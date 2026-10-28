// Production upgrade of this task's marked synthetic installation only.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {unlockApp,appData} from './chat-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../..'),serial='emulator-5580',pkg='com.yubin.formyself',execute=promisify(execFile)
const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000})).stdout.trim()
const manifest=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(manifest,root,await run(['emu','avd','name']),serial)
if(await run(['shell','run-as '+pkg+' cat files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('Unmarked installation')
const prior=JSON.parse(await readFile(resolve(directory,'native-results.json'),'utf8')),build=JSON.parse(await readFile(resolve(directory,'production-build-verification.json'),'utf8'))
if(prior.status!=='PASS'||build.status!=='PASS'||!build.qaHarnessAbsent)throw Error('Passing scenario and verified candidate required')
const device=(await _android.devices()).find(d=>d.serial()===serial),result={status:'RUNNING',startedAt:new Date().toISOString(),apkSha256:build.apkSha256,checks:[]}
let browser,port,page
try{
  await run(['install','-r','-t',resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')])
  await run(['shell','am','force-stop',pkg])
  const deadline=Date.now()+20000
  while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>deadline)throw Error('Stale WebView before upgrade');await new Promise(r=>setTimeout(r,100))}
  await run(['shell','am','start','-n',pkg+'/.MainActivity'])
  const view=await device.webView({pkg});port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()])
  browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:60000});page=browser.contexts()[0].pages()[0]
  await page.route('https://api.deepseek.com/**',r=>r.abort());await unlockApp(page)
  const d=await appData(page)
  if(d.messages.length!==prior.finalCounts.messages||d.usageEvents.length!==prior.finalCounts.attempts||d.worlds.length!==prior.finalCounts.worlds)throw Error('Upgrade graph mismatch')
  result.checks.push('production-upgrade-cold-preserves-worlds-messages-usage')
  await page.locator('.kanata-frame').evaluate(el=>{el.scrollTop=200})
  const entry=page.locator('.kanata-conversation-list button').first()
  await entry.scrollIntoViewIfNeeded()
  const originalScroll=await page.locator('.kanata-frame').evaluate(el=>el.scrollTop)
  await entry.click()
  await page.waitForFunction(()=>document.querySelector('.kanata-frame').scrollTop===0)
  await page.getByRole('button',{name:'返回世界',exact:true}).click()
  await page.waitForFunction(expected=>Math.abs(document.querySelector('.kanata-frame').scrollTop-expected)<=1,originalScroll)
  result.checks.push('conversation-entry-scroll-and-return-restoration')
  await page.locator('.kanata-conversation-list button').first().click()
  await writeFile(resolve(directory,'native-chat.png'),await device.screenshot())
  await page.waitForTimeout(750);await run(['shell','input','keyevent','KEYCODE_HOME'])
  await page.waitForFunction(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null,null,{polling:100})
  result.checks.push('upgraded-chat-background-releases-plaintext')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{
  result.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'production-upgrade-results.json'),JSON.stringify(result,null,2)+'\n')
  // Disconnect without leaving an unbounded CDP close on a backgrounded WebView.
  if(page)await run(['shell','am','start','-n',pkg+'/.MainActivity']).catch(()=>{})
  if(browser)await Promise.race([browser.close().catch(()=>{}),new Promise(r=>setTimeout(r,5000))])
  if(port)await run(['forward','--remove','tcp:'+port]).catch(()=>{})
  await device.close();console.log(JSON.stringify(result,null,2))
}
