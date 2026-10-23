<script setup>
import { computed, ref, toRefs } from 'vue'
import { appToast } from '../../services/uiFeedback.js'
const props = defineProps({ model: { type: Object, required: true } })
const { isGeneralSection, isTestingAI, settingsStore, testAIConnection } = toRefs(props.model)
const isSaving = ref(false)
const storageStatus = computed(() => settingsStore.value.apiKeyStorageStatus)
const keyUnavailable = computed(() => ['loading', 'load-error'].includes(storageStatus.value))
const statusMessage = computed(() => ({
  loading: '正在读取 API Key…',
  empty: '尚未配置 API Key。',
  saving: '正在保存 API Key，请稍候…',
  saved: 'API Key 已安全保存。',
  'save-error': 'API Key 保存失败，请重试保存，成功前请勿关闭应用。',
  'load-error': 'API Key 读取失败，原配置已保留，请重试读取。'
})[storageStatus.value] || '')
const saveSettings = async () => {
  isSaving.value = true
  try {
    await settingsStore.value.saveAiSettings()
    appToast('AI 配置已保存', { tone: 'success' })
  } catch {
    appToast('AI 配置保存失败，请重试', { tone: 'danger' })
  } finally { isSaving.value = false }
}
</script>

<template>
    <!-- AI 情绪陪伴引擎 -->
    <div v-if="isGeneralSection('ai')" class="setting-section ai-settings-section">
      <h3 class="caption body-muted section-title">🤖 AI 情绪陪伴 (BYOK)</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <p class="caption body-muted" style="margin: 0 0 16px 0;">自备 Key 接入，兼容 DeepSeek / OpenAI / 通义千问等标准 API。使用 AI 时，所选聊天与生活上下文会发送给这里配置的服务商；密码库、主密码、API Key 和其他安全凭据绝不会作为聊天上下文发送。</p>
        <div class="input-group">
          <label class="caption">API 接口地址</label>
          <input v-model="settingsStore.aiProviderUrl" type="text" class="apple-input" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label for="ai-api-key" class="caption">API Key</label>
          <input id="ai-api-key" v-model="settingsStore.aiApiKey" type="password" class="apple-input" :disabled="keyUnavailable || !settingsStore.isDataLoaded" :placeholder="keyUnavailable ? '等待读取原配置' : 'sk-...'" aria-describedby="ai-key-storage-status" autocomplete="off" spellcheck="false" />
          <p id="ai-key-storage-status" class="caption body-muted" role="status" aria-atomic="true">{{ statusMessage }}</p>
          <button v-if="storageStatus === 'load-error' || storageStatus === 'save-error'" class="button-secondary-pill full-width" type="button" @click="settingsStore.retryApiKeyStorage()">
            {{ storageStatus === 'load-error' ? '重试读取 API Key' : '重试保存 API Key' }}
          </button>
        </div>
        <div class="input-group">
          <label class="caption">模型名称</label>
          <input v-model="settingsStore.aiModel" type="text" class="apple-input" placeholder="deepseek-chat / gpt-4o-mini" autocomplete="off" spellcheck="false" />
        </div>
        <button class="button-secondary-pill full-width" type="button" style="margin-top: 8px;" :disabled="keyUnavailable || isSaving || !settingsStore.isDataLoaded" @click="saveSettings">
          {{ isSaving ? '正在保存…' : '保存配置' }}
        </button>
        <button class="button-primary full-width" style="margin-top: 8px;" :disabled="isTestingAI || isSaving || keyUnavailable || !settingsStore.isDataLoaded" @click="testAIConnection">
          {{ isTestingAI ? '⏳ 连接测试中...' : '⚡ 测试 AI 握手' }}
        </button>
      </div>
    </div>
</template>

<style scoped>
.ai-settings-section .full-width {
  display: flex;
  justify-content: center;
  width: 100%;
  min-height: 48px;
}
.ai-settings-section button:disabled { opacity: .5; cursor: default; }
</style>
