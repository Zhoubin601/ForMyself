<script setup>
import { toRefs } from 'vue'
const props = defineProps({ actionMessage: { type: Object, default: null }, companionName: { type: String, required: true }, CHAT_REACTION_EMOJIS: { type: Array, required: true }, selectMessageReaction: { type: Function, required: true }, quoteMessage: { type: Function, required: true }, copyMessage: { type: Function, required: true }, deleteMessage: { type: Function, required: true } })
const { actionMessage, companionName, CHAT_REACTION_EMOJIS, selectMessageReaction, quoteMessage, copyMessage, deleteMessage } = toRefs(props)
defineEmits(["close"])

</script>

<template>
  <Teleport to="body">
    <div v-if="actionMessage" class="message-action-layer" @click.self="$emit('close')">
      <section class="message-action-sheet" role="dialog" aria-modal="true" aria-label="消息操作">
        <div class="message-action-preview">
          <strong>{{ actionMessage.role === 'assistant' ? companionName : '我' }}</strong>
          <span>{{ actionMessage.content }}</span>
        </div>
        <div v-if="actionMessage.role === 'assistant'" class="message-reaction-picker" aria-label="表情回应">
          <button
            v-for="emoji in CHAT_REACTION_EMOJIS"
            :key="emoji"
            type="button"
            :class="{
              selected: actionMessage.reactions?.some(
                reaction => reaction.actor === 'user' && reaction.emoji === emoji
              )
            }"
            @click="selectMessageReaction(actionMessage, emoji)"
          >
{{ emoji }}
</button>
        </div>
        <div class="message-action-grid">
          <button type="button" @click="quoteMessage(actionMessage)">
            <span aria-hidden="true">❝</span>
            引用回复
          </button>
          <button type="button" @click="copyMessage(actionMessage)">
            <span aria-hidden="true">▣</span>
            复制
          </button>
          <button class="danger" type="button" @click="deleteMessage(actionMessage)">
            <span aria-hidden="true">⌫</span>
            删除
          </button>
        </div>
        <button class="message-action-cancel" type="button" @click="$emit('close')">取消</button>
      </section>
    </div>
  </Teleport>
</template>
