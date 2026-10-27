import { moduleRegistry } from '../application/moduleRegistry.js'
import { createModuleLifecycle, createListenerScope } from '../application/moduleLifecycle.js'
import { ordinaryModuleRuntimes } from '../application/ordinaryModules.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { computed, nextTick, onBeforeUnmount, ref, onMounted, watch, watchEffect } from 'vue'
import { StatusBar } from '@capacitor/status-bar'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useAuthStore } from '../stores/auth'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { App as CapacitorApp } from '@capacitor/app'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../features/mood/moodStore'
import { useDebtStore } from '../stores/debt'
import { useWeightStore } from '../stores/weight'
import { useTodoStore } from '../features/todo/todoStore.js'
import { TodoNative } from '../features/todo/todoRepository.js'
import { Capacitor } from '@capacitor/core'
import { useScheduleStore } from '../features/schedule/scheduleStore'
import { shouldLockOnBackground, shouldLockOnResume } from '../services/autoLockPolicy'
import {
  consumeNativeActivityGuard,
  isNativeActivityGuardActive
} from '../services/nativeActivityGuard'
import { syncReminderNotifications } from '../services/notificationService'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule'
import { refreshPersonalizedReminderContent } from '../services/notificationPersonalizer'
import { getRouteFromAppUrl } from '../services/appDeepLink'
import { refreshHomeWidget } from '../services/homeWidget'
import { syncScheduleNotifications } from '../features/schedule/scheduleNotificationService'
import { appAlert, appToast } from '../services/uiFeedback'
import { dispatchBackAction } from '../services/backNavigation'
import { afterNextPaint, afterTwoPaints, markAppPerformance, measureAppPerformance } from '../services/appPerformance.js'

export function useAppController() {
  const authStore = useAuthStore()
  const settingsStore = useSettingsStore()
  const moodStore = useMoodStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const scheduleStore = useScheduleStore()
  const todoStore = useTodoStore()
  const runtimeModules = ordinaryModuleRuntimes({
    debtStore, weightStore, moodStore, scheduleStore, todoStore, settingsStore,
    onLifeChange: () => { queueReminderPersonalizationRefresh(); queueHomeWidgetRefresh() },
    onScheduleChange: () => queueScheduleRefresh()
  })
  const ordinaryData = runtimeModules.filter(module => module.store).map(module => ({
    id: module.id, title: moduleRegistry.get(module.id).label || moduleRegistry.get(module.id).title,
    store: module.store, load: module.initialize
  }))
  const aggregateReady = () => !restoreState.blocked && [moodStore, weightStore, debtStore].every(store => store.isDataLoaded && !store.saveError)
  const refreshSafeHomeWidget = data => aggregateReady() ? refreshHomeWidget(data) : Promise.resolve(false)
  const syncSafeScheduleNotifications = data => !restoreState.blocked && scheduleStore.isDataLoaded && !scheduleStore.saveError
    ? syncScheduleNotifications(data) : Promise.resolve(false)
  const dataIssues = computed(() => [...ordinaryData.flatMap(({ id, title, store, load }) => {
    if (store.loadError) return [{ id, title, message: store.loadError, action: '重试读取', retry: load }]
    if (store.saveError) return [{ id, title, message: store.saveError, action: '重试保存', retry: () => store.retrySave() }]
    if (store.saveStatus === 'saving') return [{ id, title, message: '正在保存…' }]
    return []
  }), ...protectedAccess.persistenceIssues.map(issue => ({ ...issue, title: moduleRegistry.get(issue.id).title }))])
  const dataReady = computed(() => {
    if (restoreState.blocked) return false
    const view = settingsStore.currentView === 'settings' ? settingsStore.settingsScope : settingsStore.currentView
    if (['home', 'reports'].includes(view)) return ordinaryData.every(({ store }) => store.isDataLoaded)
    return ordinaryData.find(item => item.id === view)?.store.isDataLoaded ?? true
  })
  const chatUnreadCount = ref(0)
  const chatUnreadLabel = computed(() => (
    chatUnreadCount.value > 99 ? '99+' : String(chatUnreadCount.value || '')
  ))
  const hasEnteredApp = ref(false)
  const protectedAccess = useProtectedAccessStore()
  const protectedModule = computed(() => {
    if (moduleRegistry.get(settingsStore.currentView)?.access === 'protected') return settingsStore.currentView
    if (settingsStore.currentView === 'settings') {
      if (moduleRegistry.get(settingsStore.settingsScope)?.access === 'protected') return settingsStore.settingsScope
      if (settingsStore.settingsSection === 'labels') return 'passwords'
    }
    return null
  })
  const protectedDataStatus = computed(() => protectedModule.value
    ? protectedAccess.status[protectedModule.value]
    : (protectedAccess.moduleIds.every(id => protectedAccess.status[id] === 'ready') ? 'ready' : 'idle'))
  const isUnlocking = ref(false)
  const showBiometricSetup = ref(false)
  const isEnablingBiometric = ref(false)
  const appWrapperRef = ref(null)
  const authLoadPromise = authStore.isDataLoaded ? Promise.resolve() : authStore.loadAuthData({ checkBiometric: false })
  let vaultStore = null
  let chatStore = null
  let stopUnreadWatch = null
  let pendingChatRoute = null
  let biometricSetupDismissed = false
  let lastHomeBackAt = 0

  watch(() => authStore.isLocked, isLocked => {
    if (!isLocked) hasEnteredApp.value = true
    else showBiometricSetup.value = false
  }, { immediate: true })

  watch(() => authStore.needsBiometricSetup, needsSetup => {
    if (needsSetup && authStore.savedMasterPwd && !authStore.isLocked && !biometricSetupDismissed) showBiometricSetup.value = true
    if (!needsSetup) showBiometricSetup.value = false
  })

  watchEffect(() => {
    if (typeof document === 'undefined') return
    Object.entries({ ...settingsStore.themeCssVariables, ...settingsStore.componentCssVariables }).forEach(([name, value]) => {
      document.documentElement.style.setProperty(name, value)
    })
  })

  const pwdInput = ref('')
  const showPassword = ref(false)
  const moduleSettingsViews = moduleRegistry.settings
  const drawerItems = computed(() => moduleRegistry.menu({ warmHomeEnabled: settingsStore.warmHomeEnabled }))
  let backgroundedAt = null
  let reminderRefreshTimer = null
  let reminderResumeTimer = null
  let widgetRefreshTimer = null
  let scheduleSyncTimer = null
  let startupIdleHandle = null
  let todoClockCleanup = () => {}

  const resyncStoredReminders = () => syncReminderNotifications(settingsStore.notificationSettings, {
    personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
  })

  const refreshReminderPersonalization = async (force = false) => {
    if (!aggregateReady()) return
    const result = await refreshPersonalizedReminderContent({
      settings: settingsStore.notificationSettings,
      cache: settingsStore.notificationAiContent,
      data: {
        moodRecords: moodStore.moodRecords,
        moodDefinitions: moodStore.moodDefinitions,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      },
      hasApiKey: !!settingsStore.aiApiKey?.trim(),
      force
    })
    settingsStore.notificationAiContent = result.cache
    await syncReminderNotifications(settingsStore.notificationSettings, { personalizedBodies: result.bodies })
  }

  const queueReminderPersonalizationRefresh = () => {
    clearTimeout(reminderRefreshTimer)
    reminderRefreshTimer = setTimeout(() => {
      refreshReminderPersonalization().catch(error => {
        if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') console.warn('刷新个性化提醒失败', error)
      })
    }, 1200)
  }

  const queueHomeWidgetRefresh = () => {
    clearTimeout(widgetRefreshTimer)
    widgetRefreshTimer = setTimeout(() => {
      refreshSafeHomeWidget({
        moodRecords: moodStore.moodRecords,
        moodDefinitions: moodStore.moodDefinitions,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      }).catch(error => console.warn('刷新桌面小组件失败', error))
    }, 350)
  }

  const loadProtectedRuntime = async modules => {
    if (modules.includes('passwords') && !vaultStore) {
      vaultStore = await protectedAccess.getRuntimeStore('passwords')
    }
    if (modules.includes('chat') && !chatStore) {
      chatStore = await protectedAccess.getRuntimeStore('chat')
      stopUnreadWatch = watch(() => protectedAccess.status.chat === 'ready' ? chatStore.unreadCount : 0, value => {
        chatUnreadCount.value = value
      }, { immediate: true })
    }
    return { vaultStore, chatStore }
  }

  const applyPendingChatRoute = () => {
    if (!settingsStore.warmHomeEnabled) { pendingChatRoute = null; return }
    if (!chatStore || protectedAccess.status.chat !== 'ready' || !pendingChatRoute) return
    chatStore.materializeDueProactive(Date.now())
    chatStore.materializeDueFollowups(Date.now())
    chatStore.setPendingFocusProactiveId(pendingChatRoute.proactive)
    pendingChatRoute = null
  }

  const openAppUrl = (url) => {
    const route = getRouteFromAppUrl(url)
    if (!route) return
    if (route.view === 'todo') settingsStore.navigate({ view:'todo', todoTarget:{ item:route.item, date:route.date } })
    else if (route.view === 'schedule') settingsStore.openScheduleTarget(route)
    else {
      if (route.view === 'chat') {
        if (!settingsStore.warmHomeEnabled) {
          appToast('温馨小家入口已关闭，可在设置中重新开启')
          return
        }
        pendingChatRoute = route
        applyPendingChatRoute()
      }
      settingsStore.switchView(route.view)
    }
  }

  watch(() => settingsStore.navigationRevision, async () => {
    await nextTick()
    if (appWrapperRef.value) appWrapperRef.value.scrollTop = settingsStore.currentRoute.scrollTop || 0
  })

  const handleAppScroll = event => {
    settingsStore.updateCurrentRouteScroll(event.currentTarget?.scrollTop || 0)
  }

  const handleAppBack = async () => {
    if (await dispatchBackAction()) return true
    if (authStore.isLocked) {
      try {
        await CapacitorApp.exitApp()
      } catch (error) {
        console.warn('当前环境无法退出应用', error)
      }
      return true
    }
    if (settingsStore.isDrawerOpen) {
      settingsStore.isDrawerOpen = false
      return true
    }
    if (settingsStore.goBack()) return true
    if (settingsStore.currentView !== 'home') {
      settingsStore.replaceRoute({ view: 'home' })
      return true
    }

    const now = Date.now()
    if (now - lastHomeBackAt <= 2000) {
      try {
        await CapacitorApp.exitApp()
      } catch (error) {
        console.warn('当前环境无法退出应用', error)
      }
      return true
    }
    lastHomeBackAt = now
    appToast('再按一次返回键退出', { duration: 2000 })
    return true
  }

  const handleAppKeydown = async event => {
    if (event.key !== 'Escape' || authStore.isLocked) return
    if (await dispatchBackAction()) return
    if (settingsStore.isDrawerOpen) {
      settingsStore.isDrawerOpen = false
    }
  }

  const resyncChatProactive = async () => {
    if (restoreState.blocked) return
    if (settingsStore.warmHomeEnabled && (protectedAccess.status.chat !== 'ready' || !chatStore)) return
    const [{ syncChatProactiveNotifications }, { syncChatFollowupNotifications }] = await Promise.all([
      import('../features/chat/chatProactive.js'),
      import('../features/chat/chatFollowup.js')
    ])
    if (settingsStore.warmHomeEnabled && (protectedAccess.status.chat !== 'ready' || !chatStore)) return
    if (settingsStore.warmHomeEnabled) {
      chatStore.materializeDueProactive(Date.now())
      chatStore.materializeDueFollowups(Date.now())
    } else {
      pendingChatRoute = null
      chatStore?.pauseWarmHome()
    }
    await Promise.all([
      syncChatProactiveNotifications(
        chatStore?.proactiveOutbox || [],
        chatStore?.proactiveSettings || {},
        { requestPermission: false, now: new Date(), isFeatureEnabled: () => settingsStore.warmHomeEnabled }
      ),
      syncChatFollowupNotifications(
        chatStore?.followupOutbox || [],
        chatStore?.realismSettings || {},
        { requestPermission: false, now: new Date(), isFeatureEnabled: () => settingsStore.warmHomeEnabled }
      )
    ])
  }

  watch(() => settingsStore.warmHomeEnabled, enabled => {
    if (!enabled) {
      pendingChatRoute = null
      chatStore?.pauseWarmHome()
      if (settingsStore.currentView === 'chat' || (settingsStore.currentView === 'settings' && settingsStore.settingsScope === 'chat')) {
        settingsStore.replaceRoute({ view: 'settings', settingsScope: 'general', settingsSection: 'appearance' })
      }
    }
    resyncChatProactive().catch(error => {
      console.warn('同步温馨小家开关失败', error)
      appToast('温馨小家通知同步失败，请重新打开应用重试', { tone: 'warning' })
    })
  })

  const queueScheduleRefresh = () => {
    clearTimeout(scheduleSyncTimer)
    scheduleSyncTimer = setTimeout(() => {
      Promise.all([
        syncSafeScheduleNotifications(scheduleStore.snapshot),
        refreshSafeHomeWidget({
          moodRecords: moodStore.moodRecords,
          moodDefinitions: moodStore.moodDefinitions,
          weightRecords: weightStore.weightRecords,
          savedDebts: debtStore.savedDebts
        })
      ]).catch(error => {
        if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') console.warn('刷新日程服务失败', error)
      })
    }, 350)
  }

  const runStartupSync = async () => {
    const tasks = [
      resyncChatProactive(),
      refreshSafeHomeWidget({
        moodRecords: moodStore.moodRecords,
        moodDefinitions: moodStore.moodDefinitions,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      }),
      syncSafeScheduleNotifications(scheduleStore.snapshot),
      todoStore.syncReminders(),
      resyncStoredReminders()
    ]
    const results = await Promise.allSettled(tasks)
    results.forEach(result => {
      if (result.status !== 'rejected') return
      if (result.reason?.code !== 'NOTIFICATION_PERMISSION_DENIED') {
        console.warn('启动后的后台同步失败', result.reason)
      }
    })
  }

  const queueStartupSync = () => {
    const execute = () => {
      startupIdleHandle = null
      runStartupSync().catch(error => console.warn('启动后的后台同步失败', error))
    }
    if (typeof window.requestIdleCallback === 'function') {
      startupIdleHandle = window.requestIdleCallback(execute, { timeout: 1200 })
    } else {
      startupIdleHandle = window.setTimeout(execute, 80)
    }
  }

  const lifecycle = createModuleLifecycle(runtimeModules)
  const listeners = createListenerScope()
  const handleAppStateChange = ({ isActive }) => {
    if (!isActive) {
      const nativeActivityGuarded = isNativeActivityGuardActive()
      backgroundedAt = nativeActivityGuarded ? null : Date.now()
      Promise.all([chatStore?.flush() || Promise.resolve(), lifecycle.flush().then(results => {
        const failed = results.find(result => result.status === 'rejected')
        if (failed) throw failed.reason
      })]).catch(error => console.warn('进入后台时保存数据失败', error))
      if (!nativeActivityGuarded && shouldLockOnBackground(settingsStore.autoLockDelaySeconds)) {
        authStore.expireSession({ lockApp: settingsStore.requireAppUnlock })
      }
      return
    }

    const nativeActivityGuarded = consumeNativeActivityGuard()
    if (
      !nativeActivityGuarded &&
      shouldLockOnResume(settingsStore.autoLockDelaySeconds, backgroundedAt, Date.now())
    ) {
      authStore.expireSession({ lockApp: settingsStore.requireAppUnlock })
    }
    backgroundedAt = null
    void lifecycle.resume()
    if (protectedAccess.status.chat === 'ready') {
      resyncChatProactive().catch(error => console.warn('恢复应用后同步温馨小家主动联系失败', error))
    }

    // Android 从“闹钟和提醒”权限页返回时，权限状态传播可能稍晚于 Activity 恢复。
    // 延迟重新调度，确保旧的非精确任务被 exact alarm 替换，无需用户重启应用。
    clearTimeout(reminderResumeTimer)
    reminderResumeTimer = setTimeout(() => {
      resyncStoredReminders().catch(error => {
        if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') console.warn('恢复应用后同步通知提醒失败', error)
      })
    }, 500)
  }

  onMounted(async () => {
    // Capacitor's Web factory creates an instance on first use; resolve it once
    // before concurrent subscriptions so all events share that instance.
    if (!Capacitor.isNativePlatform()) {
      try { await CapacitorApp.getState() } catch (error) { console.warn('浏览器应用事件初始化失败', error) }
    }
    const appEvents = {
      backButton: handleAppBack,
      appUrlOpen: ({ url }) => openAppUrl(url),
      appStateChange: handleAppStateChange
    }
    // A pending or failed registration must not disable other native events.
    void listeners.listenMany(CapacitorApp, appEvents).then(results => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') console.warn(`无法监听应用事件 ${Object.keys(appEvents)[index]}`, result.reason)
      })
    })
    try {
      const launchUrl = await CapacitorApp.getLaunchUrl()
      openAppUrl(launchUrl?.url)
    } catch (error) {
      console.warn('无法处理应用快捷入口', error)
    }

    window.addEventListener('keydown', handleAppKeydown)
    const todoDayTimer = window.setInterval(() => {
      if (todoStore.today !== new Date().toLocaleDateString('sv-SE')) void todoStore.load().then(() => todoStore.syncReminders())
    }, 30000)
    todoClockCleanup = () => window.clearInterval(todoDayTimer)

    try {
      await StatusBar.show()
      await StatusBar.setOverlaysWebView({ overlay: true })
    } catch {
      console.warn('浏览器环境中无法设置状态栏')
    }

    await authLoadPromise
    await nextTick()
    await afterNextPaint()
    markAppPerformance('app:lock-ready')
    measureAppPerformance('app:boot-to-lock-ready', 'app:boot-start', 'app:lock-ready')
    authStore.refreshBiometricAvailability().catch(() => {})

    await lifecycle.initialize()
    if (Capacitor.getPlatform() === 'android') await listeners.listen(TodoNative, 'changed', () => { void todoStore.load() })
    queueStartupSync()

    try {
      await listeners.listen(LocalNotifications, 'localNotificationActionPerformed', ({ notification }) => {
        const url = notification?.extra?.url
        if (url) openAppUrl(url)
      })
      await listeners.listen(LocalNotifications, 'localNotificationReceived', ({ extra }) => {
        if (!chatStore || protectedAccess.status.chat !== 'ready') return
        if (extra?.followupId) chatStore.materializeDueFollowups(Date.now())
        else if (extra?.proactiveId) chatStore.materializeDueProactive(Date.now())
      })
    } catch (error) {
      console.warn('无法监听通知点击或接收', error)
    }
  })

  onBeforeUnmount(() => {
    lifecycle.dispose()
    listeners.dispose()
    ;[reminderRefreshTimer, reminderResumeTimer, widgetRefreshTimer, scheduleSyncTimer].forEach(clearTimeout)
    window.removeEventListener('keydown', handleAppKeydown)
    stopUnreadWatch?.()
    todoClockCleanup()
    if (startupIdleHandle !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(startupIdleHandle)
      else window.clearTimeout(startupIdleHandle)
    }
  })

  const ensureProtectedDataReady = async (modules = protectedAccess.moduleIds) => {
    const session = authStore.sessionRevision
    const ok = await protectedAccess.ensureModules(modules)
    if (!ok || session !== authStore.sessionRevision) return false
    await loadProtectedRuntime(modules)
    if (session !== authStore.sessionRevision) return false
    if (modules.includes('chat')) {
      applyPendingChatRoute()
      resyncChatProactive().catch(() => {})
    }
    return true
  }

  const retryProtectedModule = () => {
    if (protectedModule.value && !authStore.isLocked) void ensureProtectedDataReady([protectedModule.value])
  }
  watch([protectedModule, () => authStore.isLocked, () => settingsStore.navigationRevision], ([module, locked]) => {
    if (module && !locked) retryProtectedModule()
  }, { immediate: true })

  const scheduleProtectedDataLoad = () => {
    if (restoreState.blocked) { void retryFullRecovery(); return }
    const start = () => ensureProtectedDataReady().catch(() => {})
    afterTwoPaints(start)
  }

  const finishUnlock = async () => {
    pwdInput.value = ''
    await nextTick()
    afterNextPaint().then(() => {
      markAppPerformance('unlock:home-paint')
      measureAppPerformance('unlock:to-home-paint', 'unlock:start', 'unlock:home-paint')
      if (settingsStore.requireAppUnlock) scheduleProtectedDataLoad()
      showBiometricSetup.value = Boolean(authStore.savedMasterPwd) && authStore.needsBiometricSetup && !biometricSetupDismissed
    })
  }

  const runUnlock = async action => {
    if (isUnlocking.value) return false
    isUnlocking.value = true
    markAppPerformance('unlock:start')
    await nextTick()
    await afterNextPaint()
    try {
      const ok = await action()
      markAppPerformance('unlock:verified')
      measureAppPerformance('unlock:verify', 'unlock:start', 'unlock:verified')
      if (ok) await finishUnlock()
      return ok
    } catch (error) {
      console.error('安全解锁失败', error)
      return false
    } finally {
      isUnlocking.value = false
    }
  }

  const unlockApp = async () => {
    const ok = await runUnlock(() => authStore.unlockWithPassword(pwdInput.value))
    if (!ok) appAlert('密码验证未通过，请重试', { title: '暂时无法解锁' })
  }

  const unlockWithBiometric = async () => {
    await runUnlock(() => authStore.unlockWithBiometric())
  }

  const setMasterPassword = async () => {
    const ok = await runUnlock(() => authStore.setMasterPassword(pwdInput.value))
    if (!ok) appAlert('安全主密码请勿少于 4 位数', { title: '主密码太短' })
  }

  const dismissBiometricSetup = () => {
    biometricSetupDismissed = true
    showBiometricSetup.value = false
  }

  const enableBiometricUnlock = async () => {
    if (isEnablingBiometric.value) return
    isEnablingBiometric.value = true
    try {
      if (!await protectedAccess.authenticate()) return
      if (await authStore.enableBiometricUnlock()) {
        showBiometricSetup.value = false
        appToast('指纹快捷解锁已启用', { tone: 'success' })
      } else {
        appAlert('未能启用指纹快捷解锁，请确认系统已录入指纹')
      }
    } finally {
      isEnablingBiometric.value = false
    }
  }

  const retryFullRecovery = async () => {
    if (restoreState.busy) return
    try {
      if (!await protectedAccess.prepareRecovery()) return
      const { createFullBackupRuntime } = await import('../application/fullBackupRuntime.js')
      const runtime = createFullBackupRuntime()
      await protectedAccess.runOperation(protectedAccess.moduleIds, password => runtime.recover(password), { recovering: true })
    } catch { appToast(restoreState.message || '恢复失败，请保留应用数据并重试', { tone: 'danger' }) }
  }
  const retryRestoreSync = async () => {
    const { createFullBackupRuntime } = await import('../application/fullBackupRuntime.js')
    await createFullBackupRuntime().retrySynchronization()
  }

  return {
    restoreState, retryFullRecovery, retryRestoreSync,
    dataIssues,
    dataReady,
    appWrapperRef,
    authStore,
    chatUnreadCount,
    chatUnreadLabel,
    dismissBiometricSetup,
    drawerItems,
    enableBiometricUnlock,
    ensureProtectedDataReady,
    handleAppScroll,
    hasEnteredApp,
    isEnablingBiometric,
    isUnlocking,
    moduleSettingsViews,
    protectedDataStatus,
    protectedModule,
    protectedAccess,
    retryProtectedModule,
    pwdInput,
    setMasterPassword,
    settingsStore,
    showBiometricSetup,
    showPassword,
    unlockApp,
    unlockWithBiometric
  }
}
