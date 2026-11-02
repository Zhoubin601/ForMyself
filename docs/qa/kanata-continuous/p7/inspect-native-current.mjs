// Guarded diagnosis/recovery of this run's synthetic fixture only. No arbitrary backup input.
import {_android,chromium} from 'playwright-core'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {decryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {PASSWORD} from '../p3/management-scenarios.mjs'
const execute=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself',root=process.cwd()
const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:30000})).stdout.trim()
const marker=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
assertKanataSyntheticDevice(marker,root,await run(['emu','avd','name']),serial)
if(await run(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('UNMARKED_TEST_APP')
const device=(await _android.devices()).find(d=>d.serial()===serial),view=await device.webView({pkg})
const port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()])
const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true})
const page=browser.contexts()[0].pages()[0],report={syntheticOnly:true,at:new Date().toISOString(),requestsBlocked:0}
await page.route('https://api.deepseek.com/**',route=>{++report.requestsBlocked;return route.abort()})
try{
  report.state=await page.evaluate(()=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,s=stores.get('kanata'),settings=stores.get('settings'),access=stores.get('protectedAccess')
    if(settings.aiApiKey&&!/^(?:sk-)?synthetic(?:[-_]|$)/i.test(settings.aiApiKey))throw Error('NON_SYNTHETIC_CONFIGURATION')
    return{view:settings.currentView,hidden:document.hidden,authenticated:access.authenticated,access:access.status.chat,loaded:s.isDataLoaded,loadError:s.loadError,saveError:s.saveError,pending:s.hasPendingSave,worlds:s.snapshot?.worlds.length,messages:s.snapshot?.messages.length,manager:!!document.querySelector('.kanata-manager'),setup:!!document.querySelector('.kanata-setup'),errors:[...document.querySelectorAll('.kanata-error')].map(e=>e.textContent),headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent)}
  })
  if(process.argv.includes('--restore-baseline')){
    const backup=JSON.parse(decryptPassphraseAes(await readFile(new URL('directory-20261102-native-baseline-1793597463839.enc',import.meta.url),'utf8'),PASSWORD))
    if(backup.data.chat.messages.length!==608||backup.data.chat.messages.find(m=>m.id==='p7-history-26')?.revision!==2)throw Error('INVALID_KNOWN_SYNTHETIC_BASELINE')
    const build=JSON.parse(await readFile(new URL('production-build-directory-20261102.json',import.meta.url),'utf8'))
    const asset=build.resources.find(r=>/^assets\/fullBackupRuntime-.*\.js$/.test(r.path)).path
    report.restored=await page.evaluate(async({backup,password,asset})=>{
      const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,store=stores.get('kanata'),access=stores.get('protectedAccess'),current=store.snapshot
      const originals=new Map(backup.data.chat.messages.map(m=>[m.id,m]))
      if(!current||current.userId!==backup.data.chat.userId||backup.data.chat.messages.some(m=>!current.messages.some(row=>row.id===m.id&&JSON.stringify(row)===JSON.stringify(m)))||current.messages.some(m=>!originals.has(m.id)&&!m.content.includes('合成')))throw Error('UNEXPECTED_NON_FIXTURE_GRAPH')
      const module=await import('/'+asset),namespace=Object.values(module).find(v=>v&&typeof v==='object'&&typeof v.createFullBackupRuntime==='function'),runtime=namespace.createFullBackupRuntime()
      const restored=await access.runOperation(access.moduleIds,()=>runtime.restore(backup,password))
      if(restored===false)throw Error('FIXTURE_RECOVERY_LEASE_NOT_GRANTED')
      const after=await access.runOperation(access.moduleIds,()=>runtime.exportFull())
      const compare=value=>{const copy=JSON.parse(JSON.stringify(value));if(copy.data.todos)delete copy.data.todos.revision;delete copy.createdAt;return JSON.stringify(copy)}
      if(compare(after)!==compare(backup))throw Error('FIXTURE_BASELINE_NOT_EXACT')
      return{actualCoordinator:true,messages:after.data.chat.messages.length,allModulesSettingsMetadata:true}
    },{backup,password:PASSWORD,asset})
  }
  report.status='PASS'
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1}
finally{await writeFile(new URL('native-fixture-diagnosis-20261102.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();await run(['forward','--remove','tcp:'+port]);await device.close()}
process.exit(process.exitCode||0)
