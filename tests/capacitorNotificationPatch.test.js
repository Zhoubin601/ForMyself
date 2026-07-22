import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const publisherFile = new URL(
  '../node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications/TimedNotificationPublisher.java',
  import.meta.url
)

test('每日提醒原生重排继续使用可唤醒且允许休眠触发的精确闹钟', async () => {
  const source = await readFile(publisherFile, 'utf8')
  const rescheduleMethod = source.slice(source.indexOf('private boolean rescheduleNotificationIfNeeded'))
  assert.match(rescheduleMethod, /savedSchedule\.allowWhileIdle\(\)/)
  assert.match(rescheduleMethod, /setExactAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/)
  assert.match(rescheduleMethod, /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/)
})
