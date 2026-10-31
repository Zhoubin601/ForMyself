import {chromium} from 'playwright-core'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {initializeApp,unlockApp,PASSWORD} from '../p3/management-scenarios.mjs'
import {connectNativeCapacity} from './native-capacity-support.mjs'
import {encryptPassphraseAes} from '../../../../src/shared/crypto/passphraseAes.js'
import {attachGroupRuntime,groupExport,groupRestore,verifyGroupLimits,openGroup} from './group-limits-scenarios.mjs'
import {verifyCustomGroups} from './custom-groups-scenarios.mjs'
import {verifyActivityTiming} from './activity-timing-scenarios.mjs'
const kind=process.argv[2]||'web'
if(!['web','native'].includes(kind))throw Error('SYNTHETIC_PLATFORM_REQUIRED')
const tag=process.argv[3]||'p7-activity-timing',port=Number(process.argv[4]||4186),evidence=process.argv[5]||'activity-timing'
if(!/^p7-[a-z0-9-]+$/.test(tag)||!Number.isInteger(port)||port<4175||port>4190||!/^[a-z0-9-]+$/.test(evidence))throw Error('INVALID_FROZEN_BUILD_OR_EVIDENCE')
const result={status:'RUNNING',at:new Date().toISOString(),kind,syntheticOnly:true,controlledProvider:true,realModelRequests:0,checks:{},pageErrors:[]},network={requests:0,failAt:0}
let native,browser,page,asset,baseline
const save=()=>writeFile(new URL(`${evidence}-${kind}-results.json`,import.meta.url),JSON.stringify(result,null,2)+'\n')
const record=async(name,action)=>{const start=performance.now();result.checks[name]={status:'RUNNING'};await save();const value=await action();result.checks[name]={status:'PASS',ms:Math.round(performance.now()-start),value};await save()}
const observe=async()=>{
  page.on('pageerror',error=>result.pageErrors.push(error.message))
  await page.route('https://api.deepseek.com/**',async route=>{
    ++network.requests
    if(network.requests===network.failAt)return route.fulfill({status:500,contentType:'application/json',body:'{"error":{"message":"synthetic group failure"}}'})
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'第一段合成回应。\n\n第二段合成回应。\n\n第三段合成回应。'},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:24,total_tokens:147}})})
  })
}
try{
  if(kind==='web'){
    const directory='.kanata-web-dist.local/'+tag,marker=JSON.parse(await readFile(directory+'/qa-build.json','utf8'))
    if(!marker.syntheticOnly||!marker.productionPreview)throw Error('UNMARKED_PRODUCTION_PREVIEW')
    result.build=marker
    asset='assets/'+(await readdir(directory+'/assets')).find(name=>/^fullBackupRuntime-.*\.js$/.test(name))
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
    const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});page=await context.newPage();await observe()
    await page.goto('http://127.0.0.1:'+port);await initializeApp(page)
  }else{
    native=await connectNativeCapacity({onPage:async next=>{page=next;await observe()}});page=native.page;result.build=native.build.apkSha256
    asset=native.build.resources.find(row=>/^assets\/fullBackupRuntime-.*\.js$/.test(row.path)).path
  }
  await attachGroupRuntime(page,asset)
  baseline=await groupExport(page)
  if(kind==='native'){
    if(baseline.data.chat.messages.length!==608||baseline.data.chat.messages.find(m=>m.id==='p7-history-26')?.revision!==2)throw Error('EXPECTED_SYNTHETIC_BASELINE_MISSING')
    const name=evidence+'-native-baseline-'+Date.now()+'.enc';result.baselineArtifact=name
    await writeFile(new URL(name,import.meta.url),encryptPassphraseAes(JSON.stringify(baseline),PASSWORD),{flag:'wx'})

  }
  const createdScope=await verifyCustomGroups(page,record,network)
  const scope=await verifyGroupLimits(page,record,network,PASSWORD,createdScope)
  page=await verifyActivityTiming(page,scope,record,network,PASSWORD,async()=>{
    if(native)page=await native.cold();else{await page.reload();await unlockApp(page)}
    await attachGroupRuntime(page,asset);return page
  })
  await record('cold-storage-reload-keeps-policy-and-the-same-seven-rows',async()=>{
    if(native){page=await native.cold()}
    else{await page.reload();await unlockApp(page)}
    await attachGroupRuntime(page,asset);await openGroup(page,scope)
    await page.getByRole('button',{name:'群聊回复限制',exact:true}).click()
    if(await page.getByLabel('每轮参与角色上限',{exact:true}).inputValue()!=='1'||await page.getByLabel('每轮 AI 回复条数上限',{exact:true}).inputValue()!=='1')throw Error('COLD_POLICY_LOST')
    await page.getByRole('button',{name:'取消群聊配置',exact:true}).click()
    const count=await page.evaluate(id=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot.messages.filter(m=>m.conversationId===id).length,scope.conversationId)
    if(count!==7)throw Error('COLD_HISTORY_LOST')
    const subset=await page.evaluate(id=>{const d=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('kanata').snapshot;const group=d.conversations.find(c=>c.id===id);return group?.participantIds.length===3&&!d.messages.some(m=>m.conversationId===id)},scope.firstId)
    if(!subset)throw Error('COLD_SUBSET_GROUP_LOST_OR_HISTORY_LEAKED')
    return{rows:7,policy:true,processRestart:Boolean(native)}
  })
  await page.screenshot({path:fileURLToPath(new URL(`${evidence}-${kind}.png`,import.meta.url))})
  if(network.requests!==7||result.pageErrors.length)throw Error('UNEXPECTED_PROVIDER_OR_PAGE_EVENT')
  result.status='PASS'
}catch(error){result.status='FAIL';result.error=error.message;process.exitCode=1}
finally{
  if(baseline&&page){
    try{
      await groupRestore(page,baseline,PASSWORD)
      const after=await groupExport(page)
      const comparable=value=>{const data=JSON.parse(JSON.stringify(value));if(data.data.todos)delete data.data.todos.revision;delete data.createdAt;return JSON.stringify(data)}
      if(comparable(after)!==comparable(baseline))throw Error('SYNTHETIC_BASELINE_NOT_RETURNED')
      result.cleanup={status:'PASS',actualCoordinator:true,chatRows:after.data.chat.messages.length,otherModulesAndSettingsPreserved:true}
      await page.evaluate(()=>{delete window.__groupTest})
      if(native)await promisify(execFile)('E:/Android/Sdk/platform-tools/adb.exe',['-s','emulator-5580','shell','input','keyevent','3'],{timeout:15000})
    }catch(error){result.cleanup={status:'FAIL',error:error.message};result.status='FAIL';process.exitCode=1}
  }
  result.fixtureRequests=network.requests;await save()
  if(native)await native.close();if(browser)await browser.close()
}
process.exit(process.exitCode||0)
