import { writeFile } from 'node:fs/promises'
import { connect, pause, store, uiSet, uiClick } from './cdp.mjs'
const c = await connect(), results = []
try {
  await c.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'})
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await c.send('Page.navigate',{url:'http://127.0.0.1:5178/'})
  await c.until(`Boolean(${store('auth')}?.isDataLoaded)`)
  await pause(600)
  results.push({phase:'initial',text:await c.evaluate('document.body.innerText')})
  await c.screenshot('initial-lock.png')
  // No private data or credentials: generate a disposable synthetic password in memory only.
  const synthetic = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}`
  await c.evaluate(uiSet('.lock-screen input',synthetic))
  await c.evaluate(uiClick('.lock-screen .lock-btn'))
  await c.until(`Boolean(${store('todo')}?.isDataLoaded && ${store('weight')}?.isDataLoaded && !${store('auth')}.isLocked)`)
  await pause(1800)
  results.push({phase:'first-entry',text:await c.evaluate('document.body.innerText')})
  for (const width of [320,390,768,1440]) {
    await c.send('Emulation.setDeviceMetricsOverride',{width,height:width>700?900:844,deviceScaleFactor:1,mobile:width<700})
    for (const view of ['home','debts','weight','mood','todo','schedule','passwords','reports','chat','settings']) {
      await c.evaluate(`${store('settings')}.switchView('${view}')`)
      await pause(400)
      results.push(await c.evaluate(`(()=>{
        const root=document.querySelector('.app-wrapper'),visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
        const small=[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>({text:(e.getAttribute('aria-label')||e.textContent).trim().slice(0,60),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)})).filter(e=>e.w<24||e.h<24);
        const unnamed=[...document.querySelectorAll('button')].filter(visible).filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.title).map(e=>e.className);
        const inputs=[...document.querySelectorAll('input,textarea,select')].filter(visible).map(e=>({type:e.type,label:e.getAttribute('aria-label')||e.labels?.[0]?.textContent||null,placeholder:e.placeholder}));
        return {phase:'layout',width:${width},view:'${view}',overflow:root.scrollWidth>root.clientWidth+1,rootWidth:root.clientWidth,scrollWidth:root.scrollWidth,small,unnamed,inputs,text:document.body.innerText.slice(0,2600)}
      })()`))
      if (width===390 || (width===1440 && ['home','settings','chat'].includes(view))) await c.screenshot(`${width}-${view}.png`)
    }
  }
} catch(error) { results.push({phase:'failure',error:error.stack}); process.exitCode=1 }
finally {
  results.push({phase:'errors',events:c.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded').map(e=>({method:e.method,params:e.params}))})
  await writeFile(new URL('browser-baseline.json',import.meta.url),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results.filter(r=>r.phase==='failure'||r.phase==='errors'||r.overflow||r.unnamed?.length),null,2))
  c.close()
}
