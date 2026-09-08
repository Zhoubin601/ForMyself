import { computed, nextTick, onBeforeUnmount, ref, onMounted, watch, watchEffect } from 'vue'
import { StatusBar } from '@capacitor/status-bar'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useAuthStore } from '../stores/auth'
import { App as CapacitorApp } from '@capacitor/app'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../features/mood/moodStore'
import { useDebtStore } from '../stores/debt'
import { useWeightStore } from '../stores/weight'
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
  const chatUnreadCount = ref(0)
  const chatUnreadLabel = computed(() => (
    chatUnreadCount.value > 99 ? '99+' : String(chatUnreadCount.value || '')
  ))
  const hasEnteredApp = ref(false)
  const protectedDataStatus = ref('idle')
  const isUnlocking = ref(false)
  const showBiometricSetup = ref(false)
  const isEnablingBiometric = ref(false)
  const appWrapperRef = ref(null)
  const authLoadPromise = authStore.loadAuthData({ checkBiometric: false })
  let protectedLoadPromise = null
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
    if (needsSetup && !authStore.isLocked && !biometricSetupDismissed) showBiometricSetup.value = true
    if (!needsSetup) showBiometricSetup.value = false
  })

  watchEffect(() => {
    if (typeof document === 'undefined') return
    Object.entries(settingsStore.themeCssVariables || {}).forEach(([name, value]) => {
      document.documentElement.style.setProperty(name, value)
    })
  })

  const pwdInput = ref('')
  const showPassword = ref(false)
  const moduleSettingsViews = new Set(['debts', 'weight', 'mood', 'passwords', 'chat'])
  const drawerItems = [
    { id: 'home', label: '首页总览', meta: '今天', icon: 'M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-9Z' },
    { id: 'reports', label: '月度报告', meta: '回顾', icon: 'M4 19V10m5 9V5m6 14v-7m5 7H2' },
    { id: 'debts', label: '省钱计划', meta: '目标', icon: 'M4 7.5h15a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h12M16 13h5' },
    { id: 'weight', label: '体重记录', meta: '健康', icon: 'M6.3 7.4a7.5 7.5 0 1 1-1.5 4.6M8 8.3A5.7 5.7 0 0 1 16 8m-4 2 2.5-2.5' },
    { id: 'mood', label: '心情日记', meta: '感受', icon: 'M20.8 9.3c0 5-8.8 10.6-8.8 10.6S3.2 14.3 3.2 9.3A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.8 2.3Z' },
    { id: 'chat', label: '温馨小家', meta: '陪伴', icon: 'M4 11.2 12 4l8 7.2V20h-5v-5H9v5H4v-8.8Zm5.2-.4c0-2.3 2.8-3.1 3.8-1.1 1-2 3.8-1.2 3.8 1.1 0 2.1-3.8 4.3-3.8 4.3s-3.8-2.2-3.8-4.3Z' },
    { id: 'schedule', label: '日程提醒', meta: '安排', icon: 'M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 8h3m2 0h3m-8 4h3' },
    { id: 'passwords', label: '密码库', meta: '安全', icon: 'M7 10V8a5 5 0 0 1 10 0v2m-11 0h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v3' },
    { id: 'settings', label: '通用配置', meta: '设置', icon: 'M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6' }
  ]
  let backgroundedAt = null
  let reminderRefreshTimer = null
  let reminderResumeTimer = null
  let widgetRefreshTimer = null
  let scheduleSyncTimer = null
  let startupIdleHandle = null

  const resyncStoredReminders = () => syncReminderNotifications(settingsStore.notificationSettings, {
    personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
  })

  const refreshReminderPersonalization = async (force = false) => {
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
      refreshHomeWidget({
        moodRecords: moodStore.moodRecords,
        moodDefinitions: moodStore.moodDefinitions,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      }).catch(error => console.warn('刷新桌面小组件失败', error))
    }, 350)
  }

  const loadProtectedRuntime = async () => {
    if (vaultStore && chatStore) return { vaultStore, chatStore }
    const [vaultModule, chatModule] = await Promise.all([
      import('../stores/passwordVault.js'),
      import('../features/chat/chatStore.js')
    ])
    vaultStore = vaultModule.usePasswordVaultStore()
    chatStore = chatModule.useChatStore()
    if (!stopUnreadWatch) {
      stopUnreadWatch = watch(() => chatStore.unreadCount, value => {
        chatUnreadCount.value = value
      }, { immediate: true })
    }
    return { vaultStore, chatStore }
  }

  const applyPendingChatRoute = () => {
    if (!chatStore || !pendingChatRoute) return
    chatStore.materializeDueProactive(Date.now())
    chatStore.materializeDueFollowups(Date.now())
    chatStore.setPendingFocusProactiveId(pendingChatRoute.proactive)
    pendingChatRoute = null
  }

  const openAppUrl = (url) => {
    const route = getRouteFromAppUrl(url)
    if (!route) return
    if (route.view === 'schedule') settingsStore.openScheduleTarget(route)
    else {
      if (route.view === 'chat') {
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
    if (protectedDataStatus.value !== 'ready' || !chatStore) return
    const [{ syncChatProactiveNotifications }, { syncChatFollowupNotifications }] = await Promise.all([
      import('../features/chat/chatProactive.js'),
      import('../features/chat/chatFollowup.js')
    ])
    chatStore.materializeDueProactive(Date.now())
    chatStore.materializeDueFollowups(Date.now())
    await Promise.all([
      syncChatProactiveNotifications(
        chatStore.proactiveOutbox,
        chatStore.proactiveSettings,
        { requestPermission: false, now: new Date() }
      ),
      syncChatFollowupNotifications(
        chatStore.followupOutbox,
        chatStore.realismSettings,
        { requestPermission: false, now: new Date() }
      )
    ])
  }

  const queueScheduleRefresh = () => {
    clearTimeout(scheduleSyncTimer)
    scheduleSyncTimer = setTimeout(() => {
      Promise.all([
        syncScheduleNotifications(scheduleStore.snapshot),
        refreshHomeWidget({
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
      refreshHomeWidget({
        moodRecords: moodStore.moodRecords,
        moodDefinitions: moodStore.moodDefinitions,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      }),
      syncScheduleNotifications(scheduleStore.snapshot),
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

  onMounted(async () => {
    try {
      CapacitorApp.addListener('backButton', handleAppBack)
      CapacitorApp.addListener('appUrlOpen', ({ url }) => openAppUrl(url))
      const launchUrl = await CapacitorApp.getLaunchUrl()
      openAppUrl(launchUrl?.url)
    } catch (error) {
      console.warn('无法处理应用快捷入口', error)
    }

    window.addEventListener('keydown', handleAppKeydown)

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

    await Promise.all([
      settingsStore.loadSettings(),
      debtStore.loadDebts(),
      weightStore.loadWeightRecords(),
      moodStore.loadMoodRecords(),
      scheduleStore.loadSchedules()
    ])
    moodStore.$subscribe(queueReminderPersonalizationRefresh)
    weightStore.$subscribe(queueReminderPersonalizationRefresh)
    debtStore.$subscribe(queueReminderPersonalizationRefresh)
    moodStore.$subscribe(queueHomeWidgetRefresh)
    weightStore.$subscribe(queueHomeWidgetRefresh)
    debtStore.$subscribe(queueHomeWidgetRefresh)
    scheduleStore.$subscribe(queueScheduleRefresh)

    try {
      LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
        const url = notification?.extra?.url
        if (url) openAppUrl(url)
      })
      LocalNotifications.addListener('localNotificationReceived', ({ extra }) => {
        if (!chatStore) return
        if (extra?.followupId) chatStore.materializeDueFollowups(Date.now())
        else if (extra?.proactiveId) chatStore.materializeDueProactive(Date.now())
      })
    } catch (error) {
      console.warn('无法监听通知点击或接收', error)
    }

    try {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          const nativeActivityGuarded = isNativeActivityGuardActive()
          backgroundedAt = nativeActivityGuarded ? null : Date.now()
          Promise.all([
            chatStore?.flush() || Promise.resolve(),
            scheduleStore.persist(),
            settingsStore.flushPendingSettingsWrites()
          ]).catch(error => console.warn('进入后台时保存数据失败', error))
          if (!nativeActivityGuarded && shouldLockOnBackground(settingsStore.autoLockDelaySeconds)) {
            authStore.lockApp()
          }
          return
        }

        const nativeActivityGuarded = consumeNativeActivityGuard()
        if (
          !nativeActivityGuarded &&
          shouldLockOnResume(settingsStore.autoLockDelaySeconds, backgroundedAt, Date.now())
        ) {
          authStore.lockApp()
        }
        backgroundedAt = null
        if (moodStore.isDataLoaded) moodStore.autoFillMissingDays()
        queueScheduleRefresh()
        if (protectedDataStatus.value === 'ready') {
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
      })
    } catch (e) {
      console.warn('浏览器环境中无法监听 App 状态', e)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleAppKeydown)
    stopUnreadWatch?.()
    if (startupIdleHandle !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(startupIdleHandle)
      else window.clearTimeout(startupIdleHandle)
    }
  })

  const ensureProtectedDataReady = async () => {
    if (protectedDataStatus.value === 'ready') return true
    if (protectedLoadPromise) return protectedLoadPromise
    const password = authStore.savedMasterPwd
    if (!password) return false
    protectedDataStatus.value = 'loading'
    markAppPerformance('protected:load-start')
    protectedLoadPromise = (async () => {
      try {
        const runtime = await loadProtectedRuntime()
        await Promise.all([
          runtime.vaultStore.loadRecords(password),
          runtime.chatStore.loadChatData(password)
        ])
        if (runtime.vaultStore.loadError || runtime.chatStore.loadError) throw new Error('PROTECTED_DATA_LOAD_FAILED')
        protectedDataStatus.value = 'ready'
        applyPendingChatRoute()
        await authStore.finalizeLegacyMigration()
        markAppPerformance('protected:ready')
        measureAppPerformance('protected:load', 'protected:load-start', 'protected:ready')
        queueStartupSync()
        refreshReminderPersonalization().catch(() => {})
        return true
      } catch {
        protectedDataStatus.value = 'error'
        authStore.lockApp()
        pwdInput.value = ''
        appAlert('密码库或聊天数据无法安全解密，应用已重新锁定；请保留现有数据并重试', {
          title: '受保护数据加载失败'
        })
        return false
      } finally {
        protectedLoadPromise = null
      }
    })()
    return protectedLoadPromise
  }

  const scheduleProtectedDataLoad = () => {
    const start = () => ensureProtectedDataReady().catch(() => {})
    afterTwoPaints(start)
  }

  const finishUnlock = async () => {
    pwdInput.value = ''
    await nextTick()
    afterNextPaint().then(() => {
      markAppPerformance('unlock:home-paint')
      measureAppPerformance('unlock:to-home-paint', 'unlock:start', 'unlock:home-paint')
      scheduleProtectedDataLoad()
      showBiometricSetup.value = authStore.needsBiometricSetup && !biometricSetupDismissed
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

  return {
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
    pwdInput,
    setMasterPassword,
    settingsStore,
    showBiometricSetup,
    showPassword,
    unlockApp,
    unlockWithBiometric
  }
}
