"""Restore only an explicitly saved Todo fixture; compare in memory without private output."""
import os, subprocess, xml.etree.ElementTree as ET, json
from pathlib import Path
adb=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
serial=os.environ['TODO_QA_SERIAL'];user=os.environ.get('TODO_QA_USER','0');stage=os.environ['TODO_QA_STAGE']
def run(*args):
    p=subprocess.run([adb,'-s',serial,*args],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError('Fixture restore ADB error; private output suppressed')
    return p.stdout.strip()
saved=ET.fromstring(run('shell','run-as','com.yubin.formyself','--user',user,'cat','shared_prefs/TodoWidgetQaFixture.xml'))
assert saved.find("boolean[@name='saved']").attrib['value']=='true','No saved fixture: refusing destructive restore'
original=saved.find("string[@name='todo']")
assert original is not None,'A saved Todo snapshot is required'
expected=json.loads(original.text)
out=run('shell','am','instrument','--user',user,'-w','-e','class','com.yubin.formyself.TodoWidgetHarness','-e','todoQaAction','restore','com.yubin.formyself.test/androidx.test.runner.AndroidJUnitRunner')
assert 'OK (1 test)' in out
current=ET.fromstring(run('shell','run-as','com.yubin.formyself','--user',user,'cat','shared_prefs/CapacitorStorage.xml')).find("string[@name='my_todo_data_v1']")
actual=json.loads(current.text)
assert actual==expected,'Original Todo must be restored exactly'
report={'stage':stage,'fixtureRestoredExactly':True,'taskVersions':len(actual['tasks']),'completionRecords':len(actual['completions'])}
Path('Test_data/todo-'+stage+'-restored.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
