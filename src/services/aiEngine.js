import { useSettingsStore } from '../stores/settings.js'

const DEFAULT_SYSTEM_PROMPT = '你是一个真诚、温暖的个人生活伴侣。请用简短、自然、像真人发微信的语气说话。'

const resolveRuntime = () => {
  const settings = useSettingsStore()
  const { aiProviderUrl, aiApiKey, aiModel } = settings
  if (!aiApiKey || !aiApiKey.trim()) throw new Error('MISSING_KEY')

  let endpoint = aiProviderUrl.trim().replace(/\/+$/, '')
  if (!endpoint.endsWith('/v1/chat/completions') && !endpoint.endsWith('/chat/completions')) {
    endpoint += endpoint.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'
  }
  return {
    endpoint,
    apiKey: aiApiKey.trim(),
    model: aiModel.trim() || 'deepseek-chat'
  }
}

const supportsSystemRole = model => {
  const normalized = model.toLowerCase()
  return !normalized.includes('r1') && !normalized.includes('glm')
}

const normalizeMessages = (messages, systemPrompt, model, injectSystemFallback = true) => {
  const normalized = (Array.isArray(messages) ? messages : [])
    .filter(item => ['user', 'assistant'].includes(item?.role) && String(item?.content || '').trim())
    .map(item => ({ role: item.role, content: String(item.content).trim() }))
  if (!systemPrompt) return normalized
  if (supportsSystemRole(model)) return [{ role: 'system', content: systemPrompt }, ...normalized]
  if (!injectSystemFallback) return normalized
  return [{ role: 'user', content: `【必须始终遵守的角色与行为设定】\n${systemPrompt}` }, ...normalized]
}

const classifyHttpError = (status, message = '') => {
  const text = String(message)
  if (
    status === 413 ||
    /(?:context length|maximum context|too many tokens|token limit|上下文.{0,8}(?:超|长)|超过.{0,8}token)/i.test(text)
  ) {
    const error = new Error(text || 'CONTEXT_LENGTH_EXCEEDED')
    error.code = 'CONTEXT_LENGTH_EXCEEDED'
    return error
  }
  const error = new Error(text || `HTTP ${status}`)
  error.code = `HTTP_${status}`
  return error
}

const fetchCompletion = async ({ endpoint, apiKey, payload, signal }) => {
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      const aborted = new Error('ABORTED')
      aborted.code = 'ABORTED'
      throw aborted
    }
    console.error('[AI] fetch failed:', error)
    const network = new Error('NETWORK_ERROR')
    network.code = 'NETWORK_ERROR'
    throw network
  }
}

const parseErrorResponse = async response => {
  const data = await response.json().catch(() => ({}))
  console.error('[AI] HTTP error:', response.status, data)
  throw classifyHttpError(response.status, data.error?.message)
}

const extractMessageContent = data => {
  let content = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!content) {
    const reasoning = String(data?.choices?.[0]?.message?.reasoning_content || '')
    if (reasoning) {
      const lines = reasoning
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 2 && !line.match(/^[\d*#\-\s]+$/) && !line.includes('**'))
      content = lines
        .filter(line => !line.includes('分析') && !line.includes('指令') && !line.includes('限制') && !line.includes('识别') && !line.includes('冲突'))
        .pop() || ''
    }
  }
  if (!content) throw new Error('EMPTY_RESPONSE')
  return content
}

const requestNonStreaming = async ({ runtime, messages, systemPrompt, temperature, maxTokens, signal, injectSystemFallback = true }) => {
  const payload = {
    model: runtime.model,
    messages: normalizeMessages(messages, systemPrompt, runtime.model, injectSystemFallback),
    temperature
  }
  if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens
  const response = await fetchCompletion({
    endpoint: runtime.endpoint,
    apiKey: runtime.apiKey,
    payload,
    signal
  })
  if (!response.ok) return parseErrorResponse(response)
  const data = await response.json().catch(() => {
    throw new Error('INVALID_RESPONSE')
  })
  return extractMessageContent(data)
}

const consumeSse = async (response, onDelta, signal) => {
  if (!response.body?.getReader) throw new Error('STREAM_UNSUPPORTED')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  const consumeEvent = eventText => {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
    for (const line of dataLines) {
      if (!line || line === '[DONE]') continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      const delta = String(event?.choices?.[0]?.delta?.content || '')
      if (!delta) continue
      content += delta
      onDelta?.(delta, content)
    }
  }

  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {})
      const error = new Error('ABORTED')
      error.code = 'ABORTED'
      throw error
    }
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''
    events.forEach(consumeEvent)
    if (done) break
  }
  if (buffer.trim()) consumeEvent(buffer)
  if (!content.trim()) throw new Error('EMPTY_RESPONSE')
  return content.trim()
}

export async function streamAIChat({
  messages,
  systemPrompt = '',
  signal,
  onDelta,
  temperature = 0.82
} = {}) {
  const runtime = resolveRuntime()
  const payload = {
    model: runtime.model,
    messages: normalizeMessages(messages, systemPrompt, runtime.model, true),
    temperature,
    stream: true
  }
  let emitted = ''
  try {
    const response = await fetchCompletion({
      endpoint: runtime.endpoint,
      apiKey: runtime.apiKey,
      payload,
      signal
    })
    if (!response.ok) return parseErrorResponse(response)
    const contentType = String(response.headers?.get?.('content-type') || '')
    if (!contentType.includes('text/event-stream')) {
      const data = await response.json().catch(() => {
        throw new Error('STREAM_UNSUPPORTED')
      })
      const content = extractMessageContent(data)
      onDelta?.(content, content)
      return content
    }
    return await consumeSse(response, (delta, full) => {
      emitted = full
      onDelta?.(delta, full)
    }, signal)
  } catch (error) {
    if (error.code === 'ABORTED' || error.code === 'CONTEXT_LENGTH_EXCEEDED') throw error
    const content = await requestNonStreaming({
      runtime,
      messages,
      systemPrompt,
      temperature,
      signal,
      injectSystemFallback: true
    })
    onDelta?.(content, content)
    return content
  }
}

export async function askAI(prompt) {
  const runtime = resolveRuntime()
  return requestNonStreaming({
    runtime,
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: supportsSystemRole(runtime.model) ? DEFAULT_SYSTEM_PROMPT : '',
    temperature: 0.7,
    maxTokens: 1024,
    injectSystemFallback: false
  })
}
