import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import { dirname,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp,unlockApp,appData,verifyManagement } from './management-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url))
const browser=await chromium.launch({executablePath:process.env.KANATA_CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'})
const page=await context.newPage(),results={startedAt:new Date().toISOString(),browser:browser.version(),status:'RUNNING',checks:{},pageErrors:[],aiRequests:0}
page.on('pageerror',e=>results.pageErrors.push(e.message))
await page.route('https://api.deepseek.com/**',route=>{results.aiRequests++;return route.abort()})
const save=()=>writeFile(resolve(directory,'web-results.json'),JSON.stringify(results,null,2)+'\n')
const record=async(label,action)=>{const start=Date.now();results.checks[label]={status:'PASS',elapsedMs:0,result:await action()};results.checks[label].elapsedMs=Date.now()-start;console.log('PASS',label);await save();return results.checks[label].result}
try{
  await page.goto(process.env.KANATA_WEB_URL||'http://127.0.0.1:4173')
  await initializeApp(page)
  results.finalCounts=await verifyManagement(page,record)
  await record('cold-browser-reload',async()=>{await page.reload();await unlockApp(page);const d=await appData(page);if(d.worlds.length!==3||d.cards.length!==7||d.instances.length!==12)throw Error('Cold graph mismatch');return true})
  results.layouts=[]
  for(const viewport of [{width:375,height:812},{width:812,height:375},{width:1024,height:768}]){
    await page.setViewportSize(viewport)
    for(const fontSize of ['16px','32px']){
      await page.evaluate(size=>{document.documentElement.style.fontSize=size},fontSize)
      const layout=await page.locator('.kanata-manager').evaluate(el=>{
        const boxes=Array.from(el.querySelectorAll('button,h2,h3,h4,input,textarea')).filter(e=>e.getClientRects().length).map(e=>({rect:e.getBoundingClientRect(),button:e.tagName==='BUTTON'}))
        return{within:boxes.every(({rect})=>rect.left>=-1&&rect.right<=innerWidth+1),targets:boxes.filter(x=>x.button).every(({rect})=>rect.height>=47),scroll:document.querySelector('.kanata-frame').scrollHeight>document.querySelector('.kanata-frame').clientHeight}
      })
      results.layouts.push({...viewport,fontSize,...layout})
      if(!layout.within||!layout.targets)throw Error('Layout or target failure '+JSON.stringify(results.layouts.at(-1)))
    }
  }
  await page.setViewportSize({width:375,height:812});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.querySelector('.kanata-frame').scrollTop=0})
  await page.screenshot({path:resolve(directory,'web-world-manager.png')})
  await page.getByRole('button',{name:'全局角色库',exact:true}).click();await page.screenshot({path:resolve(directory,'web-card-library.png')})
  await record('session-expiry-clears-management',async()=>{
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
    await page.waitForFunction(()=>!document.querySelector('.kanata-manager'))
    if(await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot!==null))throw Error('Plaintext retained')
    return true
  })
  if(results.aiRequests||results.pageErrors.length)throw Error('Unexpected AI call or page error')
  results.status='PASS'
}catch(error){results.status='FAIL';results.error=error.message;results.visibleText=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:resolve(directory,'web-failure.png')}).catch(()=>{});process.exitCode=1;console.error(error)}
finally{results.finishedAt=new Date().toISOString();await save();await browser.close()}
