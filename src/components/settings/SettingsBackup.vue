<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { backupPickerOpen, backupTypeOptions, exportDataType, exportJSON, fileInputRef, getDataTypeLabel, handleFileUpload, isGeneralSection, triggerImport } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('data')" class="setting-section">
      <h3 class="caption body-muted section-title">数据备份</h3>

      <div class="store-utility-card" style="margin-top: 8px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">选择要操作的数据类型</label>
        <button class="backup-type-button" @click="backupPickerOpen = true">
          <span>{{ backupTypeOptions.find(item => item.value === exportDataType)?.label }}</span>
          <b>›</b>
        </button>
      </div>

      <div class="ios-list" style="margin-top: 8px;">
        <button class="list-item text-link" style="text-align: left;" @click="exportJSON">
          导出{{ getDataTypeLabel() }}加密备份 (.json)
        </button>
        <button class="list-item text-link" style="text-align: left;" @click="triggerImport">
          导入{{ getDataTypeLabel() }}数据还原
        </button>
        <input type="file" accept=".json" ref="fileInputRef" style="display: none" @change="handleFileUpload" />
      </div>
          <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">完整备份包含省钱、体重、心情、密码库、日程、每日待办，以及彼方的角色、世界、全部聊天（含加密历史）、记忆和事件，还包含应用设置和 API Key，使用当前主密码加密；不包含主密码或设备生物识别凭据。恢复旧完整备份时，可保留其他模块并明确丢弃旧聊天。仍可选择单项备份。</p>
    </div>
</template>
