import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'

const root=process.cwd(), qa=path.join(root,'docs/qa/component-appearance-20261019')
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

  await send('Page.addScriptToEvaluateOnNewDocument',{source:`new MutationObserver((_,observer)=>{const wrapper=document.querySelector('.app-wrapper');if(!wrapper)return;window.__firstAppearance={custom:wrapper.classList.contains('has-custom-bg'),background:getComputedStyle(wrapper).backgroundImage,opacity:getComputedStyle(document.documentElement).getPropertyValue('--component-opacity'),at:performance.now()};observer.disconnect()}).observe(document,{childList:true,subtree:true})`})
  await send('Page.navigate',{url:'http://127.0.0.1:5192/'})
  await until(`!!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)
  const password='QA-'+crypto.randomBytes(12).toString('hex')
  await evaluate(`(()=>{const e=document.querySelector('.lock-screen input');e.value=${JSON.stringify(password)};e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.lock-btn').click()})()`)
  await until(`!${store('auth')}.isLocked && !!${store('chat')}?.isDataLoaded`)
  const source=await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddad88';ctx.fillRect(0,0,2400,1800);ctx.fillStyle='#496c7b';ctx.fillRect(1200,0,1200,1800);ctx.fillStyle='#e8e2ba';ctx.beginPath();ctx.arc(1400,450,230,0,Math.PI*2);ctx.fill();ctx.fillStyle='#335d55';ctx.fillRect(0,1250,2400,550);ctx.fillStyle='#e0e9dd';for(let i=0;i<12;i++)ctx.fillRect(80+i*200,1350,80,400);return canvas.toDataURL('image/png')})()`)
  fs.writeFileSync(path.join(qa,'synthetic-wallpaper.png'),Buffer.from(source.split(',')[1],'base64'))
  await evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await until(`!!document.querySelector('#component-transparency')`)
  const set=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await set('#component-transparency','65')
  await pause(400)
  assert.equal(await evaluate(`${store('settings')}.componentTransparency`),65)
  // Exercise actual file selection and cropper rather than injecting its internal model.
  const choose=async()=>{
    const dom=await send('DOM.getDocument')
    const input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'.background-settings-card input[type=file]'})
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(qa,'synthetic-wallpaper.png')]})
    await until(`!!document.querySelector('.background-crop-frame img')?.naturalWidth`)
  }
  await choose()
  assert.equal(await evaluate(`${store('settings')}.customBg`),'')
  await evaluate(`document.querySelector('.background-crop-dialog header button').click()`)
  await until(`!document.querySelector('.background-crop-dialog')`)
  assert.equal(await evaluate(`${store('settings')}.customBg`),'')
  await choose()
  await set('#background-crop-zoom','1.5')

  const touch=async(type,points)=>send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))})
  const center=await evaluate(`(()=>{const r=document.querySelector('.background-crop-frame').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  const sourcePoint=()=>evaluate(`(()=>{const f=document.querySelector('.background-crop-frame').getBoundingClientRect(),i=document.querySelector('.background-crop-frame img'),r=i.getBoundingClientRect();return{x:((f.x+f.width/2)-r.x)/r.width*i.naturalWidth,y:((f.y+f.height/2)-r.y)/r.height*i.naturalHeight}})()`)
  const beforePoint=await sourcePoint()
  await touch('touchStart',[[1,center.x-25,center.y],[2,center.x+25,center.y]])
  await touch('touchMove',[[1,center.x-45,center.y],[2,center.x+45,center.y]])
  await pause(80)
  assert.ok(Number(await evaluate(`document.querySelector('#background-crop-zoom').value`))>2.6)
  const afterPoint=await sourcePoint()
  assert.ok(Math.abs(beforePoint.x-afterPoint.x)<1&&Math.abs(beforePoint.y-afterPoint.y)<1)
  await touch('touchEnd',[])
  await touch('touchStart',[[1,center.x-40,center.y],[2,center.x+40,center.y]])
  await touch('touchMove',[[1,center.x-20,center.y],[2,center.x+20,center.y]])
  await pause(80)
  assert.ok(Number(await evaluate(`document.querySelector('#background-crop-zoom').value`))<1.4)
  await touch('touchCancel',[])
  assert.equal(await evaluate(`visualViewport.scale`),1)
  results.pinch={grow:true,shrink:true,anchorStable:true,pageScale:1,cancel:true}
  await shot('390-pinch.png')
  await set('#background-crop-zoom','1.5')
  await evaluate(`(()=>{const f=document.querySelector('.background-crop-frame');f.focus();for(let i=0;i<12;i++)f.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return true})()`)
  await shot('390-cropper.png')
  const frame=await evaluate(`(()=>{const r=document.querySelector('.background-crop-frame').getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.5}})()`)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:frame.x,y:frame.y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:frame.x+35,y:frame.y+25,button:'left',buttons:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:frame.x+35,y:frame.y+25,button:'left',clickCount:1})
  await evaluate(`document.querySelector('.background-crop-dialog .button-primary').click()`)
  await until(`!document.querySelector('.background-crop-dialog') && !!${store('settings')}.customBg`)
  const cropInfo=await evaluate(`(async()=>{const image=new Image();image.src=${store('settings')}.customBg;await image.decode();return{width:image.width,height:image.height,bytes:image.src.length,type:image.src.slice(0,23)}})()`)
  assert.ok(Math.abs(cropInfo.width/cropInfo.height-390/844)<.002)
  assert.ok(cropInfo.bytes<source.length)
  results.crop={...cropInfo,cancelPreserved:true,keyboard:true,pointer:true}
  await set('#background-blur','0');await set('#background-fade','10')
  await evaluate(`document.querySelector('.component-transparency-card').scrollIntoView({block:'center'})`)
  await shot('390-appearance.png')
  const surfaces={home:'.today-action',reports:'.report-card',debts:'.savings-summary',weight:'.weight-hero',mood:'.calendar-card',todo:'.todo-progress-card',schedule:'.schedule-header',chat:'.companion-header',passwords:'.glass-card',settings:'.general-settings-card'}
  results.pages=[]
  for(const [view,selector] of Object.entries(surfaces)){
    await evaluate(`${store('settings')}.switchView('${view}')`)
    await until(`!!document.querySelector('${selector}')`)
    await pause(650)
    const surface=await evaluate(`(()=>{const e=document.querySelector('${selector}'),s=getComputedStyle(e);return{view:'${view}',background:s.backgroundColor,opacity:s.opacity,overflow:document.querySelector('.app-wrapper').scrollWidth>innerWidth+1}})()`)
    assert.equal(surface.opacity,'1');assert.equal(surface.overflow,false)
    assert.notEqual(surface.background,'rgb(255, 255, 255)')
    results.pages.push(surface)
    await shot('390-'+view+'.png')
  }
  await evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await until(`!!document.querySelector('#component-transparency')`)
  for(const value of [0,100,40]){
    await set('#component-transparency',String(value));await pause(100)
    assert.equal(await evaluate(`Number(getComputedStyle(document.documentElement).getPropertyValue('--component-opacity'))`),(100-value)/100)
  }
  for(const [width,height] of [[320,720],[390,844],[1280,900]]){
    await metrics(width,height);await pause(200)
    await evaluate(`document.querySelector('.component-transparency-card').scrollIntoView({block:'center'})`)
    const layout=await evaluate(`(()=>{const e=document.querySelector('.settings-container');return{width:innerWidth,overflow:e.scrollWidth>e.getBoundingClientRect().width+1}})()`)
    assert.equal(layout.overflow,false);results.layouts.push(layout)
    await choose()
    const dialog=await evaluate(`(()=>{const r=document.querySelector('.background-crop-dialog').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`)
    assert.ok(dialog.left>=0&&dialog.right<=dialog.width+1&&dialog.top>=0&&dialog.bottom<=dialog.height+1)
    await shot(width+'-cropper.png')
    await evaluate(`document.querySelector('.background-crop-dialog header button').click()`)
  }
  await metrics(390,844)
  await set('#component-transparency','65')
  await evaluate(`(async()=>{await new Promise(r=>setTimeout(r,400));await ${store('settings')}.flushPendingSettingsWrites()})()`)
  const oldTimeOrigin=await evaluate('performance.timeOrigin')
  await send('Page.reload')
  await until(`performance.timeOrigin!==${oldTimeOrigin}`)
  await until(`!!${store('settings')}?.isDataLoaded`)
  assert.equal(await evaluate(`${store('settings')}.componentTransparency`),65)
  const first=await evaluate(`window.__firstAppearance`)
  assert.equal(first.custom,true)
  assert.ok(first.background.startsWith('url("data:image/jpeg'))
  assert.equal(Number(first.opacity),.35)
  results.startup={...first,background:'cropped JPEG present on first Vue frame',readyMark:await evaluate(`performance.getEntriesByName('app:appearance-ready')[0]?.startTime`)}
  await shot('390-first-lock-after-reload.png')
  assert.deepEqual(results.errors,[])
  fs.writeFileSync(path.join(qa,'verification.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results))
} finally {
  try{if(send)await send('Browser.close')}catch{browser.kill()}
  if(socket)socket.close()
}
