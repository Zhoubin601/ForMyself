import http from 'node:http'

const replies = [
  '本机模拟接口连接正常。',
  '切页后回复已完整到达。',
  '后台回来后回复也完整到达。',
  '进程恢复补偿已触发。'
]
let replyIndex = 0

const server = http.createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    const content = replies[Math.min(replyIndex, replies.length - 1)]
    replyIndex += 1
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    setTimeout(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    }, 4500)
  })
})

server.listen(18765, '127.0.0.1')
