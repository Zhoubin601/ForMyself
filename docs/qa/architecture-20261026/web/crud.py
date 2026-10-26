"""Actual production UI CRUD in a fresh browser profile; synthetic records only."""
import json, os, re, subprocess
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent
URL = os.environ.get('FORMYSELF_QA_URL', 'http://127.0.0.1:4173')
STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
results = {'page_errors': []}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width':390,'height':844}, timezone_id='Asia/Shanghai')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(URL+'/') else route.abort())
    page = context.new_page()
    page.on('pageerror',lambda error: results['page_errors'].append(str(error)))
    page.goto(URL)
    page.locator('.lock-input-shell input').fill('Synthetic-P6-crud-only')
    page.locator('.lock-btn').click()
    page.wait_for_function('() => '+STORE+".get('weight')?.isDataLoaded")
    def view(name):
        page.evaluate('(name) => '+STORE+".get('settings').switchView(name)",name)
    def confirm():
        page.get_by_role('button',name='确认删除',exact=True).click()

    view('weight')
    page.get_by_role('button',name='＋ 记录体重',exact=True).click()
    page.get_by_role('spinbutton',name='体重 kg',exact=True).fill('66.1')
    page.get_by_role('button',name='保存',exact=True).click()
    page.locator('.weight-num').filter(has_text='66.1').wait_for()
    page.get_by_role('button',name='编辑',exact=True).click()
    page.get_by_role('spinbutton',name='体重 kg',exact=True).fill('66.2')
    page.get_by_role('button',name='保存',exact=True).click()
    page.locator('.weight-num').filter(has_text='66.2').wait_for()
    page.get_by_role('button',name='删除体重记录',exact=True).click(); confirm()
    page.wait_for_function('() => '+STORE+".get('weight').weightRecords.length===0")
    results['weight_ui_create_edit_delete'] = True

    view('debts')
    page.get_by_role('button',name='＋ 新建计划',exact=True).click()
    page.get_by_placeholder('例如：换新电脑',exact=True).fill('合成 UI 计划')
    page.locator('.apple-modal-card input[type=number]').fill('100')
    page.get_by_role('button',name='确立计划',exact=True).click()
    page.get_by_role('button',name='合成 UI 计划的更多操作',exact=True).click()
    page.get_by_role('button',name='编辑计划',exact=True).click()
    page.locator('.apple-modal-card input').first.fill('合成 UI 已编辑')
    page.get_by_role('button',name='保存修改',exact=True).click()
    page.get_by_role('button',name='合成 UI 已编辑的更多操作',exact=True).click()
    page.get_by_role('button',name='删除计划',exact=True).click(); confirm()
    page.get_by_role('button',name='合成 UI 已编辑的更多操作',exact=True).wait_for(state='hidden')
    results['savings_ui_create_edit_delete'] = True

    view('mood')
    page.locator('.mood-add-btn').click()
    page.get_by_placeholder('发生了什么？记录这一刻的感受...',exact=True).fill('合成 UI 心情')
    page.get_by_role('button',name='保存',exact=True).click()
    page.locator('.mood-day-panel').get_by_role('button',name='编辑',exact=True).click()
    page.get_by_placeholder('发生了什么？记录这一刻的感受...',exact=True).fill('合成 UI 心情已编辑')
    page.get_by_role('button',name='保存',exact=True).click()
    page.locator('.mood-day-panel').get_by_role('button',name='删除',exact=True).click(); confirm()
    page.get_by_role('button',name='关闭当天日记',exact=True).click()
    page.locator('.mood-card').filter(has_text='合成 UI 心情已编辑').wait_for(state='hidden')
    results['mood_ui_create_edit_delete'] = True

    view('schedule')
    page.get_by_role('button',name='新建日程',exact=True).click()
    page.get_by_placeholder('日程标题',exact=True).fill('合成 UI 日程')
    page.locator('.editor-header').get_by_role('button',name='完成',exact=True).click()
    page.locator('.item-copy strong').filter(has_text='合成 UI 日程').click()
    page.get_by_placeholder('日程标题',exact=True).fill('合成 UI 日程已编辑')
    page.locator('.editor-header').get_by_role('button',name='完成',exact=True).click()
    page.locator('.item-copy strong').filter(has_text='合成 UI 日程已编辑').click()
    page.get_by_role('button',name='删除日程',exact=True).click(); confirm()
    page.locator('.item-copy strong').filter(has_text='合成 UI 日程已编辑').wait_for(state='hidden')
    results['schedule_ui_create_edit_delete'] = True
    view('weight')
    page.get_by_role('button',name='＋ 记录体重',exact=True).click()
    page.get_by_role('spinbutton',name='体重 kg',exact=True).fill('66.3')
    page.get_by_role('button',name='保存',exact=True).click()
    page.locator('.weight-num').filter(has_text='66.3').wait_for()
    page.evaluate('() => '+STORE+".get('settings').openGeneralSettingsSection('data')")
    page.locator('.backup-type-button').click()
    page.locator('.settings-picker').get_by_role('button',name=re.compile('体重')).click()
    with page.expect_download() as download:
        page.get_by_role('button',name=re.compile('^导出体重')).click()
    exported = OUT/'single-weight.enc.json'
    download.value.save_as(str(exported))
    check = """import C from 'crypto-js';let s='';for await(const b of process.stdin)s+=b;
    const data=JSON.parse(C.AES.decrypt(s,'Synthetic-P6-crud-only').toString(C.enc.Utf8));
    if(!Array.isArray(data)||data.length!==1||data[0].weight!==66.3)throw Error('Wrong single backup');"""
    subprocess.run(['node','--input-type=module','-e',check],input=exported.read_text(),text=True,cwd=OUT.parents[3],check=True)
    view('weight')
    page.get_by_role('button',name='编辑',exact=True).click()
    page.get_by_role('spinbutton',name='体重 kg',exact=True).fill('67')
    page.get_by_role('button',name='保存',exact=True).click()
    page.evaluate('() => '+STORE+".get('settings').openGeneralSettingsSection('data')")
    page.locator('.backup-type-button').click()
    page.locator('.settings-picker').get_by_role('button',name=re.compile('体重')).click()
    page.locator('input[type=file][accept=".json"]').set_input_files(str(exported))
    page.get_by_role('button',name='覆盖当前数据',exact=True).click()
    page.wait_for_function('() => '+STORE+".get('weight').weightRecords[0]?.weight===66.3")
    results['single_weight_download_decrypt_import'] = True
    assert not results['page_errors'], results['page_errors']
    results['browser'] = browser.version
    results['executed_at'] = datetime.now(timezone.utc).isoformat()
    browser.close()
(OUT/'crud-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False))
