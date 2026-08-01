import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  createChatMemory,
  createChatMessage,
  mergeChatData,
  normalizeChatRealismSettings,
  normalizeChatProactiveSettings,
  normalizeCompanionSelfProfile,
  normalizeCompanionState,
  normalizeChatData,
  normalizeEvolutionCandidates,
  normalizeEvolutionLog,
  normalizeFollowupOutbox,
  normalizeChatMemories,
  normalizeChatReadState,
  normalizeOpenLoops,
  normalizeProactiveOutbox,
  normalizeSocialCast,
  normalizeVirtualEvents
} from '../services/chatRecords.js'
import { createChatStorage } from '../services/chatStorage.js'

export const useChatStore = defineStore('chat', () => {
  const profile = ref(normalizeChatData().profile)
  const messages = ref([])
  const memories = ref([])
  const selfProfile = ref(normalizeCompanionSelfProfile())
  const socialCast = ref([])
  const virtualEvents = ref([])
  const evolutionLog = ref([])
  const evolutionCandidates = ref([])
  const companionState = ref(normalizeCompanionState())
  const openLoops = ref([])
  const proactiveOutbox = ref([])
  const followupOutbox = ref([])
  const proactiveSettings = ref(normalizeChatProactiveSettings())
  const realismSettings = ref(normalizeChatRealismSettings())
  const readState = ref(normalizeChatReadState())
  const isDataLoaded = ref(false)
  const loadError = ref('')
  const recoveredFromBackup = ref(false)
  const encryptionPassword = ref('')
  const canPersist = ref(false)
  const storage = createChatStorage()
  const pendingFocusProactiveId = ref('')
  let persistChain = Promise.resolve()

  const snapshot = computed(() => normalizeChatData({
    profile: profile.value,
    messages: messages.value,
    memories: memories.value,
    selfProfile: selfProfile.value,
    socialCast: socialCast.value,
    virtualEvents: virtualEvents.value,
    evolutionLog: evolutionLog.value,
    evolutionCandidates: evolutionCandidates.value,
    companionState: companionState.value,
    openLoops: openLoops.value,
    proactiveOutbox: proactiveOutbox.value,
    followupOutbox: followupOutbox.value,
    proactiveSettings: proactiveSettings.value,
    realismSettings: realismSettings.value,
    readState: readState.value
  }))
  const unreadMessages = computed(() => messages.value.filter(item => (
    item.role === 'assistant' && item.createdAt > readState.value.lastReadAt
  )))
  const unreadCount = computed(() => unreadMessages.value.length)

  const queuePersist = () => {
    if (!isDataLoaded.value || !canPersist.value || !encryptionPassword.value) return Promise.resolve()
    const value = snapshot.value
    persistChain = persistChain
      .catch(() => {})
      .then(() => storage.save(value, encryptionPassword.value))
      .catch(error => {
        console.error('保存温馨小家数据失败', error)
        loadError.value = '聊天记录保存失败，请稍后重试'
        throw error
      })
    return persistChain
  }

  const loadChatData = async password => {
    encryptionPassword.value = String(password || '')
    loadError.value = ''
    try {
      const result = await storage.load(encryptionPassword.value)
      profile.value = result.data.profile
      messages.value = result.data.messages
      memories.value = result.data.memories
      selfProfile.value = result.data.selfProfile
      socialCast.value = result.data.socialCast
      virtualEvents.value = result.data.virtualEvents
      evolutionLog.value = result.data.evolutionLog
      evolutionCandidates.value = result.data.evolutionCandidates
      companionState.value = result.data.companionState
      openLoops.value = result.data.openLoops
      proactiveOutbox.value = result.data.proactiveOutbox
      followupOutbox.value = result.data.followupOutbox
      proactiveSettings.value = result.data.proactiveSettings
      realismSettings.value = result.data.realismSettings
      readState.value = result.data.readState
      recoveredFromBackup.value = result.recovered
      canPersist.value = true
    } catch (error) {
      console.error('读取温馨小家数据失败', error)
      loadError.value = '聊天记录解密失败，请确认主密码或恢复备份'
      profile.value = normalizeChatData().profile
      messages.value = []
      memories.value = []
      selfProfile.value = normalizeCompanionSelfProfile()
      socialCast.value = []
      virtualEvents.value = []
      evolutionLog.value = []
      evolutionCandidates.value = []
      companionState.value = normalizeCompanionState()
      openLoops.value = []
      proactiveOutbox.value = []
      followupOutbox.value = []
      proactiveSettings.value = normalizeChatProactiveSettings()
      realismSettings.value = normalizeChatRealismSettings()
      readState.value = normalizeChatReadState()
      canPersist.value = false
    } finally {
      isDataLoaded.value = true
    }
  }

  watch(snapshot, () => { queuePersist().catch(() => {}) }, { deep: true })

  const appendMessage = (role, content, options = {}) => {
    const message = createChatMessage(role, content, options)
    if (message) messages.value.push(message)
    return message
  }

  const updateMessage = (id, changes = {}) => {
    const index = messages.value.findIndex(item => item.id === id)
    if (index < 0) return null
    const next = createChatMessage(
      changes.role || messages.value[index].role,
      changes.content ?? messages.value[index].content,
      {
        id,
        createdAt: messages.value[index].createdAt,
        status: changes.status || messages.value[index].status,
        type: changes.type || messages.value[index].type,
        replyTo: changes.replyTo ?? messages.value[index].replyTo,
        reactions: changes.reactions ?? messages.value[index].reactions,
        origin: changes.origin || messages.value[index].origin,
        proactiveId: changes.proactiveId ?? messages.value[index].proactiveId
      }
    )
    if (next) messages.value[index] = next
    return next
  }

  const deleteMessage = id => {
    const size = messages.value.length
    messages.value = messages.value.filter(item => item.id !== id)
    return messages.value.length !== size
  }

  const setMessageReaction = (id, actor, emoji, createdAt = Date.now()) => {
    const message = messages.value.find(item => item.id === id)
    if (!message) return null
    const reactions = [
      ...(message.reactions || []).filter(item => item.actor !== actor),
      ...(emoji ? [{ actor, emoji, createdAt }] : [])
    ]
    return updateMessage(id, { reactions })
  }

  const toggleMessageReaction = (id, actor, emoji, createdAt = Date.now()) => {
    const message = messages.value.find(item => item.id === id)
    if (!message) return null
    const current = (message.reactions || []).find(item => item.actor === actor)
    return setMessageReaction(id, actor, current?.emoji === emoji ? '' : emoji, createdAt)
  }

  const upsertMemories = values => {
    memories.value = normalizeChatMemories([...memories.value, ...values])
    return memories.value
  }

  const addMemory = value => {
    const memory = createChatMemory(value)
    if (!memory) return null
    upsertMemories([memory])
    return memory
  }

  const updateMemory = (id, changes = {}) => {
    const current = memories.value.find(item => item.id === id)
    if (!current) return null
    const memory = createChatMemory({
      ...current,
      ...changes,
      id,
      createdAt: current.createdAt,
      updatedAt: Date.now()
    })
    if (!memory) return null
    memories.value = normalizeChatMemories([
      ...memories.value.filter(item => item.id !== id),
      memory
    ])
    return memory
  }

  const deleteMemory = id => {
    const size = memories.value.length
    memories.value = memories.value.filter(item => item.id !== id)
    return memories.value.length !== size
  }

  const setSelfProfile = value => {
    selfProfile.value = normalizeCompanionSelfProfile({
      ...selfProfile.value,
      ...value,
      updatedAt: value?.updatedAt || Date.now()
    })
    return selfProfile.value
  }

  const setSocialCast = values => {
    socialCast.value = normalizeSocialCast(values)
    return socialCast.value
  }

  const setVirtualEvents = values => {
    virtualEvents.value = normalizeVirtualEvents(values)
    return virtualEvents.value
  }

  const addVirtualEvent = value => {
    virtualEvents.value = normalizeVirtualEvents([value, ...virtualEvents.value])
    return virtualEvents.value[0] || null
  }

  const setEvolutionState = ({ profile, candidates, log } = {}) => {
    if (profile) selfProfile.value = normalizeCompanionSelfProfile(profile)
    if (candidates) evolutionCandidates.value = normalizeEvolutionCandidates(candidates)
    if (log) evolutionLog.value = normalizeEvolutionLog(log)
    return {
      profile: selfProfile.value,
      candidates: evolutionCandidates.value,
      log: evolutionLog.value
    }
  }

  const revertEvolution = id => {
    const entry = evolutionLog.value.find(item => item.id === id && !item.revertedAt)
    if (!entry) return false
    const values = Array.isArray(selfProfile.value[entry.field])
      ? [...selfProfile.value[entry.field]]
      : []
    const nextValues = values.filter(item => item !== entry.nextValue)
    if (entry.previousValue && !nextValues.includes(entry.previousValue)) nextValues.push(entry.previousValue)
    selfProfile.value = normalizeCompanionSelfProfile({
      ...selfProfile.value,
      [entry.field]: nextValues,
      updatedAt: Date.now()
    })
    evolutionLog.value = normalizeEvolutionLog(evolutionLog.value.map(item => (
      item.id === id ? { ...item, revertedAt: Date.now() } : item
    )))
    return true
  }

  const setCompanionName = value => {
    profile.value = normalizeChatData({
      profile: {
        ...profile.value,
        companionName: value
      }
    }).profile
    return profile.value.companionName
  }

  const setCompanionAvatar = value => {
    profile.value = normalizeChatData({
      profile: {
        ...profile.value,
        companionAvatar: value
      }
    }).profile
    return profile.value.companionAvatar
  }

  const setCompanionState = value => {
    companionState.value = normalizeCompanionState({
      ...companionState.value,
      ...value
    })
    return companionState.value
  }

  const upsertOpenLoops = values => {
    openLoops.value = normalizeOpenLoops([...openLoops.value, ...(Array.isArray(values) ? values : [])])
    return openLoops.value
  }

  const resolveOpenLoops = keys => {
    const resolved = new Set((Array.isArray(keys) ? keys : []).map(value => String(value || '').trim()))
    if (!resolved.size) return openLoops.value
    openLoops.value = openLoops.value.filter(item => !resolved.has(item.key))
    return openLoops.value
  }

  const replaceOpenLoops = values => {
    openLoops.value = normalizeOpenLoops(values)
    return openLoops.value
  }

  const setProactiveOutbox = values => {
    proactiveOutbox.value = normalizeProactiveOutbox(values)
    return proactiveOutbox.value
  }

  const setFollowupOutbox = values => {
    followupOutbox.value = normalizeFollowupOutbox(values)
    return followupOutbox.value
  }

  const materializeDueFollowups = (now = Date.now()) => {
    const due = followupOutbox.value.filter(item => item.scheduledAt <= now)
    if (!due.length) return []
    const existing = new Set(messages.value.map(item => item.proactiveId).filter(Boolean))
    const materialized = due
      .filter(item => !existing.has(item.id))
      .map(item => appendMessage('assistant', item.content, {
        createdAt: item.scheduledAt,
        origin: 'followup',
        proactiveId: item.id
      }))
      .filter(Boolean)
    const dueIds = new Set(due.map(item => item.id))
    followupOutbox.value = followupOutbox.value.filter(item => !dueIds.has(item.id))
    return materialized
  }

  const setRealismSettings = value => {
    realismSettings.value = normalizeChatRealismSettings({
      ...realismSettings.value,
      ...value
    })
    return realismSettings.value
  }

  const setProactiveSettings = value => {
    proactiveSettings.value = normalizeChatProactiveSettings({
      ...proactiveSettings.value,
      ...value
    })
    return proactiveSettings.value
  }

  const markRead = (upTo = Date.now()) => {
    const next = Math.max(readState.value.lastReadAt, Number(upTo) || 0)
    if (next <= readState.value.lastReadAt) return readState.value.lastReadAt
    readState.value = normalizeChatReadState({ lastReadAt: next })
    return readState.value.lastReadAt
  }

  const setPendingFocusProactiveId = value => {
    pendingFocusProactiveId.value = String(value || '').trim()
  }

  const consumePendingFocusMessageId = () => {
    const proactiveId = pendingFocusProactiveId.value
    pendingFocusProactiveId.value = ''
    if (!proactiveId) return ''
    return messages.value.find(item => item.proactiveId === proactiveId)?.id || ''
  }

  const materializeDueProactive = (now = Date.now()) => {
    const due = proactiveOutbox.value.filter(item => item.scheduledAt <= now)
    if (!due.length) return []
    const existing = new Set(messages.value.map(item => item.proactiveId).filter(Boolean))
    const materialized = due
      .filter(item => !existing.has(item.id))
      .map(item => appendMessage('assistant', item.content, {
        createdAt: item.scheduledAt,
        origin: item.reason === 'entry' ? 'entry' : 'proactive',
        proactiveId: item.id
      }))
      .filter(Boolean)
    const dueIds = new Set(due.map(item => item.id))
    proactiveOutbox.value = proactiveOutbox.value.filter(item => !dueIds.has(item.id))
    return materialized
  }

  const clearMessages = () => {
    messages.value = []
    followupOutbox.value = []
    readState.value = normalizeChatReadState()
  }
  const clearMemories = () => { memories.value = [] }
  const resetAll = () => {
    const empty = normalizeChatData()
    profile.value = empty.profile
    messages.value = []
    memories.value = []
    selfProfile.value = empty.selfProfile
    socialCast.value = []
    virtualEvents.value = []
    evolutionLog.value = []
    evolutionCandidates.value = []
    companionState.value = empty.companionState
    openLoops.value = []
    proactiveOutbox.value = []
    followupOutbox.value = []
    proactiveSettings.value = empty.proactiveSettings
    realismSettings.value = empty.realismSettings
    readState.value = empty.readState
  }

  const replaceChatData = async value => {
    const data = normalizeChatData(value)
    canPersist.value = true
    loadError.value = ''
    profile.value = data.profile
    messages.value = data.messages
    memories.value = data.memories
    selfProfile.value = data.selfProfile
    socialCast.value = data.socialCast
    virtualEvents.value = data.virtualEvents
    evolutionLog.value = data.evolutionLog
    evolutionCandidates.value = data.evolutionCandidates
    companionState.value = data.companionState
    openLoops.value = data.openLoops
    proactiveOutbox.value = []
    followupOutbox.value = []
    proactiveSettings.value = data.proactiveSettings
    realismSettings.value = data.realismSettings
    readState.value = data.readState
    await queuePersist()
    return data
  }

  const mergeChatSnapshot = async value => {
    const data = mergeChatData(snapshot.value, value, { preserveCompanionName: true })
    profile.value = data.profile
    messages.value = data.messages
    memories.value = data.memories
    selfProfile.value = data.selfProfile
    socialCast.value = data.socialCast
    virtualEvents.value = data.virtualEvents
    evolutionLog.value = data.evolutionLog
    evolutionCandidates.value = data.evolutionCandidates
    companionState.value = data.companionState
    openLoops.value = data.openLoops
    proactiveOutbox.value = data.proactiveOutbox
    followupOutbox.value = data.followupOutbox
    proactiveSettings.value = data.proactiveSettings
    realismSettings.value = data.realismSettings
    readState.value = data.readState
    await queuePersist()
    return data
  }

  const restoreChatData = replaceChatData

  const reencrypt = async newPassword => {
    if (!canPersist.value) throw new Error('CHAT_STORAGE_NOT_LOADED')
    await persistChain.catch(() => {})
    await storage.save(snapshot.value, newPassword)
    encryptionPassword.value = newPassword
  }

  const flush = async () => {
    await queuePersist()
    await persistChain
  }

  return {
    profile,
    messages,
    memories,
    selfProfile,
    socialCast,
    virtualEvents,
    evolutionLog,
    evolutionCandidates,
    companionState,
    openLoops,
    proactiveOutbox,
    followupOutbox,
    proactiveSettings,
    realismSettings,
    readState,
    unreadMessages,
    unreadCount,
    pendingFocusProactiveId,
    snapshot,
    isDataLoaded,
    loadError,
    recoveredFromBackup,
    loadChatData,
    appendMessage,
    updateMessage,
    deleteMessage,
    setMessageReaction,
    toggleMessageReaction,
    upsertMemories,
    addMemory,
    updateMemory,
    deleteMemory,
    setSelfProfile,
    setSocialCast,
    setVirtualEvents,
    addVirtualEvent,
    setEvolutionState,
    revertEvolution,
    setCompanionName,
    setCompanionAvatar,
    setCompanionState,
    upsertOpenLoops,
    resolveOpenLoops,
    replaceOpenLoops,
    setProactiveOutbox,
    setFollowupOutbox,
    setProactiveSettings,
    setRealismSettings,
    markRead,
    setPendingFocusProactiveId,
    consumePendingFocusMessageId,
    materializeDueProactive,
    materializeDueFollowups,
    clearMessages,
    clearMemories,
    resetAll,
    replaceChatData,
    mergeChatSnapshot,
    restoreChatData,
    reencrypt,
    flush
  }
})
