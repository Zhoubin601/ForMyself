import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import CryptoJS from 'crypto-js'
import { readTodoBackup } from '../src/features/todo/todoCore.js'
const adb=`${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`
const user=process.env.TODO_QA_USER || '10'
const serial=process.env.TODO_QA_SERIAL || 'emulator-5554'
const stage=process.argv[2] || 'v3'
const run=args=>{try{return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim()}catch{throw new Error('ADB failed; private output suppressed')}}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const page=(await fetch(`http://127.0.0.1:${process.env.TODO_QA_CDP_PORT || '9222'}/json`).then(r=>r.json())).find(p=>p.type==='page')
const ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
let seq=0;const pending=new Map()
ws.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error||m.result?.exceptionDetails)p.reject(new Error(`Evaluation ${m.id} failed; private details suppressed`));else p.resolve(m.result)}
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(new Error('CDP timeout')),30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})
const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value
const until=async expression=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause(200)}throw new Error('QA condition not reached')}
const store=n=>`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${n}')`
const report={stage,checks:[],animations:[]}
const clean=d=>({...d,revision:0})
try {
  await evaluate(`window.__todoV3Store=${store('todo')}`)
  await evaluate(`${store('settings')}.switchView('todo')`)
  await until(`!!document.querySelector('.todo-fill')`)
  const original=await evaluate(`JSON.parse(JSON.stringify(window.__todoV3Store.snapshot))`)
  const item=await evaluate(`window.__todoV3Store.todayItems.find(i=>!i.completed)`)
  for(const complete of [true,false]) {
    const frames=await evaluate(`(async()=>{const el=document.querySelector('.todo-fill'),frames=[],start=performance.now();let sampling=true;const frame=()=>{frames.push({ms:performance.now()-start,width:el.getBoundingClientRect().width});if(sampling)requestAnimationFrame(frame)};frame();await window.__todoV3Store.complete(${JSON.stringify(item.id)},${JSON.stringify(item.date)},${complete});await new Promise(r=>setTimeout(r,650));sampling=false;return frames})()`)
    const widths=frames.map(f=>f.width),low=Math.min(...widths),high=Math.max(...widths)
    assert.ok(high-low>1 && widths.some(w=>w>low+.3 && w<high-.3),'continuous intermediate app frames')
    assert.ok(complete?widths.at(-1)>widths[0]:widths.at(-1)<widths[0],'forward or reverse direction')
    report.animations.push({direction:complete?'forward':'reverse',frames})
  }
  const quickItems=await evaluate(`window.__todoV3Store.todayItems.filter(i=>!i.completed).slice(0,3)`)
  await evaluate(`Promise.all(${JSON.stringify(quickItems)}.map(i=>window.__todoV3Store.complete(i.id,i.date,true)))`)
  await pause(650)
  const actual=await evaluate(`({ratio:window.__todoV3Store.progress.ratio,width:document.querySelector('.todo-fill').getBoundingClientRect().width,total:document.querySelector('.todo-progress-card').clientWidth})`)
  assert.ok(Math.abs(actual.width/actual.total-actual.ratio)<.01)
  await evaluate(`Promise.all(${JSON.stringify(quickItems)}.map(i=>window.__todoV3Store.complete(i.id,i.date,false)))`)
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  assert.ok(parseFloat(await evaluate(`getComputedStyle(document.querySelector('.todo-fill')).transitionDuration`))<=.001)
  await send('Emulation.setEmulatedMedia',{features:[]})
  report.checks.push('app has continuous forward and reverse frames','rapid completions settle to latest ratio','app respects reduced motion')
  await evaluate(`${store('settings')}.openGeneralSettingsSection('data')`)
  await until(`!!document.querySelector('.store-utility-card')`)
  await evaluate(`(()=>{const find=v=>{if(!v)return null;if(v.component?.type?.__name==='SettingsBackup')return v.component.props.model;let r=find(v.component?.subTree);if(r)return r;for(const c of Array.isArray(v.children)?v.children:[]){r=find(c);if(r)return r}return null};window.__todoQaBackup=find(document.querySelector('#app')._vnode.component.subTree)})()`)
  // Inject one settings write failure and verify the full-backup rollback preserves Todo history.
  const rollback=await evaluate(`(async()=>{const m=window.__todoQaBackup,before=JSON.stringify({...window.__todoV3Store.snapshot,revision:0}),snapshot=m.createFullBackupSnapshot();snapshot.data.todos.tasks=[];snapshot.data.todos.completions=[];snapshot.data.todos.overrides=[];const original=m.settingsStore.restoreBackupSnapshot;let once=true;m.settingsStore.restoreBackupSnapshot=(...args)=>{if(once){once=false;return Promise.reject(new Error('QA injected write failure'))}return original(...args)};let failed=false;try{await m.restoreFullBackup(snapshot)}catch{failed=true}finally{m.settingsStore.restoreBackupSnapshot=original}return failed && JSON.stringify({...window.__todoV3Store.snapshot,revision:0})===before})()`)
  assert.ok(rollback);report.checks.push('full backup injected failure rolls back todo history')
  await evaluate(`window.__todoQaBackup.exportDataType='todos'`)
  // Exercise actual native file export, not just an in-memory envelope.
  await evaluate(`void window.__todoQaBackup.exportJSON()`)
  await pause(900)
  const filename=`ForMyself_Todos_Backup_${new Date().toISOString().slice(0,10)}.json`
  const encrypted=run(['shell','run-as','com.yubin.formyself','--user',user,'cat',`cache/${filename}`])
  const credentialFile=readdirSync('raw').find(n=>/密码\d+.*\.json$/.test(n))
  const password=credentialFile.match(/密码(\d+)/)[1]
  // Verify credentials without persisting or printing them.
  assert.ok(readFileSync(`raw/${credentialFile}`,'utf8').length)
  const exported=readTodoBackup(JSON.parse(CryptoJS.AES.decrypt(encrypted,password).toString(CryptoJS.enc.Utf8)))
  assert.deepEqual(clean(exported),clean(original))
  run(['shell','input','keyevent','4']);await pause(500)
  report.checks.push('native encrypted single-todo export preserves versions, overrides and completion keys')
  // Remove one synthetic task through the repository, then restore using the real FileReader path.
  await evaluate(`window.__todoV3Store.restore({...window.__todoV3Store.snapshot,tasks:window.__todoV3Store.snapshot.tasks.filter(t=>t.id!==${JSON.stringify(quickItems.at(-1).id)}),overrides:window.__todoV3Store.snapshot.overrides.filter(o=>o.taskId!==${JSON.stringify(quickItems.at(-1).id)}),completions:window.__todoV3Store.snapshot.completions.filter(c=>c.taskId!==${JSON.stringify(quickItems.at(-1).id)})})`)
  const importedBefore=await evaluate(`window.__todoV3Store.snapshot.tasks.length`)
  await evaluate(`window.__todoQaBackup.handleFileUpload({target:{files:[new File([${JSON.stringify(encrypted)}],'todo.json',{type:'application/json'})],value:'qa'}})`)
  await until(`document.querySelector('.feedback-confirm')?.textContent.trim()==='覆盖并恢复'`)
  assert.equal(await evaluate(`window.__todoV3Store.snapshot.tasks.length`),importedBefore)
  await evaluate(`document.querySelector('.feedback-confirm').click()`)
  await until(`window.__todoV3Store.snapshot.tasks.length===${original.tasks.length}`)
  assert.deepEqual(clean(await evaluate(`JSON.parse(JSON.stringify(window.__todoV3Store.snapshot))`)),clean(original))
  report.checks.push('confirmed encrypted single-todo restore preserves exact history')
  const corrupt=CryptoJS.AES.encrypt(JSON.stringify({type:'formyself-todo-backup',version:1}),password).toString()
  await evaluate(`window.__todoQaBackup.handleFileUpload({target:{files:[new File([${JSON.stringify(corrupt)}],'bad.json')],value:'qa'}})`)
  await until(`document.querySelector('.feedback-message')?.textContent.includes('原待办保留')`)
  assert.deepEqual(clean(await evaluate(`JSON.parse(JSON.stringify(window.__todoV3Store.snapshot))`)),clean(original))
  await evaluate(`document.querySelector('.feedback-confirm').click()`)
  report.checks.push('malformed single-todo backup rejected without clearing data')
  await evaluate(`${store('settings')}.switchView('todo')`)
  writeFileSync(`Test_data/todo-${stage}-experience.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify({stage:report.stage,checks:report.checks,animationFrames:report.animations.map(a=>a.frames.length)}))
} finally {await send('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});ws.close()}
