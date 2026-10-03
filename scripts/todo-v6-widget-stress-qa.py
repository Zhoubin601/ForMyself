"""Repeated desktop toggles must keep the host callback and every count alive."""
import importlib.util, json, time, xml.etree.ElementTree as ET
from pathlib import Path
spec=importlib.util.spec_from_file_location('resize',Path(__file__).with_name('todo-v4-widget-resize-qa.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

def completed():
    xml=q.adb('shell','run-as','com.yubin.formyself','--user',q.USER,'cat','shared_prefs/CapacitorStorage.xml')
    data=json.loads(ET.fromstring(xml).find("string[@name='my_todo_data_v1']").text)
    assert len(data['tasks'])==30 and all(t['id'].startswith('qa-widget-') for t in data['tasks'])
    return len(data['completions'])

assert completed()==0
steps=[]
for index in range(12):
    root=q.locate()
    check=next(n for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    before=check.attrib.get('content-desc','')
    b=q.bounds(check);q.tap((b[0]+b[2])//2,(b[1]+b[3])//2);time.sleep(.65)
    after=q.locate();count=completed()
    assert count==(index+1)%2,'Each delivered desktop toggle must persist once'
    counts=[int(n.attrib.get('text').split('/')[0]) for n in q.nodes(after,'todo_widget_count')]
    assert counts and all(n==count for n in counts),'The launcher callback must continue delivering data'
    changed=next(n for n in q.nodes(after,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert before!=changed.attrib.get('content-desc',''),'Checkbox must match the saved state'
    steps.append({'step':index+1,'completed':count,'visibleInstances':len(counts)})
report={'stage':q.STAGE,'checks':['12 consecutive complete/undo actions persist exactly once','every visible widget count matches repository','host keeps receiving updates'],'steps':steps}
Path('Test_data/todo-'+q.STAGE+'-stress.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
