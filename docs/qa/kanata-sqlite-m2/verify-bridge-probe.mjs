// Environment-only synthetic ping, deliberately unrelated to M2 SQL/Repository acceptance.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'
const work=path.resolve('work/m2'),manifest=path.resolve(process.argv[2]??''),project=path.resolve(process.argv[3]??''),out=path.resolve(process.argv[4]??'')
if(![manifest,project,out].every(p=>p.startsWith(work+path.sep)))throw Error('PROBE_PATH_DENIED')
const m=JSON.parse(await fs.readFile(manifest,'utf8')),serial='emulator-5582',packageName='com.formyself.qa.m2probe'
if(m.syntheticOnly!==true||m.serial!==serial||m.avdName!=='kanata_m2_api34'||!path.basename(m.root).startsWith('kanata-m2-synthetic-'))throw Error('PROBE_IDENTITY_DENIED')
const adb=path.join(m.sdk,'platform-tools/adb')
function call(args,check=true){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});if(check&&r.status!==0)throw Error('PROBE_ADB_FAILED');return r}
if(call(['emu','avd','name']).stdout.split(/\r?\n/)[0]!==m.avdName||call(['shell','getprop','ro.build.version.sdk']).stdout.trim()!=='34'||call(['shell','getprop','sys.boot_completed']).stdout.trim()!=='1')throw Error('PROBE_DEVICE_DENIED')
if(call(['shell','pm','list','packages','-3']).stdout.trim())throw Error('PROBE_USER_APPS_PRESENT')
const apk=path.join(project,'android/app/build/outputs/apk/debug/app-debug.apk'),bytes=await fs.readFile(apk)
const aapt=spawnSync(path.join(m.sdk,'build-tools/35.0.0/aapt'),['dump','badging',apk],{encoding:'utf8'})
if(aapt.status!==0||!aapt.stdout.includes("package: name='"+packageName+"'"))throw Error('PROBE_APK_DENIED')
await fs.mkdir(out,{recursive:false})
await fs.writeFile(path.join(out,'apk-identity.txt'),aapt.stdout)
const result={scope:'CAPACITOR_PREFLIGHT_PING_ONLY_NOT_M2_DRIVER',status:'BLOCKED_BRIDGE_NO_VERIFIED_RESULT',packageName,serial,avdName:m.avdName,api:34,syntheticOnly:true,capacitor:'8.4.1',apkSha256:createHash('sha256').update(bytes).digest('hex'),modelRequests:0,observations:[]}
let browser,port
const started=Date.now()
try{
 const install=call(['install','-r','-t',apk]);await fs.writeFile(path.join(out,'install.txt'),install.stdout+install.stderr)
 const installed=call(['shell','pm','path',packageName]).stdout.trim();if(!installed.startsWith('package:'))throw Error('PROBE_INSTALL_UNVERIFIED')
 result.installedPath=installed
 await fs.writeFile(path.join(out,'device.txt'),call(['shell','getprop']).stdout)
 await fs.writeFile(path.join(out,'selinux.txt'),call(['shell','getenforce']).stdout)
 call(['shell','am','force-stop','com.android.htmlviewer'])
 call(['logcat','-c'])
 const launch=call(['shell','am','start','-W','-n',packageName+'/.MainActivity'],false)
 await fs.writeFile(path.join(out,'launch.txt'),launch.stdout+launch.stderr)
 const deadline=Date.now()+300000
 while(Date.now()<deadline){
  const pid=call(['shell','pidof',packageName],false).stdout.trim().split(/\s+/)[0]
  const obs={elapsedMs:Date.now()-started,pid:pid||null}
  if(pid){
   if(!port){
    const sockets=call(['shell','cat','/proc/net/unix'],false).stdout
    const socket='webview_devtools_remote_'+pid
    if(sockets.includes('@'+socket)){
     const forwarded=call(['forward','tcp:0','localabstract:'+socket]);port=forwarded.stdout.trim()
     if(!/^\d+$/.test(port))throw Error('PROBE_FORWARD_FAILED')
    }
   }
   if(port){
    try{
     if(!browser)browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000})
     const page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^https?:\/\/localhost/.test(p.url()))
     if(page){
      const value=await page.evaluate(()=>({title:document.title,syntheticOnly:window.__M2_SYNTHETIC_ONLY===true,result:window.__M2_PREFLIGHT_RESULT??null}))
      obs.page=value
      if(value.title==='M2_PREFLIGHT_PASS'&&value.syntheticOnly&&value.result?.syntheticOnly===true&&value.result?.nonce==='M2_SYNTHETIC_NONCE'){
       result.status='PASS_PREFLIGHT_PING_ONLY';result.observations.push(obs);break
      }
     }
    }catch{obs.debugCode='PROBE_DEBUG_UNAVAILABLE';browser=undefined}
   }
  }
  result.observations.push(obs)
  if(!pid&&result.observations.some(o=>o.pid)){
   const recent=call(['logcat','-d','-s','chromium'],false).stdout
   if(recent.includes('crash detected (code')){result.status='BLOCKED_CAPACITOR_RENDERER_CRASH';break}
  }
  await new Promise(resolve=>setTimeout(resolve,3000))
 }
}catch(error){result.errorCode=/^PROBE_[A-Z_]+$/.test(error.message)?error.message:'PROBE_FAILED'}
finally{
 const log=call(['logcat','-d','-v','threadtime'],false);await fs.writeFile(path.join(out,'logcat.txt'),log.stdout+log.stderr)
 const crash=log.stdout.split(/\r?\n/).filter(l=>/CrRendererMain|libwebviewchromium|Renderer process \(|Render process \(|Fatal signal/.test(l))
 await fs.writeFile(path.join(out,'crash-extract.txt'),crash.join('\n')+'\n')
 if(result.status!=='PASS_PREFLIGHT_PING_ONLY'&&crash.some(l=>l.includes('crash detected (code')))result.status='BLOCKED_CAPACITOR_RENDERER_CRASH'
 if(browser)await browser.close().catch(()=>{})
 if(port)call(['forward','--remove','tcp:'+port],false)
 result.elapsedMs=Date.now()-started
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
 process.exitCode=result.status==='PASS_PREFLIGHT_PING_ONLY'?0:2
}
