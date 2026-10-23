import {connect,pause} from '../background-20261019/native/cdp.mjs'
import {execFileSync} from 'node:child_process'
process.env.QA_CDP_PORT='9362'
const c=await connect()
await c.evaluate(`document.querySelector('.background-settings-card > button').scrollIntoView({block:'center'})`)
await pause(300)
const r=await c.evaluate(`(()=>{const r=document.querySelector('.background-settings-card > button').getBoundingClientRect();return{x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`)
const ts=await fetch('http://127.0.0.1:9362/json').then(r=>r.json());const origin=JSON.parse(ts.find(t=>t.type==='page').description)
execFileSync('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5586','shell','input','tap',String(r.x+(origin.screenX||0)),String(r.y+(origin.screenY||0))],{windowsHide:true})
await pause(1500)
c.close()
