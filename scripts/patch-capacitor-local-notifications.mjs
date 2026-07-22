import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pluginFile = fileURLToPath(new URL(
  '../node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications/TimedNotificationPublisher.java',
  import.meta.url
))

const original = `            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                Logger.warn(
                    "Capacitor/LocalNotification",
                    "Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm."
                );
                alarmManager.set(AlarmManager.RTC, trigger, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent);
            }`

const patched = `            LocalNotification savedNotification = new NotificationStorage(context).getSavedNotification(Integer.toString(id));
            LocalNotificationSchedule savedSchedule = savedNotification != null ? savedNotification.getSchedule() : null;
            boolean allowWhileIdle = savedSchedule != null && savedSchedule.allowWhileIdle();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                Logger.warn(
                    "Capacitor/LocalNotification",
                    "Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm."
                );
                if (allowWhileIdle) {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent);
                } else {
                    alarmManager.set(AlarmManager.RTC, trigger, pendingIntent);
                }
            } else if (allowWhileIdle) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent);
            }`

const source = await readFile(pluginFile, 'utf8')
if (source.includes(patched)) {
  console.log('Capacitor Local Notifications wake-up patch already applied.')
} else if (source.includes(original)) {
  await writeFile(pluginFile, source.replace(original, patched), 'utf8')
  console.log('Applied Capacitor Local Notifications recurring wake-up patch.')
} else {
  throw new Error('Unsupported @capacitor/local-notifications source; recurring wake-up patch was not applied.')
}
