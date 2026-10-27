"""Actual reduced-motion home layout and hit-testing; no injected styling."""
import hashlib,json,os
from datetime import datetime,timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT=Path(__file__).resolve().parent
URL=os.environ.get('FORMYSELF_QA_URL','http://127.0.0.1:4173')
STORE="document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
results={'page_errors':[],'widths':{}}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',timezone_id='Asia/Shanghai')
        context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(URL+'/') else route.abort())
        page=context.new_page();page.on('pageerror',lambda e:results['page_errors'].append(str(e)))
        page.goto(URL);page.locator('.lock-screen input').fill('Synthetic-P6-reduced-motion');page.locator('.lock-btn').click()
        page.wait_for_selector('.main-app',state='visible');page.wait_for_selector('.home-dashboard')
        for width in [320,390,480,1280]:
            page.set_viewport_size({'width':width,'height':844})
            page.wait_for_timeout(100)
            layout=page.locator('.home-dashboard').evaluate("element=>Array.from(element.children).filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,position:s.position,pointerEvents:s.pointerEvents}})")
            valid=len(layout)>=4 and all(r['height']>0 and r['left']>=-1 and r['right']<=width+1 and r['position']!='absolute' and r['pointerEvents']!='none' for r in layout)
            valid=valid and all(layout[i]['top']>=layout[i-1]['bottom']-1 for i in range(1,len(layout)))
            results['widths'][str(width)]={'valid':valid,'panels':layout}
            page.screenshot(path=str(OUT/f'reduced-motion-{width}.png'))
            assert valid, f'Home panels outside normal flow at {width}: {layout}'
        page.set_viewport_size({'width':390,'height':844})
        page.locator('.today-action').first.click()
        page.wait_for_function('() => '+STORE+".get('settings').currentView==='mood'",timeout=10000)
        results['actual_home_action_click']=True
        results['browser']=browser.version
        browser.close()
    assert not results['page_errors'],results
    results['passed']=True
except Exception as error:
    results['passed']=False;results['error']=str(error)
finally:
    results['script_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    results['executed_at']=datetime.now(timezone.utc).isoformat()
    destination=OUT/os.environ.get('FORMYSELF_QA_RESULT','reduced-motion-results.json')
    destination.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in results.items() if k!='widths'},ensure_ascii=False))
if not results['passed']:raise SystemExit(1)
