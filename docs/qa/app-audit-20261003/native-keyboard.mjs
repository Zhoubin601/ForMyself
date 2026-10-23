import {writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {connect,pause,uiClick} from './cdp.mjs'
const c=await connect()
try {
  await c.evaluate(uiClick('.todo-add'));await pause(600)
  const p=await c.evaluate(`(()=>{const r=document.querySelector('#todo-title').getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio),width:innerWidth,dpr:devicePixelRatio}})()`)
  execFileSync('C:/Users/a3185/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5584','shell','input','tap',String(p.x),String(p.y)],{windowsHide:true});await pause(1600)
  const dump=execFileSync('C:/Users/a3185/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5584','shell','dumpsys','input_method'],{encoding:'utf8',windowsHide:true})
  const result=await c.evaluate(`(()=>{const overlay=document.querySelector('.todo-editor-overlay').getBoundingClientRect(),r=document.querySelector('.todo-editor button[type=submit]').getBoundingClientRect();return {innerHeight,visualHeight:visualViewport.height,overlayHeight:overlay.height,saveVisible:r.bottom<=overlay.bottom,activeInput:document.activeElement.id}})()`)
  result.imeShown=/mInputShown=true/.test(dump);result.tap=p
  await c.screenshot('android-api37-todo-ime-verified.png')
  await writeFile(new URL('native-keyboard.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{c.close()}
