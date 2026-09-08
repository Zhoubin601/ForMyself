const MAX_ENTRIES = 60
const entries = []

const exposeEntries = () => {
  if (typeof window !== 'undefined') window.__FORMYSELF_PERFORMANCE__ = entries
}

export function markAppPerformance(name) {
  if (typeof performance === 'undefined') return
  performance.mark(name)
}

export function measureAppPerformance(name, startMark, endMark) {
  if (typeof performance === 'undefined') return null
  try {
    performance.measure(name, startMark, endMark)
    const measurement = performance.getEntriesByName(name, 'measure').at(-1)
    const entry = {
      name,
      duration: Math.round((measurement?.duration || 0) * 10) / 10,
      measuredAt: Date.now()
    }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
    exposeEntries()
    return entry
  } catch {
    return null
  }
}

export function getAppPerformanceEntries() {
  return entries.map(entry => ({ ...entry }))
}

export function afterNextPaint() {
  return new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(resolve)
    else setTimeout(resolve, 0)
  })
}

export function afterTwoPaints(callback) {
  afterNextPaint().then(afterNextPaint).then(callback)
}

exposeEntries()
