import { writeFile } from 'node:fs/promises'
import { connect,pause,store,uiSet,uiClick } from './cdp.mjs'
const c=await connect(),results=[]
try {
  await c.evaluate(`${store('settings')}.switchView('reports')`);await pause(500)
  await c.evaluate(`(()=>{window.__qaFetch=window.fetch;window.__qaAiSaved={key:${store('settings')}.aiApiKey,url:${store('settings')}.aiProviderUrl};${store('settings')}.aiApiKey=crypto.randomUUID();${store('settings')}.aiProviderUrl='https://qa.invalid';window.fetch=()=>new Promise(resolve=>window.__qaReply=resolve)})()`)
  await c.evaluate(`document.querySelector('.report-view .button-primary').click()`)
  await c.until('Boolean(window.__qaReply)')
  const requested=await c.evaluate(`document.querySelector('.month-switcher strong').textContent`)
  await c.evaluate(uiClick('.month-nav'))
  await c.evaluate(`window.__qaReply(new Response(JSON.stringify({choices:[{message:{content:'QA OLD MONTH SUMMARY'}}]}),{headers:{'Content-Type':'application/json'}}))`);await pause(300)
  results.push({name:'monthly-summary-race',requestedMonth:requested,displayedMonth:await c.evaluate(`document.querySelector('.month-switcher strong').textContent`),oldSummaryDisplayed:await c.evaluate(`document.body.innerText.includes('QA OLD MONTH SUMMARY')`)})
  await c.evaluate(`window.fetch=window.__qaFetch;${store('settings')}.aiApiKey=window.__qaAiSaved.key;${store('settings')}.aiProviderUrl=window.__qaAiSaved.url;delete window.__qaAiSaved;delete window.__qaReply`)

  await c.evaluate(`${store('settings')}.switchView('weight');window.__qaWeightBefore=JSON.parse(JSON.stringify(${store('weight')}.weightRecords))`);await pause(400)
  await c.evaluate(uiClick('.weight-hero button'));await c.evaluate(uiSet('.modal-panel input[type=number]',62.5))
  await c.evaluate(`(()=>{window.__qaSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith('my_weight_records_data'))throw new Error('QA_QUOTA_WRITE_FAILURE');return window.__qaSet.call(this,k,v)}})()`)
  await c.evaluate(uiClick('.modal-panel .button-primary'));await pause(300)
  results.push(await c.evaluate(`({name:'weight-write-failure-ui',modalStillOpen:Boolean(document.querySelector('.modal-panel')),feedbackError:Boolean(document.querySelector('.feedback-card')),inMemoryCount:${store('weight')}.weightRecords.length})`))
  await c.evaluate(`Storage.prototype.setItem=window.__qaSet;${store('weight')}.updateWeightRecords(window.__qaWeightBefore);delete window.__qaWeightBefore`);await pause(300)

  await c.evaluate(`window.__qaDebtBefore=JSON.parse(JSON.stringify(${store('debt')}.savedDebts))`)
  for(const count of [100,500]) {
    await c.evaluate(`${store('settings')}.switchView('debts')`);await pause(350)
    const measurement=await c.evaluate(`(async()=>{const start=performance.now();${store('debt')}.updateDebts(Array.from({length:${count}},(_,i)=>({id:'qa-stress-'+i,name:'QA 合成目标 '+i,totalAmount:1000,remainingAmount:800,startDate:'2026-10-03',records:[{id:'qa-r'+i,date:'2026-10-03',amount:200}],isCleared:false,group:'未分组'})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {name:'savings-stress',count:${count},renderMs:Math.round(performance.now()-start),cards:document.querySelectorAll('.savings-card').length,nodes:document.querySelectorAll('*').length,overflow:document.querySelector('.app-wrapper').scrollWidth>innerWidth}})()`)
    results.push(measurement)
  }
  await c.evaluate(`${store('debt')}.updateDebts(window.__qaDebtBefore);delete window.__qaDebtBefore`);await pause(400)
  const originalTheme=await c.evaluate(`JSON.stringify(${store('settings')}.themeSettings)`)
  for(const preset of ['cloud','peach','mint','lavender']) {
    await c.evaluate(`${store('settings')}.updateThemeSettings({mode:'preset',presetId:'${preset}'})`);await pause(220)
    results.push(await c.evaluate(`({name:'theme',preset:'${preset}',primary:getComputedStyle(document.documentElement).getPropertyValue('--primary')})`))
  }
  await c.evaluate(`${store('settings')}.updateThemeSettings(JSON.parse(${JSON.stringify(originalTheme)}))`)
  await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await c.evaluate(`${store('settings')}.switchView('todo')`);await pause(350)
  results.push(await c.evaluate(`({name:'reduced-motion',matches:matchMedia('(prefers-reduced-motion:reduce)').matches,todoFillTransition:getComputedStyle(document.querySelector('.todo-fill')).transitionDuration})`))
  await c.send('Emulation.setEmulatedMedia',{features:[]})
} catch(error){results.push({name:'harness-failure',error:error.stack});process.exitCode=1}
finally{await writeFile(new URL('browser-extra.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));c.close()}
