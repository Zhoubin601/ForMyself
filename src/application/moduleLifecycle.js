// @ts-check
/** @param {import('./contracts').LifecycleParticipant[]} participants */
export function createModuleLifecycle(participants) {
  if (new Set(participants.map(p => p.id)).size !== participants.length) throw new Error('DUPLICATE_LIFECYCLE_MODULE')
  /** @type {Promise<PromiseSettledResult<unknown>[]> | undefined} */
  let initialized
  let disposed = false
  /** @type {Array<() => void>} */
  const cleanups = []
  const call = (/** @type {'initialize'|'resume'|'flush'} */ method) => Promise.allSettled(participants.map(p => Promise.resolve().then(() => p[method]?.())))
  return {
    initialize() {
      if (disposed) return Promise.reject(new Error('LIFECYCLE_DISPOSED'))
      if (!initialized) initialized = call('initialize').then(results => {
        if (!disposed) for (const p of participants) {
          const cleanup = p.subscribe?.()
          if (cleanup) cleanups.push(cleanup)
        }
        return results
      })
      return initialized
    },
    resume: () => disposed ? Promise.resolve([]) : call('resume'),
    flush: () => call('flush'),
    dispose() {
      if (disposed) return
      disposed = true
      cleanups.splice(0).reverse().forEach(cleanup => cleanup())
      participants.forEach(p => p.dispose?.())
    }
  }
}

export function createListenerScope() {
  let disposed = false
  /** @type {Set<import('./contracts').NativeListenerHandle>} */
  const handles = new Set()
  return {
    async listen(/** @type {import('./contracts').NativeListenerPlugin} */ plugin, /** @type {string} */ event, /** @type {(...args: any[]) => unknown} */ listener) {
      const handle = await plugin.addListener(event, listener)
      if (disposed) await handle.remove()
      else handles.add(handle)
    },
    dispose() { disposed = true; handles.forEach(handle => { void handle.remove() }); handles.clear() }
  }
}
