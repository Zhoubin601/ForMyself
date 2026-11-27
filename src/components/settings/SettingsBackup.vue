<script setup>
import { computed, toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const {
  backupPickerOpen,
  backupTypeOptions,
  cancelPortableRestore,
  confirmPortableRestore,
  exportDataType,
  exportJSON,
  fileInputRef,
  getDataTypeLabel,
  handleFileUpload,
  handlePortableFileChange,
  isGeneralSection,
  manualCleanupUnconfirmedTask,
  portableBackupPassword,
  portableFileInputRef,
  portableRestoreState,
  refreshBackupCapability,
  retryPortableRestoreCleanup,
  retryPortableRestoreSync,
  reverifyUnconfirmedTask,
  startPortableRestore,
  triggerImport,
  triggerPortableFileSelect,
} = toRefs(props.model)

const capability = computed(() => portableRestoreState.value?.capability || null)
const canStartPortableRestore = computed(() =>
  Boolean(capability.value?.portableRestoreAvailable)
  && !portableRestoreState.value?.busy
  && Boolean(portableRestoreState.value?.selectedFileName)
  && Boolean(portableBackupPassword.value)
)
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
      <input ref="fileInputRef" type="file" accept=".json" style="display: none" @change="handleFileUpload" />
    </div>
    <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">完整备份包含省钱、体重、心情、密码库、日程、每日待办，以及彼方的角色、世界、全部聊天（含加密历史）、记忆和事件，还包含应用设置和 API Key，使用当前主密码加密；不包含主密码或设备生物识别凭据。恢复旧完整备份时，可保留其他模块并明确丢弃旧聊天。仍可选择单项备份。</p>

    <h3 class="caption body-muted section-title" style="margin-top: 16px;">加密容器隔离恢复与运行能力</h3>

    <div class="store-utility-card" data-testid="portable-capability-card" style="margin-top: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <span class="caption" data-testid="capability-summary">
          能力状态：{{ portableRestoreState.capabilityLoading ? '检测中…' : (capability?.portableRestoreAvailable ? '可用' : '不可用') }}
        </span>
        <button
          class="text-link"
          type="button"
          :disabled="portableRestoreState.capabilityLoading || portableRestoreState.busy"
          data-testid="refresh-capability-btn"
          @click="refreshBackupCapability"
        >
          重新检测
        </button>
      </div>
      <div v-if="capability" class="caption body-muted" style="margin-top: 8px; line-height: 1.6;" data-testid="capability-details">
        <div>当前平台：{{ capability.platform }}<span v-if="capability.androidApi">（Android API {{ capability.androidApi }}）</span></div>
        <div>WebView 版本：{{ capability.webviewVersion || '不适用（Web 浏览器）' }}</div>
        <div>Bridge 状态：{{ capability.bridgeStatus }}</div>
        <div>SQLite 插件状态：{{ capability.sqlitePluginStatus }}</div>
        <div>SAF 能力状态：{{ capability.safStatus }}</div>
        <div v-if="!capability.portableRestoreAvailable" data-testid="capability-unavailable-reason" style="color: var(--danger, #d93025); margin-top: 4px;">
          不可用原因（{{ capability.unavailableCode || 'UNAVAILABLE' }}）：{{ capability.unavailableReason }}
        </div>
      </div>
    </div>

    <div class="store-utility-card" data-testid="portable-restore-card" style="margin-top: 8px;">
      <div class="caption" data-testid="restore-phase-label">
        当前恢复阶段：{{ portableRestoreState.phaseLabel }}
      </div>
      <div v-if="portableRestoreState.progressPercent > 0" class="caption body-muted" data-testid="restore-progress" style="margin-top: 4px;">
        恢复进度：{{ portableRestoreState.progressPercent }}%
      </div>

      <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        <button
          class="backup-type-button"
          type="button"
          :disabled="portableRestoreState.busy"
          data-testid="select-portable-file-btn"
          @click="triggerPortableFileSelect"
        >
          <span>{{ portableRestoreState.selectedFileName || '选择加密备份文件 (.kpb1)' }}</span>
          <b>›</b>
        </button>
        <input
          ref="portableFileInputRef"
          type="file"
          accept=".kpb1,application/octet-stream"
          style="display: none"
          data-testid="portable-file-input"
          @change="handlePortableFileChange"
        />

        <input
          v-model="portableBackupPassword"
          type="password"
          autocomplete="off"
          placeholder="输入备份文件独立密码"
          :disabled="portableRestoreState.busy"
          data-testid="portable-password-input"
          class="backup-type-button"
        />

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button
            class="text-link"
            type="button"
            :disabled="!canStartPortableRestore"
            data-testid="start-portable-restore-btn"
            @click="startPortableRestore"
          >
            开始解密与隔离校验
          </button>

          <button
            v-if="portableRestoreState.phase === 'awaiting_confirmation'"
            class="text-link"
            type="button"
            :disabled="portableRestoreState.busy"
            data-testid="confirm-portable-restore-btn"
            @click="confirmPortableRestore"
          >
            确认通过协调器切换
          </button>

          <button
            v-if="portableRestoreState.busy || portableRestoreState.phase === 'awaiting_confirmation'"
            class="text-link"
            type="button"
            data-testid="cancel-portable-restore-btn"
            @click="cancelPortableRestore"
          >
            取消恢复
          </button>
        </div>
      </div>

      <div v-if="portableRestoreState.stagedSummary" class="caption body-muted" data-testid="staged-summary" style="margin-top: 8px;">
        隔离临时库已通过 50 项摘要与完整性核验：数据集 {{ portableRestoreState.stagedSummary.datasetIdentity }}，共 {{ portableRestoreState.stagedSummary.totalBusinessRows }} 行业务记录（{{ portableRestoreState.stagedSummary.worldCount }} 个世界，{{ portableRestoreState.stagedSummary.messageCount }} 条消息）。
      </div>

      <div v-if="portableRestoreState.errorCode" class="caption" data-testid="restore-error-box" style="margin-top: 8px; color: var(--danger, #d93025);">
        <div>错误码：{{ portableRestoreState.errorCode }}</div>
        <div>原因：{{ portableRestoreState.errorMessage }}</div>
        <div v-if="portableRestoreState.retryHint">重试指引：{{ portableRestoreState.retryHint }}</div>
      </div>

      <div v-if="portableRestoreState.completionResult?.committed" class="caption" data-testid="restore-completion-box" style="margin-top: 8px; color: var(--success, #188038);">
        恢复已完成并经协调器提交：数据集 {{ portableRestoreState.completionResult.datasetIdentity }}（{{ portableRestoreState.completionResult.tableCount }}/50 表摘要已核验，{{ portableRestoreState.completionResult.totalBusinessRows }} 行）。
      </div>

      <div v-if="portableRestoreState.syncError" class="caption" data-testid="restore-sync-error" style="margin-top: 8px; color: var(--warning, #b06000);">
        <div>{{ portableRestoreState.syncError }}</div>
        <button class="text-link" type="button" data-testid="retry-sync-btn" @click="retryPortableRestoreSync">
          重试派生同步
        </button>
      </div>

      <div v-if="portableRestoreState.cleanupError" class="caption" data-testid="restore-cleanup-error" style="margin-top: 8px; color: var(--warning, #b06000);">
        <div>{{ portableRestoreState.cleanupError }}</div>
        <button class="text-link" type="button" data-testid="retry-cleanup-btn" @click="retryPortableRestoreCleanup">
          重试清理临时材料
        </button>
      </div>
    </div>

    <div
      v-if="portableRestoreState.unconfirmedItems.length > 0 || portableRestoreState.phase === 'unconfirmed' || portableRestoreState.phase === 'manual_verification_required'"
      class="store-utility-card"
      data-testid="unconfirmed-panel"
      style="margin-top: 8px;"
    >
      <div class="caption" style="font-weight: 600;">未确认提交记录（UNCONFIRMED 人工核验入口）</div>
      <p class="caption body-muted" style="margin: 4px 0 8px;">系统不会自动删除状态未确认的恢复材料。请先执行重新核验，仅在确认安全后执行人工清理。</p>
      <div v-for="item in portableRestoreState.unconfirmedItems" :key="item.taskId" class="caption" data-testid="unconfirmed-item" style="padding: 8px 0; border-top: 1px solid rgba(128,128,128,0.18);">
        <div>任务：{{ item.taskId }}（{{ item.kind }} / {{ item.state }}）</div>
        <div class="body-muted">原因：{{ item.reason }} · 锁状态：{{ item.lockActive ? '活跃锁定' : '空闲' }} · 摘要匹配：{{ item.shaMatches ? '是' : '否' }}</div>
        <div style="display: flex; gap: 10px; margin-top: 6px;">
          <button
            class="text-link"
            type="button"
            :disabled="portableRestoreState.unconfirmedBusy"
            :data-testid="`reverify-unconfirmed-${item.taskId}`"
            @click="reverifyUnconfirmedTask(item.taskId)"
          >
            重新核验
          </button>
          <button
            class="text-link"
            type="button"
            :disabled="portableRestoreState.unconfirmedBusy"
            :data-testid="`cleanup-unconfirmed-${item.taskId}`"
            @click="manualCleanupUnconfirmedTask(item.taskId)"
          >
            人工确认清理
          </button>
        </div>
      </div>
      <div v-if="portableRestoreState.unconfirmedMessage" class="caption body-muted" data-testid="unconfirmed-feedback" style="margin-top: 6px;">
        {{ portableRestoreState.unconfirmedMessage }}
      </div>
    </div>
  </div>
</template>
