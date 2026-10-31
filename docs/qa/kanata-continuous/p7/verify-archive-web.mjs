import {chromium} from 'playwright-core'
import {readdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {initializeApp,unlockApp,PASSWORD} from '../p3/management-scenarios.mjs'
import {verifyArchiveHistory} from './archive-scenarios.mjs'
const result={status:'RUNNING',at:new Date().toISOString(),productionPreview:true,checks:{},pageErrors:[],aiRequests:0}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'}),page=await context.newPage()
page.setDefaultTimeout(45000);page.on('pageerror',error=>result.pageErrors.push(error.message));await page.route('https://api.deepseek.com/**',route=>{++result.aiRequests;return route.abort()})
const save=()=>writeFile(new URL('web-archive-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
const record=async(name,action)=>{const start=Date.now(),value=await action();result.checks[name]={status:'PASS',ms:Date.now()-start,result:value};console.log('PASS',name);await save();return value}
try{
  await page.goto('http://127.0.0.1:4174');await initializeApp(page)
  const asset=(await readdir(new URL('../../../../dist/assets/',import.meta.url))).find(f=>f.startsWith('fullBackupRuntime-')&&f.endsWith('.js'))
  const target=await verifyArchiveHistory(page,record,{fullBackupAsset:asset,password:PASSWORD})
  await page.reload();await unlockApp(page)
  await record('cold-production-reload-preserves-all-history-and-source-audits',async()=>page.evaluate(target=>{
    const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot
    if(d.messages.length!==target.total||d.messages.find(m=>m.id==='p7-history-26')?.revision!==2||!d.messageAudits.length)throw Error('Cold history mismatch')
    return{messages:d.messages.length,audits:d.messageAudits.length}
  },target))
  await page.getByRole('button',{name:target.title,exact:true}).click();await page.getByRole('button',{name:'查找或整理历史',exact:true}).click()
  const panel=page.getByRole('region',{name:'会话历史',exact:true});await panel.getByRole('button',{name:'查询历史',exact:true}).click();await panel.locator('article').first().waitFor()
  result.layouts=[]
  for(const viewport of [{width:375,height:812},{width:812,height:375},{width:1024,height:768}])for(const fontSize of ['16px','32px']){
    await page.setViewportSize(viewport);await page.evaluate(size=>document.documentElement.style.fontSize=size,fontSize)
    const layout=await panel.evaluate(el=>({within:[...el.querySelectorAll('button,input,article')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1}),targets:[...el.querySelectorAll('button')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=47)}))
    result.layouts.push({...viewport,fontSize,...layout});if(!layout.within||!layout.targets)throw Error('History layout failed '+JSON.stringify(result.layouts.at(-1)))
  }
  await page.setViewportSize({width:375,height:812});await page.evaluate(()=>document.documentElement.style.fontSize='16px')
  await page.screenshot({path:fileURLToPath(new URL('web-history.png',import.meta.url))})
  if(result.aiRequests||result.pageErrors.length)throw Error('Unexpected HTTP or page error')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;result.text=await page.locator('body').innerText().catch(()=>'');console.error(error);process.exitCode=1}
finally{await save();await browser.close()}
