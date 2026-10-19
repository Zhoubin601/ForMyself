import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import {connect,pause,store,uiSet} from '../background-20261019/native/cdp.mjs'
process.env.QA_CDP_PORT='9362'
const adb=args=>execFileSync('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5586',...args],{encoding:'utf8',windowsHide:true})
const results={date:'2026-10-19',user:12,input:'Synthetic file through the actual file-input change handler; native system picker separately verified in native-verification.json',tests:[]}
const record=(name,details={})=>{results.tests.push({name,passed:true,...details});console.log('PASS '+name)}
let c=await connect()
const shot=async name=>{const r=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(new URL(name,import.meta.url),Buffer.from(r.data,'base64'))}
const tap=async selector=>{
  await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await pause(250)
  const r=await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`)
  const ts=await fetch('http://127.0.0.1:9362/json').then(r=>r.json());const origin=JSON.parse(ts.find(t=>t.type==='page').description)
  adb(['shell','input','tap',String(r.x+(origin.screenX||0)),String(r.y+(origin.screenY||0))]);await pause(250)
}

const reconnect=async()=>{
  for(let i=0;i<80;i++){
    try{
      const line=adb(['shell','ps','-A','-o','USER,PID,NAME']).split('\n').find(l=>/^u12_/.test(l)&&/ com\.yubin\.formyself\s*$/.test(l))
      if(line){
        adb(['forward','tcp:9362','localabstract:webview_devtools_remote_'+line.trim().split(/\s+/)[1]])
        const targets=await fetch('http://127.0.0.1:9362/json',{signal:AbortSignal.timeout(1500)}).then(r=>r.json())
        if(targets.some(t=>t.type==='page')){c=await connect();await c.until(`!!${store('settings')}?.isDataLoaded`);return}
      }
    }catch{}
    await pause(200)
  }
  throw new Error('WebView connection timeout')
}

const selectPhoto=async()=>{
  for(let i=0;i<6;i++){
    await pause(300)
    adb(['shell','uiautomator','dump','/data/local/tmp/appearance-picker.xml'])
    const xml=adb(['shell','cat','/data/local/tmp/appearance-picker.xml'])
    const tile=xml.match(/<node[^>]*content-desc="(?:Selected )?Photo taken[^"\n]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if(tile){
      adb(['shell','input','tap',String((Number(tile[1])+Number(tile[3]))/2),String((Number(tile[2])+Number(tile[4]))/2)])
      await pause(300)
      adb(['shell','uiautomator','dump','/data/local/tmp/appearance-picker.xml'])
      const next=adb(['shell','cat','/data/local/tmp/appearance-picker.xml'])
      const done=next.match(/<node[^>]*(?:text|content-desc)="Done"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      if(done)adb(['shell','input','tap',String((Number(done[1])+Number(done[3]))/2),String((Number(done[2])+Number(done[4]))/2)])
      return
    }
  }
  throw new Error('Synthetic photo tile not found')
}
try{
  assert.equal(adb(['shell','am','get-current-user']).trim(),'12')
  const previous=await c.evaluate(`${store('settings')}.customBg`)

  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await c.until(`!!document.querySelector('.background-settings-card input[type=file]')`)
  const selectSyntheticFile=async()=>{
    await c.evaluate(`(async()=>{const source=${store('settings')}.customBg;const blob=await fetch(source).then(r=>r.blob());const data=new DataTransfer();data.items.add(new File([blob],'synthetic-wallpaper.jpg',{type:'image/jpeg'}));const input=document.querySelector('.background-settings-card input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
    await c.until(`!!document.querySelector('.background-crop-frame img')?.naturalWidth`)
  }
  await selectSyntheticFile()
  const touch=async(type,points)=>c.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:3,radiusY:3,force:1}))})
  const center=await c.evaluate(`(()=>{const r=document.querySelector('.background-crop-frame').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await c.evaluate(uiSet('#background-crop-zoom','1.5'))
  await touch('touchStart',[[1,center.x-25,center.y],[2,center.x+25,center.y]])
  await touch('touchMove',[[1,center.x-45,center.y],[2,center.x+45,center.y]])
  await pause(150)
  assert.ok(Number(await c.evaluate(`document.querySelector('#background-crop-zoom').value`))>2.6)
  await shot('native-pinch.png');record('two-finger-grow')
  await touch('touchEnd',[])
  await touch('touchStart',[[1,center.x-40,center.y],[2,center.x+40,center.y]])
  await touch('touchMove',[[1,center.x-20,center.y],[2,center.x+20,center.y]])
  await pause(150)
  assert.ok(Number(await c.evaluate(`document.querySelector('#background-crop-zoom').value`))<1.4)
  await touch('touchEnd',[[2,center.x+20,center.y]])
  const before=await c.evaluate(`document.querySelector('.background-crop-frame img').style.left`)
  await touch('touchMove',[[1,center.x+10,center.y+10]])
  await pause(150)
  assert.notEqual(await c.evaluate(`document.querySelector('.background-crop-frame img').style.left`),before)
  await touch('touchEnd',[])
  record('two-finger-shrink-and-one-finger-continued-drag')
  assert.equal(await c.evaluate(`visualViewport.scale`),1);record('page-zoom-unchanged')
  adb(['shell','input','keyevent','4']);await c.until(`!document.querySelector('.background-crop-dialog')`)
  assert.equal(await c.evaluate(`${store('settings')}.customBg`),previous);record('native-back-cancels-without-changing-wallpaper')
  await selectSyntheticFile()
  await c.until(`!!document.querySelector('.background-crop-frame img')?.naturalWidth`)
  await c.evaluate(uiSet('#background-crop-zoom','2'))
  await tap('.background-crop-dialog .button-primary');await c.until(`!document.querySelector('.background-crop-dialog')`)
  assert.notEqual(await c.evaluate(`${store('settings')}.customBg`),previous);record('final-build-crop-confirm-and-save')
  results.errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)
  assert.deepEqual(results.errors,[])
  fs.writeFileSync(new URL('native-pinch-verification.json',import.meta.url),JSON.stringify(results,null,2))
}finally{c.close()}
