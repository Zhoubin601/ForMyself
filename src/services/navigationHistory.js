export const APP_VIEWS = Object.freeze([
  'home',
  'reports',
  'debts',
  'weight',
  'mood',
  'chat',
  'schedule',
  'passwords',
  'settings'
])

const APP_VIEW_SET = new Set(APP_VIEWS)
const SETTINGS_SCOPES = new Set(['general', 'debts', 'weight', 'mood', 'schedule', 'passwords', 'chat'])

const cleanText = value => String(value || '').trim()

export function normalizeAppRoute(value = {}, fallbackView = 'home') {
  const source = typeof value === 'string' ? { view: value } : (value || {})
  const view = APP_VIEW_SET.has(source.view) ? source.view : fallbackView
  const settingsScope = view === 'settings' && SETTINGS_SCOPES.has(source.settingsScope)
    ? source.settingsScope
    : 'general'

  return {
    view,
    settingsScope,
    settingsSection: view === 'settings' && settingsScope === 'general'
      ? cleanText(source.settingsSection)
      : '',
    scheduleTarget: view === 'schedule'
      ? {
          item: cleanText(source.scheduleTarget?.item),
          occurrence: cleanText(source.scheduleTarget?.occurrence)
        }
      : { item: '', occurrence: '' },
    scrollTop: Math.max(0, Number(source.scrollTop) || 0)
  }
}

export function appRouteKey(value) {
  const route = normalizeAppRoute(value)
  return [
    route.view,
    route.settingsScope,
    route.settingsSection,
    route.scheduleTarget.item,
    route.scheduleTarget.occurrence
  ].join('|')
}

export const isSameAppRoute = (left, right) => appRouteKey(left) === appRouteKey(right)

export function pushAppRoute(stack = [], current, target, maxEntries = 30) {
  const next = Array.isArray(stack) ? stack.map(item => normalizeAppRoute(item)) : []
  const normalizedCurrent = normalizeAppRoute(current)
  const normalizedTarget = normalizeAppRoute(target, normalizedCurrent.view)
  if (isSameAppRoute(normalizedCurrent, normalizedTarget)) return next
  if (!next.length || !isSameAppRoute(next.at(-1), normalizedCurrent)) next.push(normalizedCurrent)
  return next.slice(-Math.max(1, Number(maxEntries) || 30))
}

export function popAppRoute(stack = []) {
  const next = Array.isArray(stack) ? stack.map(item => normalizeAppRoute(item)) : []
  const route = next.pop() || null
  return { route, stack: next }
}
