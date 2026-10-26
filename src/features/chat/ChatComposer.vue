<script setup>
import { toRefs, ref } from 'vue'
const props = defineProps({ hasApiKey: { type: Boolean, required: true }, openAiSettings: { type: Function, required: true }, replyTarget: { type: Object, default: null }, quotedSpeaker: { type: Function, required: true }, sendMessage: { type: Function, required: true }, isGenerating: { type: Boolean, required: true }, stopReply: { type: Function, required: true } })
const { hasApiKey, openAiSettings, replyTarget, quotedSpeaker, sendMessage, isGenerating, stopReply } = toRefs(props)
defineEmits(["cancel-quote"])
const draft = defineModel('draft', { type: String, default: '' })
const composerRef = ref(null)
const resize = () => {
  const element = composerRef.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = Math.min(element.scrollHeight, 132) + 'px'
}
defineExpose({ focus: () => composerRef.value?.focus(), resetHeight: () => { if (composerRef.value) composerRef.value.style.height = '' } })

</script>

<template>
    <footer class="chat-composer">
      <div v-if="!hasApiKey" class="api-reminder">
        <span>配置自己的 AI Key 后，就能开始聊天</span>
        <button type="button" @click="openAiSettings">去配置</button>
      </div>
      <div v-if="replyTarget" class="composer-quote">
        <div>
          <strong>回复 {{ quotedSpeaker(replyTarget) }}</strong>
          <span>{{ replyTarget.content }}</span>
        </div>
        <button type="button" aria-label="取消引用" @click="$emit('cancel-quote')">×</button>
      </div>
      <div class="composer-shell">
        <textarea
          ref="composerRef"
          v-model="draft"
          rows="1"
          maxlength="12000"
          enterkeyhint="send"
          placeholder="想和她说点什么…"
          @input="resize"
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <div class="composer-actions">
          <button
            v-if="isGenerating"
            class="send-button stop"
            type="button"
            aria-label="停止生成"
            @click="stopReply"
          >
<i></i>
</button>
          <button
            class="send-button"
            type="button"
            aria-label="发送消息"
            :disabled="!draft.trim() || !hasApiKey"
            @click="sendMessage"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm6.5 1.5L19 5" /></svg>
          </button>
        </div>
      </div>
      <p>聊天与选中的生活记录会发送给你配置的 AI 服务商</p>
    </footer>
</template>
