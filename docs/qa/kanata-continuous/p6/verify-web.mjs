import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {initializeApp,verifyActivity,appData,unlockApp} from './activity-scenarios.mjs'
const result={status:'RUNNING',startedAt:new Date().toISOString(),checks:{},pageErrors:[]}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'}),page=await context.newPage()
page.on('pageerror',e=>result.pageErrors.push(e.message))
const save=()=>writeFile(new URL('web-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
const record=async(name,action)=>{const value=await action();result.checks[name]={status:'PASS',result:value};console.log('PASS',name);await save();return value}
try{
  await page.goto('http://127.0.0.1:4173');await initializeApp(page);result.finalCounts=await verifyActivity(page,record)
  await page.getByRole('button',{name:'世界日常与视角',exact:true}).click();result.layouts=[]
  for(const viewport of [{width:375,height:812},{width:812,height:375},{width:1024,height:768}]){
    await page.setViewportSize(viewport)
    for(const fontSize of ['16px','32px']){
      await page.evaluate(size=>{document.documentElement.style.fontSize=size},fontSize)
      const layout=await page.locator('[aria-label="世界自主活动与视角"]').evaluate(el=>({within:[...el.querySelectorAll('button,input,fieldset')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1}),targets:[...el.querySelectorAll('button')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=47)}))
      result.layouts.push({...viewport,fontSize,...layout});if(!layout.within||!layout.targets)throw Error('Activity layout failed '+JSON.stringify(result.layouts.at(-1)))
    }
  }
  await page.setViewportSize({width:375,height:812});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.querySelector('.kanata-frame').scrollTop=0})
  await page.screenshot({path:fileURLToPath(new URL('web-activity.png',import.meta.url))})
  const before=JSON.stringify(await appData(page));await page.reload();await unlockApp(page)
  await record('cold-reload-exact-graph',async()=>{if(JSON.stringify(await appData(page))!==before)throw Error('Cold mismatch');return true})
  if(result.pageErrors.length)throw Error('Page errors')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;result.text=await page.locator('body').innerText().catch(()=>'');console.error(error);process.exitCode=1}
finally{result.finishedAt=new Date().toISOString();await save();await browser.close()}
