<script setup>
import { computed, ref, onMounted, watch, watchEffect } from 'vue'
import { StatusBar } from '@capacitor/status-bar'
import { LocalNotifications } from '@capacitor/local-notifications'

import { useAuthStore } from './stores/auth'
import { App as CapacitorApp } from '@capacitor/app'
import { useSettingsStore } from './stores/settings'
import { useMoodStore } from './stores/mood'
import { useDebtStore } from './stores/debt'
import { useWeightStore } from './stores/weight'
import { usePasswordVaultStore } from './stores/passwordVault'
import { useScheduleStore } from './stores/schedule'
import { useChatStore } from './stores/chat'
import { shouldLockOnBackground, shouldLockOnResume } from './services/autoLockPolicy'
import {
  consumeNativeActivityGuard,
  isNativeActivityGuardActive
} from './services/nativeActivityGuard'
import { syncReminderNotifications } from './services/notificationService'
import { getPersonalizedReminderBodies } from './services/reminderSchedule'
import { refreshPersonalizedReminderContent } from './services/notificationPersonalizer'
import { getRouteFromAppUrl } from './services/appDeepLink'
import { refreshHomeWidget } from './services/homeWidget'
import { syncScheduleNotifications } from './services/scheduleNotificationService'
import { syncChatProactiveNotifications } from './services/chatProactive'
import { syncChatFollowupNotifications } from './services/chatFollowup'

import DebtListView from './components/DebtListView.vue'
import WeightView from './components/WeightView.vue'
import MoodView from './components/MoodView.vue'
import HomeView from './components/HomeView.vue'
import SettingsView from './components/SettingsView.vue'
import PasswordVaultView from './components/PasswordVaultView.vue'
import MonthlyReportView from './components/MonthlyReportView.vue'
import ScheduleView from './components/ScheduleView.vue'
import ChatView from './components/ChatView.vue'
import AppFeedbackHost from './components/AppFeedbackHost.vue'
import { appAlert } from './services/uiFeedback'

const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const vaultStore = usePasswordVaultStore()
const moodStore = useMoodStore()
const debtStore = useDebtStore()
const weightStore = useWeightStore()
const scheduleStore = useScheduleStore()
const chatStore = useChatStore()
const chatUnreadLabel = computed(() => (
  chatStore.unreadCount > 99 ? '99+' : String(chatStore.unreadCount || '')
))
const hasEnteredApp = ref(false)

watch(() => authStore.isLocked, isLocked => {
  if (!isLocked) hasEnteredApp.value = true
}, { immediate: true })

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

const resyncStoredReminders = () => syncReminderNotifications(settingsStore.notificationSettings, {
  personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
})

const refreshReminderPersonalization = async (force = false) => {
  const result = await refreshPersonalizedReminderContent({
    settings: settingsStore.notificationSettings,
    cache: settingsStore.notificationAiContent,
    data: {
      moodRecords: moodStore.moodRecords,
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
    refreshHomeWidget().catch(error => console.warn('刷新桌面小组件失败', error))
  }, 350)
}

const openAppUrl = (url) => {
  const route = getRouteFromAppUrl(url)
  if (!route) return
  if (route.view === 'schedule') settingsStore.openScheduleTarget(route)
  else {
    if (route.view === 'chat') {
      chatStore.materializeDueProactive(Date.now())
      chatStore.materializeDueFollowups(Date.now())
      chatStore.setPendingFocusProactiveId(route.proactive)
    }
    settingsStore.switchView(route.view)
  }
}

const resyncChatProactive = async () => {
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
      scheduleStore.persist(),
      syncScheduleNotifications(scheduleStore.snapshot),
      refreshHomeWidget()
    ]).catch(error => {
      if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') console.warn('刷新日程服务失败', error)
    })
  }, 350)
}

onMounted(async () => {
  try {
    CapacitorApp.addListener('appUrlOpen', ({ url }) => openAppUrl(url))
    const launchUrl = await CapacitorApp.getLaunchUrl()
    openAppUrl(launchUrl?.url)
  } catch (error) {
    console.warn('无法处理应用快捷入口', error)
  }

  try {
    await StatusBar.show()
    await StatusBar.setOverlaysWebView({ overlay: true })
  } catch (e) {
    console.warn('浏览器环境中无法设置状态栏')
  }

  await Promise.all([
    authStore.loadAuthData(),
    settingsStore.loadSettings(),
    debtStore.loadDebts(),
    weightStore.loadWeightRecords(),
    moodStore.loadMoodRecords(),
    scheduleStore.loadSchedules()
  ])
  await Promise.all([
    vaultStore.loadRecords(authStore.savedMasterPwd),
    chatStore.loadChatData(authStore.savedMasterPwd)
  ])
  await resyncChatProactive().catch(error => console.warn('初始化温馨小家主动联系失败', error))
  await refreshHomeWidget().catch(error => console.warn('初始化桌面小组件失败', error))
  await syncScheduleNotifications(scheduleStore.snapshot).catch(error => {
    if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') console.warn('初始化日程提醒失败', error)
  })

  try {
    await resyncStoredReminders()
  } catch (error) {
    if (error.code !== 'NOTIFICATION_PERMISSION_DENIED') {
      console.warn('同步通知提醒失败', error)
    }
  }

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
        chatStore.flush().catch(error => console.warn('进入后台时保存聊天失败', error))
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
      resyncChatProactive().catch(error => console.warn('恢复应用后同步温馨小家主动联系失败', error))

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

const unlockApp = () => {
  const ok = authStore.unlockWithPassword(pwdInput.value)
  if (ok) {
    pwdInput.value = ''
    refreshReminderPersonalization().catch(() => {})
  } else {
    appAlert('密码验证未通过，请重试', { title: '暂时无法解锁' })
  }
}

const unlockWithBiometric = async () => {
  const ok = await authStore.unlockWithBiometric()
  if (ok) {
    pwdInput.value = ''
    refreshReminderPersonalization().catch(() => {})
  }
}

const setMasterPassword = async () => {
  const ok = await authStore.setMasterPassword(pwdInput.value)
  if (ok) {
    await Promise.all([
      vaultStore.reencrypt(authStore.savedMasterPwd),
      chatStore.reencrypt(authStore.savedMasterPwd)
    ])
    pwdInput.value = ''
    refreshReminderPersonalization().catch(() => {})
  } else {
    appAlert('安全主密码请勿少于 4 位数', { title: '主密码太短' })
  }
}
</script>

<template>
  <div
    class="app-wrapper"
    :class="{
      'schedule-active': !authStore.isLocked && settingsStore.currentView === 'schedule',
      'chat-active': !authStore.isLocked && settingsStore.currentView === 'chat'
    }"
    :style="
      settingsStore.customBg
        ? {
            backgroundImage: `url(${settingsStore.customBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed'
          }
        : {}
    "
  >
    <div v-if="settingsStore.customBg" class="bg-blur-layer"></div>
    <div v-else class="ambient-canvas" aria-hidden="true">
      <span class="ambient-orb ambient-orb-blue"></span>
      <span class="ambient-orb ambient-orb-mint"></span>
    </div>

    <div v-if="authStore.isLocked" class="lock-screen fade-in">
      <div class="lock-glow lock-glow-one"></div>
      <div class="lock-glow lock-glow-two"></div>
      <div class="lock-card">
        <div class="lock-brand"><img src="/icon.png" alt="" aria-hidden="true" /></div>
        <p class="lock-eyebrow">MY PRIVATE SPACE</p>
        <h2 class="display-lg">ForMyself</h2>
        <p class="body-text body-muted">
          {{
            authStore.hasMasterPassword
              ? '欢迎回来，解锁你的私人空间'
              : '第一次见面，请配置安全主密码'
          }}
        </p>

        <label class="lock-input-shell">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v2" /></svg>
          <input
            v-model="pwdInput"
            :type="showPassword ? 'text' : 'password'"
            placeholder="输入主密码"
            autocomplete="current-password"
            @keyup.enter="authStore.hasMasterPassword ? unlockApp() : setMasterPassword()"
          />
          <button
            type="button"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="showPassword" d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Zm9-2.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" />
              <path v-else d="m4 4 16 16M9.8 7.4A8 8 0 0 1 12 7c5.6 0 9 5 9 5a13 13 0 0 1-2.4 2.7M6.2 6.3C4.2 7.7 3 9.6 3 12c0 0 3.4 5 9 5 1.1 0 2.1-.2 3-.6m-5.1-6.5a3 3 0 0 0 4.2 4.2" />
            </svg>
          </button>
        </label>

        <button
          v-if="!authStore.hasMasterPassword"
          class="button-primary lock-btn"
          @click="setMasterPassword"
        >
          <span>初始化并进入</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
        <div v-else class="unlock-actions">
          <button class="button-primary lock-btn" @click="unlockApp">
            <span>解锁进入</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
          <button
            v-if="authStore.hasBiometric"
            class="button-secondary-pill"
            style="width: 100%"
            @click="unlockWithBiometric"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9a4 4 0 0 1 8 0v3m-10 0V9a6 6 0 0 1 12 0v3m-9 3v-4a3 3 0 0 1 6 0v5m-9-1v1a6 6 0 0 0 6 6m6-7v1a6 6 0 0 1-2.2 4.6" /></svg>
            指纹快捷认证
          </button>
        </div>
        <div class="lock-privacy-note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6v5.2c0 4.4-2.9 7.7-7 9.3-4.1-1.6-7-4.9-7-9.3V6l7-2.5Zm-2.5 8 1.7 1.8 3.6-3.8" /></svg>
          <span>主密码只用于本机解锁，不会上传</span>
        </div>
      </div>
    </div>

    <div v-if="hasEnteredApp" v-show="!authStore.isLocked" class="main-app fade-in">
      <div v-if="settingsStore.currentView !== 'schedule'" class="top-nav sub-nav-frosted">
        <button
          v-if="settingsStore.currentView === 'settings' && settingsStore.settingsScope !== 'general'"
          class="nav-link-btn"
          aria-label="返回模块"
          @click="settingsStore.closeModuleSettings()"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
            <path d="m15 5-7 7 7 7"></path>
          </svg>
        </button>
        <button v-else class="nav-link-btn" aria-label="打开导航菜单" @click="settingsStore.isDrawerOpen = true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            fill="none"
          >
            <path d="M4 6h16M4 12h16M4 18h16"></path>
          </svg>
        </button>
        <h2 class="tagline">{{ settingsStore.viewTitle }}</h2>
        <button
          v-if="moduleSettingsViews.has(settingsStore.currentView)"
          class="nav-link-btn module-settings-trigger"
          :aria-label="`打开${settingsStore.viewTitle}设置`"
          @click="settingsStore.openModuleSettings(settingsStore.currentView)"
        >
          <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.5 14 5l2.5-.2.8 2.4 2 1.5-1 2.3.5 2.5-2.3 1.1-1.2 2.2-2.5-.4-2.1 1.4-1.8-1.7-2.5-.1-.5-2.5-1.8-1.7 1.3-2.2-.2-2.5 2.4-.9L9 4.6l2.5.6L12 3.5Z"></path>
            <circle cx="12" cy="11" r="2.6"></circle>
          </svg>
        </button>
        <div v-else class="nav-side-placeholder" aria-hidden="true"></div>
      </div>

      <Teleport to="body">
        <div
          class="drawer-overlay"
          v-if="!authStore.isLocked && settingsStore.isDrawerOpen"
          @click="settingsStore.isDrawerOpen = false"
        ></div>

        <aside
          v-show="!authStore.isLocked"
          class="drawer"
          :class="{ open: settingsStore.isDrawerOpen }"
          aria-label="主导航"
        >
          <div class="drawer-header">
            <div class="drawer-brand">
              <img class="drawer-brand-mark" src="/icon.png" alt="" aria-hidden="true" />
              <div>
                <p>MY PRIVATE SPACE</p>
                <h3>ForMyself</h3>
              </div>
            </div>
            <button
              class="drawer-close"
              aria-label="关闭导航菜单"
              @click="settingsStore.isDrawerOpen = false"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
            </button>
          </div>
          <p class="drawer-section-label">生活面板</p>
          <ul class="drawer-menu">
            <li
              v-for="item in drawerItems"
              :key="item.id"
              :class="{ active: settingsStore.currentView === item.id }"
              @click="settingsStore.switchView(item.id)"
            >
              <span class="drawer-item-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon" /></svg>
              </span>
              <span class="drawer-item-label">{{ item.label }}</span>
              <span
                v-if="item.id === 'chat' && chatStore.unreadCount"
                class="drawer-unread-badge"
                :aria-label="`${chatStore.unreadCount}条温馨小家未读消息`"
              >{{ chatUnreadLabel }}</span>
              <span v-else class="drawer-item-meta">{{ item.meta }}</span>
            </li>
          </ul>
          <div class="drawer-footer">
            <div class="drawer-privacy-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.2c0 4.4-2.9 7.7-7 9.3-4.1-1.6-7-4.9-7-9.3V6l7-2.5Zm-2.5 8 1.7 1.8 3.6-3.8" /></svg>
            </div>
            <div><strong>你的私人空间</strong><span>核心数据保存在设备内</span></div>
          </div>
        </aside>
      </Teleport>

      <div
        class="content-area"
        :class="{
          'schedule-content-area': settingsStore.currentView === 'schedule',
          'chat-content-area': settingsStore.currentView === 'chat'
        }"
      >
        <HomeView v-if="settingsStore.currentView === 'home'" />
        <MonthlyReportView v-if="settingsStore.currentView === 'reports'" />
        <DebtListView v-if="settingsStore.currentView === 'debts'" />
        <WeightView v-if="settingsStore.currentView === 'weight'" />
        <MoodView v-if="settingsStore.currentView === 'mood'" />
        <ScheduleView v-if="settingsStore.currentView === 'schedule'" />
        <KeepAlive>
          <ChatView
            v-if="settingsStore.currentView === 'chat'"
            :is-visible="!authStore.isLocked && settingsStore.currentView === 'chat'"
          />
        </KeepAlive>
        <PasswordVaultView v-if="settingsStore.currentView === 'passwords'" />
        <SettingsView v-if="settingsStore.currentView === 'settings'" />
      </div>
    </div>
  </div>
  <AppFeedbackHost />
</template>

<style>
:root {
  --theme-primary: #4A8FD8;
  --theme-primary-rgb: 74, 143, 216;
  --theme-primary-strong: #35679C;
  --theme-primary-strong-rgb: 53, 103, 156;
  --theme-on-primary: #ffffff;
  --theme-primary-soft: #EAF3FC;
  --theme-primary-soft-strong: #C9DEF3;
  --theme-surface-tint: #F4F8FD;
  --theme-border: #D7E6F5;
  --theme-gradient-start: #4679A8;
  --theme-gradient-end: #2F5B89;
  --theme-soft: var(--theme-primary-soft);
  --theme-surface: var(--theme-surface-tint);
  --theme-gradient: linear-gradient(145deg, var(--theme-gradient-start), var(--theme-gradient-end));
  --primary: var(--theme-primary-strong);
  --primary-focus: #2F5B89;
  --ink: #1d1d1f;
  --body-muted: #7d8491;
  --divider-soft: #edf0f4;
  --hairline: #dfe4ea;
  --canvas: #ffffff;
  --canvas-parchment: #f6f8fb;
  --surface-pearl: #fafbfd;
  --radius-input: 14px;
  --radius-card: 20px;
  --radius-panel: 24px;
  --shadow-card: 0 10px 28px rgba(42, 55, 78, .065);
  --shadow-panel: 0 20px 54px rgba(36, 51, 75, .12);
}

*,
*::before,
*::after {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html,
body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  height: 100dvh !important;
  overflow: hidden !important;
  background-color: var(--canvas-parchment) !important;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--ink);
}

#app {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  overflow: hidden !important;
}

input,
textarea {
  -webkit-user-select: auto;
  user-select: auto;
  font-family: inherit;
}

button,
[role='button'],
.drawer-menu li {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  outline: none;
}

.app-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--canvas-parchment);
}

.app-wrapper.schedule-active {
  overflow: hidden;
}

.app-wrapper.chat-active {
  position: fixed;
  inset: 0;
  height: 100dvh;
  overflow: hidden;
}

.app-wrapper.schedule-active .main-app,
.app-wrapper.schedule-active .schedule-content-area {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-wrapper.chat-active .main-app {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-wrapper.chat-active .sub-nav-frosted {
  position: relative;
  top: auto;
  flex: 0 0 auto;
}

.bg-blur-layer {
  position: fixed;
  inset: 0;
  background: rgba(245, 245, 247, 0.85);
  backdrop-filter: blur(40px) saturate(150%);
  z-index: 0;
  pointer-events: none;
}

.ambient-canvas {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(circle at 8% 5%, rgba(var(--theme-primary-rgb), .095), transparent 32%),
    radial-gradient(circle at 94% 74%, rgba(var(--theme-primary-rgb), .055), transparent 30%);
  contain: strict;
}

.ambient-orb {
  position: absolute;
  width: min(92vw, 620px);
  aspect-ratio: 1;
  border-radius: 50%;
  opacity: .5;
  will-change: transform, opacity;
}

.ambient-orb-blue {
  top: -23%;
  right: -37%;
  background: radial-gradient(circle, rgba(var(--theme-primary-rgb), .18) 0%, rgba(var(--theme-primary-rgb), .07) 42%, transparent 70%);
  animation: ambientBlueDrift 22s ease-in-out infinite alternate;
}

.ambient-orb-mint {
  bottom: -27%;
  left: -42%;
  background: radial-gradient(circle, rgba(var(--theme-primary-rgb), .11) 0%, rgba(var(--theme-primary-rgb), .045) 44%, transparent 70%);
  animation: ambientMintDrift 26s ease-in-out infinite alternate;
}

@keyframes ambientBlueDrift {
  from { transform: translate3d(-5%, -2%, 0) scale(.94); opacity: .4; }
  to { transform: translate3d(9%, 12%, 0) scale(1.08); opacity: .62; }
}

@keyframes ambientMintDrift {
  from { transform: translate3d(2%, 8%, 0) scale(1.04); opacity: .34; }
  to { transform: translate3d(14%, -10%, 0) scale(.92); opacity: .56; }
}

.display-lg {
  font-family: 'SF Pro Display', -apple-system, sans-serif;
  font-size: 40px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.374px;
  margin: 0;
  color: var(--ink);
}

.tagline {
  font-family: 'SF Pro Display', -apple-system, sans-serif;
  font-size: 19px;
  font-weight: 650;
  line-height: 1.19;
  letter-spacing: 0.231px;
  margin: 0;
  color: var(--ink);
}

.body-strong {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.24;
  letter-spacing: -0.374px;
}

.body-text {
  font-size: 17px;
  font-weight: 400;
  line-height: 1.47;
  letter-spacing: -0.374px;
}

.body-muted {
  color: var(--body-muted);
}

.caption {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.43;
  letter-spacing: -0.224px;
}

.button-primary {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background: linear-gradient(120deg, var(--theme-gradient-end) 0%, var(--primary) 48%, var(--theme-gradient-start) 100%);
  background-size: 220% 220%;
  color: #ffffff;
  font-size: 17px;
  font-weight: 400;
  border-radius: 9999px;
  padding: 11px 22px;
  border: none;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(var(--theme-primary-strong-rgb), .18);
  transition: transform .2s, box-shadow .2s, filter .2s;
  text-align: center;
  animation: galaxyButtonGradient 9s ease infinite;
}

/* Motion language adapted from Uiverse Galaxy button snippets (MIT). */
.button-primary::before {
  content: '';
  position: absolute;
  inset: -60% -35%;
  z-index: -1;
  background: linear-gradient(105deg, transparent 37%, rgba(255,255,255,.34) 50%, transparent 63%);
  transform: translate3d(-72%, 0, 0) rotate(5deg);
  pointer-events: none;
}

.button-primary > * {
  position: relative;
  z-index: 1;
}

@keyframes galaxyButtonGradient {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

@keyframes galaxyButtonShine {
  from { transform: translate3d(-72%, 0, 0) rotate(5deg); }
  to { transform: translate3d(72%, 0, 0) rotate(5deg); }
}

.button-primary:active {
  transform: scale(0.95);
  filter: saturate(1.08) brightness(.98);
  box-shadow: 0 4px 12px rgba(var(--theme-primary-strong-rgb), .2);
}

.button-primary:active::before {
  animation: galaxyButtonShine .52s ease-out;
}

.button-secondary-pill {
  background-color: transparent;
  color: var(--primary);
  font-size: 17px;
  font-weight: 400;
  border-radius: 9999px;
  padding: 11px 22px;
  border: 1px solid var(--primary);
  cursor: pointer;
  transition: transform 0.2s;
  text-align: center;
}

.button-secondary-pill:active {
  transform: scale(0.95);
}

.text-link {
  color: var(--primary);
  background: none;
  border: none;
  font-size: 17px;
  font-weight: 400;
  padding: 0;
  cursor: pointer;
}

.apple-input {
  background-color: var(--canvas);
  color: var(--ink);
  font-size: 17px;
  font-weight: 400;
  border-radius: var(--radius-input);
  padding: 14px 16px;
  border: 1px solid var(--hairline);
  outline: none;
  transition: border-color 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.apple-input:focus {
  border-color: var(--primary-focus);
  outline: 2px solid rgba(var(--theme-primary-rgb), .18);
}

.main-app {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

.content-area {
  flex: 1;
  width: 100%;
  padding: 18px 16px;
  max-width: 800px;
  margin: 0 auto;
  padding-bottom: 52px;
}

.content-area.schedule-content-area {
  max-width: none;
  padding: 0;
  margin: 0;
  min-height: 0;
}

.content-area.chat-content-area {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: 0;
  max-width: none;
  min-height: 0;
  padding: 0;
  margin: 0;
  overflow: hidden;
}

.sub-nav-frosted {
  overflow: hidden;
  isolation: isolate;
  background: #f8f9fc;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 58px;
  padding: calc(8px + env(safe-area-inset-top, 24px)) 16px 8px;
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid rgba(43, 55, 76, .065);
  box-shadow: 0 5px 18px rgba(37, 49, 70, .045);
}

.nav-link-btn {
  box-sizing: border-box;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border: 1px solid var(--theme-border);
  border-radius: 13px;
  background: rgba(255,255,255,.88);
  color: var(--ink);
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  box-shadow: 0 5px 14px rgba(var(--theme-primary-rgb), .07);
  transition: transform .18s, background .18s;
}
.nav-link-btn > svg { display: block; flex: 0 0 auto; }
.nav-side-placeholder { flex: 0 0 38px; width: 38px; height: 38px; }
.nav-link-btn:active { transform: scale(.94); background: rgba(255,255,255,.9); }
.module-settings-trigger { color: var(--primary); }

.drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  height: 100%;
  width: min(86vw, 326px);
  background:
    radial-gradient(circle at 2% 0%, rgba(var(--theme-primary-rgb), .14), transparent 31%),
    linear-gradient(180deg, #fbfdff 0%, #f7f9fc 54%, #f2f5f9 100%);
  z-index: 101;
  transform: translateX(-100%);
  transition: transform .34s cubic-bezier(.2,.8,.2,1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(255,255,255,.85);
  border-radius: 0 28px 28px 0;
  box-shadow: 24px 0 60px rgba(22, 36, 60, .16);
}

.drawer.open {
  transform: translateX(0);
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(16, 22, 34, .3);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
  z-index: 100;
  transition: opacity 0.3s;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(23px + env(safe-area-inset-top, 20px)) 20px 18px;
}
.drawer-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.drawer-brand-mark {
  display: block;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 16px;
  object-fit: cover;
  box-shadow: 0 9px 20px rgba(48, 58, 91, .25), inset 0 0 0 1px rgba(255,255,255,.22);
}
.drawer-brand p {
  margin: 0 0 2px;
  color: #7f8794;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .12em;
}
.drawer-brand h3 { margin: 0; color: #172033; font-size: 24px; line-height: 1.1; letter-spacing: -.7px; }
.drawer-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid rgba(28,51,84,.06);
  border-radius: 12px;
  background: rgba(255,255,255,.64);
  color: #717987;
}
.drawer-close svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.drawer-section-label {
  margin: 9px 26px 7px;
  color: #9198a4;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .1em;
}

.drawer-menu {
  list-style: none;
  padding: 0 13px 14px;
  margin: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.drawer-menu::-webkit-scrollbar { display: none; }

.drawer-menu li {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-height: 52px;
  padding: 6px 13px 6px 8px;
  margin-bottom: 3px;
  cursor: pointer;
  color: #424a58;
  border: 1px solid transparent;
  border-radius: 16px;
  transition: background .18s, color .18s, transform .18s, box-shadow .18s;
}
.drawer-menu li:active { transform: scale(.985); }
.drawer-item-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 13px;
  background: rgba(232,237,244,.78);
  color: #646d7c;
  transition: background .18s, color .18s;
}
.drawer-item-icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.drawer-item-label { overflow: hidden; font-size: 15px; font-weight: 580; text-overflow: ellipsis; white-space: nowrap; }
.drawer-item-meta { color: #a0a6af; font-size: 10px; letter-spacing: .04em; }
.drawer-unread-badge {
  display: grid;
  place-items: center;
  min-width: 21px;
  height: 21px;
  padding: 0 6px;
  border-radius: 999px;
  color: #fff;
  background: #ef5b66;
  box-shadow: 0 5px 12px rgba(239,91,102,.24);
  font-size: 10px;
  font-weight: 700;
}

.drawer-menu li.active {
  border-color: rgba(var(--theme-primary-rgb), .18);
  background: rgba(255,255,255,.9);
  color: var(--primary);
  box-shadow: 0 8px 24px rgba(var(--theme-primary-rgb), .1);
}
.drawer-menu li.active::before {
  content: '';
  position: absolute;
  left: -4px;
  width: 3px;
  height: 22px;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 9px rgba(var(--theme-primary-rgb),.34);
}
.drawer-menu li.active .drawer-item-icon {
  background: linear-gradient(145deg, var(--theme-gradient-start), var(--theme-gradient-end));
  color: #fff;
  box-shadow: 0 7px 15px rgba(var(--theme-primary-strong-rgb),.2);
}
.drawer-menu li.active .drawer-item-meta { color: var(--theme-primary); }
.drawer-footer {
  display: flex;
  align-items: center;
  gap: 11px;
  margin: auto 15px max(15px, env(safe-area-inset-bottom));
  padding: 13px;
  border: 1px solid rgba(255,255,255,.78);
  border-radius: 17px;
  background: rgba(255,255,255,.6);
  box-shadow: 0 7px 22px rgba(30,50,80,.06);
}
.drawer-privacy-icon { display: grid; place-items: center; width: 35px; height: 35px; flex: 0 0 auto; border-radius: 12px; background: #e9f5ef; color: #33845e; }
.drawer-privacy-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.drawer-footer strong, .drawer-footer span { display: block; }
.drawer-footer strong { color: #3a4350; font-size: 12px; }
.drawer-footer span { margin-top: 2px; color: #939aa4; font-size: 10px; }
@media (prefers-reduced-motion: reduce) {
  .drawer { transition-duration: .01ms; }
}

.lock-screen {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(250,252,255,.98), rgba(243,247,252,.98));
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.lock-card {
  position: relative;
  z-index: 2;
  padding: 34px 28px 28px;
  width: calc(100% - 40px);
  max-width: 390px;
  text-align: center;
  border: 1px solid rgba(255,255,255,.9);
  border-radius: var(--radius-panel);
  background: rgba(255,255,255,.76);
  box-shadow: 0 28px 70px rgba(34,51,78,.13), inset 0 1px 0 rgba(255,255,255,.9);
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
}

.lock-card p {
  margin: 9px 0 27px;
}

.lock-brand { width: 70px; height: 70px; margin: -3px auto 17px; overflow: hidden; border: 4px solid rgba(255,255,255,.9); border-radius: 23px; box-shadow: 0 13px 28px rgba(47,57,88,.23); }
.lock-brand img { display: block; width: 100%; height: 100%; object-fit: cover; }
.lock-eyebrow { margin: 0 0 5px !important; color: #8a93a2; font-size: 10px; font-weight: 750; letter-spacing: .16em; }
.lock-card .display-lg { font-size: 36px; letter-spacing: -1px; }
.lock-input-shell {
  display: grid;
  grid-template-columns: 22px minmax(0,1fr) 36px;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  margin-bottom: 17px;
  padding: 0 10px 0 17px;
  border: 1px solid #e0e5ec;
  border-radius: 18px;
  background: rgba(247,249,252,.94);
  color: #8992a0;
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.lock-input-shell:focus-within { border-color: rgba(var(--theme-primary-rgb),.52); background: #fff; box-shadow: 0 0 0 4px rgba(var(--theme-primary-rgb),.09); }
.lock-input-shell > svg, .lock-input-shell button svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.lock-input-shell input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 16px; letter-spacing: .12em; }
.lock-input-shell input::placeholder { color: #a7adb7; letter-spacing: 0; }
.lock-input-shell button { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; background: transparent; color: #8c94a1; }

.lock-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  width: 100%;
  margin-bottom: 13px;
  border-radius: 17px;
  font-weight: 650;
  box-shadow: 0 12px 24px rgba(var(--theme-primary-strong-rgb),.22);
}
.lock-btn svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.unlock-actions .button-secondary-pill { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; border-color: #dbe6f2; background: rgba(246,250,255,.72); }
.unlock-actions .button-secondary-pill svg { width: 21px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.lock-privacy-note { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 17px; color: #8a929f; font-size: 11px; }
.lock-privacy-note svg { width: 16px; height: 16px; fill: none; stroke: #438c69; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.lock-glow { position: absolute; z-index: 0; border-radius: 50%; filter: blur(12px); pointer-events: none; will-change: transform, opacity; }
.lock-glow-one { top: -12%; right: -18%; width: 310px; height: 310px; background: rgba(var(--theme-primary-rgb),.16); animation: lockGlowOne 15s ease-in-out infinite alternate; }
.lock-glow-two { bottom: -13%; left: -20%; width: 330px; height: 330px; background: rgba(var(--theme-primary-rgb),.09); animation: lockGlowTwo 18s ease-in-out infinite alternate; }
@keyframes lockGlowOne {
  from { transform: translate3d(0, 0, 0) scale(.94); opacity: .72; }
  to { transform: translate3d(-13%, 12%, 0) scale(1.08); opacity: 1; }
}
@keyframes lockGlowTwo {
  from { transform: translate3d(0, 0, 0) scale(1.06); opacity: .65; }
  to { transform: translate3d(15%, -11%, 0) scale(.92); opacity: .94; }
}
@media (max-height: 690px) {
  .lock-card { padding-top: 24px; padding-bottom: 20px; transform: scale(.94); }
  .lock-brand { width: 60px; height: 60px; margin-bottom: 12px; }
  .lock-card p { margin-bottom: 20px; }
}

.fade-in {
  animation: fadeIn .46s cubic-bezier(.2, .78, .28, 1) forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translate3d(0, 12px, 0) scale(.992);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
</style>
