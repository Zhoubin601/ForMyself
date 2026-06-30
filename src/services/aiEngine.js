import { useSettingsStore } from '../stores/settings'

export async function askAI(prompt) {
  const settings = useSettingsStore()
  const { aiProviderUrl, aiApiKey, aiModel } = settings

  if (!aiApiKey || !aiApiKey.trim()) {
    throw new Error('MISSING_KEY')
  }

  let endpoint = aiProviderUrl.trim().replace(/\/+$/, '')
  if (!endpoint.endsWith('/v1/chat/completions') && !endpoint.endsWith('/chat/completions')) {
    endpoint += endpoint.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'
  }

  const model = aiModel.trim() || 'deepseek-chat'
  const isGLM = model.toLowerCase().includes('glm')

  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1024
  }

  if (!model.toLowerCase().includes('r1') && !isGLM) {
    payload.messages.unshift({
      role: 'system',
      content: '你是一个真诚、温暖的个人生活伴侣。请用简短、自然、像真人发微信的语气说话。'
    })
  }

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiApiKey.trim()}` },
      body: JSON.stringify(payload)
    })
  } catch (fetchError) {
    console.error('[AI] fetch failed:', fetchError)
    throw new Error('NETWORK_ERROR')
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}))
    console.error('[AI] HTTP error:', response.status, errData)
    throw new Error(errData.error?.message || `HTTP ${response.status}`)
  }

  let data
  try {
    data = await response.json()
  } catch (jsonError) {
    console.error('[AI] JSON parse failed:', jsonError)
    throw new Error('INVALID_RESPONSE')
  }

  let content = (data.choices?.[0]?.message?.content || '').trim()

  // GLM 等模型 content 可能为空，取 reasoning_content 最后一行有效内容
  if (!content) {
    const reasoning = data.choices?.[0]?.message?.reasoning_content || ''
    if (reasoning) {
      const lines = reasoning.split('\n').map(l => l.trim()).filter(l => l.length > 2 && !l.match(/^[\d\*#\-\s]+$/) && !l.includes('**'))
      content = lines.filter(l => !l.includes('分析') && !l.includes('指令') && !l.includes('限制') && !l.includes('识别') && !l.includes('冲突')).pop() || ''
    }
  }

  if (!content) {
    console.error('[AI] empty content:', JSON.stringify(data).slice(0, 400))
    throw new Error('EMPTY_RESPONSE')
  }

  return content
}
