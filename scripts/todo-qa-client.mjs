import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
export const serial=process.env.TODO_QA_SERIAL || 'emulator-5554'
export const user=process.env.TODO_QA_USER || '10'
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const adb=`${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`
export const run=args=>{try{return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:64*1024*1024}).trim()}catch{throw new Error('ADB operation failed; private details suppressed')}}
export const screenshot=name=>writeFileSync(`docs/qa/todo/${name}.png`,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:64*1024*1024}))
export const store=name=>`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`
export async function connect() {
  let page
  for(let n=0;n<60;n++) {
    try { page=(await fetch(`http://127.0.0.1:${process.env.TODO_QA_CDP_PORT || '9222'}/json`).then(r=>r.json())).find(p=>p.type==='page');if(page)break }catch{}
    await pause(250)
  }
  if(!page)throw new Error('QA page unavailable')
  const socket=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let sequence=0;const pending=new Map()
  socket.onmessage=event=>{
    const m=JSON.parse(event.data),entry=pending.get(m.id);if(!entry)return
    pending.delete(m.id);clearTimeout(entry.timer)
    if(m.error || m.result?.exceptionDetails)entry.reject(new Error(`CDP request ${m.id} failed; private details suppressed`))
    else entry.resolve(m.result)
  }
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout'))},30000)
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
  })
  const evaluate=async expression=>{try{return (await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value}catch(e){throw new Error(e.message)}}
  const until=async expression=>{for(let n=0;n<120;n++){if(await evaluate(expression))return;await pause(200)}throw new Error('QA condition not reached')}
  return { send,evaluate,until,close:()=>socket.close() }
}
