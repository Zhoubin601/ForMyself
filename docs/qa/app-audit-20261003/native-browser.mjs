import { writeFile } from 'node:fs/promises'
import { connect, pause } from './cdp.mjs'
const c=await connect()
try {
  await c.send('Page.reload',{ignoreCache:true});await pause(1700)
  const state=await c.evaluate(`({url:location.href,userAgent:navigator.userAgent,text:document.body.innerText,vueReady:Boolean(document.querySelector('#app').__vue_app__)})`)
  const errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded')
  await c.screenshot('android-api30-startup.png')
  await writeFile(new URL('native-browser.json',import.meta.url),JSON.stringify({state,errors},null,2))
  console.log(JSON.stringify({state,errors},null,2))
}finally{c.close()}
