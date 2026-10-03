"""Actual emulator reboot; only hash the synthetic Todo subtree, never print private XML."""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
ADB=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
USER=os.environ.get('TODO_QA_USER','11')
SERIAL=os.environ.get('TODO_QA_SERIAL','emulator-5554')
STAGE=sys.argv[1]
def adb(*args):
    p=subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,encoding='utf-8',timeout=20)
    if p.returncode:raise RuntimeError('ADB failed; private output suppressed')
    return p.stdout.strip()
def data():
    xml=adb('shell','run-as','com.yubin.formyself','--user',USER,'grep','my_todo_data_v1','shared_prefs/CapacitorStorage.xml')
    return json.loads(html.unescape(re.search(r'<string name="my_todo_data_v1">(.*?)</string>',xml,re.S)[1]))
def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
before=data()
if '--cold' in sys.argv:
    adb('emu','kill')
    time.sleep(2)
    emulator=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/emulator/emulator.exe')
    log=Path('Test_data/todo-'+STAGE+'-coldboot-emulator.log').open('w',encoding='utf-8')
    subprocess.Popen([emulator,'-avd',os.environ.get('TODO_QA_AVD','Pixel_6_Pro'),'-port',SERIAL.split('-')[-1],'-no-window','-no-snapshot-load','-no-snapshot-save','-no-boot-anim','-no-audio','-gpu',os.environ.get('TODO_QA_GPU','swiftshader_indirect')],stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
else:
    adb('reboot')
for _ in range(60):
    try:
        if adb('shell','getprop','sys.boot_completed')=='1':break
    except RuntimeError:
        pass
    time.sleep(1)
else:raise RuntimeError('Emulator did not finish reboot')
for _ in range(30):
    try:
        adb('shell','am','switch-user',USER)
        break
    except RuntimeError:
        time.sleep(.5)
else:raise RuntimeError('Android user service not ready')
adb('shell','input','keyevent','224')
adb('shell','wm','dismiss-keyguard')
width,height=map(int,re.findall(r'(\d+)x(\d+)',adb('shell','wm','size'))[-1])
adb('shell','input','swipe',str(width//2),str(height*4//5),str(width//2),str(height//5),'300')
for _ in range(30):
    try:
        after=data()
        break
    except (RuntimeError,TypeError):
        time.sleep(.5)
else:raise RuntimeError('QA user not unlocked after reboot')
assert digest(before)==digest(after),'Todo versions, overrides and completion keys must persist exactly'
for _ in range(40):
    try:
        adb('shell','am','start','--user',USER,'-n','com.yubin.formyself/.MainActivity')
        break
    except RuntimeError:
        time.sleep(.5)
else:raise RuntimeError('QA app not ready after reboot')
time.sleep(2)
adb('shell','wm','dismiss-keyguard')
pid=adb('shell','pidof','com.yubin.formyself').split()[0]
adb('forward','tcp:'+os.environ.get('TODO_QA_CDP_PORT','9222'),'localabstract:webview_devtools_remote_'+pid)
report={'stage':STAGE,'user':USER,'actualDeviceReboot':True,'coldBoot':'--cold' in sys.argv,'snapshotUnchanged':True,'taskVersions':len(after['tasks']),'completionRecords':len(after['completions'])}
Path('Test_data/todo-'+STAGE+'-reboot.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
