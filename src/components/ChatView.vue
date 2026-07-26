<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { useMoodStore } from '../stores/mood'
import { useWeightStore } from '../stores/weight'
import { useDebtStore } from '../stores/debt'
import { useScheduleStore } from '../stores/schedule'
import { addDays, formatLocalDate } from '../services/scheduleCore'
import {
  buildChatLifeContext,
  buildChatSystemPrompt,
  buildWelcomeRequest,
  extractMemoriesForExchange,
  localWelcome,
  splitCompanionReply,
  streamCompanionReply
} from '../services/chatCompanion'
import { streamAIChat } from '../services/aiEngine'
import { appAlert, appConfirm, appToast } from '../services/uiFeedback'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()
const scheduleStore = useScheduleStore()

const draft = ref('')
const visibleCount = ref(100)
const sessionWelcome = ref('')
const isWelcoming = ref(false)
const isGenerating = ref(false)
const streamingText = ref('')
const streamingStartedAt = ref(0)
const retryMessageId = ref('')
const timelineRef = ref(null)
const timelineBottomRef = ref(null)
const timelineReady = ref(false)
const composerRef = ref(null)
const replyTarget = ref(null)
const actionMessage = ref(null)
const highlightedMessageId = ref('')
const sessionStartedAt = Date.now()
let welcomeController = null
let replyController = null
let componentActive = true
let replyAbortReason = ''
let longPressTimer = null
let longPressOrigin = null
let highlightTimer = null

const companionName = computed(() => chatStore.profile.companionName)
const companionAvatar = computed(() => chatStore.profile.companionAvatar)
const hasApiKey = computed(() => !!settingsStore.aiApiKey?.trim())
const visibleMessages = computed(() => chatStore.messages.slice(-visibleCount.value))
const hasOlderMessages = computed(() => visibleCount.value < chatStore.messages.length)

const timelineItems = computed(() => {
  const items = visibleMessages.value.map(message => ({ ...message, kind: 'message' }))
  if (sessionWelcome.value || isWelcoming.value) {
    items.push({
      id: 'session-welcome',
      role: 'assistant',
      content: sessionWelcome.value,
      createdAt: sessionStartedAt,
      status: 'complete',
      kind: 'welcome',
      loading: isWelcoming.value && !sessionWelcome.value
    })
  }
  if (streamingText.value || isGenerating.value) {
    const parts = splitCompanionReply(streamingText.value)
    if (!parts.length) {
      items.push({
        id: 'streaming-reply',
        role: 'assistant',
        content: '',
        createdAt: streamingStartedAt.value || Date.now(),
        status: 'complete',
        kind: 'streaming',
        loading: true,
        streamingTail: true
      })
    } else {
      parts.forEach((content, index) => items.push({
        id: `streaming-reply-${index}`,
        role: 'assistant',
        content,
        createdAt: (streamingStartedAt.value || Date.now()) + index,
        status: 'complete',
        kind: 'streaming',
        loading: false,
        streamingTail: index === parts.length - 1
      }))
    }
  }
  return items.sort((a, b) => a.createdAt - b.createdAt || (
    a.kind === 'welcome' ? 1 : b.kind === 'welcome' ? -1 : a.id.localeCompare(b.id)
  ))
})

const isNewDay = index => {
  if (index === 0) return true
  const current = new Date(timelineItems.value[index].createdAt)
  const previous = new Date(timelineItems.value[index - 1].createdAt)
  return current.toDateString() !== previous.toDateString()
}

const formatDay = timestamp => new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short'
}).format(new Date(timestamp))

const formatTime = timestamp => new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit'
}).format(new Date(timestamp))

const quotedSpeaker = reply => (
  reply?.role === 'assistant' ? companionName.value : '我'
)

const buildLifeContext = () => {
  const today = formatLocalDate()
  return buildChatLifeContext({
    moodRecords: moodStore.moodRecords,
    weightRecords: weightStore.weightRecords,
    savedDebts: debtStore.savedDebts,
    scheduleOccurrences: scheduleStore.getOccurrences(addDays(today, -30), addDays(today, 30))
  }, today)
}

const currentSystemPrompt = () => buildChatSystemPrompt({
  companionName: companionName.value,
  memories: chatStore.memories,
  lifeContext: buildLifeContext()
})

const isNearBottom = () => {
  const element = timelineRef.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight < 140
}

const scrollToBottom = async (force = false) => {
  const shouldScroll = force || isNearBottom()
  await nextTick()
  const timeline = timelineRef.value
  if (!shouldScroll || !timeline) return
  timeline.scrollTop = timeline.scrollHeight
  await new Promise(resolve => requestAnimationFrame(resolve))
  timelineBottomRef.value?.scrollIntoView({ behavior: 'auto', block: 'end' })
  if (timelineRef.value) timelineRef.value.scrollTop = timelineRef.value.scrollHeight
}

const generateWelcome = async () => {
  welcomeController?.abort()
  welcomeController = new AbortController()
  sessionWelcome.value = ''
  if (!hasApiKey.value) {
    sessionWelcome.value = localWelcome(companionName.value)
    scrollToBottom(true)
    return
  }
  isWelcoming.value = true
  try {
    const prompt = buildWelcomeRequest({
      companionName: companionName.value,
      now: new Date(),
      recentMessages: chatStore.messages.slice(-10)
    })
    const answer = await streamAIChat({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: currentSystemPrompt(),
      signal: welcomeController.signal,
      temperature: 0.94,
      onDelta: (_delta, full) => {
        if (!componentActive) return
        sessionWelcome.value = full
        scrollToBottom()
      }
    })
    if (componentActive) sessionWelcome.value = answer
  } catch (error) {
    if (componentActive && error.code !== 'ABORTED') {
      sessionWelcome.value = localWelcome(companionName.value)
    }
  } finally {
    if (componentActive) {
      isWelcoming.value = false
      scrollToBottom(true)
    }
  }
}

const appendAssistantReply = (content, status = 'complete') => {
  const parts = splitCompanionReply(content)
  const baseTime = Date.now()
  return parts
    .map((part, index) => chatStore.appendMessage('assistant', part, {
      createdAt: baseTime + index,
      status
    }))
    .filter(Boolean)
}

const rememberExchange = async (userMessage, assistantMessages) => {
  const sourceMessage = assistantMessages.at(-1)
  if (!sourceMessage) return
  try {
    const memories = await extractMemoriesForExchange({
      userMessage: userMessage.content,
      assistantMessage: assistantMessages.map(item => item.content).join('\n'),
      assistantMessageId: sourceMessage.id,
      existingMemories: chatStore.memories
    })
    if (memories.length) chatStore.upsertMemories(memories)
  } catch (error) {
    console.warn('本轮长期记忆整理失败', error)
  }
}

const requestReply = async userMessage => {
  replyController?.abort()
  replyController = new AbortController()
  replyAbortReason = ''
  isGenerating.value = true
  retryMessageId.value = ''
  streamingText.value = ''
  streamingStartedAt.value = Date.now()
  await scrollToBottom(true)
  try {
    const answer = await streamCompanionReply({
      messages: chatStore.messages,
      systemPrompt: currentSystemPrompt(),
      sessionWelcome: sessionWelcome.value,
      signal: replyController.signal,
      onDelta: (_delta, full) => {
        if (!componentActive) return
        streamingText.value = full
        scrollToBottom()
      }
    })
    if (!componentActive) return
    const assistantMessages = appendAssistantReply(answer)
    streamingText.value = ''
    if (assistantMessages.length) rememberExchange(userMessage, assistantMessages)
  } catch (error) {
    if (error.code === 'ABORTED') {
      if (replyAbortReason === 'user' && streamingText.value.trim()) {
        appendAssistantReply(streamingText.value, 'stopped')
      }
    } else if (componentActive) {
      retryMessageId.value = userMessage.id
      appToast('回复暂时没有送达，可以点重试', { tone: 'warning', duration: 3200 })
    }
    streamingText.value = ''
    streamingStartedAt.value = 0
  } finally {
    isGenerating.value = false
    replyController = null
    scrollToBottom(true)
  }
}

const sendMessage = async () => {
  const content = draft.value.trim()
  if (!content || isGenerating.value) return
  if (!hasApiKey.value) {
    return appAlert(`请先在通用配置中填写 AI API Key，再回来和${companionName.value}聊天。`, {
      title: '还差一把钥匙',
      confirmText: '知道了'
    })
  }
  const quotedMessage = replyTarget.value
  const userMessage = chatStore.appendMessage('user', content, {
    replyTo: quotedMessage
      ? {
          messageId: quotedMessage.messageId,
          role: quotedMessage.role,
          content: quotedMessage.content
        }
      : null
  })
  if (!userMessage) return
  draft.value = ''
  replyTarget.value = null
  if (composerRef.value) composerRef.value.style.height = ''
  await requestReply(userMessage)
}

const retryLastReply = async () => {
  const message = chatStore.messages.find(item => item.id === retryMessageId.value)
  if (message && message.role === 'user' && !isGenerating.value) await requestReply(message)
}

const stopReply = () => {
  replyAbortReason = 'user'
  replyController?.abort()
}

const resizeComposer = event => {
  const element = event.target
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 132)}px`
}

const copyMessage = async message => {
  actionMessage.value = null
  try {
    await navigator.clipboard.writeText(message.content)
    appToast('消息已复制', { tone: 'success' })
  } catch {
    appAlert('当前设备无法复制这条消息')
  }
}

const deleteMessage = async message => {
  actionMessage.value = null
  if (!await appConfirm('只删除这条聊天消息；已经形成的长期记忆不会自动删除。', {
    title: '删除这条消息？',
    destructive: true
  })) return
  chatStore.deleteMessage(message.id)
  if (replyTarget.value?.messageId === message.id) replyTarget.value = null
}

const cancelMessageLongPress = () => {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = null
  longPressOrigin = null
}

const openMessageActions = item => {
  if (item?.kind !== 'message') return
  cancelMessageLongPress()
  actionMessage.value = item
}

const startMessageLongPress = (item, event) => {
  if (item?.kind !== 'message') return
  cancelMessageLongPress()
  longPressOrigin = { x: event.clientX, y: event.clientY }
  longPressTimer = setTimeout(() => {
    navigator.vibrate?.(12)
    actionMessage.value = item
    longPressTimer = null
  }, 520)
}

const moveMessageLongPress = event => {
  if (!longPressTimer || !longPressOrigin) return
  if (
    Math.abs(event.clientX - longPressOrigin.x) > 10 ||
    Math.abs(event.clientY - longPressOrigin.y) > 10
  ) cancelMessageLongPress()
}

const quoteMessage = message => {
  if (!message) return
  replyTarget.value = {
    messageId: message.id,
    role: message.role,
    content: message.content
  }
  actionMessage.value = null
  nextTick(() => composerRef.value?.focus())
}

const scrollToQuotedMessage = async messageId => {
  if (!messageId) return
  const messageIndex = chatStore.messages.findIndex(item => item.id === messageId)
  if (messageIndex >= 0) {
    const requiredCount = chatStore.messages.length - messageIndex
    if (requiredCount > visibleCount.value) {
      visibleCount.value = Math.ceil(requiredCount / 100) * 100
      await nextTick()
    }
  }
  const target = [...(timelineRef.value?.querySelectorAll('[data-message-id]') || [])]
    .find(element => element.dataset.messageId === messageId)
  if (!target) {
    appToast('原消息已经被删除了', { duration: 2200 })
    return
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightedMessageId.value = messageId
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedMessageId.value = ''
  }, 1600)
}

const openAiSettings = () => settingsStore.switchView('settings')
const openChatSettings = () => settingsStore.openModuleSettings('chat')

onMounted(async () => {
  await scrollToBottom(true)
  timelineReady.value = true
  generateWelcome()
})

onBeforeUnmount(() => {
  componentActive = false
  cancelMessageLongPress()
  if (highlightTimer) clearTimeout(highlightTimer)
  welcomeController?.abort()
  replyAbortReason = 'unmount'
  replyController?.abort()
})
</script>

<template>
  <div class="warm-home">
    <header class="companion-header">
      <div class="companion-avatar" aria-hidden="true">
        <img v-if="companionAvatar" :src="companionAvatar" alt="" />
        <span v-else>♡</span>
      </div>
      <div class="companion-identity">
        <strong>{{ companionName }}</strong>
        <span><i></i> 陪着你</span>
      </div>
      <button class="memory-button" type="button" aria-label="查看长期记忆" @click="openChatSettings">
        <span>{{ chatStore.memories.length }}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10v15l-5-3-5 3v-15Z"/></svg>
      </button>
    </header>

    <div v-if="chatStore.loadError" class="chat-warning">
      <strong>聊天数据暂时无法读取</strong>
      <span>{{ chatStore.loadError }}</span>
    </div>

    <main
      ref="timelineRef"
      class="chat-timeline"
      :class="{ 'timeline-ready': timelineReady }"
      aria-live="polite"
    >
      <button v-if="hasOlderMessages" class="load-older" type="button" @click="visibleCount += 100">
        加载更早的聊天
      </button>

      <template v-for="(item, index) in timelineItems" :key="item.id">
        <div v-if="isNewDay(index)" class="day-divider"><span>{{ formatDay(item.createdAt) }}</span></div>
        <article
          class="message-row"
          :class="[
            `message-${item.role}`,
            {
              stopped: item.status === 'stopped',
              'message-highlighted': highlightedMessageId === item.id
            }
          ]"
          :data-message-id="item.kind === 'message' ? item.id : undefined"
        >
          <div v-if="item.role === 'assistant'" class="message-avatar" aria-hidden="true">
            <img v-if="companionAvatar" :src="companionAvatar" alt="" />
            <span v-else>♡</span>
          </div>
          <div class="message-column">
            <div
              class="message-bubble"
              @pointerdown="startMessageLongPress(item, $event)"
              @pointermove="moveMessageLongPress"
              @pointerup="cancelMessageLongPress"
              @pointercancel="cancelMessageLongPress"
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
            <div v-if="item.kind === 'message'" class="message-meta">
              <span>{{ formatTime(item.createdAt) }}{{ item.status === 'stopped' ? ' · 已停止' : '' }}</span>
              <button type="button" @click="copyMessage(item)">复制</button>
              <button type="button" @click="deleteMessage(item)">删除</button>
            </div>
          </div>
        </article>
      </template>

      <div v-if="retryMessageId && !isGenerating" class="retry-card">
        <span>刚才的回复没有送达</span>
        <button type="button" @click="retryLastReply">重新呼唤{{ companionName }}</button>
      </div>
      <div ref="timelineBottomRef" class="chat-bottom-anchor" aria-hidden="true"></div>
    </main>

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
        <button type="button" aria-label="取消引用" @click="replyTarget = null">×</button>
      </div>
      <div class="composer-shell">
        <textarea
          ref="composerRef"
          v-model="draft"
          rows="1"
          maxlength="12000"
          :disabled="isGenerating"
          placeholder="想和她说点什么…"
          @input="resizeComposer"
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <button
          v-if="isGenerating"
          class="send-button stop"
          type="button"
          aria-label="停止生成"
          @click="stopReply"
        ><i></i></button>
        <button
          v-else
          class="send-button"
          type="button"
          aria-label="发送消息"
          :disabled="!draft.trim() || !hasApiKey"
          @click="sendMessage"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm6.5 1.5L19 5"/></svg>
        </button>
      </div>
      <p>聊天与选中的生活记录会发送给你配置的 AI 服务商</p>
    </footer>
  </div>

  <Teleport to="body">
    <div v-if="actionMessage" class="message-action-layer" @click.self="actionMessage = null">
      <section class="message-action-sheet" role="dialog" aria-modal="true" aria-label="消息操作">
        <div class="message-action-preview">
          <strong>{{ actionMessage.role === 'assistant' ? companionName : '我' }}</strong>
          <span>{{ actionMessage.content }}</span>
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
        <button class="message-action-cancel" type="button" @click="actionMessage = null">取消</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.warm-home {
  flex: 1 1 0;
  width: 100%;
  height: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(circle at 10% 0%, rgba(var(--theme-primary-rgb), .13), transparent 31%),
    linear-gradient(180deg, var(--theme-soft), var(--surface-pearl) 24%, var(--canvas) 100%);
}

.companion-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding: 14px 17px 12px;
  border-bottom: 1px solid var(--divider-soft);
  background: rgba(255,255,255,.82);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.companion-avatar, .message-avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  overflow: hidden;
  color: white;
  background: var(--theme-gradient);
  box-shadow: 0 7px 18px rgba(var(--theme-primary-rgb), .22);
}
.companion-avatar img, .message-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.companion-avatar { width: 43px; height: 43px; border-radius: 16px; font-size: 24px; }
.companion-identity { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.companion-identity strong { font-size: 17px; }
.companion-identity span { color: var(--body-muted); font-size: 11px; }
.companion-identity i { display: inline-block; width: 6px; height: 6px; margin-right: 3px; border-radius: 50%; background: #39ad79; }
.memory-button {
  display: flex; align-items: center; gap: 6px; min-width: 52px; height: 38px; padding: 0 10px;
  border: 1px solid var(--theme-border); border-radius: 13px; color: var(--primary);
  background: var(--theme-soft); font: inherit; cursor: pointer;
}
.memory-button span { font-size: 11px; font-weight: 700; }
.memory-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }

.chat-warning, .api-reminder {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  color: #875d16; background: #fff7df; border: 1px solid #f1dba5;
}
.chat-warning { margin: 10px 14px 0; padding: 10px 12px; border-radius: 13px; }
.chat-warning strong, .chat-warning span { display: block; font-size: 12px; }

.chat-timeline {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px 14px 22px;
  scroll-behavior: auto;
}
.chat-timeline:not(.timeline-ready) { visibility: hidden; }
.chat-bottom-anchor { width: 100%; height: 1px; pointer-events: none; }
.load-older {
  display: block; margin: 0 auto 16px; padding: 8px 13px; border: 1px solid var(--theme-border);
  border-radius: 999px; color: var(--primary); background: rgba(255,255,255,.82); font: inherit; font-size: 12px;
}
.day-divider { display: flex; justify-content: center; margin: 8px 0 14px; }
.day-divider span { padding: 5px 10px; border-radius: 999px; color: var(--body-muted); background: rgba(255,255,255,.72); font-size: 10px; }
.message-row { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 16px; }
.message-row.message-user { justify-content: flex-end; }
.message-avatar { width: 29px; height: 29px; margin-top: 2px; border-radius: 11px; font-size: 15px; }
.message-column { max-width: min(82%, 580px); min-width: 0; }
.message-user .message-column { display: flex; flex-direction: column; align-items: flex-end; }
.message-bubble {
  position: relative; display: inline-block; max-width: 100%; padding: 11px 13px;
  border: 1px solid var(--theme-border); border-radius: 7px 18px 18px 18px;
  color: var(--ink); background: rgba(255,255,255,.92); box-shadow: var(--shadow-card);
  touch-action: pan-y;
  -webkit-touch-callout: none;
  user-select: none;
}
.message-user .message-bubble {
  border: 0; border-radius: 18px 7px 18px 18px; color: var(--theme-on-primary);
  background: var(--theme-primary-strong); box-shadow: 0 8px 18px rgba(var(--theme-primary-rgb), .2);
}
.message-row.stopped .message-bubble { opacity: .76; }
.message-row.message-highlighted .message-bubble { animation: quoteHighlight 1.5s ease; }
@keyframes quoteHighlight {
  0%, 100% { box-shadow: var(--shadow-card); }
  35% { box-shadow: 0 0 0 4px rgba(var(--theme-primary-rgb), .25), var(--shadow-card); }
}
.message-quote {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0 0 8px;
  padding: 7px 9px;
  overflow: hidden;
  border: 0;
  border-left: 3px solid var(--theme-primary);
  border-radius: 8px;
  color: var(--body-muted);
  background: rgba(var(--theme-primary-rgb), .08);
  font: inherit;
  text-align: left;
}
.message-quote strong, .message-quote span { display: block; }
.message-quote strong { margin-bottom: 2px; color: var(--primary); font-size: 10px; }
.message-quote span {
  overflow: hidden;
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-user .message-quote {
  border-left-color: currentColor;
  color: rgba(255,255,255,.76);
  background: rgba(255,255,255,.14);
}
.message-user .message-quote strong { color: inherit; }
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.62; }
.message-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; padding: 0 3px; color: var(--body-muted); font-size: 9px; }
.message-meta button { padding: 0; border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.typing-dots { display: flex; align-items: center; gap: 4px; min-width: 40px; height: 20px; }
.typing-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); animation: dotBounce 1.1s infinite ease-in-out; }
.typing-dots i:nth-child(2) { animation-delay: .14s; }
.typing-dots i:nth-child(3) { animation-delay: .28s; }
@keyframes dotBounce { 0%, 65%, 100% { transform: translateY(0); opacity: .35; } 35% { transform: translateY(-4px); opacity: 1; } }
.stream-cursor { display: inline-block; width: 2px; height: 15px; margin-left: 3px; vertical-align: -2px; background: var(--primary); animation: cursorBlink .8s steps(1) infinite; }
@keyframes cursorBlink { 50% { opacity: 0; } }
.retry-card {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 4px auto 12px;
  max-width: 420px; padding: 10px 12px; border: 1px solid #f1dba5; border-radius: 13px; color: #875d16; background: #fff7df; font-size: 12px;
}
.retry-card button { border: 0; color: #875d16; background: transparent; font: inherit; font-weight: 700; }

.chat-composer {
  position: relative;
  z-index: 5;
  flex: 0 0 auto;
  width: 100%;
  padding: 8px 12px calc(9px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--divider-soft); background: rgba(255,255,255,.9);
  backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px);
}
.api-reminder { margin: 0 0 8px; padding: 8px 10px; border-radius: 12px; font-size: 11px; }
.api-reminder button { border: 0; color: #875d16; background: transparent; font: inherit; font-weight: 700; }
.composer-quote {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 3px 7px;
  padding: 8px 10px;
  border-left: 3px solid var(--theme-primary);
  border-radius: 9px;
  color: var(--body-muted);
  background: var(--theme-soft);
}
.composer-quote > div { flex: 1; min-width: 0; }
.composer-quote strong, .composer-quote span { display: block; }
.composer-quote strong { color: var(--primary); font-size: 10px; }
.composer-quote span {
  margin-top: 2px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-quote button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--body-muted);
  background: rgba(255,255,255,.65);
  font: inherit;
  font-size: 20px;
}
.composer-shell {
  display: flex; align-items: flex-end; gap: 8px; padding: 7px 7px 7px 13px;
  border: 1px solid var(--theme-border); border-radius: 20px; background: var(--canvas);
  box-shadow: 0 8px 24px rgba(29,39,58,.08);
}
.composer-shell textarea {
  flex: 1; min-width: 0; max-height: 132px; padding: 7px 0; border: 0; outline: 0; resize: none;
  color: var(--ink); background: transparent; font: inherit; font-size: 15px; line-height: 1.45;
}
.composer-shell textarea::placeholder { color: var(--body-muted); }
.send-button {
  display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px;
  border: 0; border-radius: 14px; color: var(--theme-on-primary); background: var(--theme-primary-strong); cursor: pointer;
}
.send-button:disabled { opacity: .38; cursor: default; }
.send-button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.send-button.stop { background: #ef6464; }
.send-button.stop i { width: 12px; height: 12px; border-radius: 3px; background: white; }
.chat-composer > p { margin: 6px 3px 0; color: var(--body-muted); font-size: 9px; text-align: center; }

.message-action-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  padding: 16px 12px calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(14,20,31,.35);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.message-action-sheet {
  width: min(100%, 520px);
  margin: 0 auto;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: 22px;
  background: var(--canvas);
  box-shadow: 0 20px 55px rgba(17,25,39,.24);
}
.message-action-preview {
  margin-bottom: 10px;
  padding: 9px 10px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface-pearl);
}
.message-action-preview strong, .message-action-preview span { display: block; }
.message-action-preview strong { color: var(--primary); font-size: 10px; }
.message-action-preview span {
  margin-top: 3px;
  overflow: hidden;
  color: var(--body-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.message-action-grid button {
  display: flex;
  min-width: 0;
  min-height: 70px;
  padding: 9px 5px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  border: 0;
  border-radius: 15px;
  color: var(--ink);
  background: var(--theme-soft);
  font: inherit;
  font-size: 12px;
}
.message-action-grid button span { color: var(--primary); font-size: 22px; line-height: 1; }
.message-action-grid button.danger, .message-action-grid button.danger span { color: #d92d20; }
.message-action-cancel {
  width: 100%;
  min-height: 44px;
  margin-top: 9px;
  border: 0;
  border-radius: 14px;
  color: var(--body-muted);
  background: var(--surface-pearl);
  font: inherit;
}

@media (min-width: 760px) {
  .chat-timeline { padding-inline: max(24px, calc((100% - 720px) / 2)); }
  .chat-composer { padding-inline: max(18px, calc((100% - 720px) / 2)); }
}

@media (prefers-reduced-motion: reduce) {
  .typing-dots i, .stream-cursor { animation: none; }
}
</style>
