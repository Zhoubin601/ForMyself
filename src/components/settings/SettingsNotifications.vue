<script setup>
import { toRefs } from 'vue'
import AppTimeField from '../AppTimeField.vue'
const props = defineProps({ model: { type: Object, required: true } })
const { enableExactReminders, isGeneralSection, isRequestingExactAlarm, isSavingReminders, isTestingNotification, reminderFeedback, reminderStatus, reminderStatusText, saveReminderSettings, settingsScope, settingsStore, testNotification } = toRefs(props.model)
</script>

<template>
    <div v-if="['mood', 'weight', 'debts'].includes(settingsScope) || isGeneralSection('notifications')" class="setting-section">
      <h3 class="caption body-muted section-title">通知提醒</h3>
      <div class="store-utility-card reminder-card">
        <div v-if="settingsScope === 'mood' || isGeneralSection('notifications')" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">心情日记</span>
            <span class="caption body-muted">提醒记录当天的感受</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.mood.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.mood.enabled" />
              AI 根据最近心情与日记生成关怀文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.mood.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.mood.enabled" aria-label="选择心情提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.mood.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div v-if="settingsScope === 'weight' || isGeneralSection('notifications')" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">体重记录</span>
            <span class="caption body-muted">提醒在固定时间记录体重</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.weight.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.weight.enabled" />
              AI 根据最近体重记录生成关怀文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.weight.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.weight.enabled" aria-label="选择体重提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.weight.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div v-if="settingsScope === 'debts' || isGeneralSection('notifications')" class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">省钱计划</span>
            <span class="caption body-muted">提醒查看目标和记录存款</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.savings.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.savings.enabled" />
              AI 根据最近省钱计划生成鼓励文案
            </label>
          </div>
          <AppTimeField v-model="settingsStore.notificationSettings.savings.time" class="reminder-time" :disabled="!settingsStore.notificationSettings.savings.enabled" aria-label="选择省钱提醒时间" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.savings.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <button class="button-primary full-width reminder-save" :disabled="isSavingReminders" @click="saveReminderSettings">
          {{ isSavingReminders ? '正在安排提醒…' : '保存通知提醒' }}
        </button>
        <button class="button-secondary-pill full-width reminder-test" :disabled="isTestingNotification" @click="testNotification">
          {{ isTestingNotification ? '正在发送测试通知…' : '发送一条测试通知' }}
        </button>
        <button
          v-if="reminderStatus.permission === 'granted' && reminderStatus.exactAlarm === 'denied' && reminderStatus.pending.length"
          class="button-secondary-pill full-width reminder-exact"
          :disabled="isRequestingExactAlarm"
          @click="enableExactReminders"
        >
          {{ isRequestingExactAlarm ? '正在打开系统设置…' : '开启准时提醒权限' }}
        </button>
        <div class="reminder-status" :class="{ warning: reminderStatus.permission === 'denied' || reminderStatus.exactAlarm === 'denied' }">
          <strong>系统状态</strong>
          <span>{{ reminderStatusText }}</span>
          <span v-if="reminderFeedback">{{ reminderFeedback }}</span>
        </div>
        <p class="caption body-muted reminder-note">普通提醒完全在设备本地调度。划掉最近任务或重启手机后仍可提醒；但在系统设置中“强制停止”应用会让 Android 删除全部闹钟，需重新打开 ForMyself 恢复。部分品牌手机还需允许自启动和后台运行。开启 AI 后，仅对应模块的最近记录会发送给你配置的 AI 服务。</p>
      </div>
    </div>
</template>
