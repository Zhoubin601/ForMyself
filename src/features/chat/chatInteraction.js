import { askAI } from '../../services/aiEngine.js'
import { CHAT_REACTION_EMOJIS } from './chatRecords.js'

export const EMPTY_COMPANION_INTERACTION = Object.freeze({
  action: 'none',
  targetMessageId: '',
  emoji: ''
})

const cleanText = value => String(value || '').trim()
const limitText = (value, length) => Array.from(cleanText(value)).slice(0, length).join('')
const SILENT_REACTION_EMOJIS = new Set(['❤️', '👍'])

const askWithTimeout = (ask, prompt, timeoutMs = 4000) => new Promise((resolve, reject) => {
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    reject(new Error('CHAT_INTERACTION_TIMEOUT'))
  }, timeoutMs)
  Promise.resolve()
    .then(() => ask(prompt))
    .then(value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    })
    .catch(error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
})

const extractJson = value => {
  const text = cleanText(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('INVALID_CHAT_INTERACTION_RESPONSE')
  return JSON.parse(text.slice(start, end + 1))
}

const compactMessage = item => ({
  id: cleanText(item?.id),
  role: item?.role === 'assistant' ? 'assistant' : 'user',
  type: item?.type === 'poke' ? 'poke' : 'text',
  content: limitText(item?.content, 500),
  replyToMessageId: cleanText(item?.replyTo?.messageId),
  reactions: (Array.isArray(item?.reactions) ? item.reactions : [])
    .map(reaction => ({ actor: reaction.actor, emoji: reaction.emoji }))
})

export function hasRecentCompanionInteraction(messages = [], limit = 4) {
  return (Array.isArray(messages) ? messages : []).slice(-limit).some(item => (
    (item.role === 'assistant' && (item.type === 'poke' || !!item.replyTo)) ||
    (Array.isArray(item.reactions) && item.reactions.some(reaction => reaction.actor === 'assistant'))
  ))
}

export function buildCompanionInteractionPrompt({
  companionName = '小暖',
  recentMessages = [],
  pendingUserMessages = [],
  companionState = {},
  suppressActiveInteraction = false
} = {}) {
  return `你正在为“温馨小家”的虚拟女朋友 ${companionName} 判断这一轮是否需要一个微信式小动作。
最近聊天：${JSON.stringify(recentMessages.slice(-20).map(compactMessage))}
哥哥本轮连续消息：${JSON.stringify(pendingUserMessages.map(compactMessage))}
她现在的状态：${JSON.stringify(companionState)}

只能选择一个动作：
- none：绝大多数普通轮次使用。
- quote：确实需要明确接住哥哥某一条具体文字时使用，targetMessageId 必须来自上面的 user 文字消息。
- react：情绪很适合时用一个小表情回应哥哥的一条文字消息，emoji 只能是 ${CHAT_REACTION_EMOJIS.join(' ')}。
- poke：只有气氛明显调皮、亲昵，或哥哥刚刚先拍了拍她时才使用。

自然规则：
- 不要为了展示功能而互动；通常几轮才出现一次。
- 不能连续多轮主动引用、点表情或拍一拍。
- 哥哥本轮已经引用或拍一拍时，可以更自然地回应，但仍只能选一个动作。
- quote 和 react 只能指向真实存在的 user 消息 ID，不能编造 ID。
${suppressActiveInteraction ? '- 最近几轮她已经做过一次小动作；除非哥哥本轮主动引用或拍她，否则必须选 none。' : ''}

只输出严格 JSON：
{"action":"none|quote|react|poke","targetMessageId":"","emoji":""}`
}

export function parseCompanionInteraction(value, {
  allowedMessages = [],
  suppressActiveInteraction = false
} = {}) {
  const parsed = typeof value === 'string' ? extractJson(value) : value
  const action = ['none', 'quote', 'react', 'poke'].includes(parsed?.action)
    ? parsed.action
    : 'none'
  if (action === 'none') return { ...EMPTY_COMPANION_INTERACTION }

  const allowed = new Map((Array.isArray(allowedMessages) ? allowedMessages : [])
    .filter(item => item?.role === 'user' && item?.type !== 'poke' && cleanText(item.content))
    .map(item => [cleanText(item.id), item]))
  const userInitiated = (Array.isArray(allowedMessages) ? allowedMessages : [])
    .some(item => item?.type === 'poke' || !!item?.replyTo)
  if (suppressActiveInteraction && !userInitiated) return { ...EMPTY_COMPANION_INTERACTION }
  if (action === 'poke') {
    return { action, targetMessageId: '', emoji: '' }
  }

  const targetMessageId = cleanText(parsed.targetMessageId)
  if (!allowed.has(targetMessageId)) return { ...EMPTY_COMPANION_INTERACTION }
  if (action === 'quote') return { action, targetMessageId, emoji: '' }
  const emoji = CHAT_REACTION_EMOJIS.includes(parsed.emoji) ? parsed.emoji : ''
  return emoji
    ? { action, targetMessageId, emoji }
    : { ...EMPTY_COMPANION_INTERACTION }
}

export async function planCompanionInteraction({
  recentMessages = [],
  pendingUserMessages = [],
  ask = askAI,
  timeoutMs = 4000,
  ...options
} = {}) {
  const suppressActiveInteraction = hasRecentCompanionInteraction(recentMessages)
  try {
    const response = await askWithTimeout(ask, buildCompanionInteractionPrompt({
      ...options,
      recentMessages,
      pendingUserMessages,
      suppressActiveInteraction
    }), timeoutMs)
    return parseCompanionInteraction(response, {
      allowedMessages: [...recentMessages.slice(-12), ...pendingUserMessages],
      suppressActiveInteraction
    })
  } catch (error) {
    console.warn('女朋友互动判断失败，已跳过本轮小动作', error)
    return { ...EMPTY_COMPANION_INTERACTION }
  }
}

export function parseReactionFollowup(value) {
  const parsed = typeof value === 'string' ? extractJson(value) : value
  const content = limitText(parsed?.content, 48)
  return parsed?.reply === true && content
    ? { reply: true, content }
    : { reply: false, content: '' }
}

export async function planReactionFollowup({
  companionName = '小暖',
  targetMessage = {},
  emoji = '',
  recentMessages = [],
  companionState = {},
  ask = askAI,
  timeoutMs = 4000
} = {}) {
  if (SILENT_REACTION_EMOJIS.has(emoji)) {
    return { reply: false, content: '' }
  }
  try {
    const response = await askWithTimeout(ask, `哥哥刚刚用 ${emoji} 回应了虚拟女朋友 ${companionName} 的这条消息：
${JSON.stringify(compactMessage(targetMessage))}
最近聊天：${JSON.stringify(recentMessages.slice(-12).map(compactMessage))}
她现在的状态：${JSON.stringify(companionState)}

请判断要不要顺势补发一条很短的女朋友私聊。
- 多数普通表情只需安静收下，reply=false。
- 只有情绪明显、哥哥像是在撒娇/委屈/逗她，或确实有一句自然的话可接时才 reply=true。
- 不能解释表情功能，不复述系统说明，不得用“想了想又补一句”等动作旁白开头。
- reply=true 时只发一句自然小反应，不超过 30 字。

只输出严格 JSON：{"reply":false,"content":""}`, timeoutMs)
    return parseReactionFollowup(response)
  } catch (error) {
    console.warn('表情回应判断失败，已只保留表情', error)
    return { reply: false, content: '' }
  }
}

export function parsePokeFollowup(value) {
  const parsed = typeof value === 'string' ? extractJson(value) : value
  const action = ['none', 'poke', 'message'].includes(parsed?.action) ? parsed.action : 'none'
  const content = limitText(parsed?.content, 160)
  if (action === 'message' && !content) return { action: 'none', content: '' }
  return { action, content: action === 'message' ? content : '' }
}

export async function planPokeFollowup({
  companionName = '小暖',
  recentMessages = [],
  companionState = {},
  ask = askAI,
  timeoutMs = 4000
} = {}) {
  try {
    const response = await askWithTimeout(ask, `哥哥刚刚在“温馨小家”双击头像，轻轻拍了拍虚拟女朋友 ${companionName}。
最近聊天：${JSON.stringify(recentMessages.slice(-12).map(compactMessage))}
她现在的状态：${JSON.stringify(companionState)}

像熟悉的女朋友自然决定：安静收下（none）、拍回去（poke），或发一句很短的俏皮私聊（message）。
不要解释功能，不编造现实身体经历，不超过 80 字。
只输出严格 JSON：{"action":"none|poke|message","content":""}`, timeoutMs)
    return parsePokeFollowup(response)
  } catch (error) {
    console.warn('拍一拍回应判断失败，已保留本地拍一拍事件', error)
    return { action: 'none', content: '' }
  }
}
