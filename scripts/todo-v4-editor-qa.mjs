import assert from 'node:assert/strict'
import { readFileSync,readdirSync,writeFileSync } from 'node:fs'
import { connect,store,pause,run,screenshot,user } from './todo-qa-client.mjs'
const stage=process.argv[2] || 'v4-api37'
const {evaluate,until,close}=await connect()
const report={stage,checks:[]}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
const choose=async label=>{await until(`!!document.querySelector('.feedback-option')`);await evaluate(`Array.from(document.querySelectorAll('.feedback-option')).find(e=>e.querySelector('strong').textContent===${JSON.stringify(label)}).click()`)}
try {
  const filename=readdirSync('raw').find(n=>/密码\d+.*\.json$/.test(n)), password=filename.match(/密码(\d+)/)[1]
  assert.ok(readFileSync(`raw/${filename}`,'utf8').length)
  await until(`${store('todo')}?.isDataLoaded`)
  if(await evaluate(`${store('auth')}.isLocked`)) {
    await fill('.lock-input-shell input',password);await click('.lock-btn');await until(`!${store('auth')}.isLocked`)
  }
  await evaluate(`${store('settings')}.switchView('todo')`)
  await until(`!!document.querySelector('.todo-add')`)
  if(await evaluate(`!!document.querySelector('.todo-editor')`)) await click('.todo-editor header button')
  await evaluate(`(()=>{const s=${store('todo')},ids=new Set(s.snapshot.tasks.filter(t=>t.title.startsWith('QA v4 表单 ')).map(t=>t.id));return s.restore({...s.snapshot,tasks:s.snapshot.tasks.filter(t=>!ids.has(t.id)),overrides:s.snapshot.overrides.filter(o=>!ids.has(o.taskId)),completions:s.snapshot.completions.filter(c=>!ids.has(c.taskId))})})()`)
  for(const [type,label] of [['none','仅一天'],['daily','每天'],['weekly','每周'],['custom','每隔几天']]) {
    await click('.todo-add');await until(`!!document.querySelector('#todo-title')`)
    assert.equal(await evaluate(`!!document.querySelector('.todo-editor textarea')`),false)
    await fill('#todo-title',`QA v4 表单 ${type}`)
    await click('.todo-recurrence-picker');await choose(label)
    if(type==='weekly') {
      await evaluate(`document.querySelector('.todo-editor button[type="submit"]').click()`)
      await until(`document.querySelector('.todo-error')?.textContent.includes('至少一个星期')`)
      for(const day of [1,3,5]) await evaluate(`document.querySelectorAll('.todo-weekdays button')[${day}].click()`)
      assert.ok(await evaluate(`document.querySelector('.todo-recurrence-picker').textContent.includes('每周一、三、五')`))
    }
    if(type==='custom') { await fill('input[aria-label="间隔天数"]',3);assert.ok(await evaluate(`document.querySelector('.todo-recurrence-picker').textContent.includes('每隔 3 天')`)) }
    const note=type==='custom'?'QA 长备注，核对安排。'.repeat(80):`QA 备注 ${type}`
    await click('.todo-note-toggle');await fill('.todo-note-body textarea',note)
    if(type==='custom') {
      await evaluate(`Array.from(document.querySelectorAll('.todo-field-row')).find(e=>e.textContent.includes('设置结束日期')).querySelector('input').click()`)
      await until(`!!document.querySelector('.todo-editor [aria-label="结束日期"]')`)
      const size=await evaluate(`(()=>{const e=document.querySelector('.todo-editor'),note=e.querySelector('textarea');return {height:e.getBoundingClientRect().height,max:visualViewport.height*.88,scroll:note.scrollHeight,client:note.clientHeight}})()`)
      assert.ok(size.height<=size.max+2 && size.scroll>size.client,'long note and expanded end date must scroll within height limit')
    }
    await click('.todo-note-toggle')
    if(type==='daily') {
      await click('.todo-editor .app-time-field');await until(`!!document.querySelector('.clock-dial')`)
      await evaluate(`Array.from(document.querySelectorAll('.dial-number.outer')).find(e=>e.textContent.trim()==='9').click()`)
      await evaluate(`Array.from(document.querySelectorAll('.minute-number')).find(e=>e.textContent.trim()==='30').click()`)
      await click('.time-picker-sheet .confirm-button');await until(`!document.querySelector('.time-picker-sheet')`)
      await evaluate(`document.querySelector('.todo-switch').click()`)
      await click('.todo-clear-time');await until(`!document.querySelector('.todo-clear-time')`)
      assert.equal(await evaluate(`document.querySelector('.todo-editor').textContent.includes('到时间通知我')`),false)
    }
    if(type==='none') {
      // Actual Android IME, not a DevTools viewport emulation.
      run(['shell','settings','--user',user,'put','secure','show_ime_with_hard_keyboard','1'])
      await evaluate(`document.activeElement?.blur()`)
      await pause(600)
      const box=await evaluate(`(()=>{const r=document.querySelector('#todo-title').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,dpr:devicePixelRatio}})()`)
      const nativeBox=await evaluate(`window.Capacitor.Plugins.Todo.viewport()`)
      run(['shell','input','tap',String(Math.round(box.x*box.dpr)+nativeBox.leftPx),String(Math.round(box.y*box.dpr)+nativeBox.topPx)])
      await until(`window.Capacitor.Plugins.Todo.viewport().then(v=>v.heightPx<${nativeBox.heightPx}-100)`)
      await pause(300)
      const nativeAfter=await evaluate(`window.Capacitor.Plugins.Todo.viewport()`)
      assert.ok(nativeAfter.heightPx < nativeBox.heightPx-100,'actual IME must reduce the native visible region')
      const geometry=await evaluate(`(()=>{const r=document.querySelector('.todo-editor').getBoundingClientRect(),b=document.querySelector('.todo-editor header button[type="submit"]').getBoundingClientRect(),v=visualViewport;return {editorHeight:r.height,viewportHeight:v.height,top:v.offsetTop,saveTop:b.top,saveBottom:b.bottom,width:document.documentElement.scrollWidth,available:innerWidth}})()`)
      geometry.visibleHeight=Math.min(geometry.viewportHeight,nativeAfter.heightPx/box.dpr)
      assert.ok(geometry.editorHeight<=geometry.visibleHeight*.88+2)
      assert.ok(geometry.saveTop>=geometry.top && geometry.saveBottom<=geometry.top+geometry.visibleHeight)
      assert.ok(geometry.width<=geometry.available)
      screenshot(`${stage}-editor-keyboard`)
      report.keyboard={...geometry,nativeVisibleHeightPx:nativeAfter.heightPx}
      run(['shell','input','keyevent','4']);await pause(300)
    }
    screenshot(`${stage}-editor-${type}`)
    await click('.todo-editor button[type="submit"]');await until(`!document.querySelector('.todo-editor')`)
    const saved=await evaluate(`JSON.parse(JSON.stringify(${store('todo')}.snapshot.tasks.find(t=>t.title===${JSON.stringify(`QA v4 表单 ${type}`)})))`)
    assert.equal(saved.recurrence.type,type);assert.equal(saved.note,note)
    if(type==='custom')assert.equal(saved.endsOn,saved.startDate)
    if(type==='daily'){assert.equal(saved.time,'');assert.equal(saved.reminder,false)}
    report.checks.push(`actual editor saves ${type} rule and collapsed note`)
  }
  await evaluate(`${store('settings')}.todoTarget={item:'',date:''}`)
  // Open a saved single occurrence through the actual task title.
  await evaluate(`document.querySelectorAll('.todo-tabs button')[1].click()`)
  await evaluate(`Array.from(document.querySelectorAll('.todo-plan')).find(e=>e.textContent.includes('QA v4 表单 none')).click()`)
  await until(`!!document.querySelector('.todo-editor textarea')`)
  assert.equal(await evaluate(`document.querySelector('.todo-editor textarea').value`),'QA 备注 none')
  assert.equal(await evaluate(`!!document.querySelector('.todo-recurrence-picker')`),false)
  screenshot(`${stage}-editor-reopen`)
  await click('.todo-editor header button');await until(`!document.querySelector('.todo-editor')`)
  report.checks.push('saved note expanded on reopen and single edit cannot change recurrence')
  await evaluate(`document.querySelectorAll('.todo-tabs button')[0].click()`)
  await evaluate(`(()=>{const row=Array.from(document.querySelectorAll('.todo-task-row')).find(e=>e.querySelector('strong').textContent==='QA v4 表单 daily');row.scrollIntoView({block:'center'});row.querySelector('.todo-checkbox').click()})()`)
  await until(`${store('todo')}.todayItems.some(i=>i.title==='QA v4 表单 daily' && i.completed)`)
  await evaluate(`Array.from(document.querySelectorAll('.todo-task-title')).find(e=>e.querySelector('strong').textContent==='QA v4 表单 daily').click()`)
  await choose('本次及以后');await until(`!!document.querySelector('#todo-title')`)
  await fill('#todo-title','QA v4 历史保护检查')
  await click('.todo-editor button[type="submit"]')
  await until(`document.querySelector('.todo-field-group [role="alert"]')?.textContent.includes('最早可从')`)
  assert.ok(await evaluate(`${store('todo')}.todayItems.some(i=>i.title==='QA v4 表单 daily' && i.completed)`))
  screenshot(`${stage}-editor-history-protection`)
  await click('.todo-editor header button');await until(`!document.querySelector('.todo-editor')`)
  report.checks.push('actual future edit protects completed date and shows earliest date beside effective date')
  writeFileSync(`Test_data/todo-${stage}-editor.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} finally {close()}
