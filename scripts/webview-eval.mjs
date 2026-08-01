const expression = process.argv.slice(2).join(' ')
if (!expression) throw new Error('MISSING_EXPRESSION')

const [page] = await fetch('http://127.0.0.1:9222/json').then(response => response.json())
if (!page?.webSocketDebuggerUrl) throw new Error('MISSING_WEBVIEW_TARGET')

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const timer = setTimeout(() => {
    socket.close()
    reject(new Error('WEBVIEW_EVALUATION_TIMEOUT'))
  }, 10000)
  socket.onerror = reject
  socket.onopen = () => socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true }
  }))
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== 1) return
    clearTimeout(timer)
    socket.close()
    resolve(message)
  }
})

if (result.error || result.result?.exceptionDetails) {
  throw new Error(result.error?.message || result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text)
}
console.log(JSON.stringify(result.result?.result?.value ?? result.result?.result?.description ?? null))
