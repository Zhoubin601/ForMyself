import { computed, ref } from 'vue'
import { moduleRegistry } from './moduleRegistry.js'
import { appRouteKey, isSameAppRoute, normalizeAppRoute, popAppRoute, pushAppRoute } from '../services/navigationHistory.js'

export function createAppNavigation({ registry = moduleRegistry, filterRoute = route => route } = {}) {
  const currentView = ref('home')
  const settingsScope = ref('general')
  const settingsSection = ref('')
  const settingsReturnView = ref('home')
  const todoTarget = ref({ item: '', date: '' })
  const scheduleTarget = ref({ item: '', occurrence: '' })
  const isDrawerOpen = ref(false)
  const navigationStack = ref([])
  const navigationRevision = ref(0)
  const routeScrollTop = ref(0)
  const currentRoute = computed(() => normalizeAppRoute({
    view: currentView.value,
    settingsScope: settingsScope.value,
    settingsSection: settingsSection.value,
    scheduleTarget: scheduleTarget.value,
    todoTarget: todoTarget.value,
    scrollTop: routeScrollTop.value
  }, 'home', registry))
  const currentRouteKey = computed(() => appRouteKey(currentRoute.value, registry))
  const canGoBack = computed(() => navigationStack.value.length > 0)

  const applyRoute = value => {
    let route = normalizeAppRoute(value, currentView.value, registry)
    route = normalizeAppRoute(filterRoute(route), currentView.value, registry)
    currentView.value = route.view
    settingsScope.value = route.settingsScope
    settingsSection.value = route.settingsSection
    scheduleTarget.value = route.scheduleTarget
    todoTarget.value = route.todoTarget
    routeScrollTop.value = route.scrollTop
    isDrawerOpen.value = false
    navigationRevision.value += 1
    return route
  }
  const navigate = (value, options = {}) => {
    const target = normalizeAppRoute(value, currentView.value, registry)
    if (isSameAppRoute(currentRoute.value, target, registry)) {
      isDrawerOpen.value = false
      return false
    }
    if (!options.replace) {
      navigationStack.value = pushAppRoute(
        navigationStack.value,
        {
          ...currentRoute.value,
          scrollTop: options.currentScrollTop ?? currentRoute.value.scrollTop
        },
        target, 30, registry
      )
    }
    applyRoute(target)
    return true
  }
  const replaceRoute = value => navigate(value, { replace: true })
  const goBack = () => {
    const popped = popAppRoute(navigationStack.value, registry)
    if (!popped.route) return null
    navigationStack.value = popped.stack
    return applyRoute(popped.route)
  }
  const updateLastHistoryScroll = value => {
    if (!navigationStack.value.length) return
    const index = navigationStack.value.length - 1
    navigationStack.value[index] = {
      ...navigationStack.value[index],
      scrollTop: Math.max(0, Number(value) || 0)
    }
  }
  const updateCurrentRouteScroll = value => {
    routeScrollTop.value = Math.max(0, Number(value) || 0)
  }
  const switchView = view => navigate({ view, settingsScope: view === 'settings' ? 'general' : undefined })
  const openGeneralSettingsSection = section => navigate({
    view: 'settings',
    settingsScope: 'general',
    settingsSection: section
  })
  const closeGeneralSettingsSection = () => {
    if (settingsScope.value !== 'general' || !settingsSection.value) return false
    if (canGoBack.value) return !!goBack()
    return replaceRoute({ view: 'settings', settingsScope: 'general' })
  }
  const openModuleSettings = scope => {
    if (!registry.settings.has(scope)) return
    settingsReturnView.value = currentView.value
    navigate({ view: 'settings', settingsScope: scope })
  }
  const closeModuleSettings = () => {
    if (canGoBack.value) return goBack()
    const target = settingsReturnView.value || settingsScope.value || 'home'
    return replaceRoute({ view: target === 'settings' ? 'home' : target })
  }
  const openScheduleTarget = (target = {}) => {
    const nextTarget = {
      item: String(target.item || ''),
      occurrence: String(target.occurrence || '')
    }
    navigate({ view: 'schedule', scheduleTarget: nextTarget })
  }
  return { currentView, settingsScope, settingsSection, settingsReturnView, todoTarget, scheduleTarget, isDrawerOpen, navigationStack, navigationRevision, currentRoute, currentRouteKey, canGoBack, navigate, replaceRoute, goBack, updateLastHistoryScroll, updateCurrentRouteScroll, switchView, openGeneralSettingsSection, closeGeneralSettingsSection, openModuleSettings, closeModuleSettings, openScheduleTarget }
}
