import { askAI } from './aiEngine'
import { refreshPersonalizedReminderContentCore } from './notificationPersonalizerCore.js'

export async function refreshPersonalizedReminderContent({
  settings,
  cache,
  data,
  hasApiKey,
  force = false,
  ask = null
}) {
  return refreshPersonalizedReminderContentCore({
    settings,
    cache,
    data,
    hasApiKey,
    force,
    ask: ask || askAI
  })
}
