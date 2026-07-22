export const REMINDER_DEFINITIONS = {
  mood: {
    id: 2101,
    title: '记录今天的心情',
    body: '给今天留下一点真实的感受吧。'
  },
  weight: {
    id: 2102,
    title: '记录今日体重',
    body: '保持相同时间记录，趋势会更有参考价值。'
  },
  savings: {
    id: 2103,
    title: '看看你的省钱计划',
    body: '一点点积累，也是在向目标靠近。'
  }
}

export const REMINDER_CHANNEL_ID = 'formyself-daily-reminders-v1'
export const REMINDER_SETUP_NOTIFICATION_ID = 2198
export const REMINDER_TEST_NOTIFICATION_ID = 2199

const REMINDER_LABELS = {
  mood: '心情',
  weight: '体重',
  savings: '省钱'
}

export const DEFAULT_REMINDER_SETTINGS = {
  mood: { enabled: false, time: '21:00', useAI: false },
  weight: { enabled: false, time: '08:00', useAI: false },
  savings: { enabled: false, time: '20:00', useAI: false }
}

export const EMPTY_NOTIFICATION_AI_CACHE = {
  mood: { body: '', fingerprint: '', generatedAt: '' },
  weight: { body: '', fingerprint: '', generatedAt: '' },
  savings: { body: '', fingerprint: '', generatedAt: '' }
}

export function normalizeNotificationAiCache(value = {}) {
  return Object.fromEntries(Object.keys(EMPTY_NOTIFICATION_AI_CACHE).map(key => [key, {
    body: String(value?.[key]?.body || '').trim().slice(0, 100),
    fingerprint: String(value?.[key]?.fingerprint || ''),
    generatedAt: String(value?.[key]?.generatedAt || '')
  }]))
}

export function getPersonalizedReminderBodies(cache = {}) {
  const normalized = normalizeNotificationAiCache(cache)
  return Object.fromEntries(Object.entries(normalized)
    .filter(([, item]) => item.body)
    .map(([key, item]) => [key, item.body]))
}

export function normalizeReminderTime(value, fallback = '20:00') {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fallback
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeReminderSettings(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_REMINDER_SETTINGS).map(([key, defaults]) => {
    const item = value?.[key] || {}
    return [key, {
      enabled: item.enabled === true,
      time: normalizeReminderTime(item.time, defaults.time),
      useAI: item.useAI === true
    }]
  }))
}

export function buildReminderNotifications(settings, personalizedBodies = {}) {
  const normalized = normalizeReminderSettings(settings)
  return Object.entries(normalized)
    .filter(([, item]) => item.enabled)
    .map(([key, item]) => {
      const [hour, minute] = item.time.split(':').map(Number)
      const definition = REMINDER_DEFINITIONS[key]
      return {
        id: definition.id,
        title: definition.title,
        body: item.useAI && personalizedBodies[key]
          ? String(personalizedBodies[key]).trim().slice(0, 100)
          : definition.body,
        channelId: REMINDER_CHANNEL_ID,
        autoCancel: true,
        schedule: {
          on: { hour, minute },
          allowWhileIdle: true
        },
        extra: { reminderType: key }
      }
    })
}

export function buildReminderTestNotification() {
  return {
    id: REMINDER_TEST_NOTIFICATION_ID,
    title: 'ForMyself 通知测试',
    body: '如果你看到这条消息，说明本机通知权限和通知渠道工作正常。',
    channelId: REMINDER_CHANNEL_ID,
    autoCancel: true,
    extra: { reminderType: 'test' }
  }
}

export function buildReminderSetupNotification(settings) {
  const normalized = normalizeReminderSettings(settings)
  const enabled = Object.entries(normalized).filter(([, item]) => item.enabled)
  const summary = enabled.map(([key, item]) => `${REMINDER_LABELS[key]} ${item.time}`).join('、')
  return {
    id: REMINDER_SETUP_NOTIFICATION_ID,
    title: '每日提醒已设置',
    body: summary ? `已开启 ${enabled.length} 项提醒：${summary}` : '当前没有开启每日提醒。',
    channelId: REMINDER_CHANNEL_ID,
    autoCancel: true,
    extra: { reminderType: 'setup-confirmation' }
  }
}

export function getReminderIds() {
  return Object.values(REMINDER_DEFINITIONS).map(item => ({ id: item.id }))
}
