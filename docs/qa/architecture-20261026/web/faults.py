"""Actual Preferences browser driver failures, observed and retried through the product UI."""
import json
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT=Path(__file__).resolve().parent
STORE="document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
KEY='CapacitorStorage.my_weight_records_data'
results={'page_errors':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Shanghai')
    context.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4173/') else r.abort())
    page=context.new_page()
    page.on('pageerror',lambda e:results['page_errors'].append(str(e)))
    def unlock():
        page.locator('.lock-input-shell input').fill('Synthetic-P6-fault-only')
        page.locator('.lock-btn').click()
    def view():
        page.evaluate('() => '+STORE+".get('settings').switchView('weight')")
    def add(value):
        page.get_by_role('button',name='＋ 记录体重',exact=True).click()
        page.get_by_role('spinbutton',name='体重 kg',exact=True).fill(value)
        page.get_by_role('button',name='保存',exact=True).click()
    page.goto('http://127.0.0.1:4173'); unlock()
    page.wait_for_function('() => '+STORE+".get('weight')?.isDataLoaded")
    view(); add('65.1')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)||"[]").length===1',arg=KEY)
    page.evaluate('(key)=>{window.__qaSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error("Synthetic write failure");return window.__qaSet.call(this,k,v)}}',KEY)
    add('65.2')
    page.get_by_role('button',name='重试保存',exact=True).wait_for()
    assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).length===1',KEY)
    assert page.evaluate('() => '+STORE+".get('weight').weightRecords.length===2")
    page.screenshot(path=str(OUT/'390-save-error.png'),full_page=True)
    page.evaluate('() => { Storage.prototype.setItem=window.__qaSet; return true }')
    page.get_by_role('button',name='重试保存',exact=True).click()
    page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)).length===2',arg=KEY)
    results['write_failure_preserves_disk_and_retries_ui']=True
    before=page.evaluate('(key)=>localStorage.getItem(key)',KEY)
    context.add_init_script("""window.__qaGet=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k==='CapacitorStorage.my_weight_records_data'&&sessionStorage.getItem('qa-read-fault')==='1')throw Error('Synthetic read failure');return window.__qaGet.call(this,k)}""")
    page.evaluate("sessionStorage.setItem('qa-read-fault','1')")
    page.reload(); unlock()
    page.get_by_role('button',name='重试读取',exact=True).wait_for()
    assert page.evaluate('(key)=>window.__qaGet.call(localStorage,key)',KEY)==before
    assert not page.evaluate('() => '+STORE+".get('weight').isDataLoaded")
    page.evaluate("sessionStorage.setItem('qa-read-fault','0')")
    page.get_by_role('button',name='重试读取',exact=True).click()
    page.wait_for_function('() => '+STORE+".get('weight').isDataLoaded && "+STORE+".get('weight').weightRecords.length===2")
    results['read_failure_preserves_disk_and_retries_ui']=True
    assert not results['page_errors'],results['page_errors']
    results['browser']=browser.version
    results['executed_at']=datetime.now(timezone.utc).isoformat()
    browser.close()
(OUT/'faults-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False))
