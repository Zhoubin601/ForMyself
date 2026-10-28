import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useSettingsStore } from '../../stores/settings.js'
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
} from './chatRecords.js'
import { createChatStorage } from './chatStorage.js'
import { createChatPersistence } from './chatPersistence.js'

export const useChatStore = defineStore('chat', () => {
  const settingsStore = useSettingsStore()
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
  const persistence = createChatPersistence(storage)
  const { saveError, hasPendingSave } = persistence
  const pendingFocusProactiveId = ref('')
  let loadRevision = 0
  let isReencrypting = false
  let changedDuringReencrypt = false
  let retiredForKanata = false

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
    if (isReencrypting) { changedDuringReencrypt = true; return Promise.resolve() }
    return persistence.queue(snapshot.value, encryptionPassword.value)
  }

  const loadChatData = async password => {
    if (retiredForKanata) throw new Error('LEGACY_CHAT_RETIRED')
    if (!password) throw new Error('CHAT_PASSWORD_REQUIRED')
    const revision = ++loadRevision
    isDataLoaded.value = false
    canPersist.value = false
    encryptionPassword.value = String(password || '')
    loadError.value = ''
    try {
      const result = await persistence.load(encryptionPassword.value)
      if (revision !== loadRevision) return
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
      proactiveOutbox.value = settingsStore.warmHomeEnabled ? result.data.proactiveOutbox : []
      followupOutbox.value = settingsStore.warmHomeEnabled ? result.data.followupOutbox : []
      proactiveSettings.value = result.data.proactiveSettings
      realismSettings.value = result.data.realismSettings
      readState.value = result.data.readState
      recoveredFromBackup.value = result.recovered
      canPersist.value = true
    } catch (error) {
      if (revision !== loadRevision) return
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
      if (revision === loadRevision) isDataLoaded.value = true
    }
  }

  watch(snapshot, () => { queuePersist().catch(() => {}) }, { deep: true, flush: 'sync' })

  const appendMessage = (role, content, options = {}) => {
    if (!settingsStore.warmHomeEnabled) return null
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
    proactiveOutbox.value = settingsStore.warmHomeEnabled ? normalizeProactiveOutbox(values) : []
    return proactiveOutbox.value
  }

  const setFollowupOutbox = values => {
    followupOutbox.value = settingsStore.warmHomeEnabled ? normalizeFollowupOutbox(values) : []
    return followupOutbox.value
  }

  const materializeDueFollowups = (now = Date.now()) => {
    if (!settingsStore.warmHomeEnabled) return []
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
    if (!settingsStore.warmHomeEnabled) return []
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

  const pauseWarmHome = () => {
    proactiveOutbox.value = []
    followupOutbox.value = []
    pendingFocusProactiveId.value = ''
  }
  watch(() => settingsStore.warmHomeEnabled, enabled => { if (!enabled) pauseWarmHome() }, { flush: 'sync' })

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
    proactiveOutbox.value = settingsStore.warmHomeEnabled ? data.proactiveOutbox : []
    followupOutbox.value = settingsStore.warmHomeEnabled ? data.followupOutbox : []
    proactiveSettings.value = data.proactiveSettings
    realismSettings.value = data.realismSettings
    readState.value = data.readState
    await queuePersist()
    return data
  }

  const restoreChatData = replaceChatData

  const release = async () => {
    ++loadRevision
    canPersist.value = false
    isDataLoaded.value = false
    encryptionPassword.value = ''
    resetAll()
    pendingFocusProactiveId.value = ''
    loadError.value = ''
    await persistence.wait()
  }

  const reencrypt = async newPassword => {
    if (!canPersist.value) throw new Error('CHAT_STORAGE_NOT_LOADED')
    if (isReencrypting) throw new Error('CHAT_REENCRYPT_IN_PROGRESS')
    isReencrypting = true
    try {
      do {
        changedDuringReencrypt = false
        await persistence.reencrypt(snapshot.value, newPassword)
      } while (changedDuringReencrypt)
      encryptionPassword.value = newPassword
    } finally {
      isReencrypting = false
    }
  }

  const flush = async () => {
    if (isDataLoaded.value && canPersist.value) await queuePersist()
    else await persistence.retry()
    await persistence.wait()
  }

  const suspendPersistence = () => {
    canPersist.value = false
    loadError.value = '主密码修改回滚未完成，请保留应用数据并联系维护者。'
  }

  // Internal cleanup capability. No file deletion occurs here; the protected coordinator owns it.
  const retireForKanata = async () => {
    retiredForKanata = true
    await release()
  }

  return {
    profile,
    release,
    retireForKanata,
    isRetiredForKanata: () => retiredForKanata && !canPersist.value && !isDataLoaded.value && !encryptionPassword.value,
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
    saveError,
    hasPendingSave,
    suspendPersistence,
    recoveredFromBackup,
    pauseWarmHome,
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
