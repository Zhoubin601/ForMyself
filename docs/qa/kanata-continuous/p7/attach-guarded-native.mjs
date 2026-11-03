import {readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
// Read-only attachment: never installs, starts, authenticates, force-stops or clears data.
export async function attachGuardedNative(){
  const execute=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself'
  const adb=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:15000,maxBuffer:65536})).stdout.trim()
  assertKanataSyntheticDevice(JSON.parse(await readFile('.kanata-device.local/isolation.json','utf8')),process.cwd(),await adb(['emu','avd','name']),serial)
  if(await adb(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('UNMARKED_APP')
  const device=(await _android.devices()).find(d=>d.serial()===serial)
  if(!device)throw Error('MISSING_GUARDED_DEVICE')
  const view=await device.webView({pkg}),port=await adb(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()])
  const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:30000})
  return{page:browser.contexts()[0].pages()[0],async close(){await browser.close().catch(()=>{});await adb(['forward','--remove','tcp:'+port]).catch(()=>{})}}
}
