import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import CryptoJS from 'crypto-js'
import { normalizeFullBackupSnapshot } from '../src/services/fullBackup.js'
import { addDays, formatLocalDate } from '../src/features/todo/todoCore.js'

// Credentials and decrypted user data exist only in memory; never print CDP expressions.
const stage = process.argv[2] || 'v1'
const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`
const user = process.env.TODO_QA_USER || '10'
const serial = process.env.TODO_QA_SERIAL || 'emulator-5554'
const port = process.env.TODO_QA_CDP_PORT || '9222'
const pause = ms => new Promise(resolve => setTimeout(resolve,ms))
let targets=[]
for(let n=0;n<60;n++) {
  try { targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());if(targets.some(p=>p.type==='page'))break } catch {}
  await pause(250)
}
const page = targets.find(p=>p.type==='page')
assert.ok(page)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
let sequence=0
const pending=new Map()
socket.onmessage = event => {
  const message=JSON.parse(event.data)
  const entry=pending.get(message.id)
  if (!entry) return
  pending.delete(message.id); clearTimeout(entry.timer)
  if (message.error || message.result?.exceptionDetails) entry.reject(new Error(`QA evaluation failed at request ${message.id}: ${message.result?.exceptionDetails?.exception?.className || 'error'}; private details suppressed`))
  else entry.resolve(message.result)
}
const send = (method,params={}) => new Promise((resolve,reject)=>{
  const id=++sequence
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('QA timeout'))},30000)
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
})
const evaluate = async expression => {
  try { return (await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value }
  catch (error) { throw new Error(error.message) } // Preserve the caller line, never the private expression.
}
const until = async expression => { for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause(250)} throw new Error('QA condition not reached') }
const store = name => `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`
const today = formatLocalDate()
const yesterday=addDays(today,-1)
const report={stage,checks:[]}
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)}
try {
  await until(`!!document.querySelector('#app')?.__vue_app__`)
  await until(`${store('settings')}?.isDataLoaded && ${store('todo')}?.isDataLoaded`)
  const file=readdirSync('raw').find(n=>n.endsWith('.json') && /密码\d+/.test(n))
  const password=file.match(/密码(\d+)/)[1]
  await evaluate(`${store('auth')}.lockApp()`)
  await evaluate(`(()=>{const input=document.querySelector('.lock-input-shell input');input.value=${JSON.stringify(password)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.lock-btn').click()})()`)
  await until(`!${store('auth')}.isLocked`)
  report.checks.push('unlock through actual app UI')
  await until(`${store('passwordVault')}?.isDataLoaded && ${store('chat')}?.isDataLoaded`)
  await evaluate(`${store('settings')}.openGeneralSettingsSection('data')`)
  await until(`!!document.querySelector('.store-utility-card')`)
  await evaluate(`(()=>{const find=v=>{if(!v)return null;if(v.component?.type?.__name==='SettingsBackup')return v.component.props.model;let r=find(v.component?.subTree);if(r)return r;for(const c of Array.isArray(v.children)?v.children:[]){r=find(c);if(r)return r;}return null;};window.__todoQaBackup=find(document.querySelector('#app')._vnode.component.subTree);return !!window.__todoQaBackup})()`)
  check('backup interface available',await evaluate('!!window.__todoQaBackup'))
  if(stage==='v1' || process.argv.includes('--restore')) {
    const encrypted=readFileSync(`raw/${file}`,'utf8').trim()
    const source=JSON.parse(CryptoJS.AES.decrypt(encrypted,password).toString(CryptoJS.enc.Utf8))
    const snapshot=normalizeFullBackupSnapshot(source)
    snapshot.settings.ai.key=''
    snapshot.settings.notificationSettings={}
    snapshot.data.chat.proactiveSettings.enabled=false
    snapshot.data.chat.realismSettings={...snapshot.data.chat.realismSettings,proactiveEnabled:false}
    const expected={savings:snapshot.data.savings.length,weight:snapshot.data.weight.length,mood:snapshot.data.mood.length,passwords:snapshot.data.passwords.length,schedules:snapshot.data.schedules.series.length,chat:snapshot.data.chat.messages.length}
    await evaluate(`window.__todoQaBackup.restoreFullBackup(${JSON.stringify(snapshot)})`)
    const actual=await evaluate(`({savings:${store('debt')}.savedDebts.length,weight:${store('weight')}.weightRecords.length,mood:${store('mood')}.moodRecords.length,passwords:${store('passwordVault')}.records.length,schedules:${store('schedule')}.series.length,chat:${store('chat')}.messages.length})`)
    assert.deepEqual(actual,expected);report.checks.push('provided encrypted backup restored with matching module counts')
    await evaluate(`${store('settings')}.updateThemeSettings({mode:'preset',presetId:'mint'})`)
    await evaluate(`${store('settings')}.aiApiKey='';${store('settings')}.autoLockDelaySeconds=0`)
    await evaluate(`${store('todo')}.add({title:'QA 每天喝水',startDate:${JSON.stringify(yesterday)},recurrence:{type:'daily'}})`)
    const id=await evaluate(`${store('todo')}.snapshot.tasks.find(t=>t.title==='QA 每天喝水').id`)
    await evaluate(`${store('todo')}.complete(${JSON.stringify(id)},${JSON.stringify(yesterday)},true)`)
    await evaluate(`${store('todo')}.edit(${JSON.stringify(id)},${JSON.stringify(today)},{title:'QA 每天喝咖啡'},'future')`)
    check('history key and old title preserved',await evaluate(`${store('todo')}.snapshot.completions.some(c=>c.taskId===${JSON.stringify(id)} && c.date===${JSON.stringify(yesterday)}) && ${store('todo')}.snapshot.tasks.find(t=>t.id===${JSON.stringify(id)}).title==='QA 每天喝水'`))
    check('parentTaskId version split persisted',await evaluate(`${store('todo')}.snapshot.tasks.some(t=>t.parentTaskId===${JSON.stringify(id)} && t.title==='QA 每天喝咖啡')`))
    const newId=await evaluate(`${store('todo')}.snapshot.tasks.find(t=>t.parentTaskId===${JSON.stringify(id)}).id`)
    await evaluate(`${store('todo')}.complete(${JSON.stringify(newId)},${JSON.stringify(today)},true)`)
    await evaluate(`${store('todo')}.edit(${JSON.stringify(newId)},${JSON.stringify(today)},{title:'QA 今天喝温咖啡'},'single')`)
    check('single edit keeps completion',await evaluate(`${store('todo')}.todayItems[0].completed`))
    await evaluate(`${store('todo')}.complete(${JSON.stringify(newId)},${JSON.stringify(today)},false)`)
    check('undo keeps single override',await evaluate(`${store('todo')}.todayItems[0].title==='QA 今天喝温咖啡'`))
    check('completed range protected',await evaluate(`(async()=>{await ${store('todo')}.complete(${JSON.stringify(newId)},${JSON.stringify(today)},true);try{await ${store('todo')}.edit(${JSON.stringify(newId)},${JSON.stringify(today)},{title:'bad'},'future');return false}catch(e){return e.code==='TODO_HISTORY_PROTECTED'}})()`))
    await evaluate(`${store('todo')}.complete(${JSON.stringify(newId)},${JSON.stringify(today)},false)`)
    await evaluate(`window.__qaFull=window.__todoQaBackup.createFullBackupSnapshot();`)
    await evaluate(`window.__todoQaBackup.restoreFullBackup(window.__qaFull)`)
    check('v10 full backup roundtrip',await evaluate(`window.__qaFull.version===10 && ${store('todo')}.snapshot.tasks.length===2`))
    await evaluate(`window.__qaOld={...window.__qaFull,version:9,data:{...window.__qaFull.data}};delete window.__qaOld.data.todos;`)
    await evaluate(`window.__todoQaBackup.restoreFullBackup(window.__qaOld)`)
    check('old backup missing todo preserves local tasks',await evaluate(`${store('todo')}.snapshot.tasks.length===2`))
    const rows=Array.from({length:30},(_,i)=>({title:`QA 待办 ${String(i+1).padStart(2,'0')}`,startDate:today,recurrence:{type:i%3===0?'daily':i%3===1?'weekly':'custom',weekdays:[new Date().getDay()],intervalDays:3}}))
    await evaluate(`(async()=>{for(const task of ${JSON.stringify(rows)})await ${store('todo')}.add(task)})()`)
    report.checks.push('30 recurring tasks persisted')
  } else {
    check('previous stage todo data remains',await evaluate(`${store('todo')}.snapshot.tasks.length>=32`))
  }
  await evaluate(`${store('settings')}.switchView('todo')`)
  await until(`!!document.querySelector('.todo-checkbox')`)
  const baseline=await evaluate(`${store('todo')}.progress.done`)
  await evaluate(`window.__todoQaCheckboxIndex=Array.from(document.querySelectorAll('.todo-checkbox')).findIndex(e=>e.getAttribute('aria-pressed')==='false');document.querySelectorAll('.todo-checkbox')[window.__todoQaCheckboxIndex].click()`)
  await until(`${store('todo')}.progress.done===${baseline+1}`)
  check('actual task checkbox completes',await evaluate(`document.querySelectorAll('.todo-checkbox')[window.__todoQaCheckboxIndex].getAttribute('aria-pressed')==='true'`))
  await evaluate(`document.querySelectorAll('.todo-checkbox')[window.__todoQaCheckboxIndex].click()`)
  await until(`${store('todo')}.progress.done===${baseline}`)
  check('actual task checkbox undoes completion',true)
  check('mobile content has no horizontal overflow',await evaluate(`document.documentElement.scrollWidth<=window.innerWidth && document.querySelector('.todo-page').scrollWidth<=document.querySelector('.todo-page').clientWidth`))
  const folder='docs/qa/todo';mkdirSync(folder,{recursive:true})
  writeFileSync(`${folder}/${stage}-todo.png`,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:32*1024*1024}))
  await evaluate(`${store('todo')}.flush()`)
  report.todoCount=await evaluate(`${store('todo')}.snapshot.tasks.length`)
  report.user = user
  writeFileSync(`Test_data/todo-${stage}-emulator.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
} finally { socket.close() }
