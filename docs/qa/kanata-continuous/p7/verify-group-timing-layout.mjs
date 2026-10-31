import {chromium} from 'playwright-core'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {initializeApp,appData} from '../p3/management-scenarios.mjs'
const marker=JSON.parse(await readFile('.kanata-web-dist.local/p7-activity-timing/qa-build.json','utf8'))
if(!marker.syntheticOnly||!marker.productionPreview)throw Error('UNMARKED_PRODUCTION_PREVIEW')
const result={status:'RUNNING',syntheticOnly:true,build:marker,viewport:{width:375,height:812},checks:{},modelAttempts:0,pageErrors:[]}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
  const context=await browser.newContext({viewport:result.viewport,reducedMotion:'reduce'}),page=await context.newPage()
  page.on('pageerror',error=>result.pageErrors.push(error.message))
  await page.route('https://api.deepseek.com/**',route=>{result.modelAttempts++;return route.abort()})
  await page.goto('http://127.0.0.1:4186');await initializeApp(page)
  await page.getByRole('button',{name:'创建群聊',exact:true}).click()
  const group=page.getByRole('form',{name:'创建世界群聊',exact:true})
  await group.getByLabel('群聊名称',{exact:true}).fill('');await page.getByRole('button',{name:'建立群聊',exact:true}).click()
  if(!await group.getByLabel('群聊名称',{exact:true}).evaluate(node=>node===document.activeElement))throw Error('TITLE_FOCUS_MISSING')
  await group.screenshot({path:fileURLToPath(new URL('group-creation-form-web.png',import.meta.url))})
  result.checks.group={inlineErrors:await group.getByRole('alert').count(),currentWorldRoles:await group.getByRole('checkbox').count(),overflow:await group.evaluate(node=>node.scrollWidth>node.clientWidth)}
  await page.getByRole('button',{name:'取消创建群聊',exact:true}).click()
  const data=await appData(page),conversation=data.conversations.find(c=>c.type==='group')
  await page.locator('.kanata-conversation-list').getByRole('button',{name:conversation.title,exact:true}).click()
  await page.getByRole('button',{name:'活动等待设置',exact:true}).click()
  const timing=page.getByRole('form',{name:'活动等待设置',exact:true})
  await timing.getByLabel('活动等待毫秒',{exact:true}).fill('30001');await page.getByRole('button',{name:'保存活动等待',exact:true}).click()
  if(!await timing.getByLabel('活动等待毫秒',{exact:true}).evaluate(node=>node===document.activeElement))throw Error('TIMING_FOCUS_MISSING')
  await timing.screenshot({path:fileURLToPath(new URL('activity-timing-form-web.png',import.meta.url))})
  result.checks.timing={inlineErrors:await timing.getByRole('alert').count(),overflow:await timing.evaluate(node=>node.scrollWidth>node.clientWidth)}
  result.documentOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
  if(result.modelAttempts||result.pageErrors.length||result.documentOverflow||result.checks.group.overflow||result.checks.timing.overflow)throw Error('LAYOUT_OR_NETWORK_FAILURE')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{await writeFile(new URL('group-timing-layout-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');await browser.close()}
