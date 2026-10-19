import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import {connect,pause,store,uiSet} from '../background-20261019/native/cdp.mjs'
process.env.QA_CDP_PORT='9362'
const adb=args=>execFileSync('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5586',...args],{encoding:'utf8',windowsHide:true})
const results={date:'2026-10-19',user:12,tests:[]}
const record=(name,details={})=>{results.tests.push({name,passed:true,...details});console.log('PASS '+name)}
let c=await connect()
const shot=async name=>{const r=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(new URL(name,import.meta.url),Buffer.from(r.data,'base64'))}
const tap=async selector=>{
  await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await pause(250)
  const r=await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`)
  const ts=await fetch('http://127.0.0.1:9362/json').then(r=>r.json());const origin=JSON.parse(ts.find(t=>t.type==='page').description)
  adb(['shell','input','tap',String(r.x+(origin.screenX||0)),String(r.y+(origin.screenY||0))]);await pause(250)
}
try{
  assert.equal(adb(['shell','am','get-current-user']).trim(),'12')
  await c.until(`!!document.querySelector('.background-crop-frame img')?.naturalWidth`)
  assert.equal(await c.evaluate(`${store('auth')}.isLocked`),false)
  assert.equal(await c.evaluate(`${store('settings')}.customBg`),'')
  record('system-photo-picker-returns-to-crop-without-locking')
  await c.evaluate(uiSet('#background-crop-zoom','1.5'))
  const start=await c.evaluate(`document.querySelector('.background-crop-frame img').style.left`)
  const r=await c.evaluate(`(()=>{const r=document.querySelector('.background-crop-frame').getBoundingClientRect();return{x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`)
  adb(['shell','input','swipe',String(r.x),String(r.y+145),String(r.x+120),String(r.y+215),'400']);await pause(250)
  assert.notEqual(await c.evaluate(`document.querySelector('.background-crop-frame img').style.left`),start)
  await shot('native-cropper.png');record('native-touch-drag-crop')
  await tap('.background-crop-dialog .button-primary')
  await c.until(`!document.querySelector('.background-crop-dialog') && ${store('settings')}.customBg.startsWith('data:image/jpeg')`)
  const image=await c.evaluate(`(async()=>{const i=new Image();i.src=${store('settings')}.customBg;await i.decode();return{width:i.width,height:i.height,bytes:i.src.length}})()`)
  record('crop-and-compressed-save',image)
  await c.evaluate(uiSet('#component-transparency','65'));await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  const range=await c.evaluate(`(()=>{const e=document.querySelector('#component-transparency');e.scrollIntoView({block:'center'});return true})()`)
  assert.ok(range)
  await pause(300)
  const slider=await c.evaluate(`(()=>{const r=document.querySelector('#component-transparency').getBoundingClientRect();return{x1:Math.round((r.x+r.width*.65)*devicePixelRatio),x2:Math.round((r.x+r.width*.8)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)+145}})()`)
  adb(['shell','input','swipe',String(slider.x1),String(slider.y),String(slider.x2),String(slider.y),'400']);await pause(350)
  assert.ok(await c.evaluate(`${store('settings')}.componentTransparency`)>70)
  await c.evaluate(uiSet('#component-transparency','40'));await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  await shot('native-appearance.png');record('native-transparency-slider-and-save')
  await c.evaluate(`${store('settings')}.switchView('home')`);await c.until(`!!document.querySelector('.home-hero')`);await pause(600)
  assert.equal(await c.evaluate(`getComputedStyle(document.querySelector('.today-action')).backgroundColor`),'rgba(255, 255, 255, 0.6)')
  await shot('native-home.png');record('home-translucent-background')
  const password=await c.evaluate(`${store('auth')}.savedMasterPwd`)
  adb(['shell','am','force-stop','--user','12','com.yubin.formyself']);c.close()
  adb(['shell','am','start','--user','12','-n','com.yubin.formyself/.MainActivity'])
  let connected=false
  for(let i=0;i<60;i++){
    try{
      const line=adb(['shell','ps','-A','-o','USER,PID,NAME']).split('\n').find(l=>/^u12_/.test(l)&&/ com\.yubin\.formyself\s*$/.test(l))
      if(line){adb(['forward','tcp:9362','localabstract:webview_devtools_remote_'+line.trim().split(/\s+/)[1]]);c=await connect();connected=true;break}
    }catch{}
    await pause(250)
  }
  assert.ok(connected)
  await c.until(`!!${store('settings')}?.isDataLoaded`)
  assert.equal(await c.evaluate(`${store('settings')}.componentTransparency`),40)
  assert.ok(await c.evaluate(`${store('settings')}.customBg.startsWith('data:image/jpeg')`))
  assert.equal(await c.evaluate(`document.querySelector('.app-wrapper').classList.contains('has-custom-bg')`),true)
  const marks=await c.evaluate(`({appearance:performance.getEntriesByName('app:appearance-ready')[0]?.startTime,lock:performance.getEntriesByName('app:lock-ready')[0]?.startTime,paint:performance.getEntriesByName('first-contentful-paint')[0]?.startTime})`)
  assert.ok(marks.appearance<marks.lock)
  if(marks.paint)assert.ok(marks.appearance<=marks.paint)
  await shot('native-cold-start.png');record('cold-start-restores-wallpaper-before-first-content',marks)
  await c.evaluate(uiSet('.lock-screen input',password));await tap('.lock-btn');await c.until(`!${store('auth')}.isLocked`)
  assert.equal(await c.evaluate(`document.querySelector('.app-wrapper').scrollWidth>innerWidth+1`),false)
  record('unlock-and-no-horizontal-overflow')
  results.errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)
  assert.deepEqual(results.errors,[])
  fs.writeFileSync(new URL('native-verification.json',import.meta.url),JSON.stringify(results,null,2))
}finally{c.close()}
