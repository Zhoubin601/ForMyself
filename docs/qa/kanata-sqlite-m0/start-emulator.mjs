// Resume only the disposable M0 AVD; never wipe or discover a user's device.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
const base=path.resolve('work/m0'),emulator=path.join(base,'android-sdk/emulator/emulator')
const data=path.join(base,'emulator/avd/kanata_m0_api34.avd/m0-userdata-formatted.img')
await fs.access(data)
const options=['-avd','kanata_m0_api34','-port','5580','-accel','off','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-no-metrics','-gpu','swiftshader','-feature','-Vulkan','-memory','2560','-cores','2','-partition-size','2048','-data',data,'-show-kernel']
const env={...process.env,ANDROID_HOME:path.join(base,'android-sdk'),ANDROID_SDK_ROOT:path.join(base,'android-sdk'),ANDROID_USER_HOME:path.join(base,'emulator/prefs'),ANDROID_AVD_HOME:path.join(base,'emulator/avd'),ANDROID_EMULATOR_HOME:path.join(base,'emulator/home')}
const log=await fs.open(path.join(base,`emulator/resume-${Date.now()}.txt`),'wx')
const child=spawn(emulator,options,{env,stdio:['ignore',log.fd,log.fd]})
console.log(JSON.stringify({pid:child.pid,serial:'emulator-5580',avd:'kanata_m0_api34',acceleration:'TCG software only',realDevicePerformanceGate:'BLOCKED'}))
child.on('error',()=>{process.exitCode=1})
child.on('exit',async code=>{await log.close();process.exitCode=code??1})
