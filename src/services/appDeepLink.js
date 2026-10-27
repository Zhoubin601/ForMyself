import { moduleRegistry } from '../application/moduleRegistry.js'
const APP_DEEP_LINK_PROTOCOL = 'formyself:'
const APP_DEEP_LINK_HOST = 'open'

const VIEW_ALIASES = Object.freeze({ ...Object.fromEntries(moduleRegistry.list.filter(m => !['settings', 'passwords'].includes(m.id)).map(m => [m.id, m.id])), savings: 'debts' })

export const getRouteFromAppUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null

  try {
    const input = url.trim()
    if (!/^formyself:\/\//i.test(input)) return null
    // Older Android WebViews treat custom schemes as opaque paths (empty host).
    // Validate our scheme first, then use the standard HTTPS authority parser.
    const parsedUrl = new URL(`https:${input.slice(APP_DEEP_LINK_PROTOCOL.length)}`)
    if (parsedUrl.hostname !== APP_DEEP_LINK_HOST) {
      return null
    }

    const target = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
    const view = VIEW_ALIASES[target]
    if (!view) return null
    if (view === 'schedule') {
      return {
        view,
        item: parsedUrl.searchParams.get('item') || '',
        occurrence: parsedUrl.searchParams.get('occurrence') || ''
      }
    }
    if (view === 'todo') return { view, item: parsedUrl.searchParams.get('item') || '', date: parsedUrl.searchParams.get('date') || '' }
    if (view === 'chat') {
      return {
        view,
        proactive: parsedUrl.searchParams.get('proactive') || ''
      }
    }
    return { view }
  } catch {
    return null
  }
}

export const getViewFromAppUrl = url => getRouteFromAppUrl(url)?.view || null
