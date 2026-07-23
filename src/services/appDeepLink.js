const APP_DEEP_LINK_PROTOCOL = 'formyself:'
const APP_DEEP_LINK_HOST = 'open'

const VIEW_ALIASES = Object.freeze({
  home: 'home',
  mood: 'mood',
  weight: 'weight',
  savings: 'debts',
  debts: 'debts',
  reports: 'reports',
  schedule: 'schedule'
})

export const getRouteFromAppUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== APP_DEEP_LINK_PROTOCOL || parsedUrl.hostname !== APP_DEEP_LINK_HOST) {
      return null
    }

    const target = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
    const view = VIEW_ALIASES[target]
    if (!view) return null
    return {
      view,
      item: parsedUrl.searchParams.get('item') || '',
      occurrence: parsedUrl.searchParams.get('occurrence') || ''
    }
  } catch {
    return null
  }
}

export const getViewFromAppUrl = url => getRouteFromAppUrl(url)?.view || null
