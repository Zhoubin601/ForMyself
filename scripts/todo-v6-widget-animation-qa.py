"""Measure actual launcher frames, for the mint ring, including a cold app process and multiple widgets."""
import os
import re
import json
import html
import time
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
import cv2
import numpy as np

ADB=str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe')
SERIAL=os.environ.get('TODO_QA_SERIAL','emulator-5554')
USER=os.environ.get('TODO_QA_USER','10')
STAGE=os.environ.get('TODO_QA_STAGE','v4-api37')
DEST=Path('docs/qa/todo')
def adb(*args):
    p=subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError('ADB failed; private output suppressed')
    return p.stdout.strip()
def ui():
    adb('shell','uiautomator','dump','/sdcard/todo-v4-animation-ui.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/todo-v4-animation-ui.xml'))
def bounds(node):return list(map(int,re.findall(r'\d+',node.attrib['bounds'])))
def nodes(root,name):return [n for n in root.iter('node') if n.attrib.get('resource-id')=='com.yubin.formyself:id/'+name]
def tap(box):adb('shell','input','tap',str((box[0]+box[2])//2),str((box[1]+box[3])//2))
def stats(root):
    return [n.attrib['text'] for n in nodes(root,'todo_widget_count')+nodes(root,'todo_widget_compact')]
def completion_ratio():
    # Read only the opt-in synthetic Todo fixture, never other backup modules.
    xml=adb('shell','run-as','com.yubin.formyself','--user',USER,'grep','my_todo_data_v1','shared_prefs/CapacitorStorage.xml')
    data=json.loads(html.unescape(re.search(r'<string name="my_todo_data_v1">(.*?)</string>',xml,re.S)[1]))
    assert all(t['id'].startswith('qa-widget-') for t in data['tasks'])
    assert len(data['tasks'])==1,'This recording measures a 0–100% transition'
    return len(data['completions'])/len(data['tasks'])
def counts(root):
    return [int(re.search(r'(\d+)\s*/',n.attrib['text']).group(1)) for n in nodes(root,'todo_widget_count')]+[int(re.search(r'\s(\d+)/',n.attrib['text']).group(1)) for n in nodes(root,'todo_widget_compact')]

adb('shell','input','keyevent','224')
adb('shell','am','start','--user',USER,'-a','android.intent.action.MAIN','-c','android.intent.category.HOME')
adb('shell','am','kill','--user',USER,'com.yubin.formyself')
time.sleep(1)
width,height=map(int,re.findall(r'(\d+)x(\d+)',adb('shell','wm','size'))[-1])
density=int(re.findall(r'\d+',adb('shell','wm','density'))[-1])/160
root=ui()
for direction in [(width*.85,width*.15),(width*.15,width*.85)]:
    for _ in range(4):
        if len(nodes(root,'todo_widget_header'))>=2:break
        adb('shell','input','swipe',str(int(direction[0])),str(height//2),str(int(direction[1])),str(height//2),'300')
        time.sleep(.25);root=ui()
widgets=[bounds(n) for n in nodes(root,'todo_widget_fill')]
assert len(widgets)>=2,'Two visible widget instances required'
checks=nodes(root,'todo_row_check')
checkbox=bounds(next(n for n in checks if bounds(n)[3]-bounds(n)[1]>=int(40*density)))
second=bounds(next(n for n in checks if bounds(n)!=checkbox and bounds(n)[3]-bounds(n)[1]>=int(40*density)))
baseline=stats(root)
original_scale=adb('shell','settings','get','global','animator_duration_scale')

# Prove cold-process coverage after preparing the visible launcher cache.
# Legacy factories release their service binding after about five seconds.
time.sleep(6.5)
adb('shell','am','kill','--user',USER,'com.yubin.formyself');time.sleep(.3)
assert subprocess.run([ADB,'-s',SERIAL,'shell','pidof','com.yubin.formyself'],capture_output=True).returncode!=0,'App process must be absent before the recording click'
def record(name,rapid=False):
    remote='/sdcard/'+name+'.mp4'
    record_height=int(height*720/width)//2*2
    process=subprocess.Popen([ADB,'-s',SERIAL,'shell','screenrecord','--time-limit','8','--size',f'720x{record_height}','--bit-rate','4000000',remote],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(.6)
    if rapid:
        for box in (checkbox,second,checkbox,second):tap(box);time.sleep(.05)
    else:
        tap(checkbox);time.sleep(2);tap(checkbox)
    process.wait(timeout=15);assert process.returncode==0
    path=DEST/(name+'.mp4');adb('pull',remote,str(path));return path
def measure(path):
    capture=cv2.VideoCapture(str(path));fps=capture.get(cv2.CAP_PROP_FPS);samples=[]
    while True:
        ok,frame=capture.read()
        if not ok:break
        sx=frame.shape[1]/width;sy=frame.shape[0]/height
        edges=[]
        for x1,y1,x2,y2 in widgets:
            cx=(x1+x2)*sx/2;cy=(y1+y2)*sy/2
            radius=(x2-x1)*sx*35/96
            angle=np.linspace(-np.pi/2,3*np.pi/2,360,endpoint=False)
            xs=np.rint(cx+radius*np.cos(angle)).astype(int)
            ys=np.rint(cy+radius*np.sin(angle)).astype(int)
            colors=frame[ys,xs].astype(np.int16)
            mint=(colors[:,1]>165)&(colors[:,2]<130)&(colors[:,0]>120)&(colors[:,1]>colors[:,2]*1.3)
            edges.append(int(mint.sum()))
        samples.append({'ms':capture.get(cv2.CAP_PROP_POS_MSEC),'edges':edges})
        if len(samples)==int(fps):cv2.imwrite(str(DEST/(path.stem+'-frame.png')),frame)
    capture.release();return fps,samples
def transitions(samples,index):
    edges=np.array([s['edges'][index] for s in samples]);times=np.array([s['ms'] for s in samples])
    low,high=int(edges.min()),int(edges.max());assert high-low>=340,'Ring must span the full visible 0 to 100 percent transition'
    moving=np.flatnonzero(edges>low+1)
    begin=moving[0];top=np.flatnonzero(edges>=high-1)[0]
    returning=np.flatnonzero((np.arange(len(edges))>top)&(edges<high-1))[0]
    finish=np.flatnonzero((np.arange(len(edges))>returning)&(edges<=low+1))[0]
    details=[]
    for start,end,direction in [(begin,top,1),(returning,finish,-1)]:
        duration=times[end]-times[start]
        intermediate=len(set(edges[start:end]))
        updates=[];last=edges[start]
        for n in range(start,end+1):
            ratio=(edges[n]-low)/(high-low)
            if .1<=ratio<=.9 and edges[n]!=last:updates.append(times[n])
            last=edges[n]
        gap=max(np.diff(updates),default=0)
        assert 320<=duration<=480,f'Visible transition duration {duration:.1f}ms outside target'
        assert gap<=80,f'Major-phase stall {gap:.1f}ms'
        assert intermediate>=5,'Insufficient continuous launcher positions'
        assert np.all(np.diff(edges[start:end+1])*direction>=-2),'Progress must not oscillate'
        details.append({'durationMs':round(float(duration),2),'largestMajorGapMs':round(float(gap),2),'intermediatePositions':intermediate})
    assert abs(edges[-1]-edges[0])<=2,'Undo must settle to baseline'
    return details
try:
    adb('shell','settings','put','global','animator_duration_scale','1')
    path=record(STAGE+'-widget-animation');fps,samples=measure(path)
    movement=[transitions(samples,i) for i in range(len(widgets))]
    assert stats(ui())==baseline
    rapid_path=record(STAGE+'-widget-rapid',True);_,rapid=measure(rapid_path)
    # Validate the latest committed state, including interleaved instance clicks.
    # Android can coalesce physical touch events while a host view is updating.
    ratio=completion_ratio()
    assert all(c==round(ratio) for c in counts(ui())),'All widget counts must agree with repository after rapid clicks'
    for i,(x1,y1,x2,y2) in enumerate(widgets):
        expected=round(360*ratio)
        assert abs(rapid[-1]['edges'][i]-expected)<=2,'Animation must settle to repository state'
    if ratio>0:tap(checkbox);time.sleep(1)
    assert stats(ui())==baseline
    adb('shell','settings','put','global','animator_duration_scale','0')
    reduced_path=record(STAGE+'-widget-reduced');_,reduced=measure(reduced_path)
    for i in range(len(widgets)):
        edges=[s['edges'][i] for s in reduced];low,high=min(edges),max(edges)
        assert len(set(e for e in edges if low+2<e<high-2))<=1,'Reduced motion must update directly'
    assert stats(ui())==baseline
    report={'stage':STAGE,'fps':fps,'movement':movement,'rapidTargetRatio':ratio,'coldProcessVerified':True,'measurement':'mint arc degrees in actual ring pixels','checks':['cold app process animates desktop completion','400ms forward and reverse launcher transition','major phase stall no more than 80ms','multiple widgets reach same final ratio','rapid toggles settle to latest state','reduced motion uses direct update'],'samples':samples,'rapidSamples':rapid,'reducedSamples':reduced}
    Path(f'Test_data/todo-{STAGE}-widget-animation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('Samples') and k!='samples'}))
finally:adb('shell','settings','put','global','animator_duration_scale',original_scale if original_scale!='null' else '1')
