import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET
ADB=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
USER=os.environ.get('TODO_QA_USER','11')
def adb(*args):
    p=subprocess.run([ADB,'-s','emulator-5554',*args],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError('Widget open QA failed; private output suppressed')
    return p.stdout.strip()
adb('shell','uiautomator','dump','/sdcard/todo-open-ui.xml')
nodes=list(ET.fromstring(adb('shell','cat','/sdcard/todo-open-ui.xml')).iter('node'))
title=next(n for n in nodes if n.attrib.get('resource-id')=='com.yubin.formyself:id/todo_row_title' and n.attrib.get('text','').endswith('30'))
b=list(map(int,re.findall(r'\d+',title.attrib['bounds'])))
adb('shell','am','kill','--user',USER,'com.yubin.formyself')
adb('shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2))
time.sleep(2)
pid=adb('shell','pidof','com.yubin.formyself').split()[-1]
adb('forward','tcp:9222','localabstract:webview_devtools_remote_'+pid)
print('Actual desktop task title opened app from background')
