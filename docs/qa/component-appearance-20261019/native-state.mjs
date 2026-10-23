import {connect} from '../background-20261019/native/cdp.mjs'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
process.env.QA_CDP_PORT='9362';const c=await connect()
console.log(await c.evaluate(`(()=>{const e=document.querySelector('.background-settings-card > button'),r=e.getBoundingClientRect();return{rect:r.toJSON(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,disabled:e.disabled,scroll:document.querySelector('.app-wrapper').scrollTop}})()`))
console.log(await fetch('http://127.0.0.1:9362/json').then(r=>r.json()))
fs.writeFileSync(new URL('native-screen.png',import.meta.url),execFileSync('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5586','exec-out','screencap','-p'],{windowsHide:true}));c.close()
