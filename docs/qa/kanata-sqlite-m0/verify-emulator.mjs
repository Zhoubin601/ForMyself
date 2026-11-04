// Only the explicitly named disposable M0 emulator and QA package are accepted.
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {pbkdf2Sync} from 'node:crypto'
import {unwrapKey} from './key-envelope.mjs'
const version=process.argv[2]
const bridgeOnly=process.argv.includes('--bridge-only')
const capacityArg=process.argv.indexOf('--target-benchmark')
const capacity=capacityArg<0?null:{engine:process.argv[capacityArg+1],count:Number(process.argv[capacityArg+2])}
if(capacity&&(version!=='8.4.1'||!bridgeOnly||!['json-archive','sqlcipher'].includes(capacity.engine)||![1000,10000,100000].includes(capacity.count)))throw Error('QA_SAMPLE_DENIED')
const crashArg=process.argv.indexOf('--target-crash')
const crash=crashArg<0?null:process.argv[crashArg+1]
if(crashArg>=0&&(version!=='8.4.1'||!bridgeOnly||capacity||!['stage','resume'].includes(crash)))throw Error('QA_CRASH_MODE_DENIED')
const directArg=process.argv.indexOf('--direct-session')
const directMode=directArg<0?null:process.argv[directArg+1]
if(directArg>=0&&(version!=='8.4.1'||!bridgeOnly||capacity||crash||!['seed','resume'].includes(directMode)))throw Error('QA_DIRECT_MODE_DENIED')
const priorArg=process.argv.indexOf('--prior-pid')
const priorPid=priorArg<0?null:process.argv[priorArg+1]
if(directMode==='resume'&&!/^[1-9][0-9]+$/.test(priorPid??''))throw Error('QA_PRIOR_PID_REQUIRED')
const syntheticPassword=directMode?readFileSync(0,'utf8'):null
if(directMode&&(!syntheticPassword?.startsWith('合成-')||syntheticPassword.length>96))throw Error('QA_SYNTHETIC_PASSWORD_REQUIRED')
const builds={'8.3.1':'android-8.3.1-izwXPq','8.4.1':'android-8.4.1-14xBaJ'}
if(!builds[version])throw Error('QA_VERSION_DENIED')
const buildArg=process.argv.indexOf('--build-dir')
if(buildArg>=0&&(!process.argv[buildArg+1]||process.argv[buildArg+1].startsWith('--')))throw Error('QA_BUILD_DIR_REQUIRED')
const buildRoot=await fs.realpath(path.resolve(buildArg>=0?process.argv[buildArg+1]:`work/m0/${builds[version]}`))
const workRoot=await fs.realpath(path.resolve('work/m0'))
if(!buildRoot.startsWith(workRoot+path.sep)||!path.basename(buildRoot).startsWith(`android-${version}-`))throw Error('QA_BUILD_DIR_DENIED')
const manifest=JSON.parse(await fs.readFile(path.join(buildRoot,'package.json'),'utf8'))
const config=JSON.parse(await fs.readFile(path.join(buildRoot,'capacitor.config.json'),'utf8'))
if(manifest.name!=='kanata-sqlite-m0-isolated-qa'||manifest.dependencies?.['@capacitor/core']!==version||config.appId!=='com.formyself.qa.m0')throw Error('QA_BUILD_IDENTITY_DENIED')
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT??path.resolve('work/m0/android-sdk')
const adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'),serial='emulator-5580'
await fs.mkdir('work/m0/emulator',{recursive:true})
const dir=await fs.mkdtemp(path.resolve(`work/m0/emulator/test-${version}-`))
const commands=[]
const call=(args,timeout=120000)=>{
  commands.push(args)
  return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']})
}
const safeState={version,device:'kanata_m0_api34 isolated emulator only',...(capacity?{capacity}:{}),status:'RUNNING',phase:'preflight',commands}
let forwardedPort
async function auditDirect(pid){
  const metadata=JSON.parse(call(['shell','run-as','com.formyself.qa.m0','cat','files/m0-direct/envelope.json']))
  const dek=await unwrapKey(syntheticPassword,metadata)
  const salt=Buffer.concat([Buffer.from('ForMyself/Kanata/KEK/v1\0'),Buffer.from(metadata.salt,'base64')])
  const kek=pbkdf2Sync(syntheticPassword,salt,600000,32,'sha256')
  try{
    const secrets=[syntheticPassword,...[kek,Buffer.from(dek.buffer,dek.byteOffset,dek.byteLength)].flatMap(value=>{
      const hex=value.toString('hex')
      return [hex,hex.toUpperCase(),value.toString('base64')]
    })]
    const log=call(['logcat','-d',`--pid=${pid}`])
    if(!log.includes('direct unlock probe')||secrets.some(value=>log.includes(value)))throw Error('QA_DIRECT_LOG_AUDIT_FAILED')
    const readNames=()=>call(['shell','run-as','com.formyself.qa.m0','ls','-1','shared_prefs']).trim().split(/\r?\n/).filter(Boolean).sort()
    for(let attempt=0;attempt<4;attempt++){
      // WebView may atomically replace its own preference files while this scan runs.
      // Retry the whole inventory rather than silently dropping an unreadable file.
      try{
        const names=readNames()
        if(!names.includes('m0-direct-audit.xml'))throw Error('QA_DIRECT_PREFS_CANARY')
        for(const name of names){
          if(!/^[A-Za-z0-9_.-]+$/.test(name)||name==='.'||name==='..')throw Error('QA_DIRECT_PREFS_PATH')
          const contents=call(['shell','run-as','com.formyself.qa.m0','cat','shared_prefs/'+name])
          if(secrets.some(value=>contents.includes(value)))throw Error('QA_DIRECT_PREFS_AUDIT_FAILED')
        }
        if(JSON.stringify(names)===JSON.stringify(readNames())){
          return {portableEnvelope:true,prefsFilesScanned:names.length,logCanary:true,passwordKekDekAbsent:true}
        }
      }catch(error){
        if(!Number.isInteger(error.status))throw error
      }
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    throw Error('QA_DIRECT_PREFS_UNSTABLE')
  }finally{kek.fill(0);dek.fill(0)}
}
async function targetResources(port){
  const endpoint=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(3000)})
  const target=new URL((await endpoint.json()).webSocketDebuggerUrl)
  if(target.protocol!=='ws:'||target.hostname!=='127.0.0.1'||target.port!==port||!target.pathname.startsWith('/devtools/browser'))throw Error('QA_CDP_TARGET_DENIED')
  const socket=new WebSocket(target)
  try{
    const processes=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('QA_METRICS_TIMEOUT')),3000)
      socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'SystemInfo.getProcessInfo'})),{once:true})
      socket.addEventListener('message',({data})=>{
        clearTimeout(timeout)
        try{resolve(JSON.parse(data).result?.processInfo??[])}catch{reject(Error('QA_METRICS_FAILED'))}
      },{once:true})
    })
    const ticksPerSecond=Number(call(['shell','getconf','CLK_TCK'],3000).trim())
    return processes.filter(p=>['browser','renderer'].includes(p.type)&&Number.isSafeInteger(p.id)&&p.id>0).map(process=>{
      let peakRssKiB=null,cpuSeconds=null
      try{
        const status=call(['shell','cat',`/proc/${process.id}/status`],3000)
        peakRssKiB=Number(/^VmHWM:\s+(\d+)\s+kB/m.exec(status)?.[1])||null
        const stat=call(['shell','cat',`/proc/${process.id}/stat`],3000)
        // Command names can contain spaces. Fields after the closing parenthesis start at field 3.
        const fields=stat.slice(stat.lastIndexOf(')')+1).trim().split(/\s+/)
        const cpuTicks=Number(fields[11])+Number(fields[12])
        if(ticksPerSecond>0&&Number.isFinite(cpuTicks))cpuSeconds=cpuTicks/ticksPerSecond
      }catch{ /* restricted procfs or process exited */ }
      return {type:process.type,pid:process.id,cpuSeconds,peakRssKiB}
    })
  }finally{socket.close()}
}
async function runBridge(target,port,{action,onReady}={}){
  const url=new URL(target.webSocketDebuggerUrl)
  if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!==port||!url.pathname.startsWith('/devtools/page/'))throw Error('QA_CDP_TARGET_DENIED')
  // Android WebView does not support the browser-level context setup used by Playwright.
  const socket=new WebSocket(url)
  try{
    return await new Promise((resolve,reject)=>{
      const readyDeadline=Date.now()+30000
      const timeout=setTimeout(()=>reject(Error('QA_BRIDGE_TIMEOUT')),capacity||directMode?900000:300000)
      const finish=(settle,value)=>{clearTimeout(timeout);settle(value)}
      const evaluate=(id,expression,awaitPromise=false)=>{
        if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({
          id,method:'Runtime.evaluate',params:{awaitPromise,returnByValue:true,expression}
        }))
      }
      const ready=directMode?"typeof window.qaDirectSession === 'function'":crash?"typeof window.qaTargetCrash === 'function'":capacity?"typeof window.qaTargetBenchmark === 'function'":"typeof document.querySelector('#run')?.onclick === 'function'"
      const probe=()=>evaluate(1,"document.readyState === 'complete' && "+ready)
      socket.addEventListener('error',()=>finish(reject,Error('QA_CDP_SOCKET_FAILED')),{once:true})
      socket.addEventListener('close',()=>finish(reject,Error('QA_CDP_SOCKET_CLOSED')),{once:true})
      socket.addEventListener('message',({data})=>{
        let reply
        try{reply=JSON.parse(data)}catch{return finish(reject,Error('QA_CDP_INVALID_REPLY'))}
        if(reply.id===1){
          // The target can be advertised before its first execution context settles.
          if(reply.result?.result?.value!==true){
            if(Date.now()>=readyDeadline)return finish(reject,Error('QA_PAGE_NOT_READY'))
            setTimeout(probe,100)
            return
          }
          onReady?.()
          evaluate(2,action??(crash?`window.qaTargetCrash(${JSON.stringify(crash)})`:capacity?`window.qaTargetBenchmark(${JSON.stringify(capacity.engine)},${capacity.count})`:`(async () => {
            const button = document.querySelector('#run')
            const deadline = performance.now() + 260000
            button.click()
            while (!window.qaM0Result || button.disabled) {
              if (performance.now() >= deadline) throw Error('QA_PAGE_TIMEOUT')
              await new Promise(r => setTimeout(r, 100))
            }
            return window.qaM0Result
          })()`),true)
          return
        }
        if(reply.id!==2)return
        if(reply.error||reply.result?.exceptionDetails)return finish(reject,Error('QA_CDP_EVALUATION_FAILED'))
        finish(resolve,reply.result?.result?.value)
      })
      socket.addEventListener('open',probe,{once:true})
    })
  }finally{socket.close()}
}
try {
  if(call(['get-state']).trim()!=='device'||call(['emu','avd','name']).split('\n')[0].trim()!=='kanata_m0_api34')throw Error('QA_WRONG_DEVICE')
  if(call(['shell','getprop','sys.boot_completed']).trim()!=='1')throw Error('QA_BOOT_INCOMPLETE')
  if(call(['shell','getprop','ro.build.version.sdk']).trim()!=='34')throw Error('QA_WRONG_API_LEVEL')
  await fs.writeFile(path.join(dir,'device.txt'),call(['shell','getprop','ro.build.fingerprint'])+call(['shell','getprop','ro.build.version.release'])+call(['shell','dumpsys','webviewupdate']))
  const base=path.join(buildRoot,'android/app/build/outputs/apk')
  safeState.phase='install'
  if(crash!=='resume'&&directMode!=='resume')for(const apk of bridgeOnly?['debug/app-debug.apk']:['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk'])call(['install','-r','-t',path.join(base,apk)],240000)
  if((capacity||crash==='stage'||directMode==='seed')&&call(['shell','pm','clear','com.formyself.qa.m0']).trim()!=='Success')throw Error('QA_CAPACITY_RESET_FAILED')
  if(!bridgeOnly){
    safeState.phase='native'
    const classes=['SqlCipherM0Test','SqlCipherM0SessionTest'].map(name=>`com.formyself.qa.m0.${name}`).join(',')
    const native=call(['shell','am','instrument','-w','-r','-e','class',classes,'com.formyself.qa.m0.test/androidx.test.runner.AndroidJUnitRunner'],600000)
    await fs.writeFile(path.join(dir,'native.txt'),native)
    if(!/OK \(2 tests\)/.test(native)||/FAILURES|INSTRUMENTATION_FAILED/.test(native))throw Error('QA_NATIVE_TEST_FAILED')
    safeState.native='PASS_EMULATOR_ONLY'
  }else safeState.native='NOT_RUN_THIS_INVOCATION'
  safeState.phase='webview-start'
  if(directMode==='resume'){
    if(call(['shell','pidof','com.formyself.qa.m0']).trim()!==priorPid)throw Error('QA_DIRECT_ARM_PROCESS_LOST')
    const log=call(['logcat','-d',`--pid=${priorPid}`])
    if(!log.includes('direct rollback armed')||log.includes('direct rollback arm timed out'))throw Error('QA_DIRECT_ARM_NOT_LIVE')
  }
  call(['shell','am','force-stop','com.formyself.qa.m0'])
  const started=performance.now()
  call(['shell','am','start','-n','com.formyself.qa.m0/.MainActivity'])
  let target,forwardedPid
  for(let i=0;i<60;i++){
    let pid=''
    try{pid=call(['shell','pidof','com.formyself.qa.m0']).trim().split(' ')[0]}catch{ /* am start can return before the process exists */ }
    if(pid)try{
      if(pid!==forwardedPid){
        if(forwardedPort)call(['forward','--remove',`tcp:${forwardedPort}`])
        forwardedPort=call(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`]).trim()
        forwardedPid=pid
      }
      const r=await fetch(`http://127.0.0.1:${forwardedPort}/json/list`,{signal:AbortSignal.timeout(2000)})
      if(r.ok)target=(await r.json()).find(page=>page.type==='page'&&page.url==='https://localhost/')
      if(target)break
    }catch{ /* process/debug socket may not be ready or may have exited */ }
    await new Promise(r=>setTimeout(r,1000))
  }
  if(!target)throw Error('QA_WEBVIEW_DEBUG_UNAVAILABLE')
  safeState.phase='bridge'
  let pageReadyMs
  const result=await runBridge(target,forwardedPort,directMode?{
    action:`window.qaDirectSession(${JSON.stringify(directMode)},${JSON.stringify(syntheticPassword)})`,
    onReady:()=>{pageReadyMs=performance.now()-started}
  }:{})
  if(!result)throw Error('QA_BRIDGE_RESULT_MISSING')
  if(directMode){
    const pid=call(['shell','pidof','com.formyself.qa.m0']).trim()
    const evidence={...result,pid,pageReadyMs}
    const file=path.join(dir,'direct.json')
    await fs.writeFile(file,JSON.stringify(evidence,null,2)+'\n')
    if(result.status!==`PASS_DIRECT_${directMode.toUpperCase()}`)throw Error('QA_DIRECT_TEST_FAILED')
    evidence.audit=await auditDirect(pid)
    if(directMode==='resume'){
      if(pid===priorPid)throw Error('QA_DIRECT_RESTART_NOT_OBSERVED')
      evidence.interruptedTransaction={priorPid,forceStop:true,integrityPassed:true,uncommittedRowAbsent:true}
      call(['shell','input','keyevent','KEYCODE_HOME'])
      await new Promise(resolve=>setTimeout(resolve,800))
      call(['shell','am','start','-W','-n','com.formyself.qa.m0/.MainActivity'])
      if(call(['shell','pidof','com.formyself.qa.m0']).trim()!==pid)throw Error('QA_DIRECT_PROCESS_CHANGED')
      const pause=await runBridge(target,forwardedPort,{action:"window.qaDirectSession('paused')"})
      if(pause?.status!=='PASS_DIRECT_PAUSE')throw Error('QA_DIRECT_PAUSE_FAILED')
      evidence.pause=pause.status
      const bytes=Number(call(['shell','run-as','com.formyself.qa.m0','stat','-c','%s','files/m0-direct/messages.db']).trim())
      if(!Number.isSafeInteger(bytes)||bytes<=16)throw Error('QA_DIRECT_FILE_SIZE')
      const prefix=call(['exec-out','run-as','com.formyself.qa.m0','head','-c','16','files/m0-direct/messages.db'])
      if(prefix.startsWith('SQLite format 3'))throw Error('QA_DIRECT_PLAINTEXT_DATABASE')
      evidence.closedDatabaseBytes=bytes
    }
    evidence.processes=await targetResources(forwardedPort)
    await fs.writeFile(file,JSON.stringify(evidence,null,2)+'\n')
    safeState.status=result.status
  }else if(crash){
    const pid=call(['shell','pidof','com.formyself.qa.m0']).trim()
    await fs.writeFile(path.join(dir,'crash.json'),JSON.stringify({...result,pid},null,2)+'\n')
    if(result.status!==`PASS_CRASH_${crash.toUpperCase()}`)throw Error('QA_CRASH_TEST_FAILED')
    safeState.status=result.status
  }else if(capacity){
    if(capacity.engine==='sqlcipher'&&result.status==='PASS_TARGET_SAMPLE'){
      try{result.bytes=Number(call(['shell','run-as','com.formyself.qa.m0','stat','-c','%s','databases/m0_target_benchmarkSQLite.db']).trim())}
      catch{result.bytes=null}
    }
    try{result.processes=await targetResources(forwardedPort)}catch{result.processes=[]}
    await fs.writeFile(path.join(dir,'capacity.json'),JSON.stringify(result,null,2)+'\n')
    if(result.status!=='PASS_TARGET_SAMPLE')throw Error('QA_CAPACITY_FAILED')
    safeState.status='PASS_TARGET_SAMPLE'
  }else{
    await fs.writeFile(path.join(dir,'bridge.json'),JSON.stringify(result,null,2)+'\n')
    if(result.status!=='SMOKE_ONLY_LIFECYCLE_BLOCKED')throw Error('QA_BRIDGE_TEST_FAILED')
    safeState.bridge='PASS_SMOKE_EMULATOR_ONLY';safeState.status=bridgeOnly?'EMULATOR_BRIDGE_COMPLETED_M0_BLOCKED':'EMULATOR_TESTS_COMPLETED_M0_BLOCKED'
  }
  safeState.phase='complete'
}catch(error){safeState.status='BLOCKED_OR_FAILED';safeState.code=/^QA_[A-Z_]+$/.test(error.message)?error.message:'QA_DEVICE_COMMAND_FAILED';process.exitCode=1}
finally {
  if(forwardedPort)try{call(['forward','--remove',`tcp:${forwardedPort}`])}catch{safeState.forwardCleanup='FAILED';process.exitCode=1}
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(safeState,null,2)+'\n')
  console.log(JSON.stringify({dir,status:safeState.status,code:safeState.code,native:safeState.native,bridge:safeState.bridge}))
}
