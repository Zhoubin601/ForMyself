<script setup>
import { computed, defineAsyncComponent, unref } from 'vue'
import { moduleRegistry } from './application/moduleRegistry.js'
import { backgroundEffectStyle } from './services/backgroundSettings.js'
import { useAppController } from './composables/useAppController.js'
import HomeView from './components/HomeView.vue'
import DataStatusBanner from './components/DataStatusBanner.vue'
import AppFeedbackHost from './components/AppFeedbackHost.vue'
import { ListChecks, House, ChartNoAxesColumn, Wallet, Scale, Heart, HouseHeart, CalendarDays, LockKeyhole, SlidersHorizontal, Menu, X, Settings2, ChevronLeft } from 'lucide-vue-next'
const drawerIcons = { ListChecks, House, ChartNoAxesColumn, Wallet, Scale, Heart, HouseHeart, CalendarDays, LockKeyhole, SlidersHorizontal }
const pageComponents = Object.fromEntries(moduleRegistry.list.map(module => [module.id,
  module.id === 'home' ? HomeView : defineAsyncComponent(() => module.loadView().then(loaded => loaded.default || loaded))
]))

const controller = useAppController()
const {
  restoreState, retryFullRecovery, retryRestoreSync,
  dataIssues,
  dataReady,
  appWrapperRef,
  authStore,
  chatUnreadCount,
  chatUnreadLabel,
  drawerItems,
  handleAppScroll,
  hasEnteredApp,
  isUnlocking,
  moduleSettingsViews,
  protectedDataStatus,
  protectedModule,
  protectedAccess,
  retryProtectedModule,
  pwdInput,
  setMasterPassword,
  settingsStore,
  showPassword,
  unlockApp,
  unlockWithBiometric
} = controller
const activeModule = computed(() => moduleRegistry.get(settingsStore.currentView))
const canRenderModule = computed(() => !protectedModule.value || protectedDataStatus.value === 'ready')
const activeBindings = computed(() => activeModule.value?.bindings?.({
  ...Object.fromEntries(Object.entries(controller).map(([key, value]) => [key, unref(value)])),
  isVisible: !authStore.isLocked && settingsStore.currentView === activeModule.value?.id
}) || {})
const excludedViews = computed(() => moduleRegistry.list.filter(module =>
  (module.access && protectedAccess.status[module.id] !== 'ready') || (module.id === 'chat' && settingsStore.warmHomeEnabled === false)
).map(module => module.name))
const activeBackgroundStyle = computed(() => backgroundEffectStyle(
  settingsStore.backgroundEffects?.[authStore.isLocked ? 'lock' : 'pages']
))
</script>

<template>
  <div
    ref="appWrapperRef"
    class="app-wrapper"
    :class="{
      'has-custom-bg': Boolean(settingsStore.customBg),
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
    <div v-if="settingsStore.customBg" class="bg-blur-layer" :style="activeBackgroundStyle" aria-hidden="true"></div>
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

    <div v-if="restoreState?.blocked && !authStore.isLocked" class="protected-data-loading" role="alert">
      <p>{{ restoreState.message }}</p>
      <button class="button-primary" :disabled="restoreState.busy" @click="retryFullRecovery">{{ restoreState.busy ? '正在恢复…' : '验证并重试恢复' }}</button>
    </div>
    <div v-if="restoreState?.syncError" class="protected-data-loading" role="status">
      <p>{{ restoreState.syncError }}</p><button class="button-secondary-pill" @click="retryRestoreSync">重试同步</button>
    </div>
    <div v-if="hasEnteredApp" v-show="!authStore.isLocked" class="main-app fade-in">
      <div v-if="settingsStore.currentView !== 'schedule'" class="top-nav sub-nav-frosted">
        <button
          v-if="settingsStore.currentView === 'settings' && (settingsStore.settingsScope !== 'general' || settingsStore.settingsSection)"
          class="nav-link-btn"
          aria-label="返回模块"
          @click="settingsStore.settingsSection ? settingsStore.closeGeneralSettingsSection() : settingsStore.closeModuleSettings()"
        >
          <ChevronLeft :size="24" :stroke-width="2" aria-hidden="true" />
        </button>
        <button v-else class="nav-link-btn" aria-label="打开导航菜单" @click="settingsStore.isDrawerOpen = true">
          <Menu :size="24" :stroke-width="2" aria-hidden="true" />
        </button>
        <h2 class="tagline">{{ settingsStore.viewTitle }}</h2>
        <button
          v-if="moduleSettingsViews.has(settingsStore.currentView)"
          class="nav-link-btn module-settings-trigger"
          :aria-label="`打开${settingsStore.viewTitle}设置`"
          @click="settingsStore.openModuleSettings(settingsStore.currentView)"
        >
          <Settings2 :size="23" :stroke-width="1.8" aria-hidden="true" />
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
              <X :size="21" :stroke-width="1.8" aria-hidden="true" />
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
                <component :is="drawerIcons[item.icon]" :size="21" :stroke-width="1.8" aria-hidden="true" />
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
        <DataStatusBanner :issues="dataIssues" />
        <p v-if="dataReady === false" class="protected-data-loading" role="status">数据尚未安全载入，请等待或重试读取。</p>
        <template v-if="dataReady !== false">
        <KeepAlive :max="7" :exclude="excludedViews">
          <component
            :is="pageComponents[activeModule.id]"
            v-if="activeModule?.cache && canRenderModule"
            :key="activeModule.id"
            v-bind="activeBindings"
          />
        </KeepAlive>
        <component
          :is="pageComponents[activeModule.id]"
          v-if="activeModule && !activeModule.cache && canRenderModule"
          :key="protectedModule || activeModule.id"
          v-bind="activeBindings"
        />
        <div v-if="!canRenderModule" class="protected-data-loading" role="status">
          <span v-if="protectedDataStatus === 'loading'" class="unlock-spinner"></span>
          <p>{{ protectedAccess.recoveryRequired ? '数据恢复未完成，请保留应用数据并重试恢复。' : protectedDataStatus === 'loading' ? `正在安全载入${activeModule.label || activeModule.title}…` : '此功能需要验证身份' }}</p>
          <button v-if="protectedDataStatus !== 'loading' && !protectedAccess.recoveryRequired" class="button-primary" @click="retryProtectedModule">验证并进入</button>
          <button class="text-link" @click="settingsStore.switchView('home')">返回首页</button>
        </div>
        </template>
      </div>
    </div>
  </div>
  <AppFeedbackHost />
</template>

<style src="./styles/app.css"></style>
