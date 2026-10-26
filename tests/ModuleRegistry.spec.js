import { describe, expect, it, vi } from 'vitest'
import { createModuleRegistry, moduleRegistry } from '../src/application/moduleRegistry.js'
import { createAppNavigation } from '../src/application/appNavigation.js'
import { createModuleLifecycle, createListenerScope } from '../src/application/moduleLifecycle.js'

const descriptor = { id: 'synthetic', title: 'Synthetic module', settings: 'Synthetic settings', loadView: async () => ({}) }
describe('registered modules and lifecycle', () => {
  it('new ordinary module navigates, opens its settings and restores scroll/back without shell changes', () => {
    const registry = createModuleRegistry([...moduleRegistry.list, descriptor])
    const navigation = createAppNavigation({ registry })
    expect(registry.menu({}).find(m => m.id === 'synthetic').label).toBe('Synthetic module')
    navigation.updateCurrentRouteScroll(180); navigation.switchView('synthetic')
    expect(navigation.currentView.value).toBe('synthetic')
    navigation.openModuleSettings('synthetic'); expect(navigation.settingsScope.value).toBe('synthetic')
    navigation.goBack(); expect(navigation.currentView.value).toBe('synthetic')
    navigation.goBack(); expect(navigation.currentView.value).toBe('home'); expect(navigation.currentRoute.value.scrollTop).toBe(180)
  })
  it('duplicate or malformed modules fail explicitly', () => {
    expect(() => createModuleRegistry([descriptor, descriptor])).toThrow('INVALID_MODULE')
    expect(() => createModuleRegistry([{ ...descriptor, loadView: null }])).toThrow('INVALID_MODULE')
    expect(() => createModuleRegistry([{ ...descriptor, access: 'unsupported' }])).toThrow('INVALID_MODULE_ACCESS')
    expect(() => createModuleRegistry([{ ...descriptor, settings: true }])).toThrow('INVALID_MODULE_CAPABILITY')
  })
  it('synthetic lifecycle initializes once, flushes/resumes and unsubscribes exactly once', async () => {
    const cleanup = vi.fn(), module = { id: 'synthetic', initialize: vi.fn(), resume: vi.fn(), flush: vi.fn(), subscribe: vi.fn(() => cleanup), dispose: vi.fn() }
    const lifecycle = createModuleLifecycle([module])
    await Promise.all([lifecycle.initialize(), lifecycle.initialize()]); expect(module.initialize).toHaveBeenCalledTimes(1)
    await lifecycle.resume(); await lifecycle.flush(); expect(module.resume).toHaveBeenCalledTimes(1); expect(module.flush).toHaveBeenCalledTimes(1)
    lifecycle.dispose(); lifecycle.dispose(); expect(cleanup).toHaveBeenCalledTimes(1); expect(module.dispose).toHaveBeenCalledTimes(1)
    await lifecycle.resume(); expect(module.resume).toHaveBeenCalledTimes(1)
    await expect(lifecycle.initialize()).rejects.toThrow('DISPOSED')
  })
  it('disposing while initialization is pending never creates a late subscription', async () => {
    let finish
    const subscribe = vi.fn(), lifecycle = createModuleLifecycle([{ id: 'late', initialize: () => new Promise(resolve => { finish = resolve }), subscribe }])
    const task = lifecycle.initialize(); await Promise.resolve(); lifecycle.dispose(); finish(); await task
    expect(subscribe).not.toHaveBeenCalled()
  })
  it('failed flush is reported and does not hide other module results', async () => {
    const other = vi.fn(), lifecycle = createModuleLifecycle([{ id: 'fail', flush: async () => { throw new Error('disk') } }, { id: 'other', flush: other }])
    const results = await lifecycle.flush(); expect(results[0].status).toBe('rejected'); expect(other).toHaveBeenCalledTimes(1)
  })
  it('late native registration is removed even after the shell has unmounted', async () => {
    let resolve
    const remove = vi.fn(), scope = createListenerScope()
    const task = scope.listen({ addListener: () => new Promise(done => { resolve = done }) }, 'event', vi.fn())
    scope.dispose(); resolve({ remove }); await task; expect(remove).toHaveBeenCalledTimes(1)
    scope.dispose(); expect(remove).toHaveBeenCalledTimes(1)
  })
  it('a failed native event does not disable URL or privacy events', async () => {
    const callbacks = new Map(), remove = vi.fn(), scope = createListenerScope()
    const plugin = { addListener: vi.fn(async (event, callback) => {
      if (event === 'backButton') throw new Error('unsupported back event')
      callbacks.set(event, callback)
      return { remove }
    }) }
    const url = vi.fn(), state = vi.fn()
    const results = await scope.listenMany(plugin, { backButton: vi.fn(), appUrlOpen: url, appStateChange: state })
    callbacks.get('appUrlOpen')({ url: 'formyself://open/todo' })
    callbacks.get('appStateChange')({ isActive: false })
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(url).toHaveBeenCalledWith({ url: 'formyself://open/todo' })
    expect(state).toHaveBeenCalledWith({ isActive: false })
    scope.dispose(); expect(remove).toHaveBeenCalledTimes(2)
  })
  it('a pending native event does not delay the other event registrations', async () => {
    let finish
    const remove = vi.fn(), callbacks = new Map(), scope = createListenerScope()
    const plugin = { addListener: (event, callback) => {
      callbacks.set(event, callback)
      return event === 'backButton' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ remove })
    } }
    const state = vi.fn(), task = scope.listenMany(plugin, { backButton: vi.fn(), appUrlOpen: vi.fn(), appStateChange: state })
    callbacks.get('appStateChange')({ isActive: false })
    expect(state).toHaveBeenCalledOnce()
    expect([...callbacks.keys()]).toEqual(['backButton', 'appUrlOpen', 'appStateChange'])
    await Promise.resolve(); scope.dispose(); finish({ remove }); await task
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
