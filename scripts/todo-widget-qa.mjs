import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const stage=process.argv[2] || 'v2'
const adb=`${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`
const user=process.env.TODO_QA_USER || '10'
const serial=process.env.TODO_QA_SERIAL || 'emulator-5554'
const run=args=>{try{return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim()}catch{throw new Error('ADB operation failed; command output suppressed')}}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const decode=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
const data=()=>{
  // This XML contains private data; only the synthetic todo subtree is used or returned.
  const xml=run(['shell','run-as','com.yubin.formyself','--user',user,'grep','my_todo_data_v1','shared_prefs/CapacitorStorage.xml'])
  return JSON.parse(decode(xml.match(/<string name="my_todo_data_v1">([\s\S]*?)<\/string>/)[1]))
}
const ui=()=>{
  run(['shell','uiautomator','dump','/sdcard/todo-widget-ui.xml'])
  const xml=run(['shell','cat','/sdcard/todo-widget-ui.xml'])
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(m=>{
    const attrs=Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],decode(a[2])]))
    const bounds=(attrs.bounds || '').match(/\d+/g)?.map(Number) || []
    return {...attrs,b:bounds,x:(bounds[0]+bounds[2])/2,y:(bounds[1]+bounds[3])/2}
  })
}
const nodes=(all,id)=>all.filter(n=>n['resource-id']===`com.yubin.formyself:id/${id}`)
const tap=n=>run(['shell','input','tap',String(Math.round(n.x)),String(Math.round(n.y))])
const count=all=>Number(nodes(all,'todo_widget_count')[0]?.text.match(/\d+/)[0] ?? nodes(all,'todo_widget_compact')[0].text.match(/\s(\d+)\//)[1])
const screenshot=name=>writeFileSync(`docs/qa/todo/${stage}-${name}.png`,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:32*1024*1024}))
const report={stage,checks:[]}
mkdirSync('docs/qa/todo',{recursive:true})
run(['shell','am','start','--user',user,'-a','android.intent.action.MAIN','-c','android.intent.category.HOME'])
await pause(400)
let all=ui()
const [screenWidth,screenHeight]=[...run(['shell','wm','size']).matchAll(/(\d+)x(\d+)/g)].at(-1).slice(1).map(Number)
const left=String(Math.round(screenWidth*.15)),right=String(Math.round(screenWidth*.87)),middle=String(Math.round(screenHeight*.5))
for(let i=0;i<4 && !nodes(all,'todo_widget_list').length;i++){run(['shell','input','swipe',right,middle,left,middle,'350']);await pause(250);all=ui()}
for(let i=0;i<4 && !nodes(all,'todo_widget_list').length;i++){run(['shell','input','swipe',left,middle,right,middle,'350']);await pause(250);all=ui()}
assert.ok(nodes(all,'todo_widget_list').length,'widget must be added before test')
const list=nodes(all,'todo_widget_list')[0]
const initial=nodes(all,'todo_row_title')[0].text
run(['shell','input','swipe',String(Math.round(list.x)),String(list.b[3]-40),String(Math.round(list.x)),String(list.b[1]+40),'500'])
await pause(400);all=ui()
assert.notEqual(nodes(all,'todo_row_title')[0].text,initial)
report.checks.push('native desktop list scrolls')
const currentRows=nodes(all,'todo_row_title')
const firstTitle=currentRows[0].text
const unchecked=nodes(all,'todo_row_check').find(n=>!n['content-desc']?.startsWith('撤销完成') && n.b[3]-n.b[1]>=Number(process.env.TODO_QA_MIN_HIT_PX || 80)) || nodes(all,'todo_row_check').at(-1)
const wasCompleted=unchecked['content-desc']?.startsWith('撤销完成') || Boolean(unchecked.text)
const row=currentRows.reduce((best,n)=>Math.abs(n.y-unchecked.y)<Math.abs(best.y-unchecked.y)?n:best,currentRows[0])
const oldCount=count(all), before=data()
run(['shell','am','kill','--user',user,'com.yubin.formyself'])
await pause(400)
let stopped=false
try { stopped=!run(['shell','pidof','com.yubin.formyself']) } catch { stopped=true }
if(!stopped) {
  // Legacy RemoteViews factories stay bound briefly after filling the scroll cache.
  await pause(6500)
  run(['shell','am','kill','--user',user,'com.yubin.formyself'])
  await pause(300)
  try { stopped=!run(['shell','pidof','com.yubin.formyself']) } catch { stopped=true }
}
assert.ok(stopped,'app process must be absent before desktop click')
tap(unchecked);await pause(900);all=ui()
const expected=wasCompleted ? oldCount-1 : oldCount+1
assert.equal(count(all),expected)
assert.equal(nodes(all,'todo_row_title')[0].text,firstTitle,'scroll must not jump to top')
assert.equal(data().completions.length,before.completions.length+(wasCompleted?-1:1))
assert.ok(run(['shell','dumpsys','window']).includes('nexuslauncher'),'completion must keep launcher foreground')
report.checks.push('desktop completion works with app process absent','native completion persisted','completion preserves scroll','completion does not launch app')
screenshot('desktop-completed')
const afterCheckbox=nodes(all,'todo_row_check').reduce((best,n)=>Math.abs(n.y-row.y)<Math.abs(best.y-row.y)?n:best,nodes(all,'todo_row_check')[0])
tap(afterCheckbox);await pause(800);all=ui()
assert.equal(count(all),oldCount)
assert.equal(data().completions.length,before.completions.length)
report.checks.push('desktop undo persisted')
for(let i=0;i<12;i++)run(['shell','input','swipe',String(Math.round(list.x)),String(list.b[3]-30),String(Math.round(list.x)),String(list.b[1]+30),'200'])
await pause(300);all=ui()
assert.ok(nodes(all,'todo_row_title').some(n=>n.text.endsWith('30')),'last synthetic task must be reachable')
report.checks.push('all 30 synthetic tasks reachable by scrolling')
screenshot('desktop-last-tasks')
writeFileSync(`Test_data/todo-${stage}-widget.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
