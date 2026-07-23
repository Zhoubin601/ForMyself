import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { buildScheduleNotifications } from './scheduleCore.js'

export const SCHEDULE_NOTIFICATION_CHANNEL_ID = 'formyself-schedule-notification-v1'
const LEGACY_SCHEDULE_ALARM_CHANNEL_ID = 'formyself-schedule-alarm-v1'

const CHANNELS = [
  {
    id: SCHEDULE_NOTIFICATION_CHANNEL_ID,
    name: '日程提醒',
    description: '日程和待办的普通通知提醒',
    importance: 4,
    visibility: 0,
    vibration: true,
    lights: true,
    lightColor: '#ff4d55'
  }
]

const isScheduleNotificationId = id =>
  Number.isInteger(Number(id)) && Number(id) >= 300000000 && Number(id) < 800000000

const scheduleNotificationError = (code, message = code) => {
  const error = new Error(message)
  error.code = code
  return error
}

async function ensurePermission(plugin, requestPermission) {
  let permission = await plugin.checkPermissions()
  if (permission.display !== 'granted' && requestPermission) {
    permission = await plugin.requestPermissions()
  }
  if (permission.display !== 'granted') {
    const error = new Error('NOTIFICATION_PERMISSION_DENIED')
    error.code = 'NOTIFICATION_PERMISSION_DENIED'
    throw error
  }
}

export async function syncScheduleNotifications(data, {
  requestPermission = false,
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform(),
  now = new Date()
} = {}) {
  const notifications = buildScheduleNotifications(data, now)
  const pending = await notificationPlugin.getPending()
  const previous = pending.notifications
    .filter(item => isScheduleNotificationId(item.id))
    .map(item => ({ id: item.id }))

  if (!notifications.length) {
    if (previous.length) await notificationPlugin.cancel({ notifications: previous })
    return { scheduled: 0, pending: 0, permission: 'not_required' }
  }

  await ensurePermission(notificationPlugin, requestPermission)
  if (platform === 'android') {
    await Promise.all(CHANNELS.map(channel => notificationPlugin.createChannel(channel)))
    if (typeof notificationPlugin.deleteChannel === 'function') {
      await notificationPlugin.deleteChannel({ id: LEGACY_SCHEDULE_ALARM_CHANNEL_ID }).catch(() => {})
    }
  }
  if (previous.length) await notificationPlugin.cancel({ notifications: previous })
  const result = await notificationPlugin.schedule({ notifications })
  const refreshedPending = await notificationPlugin.getPending()
  const pendingIds = new Set(
    refreshedPending.notifications
      .filter(item => isScheduleNotificationId(item.id))
      .map(item => Number(item.id))
  )
  const missingIds = notifications
    .map(item => item.id)
    .filter(id => !pendingIds.has(Number(id)))
  if (missingIds.length) {
    throw scheduleNotificationError(
      'SCHEDULE_NOTIFICATION_VERIFY_FAILED',
      `系统未保留日程提醒任务：${missingIds.join(',')}`
    )
  }
  return {
    scheduled: result.notifications.length,
    pending: pendingIds.size,
    permission: 'granted'
  }
}
