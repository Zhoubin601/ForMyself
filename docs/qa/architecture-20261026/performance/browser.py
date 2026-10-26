"""Alternate baseline/current builds in isolated Chromium contexts on the same host."""
import json, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT = Path(__file__).resolve().parent
STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
password = 'Synthetic-P6-performance-only'
samples = { 'before': [], 'after': [] }
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    for run in range(4):
        for label,port in [('before',4174),('after',4173)]:
            context=browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Shanghai')
            page=context.new_page()
            page.goto(f'http://127.0.0.1:{port}',wait_until='domcontentloaded')
            page.wait_for_selector('.lock-screen input')
            boot=page.evaluate("performance.getEntriesByName('app:boot-to-lock-ready')[0]?.duration ?? performance.now()")
            page.locator('.lock-screen input').fill(password); page.locator('.lock-btn').click()
            page.wait_for_function('() => '+STORE+".get('weight')?.isDataLoaded",timeout=45000)
            measurements=page.evaluate('''async () => {
                const stores = '''+STORE+''', weight=stores.get('weight'), result={};
                for(const size of [100,10000]) {
                    const records=Array.from({length:size},(_,i)=>({id:'synthetic-'+i,date:'2026-10-26',weight:60+i%20,note:'Synthetic performance'}));
                    const batches=size===100?10:1;
                    const datasets=Array.from({length:batches},(_,batch)=>records.map(record=>({...record,id:record.id+'-'+batch})));
                    const start=performance.now();
                    for(const dataset of datasets){await weight.restoreWeightRecords(dataset);await weight.flush();}
                    result['save_'+size]=(performance.now()-start)/batches;
                    const loops=size===100?100:5, encode=performance.now(); let json='';
                    for(let i=0;i<loops;i++){json=JSON.stringify(weight.weightRecords);JSON.parse(json);}
                    result['encode_decode_'+size]=(performance.now()-encode)/loops;
                    result['bytes_'+size]=json.length;
                }
                return result;
            }''')
            if run: samples[label].append({'boot_to_lock':boot,**measurements})
            context.close()
    version=browser.version; browser.close()
keys=['boot_to_lock','save_100','save_10000','encode_decode_100','encode_decode_10000']
median={label:{key:statistics.median(sample[key] for sample in values) for key in keys} for label,values in samples.items()}
ratios={key:median['after'][key]/median['before'][key] if median['before'][key]>0 else None for key in keys}
report={'browser':version,'baseline_commit':'ff4e0bc','current':'P5 + P6 QA changes', 'warmup_runs':1,'measured_runs':3,'small_save_batches':10,'codec_batches':{'100':100,'10000':5},
        'scope':'Actual browser app boot-to-lock and weight Preferences saves; synthetic data, fresh contexts, baseline/current alternating. Not a native-device performance comparison.',
        'samples':samples,'median_ms':median,'ratios':ratios,'investigate_over_20_percent':[key for key,ratio in ratios.items() if ratio and ratio>1.2]}
(OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
