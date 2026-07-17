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
        schedule: {
          on: { hour, minute },
          allowWhileIdle: true
        },
        extra: { reminderType: key }
      }
    })
}

export function getReminderIds() {
  return Object.values(REMINDER_DEFINITIONS).map(item => ({ id: item.id }))
}
