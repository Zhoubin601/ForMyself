import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {_android,chromium} from 'playwright-core'
import {assertKanataSyntheticDevice} from '../../../../scripts/kanata-device-guard.mjs'
import {unlockApp} from '../p3/management-scenarios.mjs'
import {encryptPassphraseAes,decryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {PASSWORD} from '../p3/management-scenarios.mjs'
export async function connectNativeCapacity({onPage}={}){
  const execute=promisify(execFile),serial='emulator-5580',pkg='com.yubin.formyself',root=process.cwd()
  const run=async args=>(await execute('E:/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args],{timeout:120000,maxBuffer:4*1024*1024})).stdout.trim()
  const marker=JSON.parse(await readFile(resolve(root,'.kanata-device.local/isolation.json'),'utf8'))
  assertKanataSyntheticDevice(marker,root,await run(['emu','avd','name']),serial)
  if(await run(['shell','run-as',pkg,'cat','files/kanata-qa-isolation.txt'])!=='KanataP2Synthetic34:20261028:new-empty-avd')throw Error('UNMARKED_CAPACITY_APP')
  const build=JSON.parse(await readFile(resolve(root,'docs/qa/kanata-continuous/p7/production-build-verification.json'),'utf8')),apk=resolve(root,'android/app/build/outputs/apk/debug/app-debug.apk')
  if(build.status!=='PASS'||!build.qaHarnessAbsent||build.apkSha256!==createHash('sha256').update(await readFile(apk)).digest('hex'))throw Error('UNVERIFIED_CAPACITY_APK')
  const device=(await _android.devices()).find(d=>d.serial()===serial),browsers=[],ports=[]
  if(!device)throw Error('MISSING_TASK_DEVICE')
  let browser,page,pageCdp,system,protectedLoadMs
  const stop=async()=>{await run(['shell','am','force-stop',pkg]);const end=Date.now()+20000;while(device.webViews().some(v=>v.pkg()===pkg)){if(Date.now()>end)throw Error('STALE_CAPACITY_VIEW');await new Promise(resolve=>setTimeout(resolve,100))}}
  const attach=async()=>{
    await run(['shell','am','start','-n',pkg+'/.MainActivity'])
    const view=await device.webView({pkg}),port=await run(['forward','tcp:0','localabstract:webview_devtools_remote_'+view.pid()]);ports.push(port)
    browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+'/devtools/browser',{noDefaults:true,timeout:90000});browsers.push(browser)
    page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(180000);system=await browser.newBrowserCDPSession();pageCdp=await browser.contexts()[0].newCDPSession(page)
    // Synthetic controlled-provider drivers must intercept before unlock can resume a due task.
    if(onPage)await onPage(page)
    await unlockApp(page)
    protectedLoadMs=await page.evaluate(()=>performance.getEntriesByName('protected:chat:load','measure').at(-1)?.duration)
    if(!Number.isFinite(protectedLoadMs))throw Error('PROTECTED_COLD_LOAD_COUNTER_UNAVAILABLE')
    await page.evaluate(()=>{
      const s=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
      if(!['saved','empty','ready'].includes(s.apiKeyStorageStatus)||s.aiApiKey&&!/^(?:sk-)?synthetic(?:[-_]|$)/i.test(s.aiApiKey))throw Error('NON_SYNTHETIC_OR_UNREADABLE_AI_CONFIGURATION')
    })
  }
  await run(['install','-r','-t',apk]);await stop();await attach()
  return{
    build,get page(){return page},get protectedLoadMs(){return protectedLoadMs},
    async cold(){await stop();await attach();return page},
    async startProfile(){await pageCdp.send('Profiler.enable');await pageCdp.send('Profiler.start')},
    async stopProfile(){
      const {profile}=await pageCdp.send('Profiler.stop'),nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),totals=new Map()
      for(let i=0;i<(profile.samples?.length||0);i++){const id=profile.samples[i];totals.set(id,(totals.get(id)||0)+(profile.timeDeltas[i]||0))}
      return [...totals].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,microseconds])=>({function:nodes.get(id)?.functionName,asset:nodes.get(id)?.url?.split('/').pop(),selfMs:Math.round(microseconds/100)/10}))
    },
    async memory(){
      const all=(await system.send('SystemInfo.getProcessInfo')).processInfo,rows=[]
      for(const process of all){
        const pid=Number(process.id);if(!Number.isSafeInteger(pid)||pid<=0)continue
        const text=await run(['shell','cat','/proc/'+pid+'/status']),peak=/^VmHWM:\s+(\d+)\s+kB/m.exec(text),current=/^VmRSS:\s+(\d+)\s+kB/m.exec(text)
        if(!peak||!current)throw Error('NATIVE_PEAK_COUNTER_UNAVAILABLE')
        rows.push({pid,type:process.type,peakRssKiB:Number(peak[1]),currentRssKiB:Number(current[1])})
      }
      if(!rows.some(p=>p.type==='renderer')||!rows.some(p=>p.type==='browser'))throw Error('NATIVE_PROCESS_ATTRIBUTION_UNAVAILABLE')
      return{processes:rows,peakResidentMiB:Math.max(...rows.map(p=>p.peakRssKiB))/1024,sumOfProcessPeaksMiB:rows.reduce((n,p)=>n+p.peakRssKiB,0)/1024,currentTotalRssMiB:rows.reduce((n,p)=>n+p.currentRssKiB,0)/1024,sumIsNotSimultaneousPeak:true,heapPoint:await pageCdp.send('Runtime.getHeapUsage')}
    },
    async preserveOriginal(backup){
      if(!backup.data.chat.messages.some(m=>m.id==='p7-history-26'))return
      const destination=resolve(root,'docs/qa/kanata-continuous/p7/native-before-capacity.enc')
      try{await writeFile(destination,encryptPassphraseAes(JSON.stringify(backup),PASSWORD),{encoding:'utf8',flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
      const preserved=JSON.parse(decryptPassphraseAes(await readFile(destination,'utf8'),PASSWORD))
      if(preserved.data.chat.messages.length!==608||preserved.data.chat.messages.find(m=>m.id==='p7-history-26')?.revision!==2)throw Error('ORIGINAL_SYNTHETIC_IMAGE_NOT_VERIFIED')
    },
    async close(){
      for(const b of browsers){let timer;try{await Promise.race([b.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,4000)})])}finally{clearTimeout(timer)}}
      for(const port of ports)await run(['forward','--remove','tcp:'+port]).catch(()=>{})
      let timer
      try{await Promise.race([device.close(),new Promise(resolve=>{timer=setTimeout(resolve,4000)})])}finally{clearTimeout(timer)}
    }
  }
}
