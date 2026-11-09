"""M2 environment probe only. Never a substitute for production Driver integration.
Requires a manifest for a newly created synthetic API34 AVD, no user applications.
Uses the system HTMLViewer with a fixed synthetic page; no network/model request.
"""
import argparse,json,subprocess,time,hashlib
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('manifest')
parser.add_argument('output',help='new directory under work/m2')
parser.add_argument('--observation-seconds',type=int,default=180)
args=parser.parse_args()
if not 30<=args.observation_seconds<=600:raise SystemExit('PROBE_DURATION_DENIED')
manifest=Path(args.manifest).resolve();m=json.loads(manifest.read_text())
work=Path('work/m2').resolve();out=Path(args.output).resolve()
if not manifest.is_relative_to(work) or not out.is_relative_to(work):raise SystemExit('PROBE_PATH_DENIED')
if m.get('syntheticOnly') is not True or m.get('serial')!='emulator-5582' or m.get('avdName')!='kanata_m2_api34':raise SystemExit('PROBE_IDENTITY_DENIED')
if not Path(m['root']).name.startswith('kanata-m2-synthetic-'):raise SystemExit('PROBE_ROOT_DENIED')
adb=str(Path(m['sdk'])/'platform-tools/adb');serial=m['serial']
def call(*a,check=True):
 r=subprocess.run([adb,'-s',serial,*a],capture_output=True,text=True,timeout=45)
 if check and r.returncode:raise RuntimeError('PROBE_ADB_FAILED:'+str(r.returncode))
 return r
if call('emu','avd','name').stdout.splitlines()[0]!=m['avdName']:raise SystemExit('PROBE_AVD_DENIED')
if call('shell','getprop','sys.boot_completed').stdout.strip()!='1':raise SystemExit('PROBE_NOT_BOOTED')
if call('shell','getprop','ro.build.version.sdk').stdout.strip()!='34':raise SystemExit('PROBE_API_DENIED')
if call('shell','pm','list','packages','-3').stdout.strip():raise SystemExit('PROBE_USER_APPS_PRESENT')
out.mkdir(parents=True,exist_ok=False)
(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
for name,cmd in [('device-properties.txt',('shell','getprop')),('webview.txt',('shell','dumpsys','webviewupdate')),('selinux.txt',('shell','getenforce'))]:
 (out/name).write_text(call(*cmd).stdout)
# The manifest and empty user-app check establish isolation before clearing this
# freshly created emulator's log buffer. No real/user device is discoverable here.
call('logcat','-c')
uri='data:text/html,%3Chtml%3E%3Cbody%3EKANATA_M2_SYNTHETIC_WEBVIEW_CONTROL%3Cscript%3Edocument.title%3D%22M2_JS_OK%22%3C/script%3E%3C/body%3E%3C/html%3E'
command='am start -W -n com.android.htmlviewer/.HTMLViewerActivity -a android.intent.action.VIEW -d '+uri+' -t text/html'
started=call('shell',command,check=False)
(out/'launch.txt').write_text(started.stdout+started.stderr)
observations=[]
start=time.monotonic()
while True:
 r=call('shell','pidof','com.android.htmlviewer',check=False)
 observations.append({'elapsedSeconds':round(time.monotonic()-start,3),'exitCode':r.returncode,'pid':r.stdout.strip()})
 if time.monotonic()-start>=args.observation_seconds:break
 time.sleep(5)
log=call('logcat','-d','-v','threadtime').stdout
(out/'logcat.txt').write_text(log)
(out/'observations.json').write_text(json.dumps(observations,indent=2)+'\n')
crashes=[line for line in log.splitlines() if any(s in line for s in ['Fatal signal','SIGTRAP','CrRendererMain','libwebviewchromium.so','chromium: [ERROR','chromium: [FATAL','RenderProcessGone','onRenderProcessGone','Renderer process (','Render process ('])]
(out/'crash-extract.txt').write_text('\n'.join(crashes)+'\n')
renderer_failure=any('Fatal signal' in s and 'CrRendererMain' in s for s in crashes) or (any('Renderer process (' in s and 'crash detected (code' in s for s in crashes) and 'libwebviewchromium.so' in log)
result={'status':'BLOCKED_WEBVIEW_CONTROL_CRASH' if renderer_failure else 'PROBE_OBSERVED_REQUIRES_JS_VERIFICATION',
 'scope':'system HTMLViewer only; no SQLCipher/Capacitor/Repository executed',
 'serial':serial,'avd':m['avdName'],'api':34,'syntheticOnly':True,'userApps':0,'launchExitCode':started.returncode,
 'observations':observations,'crashLines':len(crashes),'modelRequests':0,'networkRequestsFromPage':0,
 'htmlViewerApk':call('shell','pm','path','com.android.htmlviewer').stdout.strip(),
 'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
raise SystemExit(2 if result['status'].startswith('BLOCKED') else 0)
