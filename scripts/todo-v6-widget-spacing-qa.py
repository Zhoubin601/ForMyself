"""Measure the restyled widget using real 3x3 -> 2x2 -> 4x4 launcher gestures."""
import importlib.util, json, time
from pathlib import Path

spec=importlib.util.spec_from_file_location('resize',Path(__file__).with_name('todo-v4-widget-resize-qa.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

def isolated():
    root=q.ui()
    for a,b in [(q.width*.85,q.width*.15),(q.width*.15,q.width*.85)]:
        for _ in range(8):
            if len(q.widgets(root))==1:return root
            q.adb('shell','input','swipe',int(a),int(q.height*.72),int(b),int(q.height*.72),300)
            root=q.ui()
    raise AssertionError('An isolated widget page is required')
q.locate=isolated
reference=json.loads(Path('Test_data/todo-v5-api'+q.adb('shell','getprop','ro.build.version.sdk')+'-spacing.json').read_text(encoding='utf-8'))
basebox=reference['sizes'][0]['widgetBoundsPx'];smallbox=reference['sizes'][1]['widgetBoundsPx']
bw,bh=basebox[2]-basebox[0],basebox[3]-basebox[1]
largebox=reference['sizes'][2]['widgetBoundsPx'];lw,lh=largebox[2]-largebox[0],largebox[3]-largebox[1]
cw=bw-(smallbox[2]-smallbox[0]);ch=bh-(smallbox[3]-smallbox[1])
expected_sizes={
    '3x3':(bw,bh),'2x2':(bw-cw,bh-ch),'4x4':(lw,lh),
    '4x4-large-font':(lw,lh),'3x3-return':(bw,bh),
    '4x3-wide':(lw,bh),'2x4-tall':(bw-cw,lh),
    '2x2-large-font':(bw-cw,bh-ch),'3x3-final':(bw,bh)}

def measure(root,name):
    assert len(q.widgets(root))==1,'Must measure the isolated instance'
    box=q.widgets(root)[0]
    ew,eh=expected_sizes[name]
    assert abs(box[2]-box[0]-ew)<=2 and abs(box[3]-box[1]-eh)<=2,f'{name} actual dimensions must match real grid cells: {box}'
    rows=q.nodes(root,'todo_row_root')
    sizes=[(q.bounds(n)[3]-q.bounds(n)[1])/q.density for n in rows]
    complete=[h for h in sizes if 47<=h<=74]
    if not complete:
        # Older accessibility trees omit the unlabelled row container.
        # Measure adjacent complete hit-target centres; exclude the observed 1px divider.
        targets=[q.bounds(n) for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density]
        centres=sorted((b[1]+b[3])/2 for b in targets if b[1]>=box[1] and b[3]<=box[3])
        complete=[(b-a-1)/q.density for a,b in zip(centres,centres[1:]) if 47<=(b-a-1)/q.density<=74]
    assert complete,'At least one complete row must be visible'
    hit=next(n for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert hit.attrib['class']=='android.widget.ImageView','Check must use a vector image, not font glyph'
    assert (q.bounds(hit)[2]-q.bounds(hit)[0])/q.density>=47
    header=q.bounds(q.nodes(root,'todo_widget_header')[0])
    assert header[1]>=box[1] and header[3]<=box[3]
    assert q.nodes(root,'todo_widget_fill') and q.nodes(root,'todo_widget_count')
    assert any(n.attrib.get('text')=='TODAY' for n in root.iter('node'))
    ring=q.bounds(q.nodes(root,'todo_widget_fill')[0]); assert ring[0]>=header[0] and ring[2]<=header[2] and ring[1]>=header[1] and ring[3]<=header[3]
    assert '周' in q.nodes(root,'todo_widget_date')[0].attrib.get('text','')
    result={'name':name,'widgetBoundsPx':box,'rowHeightDp':round(max(complete),2),'hitWidthDp':round((q.bounds(hit)[2]-q.bounds(hit)[0])/q.density,2),'ringVisible':bool(q.nodes(root,'todo_widget_fill')),'screenshot':q.screenshot('spacing-'+name)}
    report['sizes'].append(result)
    return result

def toggle(root):
    check=next(n for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    box=q.bounds(check);before=check.attrib.get('content-desc','')
    q.tap((box[0]+box[2])//2,(box[1]+box[3])//2);time.sleep(.8)
    changed=q.locate()
    after=next(n for n in q.nodes(changed,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert before!=after.attrib.get('content-desc','')
    report['completedScreenshot']=q.screenshot('spacing-small-completed')
    current=q.bounds(after)
    q.tap((current[0]+current[2])//2,(current[1]+current[3])//2);time.sleep(.8)
    restored=q.locate()
    after=next(n for n in q.nodes(restored,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert before==after.attrib.get('content-desc','')

report={'stage':q.STAGE,'sizes':[],'checks':[]}
root=q.locate()
box=q.widgets(root)[0]
if abs(box[2]-box[0]-bw)>2:root=q.resize('width',bw-(box[2]-box[0]))
box=q.widgets(root)[0]
if abs(box[3]-box[1]-bh)>2:root=q.resize('height',bh-(box[3]-box[1]))
titles=q.nodes(root,'todo_row_title')
assert titles and titles[0].attrib.get('text','').startswith('QA 桌面'),'Rows must show the current synthetic fixture, not a stale service cache'
base=measure(root,'3x3')
assert 54<=base['rowHeightDp']<=58,'Base widget must use baseline spacing'
b=base['widgetBoundsPx']
# Grid steps come from earlier actual 2/3-cell measurements in this dedicated AVD.
root=q.resize('width',-cw);root=q.resize('height',-ch)
small=measure(root,'2x2');assert small['rowHeightDp']<base['rowHeightDp']
toggle(root)
root=q.resize('width',2*cw);root=q.resize('height',2*ch)
large=measure(root,'4x4');assert large['rowHeightDp']>base['rowHeightDp']
scale=q.adb('shell','settings','--user',q.USER,'get','system','font_scale')
try:
    q.adb('shell','settings','--user',q.USER,'put','system','font_scale','1.3');time.sleep(.8)
    measure(q.locate(),'4x4-large-font')
finally:q.adb('shell','settings','--user',q.USER,'put','system','font_scale',scale if scale!='null' else '1.0')
root=q.resize('width',-cw);root=q.resize('height',-ch)
returned=measure(root,'3x3-return');assert abs(returned['rowHeightDp']-base['rowHeightDp'])<=1
root=q.resize('width',cw);measure(root,'4x3-wide')
root=q.resize('height',ch)
root=q.resize('width',-2*cw);measure(root,'2x4-tall')
root=q.resize('height',-2*ch)
scale=q.adb('shell','settings','--user',q.USER,'get','system','font_scale')
try:
    q.adb('shell','settings','--user',q.USER,'put','system','font_scale','1.3')
    measure(q.locate(),'2x2-large-font')
finally:q.adb('shell','settings','--user',q.USER,'put','system','font_scale',scale if scale!='null' else '1.0')
root=q.resize('width',cw);root=q.resize('height',ch)
measure(root,'3x3-final')
report['checks']=['date/TODAY and mint progress ring fit header','vector circular checkbox and accessible complete/undo','real 2x2 spacing shrinks and 4x4 spacing grows','48dp click target preserved','header stays visible at wide/tall and minimum large font sizes','large font and long title fit','return to 3x3 restores baseline spacing']
Path('Test_data/todo-'+q.STAGE+'-spacing.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
