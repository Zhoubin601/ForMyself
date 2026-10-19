import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { connect, pause, store, uiSet, uiClick } from './cdp.mjs'

const adbPath = 'E:/Android/Sdk/platform-tools/adb.exe'
const serial = 'emulator-5586'
const user = '12'
const adb = args => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true })
const results = { date: '2026-10-19', serial, user, tests: [], errors: [] }
const record = (name, details = {}) => { results.tests.push({ name, passed: true, ...details }); console.log(`PASS ${name}`) }
let password = `QA-${crypto.randomBytes(16).toString('hex')}`
let c
const save = () => fs.writeFileSync(new URL('results.json', import.meta.url), JSON.stringify(results, null, 2))
const screenshot = async name => {
  await pause(500)
  fs.writeFileSync(new URL(name, import.meta.url), execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true }))
}
const nativeOrigin = async () => {
  const targets = await fetch('http://127.0.0.1:9351/json').then(r => r.json())
  const metadata = JSON.parse(targets.find(t => t.type === 'page').description)
  return { x: metadata.screenX || 0, y: metadata.screenY || 0 }
}
const tap = async (selector, index = 0) => {
  adb(['shell', 'input', 'keyevent', '224'])
  await c.evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].scrollIntoView({block:'center'})`)
  await pause(180)
  const point = await c.evaluate(`(()=>{const r=document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();return{x:Math.round((r.left+r.width/2)*devicePixelRatio),y:Math.round((r.top+r.height/2)*devicePixelRatio)}})()`)
  const origin = await nativeOrigin()
  adb(['shell', 'input', 'tap', String(point.x + origin.x), String(point.y + origin.y)])
  await pause(250)
}
const effect = () => c.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.bg-blur-layer'));return{blur:s.backdropFilter,fade:s.backgroundColor}})()`)
const unlock = async () => {
  await c.until(`!!document.querySelector('.lock-screen input')`)
  await c.evaluate(uiSet('.lock-screen input', password))
  await tap('.lock-btn')
  await c.until(`!${store('auth')}.isLocked && !!${store('chat')}?.isDataLoaded`)
}
const reconnect = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const lines = adb(['shell', 'ps', '-A', '-o', 'USER,PID,NAME']).split('\n')
      const processLine = lines.find(line => /^u12_/.test(line) && / com\.yubin\.formyself\s*$/.test(line))
      if (processLine) {
        const pid = processLine.trim().split(/\s+/)[1]
        adb(['forward', 'tcp:9351', `localabstract:webview_devtools_remote_${pid}`])
        c = await connect()
        await c.until(`!!${store('settings')}?.isDataLoaded`)
        return
      }
    } catch {}
    await pause(500)
  }
  throw new Error('Native WebView reconnection timed out')
}

try {
  c = await connect()
  await c.until(`!!${store('settings')}?.isDataLoaded`)
  results.environment = await c.evaluate(`({userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],devicePixelRatio,native:window.Capacitor.isNativePlatform()})`)
  assert.equal(adb(['shell','am','get-current-user']).trim(), user)
  assert.ok(adb(['shell','pm','list','users']).includes('ForMyself-Background-QA-20261019'))
  if (await c.evaluate(`${store('auth')}.hasMasterPassword`)) {
    assert.equal(await c.evaluate(`${store('auth')}.isLocked`), false, 'Only resume our unlocked synthetic test session')
    password = await c.evaluate(`${store('auth')}.savedMasterPwd`)
  } else {
    await unlock()
  }
  record('native-first-entry')
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await c.until(`!!document.querySelector('#background-blur')`)
  if (!await c.evaluate(`!!${store('settings')}.customBg`)) {
    await tap('.background-settings-card > button', 0)
    console.log('PICKER_OPEN: select ForMyself-QA-background.png from Documents')
    for (let attempt = 0; attempt < 600; attempt++) {
      if (await c.evaluate(`!!${store('settings')}.customBg`)) break
      await pause(1000)
    }
  }
  assert.equal(await c.evaluate(`!!${store('settings')}.customBg`), true)
  record('native-image-picker-upload', { imageLength: await c.evaluate(`${store('settings')}.customBg.length`) })
  await tap('.background-scope-picker button', 0)
  await c.until(`document.querySelectorAll('.background-scope-picker button')[0].getAttribute('aria-pressed')==='true'`)
  await c.evaluate(uiSet('#background-blur', '0'))
  await c.evaluate(uiSet('#background-fade', '0'))
  await tap('.background-scope-picker button', 1)
  await c.until(`document.querySelectorAll('.background-scope-picker button')[1].getAttribute('aria-pressed')==='true'`)
  await c.evaluate(uiSet('#background-blur', '20'))
  await c.evaluate(`document.querySelector('#background-blur').scrollIntoView({block:'center'})`)
  await pause(200)
  const range = await c.evaluate(`(()=>{const r=document.querySelector('#background-blur').getBoundingClientRect();return{x1:Math.round((r.left+r.width*.25)*devicePixelRatio),x2:Math.round((r.left+r.width*.8)*devicePixelRatio),y:Math.round((r.top+r.height/2)*devicePixelRatio)}})()`)
  const origin = await nativeOrigin()
  adb(['shell', 'input', 'swipe', String(range.x1 + origin.x), String(range.y + origin.y), String(range.x2 + origin.x), String(range.y + origin.y), '600'])
  await pause(300)
  assert.ok(await c.evaluate(`${store('settings')}.backgroundEffects.pages.blur`) > 50)
  record('native-touch-slider')
  await c.evaluate(uiSet('#background-blur', '75'))
  await c.evaluate(uiSet('#background-fade', '45'))
  await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  assert.deepEqual(await c.evaluate(`JSON.parse(JSON.stringify(${store('settings')}.backgroundEffects))`), { lock: { blur: 0, fade: 0 }, pages: { blur: 75, fade: 45 } })
  assert.deepEqual(await effect(), { blur: 'blur(30px)', fade: 'rgba(245, 245, 247, 0.45)' })
  await screenshot('native-appearance-pages.png')
  await tap('.background-scope-picker button', 0)
  await c.until(`document.querySelectorAll('.background-scope-picker button')[0].getAttribute('aria-pressed')==='true'`)
  assert.equal(await c.evaluate(`document.querySelector('#background-blur').value`), '0')
  await screenshot('native-appearance-lock.png')
  record('independent-background-groups')

  adb(['shell', 'input', 'keyevent', '3'])
  await c.until(`${store('auth')}.isLocked`)
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await pause(500)
  assert.deepEqual(await effect(), { blur: 'blur(0px)', fade: 'rgba(245, 245, 247, 0)' })
  await screenshot('native-lock-clear.png')
  await unlock()
  assert.deepEqual(await effect(), { blur: 'blur(30px)', fade: 'rgba(245, 245, 247, 0.45)' })
  record('native-background-lock-and-unlock-effects')

  await c.evaluate(`${store('settings')}.switchView('chat')`)
  await c.until(`!!document.querySelector('.warm-home')`)
  await c.evaluate(`(()=>{const chat=${store('chat')};chat.appendMessage('user','合成测试：保留聊天与记忆');chat.addMemory({scope:'user',category:'偏好',content:'合成测试：喜欢温馨鼓励'});return true})()`)
  const preserved = await c.evaluate(`({messages:${store('chat')}.messages.length,memories:${store('chat')}.memories.length})`)
  await c.evaluate(`window.Capacitor.nativePromise('LocalNotifications','schedule',{notifications:[{id:820000101,title:'QA proactive',body:'Synthetic notification',schedule:{at:new Date(Date.now()+3600000).toISOString()}},{id:823000101,title:'QA followup',body:'Synthetic notification',schedule:{at:new Date(Date.now()+3600000).toISOString()}}]})`)
  assert.equal(await c.evaluate(`window.Capacitor.nativePromise('LocalNotifications','getPending',{}).then(r=>r.notifications.filter(n=>n.id===820000101||n.id===823000101).length)`), 2)
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await c.until(`!!document.querySelector('input[aria-label="开启温馨小家"]')`)
  await tap('input[aria-label="开启温馨小家"]')
  await c.until(`${store('settings')}.warmHomeEnabled===false`)
  await c.until(`window.Capacitor.nativePromise('LocalNotifications','getPending',{}).then(r=>!r.notifications.some(n=>n.id===820000101||n.id===823000101))`)
  assert.deepEqual(await c.evaluate(`({messages:${store('chat')}.messages.length,memories:${store('chat')}.memories.length})`), preserved)
  record('native-notifications-cancelled-and-history-preserved')
  await c.evaluate(`${store('settings')}.switchView('home')`)
  await c.until(`!!document.querySelector('.companion-note')`)
  assert.ok((await c.evaluate(`document.querySelector('.companion-note').innerText`)).length > 4)
  await tap('.companion-note')
  assert.equal(await c.evaluate(`${store('settings')}.currentView`), 'home')
  assert.equal(await c.evaluate(`!!document.querySelector('.companion-unread')`), false)
  assert.ok(await c.evaluate(`document.body.innerText.includes('温馨小家入口已关闭')`))
  await screenshot('native-home-disabled.png')
  record('native-home-quote-retained-and-click-blocked')
  await c.evaluate(`${store('settings')}.isDrawerOpen=true`)
  await pause(350)
  assert.equal(await c.evaluate(`[...document.querySelectorAll('.drawer-menu li')].some(e=>e.textContent.includes('温馨小家'))`), false)
  await screenshot('native-drawer-disabled.png')
  record('native-drawer-hidden')
  await c.evaluate(`${store('chat')}.flush()`)
  await c.evaluate(`${store('settings')}.flushPendingSettingsWrites()`)
  c.close()
  adb(['shell', 'am', 'force-stop', '--user', user, 'com.yubin.formyself'])
  adb(['shell', 'am', 'start', '--user', user, '-n', 'com.yubin.formyself/.MainActivity'])
  await reconnect()
  assert.equal(await c.evaluate(`${store('settings')}.warmHomeEnabled`), false)
  assert.deepEqual(await c.evaluate(`JSON.parse(JSON.stringify(${store('settings')}.backgroundEffects))`), { lock: { blur: 0, fade: 0 }, pages: { blur: 75, fade: 45 } })
  assert.deepEqual(await effect(), { blur: 'blur(0px)', fade: 'rgba(245, 245, 247, 0)' })
  await screenshot('native-cold-start-lock.png')
  await unlock()
  record('native-cold-start-persistence')
  await c.evaluate(`${store('settings')}.openGeneralSettingsSection('appearance')`)
  await c.until(`!!document.querySelector('input[aria-label="开启温馨小家"]')`)
  await tap('input[aria-label="开启温馨小家"]')
  await c.until(`${store('settings')}.warmHomeEnabled===true`)
  await c.evaluate(`${store('settings')}.switchView('home')`)
  await c.until(`!!document.querySelector('.companion-note')`)
  await tap('.companion-note')
  await c.until(`${store('settings')}.currentView==='chat' && !!document.querySelector('.warm-home')`)
  assert.ok(await c.evaluate(`${store('chat')}.messages.some(m=>m.content==='合成测试：保留聊天与记忆')`))
  assert.ok(await c.evaluate(`${store('chat')}.memories.some(m=>m.content==='合成测试：喜欢温馨鼓励')`))
  await screenshot('native-chat-reenabled.png')
  record('native-reenable-restores-entry-and-data')
  const layout = await c.evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth})`)
  assert.ok(layout.documentWidth <= layout.width)
  results.errors = c.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.text)
  assert.equal(results.errors.length, 0)
  record('native-layout-and-runtime', layout)
} catch (error) {
  results.failure = error.stack
  console.error(error.stack)
  process.exitCode = 1
} finally {
  save()
  c?.close()
}
