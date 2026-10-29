import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initializeApp,unlockApp,appData,verifyExperience} from './experience-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),results={startedAt:new Date().toISOString(),status:'RUNNING',checks:{},pageErrors:[]}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'}),page=await context.newPage()
page.on('pageerror',e=>results.pageErrors.push(e.message))
const save=()=>writeFile(resolve(directory,'web-results.json'),JSON.stringify(results,null,2)+'\n')
const record=async(label,action)=>{const start=Date.now(),value=await action();results.checks[label]={status:'PASS',elapsedMs:Date.now()-start,result:value};console.log('PASS',label);await save();return value}
try{
  await page.goto('http://127.0.0.1:4173');await initializeApp(page)
  results.finalCounts=await verifyExperience(page,record)
  const before=JSON.stringify(await appData(page));await page.reload();await unlockApp(page)
  if(JSON.stringify(await appData(page))!==before)throw Error('Cold persistence mismatch')
  await page.getByRole('button',{name:'记忆与权限',exact:true}).click()
  results.layouts=[]
  for(const viewport of [{width:375,height:812},{width:812,height:375},{width:1024,height:768}]){
    await page.setViewportSize(viewport)
    for(const fontSize of ['16px','32px']){
      await page.evaluate(size=>{document.documentElement.style.fontSize=size},fontSize)
      for(const tab of ['记忆','世界事件','生活联动']){
        await page.getByRole('button',{name:tab,exact:true}).click()
        const layout=await page.locator('.kanata-manager').evaluate(el=>{
          const nodes=[...el.querySelectorAll('button,input,textarea,h3,h4,fieldset')].filter(e=>e.getClientRects().length)
          return{within:nodes.every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1}),targets:nodes.filter(e=>e.tagName==='BUTTON').every(e=>e.getBoundingClientRect().height>=47)}
        })
        results.layouts.push({...viewport,fontSize,tab,...layout});if(!layout.within||!layout.targets)throw Error('Experience layout failed '+JSON.stringify(results.layouts.at(-1)))
      }
    }
  }
  await page.setViewportSize({width:375,height:812});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.querySelector('.kanata-frame').scrollTop=0})
  await page.screenshot({path:resolve(directory,'web-experience.png')})
  await record('expiry-releases-chat-and-preview',async()=>{
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
    await page.waitForFunction(()=>!document.querySelector('[aria-label="记忆事件与生活权限"]')&&document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null)
    return true
  })
  if(results.pageErrors.length)throw Error('Page errors')
  results.status='PASS'
}catch(error){results.status='FAIL';results.error=error.message;results.visibleText=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:resolve(directory,'web-failure.png')}).catch(()=>{});console.error(error);process.exitCode=1}
finally{results.finishedAt=new Date().toISOString();await save();await browser.close()}
