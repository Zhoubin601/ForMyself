import {connect,store,uiSet} from '../background-20261019/native/cdp.mjs'
import crypto from 'node:crypto'
process.env.QA_CDP_PORT='9362'
const c=await connect()
await c.until(`!!${store('settings')}?.isDataLoaded && !!${store('auth')}?.isDataLoaded`)
if(await c.evaluate(`${store('auth')}.hasMasterPassword`))throw new Error('Expected empty isolated test user')
const password='QA-'+crypto.randomBytes(12).toString('hex')
await c.evaluate(uiSet('.lock-screen input',password))
await c.evaluate(`document.querySelector('.lock-btn').click()`)
await c.until(`!${store('auth')}.isLocked && !!${store('chat')}?.isDataLoaded`)
await c.evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
await c.until(`!!document.querySelector('.background-settings-card > button')`)
await c.evaluate(`(()=>{const e=document.querySelector('.background-settings-card > button');e.scrollIntoView({block:'center'});e.click();return true})()`)
console.log('Native image picker opened in isolated user12')
c.close()
