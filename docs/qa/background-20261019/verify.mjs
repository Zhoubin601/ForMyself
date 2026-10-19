import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'

const root=process.cwd(), qa=path.join(root,'docs/qa/background-20261019')
fs.mkdirSync(qa,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'formyself-ui-review-'))
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','about:blank'],{windowsHide:true,stdio:'ignore'})
let socket,send
const results={date:'2026-10-19',data:'Synthetic records only; isolated browser profile',layouts:[],errors:[]}
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
  const store=name=>`(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('${name}'))`
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(qa,name),Buffer.from(r.data,'base64'))}
  const metrics=async(width,height)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900})

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  await send('Network.setBlockedURLs',{urls:['https://*']})
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'})
  await metrics(390,844)
  await send('Page.navigate',{url:'http://127.0.0.1:5191/'})
  await until(`!!document.querySelector('#app')?.__vue_app__ && !!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)
  await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
    const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,720,1280);gradient.addColorStop(0,'#edbd96');gradient.addColorStop(.5,'#7da6b2');gradient.addColorStop(1,'#42617b');ctx.fillStyle=gradient;ctx.fillRect(0,0,720,1280);
    ctx.fillStyle='#fff5d8';ctx.beginPath();ctx.arc(500,290,110,0,Math.PI*2);ctx.fill();ctx.fillStyle='#2b5964';ctx.fillRect(0,850,720,430);ctx.fillStyle='#d6e9dc';for(let i=0;i<7;i++)ctx.fillRect(30+i*100,910,50,240);
    const s=${store('settings')};await s.updateBg(canvas.toDataURL('image/png'));s.backgroundEffects={lock:{blur:0,fade:0},pages:{blur:75,fade:45}};await new Promise(r=>setTimeout(r,400));await s.flushPendingSettingsWrites();
  })()`)
  await shot('390-lock-clear.png')
  const effect=()=>evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.bg-blur-layer'));return{blur:s.backdropFilter,fade:s.backgroundColor}})()`)
  assert.deepEqual(await effect(),{blur:'blur(0px)',fade:'rgba(245, 245, 247, 0)'})
  const password='Qa-'+crypto.randomBytes(12).toString('hex')
  await evaluate(`(()=>{const e=document.querySelector('.lock-screen input');e.value=${JSON.stringify(password)};e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.lock-btn').click()})()`)
  await until(`!${store('auth')}.isLocked && !!${store('chat')}?.isDataLoaded`)
  assert.deepEqual(await effect(),{blur:'blur(30px)',fade:'rgba(245, 245, 247, 0.45)'})
  await evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await until(`!!document.querySelector('#background-blur')`)
  await pause(500)
  await evaluate(`document.querySelector('.background-settings-card').scrollIntoView({block:'center'})`)
  await pause(150)
  await shot('390-appearance-pages.png')
  await evaluate(`document.querySelector('.background-scope-picker button').click()`)
  await until(`document.querySelector('#background-blur').value==='0'`)
  const lockPreview=await evaluate(`getComputedStyle(document.querySelector('.background-preview-filter')).backdropFilter`)
  assert.equal(lockPreview,'blur(0px)')
  await evaluate(`(()=>{const input=document.querySelector('#background-blur');input.value='15';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await pause(450)
  assert.equal(await evaluate(`${store('settings')}.backgroundEffects.lock.blur`),15)
  assert.equal(await evaluate(`${store('settings')}.backgroundEffects.pages.blur`),75)
  for(const [width,height] of [[320,720],[390,844],[1280,900]]){
    await metrics(width,height); await pause(250)
    await evaluate(`document.querySelector('.background-settings-card').scrollIntoView({block:'center'})`)
    await pause(150)
    const layout=await evaluate(`(()=>{const e=document.querySelector('.settings-container');const r=e.getBoundingClientRect();return{width:innerWidth,overflow:e.scrollWidth>r.width+1,previewWidth:document.querySelector('.background-preview').getBoundingClientRect().width}})()`)
    assert.equal(layout.overflow,false);results.layouts.push(layout)
    await shot(`${width}-appearance-lock.png`)
  }
  await metrics(390,844)
  await evaluate(`${store('settings')}.switchView('chat')`)
  await until(`!!document.querySelector('.warm-home')`)
  await evaluate(`(()=>{window.__qaChat=document.querySelector('.warm-home').__vueParentComponent;return true})()`)
  await evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await until(`!!document.querySelector('input[aria-label="开启温馨小家"]')`)
  await evaluate(`document.querySelector('input[aria-label="开启温馨小家"]').click()`)

  await until(`${store('settings')}.warmHomeEnabled===false && window.__qaChat.isUnmounted`)
  results.cachedChatUnmounted=true
  await evaluate(`${store('settings')}.switchView('home')`)
  await until(`!!document.querySelector('.companion-note')`)
  const homeText=await evaluate(`document.querySelector('.companion-note').innerText`)
  assert.ok(homeText.length>4)
  await evaluate(`document.querySelector('.companion-note').click()`)
  await pause(100)
  assert.equal(await evaluate(`${store('settings')}.currentView`),'home')
  assert.ok(await evaluate(`document.body.innerText.includes('温馨小家入口已关闭')`))
  assert.equal(await evaluate(`!!document.querySelector('.companion-unread')`),false)
  await shot('390-home-disabled.png')
  await evaluate(`${store('settings')}.isDrawerOpen=true`)
  await pause(150)
  assert.equal(await evaluate(`[...document.querySelectorAll('.drawer-menu li')].some(e=>e.textContent.includes('温馨小家'))`),false)
  await shot('390-drawer-disabled.png')
  await send('Page.reload')
  await until(`!!document.querySelector('#app')?.__vue_app__`)
  await until(`!!${store('settings')}?.isDataLoaded`)
  assert.equal(await evaluate(`${store('settings')}.warmHomeEnabled`),false)
  assert.deepEqual(await effect(),{blur:'blur(6px)',fade:'rgba(245, 245, 247, 0)'})
  assert.equal(await evaluate(`${store('settings')}.backgroundEffects.pages.blur`),75)
  await shot('390-lock-after-reload.png')
  results.independentEffects=true;results.persisted=true;results.homeQuoteRetained=true;results.disabledClickBlocked=true;results.drawerHidden=true
  fs.writeFileSync(path.join(qa,'verification.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results))
} finally {
  try{if(send)await send('Browser.close')}catch{browser.kill()}
  if(socket)socket.close()
}
