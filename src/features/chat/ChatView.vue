<script setup>
import ChatMessageActions from './ChatMessageActions.vue'
import ChatComposer from './ChatComposer.vue'
import ChatTimeline from './ChatTimeline.vue'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch
} from 'vue'
import { useChatStore } from './chatStore'
import { useSettingsStore } from '../../stores/settings'
import { useMoodStore } from '../mood/moodStore'
import { useWeightStore } from '../../stores/weight'
import { useDebtStore } from '../../stores/debt'
import { useScheduleStore } from '../schedule/scheduleStore'
import { addDays, formatLocalDate } from '../schedule/scheduleCore'
import {
  buildCompanionTurnContext,
  buildChatLifeContext,
  buildChatSystemPrompt,
  isCompanionReplyComplete,
  sanitizeCompanionReply,
  splitCompanionReply,
  streamCompanionReply
} from './chatCompanion'
import {
  applySelfEvolutionProposals,
  naturalPacingTarget,
  bubblePacingDelay,
  parsePlannedReplyOutput,
  planChatBehavior,
  shouldKeepDelayedFollowup
} from './chatRealism'
import {
  createDelayedFollowup,
  syncChatFollowupNotifications
} from './chatFollowup'
import {
  extractRelationshipUpdateForExchange,
  formatChatDate,
  generateDailyCompanionWorld,
  localDailyCompanionWorld
} from './chatRelationship'
import {
  buildProactiveSlots,
  generateProactiveOutbox,
  generateSmartEntryMessage,
  shouldCreateSmartEntry,
  syncChatProactiveNotifications
} from './chatProactive'
import {
  planCompanionInteraction,
  planPokeFollowup,
  planReactionFollowup
} from './chatInteraction'
import { CHAT_REACTION_EMOJIS } from './chatRecords'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'
import { registerBackHandler } from '../../services/backNavigation'

const props = defineProps({
  isVisible: {
    type: Boolean,
    default: true
  }
})

const chatStore = useChatStore()
const isRetryingSave = ref(false)
const retrySave = async () => {
  if (isRetryingSave.value) return
  isRetryingSave.value = true
  try { await chatStore.flush() } catch { /* The save warning remains visible until persistence succeeds. */ }
  finally { isRetryingSave.value = false }
}
const settingsStore = useSettingsStore()
const moodStore = useMoodStore()
const weightStore = useWeightStore()
const debtStore = useDebtStore()
const scheduleStore = useScheduleStore()

const draft = ref('')
const visibleCount = ref(100)
const isGenerating = ref(false)
const isWaitingToReply = ref(false)
const streamingStartedAt = ref(0)
const retryMessageId = ref('')
const timelineRef = ref(null)
const timelineBottomRef = ref(null)
const timelineReady = ref(false)
const composerRef = ref(null)
const replyTarget = ref(null)
const actionMessage = ref(null)
const unregisterBackHandler = registerBackHandler(() => {
  if (!actionMessage.value) return false
  actionMessage.value = null
  return true
}, { priority: 550, isActive: () => Boolean(actionMessage.value) })
const highlightedMessageId = ref('')
const firstUnreadMessageId = ref('')
const newMessageCount = ref(0)
const userNearBottom = ref(true)
const viewActive = ref(props.isVisible)
const swipingMessageId = ref('')
const swipeOffset = ref(0)
let replyController = null
let componentActive = true
const isChatRunning = () => componentActive && settingsStore.warmHomeEnabled
let replyAbortReason = ''
let isStreamingRequest = false
let latestGeneratedText = ''
let replyDebounceTimer = null
let proactiveRefreshTimer = null
let followupTimer = null
let generationRun = 0
let smartEntryRun = 0
let relationshipUpdateChain = Promise.resolve()
let lightInteractionRun = 0
const pendingReplyMessageIds = new Set()
let longPressTimer = null
let longPressOrigin = null
let messageGesture = null
let highlightTimer = null
let lastAvatarTapAt = 0
let lastPokeAt = 0
let deferredFollowupBrief = ''

const companionName = computed(() => chatStore.profile.companionName)
const companionAvatar = computed(() => chatStore.profile.companionAvatar)
const hasApiKey = computed(() => !!settingsStore.aiApiKey?.trim())
const visibleMessages = computed(() => chatStore.messages.slice(-visibleCount.value))
const hasOlderMessages = computed(() => visibleCount.value < chatStore.messages.length)
const hasNewMessageJump = computed(() => newMessageCount.value > 0)
const companionPresence = computed(() => {
  if (isGenerating.value) return '正在回你'
  if (isWaitingToReply.value) return '正看着你说'
  return chatStore.companionState.statusText || '陪着你'
})

const timelineItems = computed(() => {
  const items = visibleMessages.value.map(message => ({ ...message, kind: 'message' }))
  if (isGenerating.value) {
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
  }
  return items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
})

const isNewDay = index => {
  if (index === 0) return true
  const current = new Date(timelineItems.value[index].createdAt)
  const previous = new Date(timelineItems.value[index - 1].createdAt)
  return current.toDateString() !== previous.toDateString()
}

const isGroupStart = index => {
  if (index === 0 || isNewDay(index)) return true
  if (timelineItems.value[index]?.type === 'poke' || timelineItems.value[index - 1]?.type === 'poke') return true
  return timelineItems.value[index - 1]?.role !== timelineItems.value[index]?.role
}

const isGroupEnd = index => {
  const current = timelineItems.value[index]
  const next = timelineItems.value[index + 1]
  if (!next) return true
  if (current.type === 'poke' || next.type === 'poke') return true
  const currentDate = new Date(current.createdAt).toDateString()
  const nextDate = new Date(next.createdAt).toDateString()
  return current.role !== next.role || currentDate !== nextDate
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
const toReplySnapshot = message => message
  ? {
      messageId: message.id,
      role: message.role,
      content: message.content
    }
  : null

const buildLifeContext = () => {
  const today = formatLocalDate()
  return buildChatLifeContext({
    moodRecords: moodStore.moodRecords,
    moodDefinitions: moodStore.moodDefinitions,
    weightRecords: weightStore.weightRecords,
    savedDebts: debtStore.savedDebts,
    scheduleOccurrences: scheduleStore.getOccurrences(addDays(today, -30), addDays(today, 30)),
    scheduleSeries: scheduleStore.series,
    scheduleOccurrenceStates: scheduleStore.occurrences,
    scheduleCategories: scheduleStore.categories
  }, today)
}

const currentSystemPrompt = (turnContext, behaviorPlan = null) => buildChatSystemPrompt({
  companionName: companionName.value,
  memories: turnContext.memories,
  selfProfile: chatStore.selfProfile,
  socialCast: chatStore.socialCast,
  virtualEvents: chatStore.virtualEvents,
  companionState: chatStore.companionState,
  openLoops: turnContext.openLoops,
  lifeContext: turnContext.lifeContext,
  styleState: turnContext.styleState,
  replyMode: turnContext.replyMode,
  behaviorPlan
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

const markVisibleMessagesRead = () => {
  const latestAssistantAt = chatStore.messages
    .filter(item => item.role === 'assistant')
    .reduce((latest, item) => Math.max(latest, item.createdAt), 0)
  if (latestAssistantAt) chatStore.markRead(latestAssistantAt)
}

const handleTimelineScroll = () => {
  userNearBottom.value = isNearBottom()
  if (userNearBottom.value) {
    newMessageCount.value = 0
    markVisibleMessagesRead()
  }
}

const jumpToNewMessages = async () => {
  await scrollToBottom(true)
  userNearBottom.value = true
  newMessageCount.value = 0
  markVisibleMessagesRead()
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const appendPokeEvent = async role => {
  const content = role === 'assistant'
    ? `${companionName.value}拍了拍哥哥`
    : `哥哥拍了拍${companionName.value}`
  const message = chatStore.appendMessage(role, content, {
    type: 'poke',
    createdAt: Date.now()
  })
  await scrollToBottom()
  return message
}

const appendAssistantReply = async (
  content,
  status = 'complete',
  {
    runId = null,
    origin = 'chat',
    proactiveId = '',
    replyTo = null,
    replyPolicy = null,
    recentMessages = []
  } = {}
) => {
  const normalizedContent = replyPolicy
    ? sanitizeCompanionReply(content, {
        mode: replyPolicy.mode,
        recentMessages
      })
    : String(content || '').trim()
  const parts = splitCompanionReply(normalizedContent, replyPolicy
    ? {
        targetLength: replyPolicy.targetLength,
        hardLength: replyPolicy.hardLength,
        maxParts: replyPolicy.maxBubbles
      }
    : undefined)
  const baseTime = Date.now()
  const messages = []
  for (let index = 0; index < parts.length; index += 1) {
    if (!isChatRunning() || (runId !== null && runId !== generationRun)) break
    const message = chatStore.appendMessage('assistant', parts[index], {
      createdAt: baseTime + index,
      status,
      replyTo: index === 0 ? replyTo : null,
      origin,
      proactiveId
    })
    if (message) messages.push(message)
    await scrollToBottom()
    if (index < parts.length - 1) {
      await wait(bubblePacingDelay(parts[index]))
    }
  }
  return messages
}

const queueProactiveRefresh = (delay = 500) => {
  if (!isChatRunning()) return
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer)
  proactiveRefreshTimer = setTimeout(() => refreshProactivePlan(), delay)
}

const cancelProactivePlan = () => {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer)
  proactiveRefreshTimer = null
  chatStore.setProactiveOutbox([])
  syncChatProactiveNotifications([], chatStore.proactiveSettings, { isFeatureEnabled: () => settingsStore.warmHomeEnabled,
    requestPermission: false,
    now: new Date()
  }).catch(error => console.warn('取消旧的主动联系计划失败', error))
}

const syncFollowupPlan = async ({ requestPermission = false } = {}) => {
  await syncChatFollowupNotifications(chatStore.followupOutbox, chatStore.realismSettings, { isFeatureEnabled: () => settingsStore.warmHomeEnabled,
    requestPermission,
    now: new Date()
  }).catch(error => console.warn('同步延迟补话通知失败', error))
}

const scheduleFollowupMaterialization = () => {
  if (followupTimer) clearTimeout(followupTimer)
  followupTimer = null
  if (!isChatRunning()) return
  const next = chatStore.followupOutbox[0]
  if (!next) return
  const delay = Math.max(0, Math.min(2_147_000_000, next.scheduledAt - Date.now()))
  followupTimer = setTimeout(async () => {
    followupTimer = null
    const materialized = chatStore.materializeDueFollowups(Date.now())
    if (materialized.length) await scrollToBottom()
    await syncFollowupPlan()
    scheduleFollowupMaterialization()
  }, delay)
}

const cancelPendingFollowups = () => {
  const brief = chatStore.followupOutbox.map(item => item.intentBrief).filter(Boolean).join('；')
  if (followupTimer) clearTimeout(followupTimer)
  followupTimer = null
  if (chatStore.followupOutbox.length) {
    chatStore.setFollowupOutbox([])
    syncFollowupPlan().catch(() => {})
  }
  return brief
}

const updateRelationshipNow = async (userMessages, assistantMessages) => {
  if (!isChatRunning()) return
  const sourceMessage = assistantMessages.at(-1)
  if (!sourceMessage) return
  try {
    const update = await extractRelationshipUpdateForExchange({
      companionName: companionName.value,
      userMessages,
      assistantMessages,
      sourceMessageId: sourceMessage.id,
      existingMemories: chatStore.memories,
      existingOpenLoops: chatStore.openLoops,
      selfProfile: chatStore.selfProfile,
      socialCast: chatStore.socialCast,
      virtualEvents: chatStore.virtualEvents,
      currentState: chatStore.companionState,
      now: new Date()
    })
    if (!isChatRunning()) return
    if (update.memoryUpserts.length) chatStore.upsertMemories(update.memoryUpserts)
    if (update.resolvedLoopKeys.length) chatStore.resolveOpenLoops(update.resolvedLoopKeys)
    if (update.openLoopUpserts.length) chatStore.upsertOpenLoops(update.openLoopUpserts)
    chatStore.setCompanionState(update.companionState)
    if (update.selfEvolutionProposals.length) {
      chatStore.setEvolutionState(applySelfEvolutionProposals({
        profile: chatStore.selfProfile,
        candidates: chatStore.evolutionCandidates,
        log: chatStore.evolutionLog,
        proposals: update.selfEvolutionProposals,
        sourceMessageId: sourceMessage.id,
        date: formatChatDate(),
        now: Date.now()
      }))
    }
    if (isChatRunning()) queueProactiveRefresh()
  } catch (error) {
    console.warn('本轮关系状态整理失败', error)
  }
}

const updateRelationship = (userMessages, assistantMessages) => {
  relationshipUpdateChain = relationshipUpdateChain
    .catch(() => {})
    .then(() => updateRelationshipNow(userMessages, assistantMessages))
  return relationshipUpdateChain
}

const ensureTodayState = async () => {
  const today = formatChatDate()
  if (chatStore.companionState.date === today) return chatStore.companionState
  let world
  try {
    world = await generateDailyCompanionWorld({
      companionName: companionName.value,
      now: new Date(),
      previousState: chatStore.companionState,
      memories: chatStore.memories,
      openLoops: chatStore.openLoops,
      selfProfile: chatStore.selfProfile,
      socialCast: chatStore.socialCast,
      recentVirtualEvents: chatStore.virtualEvents,
      recentMessages: chatStore.messages.slice(-30)
    })
  } catch (error) {
    console.warn('今日女朋友状态生成失败，已使用本地状态', error)
    world = localDailyCompanionWorld()
  }
  if (isChatRunning()) {
    chatStore.setCompanionState(world.state)
    if (world.virtualEvent && !chatStore.virtualEvents.some(item => item.date === today)) {
      chatStore.addVirtualEvent(world.virtualEvent)
    }
  }
  return world.state
}

const refreshProactivePlan = async () => {
  if (!isChatRunning() || !chatStore.isDataLoaded) return
  try {
    const now = new Date()
    chatStore.materializeDueProactive(now.getTime())
    const slots = buildProactiveSlots({
      settings: chatStore.proactiveSettings,
      messages: chatStore.messages,
      openLoops: chatStore.openLoops,
      existingOutbox: [],
      now,
      days: 7
    })
    const outbox = await generateProactiveOutbox({
      slots,
      companionName: companionName.value,
      state: chatStore.companionState,
      memories: chatStore.memories,
      openLoops: chatStore.openLoops,
      selfProfile: chatStore.selfProfile,
      socialCast: chatStore.socialCast,
      virtualEvents: chatStore.virtualEvents,
      recentMessages: chatStore.messages.slice(-30),
      now
    })
    if (!isChatRunning()) return
    chatStore.setProactiveOutbox(outbox)
    await syncChatProactiveNotifications(outbox, chatStore.proactiveSettings, { isFeatureEnabled: () => settingsStore.warmHomeEnabled,
      requestPermission: false,
      now
    })
  } catch (error) {
    console.warn('温馨小家主动联系计划更新失败', error)
  }
}

const initializeCompanionContinuity = async () => {
  if (!isChatRunning()) return
  chatStore.materializeDueProactive(Date.now())
  chatStore.materializeDueFollowups(Date.now())
  await syncFollowupPlan()
  scheduleFollowupMaterialization()
  await scrollToBottom(true)
  const state = await ensureTodayState()
  if (!isChatRunning()) return
  if (shouldCreateSmartEntry({
    messages: chatStore.messages,
    outbox: chatStore.proactiveOutbox,
    now: new Date()
  })) {
    try {
      const entryRun = ++smartEntryRun
      const entryMessageCount = chatStore.messages.length
      const entryLastMessage = chatStore.messages.at(-1)
      const entryGenerationRun = generationRun
      const content = await generateSmartEntryMessage({
        companionName: companionName.value,
        state,
        memories: chatStore.memories,
        openLoops: chatStore.openLoops,
        selfProfile: chatStore.selfProfile,
        socialCast: chatStore.socialCast,
        virtualEvents: chatStore.virtualEvents,
        recentMessages: chatStore.messages.slice(-24),
        now: new Date()
      })
      const currentLastMessage = chatStore.messages.at(-1)
      const entryStillCurrent = (
        isChatRunning() &&
        entryRun === smartEntryRun &&
        entryGenerationRun === generationRun &&
        chatStore.messages.length === entryMessageCount &&
        currentLastMessage?.id === entryLastMessage?.id &&
        pendingReplyMessageIds.size === 0 &&
        !isWaitingToReply.value &&
        !isGenerating.value
      )
      if (entryStillCurrent && content) {
        await appendAssistantReply(content, 'complete', { origin: 'entry' })
      }
    } catch (error) {
      console.warn('温馨小家智能主动消息生成失败', error)
    }
  }
  queueProactiveRefresh(0)
}

const requestReply = async userMessages => {
  if (!isChatRunning()) return
  const batch = (Array.isArray(userMessages) ? userMessages : [userMessages]).filter(Boolean)
  if (!batch.length) return
  replyController?.abort('superseded')
  const controller = new AbortController()
  replyController = controller
  replyAbortReason = ''
  const runId = ++generationRun
  isGenerating.value = true
  isStreamingRequest = true
  isWaitingToReply.value = false
  retryMessageId.value = ''
  latestGeneratedText = ''
  streamingStartedAt.value = Date.now()
  await scrollToBottom(true)
  const turnContext = buildCompanionTurnContext({
    messages: chatStore.messages,
    userMessages: batch,
    memories: chatStore.memories,
    openLoops: chatStore.openLoops,
    lifeContext: buildLifeContext()
  })
  const sourceMessageId = batch.at(-1)?.id || ''
  const requestStartedAt = Date.now()
  try {
    const recentMessages = chatStore.messages.slice(-20)
    let behaviorPlan = await planChatBehavior({
      companionName: companionName.value,
      replyMode: turnContext.replyMode,
      pendingUserMessages: batch,
      recentMessages,
      memories: turnContext.memories,
      selfProfile: chatStore.selfProfile,
      socialCast: chatStore.socialCast,
      virtualEvents: chatStore.virtualEvents,
      companionState: chatStore.companionState,
      deferredFollowupBrief
    })
    if (!isChatRunning() || runId !== generationRun) return
    deferredFollowupBrief = ''
    if (!shouldKeepDelayedFollowup({
      sourceMessageId,
      plan: behaviorPlan,
      settings: chatStore.realismSettings
    })) {
      behaviorPlan = {
        ...behaviorPlan,
        followup: { ...behaviorPlan.followup, enabled: false }
      }
    }
    const interactionPlanPromise = planCompanionInteraction({
      companionName: companionName.value,
      recentMessages,
      pendingUserMessages: batch,
      companionState: chatStore.companionState
    })
    const answer = await streamCompanionReply({
      messages: turnContext.history,
      systemPrompt: currentSystemPrompt(turnContext, behaviorPlan),
      signal: controller.signal,
      maxTokens: turnContext.replyPolicy.maxTokens,
      onDelta: (_delta, full) => {
        if (!isChatRunning() || runId !== generationRun) return
        latestGeneratedText = full
        scrollToBottom()
      }
    })
    isStreamingRequest = false
    if (!isChatRunning() || runId !== generationRun) return
    latestGeneratedText = answer
    const plannedReply = parsePlannedReplyOutput(answer)
    if (!plannedReply.main) throw new Error('EMPTY_RESPONSE')
    const interaction = await interactionPlanPromise
    if (!isChatRunning() || runId !== generationRun) return
    const targetMessage = chatStore.messages.find(item => item.id === interaction.targetMessageId)
    if (interaction.action === 'react' && targetMessage) {
      chatStore.setMessageReaction(targetMessage.id, 'assistant', interaction.emoji)
    } else if (interaction.action === 'poke') {
      await appendPokeEvent('assistant')
    }
    const remainingPacingDelay = naturalPacingTarget(sourceMessageId) - (Date.now() - requestStartedAt)
    if (remainingPacingDelay > 0) await wait(remainingPacingDelay)
    const assistantMessages = await appendAssistantReply(plannedReply.main, 'complete', {
      runId,
      replyTo: interaction.action === 'quote' ? toReplySnapshot(targetMessage) : null,
      replyPolicy: turnContext.replyPolicy,
      recentMessages: chatStore.messages
    })
    latestGeneratedText = ''
    if (assistantMessages.length && runId === generationRun) {
      if (behaviorPlan.followup.enabled && plannedReply.followup) {
        const followup = createDelayedFollowup({
          sourceMessageId,
          content: plannedReply.followup,
          intentBrief: behaviorPlan.followup.brief,
          delaySeconds: behaviorPlan.followup.delaySeconds
        })
        if (followup) {
          chatStore.setFollowupOutbox([...chatStore.followupOutbox, followup])
          await syncFollowupPlan()
          scheduleFollowupMaterialization()
        }
      }
      updateRelationship(batch, assistantMessages)
    }
  } catch (error) {
    isStreamingRequest = false
    if (error.code === 'ABORTED') {
      if (
        runId === generationRun &&
        replyAbortReason === 'user' &&
        latestGeneratedText.trim() &&
        isCompanionReplyComplete(parsePlannedReplyOutput(latestGeneratedText).main)
      ) {
        await appendAssistantReply(parsePlannedReplyOutput(latestGeneratedText).main, 'stopped', {
          runId,
          replyPolicy: turnContext.replyPolicy,
          recentMessages: chatStore.messages
        })
      }
    } else if (isChatRunning() && runId === generationRun) {
      const fallbackText = turnContext.replyMode === 'safety'
        ? '我在听。刚才回复没有完整送到，你现在安全吗？如果有立即危险，先联系身边可信任的人或当地紧急帮助。'
        : '刚才那句没有完整送到，但我没有不理你。你再说一遍，我接着听。'
      const fallbackMessages = await appendAssistantReply(fallbackText, 'complete', {
        runId,
        replyPolicy: turnContext.replyPolicy,
        recentMessages: chatStore.messages
      })
      if (fallbackMessages.length) updateRelationship(batch, fallbackMessages)
      appToast('原回复没有完整送达，已改用本地安全回复', { tone: 'warning', duration: 3200 })
    }
  } finally {
    if (runId === generationRun) {
      isGenerating.value = false
      latestGeneratedText = ''
      streamingStartedAt.value = 0
      if (replyController === controller) replyController = null
      await scrollToBottom(true)
      if (pendingReplyMessageIds.size) scheduleReply()
    }
  }
}

const scheduleReply = (delay = 900) => {
  if (!isChatRunning()) return
  if (replyDebounceTimer) clearTimeout(replyDebounceTimer)
  isWaitingToReply.value = pendingReplyMessageIds.size > 0
  replyDebounceTimer = setTimeout(() => {
    replyDebounceTimer = null
    const ids = [...pendingReplyMessageIds]
    pendingReplyMessageIds.clear()
    const messages = ids
      .map(id => chatStore.messages.find(item => item.id === id))
      .filter(item => item?.role === 'user')
    isWaitingToReply.value = false
    requestReply(messages)
  }, delay)
}

const findRecentUnansweredUserMessages = (now = Date.now()) => {
  const lastAssistantIndex = chatStore.messages.findLastIndex(item => item.role === 'assistant')
  const trailingUsers = chatStore.messages
    .slice(lastAssistantIndex + 1)
    .filter(item => item.role === 'user' && item.type === 'text' && item.createdAt > settingsStore.warmHomePausedAt)
  const latest = trailingUsers.at(-1)
  if (!latest || now - latest.createdAt > 24 * 60 * 60 * 1000) return []
  return trailingUsers
}

const resumeInterruptedReply = () => {
  if (!hasApiKey.value || isGenerating.value || pendingReplyMessageIds.size) return false
  const messages = findRecentUnansweredUserMessages()
  if (!messages.length) return false
  messages.forEach(message => pendingReplyMessageIds.add(message.id))
  scheduleReply(350)
  return true
}

const supersedeCurrentReply = () => {
  if (!isGenerating.value) return
  generationRun += 1
  replyAbortReason = 'superseded'
  replyController?.abort('superseded')
  replyController = null
  isGenerating.value = false
  isStreamingRequest = false
  latestGeneratedText = ''
  streamingStartedAt.value = 0
}

const sendMessage = async () => {
  const content = draft.value.trim()
  if (!content) return
  if (!hasApiKey.value) {
    return appAlert(`请先在通用配置中填写 AI API Key，再回来和${companionName.value}聊天。`, {
      title: '还差一把钥匙',
      confirmText: '知道了'
    })
  }
  deferredFollowupBrief = cancelPendingFollowups() || deferredFollowupBrief
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
  smartEntryRun += 1
  lightInteractionRun += 1
  draft.value = ''
  replyTarget.value = null
  composerRef.value?.resetHeight()
  pendingReplyMessageIds.add(userMessage.id)
  supersedeCurrentReply()
  cancelProactivePlan()
  await scrollToBottom(true)
  scheduleReply()
}

const retryLastReply = async () => {
  const message = chatStore.messages.find(item => item.id === retryMessageId.value)
  if (!message || message.role !== 'user') return
  retryMessageId.value = ''
  pendingReplyMessageIds.add(message.id)
  supersedeCurrentReply()
  scheduleReply(0)
}

const stopReply = () => {
  replyAbortReason = 'user'
  if (isStreamingRequest) {
    replyController?.abort('user')
    return
  }
  generationRun += 1
  replyController?.abort('user')
  replyController = null
  isGenerating.value = false
  latestGeneratedText = ''
  streamingStartedAt.value = 0
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
  const remainingFollowups = chatStore.followupOutbox.filter(item => (
    item.sourceMessageId !== message.id && item.id !== message.proactiveId
  ))
  if (remainingFollowups.length !== chatStore.followupOutbox.length) {
    chatStore.setFollowupOutbox(remainingFollowups)
    await syncFollowupPlan()
    scheduleFollowupMaterialization()
  }
  chatStore.deleteMessage(message.id)
  if (replyTarget.value?.messageId === message.id) replyTarget.value = null
}

const clearMessageLongPressTimer = () => {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = null
  longPressOrigin = null
}

const openMessageActions = item => {
  if (item?.kind !== 'message' || item.type === 'poke') return
  clearMessageLongPressTimer()
  messageGesture = null
  swipingMessageId.value = ''
  swipeOffset.value = 0
  actionMessage.value = item
}

const startMessageGesture = (item, event) => {
  if (item?.kind !== 'message' || item.type === 'poke') return
  clearMessageLongPressTimer()
  longPressOrigin = { x: event.clientX, y: event.clientY }
  messageGesture = {
    messageId: item.id,
    startX: event.clientX,
    startY: event.clientY
  }
  longPressTimer = setTimeout(() => {
    navigator.vibrate?.(12)
    actionMessage.value = item
    longPressTimer = null
    messageGesture = null
    swipingMessageId.value = ''
    swipeOffset.value = 0
  }, 520)
}

const moveMessageGesture = (item, event) => {
  if (!messageGesture || messageGesture.messageId !== item.id) return
  const deltaX = event.clientX - messageGesture.startX
  const deltaY = event.clientY - messageGesture.startY
  if (Math.abs(deltaY) > 10 && Math.abs(deltaY) >= Math.abs(deltaX)) {
    clearMessageLongPressTimer()
    messageGesture = null
    swipingMessageId.value = ''
    swipeOffset.value = 0
    return
  }
  if (deltaX > 10 && deltaX > Math.abs(deltaY) * 1.2) {
    clearMessageLongPressTimer()
    swipingMessageId.value = item.id
    swipeOffset.value = Math.min(76, deltaX)
    if (event.cancelable) event.preventDefault()
  } else if (deltaX < -10) {
    clearMessageLongPressTimer()
    swipingMessageId.value = ''
    swipeOffset.value = 0
  }
}

const finishMessageGesture = item => {
  const shouldQuote = messageGesture?.messageId === item.id && swipeOffset.value >= 56
  clearMessageLongPressTimer()
  messageGesture = null
  swipingMessageId.value = ''
  swipeOffset.value = 0
  if (shouldQuote) {
    navigator.vibrate?.(16)
    quoteMessage(item)
  }
}

const cancelMessageGesture = () => {
  clearMessageLongPressTimer()
  messageGesture = null
  swipingMessageId.value = ''
  swipeOffset.value = 0
}

const quoteMessage = message => {
  if (!message || message.type === 'poke') return
  replyTarget.value = toReplySnapshot(message)
  actionMessage.value = null
  nextTick(() => composerRef.value?.focus())
}

const selectMessageReaction = async (message, emoji) => {
  if (!message || message.role !== 'assistant' || message.type === 'poke') return
  const previous = (message.reactions || []).find(item => item.actor === 'user')
  const isRemoving = previous?.emoji === emoji
  chatStore.toggleMessageReaction(message.id, 'user', emoji)
  actionMessage.value = null
  navigator.vibrate?.(10)
  cancelProactivePlan()
  if (isRemoving || !hasApiKey.value || isGenerating.value || isWaitingToReply.value) {
    queueProactiveRefresh()
    return
  }

  const runId = ++lightInteractionRun
  isWaitingToReply.value = true
  const result = await planReactionFollowup({
    companionName: companionName.value,
    targetMessage: message,
    emoji,
    recentMessages: chatStore.messages.slice(-16),
    companionState: chatStore.companionState
  })
  if (isChatRunning() && runId === lightInteractionRun && result.reply) {
    await appendAssistantReply(result.content)
  }
  if (isChatRunning() && runId === lightInteractionRun) {
    isWaitingToReply.value = false
    queueProactiveRefresh()
  }
}

const triggerPoke = async () => {
  const now = Date.now()
  if (now - lastPokeAt < 3000) return
  lastPokeAt = now
  navigator.vibrate?.(16)
  await appendPokeEvent('user')
  cancelProactivePlan()
  if (!hasApiKey.value || isGenerating.value || isWaitingToReply.value) {
    queueProactiveRefresh()
    return
  }

  const runId = ++lightInteractionRun
  isWaitingToReply.value = true
  const response = await planPokeFollowup({
    companionName: companionName.value,
    recentMessages: chatStore.messages.slice(-16),
    companionState: chatStore.companionState
  })
  if (!isChatRunning() || runId !== lightInteractionRun) return
  if (response.action === 'poke') {
    await appendPokeEvent('assistant')
  } else if (response.action === 'message') {
    await appendAssistantReply(response.content)
  }
  if (isChatRunning() && runId === lightInteractionRun) {
    isWaitingToReply.value = false
    queueProactiveRefresh()
  }
}

const handleCompanionAvatarTap = () => {
  const now = Date.now()
  if (now - lastAvatarTapAt <= 380) {
    lastAvatarTapAt = 0
    triggerPoke()
  } else {
    lastAvatarTapAt = now
  }
}

const scrollToQuotedMessage = async (messageId, { behavior = 'smooth' } = {}) => {
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
  target.scrollIntoView({ behavior, block: 'center' })
  highlightedMessageId.value = messageId
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedMessageId.value = ''
  }, 1600)
}

const openAiSettings = () => settingsStore.switchView('settings')
const openChatSettings = () => settingsStore.openModuleSettings('chat')

watch(() => settingsStore.warmHomeEnabled, enabled => {
  if (enabled) return
  generationRun += 1
  smartEntryRun += 1
  lightInteractionRun += 1
  clearTimeout(replyDebounceTimer)
  clearTimeout(proactiveRefreshTimer)
  clearTimeout(followupTimer)
  pendingReplyMessageIds.clear()
  isGenerating.value = false
  isWaitingToReply.value = false
  latestGeneratedText = ''
  replyAbortReason = 'disabled'
  replyController?.abort('disabled')
}, { flush: 'sync' })

watch(() => chatStore.messages.length, async (size, previousSize) => {
  if (!timelineReady.value || size <= previousSize) return
  const appended = chatStore.messages.slice(previousSize)
  const newAssistantMessages = appended.filter(item => item.role === 'assistant')
  if (!newAssistantMessages.length) return
  if (viewActive.value && userNearBottom.value) {
    await scrollToBottom(true)
    markVisibleMessagesRead()
  } else {
    if (!firstUnreadMessageId.value) firstUnreadMessageId.value = newAssistantMessages[0].id
    newMessageCount.value += newAssistantMessages.length
  }
})

const restoreVisibleChat = async () => {
  await nextTick()
  await scrollToBottom(true)
  userNearBottom.value = true
  newMessageCount.value = 0
  markVisibleMessagesRead()
}

watch(() => props.isVisible, async isVisible => {
  viewActive.value = isVisible
  if (isVisible) await restoreVisibleChat()
})

onActivated(async () => {
  viewActive.value = props.isVisible
  if (viewActive.value) await restoreVisibleChat()
})

onDeactivated(() => {
  viewActive.value = false
})

watch(() => chatStore.pendingFocusProactiveId, async proactiveId => {
  if (!proactiveId || !componentActive) return
  await nextTick()
  const messageId = chatStore.consumePendingFocusMessageId()
  if (messageId) await scrollToQuotedMessage(messageId, { behavior: 'auto' })
})

onMounted(async () => {
  chatStore.materializeDueProactive(Date.now())
  chatStore.materializeDueFollowups(Date.now())
  await syncFollowupPlan()
  scheduleFollowupMaterialization()
  firstUnreadMessageId.value = chatStore.unreadMessages[0]?.id || ''
  await scrollToBottom(true)
  timelineReady.value = true
  userNearBottom.value = true
  markVisibleMessagesRead()
  const focusMessageId = chatStore.consumePendingFocusMessageId()
  if (focusMessageId) await scrollToQuotedMessage(focusMessageId, { behavior: 'auto' })
  if (!resumeInterruptedReply()) initializeCompanionContinuity()
})

onBeforeUnmount(() => {
  unregisterBackHandler()
  componentActive = false
  generationRun += 1
  lightInteractionRun += 1
  cancelMessageGesture()
  if (highlightTimer) clearTimeout(highlightTimer)
  if (replyDebounceTimer) clearTimeout(replyDebounceTimer)
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer)
  if (followupTimer) clearTimeout(followupTimer)
  replyAbortReason = 'unmount'
  replyController?.abort('unmount')
})
</script>

<template>
  <div class="warm-home">
    <header class="companion-header">
      <button
        class="companion-avatar"
        type="button"
        :aria-label="`双击拍一拍${companionName}`"
        @click="handleCompanionAvatarTap"
      >
        <img v-if="companionAvatar" :src="companionAvatar" alt="" />
        <span v-else>♡</span>
      </button>
      <div class="companion-identity">
        <strong>{{ companionName }}</strong>
        <span><i></i> {{ companionPresence }}</span>
      </div>
      <button class="memory-button" type="button" aria-label="查看长期记忆" @click="openChatSettings">
        <span>{{ chatStore.memories.length }}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10v15l-5-3-5 3v-15Z" /></svg>
      </button>
    </header>

    <div v-if="chatStore.loadError" class="chat-warning">
      <strong>聊天数据暂时无法读取</strong>
      <span>{{ chatStore.loadError }}</span>
    </div>
    <div v-if="chatStore.saveError" class="chat-warning" role="alert">
      <strong>聊天尚未保存</strong>
      <span>{{ chatStore.saveError }}</span>
      <button class="text-link" :disabled="isRetryingSave" @click="retrySave">{{ isRetryingSave ? '正在重试…' : '重试保存' }}</button>
    </div>

    <ChatTimeline
      :timeline-ready="timelineReady"
      :handle-timeline-scroll="handleTimelineScroll"
      :has-older-messages="hasOlderMessages"
      :timeline-items="timelineItems"
      :is-new-day="isNewDay"
      :format-day="formatDay"
      :first-unread-message-id="firstUnreadMessageId"
      :is-group-start="isGroupStart"
      :is-group-end="isGroupEnd"
      :highlighted-message-id="highlightedMessageId"
      :companion-name="companionName"
      :handle-companion-avatar-tap="handleCompanionAvatarTap"
      :companion-avatar="companionAvatar"
      :swiping-message-id="swipingMessageId"
      :swipe-offset="swipeOffset"
      :start-message-gesture="startMessageGesture"
      :move-message-gesture="moveMessageGesture"
      :finish-message-gesture="finishMessageGesture"
      :cancel-message-gesture="cancelMessageGesture"
      :open-message-actions="openMessageActions"
      :scroll-to-quoted-message="scrollToQuotedMessage"
      :quoted-speaker="quotedSpeaker"
      :format-time="formatTime"
      :retry-message-id="retryMessageId"
      :is-generating="isGenerating"
      :retry-last-reply="retryLastReply"
      @element="timelineRef = $event"
      @bottom="timelineBottomRef = $event"
      @load-older="visibleCount += 100"
    />

    <button
      v-if="hasNewMessageJump"
      class="new-message-jump"
      type="button"
      @click="jumpToNewMessages"
    >
      {{ newMessageCount }} 条新消息
      <span aria-hidden="true">↓</span>
    </button>

    <ChatComposer
      ref="composerRef"
      v-model:draft="draft"
      :has-api-key="hasApiKey"
      :open-ai-settings="openAiSettings"
      :reply-target="replyTarget"
      :quoted-speaker="quotedSpeaker"
      :send-message="sendMessage"
      :is-generating="isGenerating"
      :stop-reply="stopReply"
      @cancel-quote="replyTarget = null"
    />
  </div>

    <ChatMessageActions
      :action-message="actionMessage"
      :companion-name="companionName"
      :-c-h-a-t_-r-e-a-c-t-i-o-n_-e-m-o-j-i-s="CHAT_REACTION_EMOJIS"
      :select-message-reaction="selectMessageReaction"
      :quote-message="quoteMessage"
      :copy-message="copyMessage"
      :delete-message="deleteMessage"
      @close="actionMessage = null"
    />
</template>

<style src="./chat.css"></style>
