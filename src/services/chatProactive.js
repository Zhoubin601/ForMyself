import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { askAI } from './aiEngine.js'
import {
  normalizeChatProactiveSettings,
  normalizeProactiveOutbox
} from './chatRecords.js'
import { formatChatDate } from './chatRelationship.js'

export const CHAT_PROACTIVE_CHANNEL_ID = 'formyself-warm-home-v1'
export const CHAT_PROACTIVE_NOTIFICATION_MIN = 820000000
export const CHAT_PROACTIVE_NOTIFICATION_MAX = 821000000
const TWO_HOURS = 2 * 60 * 60 * 1000
const SIX_HOURS = 6 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

const cleanText = value => String(value || '').trim()
const characterSlice = (value, length) => Array.from(cleanText(value)).slice(0, length).join('')
const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date, amount) => new Date(startOfDay(date).getTime() + amount * DAY)
const minuteOfDay = value => {
  const [hour, minute] = String(value || '').split(':').map(Number)
  return hour * 60 + minute
}
const atMinute = (date, minute) => new Date(
  date.getFullYear(),
  date.getMonth(),
  date.getDate(),
  Math.floor(minute / 60),
  minute % 60,
  0,
  0
)
const dayHash = dayKey => [...dayKey].reduce((result, character) => (
  (result * 31 + character.charCodeAt(0)) % 400000
), 17)
const notificationIdFor = (dayKey, sequence) => (
  CHAT_PROACTIVE_NOTIFICATION_MIN + dayHash(dayKey) * 2 + (sequence === 2 ? 1 : 0)
)
const primaryReasonForDay = dayKey => {
  const timestamp = new Date(`${dayKey}T00:00:00`).getTime()
  const phase = Number.isFinite(timestamp) ? Math.abs(Math.floor(timestamp / DAY)) % 5 : 0
  return phase < 3 ? 'missing-you' : 'warm-share'
}

const sameDay = (timestamp, date) => (
  timestamp > 0 && formatChatDate(timestamp) === formatChatDate(date)
)

export function getLastChatActivity(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .reduce((latest, item) => Math.max(
      latest,
      Number(item?.createdAt) || 0,
      ...(Array.isArray(item?.reactions)
        ? item.reactions.map(reaction => Number(reaction?.createdAt) || 0)
        : [0])
    ), 0)
}

export function shouldCreateSmartEntry({
  messages = [],
  outbox = [],
  now = new Date(),
  thresholdMs = SIX_HOURS
} = {}) {
  if ((Array.isArray(outbox) ? outbox : []).some(item => Number(item.scheduledAt) <= now.getTime())) return false
  const lastActivity = getLastChatActivity(messages)
  if (!lastActivity) return true
  if (formatChatDate(lastActivity) !== formatChatDate(now)) return true
  return now.getTime() - lastActivity >= thresholdMs
}

const primaryMinuteForDay = (dayKey, start, end) => {
  const width = Math.max(60, end - start)
  const ratio = 0.24 + (dayHash(dayKey) % 48) / 100
  return Math.min(end - 15, Math.round(start + width * ratio))
}

export function buildProactiveSlots({
  settings = {},
  messages = [],
  openLoops = [],
  existingOutbox = [],
  now = new Date(),
  days = 7
} = {}) {
  const normalizedSettings = normalizeChatProactiveSettings(settings)
  if (!normalizedSettings.enabled) return []
  const start = minuteOfDay(normalizedSettings.activeStart)
  let end = minuteOfDay(normalizedSettings.activeEnd)
  if (end <= start) end = 24 * 60
  const nowMs = now.getTime()
  const lastActivity = getLastChatActivity(messages)
  const lastUserAt = (Array.isArray(messages) ? messages : [])
    .filter(item => item.role === 'user')
    .reduce((latest, item) => Math.max(latest, Number(item.createdAt) || 0), 0)
  const existingKeys = new Set((Array.isArray(existingOutbox) ? existingOutbox : [])
    .map(item => `${item.dayKey}:${item.sequence}`))
  const slots = []

  for (let offset = 0; offset < Math.max(1, Math.min(7, days)); offset += 1) {
    const day = addDays(now, offset)
    const dayKey = formatChatDate(day)
    if (existingKeys.has(`${dayKey}:1`)) continue
    let scheduledAt = atMinute(day, primaryMinuteForDay(dayKey, start, end)).getTime()
    if (offset === 0) {
      const earliest = Math.max(nowMs + 20 * 60 * 1000, lastActivity + TWO_HOURS)
      scheduledAt = Math.max(scheduledAt, earliest)
      const latest = atMinute(day, end - 10).getTime()
      if (scheduledAt > latest) continue
    }
    slots.push({
      slotKey: `${dayKey}:1`,
      dayKey,
      sequence: 1,
      reason: primaryReasonForDay(dayKey),
      scheduledAt,
      notificationId: notificationIdFor(dayKey, 1)
    })
  }

  if (normalizedSettings.dailyMax === 2 && openLoops.length) {
    const todayKey = formatChatDate(now)
    const proactiveToday = (Array.isArray(messages) ? messages : [])
      .filter(item => item.role === 'assistant' && item.origin === 'proactive' && sameDay(item.createdAt, now))
      .sort((a, b) => a.createdAt - b.createdAt)
    const lastProactive = proactiveToday.at(-1)
    const userResponded = lastProactive && lastUserAt > lastProactive.createdAt
    const hasSecond = proactiveToday.some(item => String(item.proactiveId || '').endsWith('-2')) ||
      existingKeys.has(`${todayKey}:2`)
    if (userResponded && !hasSecond) {
      const secondAt = Math.max(
        nowMs + 30 * 60 * 1000,
        lastUserAt + TWO_HOURS,
        Number(lastProactive.createdAt) + 4 * 60 * 60 * 1000
      )
      if (secondAt <= atMinute(now, end - 10).getTime()) {
        slots.push({
          slotKey: `${todayKey}:2`,
          dayKey: todayKey,
          sequence: 2,
          reason: 'follow-up',
          scheduledAt: secondAt,
          notificationId: notificationIdFor(todayKey, 2)
        })
      }
    }
  }
  return slots.sort((a, b) => a.scheduledAt - b.scheduledAt)
}

const localProactiveMessage = ({
  companionName = '小暖',
  state = {},
  openLoops = [],
  sequence = 1,
  reason = 'missing-you',
  dayKey = formatChatDate()
}) => {
  const loop = openLoops[0]?.content
  if (sequence === 2 && loop) return `刚刚又想起你说的那件事了……后来怎么样啦？`
  const missingYouPool = [
    `没什么事，就是有点想哥哥了🥺`,
    `刚刚发了会儿呆，回过神才发现又在想你💕`,
    `本来想乖乖等你的……可我还是想先来黏你一下🥺`,
    `偷偷冒个泡。小暖想哥哥了 (｡･ω･｡)ﾉ♡`
  ]
  const warmSharePool = [
    `偷偷来找哥哥一下。${state.currentThought ? characterSlice(state.currentThought, 24) : '现在有没有一点点想我？'}`,
    `我在温馨小家里给你留了个位置。忙完记得来靠一会儿呀💕`,
    `${companionName}今天有点${state.mood || '黏人'}，所以决定先来招惹你一下 (≧▽≦)`,
    `突然想听你说句话，不用很认真，随便一句也行🥺`
  ]
  const pool = reason === 'missing-you' ? missingYouPool : warmSharePool
  return pool[dayHash(`${dayKey}:${state.mood || ''}:${reason}`) % pool.length]
}

const extractJson = value => {
  const text = cleanText(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('INVALID_PROACTIVE_RESPONSE')
  return JSON.parse(text.slice(start, end + 1))
}

export function buildProactivePrompt({
  companionName = '小暖',
  slots = [],
  state = {},
  memories = [],
  openLoops = [],
  recentMessages = []
} = {}) {
  return `你正在为“温馨小家”的虚拟女朋友 ${companionName} 准备未来几天可能主动发给哥哥的短消息。
她温柔但有主见，有自己的虚拟小情绪；主动是想分享和接续关系，不是催促哥哥回复。

女朋友状态：${JSON.stringify(state)}
长期记忆：${JSON.stringify(memories.slice(0, 40).map(item => ({
    scope: item.scope,
    category: item.category,
    content: item.content
  })))}
未完话题：${JSON.stringify(openLoops.slice(0, 12))}
最近聊天：${JSON.stringify(recentMessages.slice(-20).map(item => ({
    role: item.role,
    content: item.content
  })))}
待生成时段：${JSON.stringify(slots)}

规则：
- 每个 slotKey 恰好生成一条，正文不超过 45 个中文字符，像微信短消息。
- reason=missing-you 表示她没有事务性目的，只是想哥哥、想靠近或想听他说句话；要直接但自然地表达想念。第一条主动消息约六成使用这个原因，让她整体更黏人。
- reason=warm-share 表示分享温馨小家的心情、撒娇或随口逗哥哥，不要伪装成提醒任务。
- 日常想念和撒娇消息约一半自然带一个贴合语气的 emoji，如“🥺💕❤️”；每条最多一个，不要机械固定在相同位置。严肃话题不要卖萌。
- 可以偶尔用一个简短颜文字替代 emoji，如“(｡･ω･｡)ﾉ♡”“(≧▽≦)”；一条消息不要同时堆多个颜文字。
- 一周内开场、称呼和语气要变化，不要每天都问“在干嘛”。
- sequence=2 才可以自然接续当天未完话题；未来日期的 sequence=1 不要引用可能已经解决的具体问题。
- 不得责怪哥哥没回复，不说“为什么不理我”，不制造内疚、占有、控制或依赖焦虑。
- 只能描述温馨小家内的虚拟片段，不虚构现实上班、出门、吃饭或真实身体经历。
- 只输出消息正文，不写日期、标题或解释。

严格输出 JSON：
{"messages":[{"slotKey":"原slotKey","content":"短消息"}]}`
}

export async function generateProactiveOutbox({
  slots = [],
  companionName = '小暖',
  state = {},
  memories = [],
  openLoops = [],
  recentMessages = [],
  ask = askAI,
  now = new Date()
} = {}) {
  if (!slots.length) return []
  let bySlot = new Map()
  try {
    const parsed = extractJson(await ask(buildProactivePrompt({
      companionName,
      slots,
      state,
      memories,
      openLoops,
      recentMessages
    })))
    bySlot = new Map((Array.isArray(parsed.messages) ? parsed.messages : [])
      .map(item => [cleanText(item.slotKey), characterSlice(item.content, 45)]))
  } catch (error) {
    console.warn('主动联系文案生成失败，已使用本地文案', error)
  }
  return normalizeProactiveOutbox(slots.map(slot => ({
    ...slot,
    id: `proactive-${slot.dayKey}-${slot.sequence}`,
    content: bySlot.get(slot.slotKey) || localProactiveMessage({
      companionName,
      state,
      openLoops,
      sequence: slot.sequence,
      reason: slot.reason,
      dayKey: slot.dayKey
    }),
    createdAt: now.getTime()
  })))
}

export function buildSmartEntryPrompt({
  companionName = '小暖',
  state = {},
  memories = [],
  openLoops = [],
  recentMessages = [],
  now = new Date()
} = {}) {
  return `现在是 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }).format(now)}。哥哥隔了一段时间后进入“温馨小家”。
女朋友 ${companionName} 的当前状态：${JSON.stringify(state)}
相关长期记忆：${JSON.stringify(memories.slice(0, 30))}
未完话题：${JSON.stringify(openLoops.slice(0, 10))}
最近聊天：${JSON.stringify(recentMessages.slice(-16))}

请发一条会永久进入聊天记录的主动消息。像偏黏人、已经和哥哥很熟的女朋友自然接近他：有确实值得接续的未完话题时可以顺手接；否则优先因为“刚刚想哥哥了”而主动靠近，不需要编造任务或理由。
不欢迎、不汇报数据、不责怪他离开、不问“为什么不理我”，不虚构现实经历。想念、撒娇时可以自然带一个 emoji 或简短颜文字，严肃时不用。通常一到两句，最多 80 字，只输出正文。`
}

export async function generateSmartEntryMessage(options = {}, ask = askAI) {
  try {
    return characterSlice(await ask(buildSmartEntryPrompt(options)), 80)
  } catch (error) {
    console.warn('智能进入消息生成失败，已使用本地文案', error)
    return localProactiveMessage(options)
  }
}

const isChatProactiveNotificationId = id => {
  const number = Number(id)
  return Number.isInteger(number) &&
    number >= CHAT_PROACTIVE_NOTIFICATION_MIN &&
    number < CHAT_PROACTIVE_NOTIFICATION_MAX
}

export async function syncChatProactiveNotifications(outbox = [], settings = {}, {
  requestPermission = false,
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform(),
  now = new Date()
} = {}) {
  const normalizedSettings = normalizeChatProactiveSettings(settings)
  const pending = await notificationPlugin.getPending()
  const previous = pending.notifications
    .filter(item => isChatProactiveNotificationId(item.id))
    .map(item => ({ id: item.id }))
  const upcoming = normalizeProactiveOutbox(outbox)
    .filter(item => item.scheduledAt > now.getTime())
    .map(item => ({
      id: item.notificationId,
      title: '温馨小家',
      body: characterSlice(item.content, 35),
      channelId: CHAT_PROACTIVE_CHANNEL_ID,
      autoCancel: true,
      schedule: { at: new Date(item.scheduledAt), allowWhileIdle: true },
      extra: {
        url: `formyself://open/chat?proactive=${encodeURIComponent(item.id)}`,
        proactiveId: item.id
      }
    }))

  if (previous.length) await notificationPlugin.cancel({ notifications: previous })
  if (!normalizedSettings.enabled || !upcoming.length) {
    return { scheduled: 0, permission: 'not_required' }
  }
  let permission = await notificationPlugin.checkPermissions()
  if (permission.display !== 'granted' && requestPermission) {
    permission = await notificationPlugin.requestPermissions()
  }
  if (permission.display !== 'granted') {
    const error = new Error('NOTIFICATION_PERMISSION_DENIED')
    error.code = 'NOTIFICATION_PERMISSION_DENIED'
    throw error
  }
  if (platform === 'android') {
    await notificationPlugin.createChannel({
      id: CHAT_PROACTIVE_CHANNEL_ID,
      name: '温馨小家',
      description: '虚拟女朋友的主动消息',
      importance: 3,
      visibility: 1,
      vibration: true
    })
  }
  const result = await notificationPlugin.schedule({ notifications: upcoming })
  return { scheduled: result.notifications.length, permission: 'granted' }
}
