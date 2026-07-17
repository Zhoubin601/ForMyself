import { LocalNotifications } from '@capacitor/local-notifications'
import { buildReminderNotifications, getReminderIds } from './reminderSchedule'

export async function syncReminderNotifications(settings, { requestPermission = false, personalizedBodies = {} } = {}) {
  const notifications = buildReminderNotifications(settings, personalizedBodies)

  await LocalNotifications.cancel({ notifications: getReminderIds() })
  if (notifications.length === 0) return { scheduled: 0, permission: 'not_required' }

  let permission = await LocalNotifications.checkPermissions()
  if (permission.display !== 'granted' && requestPermission) {
    permission = await LocalNotifications.requestPermissions()
  }
  if (permission.display !== 'granted') {
    const error = new Error('NOTIFICATION_PERMISSION_DENIED')
    error.code = 'NOTIFICATION_PERMISSION_DENIED'
    throw error
  }

  const result = await LocalNotifications.schedule({ notifications })
  return { scheduled: result.notifications.length, permission: permission.display }
}

export async function getPendingReminderNotifications() {
  const pending = await LocalNotifications.getPending()
  const reminderIds = new Set(getReminderIds().map(item => item.id))
  return pending.notifications.filter(item => reminderIds.has(item.id))
}
