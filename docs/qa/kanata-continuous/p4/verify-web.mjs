import {chromium} from 'playwright-core'
import {writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initializeApp,unlockApp,appData,verifyChat} from './chat-scenarios.mjs'
const directory=dirname(fileURLToPath(import.meta.url)),results={startedAt:new Date().toISOString(),status:'RUNNING',checks:{},pageErrors:[]}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'}),page=await context.newPage()
page.on('pageerror',e=>results.pageErrors.push(e.message))
const save=()=>writeFile(resolve(directory,'web-results.json'),JSON.stringify(results,null,2)+'\n')
const record=async(label,action)=>{const start=Date.now(),value=await action();results.checks[label]={status:'PASS',elapsedMs:Date.now()-start,result:value};console.log('PASS',label);await save();return value}
try{
  await page.goto('http://127.0.0.1:4173');await initializeApp(page)
  results.finalCounts=await verifyChat(page,record)
  const before=JSON.stringify(await appData(page));await page.reload();await unlockApp(page)
  if(JSON.stringify(await appData(page))!==before)throw Error('Cold persistence mismatch')
  await page.locator('.kanata-conversation-list button').first().click()
  await page.screenshot({path:resolve(directory,'web-chat.png')})
  await record('expiry-releases-chat-and-preview',async()=>{
    await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
    await page.waitForFunction(()=>!document.querySelector('.kanata-chat')&&document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null)
    return true
  })
  if(results.pageErrors.length)throw Error('Page errors')
  results.status='PASS'
}catch(error){results.status='FAIL';results.error=error.message;results.visibleText=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:resolve(directory,'web-failure.png')}).catch(()=>{});console.error(error);process.exitCode=1}
finally{results.finishedAt=new Date().toISOString();await save();await browser.close()}
