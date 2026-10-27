"""Isolated production-build UI and real restore-coordinator verification; synthetic data only."""
import json, os, time, re, hashlib, subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / 'with-vault'
OUT.mkdir(exist_ok=True)
URL = os.environ.get('FORMYSELF_QA_URL', 'http://127.0.0.1:4173')
PASSWORD = 'Synthetic-P6-browser-only'
results = {}
STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"

def evaluate(page, body):
    return page.evaluate('async () => { const stores = ' + STORE + '; ' + body + ' }')

def unlock(page, first=False):
    page.locator('.lock-input-shell input').fill(PASSWORD)
    page.locator('.lock-btn').click()
    page.wait_for_function("document.querySelector('.main-app') && document.querySelector('.main-app').getBoundingClientRect().height > 0", timeout=45000)
    page.wait_for_function('() => { const s = ' + STORE + "; return ['weight','debt','mood','schedule','todo'].every(k => s.get(k)?.isDataLoaded) }", timeout=45000)

def runtime(page):
    path = next((ROOT / 'dist' / 'assets').glob('fullBackupRuntime-*.js')).name
    return evaluate(page, f"const mod = await import('/assets/{path}'); window.__qaRuntime = Object.values(mod).find(x => typeof x === 'function')(); return true;")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={ 'width': 390, 'height': 844 }, device_scale_factor=1, timezone_id='Asia/Shanghai')
    def route_request(route):
        if route.request.url.startswith(URL + '/'):
            route.continue_()
        elif route.request.url.startswith('https://synthetic.invalid/'):
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':'合成回复：今天的记录已经收到，测试完成。'}}]}))
        else:
            route.abort()
    context.route('**/*', route_request)
    page = context.new_page()
    page.goto(URL)
    unlock(page, True)
    results['initialization'] = True
    evaluate(page, """
      await stores.get('debt').restoreDebts([{id:'qa-saving',name:'合成省钱目标',totalAmount:100,records:[{amount:20}],startDate:'2026-10-26'}], ['未分组']);
      await stores.get('weight').restoreWeightRecords([{id:'qa-original',date:'2026-10-26',time:'09:00',weight:65,note:'合成体重'}]);
      stores.get('mood').addRecord('2026-10-26','good','合成心情'); await stores.get('mood').flush();
      await stores.get('todo').add({title:'合成待办',startDate:'2026-10-26',recurrence:{type:'daily'}});
      stores.get('schedule').addSeries({title:'合成日程',startDate:'2026-10-26',startTime:'18:00'}); await stores.get('schedule').flush();
    """)
    for view in ['home','debts','weight','mood','todo','schedule','settings']:
        evaluate(page, f"stores.get('settings').switchView('{view}'); return true;")
        page.wait_for_timeout(250)
        results[view + '_rendered'] = page.locator('.content-area').inner_text().strip() != ''
    evaluate(page, "stores.get('settings').switchView('home'); return true;")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / '390-home.png'), full_page=True)
    results['responsive'] = {}
    for width in [320,390,1280]:
        page.set_viewport_size({'width':width,'height':844})
        page.wait_for_timeout(150)
        results['responsive'][str(width)] = page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / f'{width}-home.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    evaluate(page, """const s=stores.get('settings'); s.aiProviderUrl='https://synthetic.invalid'; s.aiApiKey='synthetic-key-only'; s.aiModel='synthetic'; await s.saveAiSettings(); s.switchView('chat');""")
    page.wait_for_selector('.chat-composer textarea', timeout=45000)
    page.locator('.chat-composer textarea').fill('这是一条合成测试消息')
    page.get_by_role('button', name='发送消息', exact=True).click()
    page.wait_for_function('() => { const s = ' + STORE + "; const user=s.get('chat').messages.findLast(m=>m.role==='user' && m.content==='这是一条合成测试消息'); return user && s.get('chat').messages.some(m => m.role === 'assistant' && m.createdAt > user.createdAt && m.status === 'complete' && m.content.includes('合成回复')) }", timeout=45000)
    results['chat_send_reply'] = True
    page.screenshot(path=str(OUT / '390-chat.png'), full_page=True)
    evaluate(page, """await stores.get('protectedAccess').ensureModules();
      stores.get('passwordVault').addRecord({appName:'合成完整恢复密码记录',username:'synthetic-vault-user',password:'Synthetic-vault-content-only',category:'QA'});
      await stores.get('passwordVault').flush();""")
    for view in ['passwords','settings']:
        evaluate(page, f"stores.get('settings').switchView('{view}'); return true;")
        page.wait_for_timeout(300)
        results[view + '_protected_or_rendered'] = page.locator('.content-area').inner_text().strip() != ''
    evaluate(page, "stores.get('settings').settingsSection='ai'; return true;")
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / '390-ai-settings.png'), full_page=True)
    results['ai_settings_visible'] = 'API' in page.locator('.content-area').inner_text()
    evaluate(page, "stores.get('settings').settingsSection='data'; return true;")
    with page.expect_download() as download_info:
        page.get_by_role('button', name=re.compile('^导出完整')).click()
    exported = OUT / 'synthetic-export.enc.json'
    download_info.value.save_as(str(exported))
    node_check = """import CryptoJS from 'crypto-js';
      let input=''; for await (const chunk of process.stdin) input+=chunk;
      const snapshot=JSON.parse(CryptoJS.AES.decrypt(input,process.argv[1]).toString(CryptoJS.enc.Utf8));
      if(snapshot.type!=='formyself-full-backup'||snapshot.data.weight[0].id!=='qa-original') throw Error('wrong export');
      console.log('true');"""
    checked = subprocess.run(['node','--input-type=module','-e',node_check,PASSWORD], input=exported.read_text(), text=True, cwd=ROOT, capture_output=True, check=True)
    decoded = checked.stdout.strip() == 'true'
    assert decoded
    evaluate(page, "await stores.get('weight').restoreWeightRecords([{id:'qa-mutated',date:'2026-10-26',weight:70}]);")
    page.locator('input[type=file][accept=".json"]').set_input_files(str(exported))
    page.get_by_role('button',name='覆盖并恢复',exact=True).click()
    page.wait_for_function('() => '+STORE+".get('weight').weightRecords[0]?.id==='qa-original'",timeout=45000)
    page.wait_for_timeout(300)
    results['encrypted_backup_download_decrypt_import'] = True
    runtime(page)
    evaluate(page, """await stores.get('protectedAccess').ensureModules(); window.__qaBefore=window.__qaRuntime.createFullBackupSnapshot();
      const target=JSON.parse(JSON.stringify(window.__qaBefore)); target.data.weight=[{id:'qa-target',date:'2026-10-26',weight:60}];
      const participant=window.__qaRuntime.registry.get('weight'), original=participant.restore;
      participant.restore=async part=>{await original(part); window.__qaPartial=true; await new Promise(()=>{});};
      void window.__qaRuntime.restore(target,'Synthetic-P6-browser-only'); return true;""")
    page.wait_for_function('window.__qaPartial === true', timeout=45000)
    page.reload(); page.wait_for_selector('.lock-input-shell input', timeout=45000); unlock(page)
    page.wait_for_function('() => ' + STORE + ".get('weight').weightRecords[0]?.id === 'qa-original'", timeout=45000)
    page.wait_for_timeout(300)
    results['uncommitted_reload_rollback'] = True
    runtime(page)
    evaluate(page, """
      const entry=await import(document.querySelector('script[type=module]').src);
      const journal=Object.values(entry).find(x=>x && Object.hasOwn(x,'inspect') && Object.hasOwn(x,'commit') && Object.hasOwn(x,'prepare'));
      if(!journal) throw Error('journal export not found');
      const before=window.__qaRuntime.createFullBackupSnapshot(); before.data.weight=[{id:'qa-committed',date:'2026-10-26',weight:61}];
      journal.clear=async()=>{throw Error('Synthetic journal cleanup failure')};
      try{await window.__qaRuntime.restore(before,'Synthetic-P6-browser-only')}catch(error){window.__qaRestoreError=String(error)}
      if(!(await journal.inspect()).committed) throw Error('expected committed marker: '+window.__qaRestoreError);
      return true;
    """)
    page.reload(); page.wait_for_selector('.lock-input-shell input', timeout=45000); unlock(page)
    page.wait_for_function('() => ' + STORE + ".get('weight').weightRecords[0]?.id === 'qa-committed'", timeout=45000)
    results['committed_reload_retains_target'] = True
    page.wait_for_function('() => '+STORE+".get('passwordVault')?.records.some(r=>r.appName==='合成完整恢复密码记录'&&r.password==='Synthetic-vault-content-only')",timeout=45000)
    results['populated_vault_preserved_after_both_recoveries']=True
    results['performance_marks'] = page.evaluate("performance.getEntriesByType('measure').map(x=>({name:x.name,duration:x.duration}))")
    results['browser'] = browser.version
    results['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    results['executed_at'] = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=8))).isoformat()
    browser.close()

assert all(value for key,value in results.items() if isinstance(value,bool)), results
assert all(results['responsive'].values()), results
(OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(results, ensure_ascii=False))
