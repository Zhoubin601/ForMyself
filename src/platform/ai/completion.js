// @ts-check
/** @typedef {import('./completionTypes').CompletionAttempt} Attempt */
/** @typedef {import('./completionTypes').CompletionOptions} Options */
/** @param {string} code */
const failure = code => Object.assign(new Error(code), { code })
/** Safe provider usage only. Missing/invalid usage is never reported as actual zero. @param {any} usage */
export function parseCompletionUsage(usage) {
  /** @param {unknown} value */
  const integer = value => Number.isSafeInteger(value) && Number(value) >= 0
  if (!usage || !integer(usage.prompt_tokens) || !integer(usage.completion_tokens)) return null
  const hit = usage.prompt_cache_hit_tokens
  return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
    cacheHitTokens: integer(hit) && hit <= usage.prompt_tokens ? hit : null }
}
/** One durable record per HTTP attempt, including fallback and truncation retry.
 * No provider error bodies, credentials, prompts or reasoning content in records/logs.
 * @param {()=>import('./completionTypes').CompletionRuntime} resolveRuntime
 */
export function createDetailedCompletion(resolveRuntime) {
  /** @param {Options} options */
  return async function completeChat(options) {
    const runtime = resolveRuntime()
    if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(runtime.model)) throw failure('INVALID_MODEL')
    if (!Array.isArray(options.messages) || !options.messages.length || options.messages.some(m => !['user','assistant','system'].includes(m.role) || typeof m.content !== 'string')) throw failure('INVALID_MESSAGES')
    const input = options.messages.map(m => m.content).join('\n'), encoder = new TextEncoder()
    if (encoder.encode(input).length > 128000) throw failure('CONTEXT_LENGTH_EXCEEDED')
    let stream = options.stream !== false, maxTokens = options.maxTokens ?? 1024
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 64 || maxTokens > 4096) throw failure('INVALID_MAX_TOKENS')
    const timeout = options.timeoutMs ?? 60000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw failure('INVALID_TIMEOUT')
    let retried = false
    for (;;) {
      if (options.signal?.aborted) throw failure('ABORTED')
      /** @type {Attempt} */
      const attempt = { id: 'attempt-' + crypto.randomUUID(), model: runtime.model,
        officialProvider: new URL(runtime.endpoint).origin === 'https://api.deepseek.com', startedAt: Date.now(), finishedAt: null,
        transport: stream ? 'stream' : 'json', status: 'pending', errorCode: '', finishReason: '', usage: null,
        estimatedInputTokens: encoder.encode(input).length, estimatedOutputTokens: 0 }
      await options.onAttempt({ ...attempt }) // Persistence must succeed before chargeable work.
      const controller = new AbortController(), abort = () => controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      let timedOut = false, text = '', count = 0, done = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
      /** @param {any} data */
      const accept = data => {
        if (data.usage) attempt.usage = parseCompletionUsage(data.usage)
        const choice = data.choices?.[0]
        if (choice?.finish_reason) {
          if (!['stop','length','max_tokens','max_output_tokens','tool_calls','content_filter','insufficient_system_resource'].includes(choice.finish_reason)) throw failure('INVALID_RESPONSE')
          attempt.finishReason = choice.finish_reason
        }
        const delta = String(stream ? choice?.delta?.content || '' : choice?.message?.content || '')
        text += delta
        if (text.length > 64000) throw failure('OUTPUT_TOO_LARGE')
        if (delta) options.onDelta?.(text)
      }
      let errorCode = ''
      try {
        if (options.signal?.aborted) throw failure('ABORTED')
        const payload = { model: runtime.model, messages: options.messages, max_tokens: maxTokens, temperature: 0.8,
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false }) }
        const response = await fetch(runtime.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + runtime.apiKey }, body: JSON.stringify(payload), signal: controller.signal })
        if (!response.ok) throw failure(response.status === 413 ? 'CONTEXT_LENGTH_EXCEEDED' : 'HTTP_' + response.status)
        if (stream && String(response.headers.get('content-type')).includes('text/event-stream')) {
          const reader = response.body?.getReader()
          if (!reader) throw failure('STREAM_UNSUPPORTED')
          const decoder = new TextDecoder(); let buffer = ''
          /** @param {string} event */
          const consume = event => {
            const lines = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
            for (const line of lines) {
              if (line === '[DONE]') { done = true; continue }
              if (!line) continue
              let data
              try { data = JSON.parse(line) } catch { throw failure('INVALID_RESPONSE') }
              accept(data)
            }
          }
          try {
            for (;;) {
              const chunk = await reader.read(); count += chunk.value?.length || 0
              if (count > 2 * 1024 * 1024) throw failure('OUTPUT_TOO_LARGE')
              buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
              const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''; events.forEach(consume)
              if (chunk.done) { if (buffer.trim()) consume(buffer); break }
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
          if (!done && !attempt.finishReason) throw failure('STREAM_INTERRUPTED')
        } else {
          // Some compatible providers ignore stream and return a normal JSON completion.
          const body = await response.text()
          if (body.length > 2 * 1024 * 1024) throw failure('OUTPUT_TOO_LARGE')
          let data
          try { data = JSON.parse(body) } catch { throw failure('INVALID_RESPONSE') }
          const originalStream = stream; stream = false
          accept(data); stream = originalStream
        }
        if (['length','max_tokens','max_output_tokens'].includes(attempt.finishReason)) throw failure('OUTPUT_TRUNCATED')
        if (!text.trim()) throw failure('EMPTY_RESPONSE')
        if (controller.signal.aborted) throw failure(timedOut ? 'TIMEOUT' : 'ABORTED')
        attempt.status = 'succeeded'
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
        errorCode = timedOut ? 'TIMEOUT' : options.signal?.aborted ? 'ABORTED' : (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'NETWORK_ERROR')
        attempt.status = 'failed'; attempt.errorCode = errorCode
      } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
      }
      attempt.finishedAt = Date.now(); attempt.estimatedOutputTokens = encoder.encode(text).length
      await options.onAttempt({ ...attempt })
      if (!errorCode) return { content: text.trim(), attemptId: attempt.id }
      // One bounded retry total. Never replay a partially emitted broken stream automatically.
      if (!retried && errorCode === 'OUTPUT_TRUNCATED' && maxTokens < 4096) { retried = true; maxTokens = Math.min(4096, maxTokens * 2); options.onDelta?.(''); continue }
      if (!retried && stream && !text && ['STREAM_UNSUPPORTED','INVALID_RESPONSE','HTTP_400','HTTP_415'].includes(errorCode)) { retried = true; stream = false; continue }
      throw failure(errorCode)
    }
  }
}
