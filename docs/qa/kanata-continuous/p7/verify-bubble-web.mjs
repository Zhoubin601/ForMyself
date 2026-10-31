// Isolated production Chrome and an explicitly synthetic provider fixture, never model quality evidence.
import {chromium} from 'playwright-core'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {initializeApp} from '../p3/management-scenarios.mjs'
const tag=process.argv[2]||'p7-archive-descriptor',port=Number(process.argv[3]||4183)
if(!/^p7-[a-z0-9-]+$/.test(tag)||!Number.isInteger(port)||port<4175||port>4190)throw Error('INVALID_LOCAL_QA_BUILD')
const build=JSON.parse(await readFile('.kanata-web-dist.local/'+tag+'/qa-build.json','utf8'))
if(!build.syntheticOnly||!build.productionPreview)throw Error('UNMARKED_PRODUCTION_PREVIEW')
const result={status:'RUNNING',at:new Date().toISOString(),build,controlledProvider:true,realModelRequests:0,fixtureRequests:0,checks:{},pageErrors:[]}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'no-preference'}),page=await context.newPage()
page.on('pageerror',error=>result.pageErrors.push(error.message))
const save=()=>writeFile(new URL('web-bubble-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
try{
  await page.route('https://api.deepseek.com/**',async route=>{
    result.fixtureRequests++
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'第一条合成气泡。\n\n第二条合成气泡。\n\n第三条合成气泡。'},finish_reason:'stop'}],usage:{prompt_tokens:321,completion_tokens:42,total_tokens:363}})})
  })
  await page.goto('http://127.0.0.1:'+port);await initializeApp(page)
  await page.evaluate(()=>{
    const settings=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
    settings.aiApiKey='synthetic-p7-bubble-not-a-key';settings.aiProviderUrl='https://api.deepseek.com';settings.aiModel='deepseek-chat'
  })
  // Keep this UX fixture to two chat requests; automatic extraction has its own existing tests.
  await page.evaluate(async()=>{
    const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s,store=stores.get('kanata')
    await stores.get('protectedAccess').runOperation(['chat'],()=>store.update(data=>{
      data.memoryPolicies=[{worldId:data.worlds[0].id,strategy:'standard',enabled:false,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1}]
    }))
  })
  await page.locator('.kanata-conversation-list button').first().click()
  await page.getByLabel('流式预览',{exact:true}).uncheck()
  await page.getByLabel('发送文字',{exact:true}).fill('合成气泡验收')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  const reveal=page.getByRole('button',{name:'立即显示全部回复',exact:true})
  await reveal.waitFor({state:'visible'})
  const before=await page.evaluate(()=>{
    const store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata')
    const messages=store.snapshot.messages,reply=messages.filter(m=>m.role==='assistant')
    if(reply.length!==3||new Set(reply.map(m=>m.batchId)).size!==1||new Set(reply.map(m=>m.replyToMessageId)).size!==1||store.hasPendingSave||store.saveError)throw Error('BUBBLE_DURABLE_BATCH_INCOMPLETE')
    return{durableRows:messages.length,visibleRows:document.querySelectorAll('.kanata-chat-message').length,batches:1}
  })
  if(before.visibleRows>=before.durableRows)throw Error('NO_PROGRESSIVE_PRESENTATION')
  await page.screenshot({path:fileURLToPath(new URL('web-bubble-queue.png',import.meta.url))})
  await reveal.click()
  if(await page.locator('.kanata-chat-message').count()!==4||result.fixtureRequests!==1)throw Error('SHOW_ALL_CHANGED_REQUESTS_OR_ROWS')
  result.checks.atomicBatchAndShowAll={status:'PASS',...before,visibleAfter:4,fixtureRequests:1}
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.getByRole('button',{name:'停止回复',exact:true}).waitFor({state:'hidden'})
  await page.getByLabel('发送文字',{exact:true}).fill('减少动效验收')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.kanata-chat-message').length===8)
  if(await reveal.count()||result.fixtureRequests!==2)throw Error('REDUCED_MOTION_WAITS_OR_REQUESTS')
  result.checks.reducedMotionImmediate={status:'PASS',visibleRows:8,fixtureRequests:2}
  await page.getByRole('button',{name:'返回世界',exact:true}).click()
  await page.locator('.kanata-conversation-list button').first().click()
  if(await page.locator('.kanata-chat-message').count()!==8||await reveal.count())throw Error('HISTORY_REPLAY_ANIMATED')
  result.checks.existingHistoryImmediate={status:'PASS',visibleRows:8}
  await page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').expireSession())
  await page.waitForFunction(()=>!document.querySelector('.kanata-chat')&&document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot===null)
  result.checks.expiryClearsView={status:'PASS'}
  if(result.pageErrors.length)throw Error('UNEXPECTED_PAGE_ERROR')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{await save();await browser.close()}
