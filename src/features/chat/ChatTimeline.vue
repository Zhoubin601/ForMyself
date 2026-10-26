<script setup>
import { toRefs } from 'vue'
const props = defineProps({ timelineReady: { type: Boolean, required: true }, handleTimelineScroll: { type: Function, required: true }, hasOlderMessages: { type: Boolean, required: true }, timelineItems: { type: Array, required: true }, isNewDay: { type: Function, required: true }, formatDay: { type: Function, required: true }, firstUnreadMessageId: { type: String, required: true }, isGroupStart: { type: Function, required: true }, isGroupEnd: { type: Function, required: true }, highlightedMessageId: { type: String, required: true }, companionName: { type: String, required: true }, handleCompanionAvatarTap: { type: Function, required: true }, companionAvatar: { type: String, required: true }, swipingMessageId: { type: String, required: true }, swipeOffset: { type: Number, required: true }, startMessageGesture: { type: Function, required: true }, moveMessageGesture: { type: Function, required: true }, finishMessageGesture: { type: Function, required: true }, cancelMessageGesture: { type: Function, required: true }, openMessageActions: { type: Function, required: true }, scrollToQuotedMessage: { type: Function, required: true }, quotedSpeaker: { type: Function, required: true }, formatTime: { type: Function, required: true }, retryMessageId: { type: String, required: true }, isGenerating: { type: Boolean, required: true }, retryLastReply: { type: Function, required: true } })
const { timelineReady, handleTimelineScroll, hasOlderMessages, timelineItems, isNewDay, formatDay, firstUnreadMessageId, isGroupStart, isGroupEnd, highlightedMessageId, companionName, handleCompanionAvatarTap, companionAvatar, swipingMessageId, swipeOffset, startMessageGesture, moveMessageGesture, finishMessageGesture, cancelMessageGesture, openMessageActions, scrollToQuotedMessage, quotedSpeaker, formatTime, retryMessageId, isGenerating, retryLastReply } = toRefs(props)
defineEmits(["element","bottom","load-older"])

</script>

<template>
    <main
      :ref="element => $emit('element', element)"
      class="chat-timeline"
      :class="{ 'timeline-ready': timelineReady }"
      aria-live="polite"
      @scroll.passive="handleTimelineScroll"
    >
      <button v-if="hasOlderMessages" class="load-older" type="button" @click="$emit('load-older')">
        加载更早的聊天
      </button>

      <template v-for="(item, index) in timelineItems" :key="item.id">
        <div v-if="isNewDay(index)" class="day-divider"><span>{{ formatDay(item.createdAt) }}</span></div>
        <div v-if="item.id === firstUnreadMessageId" class="unread-divider">
          <span>以下是新消息</span>
        </div>
        <div v-if="item.type === 'poke'" class="poke-event" :data-message-id="item.id">
          <span>{{ item.content }}</span>
        </div>
        <article
          v-else
          class="message-row"
          :class="[
            `message-${item.role}`,
            {
              stopped: item.status === 'stopped',
              'group-start': isGroupStart(index),
              'group-end': isGroupEnd(index),
              'message-highlighted': highlightedMessageId === item.id
            }
          ]"
          :data-message-id="item.kind === 'message' ? item.id : undefined"
        >
          <button
            v-if="item.role === 'assistant' && isGroupStart(index)"
            class="message-avatar"
            type="button"
            :aria-label="`双击拍一拍${companionName}`"
            @click="handleCompanionAvatarTap"
          >
            <img v-if="companionAvatar" :src="companionAvatar" alt="" />
            <span v-else>♡</span>
          </button>
          <div
            v-else-if="item.role === 'assistant'"
            class="message-avatar-placeholder"
            aria-hidden="true"
          ></div>
          <div class="message-column">
            <span
              v-if="swipingMessageId === item.id"
              class="swipe-quote-indicator"
              :class="{ ready: swipeOffset >= 56 }"
              aria-hidden="true"
            >↩</span>
            <div
              class="message-bubble"
              :style="swipingMessageId === item.id ? { transform: `translateX(${swipeOffset}px)` } : undefined"
              @pointerdown="startMessageGesture(item, $event)"
              @pointermove="moveMessageGesture(item, $event)"
              @pointerup="finishMessageGesture(item)"
              @pointercancel="cancelMessageGesture"
              @contextmenu.prevent="openMessageActions(item)"
            >
              <button
                v-if="item.replyTo"
                class="message-quote"
                type="button"
                @click.stop="scrollToQuotedMessage(item.replyTo.messageId)"
              >
                <strong>{{ quotedSpeaker(item.replyTo) }}</strong>
                <span>{{ item.replyTo.content }}</span>
              </button>
              <span v-if="item.loading" class="typing-dots"><i></i><i></i><i></i></span>
              <span v-else class="message-text">{{ item.content }}</span>
              <i v-if="item.kind === 'streaming' && item.content && item.streamingTail" class="stream-cursor"></i>
            </div>
            <div v-if="item.kind === 'message' && item.reactions?.length" class="message-reactions">
              <span
                v-for="reaction in item.reactions"
                :key="`${item.id}-${reaction.actor}`"
                :title="reaction.actor === 'assistant' ? `${companionName}的回应` : '我的回应'"
              >{{ reaction.emoji }}</span>
            </div>
            <div v-if="item.kind === 'message' && isGroupEnd(index)" class="message-meta">
              <span>{{ formatTime(item.createdAt) }}{{ item.status === 'stopped' ? ' · 已停止' : '' }}</span>
              <button type="button" :aria-label="`打开${item.role === 'assistant' ? companionName : '我的'}消息操作`" @click="openMessageActions(item)">•••</button>
            </div>
          </div>
        </article>
      </template>

      <div v-if="retryMessageId && !isGenerating" class="retry-card">
        <span>刚才的回复没有送达</span>
        <button type="button" @click="retryLastReply">重新呼唤{{ companionName }}</button>
      </div>
      <div :ref="element => $emit('bottom', element)" class="chat-bottom-anchor" aria-hidden="true"></div>
    </main>
</template>
