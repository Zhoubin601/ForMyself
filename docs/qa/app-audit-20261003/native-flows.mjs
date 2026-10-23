import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { connect,pause,store,uiClick } from './cdp.mjs'
const c=await connect(),results=[]
const adb=args=>execFileSync('C:/Users/a3185/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5584',...args],{encoding:'utf8',windowsHide:true})
try {
  results.push(await c.evaluate(`({name:'environment',userAgent:navigator.userAgent})`))
  await c.evaluate(`(()=>{const e=document.querySelector('.lock-screen input');e.value=crypto.randomUUID();e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await c.evaluate(uiClick('.lock-btn'));await c.until(`!${store('auth')}.isLocked&&${store('todo')}.isDataLoaded`);await pause(1200)
  results.push({name:'native-first-entry',passed:true});await c.screenshot('android-api37-home.png')
  await c.evaluate(`${store('settings')}.switchView('todo')`);await pause(450);await c.evaluate(uiClick('.todo-add'))
  const point=await c.evaluate(`(()=>{const r=document.querySelector('#todo-title').getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`)
  adb(['shell','input','tap',String(point.x),String(point.y)]);await pause(900)
  await c.evaluate(`(()=>{const e=document.querySelector('#todo-title');e.value='QA 原生待办';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  results.push(await c.evaluate(`(()=>{const button=document.querySelector('.todo-editor button[type=submit]'),r=button.getBoundingClientRect(),overlay=document.querySelector('.todo-editor-overlay').getBoundingClientRect();return {name:'native-keyboard-editor',innerHeight,visualHeight:visualViewport.height,overlayHeight:overlay.height,saveInVisibleArea:r.top>=overlay.top&&r.bottom<=overlay.bottom}})()`))
  await c.screenshot('android-api37-todo-keyboard.png');await c.evaluate(`document.querySelector('.todo-editor').requestSubmit()`);await pause(550)
  results.push(await c.evaluate(`({name:'native-todo-save',passed:${store('todo')}.todayItems.some(i=>i.title==='QA 原生待办')})`))
  await c.evaluate(uiClick('.todo-checkbox'));await pause(500)
  results.push(await c.evaluate(`({name:'native-todo-complete',done:${store('todo')}.progress.done})`));await c.screenshot('android-api37-todo-filled.png')
  adb(['shell','input','keyevent','3']);await pause(450)
  await c.until(`document.hidden&&${store('auth')}.isLocked`)
  results.push(await c.evaluate(`({name:'native-background-lock',locked:${store('auth')}.isLocked})`))
  adb(['shell','am','start','-n','com.yubin.formyself/.MainActivity']);await pause(650)
  results.push(await c.evaluate(`({name:'native-resume-lock',lockShown:Boolean(document.querySelector('.lock-screen'))})`))
} catch(error){results.push({name:'harness-failure',error:error.stack});process.exitCode=1}
finally{await writeFile(new URL('native-flows.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));c.close()}
