<script setup>
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
    if (!componentActive || (runId !== null && runId !== generationRun)) break
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
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer)
  proactiveRefreshTimer = setTimeout(() => refreshProactivePlan(), delay)
}

const cancelProactivePlan = () => {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer)
  proactiveRefreshTimer = null
  chatStore.setProactiveOutbox([])
  syncChatProactiveNotifications([], chatStore.proactiveSettings, {
    requestPermission: false,
    now: new Date()
  }).catch(error => console.warn('取消旧的主动联系计划失败', error))
}

const syncFollowupPlan = async ({ requestPermission = false } = {}) => {
  await syncChatFollowupNotifications(chatStore.followupOutbox, chatStore.realismSettings, {
    requestPermission,
    now: new Date()
  }).catch(error => console.warn('同步延迟补话通知失败', error))
}

const scheduleFollowupMaterialization = () => {
  if (followupTimer) clearTimeout(followupTimer)
  followupTimer = null
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
    if (componentActive) queueProactiveRefresh()
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
  if (componentActive) {
    chatStore.setCompanionState(world.state)
    if (world.virtualEvent && !chatStore.virtualEvents.some(item => item.date === today)) {
      chatStore.addVirtualEvent(world.virtualEvent)
    }
  }
  return world.state
}

const refreshProactivePlan = async () => {
  if (!componentActive || !chatStore.isDataLoaded) return
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
    if (!componentActive) return
    chatStore.setProactiveOutbox(outbox)
    await syncChatProactiveNotifications(outbox, chatStore.proactiveSettings, {
      requestPermission: false,
      now
    })
  } catch (error) {
    console.warn('温馨小家主动联系计划更新失败', error)
  }
}

const initializeCompanionContinuity = async () => {
  chatStore.materializeDueProactive(Date.now())
  chatStore.materializeDueFollowups(Date.now())
  await syncFollowupPlan()
  scheduleFollowupMaterialization()
  await scrollToBottom(true)
  const state = await ensureTodayState()
  if (!componentActive) return
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
        componentActive &&
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
        if (!componentActive || runId !== generationRun) return
        latestGeneratedText = full
        scrollToBottom()
      }
    })
    isStreamingRequest = false
    if (!componentActive || runId !== generationRun) return
    latestGeneratedText = answer
    const plannedReply = parsePlannedReplyOutput(answer)
    if (!plannedReply.main) throw new Error('EMPTY_RESPONSE')
    const interaction = await interactionPlanPromise
    if (!componentActive || runId !== generationRun) return
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
    } else if (componentActive && runId === generationRun) {
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
    .filter(item => item.role === 'user' && item.type === 'text')
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
  if (composerRef.value) composerRef.value.style.height = ''
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
  if (componentActive && runId === lightInteractionRun && result.reply) {
    await appendAssistantReply(result.content)
  }
  if (componentActive && runId === lightInteractionRun) {
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
  if (!componentActive || runId !== lightInteractionRun) return
  if (response.action === 'poke') {
    await appendPokeEvent('assistant')
  } else if (response.action === 'message') {
    await appendAssistantReply(response.content)
  }
  if (componentActive && runId === lightInteractionRun) {
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
      @scroll.passive="handleTimelineScroll"
    >
      <button v-if="hasOlderMessages" class="load-older" type="button" @click="visibleCount += 100">
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
      <div ref="timelineBottomRef" class="chat-bottom-anchor" aria-hidden="true"></div>
    </main>

    <button
      v-if="hasNewMessageJump"
      class="new-message-jump"
      type="button"
      @click="jumpToNewMessages"
    >
      {{ newMessageCount }} 条新消息
      <span aria-hidden="true">↓</span>
    </button>

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
          enterkeyhint="send"
          placeholder="想和她说点什么…"
          @input="resizeComposer"
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <div class="composer-actions">
          <button
            v-if="isGenerating"
            class="send-button stop"
            type="button"
            aria-label="停止生成"
            @click="stopReply"
          ><i></i></button>
          <button
            class="send-button"
            type="button"
            aria-label="发送消息"
            :disabled="!draft.trim() || !hasApiKey"
            @click="sendMessage"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm6.5 1.5L19 5"/></svg>
          </button>
        </div>
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
          >{{ emoji }}</button>
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
  position: relative;
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
  padding: 0;
  overflow: hidden;
  border: 0;
  color: white;
  background: var(--theme-gradient);
  box-shadow: 0 7px 18px rgba(var(--theme-primary-rgb), .22);
  font: inherit;
  cursor: pointer;
}
.companion-avatar img, .message-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.companion-avatar { width: 43px; height: 43px; border-radius: 16px; font-size: 24px; }
.companion-identity { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.companion-identity strong { font-size: 17px; }
.companion-identity span { color: var(--body-muted); font-size: 11px; }
.companion-identity i { display: inline-block; width: 6px; height: 6px; margin-right: 3px; border-radius: 50%; background: #39ad79; }
.memory-button {
  display: flex; align-items: center; gap: 6px; min-width: 52px; height: 44px; padding: 0 10px;
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
.unread-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 14px;
  color: var(--primary);
  font-size: 10px;
}
.unread-divider::before, .unread-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(var(--theme-primary-rgb), .28);
}
.unread-divider span { flex-shrink: 0; }
.poke-event { display: flex; justify-content: center; margin: 9px 0 14px; }
.poke-event span {
  padding: 6px 11px;
  border-radius: 999px;
  color: var(--body-muted);
  background: rgba(255,255,255,.72);
  font-size: 10px;
}
.message-row { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 5px; }
.message-row.group-end { margin-bottom: 16px; }
.message-row.message-user { justify-content: flex-end; }
.message-avatar { width: 29px; height: 29px; margin-top: 2px; border-radius: 11px; font-size: 15px; }
.message-avatar-placeholder { flex: 0 0 29px; width: 29px; }
.message-column { position: relative; max-width: min(82%, 580px); min-width: 0; }
.message-user .message-column { display: flex; flex-direction: column; align-items: flex-end; }
.message-bubble {
  position: relative; display: inline-block; max-width: 100%; padding: 11px 13px;
  border: 1px solid var(--theme-border); border-radius: 7px 18px 18px 18px;
  color: var(--ink); background: rgba(255,255,255,.92); box-shadow: var(--shadow-card);
  touch-action: pan-y;
  -webkit-touch-callout: none;
  user-select: none;
  transition: transform .16s ease;
}
.swipe-quote-indicator {
  position: absolute;
  top: 12px;
  left: -28px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--body-muted);
  background: rgba(255,255,255,.84);
  box-shadow: var(--shadow-soft);
  opacity: .72;
  transform: scale(.88);
  transition: .16s ease;
}
.swipe-quote-indicator.ready {
  color: var(--theme-on-primary);
  background: var(--theme-primary-strong);
  opacity: 1;
  transform: scale(1);
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
.message-reactions {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: calc(100% - 20px);
  gap: 4px;
  margin: 4px 11px 2px;
  padding: 2px 6px 3px;
  border: 0;
  border-radius: 999px;
  background: rgba(var(--theme-primary-rgb), .07);
  box-shadow: none;
  line-height: 1;
}
.message-user .message-reactions {
  align-self: flex-end;
  justify-content: flex-end;
  margin-right: 10px;
}
.message-reactions span {
  display: block;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: 11px;
  line-height: 1;
}
.message-meta { display: flex; align-items: center; gap: 4px; min-height: 40px; margin-top: 1px; padding: 0 1px 0 4px; color: var(--body-muted); font-size: 12px; }
.message-meta button { display: grid; place-items: center; min-width: 44px; height: 40px; padding: 0; border: 0; border-radius: 12px; color: inherit; background: transparent; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.message-meta button:active { background: var(--theme-soft); color: var(--primary); }
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
.new-message-jump {
  position: absolute;
  z-index: 7;
  right: 16px;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--theme-border);
  border-radius: 999px;
  color: var(--primary);
  background: rgba(255,255,255,.94);
  box-shadow: 0 8px 22px rgba(25,35,52,.14);
  font: inherit;
  font-size: 11px;
}
.new-message-jump span { font-size: 15px; }

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
  width: 40px;
  height: 40px;
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
.composer-actions { display: flex; flex-shrink: 0; align-items: center; gap: 5px; }
.composer-shell textarea {
  flex: 1; min-width: 0; max-height: 132px; padding: 7px 0; border: 0; outline: 0; resize: none;
  color: var(--ink); background: transparent; font: inherit; font-size: 15px; line-height: 1.45;
}
.composer-shell textarea::placeholder { color: var(--body-muted); }
.send-button {
  display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px;
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
.message-reaction-picker {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}
.message-reaction-picker button {
  display: grid;
  place-items: center;
  min-width: 0;
  height: 43px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 13px;
  background: var(--surface-pearl);
  font: inherit;
  font-size: 21px;
}
.message-reaction-picker button.selected {
  border-color: var(--theme-primary);
  background: var(--theme-soft);
  box-shadow: inset 0 0 0 1px rgba(var(--theme-primary-rgb), .16);
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
