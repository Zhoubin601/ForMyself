import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'

const root=process.cwd(), qa=path.join(root,'docs/qa/ui-review-20261007')
fs.mkdirSync(qa,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])
const baseline=Object.fromEntries([...files(path.join(root,'raw')),...files(path.join(root,'src'))].map(f=>[path.relative(root,f),digest(f)]))
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'formyself-ui-review-'))
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','about:blank'],{windowsHide:true,stdio:'ignore'})
let socket,send
const results={date:'2026-10-07',data:'Synthetic records only; isolated browser profile',layouts:[],errors:[]}
try {
  const portFile=path.join(profile,'DevToolsActivePort')
  for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100)
  const port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0])
  const targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let sequence=0
  const pending=new Map()
  socket.onmessage=e=>{
    const r=JSON.parse(e.data)
    if(r.method==='Runtime.exceptionThrown')results.errors.push(r.params.exceptionDetails.text)
    const p=pending.get(r.id);if(!p)return
    clearTimeout(p.timer);pending.delete(r.id)
    r.error?p.reject(new Error(r.error.message)):p.resolve(r.result)
  }
  send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`))},15000)
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
  })
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text)
    return r.result.value
  }
  const until=async exp=>{for(let i=0;i<100;i++){if(await evaluate(exp))return;await pause(100)}throw new Error(`Wait failed: ${exp}`)}
  const store=name=>`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(qa,name),Buffer.from(r.data,'base64'))}
  const metrics=async(width,height)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900})
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable')
  // Local origin remains allowed; no API keys are configured or used.
  await send('Network.setBlockedURLs',{urls:['https://*']})
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'})
  await metrics(390,844)
  await send('Page.navigate',{url:'http://127.0.0.1:5189/'})
  await until(`!!document.querySelector('#app')?.__vue_app__`)
  await until(`!!${store('auth')}?.isDataLoaded`)
  await pause(350)
  await shot('390-lock.png')
  const synthetic=`Audit-${crypto.randomBytes(12).toString('hex')}`
  await evaluate(`(()=>{const e=document.querySelector('.lock-screen input');e.value=${JSON.stringify(synthetic)};e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.lock-btn').click()})()`)
  await until(`!${store('auth')}.isLocked && ${store('weight')}?.isDataLoaded && ${store('todo')}?.isDataLoaded`)
  await pause(500)
  await evaluate(`(()=>{const s=${store('settings')};s.aiApiKey='';s.heightCm=175;s.targetWeight=70;s.weightChangeReminderEnabled=false;const today=new Date();today.setHours(12,0,0,0);const records=Array.from({length:7},(_,i)=>{const d=new Date(today);d.setDate(d.getDate()-6+i);return{id:'audit-'+i,date:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),time:'08:00',weight:73-i*.2,note:i===6?'合成审查数据':''}});${store('weight')}.updateWeightRecords(records)})()`)
  const inspect=`(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&s.visibility!=='hidden'&&s.display!=='none'};
    const name=e=>(e.getAttribute('aria-label')||e.textContent||e.title||'').trim().slice(0,65);
    const rect=e=>{const r=e.getBoundingClientRect();return{width:+r.width.toFixed(1),height:+r.height.toFixed(1)}};
    const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
    const text=[...document.querySelectorAll('small,p,span,label,text')].filter(visible).filter(e=>e.childElementCount===0&&e.textContent.trim());
    return{width:innerWidth,height:innerHeight,rootOverflow:document.querySelector('.app-wrapper').scrollWidth>innerWidth+1,
      smallControls:buttons.filter(e=>!e.disabled).filter(e=>{const r=rect(e);return r.width<44||r.height<44}).map(e=>({name:name(e),class:e.getAttribute('class'),...rect(e)})),
      unnamed:buttons.filter(e=>!name(e)).map(e=>e.className),
      smallText:text.filter(e=>parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({text:name(e),size:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,class:e.getAttribute('class')})).slice(0,50),
      states:buttons.filter(e=>e.classList.contains('active')).map(e=>({name:name(e),pressed:e.getAttribute('aria-pressed'),selected:e.getAttribute('aria-selected'),role:e.getAttribute('role')})),
      text:document.body.innerText.slice(0,2300)}
  })()`
  for(const [width,height] of [[390,844],[320,720],[844,390],[1280,900]]) {
    await metrics(width,height)
    for(const view of ['home','todo','schedule','mood','weight','debts','passwords','reports','chat','settings']) {
      await evaluate(`${store('settings')}.switchView('${view}')`)
      await pause(350)
      await evaluate(`document.querySelector('.app-wrapper').scrollTop=0`)
      const r=await evaluate(inspect);r.view=view;results.layouts.push(r)
      if(width===390 || (width===320&&['home','weight','settings'].includes(view)) || (width===1280&&['home','schedule','settings'].includes(view)))await shot(`${width}-${view}.png`)
    }
  }
  await metrics(390,844)
  await evaluate(`${store('settings')}.switchView('home')`);await pause(200)
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await evaluate(`document.querySelector('.nav-link-btn').focus()`)
  results.navigationFocus=await evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e);return{class:e.className,focusVisible:e.matches(':focus-visible'),outline:s.outline,boxShadow:s.boxShadow}})()`)
  results.closedDrawer=await evaluate(`(()=>{const d=document.querySelector('.drawer'),c=d.querySelector('.drawer-close');c.focus();const r=c.getBoundingClientRect();return{open:d.classList.contains('open'),styleDisplay:getComputedStyle(d).display,ariaHidden:d.getAttribute('aria-hidden'),inert:d.inert,receivedFocus:document.activeElement===c,buttonBounds:{left:r.left,right:r.right},shadow:getComputedStyle(d).boxShadow}})()`)
  await evaluate(`document.querySelector('.nav-link-btn').focus()`);await pause(1200)
  await shot('390-closed-drawer-shadow.png')
  await evaluate(`document.querySelector('.drawer').style.boxShadow='none'`);await shot('390-without-drawer-shadow.png')
  await evaluate(`document.querySelector('.drawer').style.boxShadow=''`)
  await evaluate(`${store('settings')}.isDrawerOpen=true`);await pause(400);await shot('390-drawer.png')
  results.drawer=await evaluate(`({role:document.querySelector('.drawer')?.getAttribute('role'),inert:document.querySelectorAll('[inert]').length,text:document.body.innerText.slice(0,1500)})`)
  await evaluate(`${store('settings')}.isDrawerOpen=false;${store('settings')}.switchView('weight')`);await pause(350)
  await evaluate(`document.querySelector('.weight-add-button').focus();document.querySelector('.weight-add-button').click()`);await pause(200)
  results.weightModal=await evaluate(`({active:document.activeElement.className,inside:!!document.activeElement.closest('.weight-modal-panel'),role:document.querySelector('.weight-modal-panel').getAttribute('role'),ariaModal:document.querySelector('.weight-modal-panel').getAttribute('aria-modal')})`)
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  results.weightModal.afterTab=await evaluate(`({active:document.activeElement.className,inside:!!document.activeElement.closest('.weight-modal-panel')})`)
  await shot('390-weight-modal.png')
  await evaluate(`document.querySelector('.weight-modal-overlay').click()`)
  results.weightMarkers=await evaluate(`[...document.querySelectorAll('.weight-chart circle[role="button"]')].map(e=>({label:e.getAttribute('aria-label'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))`)
  results.themeKeys=await evaluate(`Object.keys(${store('settings')}).filter(k=>/theme/i.test(k))`)
  results.weightTheme=await evaluate(`({globalPrimary:getComputedStyle(document.documentElement).getPropertyValue('--primary'),weightPrimary:getComputedStyle(document.querySelector('.weight-container')).getPropertyValue('--primary'),button:getComputedStyle(document.querySelector('.weight-add-button')).backgroundImage})`)
  results.themeComparisons=[]
  for(const presetId of ['peach','mint']){
    await evaluate(`${store('settings')}.updateThemeSettings({mode:'preset',presetId:'${presetId}'})`);await pause(120)
    results.themeComparisons.push(await evaluate(`({preset:'${presetId}',globalPrimary:getComputedStyle(document.documentElement).getPropertyValue('--primary'),navColor:getComputedStyle(document.querySelector('.module-settings-trigger')).color,weightPrimary:getComputedStyle(document.querySelector('.weight-container')).getPropertyValue('--primary'),button:getComputedStyle(document.querySelector('.weight-add-button')).backgroundImage})`))
    await shot(`390-weight-${presetId}.png`)
  }
  await evaluate(`${store('settings')}.updateThemeSettings({mode:'preset',presetId:'cloud'})`)
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  results.reducedMotion=await evaluate(`[...document.querySelectorAll('.ambient-orb,.weight-add-button')].map(e=>({class:e.className,animation:getComputedStyle(e).animationName,duration:getComputedStyle(e).animationDuration,iterations:getComputedStyle(e).animationIterationCount,transition:getComputedStyle(e).transitionDuration}))`)
  results.rawAndSourceUnchanged=Object.entries(baseline).every(([f,h])=>digest(path.join(root,f))===h)
  fs.writeFileSync(path.join(qa,'evidence.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify({layouts:results.layouts.length,overflow:results.layouts.filter(r=>r.rootOverflow).map(r=>[r.width,r.view]),navigationFocus:results.navigationFocus,closedDrawer:results.closedDrawer,weightModal:results.weightModal,themeComparisons:results.themeComparisons,reducedMotion:results.reducedMotion,errors:results.errors,rawAndSourceUnchanged:results.rawAndSourceUnchanged},null,2))
} catch(error) {
  results.failure=error.stack;fs.writeFileSync(path.join(qa,'evidence.json'),JSON.stringify(results,null,2));throw error
} finally {
  try{if(send)await send('Browser.close')}catch{browser.kill()}
  socket?.close()
  for(let i=0;i<50&&browser.exitCode===null;i++)await pause(100)
  if(browser.exitCode===null){browser.kill();await pause(1500)}
  const resolved=path.resolve(profile),temp=path.resolve(os.tmpdir())+path.sep
  if(!resolved.startsWith(temp)||!path.basename(resolved).startsWith('formyself-ui-review-'))throw new Error('Unexpected temporary profile path')
  for(let attempt=0;attempt<5;attempt++){
    try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:500});break}
    catch(error){if(attempt===4)throw error;await pause(500)}
  }
}
