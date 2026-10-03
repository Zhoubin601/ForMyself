"""Record actual launcher rendering and measure both synthetic Todo widgets."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET
import cv2
import numpy as np

ADB = str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe')
DEST = Path('docs/qa/todo')
USER = os.environ.get('TODO_QA_USER', '10')
DEST.mkdir(parents=True, exist_ok=True)

def adb(*args):
    result = subprocess.run([ADB, '-s', 'emulator-5554', *args], capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('ADB failed; command output suppressed')
    return result.stdout.strip()

def ui():
    adb('shell', 'uiautomator', 'dump', '/sdcard/todo-widget-ui.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/todo-widget-ui.xml')).iter('node'))

def nodes(tree, resource):
    return [n for n in tree if n.attrib.get('resource-id') == 'com.yubin.formyself:id/' + resource]

def bounds(node):
    return list(map(int, re.findall(r'\d+', node.attrib['bounds'])))

def tap(node):
    b = bounds(node)
    adb('shell', 'input', 'tap', str((b[0]+b[2])//2), str((b[1]+b[3])//2))

def counts(tree):
    return [n.attrib['text'] for n in nodes(tree, 'todo_widget_count')]

def record(name, checkbox, settle, second=None):
    remote = '/sdcard/' + name + '.mp4'
    process = subprocess.Popen([ADB, '-s', 'emulator-5554', 'shell', 'screenrecord', '--time-limit', '4', '--size', '720x1560', '--bit-rate', '6000000', remote], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(.5)
    if second is None:
        tap(checkbox)
        time.sleep(settle)
        tap(checkbox)
    else:
        tap(checkbox)
        time.sleep(.05)
        tap(second)
        time.sleep(.05)
        tap(checkbox)
        time.sleep(.05)
        tap(second)
    process.wait(timeout=10)
    assert process.returncode == 0
    target = DEST / (name + '.mp4')
    adb('pull', remote, str(target))
    return target

def measure(path, headers):
    video = cv2.VideoCapture(str(path))
    fps = video.get(cv2.CAP_PROP_FPS)
    samples = []
    saved = False
    while True:
        ok, frame = video.read()
        if not ok:
            break
        edges = []
        for header in headers:
            x1,y1,x2,_ = bounds(header)
            # Above the date text, inside the widget background; no text or checkbox pixels.
            row = frame[(y1-10)//2, x1//2:x2//2].astype(np.int16)
            green = (np.abs(row[:,0]-86)<20) & (np.abs(row[:,1]-89)<20) & (np.abs(row[:,2]-49)<20)
            positions = np.where(green)[0]
            edges.append(int(positions[-1]+x1//2) if len(positions) else x1//2)
        samples.append({'ms':video.get(cv2.CAP_PROP_POS_MSEC), 'edges':edges})
        if not saved and len(samples)>fps:
            cv2.imwrite(str(DEST / (path.stem + '-frame.png')), frame)
            saved = True
    video.release()
    return fps, samples

adb('shell', 'am', 'start', '--user', USER, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME')
tree = ui()
for direction in [(1250,220),(220,1250)]:
    for _ in range(4):
        if nodes(tree, 'todo_widget_date'):
            break
        adb('shell', 'input', 'swipe', str(direction[0]), '1600', str(direction[1]), '1600', '350')
        time.sleep(.25)
        tree = ui()
headers = nodes(tree, 'todo_widget_date')
assert len(headers) >= 2, 'Two visible widget instances required'
checkbox = next(n for n in nodes(tree, 'todo_row_check') if bounds(n)[3]-bounds(n)[1]>80)
baseline = counts(tree)
assert len(set(baseline)) == 1
adb('shell', 'am', 'kill', '--user', USER, 'com.yubin.formyself')
original_scale = adb('shell', 'settings', 'get', 'global', 'animator_duration_scale')
try:
    adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '1')
    path = record('v3-widget-animation', checkbox, .7)
    fps, samples = measure(path, headers)
    movement = []
    for instance in range(len(headers)):
        edges = [s['edges'][instance] for s in samples]
        low, high = min(edges), max(edges)
        assert high-low >= 8, 'Visible progress movement required'
        intermediate = set(e for e in edges if low+1<e<high-1)
        assert len(intermediate)>=3, 'Continuous intermediate launcher frames required'
        assert abs(edges[-1]-edges[0])<=2, 'Undo returns to original background'
        movement.append({'rangePixels':high-low, 'intermediatePositions':len(intermediate)})
    assert counts(ui()) == baseline
    second = next(n for n in nodes(tree, 'todo_row_check') if bounds(n)[3]-bounds(n)[1]>80 and bounds(n)!=bounds(checkbox))
    rapid_path = record('v3-widget-rapid-animation', checkbox, 0, second)
    _, rapid = measure(rapid_path, headers)
    assert counts(ui()) == baseline
    for instance in range(len(headers)):
        edges = [s['edges'][instance] for s in rapid]
        assert max(edges)-min(edges)>=8 and abs(edges[-1]-edges[0])<=2, 'Rapid toggles must settle to latest ratio'
    adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')
    reduced_path = record('v3-widget-reduced-motion', checkbox, .4)
    _, reduced = measure(reduced_path, headers)
    for instance in range(len(headers)):
        edges = [s['edges'][instance] for s in reduced]
        low, high = min(edges), max(edges)
        assert len(set(e for e in edges if low+2<e<high-2))<=1, 'Reduced-motion should update directly'
    assert counts(ui()) == baseline
    result = {'stage':'v3','fps':fps,'checks':['real launcher video contains continuous forward and reverse frames','both widget instances animate','undo restores original ratio','rapid desktop toggles settle to latest ratio','system animator scale zero disables transition'],'movement':movement,'samples':samples,'rapidSamples':rapid,'reducedSamples':reduced}
    Path('Test_data/todo-v3-widget-animation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'checks':result['checks'],'fps':fps,'movement':movement}))
finally:
    adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', original_scale if original_scale!='null' else '1')
