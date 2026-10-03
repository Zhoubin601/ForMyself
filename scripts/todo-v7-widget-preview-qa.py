"""Capture only synthetic widget fixtures; verify empty and reference headers."""
import importlib.util, json, os, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('resize',Path(__file__).with_name('todo-v4-widget-resize-qa.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
root=q.locate();mode=os.environ.get('TODO_QA_PREVIEW','reference')
expected='0/0' if mode=='empty' else '1/4'
# Fixture instrumentation exits before the launcher has drained its queued views.
deadline=time.monotonic()+10
while time.monotonic()<deadline:
    counts=q.nodes(root,'todo_widget_count')
    if counts and all(n.attrib.get('text')==expected for n in counts):break
    time.sleep(.5);root=q.locate()
counts=q.nodes(root,'todo_widget_count');assert counts and all(n.attrib.get('text')==expected for n in counts),f'Expected {expected}; visible counts {[n.attrib.get("text") for n in counts]}'
assert q.nodes(root,'todo_widget_fill') and any(n.attrib.get('text')=='TODAY' for n in root.iter('node'))
if mode=='empty':assert q.nodes(root,'todo_widget_empty') and not q.nodes(root,'todo_row_check')
else:
    checks=q.nodes(root,'todo_row_check');assert checks
    assert any(n.attrib.get('content-desc','').startswith('完成 ') for n in checks)
    assert any(n.attrib.get('content-desc','').startswith('撤销完成 ') for n in checks)
report={'stage':q.STAGE,'mode':mode,'count':expected,'screenshot':q.screenshot(mode)}
Path('Test_data/todo-'+q.STAGE+'-'+mode+'.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
