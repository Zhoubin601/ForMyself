export function createProtectedModuleRegistry(modules) {
  const byId = new Map()
  for (const module of modules) {
    if (!module.id || byId.has(module.id) || typeof module.resolve !== 'function' || typeof module.load !== 'function') throw new Error('INVALID_PROTECTED_MODULE')
    byId.set(module.id, module)
  }
  const ids = Object.freeze([...byId.keys()])
  return Object.freeze({ ids, has: id => byId.has(id), async resolve(id) {
    const module = byId.get(id)
    if (!module) throw new Error('UNKNOWN_PROTECTED_MODULE')
    const store = await module.resolve()
    for (const method of ['release', 'reencrypt', 'suspendPersistence', 'flush']) {
      if (typeof store[method] !== 'function') throw new Error('INVALID_PROTECTED_RUNTIME')
    }
    return { store, load: password => module.load(store, password), release: () => store.release(),
      reencrypt: password => store.reencrypt(password), flush: () => store.flush(), suspendPersistence: () => store.suspendPersistence(),
      get isDataLoaded() { return store.isDataLoaded }, get loadError() { return store.loadError }, get saveError() { return store.saveError } }
  } })
}
export const protectedModules = createProtectedModuleRegistry([
  { id: 'passwords', resolve: async () => (await import('../stores/passwordVault.js')).usePasswordVaultStore(), load: (store, password) => store.loadRecords(password) },
  { id: 'chat', resolve: async () => (await import('../features/chat/kanataStore.js')).useKanataStore(), load: (store, password) => store.load(password) }
])
