import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  createChatMemory,
  createChatMessage,
  mergeChatData,
  normalizeChatData,
  normalizeChatMemories
} from '../services/chatRecords.js'
import { createChatStorage } from '../services/chatStorage.js'

export const useChatStore = defineStore('chat', () => {
  const profile = ref(normalizeChatData().profile)
  const messages = ref([])
  const memories = ref([])
  const isDataLoaded = ref(false)
  const loadError = ref('')
  const recoveredFromBackup = ref(false)
  const encryptionPassword = ref('')
  const canPersist = ref(false)
  const storage = createChatStorage()
  let persistChain = Promise.resolve()

  const snapshot = computed(() => normalizeChatData({
    profile: profile.value,
    messages: messages.value,
    memories: memories.value
  }))

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
      recoveredFromBackup.value = result.recovered
      canPersist.value = true
    } catch (error) {
      console.error('读取温馨小家数据失败', error)
      loadError.value = '聊天记录解密失败，请确认主密码或恢复备份'
      profile.value = normalizeChatData().profile
      messages.value = []
      memories.value = []
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
        replyTo: changes.replyTo ?? messages.value[index].replyTo
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

  const clearMessages = () => { messages.value = [] }
  const clearMemories = () => { memories.value = [] }
  const resetAll = () => {
    const empty = normalizeChatData()
    profile.value = empty.profile
    messages.value = []
    memories.value = []
  }

  const replaceChatData = async value => {
    const data = normalizeChatData(value)
    canPersist.value = true
    loadError.value = ''
    profile.value = data.profile
    messages.value = data.messages
    memories.value = data.memories
    await queuePersist()
    return data
  }

  const mergeChatSnapshot = async value => {
    const data = mergeChatData(snapshot.value, value, { preserveCompanionName: true })
    profile.value = data.profile
    messages.value = data.messages
    memories.value = data.memories
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
    snapshot,
    isDataLoaded,
    loadError,
    recoveredFromBackup,
    loadChatData,
    appendMessage,
    updateMessage,
    deleteMessage,
    upsertMemories,
    addMemory,
    updateMemory,
    deleteMemory,
    setCompanionName,
    setCompanionAvatar,
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
