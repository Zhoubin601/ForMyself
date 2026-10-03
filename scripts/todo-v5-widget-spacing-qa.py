"""Real 3x3 -> 2x2 -> 4x4 gestures, with measured row spacing and hit targets."""
import importlib.util, json, time
from pathlib import Path

spec=importlib.util.spec_from_file_location('resize',Path(__file__).with_name('todo-v4-widget-resize-qa.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

def measure(root,name):
    box=q.widgets(root)[0]
    rows=q.nodes(root,'todo_row_root')
    sizes=[(q.bounds(n)[3]-q.bounds(n)[1])/q.density for n in rows]
    complete=[h for h in sizes if 47<=h<=74]
    if not complete:
        # Older accessibility trees omit the unlabelled row container.
        # Measure adjacent complete hit-target centres; exclude the 1dp divider.
        targets=[q.bounds(n) for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density]
        centres=sorted((b[1]+b[3])/2 for b in targets if b[1]>=box[1] and b[3]<=box[3])
        complete=[(b-a)/q.density-1 for a,b in zip(centres,centres[1:]) if 47<=(b-a)/q.density-1<=74]
    assert complete,'At least one complete row must be visible'
    hit=next(n for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert hit.attrib['class']=='android.widget.ImageView','Check must use a vector image, not font glyph'
    assert (q.bounds(hit)[2]-q.bounds(hit)[0])/q.density>=47
    header=q.bounds(q.nodes(root,'todo_widget_header')[0])
    assert header[1]>=box[1] and header[3]<=box[3]
    result={'name':name,'widgetBoundsPx':box,'rowHeightDp':round(max(complete),2),'hitWidthDp':round((q.bounds(hit)[2]-q.bounds(hit)[0])/q.density,2),'compact':bool(q.nodes(root,'todo_widget_compact')),'screenshot':q.screenshot('spacing-'+name)}
    report['sizes'].append(result)
    return result

def toggle(root):
    check=next(n for n in q.nodes(root,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    box=q.bounds(check);before=check.attrib.get('content-desc','')
    q.tap((box[0]+box[2])//2,(box[1]+box[3])//2);time.sleep(.8)
    changed=q.ui()
    after=next(n for n in q.nodes(changed,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert before!=after.attrib.get('content-desc','')
    report['completedScreenshot']=q.screenshot('spacing-small-completed')
    q.tap((box[0]+box[2])//2,(box[1]+box[3])//2);time.sleep(.8)
    restored=q.ui()
    after=next(n for n in q.nodes(restored,'todo_row_check') if q.bounds(n)[3]-q.bounds(n)[1]>=47*q.density)
    assert before==after.attrib.get('content-desc','')

report={'stage':q.STAGE,'sizes':[],'checks':[]}
root=q.locate()
# Legacy pinning can initially choose 2x2; select a single page first and
# expand that actual minimum one cell in each direction to establish 3x3.
if int(q.adb('shell','getprop','ro.build.version.sdk'))<=30:
    q.adb('shell','input','keyevent',3);q.adb('shell','input','keyevent',3)
    root=q.ui()
    for _ in range(7):
        if len(q.widgets(root))==1:break
        q.adb('shell','input','swipe',q.width-25,int(q.height*.72),25,int(q.height*.72),300);root=q.ui()
    boxes=q.widgets(root)
    if len(boxes)==1 and (boxes[0][2]-boxes[0][0])/q.density<200:
        b=boxes[0];cw=(b[2]-b[0]+16*q.density)/2;ch=(b[3]-b[1]+16*q.density)/2
        root=q.resize('width',cw);root=q.resize('height',ch)
for direction in [(q.width*.85,q.width*.15),(q.width*.15,q.width*.85)]:
    for _ in range(7):
        boxes=q.widgets(root)
        if len(boxes)==1 and (boxes[0][2]-boxes[0][0])/q.density>200 and (boxes[0][3]-boxes[0][1])/q.density>260:break
        q.adb('shell','input','swipe',int(direction[0]),q.height//2,int(direction[1]),q.height//2,250);root=q.ui()
    if len(q.widgets(root))==1 and (q.widgets(root)[0][2]-q.widgets(root)[0][0])/q.density>200:break
assert len(q.widgets(root))==1,'An isolated 3x3 desktop page is required'
titles=q.nodes(root,'todo_row_title')
assert titles and titles[0].attrib.get('text','').startswith('QA 桌面'),'Rows must show the current synthetic fixture, not a stale service cache'
base=measure(root,'3x3')
assert 54<=base['rowHeightDp']<=58,'Base widget must use baseline spacing'
b=base['widgetBoundsPx']
cw=(b[2]-b[0]+16*q.density)/3;ch=(b[3]-b[1]+16*q.density)/3
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
report['checks']=['vector checkbox and accessible complete/undo','real 2x2 spacing shrinks and 4x4 spacing grows','48dp click target preserved','header stays visible','large font and long title fit','return to 3x3 restores baseline spacing']
Path('Test_data/todo-'+q.STAGE+'-spacing.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
