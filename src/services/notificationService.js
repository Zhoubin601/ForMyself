import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import {
  buildReminderNotifications,
  buildReminderSetupNotification,
  buildReminderTestNotification,
  getReminderIds,
  REMINDER_CHANNEL_ID,
  REMINDER_SETUP_NOTIFICATION_ID,
  REMINDER_TEST_NOTIFICATION_ID
} from './reminderSchedule.js'
import { buildWeightChangeNotification } from './weightInsights.js'

const REMINDER_CHANNEL = {
  id: REMINDER_CHANNEL_ID,
  name: '每日提醒',
  description: '心情、体重和省钱计划的每日提醒',
  importance: 4,
  visibility: 0,
  vibration: true,
  lights: true,
  lightColor: '#0066CC'
}

const notificationError = (code, message = code) => {
  const error = new Error(message)
  error.code = code
  return error
}

async function ensureDisplayPermission(notificationPlugin, requestPermission) {
  let permission = await notificationPlugin.checkPermissions()
  if (permission.display !== 'granted' && requestPermission) {
    permission = await notificationPlugin.requestPermissions()
  }
  if (permission.display !== 'granted') {
    throw notificationError('NOTIFICATION_PERMISSION_DENIED')
  }
  return permission.display
}

async function ensureReminderChannel(notificationPlugin, platform) {
  if (platform !== 'android') return
  await notificationPlugin.createChannel(REMINDER_CHANNEL)
}

async function readExactAlarmSetting(notificationPlugin, platform) {
  if (platform !== 'android' || typeof notificationPlugin.checkExactNotificationSetting !== 'function') {
    return 'not_applicable'
  }
  try {
    return (await notificationPlugin.checkExactNotificationSetting()).exact_alarm
  } catch {
    return 'unknown'
  }
}

const getReminderPendingFrom = async notificationPlugin => {
  const pending = await notificationPlugin.getPending()
  const reminderIds = new Set(getReminderIds().map(item => item.id))
  return pending.notifications.filter(item => reminderIds.has(item.id))
}

export async function syncReminderNotifications(settings, {
  requestPermission = false,
  personalizedBodies = {},
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform()
} = {}) {
  const notifications = buildReminderNotifications(settings, personalizedBodies)

  if (notifications.length === 0) {
    await notificationPlugin.cancel({ notifications: getReminderIds() })
    return { scheduled: 0, pending: 0, permission: 'not_required' }
  }

  // 先确认权限和渠道，再替换系统任务；避免权限异常时误删已有提醒。
  const permission = await ensureDisplayPermission(notificationPlugin, requestPermission)
  await ensureReminderChannel(notificationPlugin, platform)
  const result = await notificationPlugin.schedule({ notifications })

  const enabledIds = new Set(notifications.map(item => item.id))
  const disabledIds = getReminderIds().filter(item => !enabledIds.has(item.id))
  if (disabledIds.length) await notificationPlugin.cancel({ notifications: disabledIds })

  const pending = await getReminderPendingFrom(notificationPlugin)
  const pendingIds = new Set(pending.map(item => item.id))
  const missingIds = notifications.map(item => item.id).filter(id => !pendingIds.has(id))
  if (missingIds.length) {
    throw notificationError('NOTIFICATION_SCHEDULE_VERIFY_FAILED', `系统未保留提醒任务：${missingIds.join(',')}`)
  }

  return { scheduled: result.notifications.length, pending: pending.length, permission }
}

export async function getPendingReminderNotifications(notificationPlugin = LocalNotifications) {
  return getReminderPendingFrom(notificationPlugin)
}

export async function getReminderNotificationStatus({
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform()
} = {}) {
  const permission = await notificationPlugin.checkPermissions()
  const pending = await getReminderPendingFrom(notificationPlugin)
  const exactAlarm = await readExactAlarmSetting(notificationPlugin, platform)
  return { permission: permission.display, pending, exactAlarm }
}

export async function requestExactReminderPermission({
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform()
} = {}) {
  const current = await readExactAlarmSetting(notificationPlugin, platform)
  if (current !== 'denied') return { exactAlarm: current, settingsOpened: false }
  if (typeof notificationPlugin.changeExactNotificationSetting !== 'function') {
    return { exactAlarm: current, settingsOpened: false }
  }

  const result = await notificationPlugin.changeExactNotificationSetting()
  const exactAlarm = result?.exact_alarm || await readExactAlarmSetting(notificationPlugin, platform)
  return { exactAlarm, settingsOpened: true }
}

export async function sendReminderTestNotification({
  requestPermission = true,
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform()
} = {}) {
  const permission = await ensureDisplayPermission(notificationPlugin, requestPermission)
  await ensureReminderChannel(notificationPlugin, platform)
  await notificationPlugin.cancel({ notifications: [{ id: REMINDER_TEST_NOTIFICATION_ID }] })
  const result = await notificationPlugin.schedule({ notifications: [buildReminderTestNotification()] })
  if (!result.notifications.some(item => item.id === REMINDER_TEST_NOTIFICATION_ID)) {
    throw notificationError('NOTIFICATION_TEST_FAILED')
  }
  return { sent: true, permission }
}

export async function sendReminderSetupConfirmation(settings, {
  notificationPlugin = LocalNotifications,
  platform = Capacitor.getPlatform()
} = {}) {
  if (!buildReminderNotifications(settings).length) {
    return { sent: false, reason: 'no_enabled_reminders' }
  }
  const permission = await ensureDisplayPermission(notificationPlugin, false)
  await ensureReminderChannel(notificationPlugin, platform)
  await notificationPlugin.cancel({ notifications: [{ id: REMINDER_SETUP_NOTIFICATION_ID }] })
  const notification = buildReminderSetupNotification(settings)
  const result = await notificationPlugin.schedule({ notifications: [notification] })
  if (!result.notifications.some(item => item.id === REMINDER_SETUP_NOTIFICATION_ID)) {
    throw notificationError('NOTIFICATION_CONFIRMATION_FAILED')
  }
  return { sent: true, permission }
}

export async function notifyWeightChange(notice) {
  const notification = buildWeightChangeNotification(notice)
  if (!notification) return { scheduled: false, reason: 'empty' }
  const permission = await LocalNotifications.checkPermissions()
  if (permission.display !== 'granted') return { scheduled: false, reason: 'permission' }
  await ensureReminderChannel(LocalNotifications, Capacitor.getPlatform())
  notification.channelId = REMINDER_CHANNEL_ID
  notification.autoCancel = true
  await LocalNotifications.cancel({ notifications: [{ id: notification.id }] })
  await LocalNotifications.schedule({ notifications: [notification] })
  return { scheduled: true, reason: 'scheduled' }
}
