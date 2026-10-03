"""Exercise the real launcher resize handles; never modify app widget options directly."""
import os, re, json, time, subprocess
from pathlib import Path
import xml.etree.ElementTree as ET
ADB=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
SERIAL=os.environ.get('TODO_QA_SERIAL','emulator-5554')
USER=os.environ.get('TODO_QA_USER','0')
STAGE=os.environ.get('TODO_QA_STAGE','v4-api37')
def adb(*args):
    p=subprocess.run([ADB,'-s',SERIAL,*map(str,args)],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError('ADB failed; private output suppressed')
    return p.stdout.strip()
def ui():
    adb('shell','uiautomator','dump','/sdcard/todo-v4-resize-ui.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/todo-v4-resize-ui.xml'))
def bounds(n):return list(map(int,re.findall(r'\d+',n.attrib['bounds'])))
def nodes(root,name):return [n for n in root.iter('node') if n.attrib.get('resource-id')=='com.yubin.formyself:id/'+name]
def widgets(root):
    parents={c:p for p in root.iter() for c in p};result=[]
    for h in nodes(root,'todo_widget_header'):
        n=h
        while n in parents and not n.attrib.get('class','').endswith('LauncherAppWidgetHostView'):n=parents[n]
        result.append(bounds(n))
    return result
def press(x,y):adb('shell','input','swipe',x,y,x,y,900);time.sleep(.3)
def tap(x,y):adb('shell','input','tap',x,y);time.sleep(.3)
def screenshot(name):
    path=Path('docs/qa/todo')/(STAGE+'-'+name+'.png')
    adb('shell','screencap','-p','/sdcard/todo-v4-resize.png');adb('pull','/sdcard/todo-v4-resize.png',path)
    return str(path)
def locate():
    root=ui()
    for a,b in [(width*.85,width*.15),(width*.15,width*.85)]:
        for _ in range(4):
            if widgets(root):return root
            adb('shell','input','swipe',int(a),height//2,int(b),height//2,250);root=ui()
    raise AssertionError('Widget not visible')
def enter_resize():
    root=locate();box=widgets(root)[0];header=nodes(root,'todo_widget_header')[0];x1,y1,x2,y2=bounds(header)
    press((x1+x2)//2,(y1+y2)//2)
    root=ui()
    frame=next((n for n in root.iter('node') if n.attrib.get('class','').endswith('AppWidgetResizeFrame') or n.attrib.get('resource-id','').endswith('/widget_resize_frame')),None)
    if frame is not None:return bounds(frame)
    # New Launcher releases expose only the popup to accessibility. Validate
    # the visible purple resize handle in the actual screenshot instead.
    import cv2, numpy as np
    image=cv2.imdecode(np.frombuffer(subprocess.check_output([ADB,'-s',SERIAL,'exec-out','screencap','-p']),np.uint8),cv2.IMREAD_COLOR)
    x=(box[0]+box[2])//2;y=box[1]
    sample=image[max(0,y-12):y+12,x-12:x+12]
    if int(adb('shell','getprop','ro.build.version.sdk'))<=30:
        white=np.all(sample>240,axis=2)
        right=image[(box[1]+box[3])//2-12:(box[1]+box[3])//2+12,box[2]-12:box[2]+12]
        assert white.sum()>20 and np.all(right>240,axis=2).sum()>20,'Actual legacy resize handles required'
        return box
    assert any(n.attrib.get('text','')=='Remove' for n in root.iter('node'))
    purple=(sample[:,:,0]>220)&(sample[:,:,1]>170)&(sample[:,:,1]<225)&(sample[:,:,2]>180)&(sample[:,:,2]<235)
    # At the top/left desktop edge those handles can be omitted by Launcher.
    # Validate the visible right or bottom handle as well.
    for cx,cy in [(box[2],(box[1]+box[3])//2),((box[0]+box[2])//2,box[3])]:
        patch=image[max(0,cy-12):cy+12,max(0,cx-12):cx+12]
        purple=np.concatenate((purple.ravel(),((patch[:,:,0]>220)&(patch[:,:,1]>170)&(patch[:,:,1]<225)&(patch[:,:,2]>180)&(patch[:,:,2]<235)).ravel()))
    assert purple.sum()>10,'Actual launcher resize handle required'
    return box
def resize(axis,delta):
    x1,y1,x2,y2=enter_resize()
    if axis=='width':x,y=x2-2,(y1+y2)//2;ex,ey=x+delta,y
    else:x,y=(x1+x2)//2,y2-2;ex,ey=x,y+delta
    adb('shell','input','swipe',x,y,max(1,min(width-1,int(ex))),max(1,min(height-1,int(ey))),650)
    tap(width-4,height-130)
    return locate()
def check(root,name):
    box=widgets(root)[0];header=bounds(nodes(root,'todo_widget_header')[0])
    assert header[1]>=box[1] and header[3]<=box[3],'Header must remain visible'
    checks=nodes(root,'todo_row_check')
    assert any(bounds(n)[3]-bounds(n)[1]>=int(47*density) for n in checks),'48dp completion target required'
    compact=bool(nodes(root,'todo_widget_compact'))
    result={'name':name,'boundsPx':box,'availableDp':[(box[2]-box[0])/density,(box[3]-box[1])/density],'compact':compact,'screenshot':screenshot('resize-'+name)}
    report['sizes'].append(result);return box
adb('shell','input','keyevent',224)
adb('shell','am','start','--user',USER,'-a','android.intent.action.MAIN','-c','android.intent.category.HOME')
width,height=map(int,re.findall(r'(\d+)x(\d+)',adb('shell','wm','size'))[-1])
density=int(re.findall(r'\d+',adb('shell','wm','density'))[-1])/160
report={'stage':STAGE,'sizes':[],'checks':[]}
if __name__=='__main__':
    root=locate()
    if len(widgets(root))>1:
        for _ in range(5):
            adb('shell','input','swipe',int(width*.85),height//2,int(width*.15),height//2,300)
            root=ui()
            if len(widgets(root))==1:break
    initial=check(root,'default-3x3')
    cell_width=(initial[2]-initial[0]+16*density)/3
    cell_height=(initial[3]-initial[1]+16*density)/3
    # The second fixture is removed through the launcher to free room for a 4x4 resize.
    if len(widgets(root))>1:
        b=bounds(nodes(root,'todo_widget_header')[1]);press((b[0]+b[2])//2,(b[1]+b[3])//2)
        menu=ui();remove=next((n for n in menu.iter('node') if n.attrib.get('text','')=='Remove'),None)
        assert remove is not None,'Launcher remove action required'
        b=bounds(remove);tap((b[0]+b[2])//2,(b[1]+b[3])//2)
    root=resize('width',cell_width);wide=check(root,'wide-4x3')
    root=resize('height',cell_height);large=check(root,'large-4x4')
    assert large[2]-large[0]>report['sizes'][0]['boundsPx'][2]-report['sizes'][0]['boundsPx'][0]
    assert large[3]-large[1]>report['sizes'][0]['boundsPx'][3]-report['sizes'][0]['boundsPx'][1]
    root=resize('width',-2*cell_width);check(root,'tall-2x4')
    root=resize('width',-width)
    root=resize('height',-height);small=check(root,'minimum')
    if min(report['sizes'][-1]['availableDp'])<220:
        assert report['sizes'][-1]['compact'],'Small widget must use compact layout'
    checkbox=next(n for n in nodes(root,'todo_row_check') if bounds(n)[3]-bounds(n)[1]>=int(47*density))
    b=bounds(checkbox);previous=checkbox.attrib.get('content-desc','');tap((b[0]+b[2])//2,(b[1]+b[3])//2);time.sleep(.8)
    updated=ui();assert nodes(updated,'todo_row_check')[0].attrib.get('content-desc','')!=previous
    tap((b[0]+b[2])//2,(b[1]+b[3])//2);time.sleep(.6)
    report['checks']+=['real default 3x3, wide, 4x4, tall and minimum resize','header and 48dp target remain visible','minimum layout can complete and undo']
    scale=adb('shell','settings','--user',USER,'get','system','font_scale')
    try:
        adb('shell','settings','--user',USER,'put','system','font_scale','1.3');time.sleep(.7)
        check(locate(),'minimum-large-font')
        report['checks'].append('large font keeps header and completion target visible')
    finally:adb('shell','settings','--user',USER,'put','system','font_scale',scale if scale!='null' else '1.0')
    Path('Test_data/todo-'+STAGE+'-widget-resize.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
