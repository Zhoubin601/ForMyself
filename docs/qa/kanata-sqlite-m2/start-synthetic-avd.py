"""Create a NEW disposable API34 AVD; never resume, wipe or find user AVDs.
Requires official SDK from install-sdk.py and prepared local e2fsprogs tools.
Prints manifest location. Wait separately for boot_completed=1 before probing.
"""
import os,json,tempfile,subprocess
from pathlib import Path
sdk=Path('work/m2/android-sdk').resolve();work=Path('work/m2').resolve()
adb=sdk/'platform-tools/adb';emulator=sdk/'emulator/emulator'
image=sdk/'system-images/android-34/aosp_atd/x86_64'
if not (image/'source.properties').is_file():raise SystemExit('OFFICIAL_API34_IMAGE_REQUIRED')
r=subprocess.run([str(adb),'devices'],capture_output=True,text=True,check=True)
if any(line.startswith('emulator-5582\t') for line in r.stdout.splitlines()):raise SystemExit('SYNTHETIC_SERIAL_BUSY')
manifest=work/'device-manifest.json'
if manifest.exists():raise SystemExit('REFUSE_TO_OVERWRITE_MANIFEST')
mk=work/'e2fs-tools/usr/sbin/mke2fs'
if not mk.is_file():raise SystemExit('LOCAL_E2FSPROGS_REQUIRED_SEE_README')
root=Path(tempfile.mkdtemp(prefix='kanata-m2-synthetic-'));avd=root/'avd/kanata_m2_api34.avd';avd.mkdir(parents=True)
config={'AvdId':'kanata_m2_api34','PlayStore.enabled':'false','abi.type':'x86_64','avd.ini.displayname':'Kanata M2 synthetic API34','avd.ini.encoding':'UTF-8','disk.dataPartition.size':'1G','fastboot.forceColdBoot':'yes','hw.accelerometer':'no','hw.audioInput':'no','hw.battery':'yes','hw.cpu.arch':'x86_64','hw.cpu.ncore':'2','hw.gpu.enabled':'yes','hw.gpu.mode':'swiftshader','hw.lcd.density':'160','hw.lcd.height':'640','hw.lcd.width':'320','hw.ramSize':'2560','hw.sdCard':'no','image.sysdir.1':str(image)+'/','tag.id':'aosp_atd','tag.display':'AOSP ATD','vm.heapSize':'256','skin.dynamic':'yes','skin.name':'320x640','showDeviceFrame':'no'}
(avd/'config.ini').write_text(''.join(k+'='+v+'\n' for k,v in config.items()))
(root/'avd/kanata_m2_api34.ini').write_text(f'avd.ini.encoding=UTF-8\npath={avd}\ntarget=android-34\n')
data=avd/'m2-synthetic.img'
with data.open('xb') as f:f.truncate(1024**3)
env={**os.environ,'LD_LIBRARY_PATH':str(work/'e2fs-tools/usr/lib/x86_64-linux-gnu')}
with (work/'avd-format.txt').open('x') as log:
 subprocess.run([str(mk),'-F','-t','ext4','-b','4096','-I','256','-m','0','-O','encrypt,^orphan_file','-L','m2-synthetic',str(data)],env=env,stdout=log,stderr=log,check=True)
m={'syntheticOnly':True,'createdBy':'M2 Preflight','serial':'emulator-5582','avdName':'kanata_m2_api34','root':str(root),'avdHome':str(root/'avd'),'data':str(data),'sdk':str(sdk),'installedUserApps':[]}
with manifest.open('x') as f:json.dump(m,f,indent=2);f.write('\n')
env={**os.environ,'ANDROID_HOME':str(sdk),'ANDROID_SDK_ROOT':str(sdk),'ANDROID_USER_HOME':str(root/'prefs'),'ANDROID_AVD_HOME':m['avdHome'],'ANDROID_EMULATOR_HOME':str(root/'home')}
args=[str(emulator),'-avd',m['avdName'],'-port','5582','-accel','off','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-no-metrics','-gpu','swiftshader','-feature','-Vulkan','-memory','2560','-cores','2','-partition-size','1024','-data',str(data)]
with (work/'emulator-boot.txt').open('x') as log:p=subprocess.Popen(args,env=env,stdout=log,stderr=log,start_new_session=True)
print(json.dumps({'status':'PROCESS_STARTED_NOT_BOOT_VERIFIED','pid':p.pid,'manifest':str(manifest),'args':args}))
