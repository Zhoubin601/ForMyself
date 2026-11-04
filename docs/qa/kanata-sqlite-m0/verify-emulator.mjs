// Only the explicitly named disposable M0 emulator and QA package are accepted.
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright-core'
const version=process.argv[2]
const bridgeOnly=process.argv.includes('--bridge-only')
const builds={'8.3.1':'android-8.3.1-izwXPq','8.4.1':'android-8.4.1-14xBaJ'}
if(!builds[version])throw Error('QA_VERSION_DENIED')
const buildArg=process.argv.indexOf('--build-dir')
if(buildArg>=0&&(!process.argv[buildArg+1]||process.argv[buildArg+1].startsWith('--')))throw Error('QA_BUILD_DIR_REQUIRED')
const buildRoot=await fs.realpath(path.resolve(buildArg>=0?process.argv[buildArg+1]:`work/m0/${builds[version]}`))
const workRoot=await fs.realpath(path.resolve('work/m0'))
if(!buildRoot.startsWith(workRoot+path.sep)||!path.basename(buildRoot).startsWith(`android-${version}-`))throw Error('QA_BUILD_DIR_DENIED')
const manifest=JSON.parse(await fs.readFile(path.join(buildRoot,'package.json'),'utf8'))
if(manifest.name!=='kanata-sqlite-m0-isolated-qa'||manifest.dependencies?.['@capacitor/core']!==version)throw Error('QA_BUILD_IDENTITY_DENIED')
const adb=path.resolve('work/m0/android-sdk/platform-tools/adb'),serial='emulator-5580'
const dir=await fs.mkdtemp(path.resolve(`work/m0/emulator/test-${version}-`))
const commands=[]
const call=(args,timeout=120000)=>{
  commands.push(args)
  return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']})
}
const safeState={version,device:'AOSP ATD API34 emulator only',realDeviceGate:'BLOCKED',status:'RUNNING',phase:'preflight',commands}
let browser
try {
  if(call(['get-state']).trim()!=='device'||call(['emu','avd','name']).split('\n')[0].trim()!=='kanata_m0_api34')throw Error('QA_WRONG_DEVICE')
  if(call(['shell','getprop','sys.boot_completed']).trim()!=='1')throw Error('QA_BOOT_INCOMPLETE')
  await fs.writeFile(path.join(dir,'device.txt'),call(['shell','getprop','ro.build.fingerprint'])+call(['shell','getprop','ro.build.version.release'])+call(['shell','dumpsys','webviewupdate']))
  const base=path.join(buildRoot,'android/app/build/outputs/apk')
  safeState.phase='install'
  for(const apk of bridgeOnly?['debug/app-debug.apk']:['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk'])call(['install','-r','-t',path.join(base,apk)],240000)
  if(!bridgeOnly){
    safeState.phase='native'
    const native=call(['shell','am','instrument','-w','-r','-e','class','com.formyself.qa.m0.SqlCipherM0Test','com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner'],600000)
    await fs.writeFile(path.join(dir,'native.txt'),native)
    if(!/OK \(1 test\)/.test(native)||/FAILURES|INSTRUMENTATION_FAILED/.test(native))throw Error('QA_NATIVE_TEST_FAILED')
    safeState.native='PASS_EMULATOR_ONLY'
  }else safeState.native='NOT_RUN_THIS_INVOCATION'
  safeState.phase='webview-start'
  call(['shell','am','force-stop','com.formyself.qa.m0'])
  call(['shell','am','start','-n','com.formyself.qa.m0/.MainActivity'])
  let portReady=false
  for(let i=0;i<60;i++){
    let pid=''
    try{pid=call(['shell','pidof','com.formyself.qa.m0']).trim().split(' ')[0]}catch{ /* am start can return before the process exists */ }
    if(pid)try{call(['forward','tcp:9228',`localabstract:webview_devtools_remote_${pid}`]);const r=await fetch('http://127.0.0.1:9228/json/list');if(r.ok&&(await r.json()).length){portReady=true;break}}catch{ /* process/debug socket may not be ready or may have exited */ }
    await new Promise(r=>setTimeout(r,1000))
  }
  if(!portReady)throw Error('QA_WEBVIEW_DEBUG_UNAVAILABLE')
  safeState.phase='bridge'
  browser=await chromium.connectOverCDP('http://127.0.0.1:9228',{timeout:120000})
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://localhost'))
  if(!page)throw Error('QA_PAGE_MISSING')
  await page.locator('#run').click({timeout:120000})
  await page.waitForFunction(()=>window.qaM0Result&&document.querySelector('#run').disabled===false,null,{timeout:300000})
  const result=await page.evaluate(()=>window.qaM0Result)
  await fs.writeFile(path.join(dir,'bridge.json'),JSON.stringify(result,null,2)+'\n')
  if(result.status!=='SMOKE_ONLY_LIFECYCLE_BLOCKED')throw Error('QA_BRIDGE_TEST_FAILED')
  safeState.bridge='PASS_SMOKE_EMULATOR_ONLY';safeState.status=bridgeOnly?'EMULATOR_BRIDGE_COMPLETED_M0_BLOCKED':'EMULATOR_TESTS_COMPLETED_M0_BLOCKED';safeState.phase='complete'
}catch(error){safeState.status='BLOCKED_OR_FAILED';safeState.code=/^QA_[A-Z_]+$/.test(error.message)?error.message:'QA_DEVICE_COMMAND_FAILED';process.exitCode=1}
finally {
  if(browser)await browser.close()
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(safeState,null,2)+'\n')
  console.log(JSON.stringify({dir,status:safeState.status,code:safeState.code,native:safeState.native,bridge:safeState.bridge}))
}
