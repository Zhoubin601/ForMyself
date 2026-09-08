<script setup>
import { defineAsyncComponent } from 'vue'
import { useAppController } from './composables/useAppController.js'
import HomeView from './components/HomeView.vue'
import AppFeedbackHost from './components/AppFeedbackHost.vue'
const MonthlyReportView = defineAsyncComponent(() => import('./components/MonthlyReportView.vue'))
const DebtListView = defineAsyncComponent(() => import('./components/DebtListView.vue'))
const WeightView = defineAsyncComponent(() => import('./components/WeightView.vue'))
const MoodView = defineAsyncComponent(() => import('./features/mood/MoodView.vue'))
const ScheduleView = defineAsyncComponent(() => import('./features/schedule/ScheduleView.vue'))
const ChatView = defineAsyncComponent(() => import('./features/chat/ChatView.vue'))
const PasswordVaultView = defineAsyncComponent(() => import('./components/PasswordVaultView.vue'))
const SettingsView = defineAsyncComponent(() => import('./components/SettingsView.vue'))

const {
  appWrapperRef,
  authStore,
  chatUnreadCount,
  chatUnreadLabel,
  dismissBiometricSetup,
  drawerItems,
  enableBiometricUnlock,
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
} = useAppController()
</script>

<template>
  <div
    ref="appWrapperRef"
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
    @scroll.passive="handleAppScroll"
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
            :disabled="isUnlocking"
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
          :disabled="isUnlocking"
          @click="setMasterPassword"
        >
          <span>{{ isUnlocking ? '正在初始化…' : '初始化并进入' }}</span>
          <span v-if="isUnlocking" class="unlock-spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
        <div v-else class="unlock-actions">
          <button class="button-primary lock-btn" :disabled="isUnlocking" @click="unlockApp">
            <span>{{ isUnlocking ? '正在解锁…' : '解锁进入' }}</span>
            <span v-if="isUnlocking" class="unlock-spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
          <button
            v-if="authStore.canUnlockWithBiometric"
            class="button-secondary-pill"
            style="width: 100%"
            :disabled="isUnlocking"
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
          v-if="settingsStore.currentView === 'settings' && (settingsStore.settingsScope !== 'general' || settingsStore.settingsSection)"
          class="nav-link-btn"
          aria-label="返回模块"
          @click="settingsStore.settingsSection ? settingsStore.closeGeneralSettingsSection() : settingsStore.closeModuleSettings()"
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
          v-if="!authStore.isLocked && settingsStore.isDrawerOpen"
          class="drawer-overlay"
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
              role="button"
              tabindex="0"
              :aria-current="settingsStore.currentView === item.id ? 'page' : undefined"
              @click="settingsStore.switchView(item.id)"
              @keydown.enter="settingsStore.switchView(item.id)"
              @keydown.space.prevent="settingsStore.switchView(item.id)"
            >
              <span class="drawer-item-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon" /></svg>
              </span>
              <span class="drawer-item-label">{{ item.label }}</span>
              <span
                v-if="item.id === 'chat' && chatUnreadCount"
                class="drawer-unread-badge"
                :aria-label="`${chatUnreadCount}条温馨小家未读消息`"
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
        <KeepAlive :max="7">
          <HomeView
            v-if="settingsStore.currentView === 'home'"
            :chat-unread-count="chatUnreadCount"
            :show-biometric-setup="showBiometricSetup"
            :is-enabling-biometric="isEnablingBiometric"
            @enable-biometric="enableBiometricUnlock"
            @dismiss-biometric="dismissBiometricSetup"
          />
          <MonthlyReportView v-else-if="settingsStore.currentView === 'reports'" />
          <DebtListView v-else-if="settingsStore.currentView === 'debts'" />
          <WeightView v-else-if="settingsStore.currentView === 'weight'" />
          <MoodView v-else-if="settingsStore.currentView === 'mood'" />
          <ScheduleView v-else-if="settingsStore.currentView === 'schedule'" />
          <ChatView
            v-else-if="settingsStore.currentView === 'chat' && protectedDataStatus === 'ready'"
            :is-visible="!authStore.isLocked && settingsStore.currentView === 'chat'"
          />
        </KeepAlive>
        <div
          v-if="settingsStore.currentView === 'chat' && protectedDataStatus !== 'ready'"
          class="protected-data-loading"
          role="status"
        >
          <span class="unlock-spinner"></span>
          <p>正在安全载入温馨小家…</p>
        </div>
        <div
          v-if="settingsStore.currentView === 'passwords' && protectedDataStatus !== 'ready'"
          class="protected-data-loading"
          role="status"
        >
          <span class="unlock-spinner"></span>
          <p>正在安全载入密码库…</p>
        </div>
        <PasswordVaultView v-else-if="settingsStore.currentView === 'passwords'" />
        <SettingsView v-if="settingsStore.currentView === 'settings'" />
      </div>
    </div>
  </div>
  <AppFeedbackHost />
</template>

<style src="./styles/app.css"></style>
