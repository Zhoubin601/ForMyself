import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { buildTodoNotifications } from './todoCore.js'
import { TodoNative } from './todoRepository.js'

export async function syncTodoNotifications(data, requestPermission = false, plugin = LocalNotifications, native = Capacitor.isNativePlatform()) {
  if (!native) return
  if (Capacitor.getPlatform() === 'android' && plugin === LocalNotifications) {
    const hasReminder = data.tasks.some(t => !t.archived && t.reminder) || data.overrides.some(o => o.changes.reminder && !o.cancelled)
    if (hasReminder && requestPermission) {
      const permission = await plugin.requestPermissions()
      if (permission.display !== 'granted') throw new Error('通知权限未开启，任务已保存')
    }
    // Remove v1 plugin alarms once before the native scheduler takes ownership.
    const old = (await plugin.getPending()).notifications.filter(n => n.id >= 800000000 && n.id < 900000000)
    if (old.length) await plugin.cancel({ notifications:old.map(n => ({id:n.id})) })
    await TodoNative.syncReminders()
    return
  }
  const notifications = buildTodoNotifications(data)
  const pending = (await plugin.getPending()).notifications.filter(n => n.id >= 800000000 && n.id < 900000000)
  if (notifications.length) {
    let permission = await plugin.checkPermissions()
    if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions()
    if (permission.display !== 'granted') throw Object.assign(new Error('通知权限未开启，任务已保存'), { code: 'NOTIFICATION_PERMISSION_DENIED' })
    await plugin.createChannel({ id: 'formyself-todo-v1', name: '每日待办', importance: 4, visibility: 0 })
  }
  if (pending.length) await plugin.cancel({ notifications: pending.map(n => ({ id: n.id })) })
  if (notifications.length) await plugin.schedule({ notifications })
}
