<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { isGeneralSection, isTestingAI, settingsStore, testAIConnection } = toRefs(props.model)
</script>

<template>
    <!-- AI 情绪陪伴引擎 -->
    <div v-if="isGeneralSection('ai')" class="setting-section">
      <h3 class="caption body-muted section-title">🤖 AI 情绪陪伴 (BYOK)</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <p class="caption body-muted" style="margin: 0 0 16px 0;">自备 Key 接入，兼容 DeepSeek / OpenAI / 通义千问等标准 API。使用 AI 时，所选聊天与生活上下文会发送给这里配置的服务商；密码库、主密码、API Key 和其他安全凭据绝不会作为聊天上下文发送。</p>
        <div class="input-group">
          <label class="caption">API 接口地址</label>
          <input v-model="settingsStore.aiProviderUrl" type="text" class="apple-input" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">API Key</label>
          <input v-model="settingsStore.aiApiKey" type="password" class="apple-input" placeholder="sk-..." autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">模型名称</label>
          <input v-model="settingsStore.aiModel" type="text" class="apple-input" placeholder="deepseek-chat / gpt-4o-mini" autocomplete="off" spellcheck="false" />
        </div>
        <button class="button-primary full-width" style="margin-top: 8px;" :disabled="isTestingAI" @click="testAIConnection">
          {{ isTestingAI ? '⏳ 连接测试中...' : '⚡ 测试 AI 握手' }}
        </button>
      </div>
    </div>
</template>
