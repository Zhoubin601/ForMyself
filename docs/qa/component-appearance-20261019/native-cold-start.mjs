import {connect,pause,store,uiSet} from '../background-20261019/native/cdp.mjs'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import assert from 'node:assert/strict'
process.env.QA_CDP_PORT='9362'
const adb=args=>execFileSync('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5586',...args],{encoding:'utf8',windowsHide:true})
let c=await connect()
const password=await c.evaluate(`${store('auth')}.savedMasterPwd`)
assert.ok(password)
adb(['shell','input','keyevent','224'])
adb(['shell','am','force-stop','--user','12','com.yubin.formyself']);c.close()
adb(['shell','am','start','--user','12','-n','com.yubin.formyself/.MainActivity'])
for(let i=0;i<80;i++){
  const line=adb(['shell','ps','-A','-o','USER,PID,NAME']).split('\n').find(l=>/^u12_/.test(l)&&/ com\.yubin\.formyself\s*$/.test(l))
  if(line){
    adb(['forward','tcp:9362','localabstract:webview_devtools_remote_'+line.trim().split(/\s+/)[1]])
    try{const targets=await fetch('http://127.0.0.1:9362/json',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());if(targets.some(t=>t.type==='page')){c=await connect();break}}catch{}
  }
  await pause(200)
}
await c.until(`!!${store('settings')}?.isDataLoaded`)
const result=await c.evaluate(`({appearance:performance.getEntriesByName('app:appearance-ready')[0]?.startTime,paint:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lock:performance.getEntriesByName('app:lock-ready')[0]?.startTime,custom:document.querySelector('.app-wrapper').classList.contains('has-custom-bg'),transparency:${store('settings')}.componentTransparency})`)
assert.equal(result.custom,true);assert.equal(result.transparency,40);assert.ok(result.appearance<=result.paint)
fs.writeFileSync(new URL('native-cold-start-timing.json',import.meta.url),JSON.stringify(result,null,2));console.log(result)
await c.evaluate(uiSet('.lock-screen input',password));await c.evaluate(`document.querySelector('.lock-btn').click()`);await c.until(`!${store('auth')}.isLocked`)
c.close()
