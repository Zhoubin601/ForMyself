import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { normalizeFollowupOutbox } from './chatRecords.js'
import { CHAT_PROACTIVE_CHANNEL_ID } from './chatProactive.js'

export const CHAT_FOLLOWUP_NOTIFICATION_MIN = 823000000
export const CHAT_FOLLOWUP_NOTIFICATION_MAX = 824000000
const cleanText = value => String(value || '').trim()
const characterSlice = (value, length) => Array.from(cleanText(value)).slice(0, length).join('')
const stableHash = value => [...String(value || '')].reduce((result, character) => (
  (result * 31 + character.charCodeAt(0)) % 900000
), 19)

export function createDelayedFollowup({
  sourceMessageId = '',
  content = '',
  intentBrief = '',
  delaySeconds = 30,
  now = Date.now()
} = {}) {
  const scheduledAt = now + Math.max(10, Math.min(90, Number(delaySeconds) || 30)) * 1000
  const id = `followup-${sourceMessageId || now}-${scheduledAt}`
  return normalizeFollowupOutbox([{
    id,
    sourceMessageId,
    content,
    intentBrief,
    scheduledAt,
    notificationId: CHAT_FOLLOWUP_NOTIFICATION_MIN + stableHash(id),
    createdAt: now
  }])[0] || null
}

const isFollowupNotificationId = id => {
  const number = Number(id)
  return Number.isInteger(number) &&
    number >= CHAT_FOLLOWUP_NOTIFICATION_MIN &&
    number < CHAT_FOLLOWUP_NOTIFICATION_MAX
}

export async function syncChatFollowupNotifications(outbox = [], settings = {}, options = {}) {
  const enabled = settings.enabled ?? settings.followupEnabled !== false
  const {
    requestPermission = false,
    notificationPlugin = LocalNotifications,
    platform = Capacitor.getPlatform(),
    now = new Date()
  } = options
  const pending = await notificationPlugin.getPending()
  const previous = pending.notifications
    .filter(item => isFollowupNotificationId(item.id))
    .map(item => ({ id: item.id }))
  if (previous.length) await notificationPlugin.cancel({ notifications: previous })
  const upcoming = enabled
    ? normalizeFollowupOutbox(outbox)
      .filter(item => item.scheduledAt > now.getTime())
      .map(item => ({
        id: item.notificationId,
        title: '温馨小家',
        body: characterSlice(item.content, 50),
        channelId: CHAT_PROACTIVE_CHANNEL_ID,
        autoCancel: true,
        schedule: { at: new Date(item.scheduledAt), allowWhileIdle: true },
        extra: {
          url: `formyself://open/chat?proactive=${encodeURIComponent(item.id)}`,
          proactiveId: item.id,
          followupId: item.id
        }
      }))
    : []
  if (!upcoming.length) return { scheduled: 0, permission: 'not_required' }
  let permission = await notificationPlugin.checkPermissions()
  if (permission.display !== 'granted' && requestPermission) {
    permission = await notificationPlugin.requestPermissions()
  }
  if (permission.display !== 'granted') {
    return { scheduled: 0, permission: 'denied' }
  }
  if (platform === 'android') {
    await notificationPlugin.createChannel({
      id: CHAT_PROACTIVE_CHANNEL_ID,
      name: '温馨小家',
      description: '虚拟女朋友的主动消息与自然补话',
      importance: 3,
      visibility: 1,
      vibration: true
    })
  }
  const result = await notificationPlugin.schedule({ notifications: upcoming })
  return { scheduled: result.notifications.length, permission: 'granted' }
}
