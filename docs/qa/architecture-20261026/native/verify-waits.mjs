import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { waitForStoreState } from './waitForStoreState.mjs'
const browser = await chromium.launch({executablePath:process.env.FORMYSELF_CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']})
try {
  const page = await browser.newPage()
  await page.setContent('<p>synthetic wait contract</p>')
  await page.evaluate(()=>{window.qaStore=new Map([['module',{ready:false}]])})
  let completed=false
  const pending=waitForStoreState(page,'window.qaStore',"return stores.get('module').ready",{timeout:3000,polling:25}).then(()=>{completed=true})
  await new Promise(resolve=>setTimeout(resolve,150))
  assert.equal(completed,false,'false must remain pending')
  await page.evaluate(()=>{window.qaStore.get('module').ready=true})
  await pending
  assert.equal(completed,true)
  await assert.rejects(waitForStoreState(page,'window.qaStore','return false',{timeout:100,polling:25}),/Timeout/)
  await assert.rejects(waitForStoreState(page,'window.qaStore','return () => false',{timeout:500}),/must return a value/)
  const result={falseRemainsPending:true,trueResolves:true,falseTimesOut:true,functionValueRejected:true,browser:browser.version(),executedAt:new Date().toISOString()}
  await writeFile(new URL('./wait-contract-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result))
} finally { await browser.close() }
