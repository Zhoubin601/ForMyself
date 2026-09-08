<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { isGeneralSection, moduleHealthForm, saveModuleHealthSettings, settingsScope } = toRefs(props.model)
</script>

<template>
    <div v-if="settingsScope === 'weight' || isGeneralSection('health')" class="setting-section">
      <h3 class="caption body-muted section-title">健康与趋势</h3>
      <div class="store-utility-card health-settings-card">
        <div class="health-setting-grid">
          <label class="input-group">
            <span class="caption">身高（cm）</span>
            <input v-model="moduleHealthForm.heightCm" type="number" min="80" max="250" class="apple-input" placeholder="例如 170" />
          </label>
          <label class="input-group">
            <span class="caption">目标体重（kg）</span>
            <input v-model="moduleHealthForm.targetWeight" type="number" min="20" max="300" step="0.1" class="apple-input" placeholder="例如 65" />
          </label>
        </div>
        <label class="health-reminder-toggle">
          <span>
            <strong>体重变化提醒</strong>
            <small>与上一条记录变化达到阈值时提醒</small>
          </span>
          <span class="switch-control">
            <input v-model="moduleHealthForm.weightChangeReminderEnabled" type="checkbox" />
            <i></i>
          </span>
        </label>
        <label v-if="moduleHealthForm.weightChangeReminderEnabled" class="input-group threshold-field">
          <span class="caption">变化阈值（kg）</span>
          <input v-model="moduleHealthForm.weightChangeThreshold" type="number" min="0.1" max="20" step="0.1" class="apple-input" />
        </label>
        <button class="button-primary full-width" @click="saveModuleHealthSettings">保存健康设置</button>
      </div>
    </div>
</template>
