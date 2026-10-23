import { writeFile } from 'node:fs/promises'

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function connect() {
  const targets = await fetch(`http://127.0.0.1:${process.env.QA_CDP_PORT || 9348}/json`).then(r => r.json())
  const target = targets.find(t => t.type === 'page')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map(), events = []
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method) events.push(message)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async expression => {
    for (let i=0;i<100;i++) { if (await evaluate(expression)) return; await pause(100) }
    throw new Error(`Condition failed: ${expression}`)
  }
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
  const screenshot = async name => {
    const result = await send('Page.captureScreenshot', { format:'png' })
    await writeFile(new URL(name, import.meta.url), Buffer.from(result.data, 'base64'))
  }
  return { send, evaluate, until, screenshot, events, close:()=>socket.close() }
}
export const store = name => `(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia._s.get('${name}'))`
export const uiSet = (selector,value) => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing input');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`
export const uiClick = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing click target');e.click();return true})()`
