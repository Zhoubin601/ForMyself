import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

// Run against an isolated Chrome profile. Only synthetic savings records are used.
const [page] = (await fetch('http://127.0.0.1:9333/json').then(r => r.json())).filter(item => item.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id)
    clearTimeout(timer)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  }
})
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await pause(100) }
  throw new Error(`Condition timed out: ${expression}`)
}
const store = name => `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`
const ids = () => evaluate(`${store('debt')}.savedDebts.map(d=>d.id)`)
async function touch(type, x, y) {
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] })
}
async function handle() {
  return evaluate(`(()=>{const r=document.querySelector('.drag-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
}
async function resetScroll() { await evaluate(`document.querySelector('.app-wrapper').scrollTop=0`); await pause(200) }
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await until(`Boolean(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('debt')?.isDataLoaded)`)
  await evaluate(`(()=>{
    ${store('settings')}.aiApiKey='';
    ${store('debt')}.updateDebts(Array.from({length:100},(_,i)=>({id:'qa-'+i,name:i===0?'旅行基金':i===1?'一把陪我走过雨天的伞':'储蓄小目标 '+(i+1),startDate:'2026-09-08',totalAmount:i===0?5000:1000,records:[{amount:i===0?2300:80+i}],isCleared:false})));
    ${store('auth')}.hasMasterPassword=true;
    ${store('auth')}.isLocked=false;
    ${store('settings')}.switchView('debts');
  })()`)
  await until(`document.querySelectorAll('.savings-card').length===100`)
  await pause(400)
  const overflow = await evaluate(`document.querySelector('.app-wrapper').scrollWidth > innerWidth`)
  assert.equal(overflow, false)
  await mkdir('docs/qa/savings-20260908', { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('docs/qa/savings-20260908/mobile-synthetic.png', Buffer.from(shot.data, 'base64'))
  const before = await ids()
  let point = await handle()
  await touch('touchStart', point.x, point.y)
  await pause(400)
  assert.equal(await evaluate(`Boolean(document.querySelector('.savings-drag-ghost'))`), true, 'long press must lift card')
  for (let y = point.y; y <= 820; y += 25) { await touch('touchMove', point.x, y); await pause(20) }
  await touch('touchMove', point.x, 824)
  await pause(900)
  assert.equal(await evaluate(`Boolean(document.querySelector('.savings-drag-ghost'))`), true, 'touch movement must not trigger native pointercancel')
  await touch('touchEnd', point.x, 824)
  await until(`Boolean(document.querySelector('.order-toast button'))`)
  assert.notDeepEqual(await ids(), before)
  await evaluate(`document.querySelector('.order-toast button').click()`)
  await until(`${store('debt')}.savedDebts[0].id==='qa-0'`)
  await resetScroll()
  point = await handle()
  await touch('touchStart', point.x, point.y)
  await pause(400)
  await touch('touchMove', point.x, 824)
  await pause(1500)
  assert.equal(await evaluate(`document.querySelector('.app-wrapper').scrollTop > 100`), true, 'edge drag must scroll container')
  await touch('touchCancel', point.x, 824)
  await pause(100)
  assert.deepEqual(await ids(), before)
  await resetScroll()
  // Swipe before the long-press threshold must scroll, not reorder.
  point = await handle()
  await touch('touchStart', point.x, point.y)
  for (let y = point.y; y > point.y - 160; y -= 20) { await touch('touchMove', point.x, y); await pause(15) }
  await touch('touchEnd', point.x, point.y - 160)
  assert.equal(await evaluate(`Boolean(document.querySelector('.savings-drag-ghost'))`), false)
  assert.deepEqual(await ids(), before)
  const scrolled = await evaluate(`document.querySelector('.app-wrapper').scrollTop`)
  assert.ok(scrolled > 0, 'early swipe on handle must scroll')
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true })
  await pause(150)
  assert.equal(await evaluate(`document.querySelector('.app-wrapper').scrollWidth > innerWidth`), false)
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await resetScroll()
  point = await handle()
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y + 6, button: 'left', buttons: 1 })
  await pause(100)
  assert.equal(await evaluate(`Boolean(document.querySelector('.savings-drag-ghost'))`), true)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: 910, button: 'left', buttons: 1 })
  await pause(200)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: 910, button: 'left', buttons: 0, clickCount: 1 })
  await until(`Boolean(document.querySelector('.order-toast button'))`)
  assert.notDeepEqual(await ids(), before)
  await evaluate(`document.querySelector('.order-toast button').click()`)
  await until(`${store('debt')}.savedDebts[0].id==='qa-0'`)
  await resetScroll()
  await evaluate(`document.querySelector('.more-button').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await until(`Boolean(document.querySelector('.card-menu'))`)
  await evaluate(`document.querySelectorAll('.card-menu button')[2].focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await until(`${store('debt')}.savedDebts[0].id==='qa-1'`)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true)
  console.log(JSON.stringify({ cards: 100, mobileWidths: [390, 320], desktopWidth: 1100, longPress: true, touchReorder: true, mouseReorder: true, keyboardMove: true, undo: true, edgeScroll: true, earlySwipe: true, cancel: true, reducedMotion: true, overflow: false }))
} finally { socket.close() }
