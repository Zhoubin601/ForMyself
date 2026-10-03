import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let page
for(let i=0;i<60;i++){try{page=(await fetch('http://127.0.0.1:9222/json').then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}await pause(250)}
const ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
let seq=0;const pending=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error||m.result?.exceptionDetails)p.reject(new Error('Private QA evaluation details suppressed'));else p.resolve(m.result.result.value)}
const evaluate=expression=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))})
const store=n=>`document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('${n}')`
const until=async expr=>{for(let i=0;i<120;i++){if(await evaluate(expr))return;await pause(250)}throw new Error('Deep-link QA condition not reached')}
try {
  await until(`${store('todo')}?.isDataLoaded && ${store('auth')}?.isDataLoaded`)
  assert.ok(await evaluate(`${store('auth')}.isLocked`),'desktop text respects app lock')
  const file=readdirSync('raw').find(n=>/密码\d+.*\.json$/.test(n)),password=file.match(/密码(\d+)/)[1]
  await evaluate(`(()=>{const input=document.querySelector('.lock-input-shell input');input.value=${JSON.stringify(password)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.lock-btn').click()})()`)
  await until(`!${store('auth')}.isLocked && !!document.querySelector('.todo-page .targeted')`)
  const result=await evaluate(`(()=>{const s=${store('settings')},row=document.querySelector('.todo-page .targeted'),rect=row.getBoundingClientRect();return {view:s.currentView,taskMatches:row.dataset.taskId===s.todoTarget.item,title:row.querySelector('strong').textContent,visible:rect.top>=0 && rect.bottom<=window.innerHeight,focused:row.contains(document.activeElement)}})()`)
  assert.equal(result.view,'todo');assert.equal(result.title,'QA 待办 30');assert.ok(result.taskMatches && result.visible && result.focused)
  writeFileSync('Test_data/todo-v3-deeplink.json',JSON.stringify({checks:['real desktop text click launches app','unlock required','matching task date and ID','target task scrolled into view and focused']},null,2))
  console.log('Desktop title → app unlock → exact task visible and focused: passed')
} finally {ws.close()}
