const handlers = []
let registrationOrder = 0

export function registerBackHandler(handler, options = {}) {
  if (typeof handler !== 'function') throw new TypeError('BACK_HANDLER_REQUIRED')
  const entry = {
    handler,
    isActive: typeof options.isActive === 'function' ? options.isActive : () => true,
    priority: Number(options.priority) || 0,
    order: ++registrationOrder
  }
  handlers.push(entry)
  return () => {
    const index = handlers.indexOf(entry)
    if (index >= 0) handlers.splice(index, 1)
  }
}

export async function dispatchBackAction() {
  const ordered = [...handlers].sort((left, right) => (
    right.priority - left.priority || right.order - left.order
  ))
  for (const entry of ordered) {
    if (!entry.isActive()) continue
    const handled = await entry.handler()
    if (handled !== false) return true
  }
  return false
}

export function resetBackHandlersForTests() {
  handlers.splice(0)
  registrationOrder = 0
}
