import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET
ADB=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
USER=os.environ.get('TODO_QA_USER','11')
SERIAL=os.environ.get('TODO_QA_SERIAL','emulator-5554')
def adb(*args):
    p=subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError('Widget pin QA failed; private output suppressed')
    return p.stdout
pin_count=int(os.environ.get('TODO_QA_PIN_COUNT','2'))
for _ in range(pin_count):
    if os.environ.get('TODO_QA_PIN_NATIVE')=='1':
        result=adb('shell','am','instrument','-w','-e','class','com.yubin.formyself.TodoWidgetHarness','-e','todoQaAction','pin','com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner')
        assert 'OK (1 test)' in result
    else:
        adb('shell','am','start','--user',USER,'-a','android.intent.action.VIEW','-d','formyself://widget/add?type=todo','-n','com.yubin.formyself/.MainActivity')
    time.sleep(.5)
    button=None
    for attempt in range(8):
        try:
            adb('shell','uiautomator','dump','/sdcard/todo-pin-ui.xml')
            nodes=list(ET.fromstring(adb('shell','cat','/sdcard/todo-pin-ui.xml')).iter('node'))
            button=next((n for n in nodes if n.attrib.get('text','').lower() in ('add to home screen','add automatically')),None)
            if button is not None:break
        except RuntimeError:pass
        time.sleep(.3)
    assert button is not None,'Launcher confirmation button unavailable'
    b=list(map(int,re.findall(r'\d+',button.attrib['bounds'])))
    adb('shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2))
    time.sleep(.5)
print(f'{pin_count} native widgets added through launcher confirmation')
