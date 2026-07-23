const APP_DEEP_LINK_PROTOCOL = 'formyself:'
const APP_DEEP_LINK_HOST = 'open'

const VIEW_ALIASES = Object.freeze({
  home: 'home',
  mood: 'mood',
  weight: 'weight',
  savings: 'debts',
  debts: 'debts',
  reports: 'reports'
})

export const getViewFromAppUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== APP_DEEP_LINK_PROTOCOL || parsedUrl.hostname !== APP_DEEP_LINK_HOST) {
      return null
    }

    const target = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
    return VIEW_ALIASES[target] || null
  } catch {
    return null
  }
}
