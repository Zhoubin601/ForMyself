import {
  buildReminderContexts,
  buildReminderPrompt,
  getReminderContextFingerprint
} from './reminderContext.js'
import {
  getPersonalizedReminderBodies,
  normalizeNotificationAiCache,
  normalizeReminderSettings
} from './reminderSchedule.js'

export async function refreshPersonalizedReminderContent({
  settings,
  cache,
  data,
  hasApiKey,
  force = false,
  ask = null
}) {
  const normalizedSettings = normalizeReminderSettings(settings)
  const contexts = buildReminderContexts(data)
  const nextCache = normalizeNotificationAiCache(cache)
  const errors = []
  let generated = 0

  for (const type of Object.keys(normalizedSettings)) {
    const option = normalizedSettings[type]
    if (!option.enabled || !option.useAI) continue

    const fingerprint = getReminderContextFingerprint(contexts[type])
    if (!force && nextCache[type].body && nextCache[type].fingerprint === fingerprint) continue
    if (!hasApiKey) {
      errors.push({ type, code: 'MISSING_KEY' })
      continue
    }

    try {
      const askFn = ask || (await import('./aiEngine.js')).askAI
      const answer = await askFn(buildReminderPrompt(type, contexts[type]))
      const body = String(answer).replace(/[“”"\n\r]/g, '').trim().slice(0, 100)
      if (!body) throw new Error('EMPTY_RESPONSE')
      nextCache[type] = {
        body,
        fingerprint,
        generatedAt: new Date().toISOString()
      }
      generated++
    } catch (error) {
      errors.push({ type, code: error.message || 'AI_ERROR' })
    }
  }

  return {
    cache: nextCache,
    bodies: getPersonalizedReminderBodies(nextCache),
    generated,
    errors
  }
}
