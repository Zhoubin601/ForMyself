import { moduleRegistry } from '../application/moduleRegistry.js'

export const APP_VIEWS = Object.freeze(moduleRegistry.list.map(m => m.id))

const cleanText = value => String(value || '').trim()

export function normalizeAppRoute(value = {}, fallbackView = 'home', registry = moduleRegistry) {
  const source = typeof value === 'string' ? { view: value } : (value || {})
  const view = registry.has(source.view) ? source.view : fallbackView
  const settingsScope = view === 'settings' && (source.settingsScope === 'general' || registry.settings.has(source.settingsScope))
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
    todoTarget: view === 'todo' ? { item: cleanText(source.todoTarget?.item), date: cleanText(source.todoTarget?.date) } : { item: '', date: '' },
    scrollTop: Math.max(0, Number(source.scrollTop) || 0)
  }
}

export function appRouteKey(value, registry = moduleRegistry) {
  const route = normalizeAppRoute(value, 'home', registry)
  return [
    route.view,
    route.settingsScope,
    route.settingsSection,
    route.scheduleTarget.item,
    route.scheduleTarget.occurrence,
    route.todoTarget.item,
    route.todoTarget.date
  ].join('|')
}

export const isSameAppRoute = (left, right, registry = moduleRegistry) => appRouteKey(left, registry) === appRouteKey(right, registry)

export function pushAppRoute(stack = [], current, target, maxEntries = 30, registry = moduleRegistry) {
  const next = Array.isArray(stack) ? stack.map(item => normalizeAppRoute(item, 'home', registry)) : []
  const normalizedCurrent = normalizeAppRoute(current, 'home', registry)
  const normalizedTarget = normalizeAppRoute(target, normalizedCurrent.view, registry)
  if (isSameAppRoute(normalizedCurrent, normalizedTarget, registry)) return next
  if (!next.length || !isSameAppRoute(next.at(-1), normalizedCurrent, registry)) next.push(normalizedCurrent)
  return next.slice(-Math.max(1, Number(maxEntries) || 30))
}

export function popAppRoute(stack = [], registry = moduleRegistry) {
  const next = Array.isArray(stack) ? stack.map(item => normalizeAppRoute(item, 'home', registry)) : []
  const route = next.pop() || null
  return { route, stack: next }
}
