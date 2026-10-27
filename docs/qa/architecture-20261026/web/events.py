"""Production controller integration through the actual Capacitor Web App event adapter.
Synthetic App events exercise route and privacy callbacks; this is not Android intent evidence.
"""
import hashlib, json, os
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT=Path(__file__).resolve().parent
URL=os.environ.get('FORMYSELF_QA_URL','http://127.0.0.1:4173')
STORE="document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
results={'page_errors':[],'scope':'Actual production controller + Capacitor AppWeb instance; synthetic platform events, not native Android evidence'}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda e: results['page_errors'].append(str(e)))
    page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(URL+'/') else route.abort())
    page.goto(URL)
    page.locator('.lock-screen input').fill('Synthetic-P6-web-events')
    page.locator('.lock-btn').click()
    page.wait_for_function('() => '+STORE+".get('settings')?.isDataLoaded&&!"+STORE+".get('auth').isLocked&&Boolean("+STORE+".get('auth').savedMasterPwd)")
    page.evaluate('async()=>{await '+STORE+".get('protectedAccess').ensureModules()}")
    page.wait_for_function('() => Object.values('+STORE+".get('protectedAccess').status).every(x=>x==='ready')")
    revision=page.evaluate('() => '+STORE+".get('auth').sessionRevision")
    results['authenticated_sensitive_modules_loaded_before_background']=True
    page.evaluate("async()=>{await window.Capacitor.Plugins.App.notifyListeners('appUrlOpen',{url:'formyself://open/todo?item=synthetic-event&date=2026-10-26'})}")
    page.wait_for_function('() => '+STORE+".get('settings').currentView==='todo'&&"+STORE+".get('settings').todoTarget.item==='synthetic-event'",timeout=10000)
    results['app_url_event_routes_actual_controller']=True
    page.evaluate('() => {const s='+STORE+";s.get('settings').requireAppUnlock=false;s.get('settings').autoLockDelaySeconds=0;}")
    page.evaluate("async()=>{await window.Capacitor.Plugins.App.notifyListeners('appStateChange',{isActive:false})}")
    page.wait_for_function('() => !'+STORE+".get('auth').savedMasterPwd&&"+STORE+".get('auth').sessionRevision>"+str(revision)+"&&Object.values("+STORE+".get('protectedAccess').status).every(x=>x==='idle')",timeout=10000)
    results['same_web_adapter_delivers_privacy_event']=True
    results['browser']=browser.version
    results['script_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    results['executed_at']=datetime.now(timezone.utc).isoformat()
    browser.close()
assert not results['page_errors'], results
(OUT/'events-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False))
