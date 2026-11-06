// Linux cloud QA only. Clone the unused synthetic M1 disk onto an independent temp
// volume; retain the workspace AVD and let the emulator enforce its resource checks.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
if(process.platform!=='linux'||process.arch!=='x64')throw Error('QA_LINUX_X64_REQUIRED')
const work=await fs.realpath('work/m0'),sdk=path.join(work,'android-sdk')
const adb=path.join(sdk,'platform-tools/adb'),serial='emulator-5580',avdName='kanata_m1_schema_api34'
const devices=execFileSync(adb,['devices'],{encoding:'utf8'})
if(devices.split(/\r?\n/).some(line=>line.startsWith(serial+'\t')))throw Error('QA_SERIAL_BUSY')
const resumeArg=process.argv.indexOf('--resume')
let manifest,run
if(resumeArg>=0){
  const file=await fs.realpath(process.argv[resumeArg+1]??'')
  if(!file.startsWith(work+path.sep))throw Error('QA_MANIFEST_PATH_DENIED')
  manifest=JSON.parse(await fs.readFile(file,'utf8'))
  const root=await fs.realpath(manifest.root)
  if(path.dirname(root)!==await fs.realpath(os.tmpdir())||!path.basename(root).startsWith('kanata-m1-emulator-')||manifest.syntheticOnly!==true||manifest.serial!==serial||manifest.avdName!==avdName)throw Error('QA_RESUME_IDENTITY_DENIED')
  if(manifest.avdHome!==path.join(root,'avd')||manifest.data!==path.join(root,'avd',avdName+'.avd','m1-synthetic.img'))throw Error('QA_RESUME_PATH_DENIED')
  const avd=path.dirname(manifest.data),lock=path.join(avd,'hardware-qemu.ini.lock')
  try{
    const pid=(await fs.readFile(lock,'utf8')).replace(/\0$/, '').trim()
    if(!/^[1-9][0-9]*$/.test(pid))throw Error('QA_LOCK_IDENTITY_DENIED')
    let state
    try{state=(await fs.readFile(`/proc/${pid}/stat`,'utf8')).split(') ')[1]?.split(' ')[0]}
    catch(error){if(error.code!=='ENOENT')throw error}
    if(state&&state!=='Z')throw Error('QA_AVD_STILL_RUNNING')
    // Only this manifest's synthetic AVD; never wipe data or remove a live lock.
    await fs.unlink(lock)
    await fs.unlink(path.join(avd,'multiinstance.lock')).catch(error=>{if(error.code!=='ENOENT')throw error})
  }catch(error){if(error.code!=='ENOENT')throw error}
  run=await fs.mkdtemp(path.join(work,'m1-tmp-resume-'))
}else{
const source=await fs.realpath(path.join(work,'emulator/avd',avdName+'.avd'))
if(!source.startsWith(path.join(work,'emulator/avd')+path.sep))throw Error('QA_AVD_PATH_DENIED')
const sourceData=path.join(source,'m1-synthetic.img')
if((await fs.stat(sourceData)).size!==1024**3)throw Error('QA_SYNTHETIC_IMAGE_REQUIRED')
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kanata-m1-emulator-'))
const avdHome=path.join(root,'avd'),target=path.join(avdHome,avdName+'.avd')
await fs.mkdir(target,{recursive:true})
await fs.copyFile(path.join(source,'config.ini'),path.join(target,'config.ini'))
const data=path.join(target,'m1-synthetic.img')
execFileSync('cp',['--sparse=always',sourceData,data])
await fs.writeFile(path.join(avdHome,avdName+'.ini'),`avd.ini.encoding=UTF-8\npath=${target}\ntarget=android-34\n`)
run=await fs.mkdtemp(path.join(work,'m1-tmp-avd-'))
manifest={syntheticOnly:true,serial,avdName,root,avdHome,data}
}
await fs.writeFile(path.join(run,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const log=await fs.open(path.join(run,'boot.txt'),'wx')
const args=['-avd',avdName,'-port','5580','-accel','off','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-no-metrics',
  '-gpu','swiftshader','-feature','-Vulkan','-memory','2560','-cores','2','-partition-size','1024','-data',manifest.data]
const env={...process.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_USER_HOME:path.join(manifest.root,'prefs'),ANDROID_AVD_HOME:manifest.avdHome,ANDROID_EMULATOR_HOME:path.join(manifest.root,'home')}
const child=spawn(path.join(sdk,'emulator/emulator'),args,{env,stdio:['ignore',log.fd,log.fd],detached:true})
console.log(JSON.stringify({status:'PROCESS_STARTED_BOOT_NOT_YET_VERIFIED',pid:child.pid,run,manifest:path.join(run,'manifest.json'),args}))
child.on('error',()=>{process.exitCode=1})
child.unref();await log.close()
