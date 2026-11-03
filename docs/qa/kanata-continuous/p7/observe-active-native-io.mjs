// Attach diagnostic instrumentation to an already failed synthetic capacity sample.
// No install, launch, navigation, authentication or Store action. Never use for a PASS sample.
import {readFile,writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {installCapacityIODiagnostics} from './capacity-io-diagnostics.mjs'
const run=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself',root=process.cwd()
const adb=async args=>(await run('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:15000,maxBuffer:65536})).stdout.trim()
const source=new URL('native-capacity-100000.json',import.meta.url),destination=new URL('native-io-partial-closure-baseline-20261102.json',import.meta.url)
const baseline=JSON.parse(await readFile(source,'utf8'))
if(baseline.kind!=='production-android-actual-coordinator'||baseline.count!==100000||baseline.status!=='RUNNING'||baseline.metrics.portableImportActualCoordinator?.ms<=120000||baseline.activeOperation?.name!=='masterPasswordActualUiTransaction')throw Error('FAILED_ACTIVE_CAPACITY_SAMPLE_REQUIRED')
assertKanataSyntheticDevice(JSON.parse(await readFile('.kanata-device.local/isolation.json','utf8')),root,await adb(['emu','avd','name']),serial)
if(await adb(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('UNMARKED_APP')
const device=(await _android.devices()).find(d=>d.serial()===serial)
if(!device)throw Error('MISSING_GUARDED_DEVICE')
const view=await device.webView({pkg}),port=await adb(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()])
const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:30000}),page=browser.contexts()[0].pages()[0]
const result={status:'DIAGNOSTIC_RUNNING',syntheticOnly:true,build:baseline.build,at:new Date().toISOString(),partialFirstDirection:true,acceptanceEvidence:false,observations:[]}
const save=()=>writeFile(destination,JSON.stringify(result,null,2)+'\n')
try{
  await installCapacityIODiagnostics(page)
  await save()
  const end=Date.now()+1200000
  while(Date.now()<end){
    const current=JSON.parse(await readFile(source,'utf8'))
    try{result.observations.push({at:new Date().toISOString(),operation:current.activeOperation?.name??current.status,io:await page.evaluate(()=>window.__capacityIO.snapshot())})}
    catch{result.pageEnded=true;break}
    await save()
    if(current.status!=='RUNNING')break
    await new Promise(resolve=>setTimeout(resolve,5000))
  }
  result.status='MEASURED_PARTIAL_DIAGNOSTIC_NOT_ACCEPTED'
}catch(error){result.status='DIAGNOSTIC_FAILED';result.error=error.message}
finally{
  await save()
  // Restore only our wrapper if the same document still exists. No business state changes.
  await page.evaluate(()=>window.__capacityIO?.dispose()).catch(()=>{})
  await browser.close().catch(()=>{})
  await adb(['forward','--remove','tcp:'+port]).catch(()=>{})
}
process.exit(result.status==='DIAGNOSTIC_FAILED'?1:0)
