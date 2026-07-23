<script setup>
import { ref, onMounted } from 'vue'
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
import { shouldLockOnBackground, shouldLockOnResume } from './services/autoLockPolicy'
import { syncReminderNotifications } from './services/notificationService'
import { getPersonalizedReminderBodies } from './services/reminderSchedule'
import { refreshPersonalizedReminderContent } from './services/notificationPersonalizer'
import { getRouteFromAppUrl } from './services/appDeepLink'
import { refreshHomeWidget } from './services/homeWidget'
import { syncScheduleNotifications } from './services/scheduleNotificationService'

import DebtListView from './components/DebtListView.vue'
import WeightView from './components/WeightView.vue'
import MoodView from './components/MoodView.vue'
import HomeView from './components/HomeView.vue'
import SettingsView from './components/SettingsView.vue'
import PasswordVaultView from './components/PasswordVaultView.vue'
import MonthlyReportView from './components/MonthlyReportView.vue'
import ScheduleView from './components/ScheduleView.vue'

const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const vaultStore = usePasswordVaultStore()
const moodStore = useMoodStore()
const debtStore = useDebtStore()
const weightStore = useWeightStore()
const scheduleStore = useScheduleStore()

const pwdInput = ref('')
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
  else settingsStore.switchView(route.view)
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
  await vaultStore.loadRecords(authStore.savedMasterPwd)
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
  } catch (error) {
    console.warn('无法监听日程通知点击', error)
  }

  try {
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAt = Date.now()
        if (shouldLockOnBackground(settingsStore.autoLockDelaySeconds)) authStore.lockApp()
        return
      }

      if (shouldLockOnResume(settingsStore.autoLockDelaySeconds, backgroundedAt, Date.now())) {
        authStore.lockApp()
      }
      backgroundedAt = null
      if (moodStore.isDataLoaded) moodStore.autoFillMissingDays()
      queueScheduleRefresh()

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
    alert('密码验证未通过，请重试')
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
    await vaultStore.reencrypt(authStore.savedMasterPwd)
    pwdInput.value = ''
    refreshReminderPersonalization().catch(() => {})
  } else {
    alert('安全主密码请勿少于 4 位数')
  }
}
</script>

<template>
  <div
    class="app-wrapper"
    :class="{ 'schedule-active': !authStore.isLocked && settingsStore.currentView === 'schedule' }"
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

    <div v-if="authStore.isLocked" class="lock-screen fade-in">
      <div class="lock-card">
        <h2 class="display-lg">ForMyself</h2>
        <p class="body-text body-muted">
          {{
            authStore.hasMasterPassword
              ? '使用主密码解锁你的计划'
              : '第一次见面，请配置安全主密码'
          }}
        </p>
        <input
          v-model="pwdInput"
          type="password"
          placeholder="输入密码"
          class="apple-input lock-input"
          @keyup.enter="authStore.hasMasterPassword ? unlockApp() : setMasterPassword()"
        />

        <button
          v-if="!authStore.hasMasterPassword"
          class="button-primary lock-btn"
          @click="setMasterPassword"
        >
          初始化并进入
        </button>
        <div v-else class="unlock-actions">
          <button class="button-primary lock-btn" @click="unlockApp">解锁进入</button>
          <button
            v-if="authStore.hasBiometric"
            class="button-secondary-pill"
            style="width: 100%"
            @click="unlockWithBiometric"
          >
            指纹快捷认证
          </button>
        </div>
      </div>
    </div>

    <div v-else class="main-app fade-in">
      <div v-if="settingsStore.currentView !== 'schedule'" class="top-nav sub-nav-frosted">
        <button class="nav-link-btn" @click="settingsStore.isDrawerOpen = true">
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
        <div style="width: 24px"></div>
      </div>

      <Teleport to="body">
        <div
          class="drawer-overlay"
          v-if="settingsStore.isDrawerOpen"
          @click="settingsStore.isDrawerOpen = false"
        ></div>

        <div class="drawer" :class="{ open: settingsStore.isDrawerOpen }">
          <div class="drawer-header">
            <h3 class="display-lg">ForMyself</h3>
          </div>
          <ul class="drawer-menu">
            <li
              :class="{ active: settingsStore.currentView === 'home' }"
              @click="settingsStore.switchView('home')"
            >
              首页总览
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'reports' }"
              @click="settingsStore.switchView('reports')"
            >
              月度报告
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'debts' }"
              @click="settingsStore.switchView('debts')"
            >
              省钱计划
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'weight' }"
              @click="settingsStore.switchView('weight')"
            >
              体重记录
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'mood' }"
              @click="settingsStore.switchView('mood')"
            >
              心情日记
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'schedule' }"
              @click="settingsStore.switchView('schedule')"
            >
              日程提醒
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'passwords' }"
              @click="settingsStore.switchView('passwords')"
            >
              密码库
            </li>
            <li
              :class="{ active: settingsStore.currentView === 'settings' }"
              @click="settingsStore.switchView('settings')"
            >
              通用配置
            </li>
          </ul>
        </div>
      </Teleport>

      <div class="content-area" :class="{ 'schedule-content-area': settingsStore.currentView === 'schedule' }">
        <HomeView v-if="settingsStore.currentView === 'home'" />
        <MonthlyReportView v-if="settingsStore.currentView === 'reports'" />
        <DebtListView v-if="settingsStore.currentView === 'debts'" />
        <WeightView v-if="settingsStore.currentView === 'weight'" />
        <MoodView v-if="settingsStore.currentView === 'mood'" />
        <ScheduleView v-if="settingsStore.currentView === 'schedule'" />
        <PasswordVaultView v-if="settingsStore.currentView === 'passwords'" />
        <SettingsView v-if="settingsStore.currentView === 'settings'" />
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --primary: #0066cc;
  --primary-focus: #0071e3;
  --ink: #1d1d1f;
  --body-muted: #86868b;
  --divider-soft: #f0f0f0;
  --hairline: #e0e0e0;
  --canvas: #ffffff;
  --canvas-parchment: #f5f5f7;
  --surface-pearl: #fafafc;
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

.app-wrapper.schedule-active .main-app,
.app-wrapper.schedule-active .schedule-content-area {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.bg-blur-layer {
  position: fixed;
  inset: 0;
  background: rgba(245, 245, 247, 0.85);
  backdrop-filter: blur(40px) saturate(150%);
  z-index: 0;
  pointer-events: none;
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
  font-size: 21px;
  font-weight: 600;
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
  background-color: var(--primary);
  color: #ffffff;
  font-size: 17px;
  font-weight: 400;
  border-radius: 9999px;
  padding: 11px 22px;
  border: none;
  cursor: pointer;
  transition: transform 0.2s, background-color 0.2s;
  text-align: center;
}

.button-primary:active {
  transform: scale(0.95);
  background-color: var(--primary-focus);
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
  border-radius: 11px;
  padding: 14px 16px;
  border: 1px solid var(--hairline);
  outline: none;
  transition: border-color 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.apple-input:focus {
  border-color: var(--primary-focus);
  outline: 2px solid rgba(0, 102, 204, 0.2);
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
  padding: 24px 20px;
  max-width: 800px;
  margin: 0 auto;
  padding-bottom: 64px;
}

.content-area.schedule-content-area {
  max-width: none;
  padding: 0;
  margin: 0;
  min-height: 0;
}

.sub-nav-frosted {
  background: rgba(245, 245, 247, 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: calc(12px + env(safe-area-inset-top, 24px)) 24px 12px 24px;
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.nav-link-btn {
  background: none;
  border: none;
  color: var(--ink);
  padding: 0;
  cursor: pointer;
  display: flex;
}

.drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  height: 100%;
  width: 280px;
  background: var(--canvas);
  z-index: 101;
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
  border-right: 1px solid var(--hairline);
}

.drawer.open {
  transform: translateX(0);
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(2px);
  z-index: 100;
  transition: opacity 0.3s;
}

.drawer-header {
  padding: 48px 24px 24px;
  border-bottom: 1px solid var(--hairline);
}

.drawer-menu {
  list-style: none;
  padding: 16px 12px;
  margin: 0;
}

.drawer-menu li {
  padding: 12px 16px;
  margin-bottom: 4px;
  cursor: pointer;
  font-size: 17px;
  color: var(--ink);
  border-radius: 8px;
  transition: background 0.2s;
}

.drawer-menu li.active {
  background: var(--surface-pearl);
  color: var(--primary);
  font-weight: 600;
}

.lock-screen {
  position: fixed;
  inset: 0;
  background: var(--canvas-parchment);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.lock-card {
  padding: 40px 24px;
  width: 100%;
  max-width: 400px;
  text-align: center;
}

.lock-card p {
  margin: 12px 0 32px 0;
}

.lock-input {
  text-align: center;
  letter-spacing: 4px;
  margin-bottom: 24px;
  border-radius: 9999px;
}

.lock-btn {
  width: 100%;
  margin-bottom: 16px;
}

.fade-in {
  animation: fadeIn 0.4s ease forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
