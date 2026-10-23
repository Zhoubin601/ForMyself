import { writeFile } from 'node:fs/promises'
import { connect, pause, store, uiSet, uiClick } from './cdp.mjs'
const c=await connect(), results=[]
const click=async selector=>{await c.evaluate(uiClick(selector));await pause(180)}
const set=async(selector,value)=>{await c.evaluate(uiSet(selector,value));await pause(70)}
const textClick=async(text,scope='body')=>{
  await c.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.querySelector('strong')?.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing button '+${JSON.stringify(text)});e.click()})()`);await pause(180)
}
const view=async name=>{await c.evaluate(`${store('settings')}.switchView('${name}')`);await pause(450)}
const check=async(name,expression)=>{const actual=await c.evaluate(expression);results.push({name,actual});console.log(name,JSON.stringify(actual))}
const dismiss=async()=>{if(await c.evaluate(`Boolean(document.querySelector('.feedback-card .feedback-confirm'))`))await click('.feedback-card .feedback-confirm');await pause(250)}
try {
  await c.evaluate(`import('/src/services/uiFeedback.js').then(m=>m.resolveFeedbackDialog(null))`)
  await pause(300)
  await dismiss()
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  if (!process.argv.includes('--continue')) {
  await view('weight');await click('.weight-hero button')
  await set('.modal-panel input[type=number]',19);await textClick('保存','.modal-panel')
  await check('weight-invalid-rejected',`Boolean(document.querySelector('.feedback-card'))&&${store('weight')}.weightRecords.length===0`);await dismiss()
  await set('.modal-panel input[type=number]',60.1);await textClick('保存','.modal-panel')
  await check('weight-add',`${store('weight')}.weightRecords.length===1&&${store('weight')}.weightRecords[0].weight===60.1`)
  await textClick('编辑','.weight-container');await set('.modal-panel input[type=number]',61.2);await textClick('保存','.modal-panel')
  await check('weight-edit',`${store('weight')}.weightRecords[0].weight===61.2`)
  await click('.weight-hero button');await c.evaluate(`document.querySelector('.weight-hero button').focus()`)
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await check('weight-dialog-focus',`({dialogRole:document.querySelector('.modal-panel').getAttribute('role'),focusInDialog:Boolean(document.activeElement.closest('.modal-panel')),activeClass:document.activeElement.className})`)
  await textClick('取消','.modal-panel')

  await view('debts');await textClick('＋ 新建计划')
  await set('.apple-modal-card input[placeholder="例如：换新电脑"]','QA 合成目标');await set('.apple-modal-card input[type=number]',1000);await textClick('确立计划','.apple-modal-card')
  await check('savings-add',`${store('debt')}.savedDebts.some(d=>d.name==='QA 合成目标')`)
  await textClick('存入','.savings-card');await set('.apple-modal-card input[type=number]',200);await textClick('确认存入','.apple-modal-card')
  await check('savings-deposit',`${store('debt')}.savedDebts.find(d=>d.name==='QA 合成目标').records[0].amount===200`)
  await textClick('存入','.savings-card');await set('.apple-modal-card input[type=number]',-25);await textClick('确认存入','.apple-modal-card')
  await check('savings-negative-deposit-rejected',`!${store('debt')}.savedDebts.find(d=>d.name==='QA 合成目标').records.some(r=>r.amount<0)`)
  await dismiss()
  await textClick('＋ 新建计划');await set('.apple-modal-card input[placeholder="例如：换新电脑"]','QA 非法金额目标');await set('.apple-modal-card input[type=number]',-100);await textClick('确立计划','.apple-modal-card')
  await check('savings-negative-target-rejected',`!${store('debt')}.savedDebts.some(d=>d.totalAmount<0)`);await dismiss()
  if(await c.evaluate(`Boolean(document.querySelector('.apple-modal-card'))`))await textClick('取消','.apple-modal-card')

  await view('mood');await click('.mood-add-btn');await click('.mood-option:nth-child(2)')
  await set('.modal-panel textarea','QA 合成心情事件');await textClick('保存','.modal-panel');await pause(200)
  await check('mood-add',`${store('mood')}.moodRecords.some(r=>r.note==='QA 合成心情事件')`)
  }

  await view('todo');await click('.todo-add');await set('#todo-title','QA 每日测试');await click('.todo-recurrence-picker');await textClick('每天','.feedback-card');await textClick('保存','.todo-editor')
  await check('todo-daily-add',`${store('todo')}.snapshot.tasks.some(t=>t.title==='QA 每日测试'&&t.recurrence.type==='daily')`)
  await click('.todo-checkbox');await check('todo-complete',`${store('todo')}.progress.done===1`)
  await click('.todo-task-title');await c.evaluate(`(()=>{const buttons=[...document.querySelectorAll('.feedback-card button')];buttons.find(b=>b.textContent.includes('仅本次')).click()})()`);await pause(180)
  await set('#todo-title','QA 仅本次修改');await textClick('保存','.todo-editor')
  await check('todo-single-edit-preserves-completion',`${store('todo')}.todayItems[0].title==='QA 仅本次修改'&&${store('todo')}.todayItems[0].completed`)
  await click('.todo-checkbox');await check('todo-undo',`${store('todo')}.progress.done===0`)
  await c.screenshot('390-todo-filled.png')

  await view('schedule');await click('.floating-add');await set('.schedule-editor .title-input','QA 合成日程');await textClick('完成','.schedule-editor');await pause(250);await dismiss()
  await check('schedule-add',`${store('schedule')}.snapshot.series.some(s=>s.title==='QA 合成日程')`)

  await view('passwords');await textClick('添加第一条记录');await set('.vault-form input[placeholder="例如：微信、GitHub"]','QA 合成账户');await set('.vault-form input[placeholder="手机号、邮箱或用户名"]','synthetic@example.invalid')
  await c.evaluate(`(()=>{const e=document.querySelector('.vault-form input[type=password]');e.value=crypto.randomUUID();e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await textClick('保存记录','.vault-editor')
  await check('vault-add-masked',`${store('passwordVault')}.records.length===1&&!document.querySelector('.secret-value').textContent.includes(${store('passwordVault')}.records[0].password)`)

  await view('settings');await c.evaluate(`${store('settings')}.openGeneralSettingsSection('data')`);await pause(400)
  await c.evaluate(`(()=>{window.__qaObjectUrl=URL.createObjectURL;URL.createObjectURL=function(blob){window.__qaBackup=blob;return window.__qaObjectUrl.call(this,blob)};window.__qaAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return window.__qaAnchorClick.call(this)}})()`)
  await textClick('导出完整数据加密备份 (.json)');await pause(600)
  await check('full-backup-v10',`(async()=>{const {default:C}=await import('/node_modules/.vite/deps/crypto-js.js');window.__qaSnapshot=JSON.parse(C.AES.decrypt(await window.__qaBackup.text(),${store('auth')}.savedMasterPwd).toString(C.enc.Utf8));return {version:window.__qaSnapshot.version,weight:window.__qaSnapshot.data.weight.length,vault:window.__qaSnapshot.data.passwords.length,todo:window.__qaSnapshot.data.todos.tasks.length}})()`)
  await c.evaluate(`${store('weight')}.updateWeightRecords([])`)
  await c.evaluate(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([await window.__qaBackup.text()],'qa.json',{type:'application/json'}));const e=document.querySelector('input[type=file]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(300)
  await textClick('覆盖并恢复','.feedback-card');await pause(800);await dismiss()
  await check('full-backup-restore',`${store('weight')}.weightRecords.length===1&&${store('passwordVault')}.records.length===1&&${store('todo')}.snapshot.tasks.length===1`)
  await c.evaluate(`URL.createObjectURL=window.__qaObjectUrl;HTMLAnchorElement.prototype.click=window.__qaAnchorClick;delete window.__qaSnapshot;delete window.__qaBackup`)
  await c.evaluate(`window.__qaPwd=${store('auth')}.savedMasterPwd;${store('auth')}.lockApp()`);await pause(200)
  await check('lock-hides-records',`Boolean(document.querySelector('.lock-screen'))&&!document.querySelector('.vault-list')`)
  await check('lock-memory-cleared',`${store('passwordVault')}.records.length===0&&${store('chat')}.snapshot.messages.length===0`)
  await c.evaluate(`(()=>{const e=document.querySelector('.lock-screen input');e.value=window.__qaPwd;e.dispatchEvent(new Event('input',{bubbles:true}));delete window.__qaPwd})()`);await click('.lock-btn');await pause(900)
  await check('password-reunlock',`!${store('auth')}.isLocked`)
}catch(e){results.push({name:'harness-failure',error:e.stack});process.exitCode=1}
finally{await writeFile(new URL(process.argv.includes('--continue')?'browser-flows-continuation.json':'browser-flows.json',import.meta.url),JSON.stringify(results,null,2));c.close()}
