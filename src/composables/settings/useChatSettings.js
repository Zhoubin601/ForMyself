import { computed, ref, watch } from 'vue'
import { CHAT_MEMORY_SCOPES } from '../../features/chat/chatRecords'
import { prepareCompanionAvatar } from '../../features/chat/chatAvatar'
import { generateDailyCompanionWorld, localDailyCompanionWorld } from '../../features/chat/chatRelationship'
import { buildProactiveSlots, generateProactiveOutbox, syncChatProactiveNotifications } from '../../features/chat/chatProactive'
import { syncChatFollowupNotifications } from '../../features/chat/chatFollowup'
import { generateCompanionWorldDraft } from '../../features/chat/chatRealism'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appConfirm, appPrompt, appToast } from '../../services/uiFeedback'

export function useChatSettings() {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()
  const settingsScope = computed(() => settingsStore.settingsScope || 'general')

  const companionAvatarInputRef = ref(null)

  const companionNameInput = ref(chatStore.profile.companionName)
  const newMemoryContent = ref('')
  const newMemoryCategory = ref('偏好')
  const newMemoryScope = ref('user')
  const memoryScopeFilter = ref('user')
  const memoryPage = ref(1)
  const isProcessingCompanionAvatar = ref(false)
  const isRegeneratingCompanionState = ref(false)
  const isSavingChatProactive = ref(false)
  const isWorldExpanded = ref(false)
  const isGeneratingWorldDraft = ref(false)
  const worldDraft = ref(null)
  const proactiveForm = ref({
    enabled: chatStore.proactiveSettings.enabled,
    dailyMin: chatStore.proactiveSettings.dailyMin,
    dailyMax: chatStore.proactiveSettings.dailyMax,
    activeStart: chatStore.proactiveSettings.activeStart,
    activeEnd: chatStore.proactiveSettings.activeEnd
  })
  const MEMORY_PAGE_SIZE = 3
  const memoryScopeMeta = {
    user: { label: '哥哥', description: '哥哥的信息' },
    companion: { label: '她', description: '她的虚拟设定' },
    relationship: { label: '我们', description: '两人的共同经历' }
  }
  const memoryScopeOptions = CHAT_MEMORY_SCOPES.map(value => ({ value, ...memoryScopeMeta[value] }))
  const scopedChatMemories = computed(() => (
    chatStore.memories.filter(memory => memory.scope === memoryScopeFilter.value)
  ))
  const memoryPageCount = computed(() => Math.max(1, Math.ceil(scopedChatMemories.value.length / MEMORY_PAGE_SIZE)))
  const pagedChatMemories = computed(() => {
    const start = (memoryPage.value - 1) * MEMORY_PAGE_SIZE
    return scopedChatMemories.value.slice(start, start + MEMORY_PAGE_SIZE)
  })
  const memoryRangeLabel = computed(() => {
    if (!scopedChatMemories.value.length) return ''
    const start = (memoryPage.value - 1) * MEMORY_PAGE_SIZE + 1
    const end = Math.min(start + MEMORY_PAGE_SIZE - 1, scopedChatMemories.value.length)
    return `${start}–${end} / ${scopedChatMemories.value.length}`
  })

  watch(() => chatStore.profile.companionName, value => {
    if (settingsScope.value === 'chat') companionNameInput.value = value
  }, { immediate: true })

  watch(memoryPageCount, count => {
    if (memoryPage.value > count) memoryPage.value = count
  })

  watch(memoryScopeFilter, scope => {
    memoryPage.value = 1
    newMemoryScope.value = scope
  })

  watch(() => chatStore.proactiveSettings, value => {
    proactiveForm.value = { ...value }
  }, { deep: true, immediate: true })

  const triggerCompanionAvatarUpload = () => companionAvatarInputRef.value?.click()

  const handleCompanionAvatarUpload = async event => {
    const input = event.target
    const file = input?.files?.[0]
    if (!file) return
    isProcessingCompanionAvatar.value = true
    try {
      const avatar = await prepareCompanionAvatar(file)
      chatStore.setCompanionAvatar(avatar)
      appToast('女朋友头像已经换好啦', { tone: 'success' })
    } catch (error) {
      if (error?.message === 'AVATAR_FILE_TOO_LARGE') {
        appAlert('图片不能超过 5MB，请换一张小一点的图片')
      } else if (error?.message === 'AVATAR_INVALID_TYPE') {
        appAlert('请选择 JPG、PNG 或 WebP 图片')
      } else {
        appAlert('这张图片暂时无法读取，请换一张再试')
      }
    } finally {
      isProcessingCompanionAvatar.value = false
      if (input) input.value = ''
    }
  }

  const clearCompanionAvatar = async () => {
    if (!chatStore.profile.companionAvatar) return
    if (!await appConfirm('将恢复为温馨小家的默认爱心头像。', {
      title: '移除自定义头像？',
      destructive: true
    })) return
    chatStore.setCompanionAvatar('')
    appToast('已经恢复默认头像')
  }

  const saveCompanionName = () => {
    const name = String(companionNameInput.value || '').trim()
    if (!name) return appAlert('请输入女朋友的名字')
    if (name.length > 20) return appAlert('名字请控制在 20 个字以内')
    chatStore.setCompanionName(name)
    companionNameInput.value = chatStore.profile.companionName
    appToast(`以后就叫她“${chatStore.profile.companionName}”啦`, { tone: 'success' })
  }

  const addChatMemory = () => {
    const content = String(newMemoryContent.value || '').trim()
    if (!content) return appAlert('请先写下想让她记住的内容')
    const memory = chatStore.addMemory({
      scope: newMemoryScope.value,
      category: newMemoryCategory.value,
      key: `${newMemoryScope.value}:${newMemoryCategory.value}:${content}`,
      content
    })
    if (!memory) return appAlert('这条内容可能包含账号、密码或密钥，不能保存为长期记忆')
    newMemoryContent.value = ''
    memoryScopeFilter.value = newMemoryScope.value
    memoryPage.value = 1
    appToast('长期记忆已添加', { tone: 'success' })
  }

  const editChatMemory = async memory => {
    const content = await appPrompt('修改这条长期记忆：', memory.content, {
      title: '编辑长期记忆',
      placeholder: '她以后需要记住的事情'
    })
    if (content === null) return
    const updated = chatStore.updateMemory(memory.id, {
      key: `${memory.scope}:${memory.category}:${String(content).trim()}`,
      content
    })
    if (!updated) return appAlert('记忆不能为空，也不能包含账号、密码或密钥')
    appToast('长期记忆已更新', { tone: 'success' })
  }

  const deleteChatMemory = async memory => {
    if (!await appConfirm(`将删除这条记忆：\n${memory.content}`, {
      title: '删除长期记忆？',
      destructive: true
    })) return
    chatStore.deleteMemory(memory.id)
    memoryPage.value = Math.min(memoryPage.value, memoryPageCount.value)
    appToast('长期记忆已删除')
  }

  const selfProfileSections = [
    { field: 'interests', label: '喜欢' },
    { field: 'dislikes', label: '不喜欢' },
    { field: 'opinions', label: '自己的看法' },
    { field: 'habits', label: '习惯' }
  ]

  const editSelfSummary = async () => {
    const value = await appPrompt('写一小段她稳定的自我介绍。', chatStore.selfProfile.summary, {
      title: '编辑她的自我简介',
      placeholder: '例如：有点黏人，也喜欢认真听哥哥讲烦恼'
    })
    if (value === null) return
    chatStore.setSelfProfile({ summary: value })
    appToast('她的自我简介已更新', { tone: 'success' })
  }

  const editSelfProfileList = async section => {
    const current = chatStore.selfProfile[section.field] || []
    const value = await appPrompt('用逗号分隔多项；留空可清空这一栏。', current.join('，'), {
      title: `编辑${section.label}`,
      placeholder: '每项尽量具体、简短'
    })
    if (value === null) return
    chatStore.setSelfProfile({
      [section.field]: String(value).split(/[，,\n]/).map(item => item.trim()).filter(Boolean)
    })
    appToast(`“${section.label}”已更新`, { tone: 'success' })
  }

  const addSocialCharacter = async () => {
    if (chatStore.socialCast.length >= 3) return appAlert('固定人物最多保留 3 个')
    const name = await appPrompt('只添加明确存在于温馨小家虚拟世界中的人物。', '', {
      title: '添加固定人物',
      placeholder: '人物名字'
    })
    if (name === null || !String(name).trim()) return
    const relationship = await appPrompt('她和这个人物是什么关系？', '', {
      title: '设置人物关系',
      placeholder: '例如：一起做手账的朋友'
    })
    if (relationship === null || !String(relationship).trim()) return
    const before = chatStore.socialCast.length
    chatStore.setSocialCast([...chatStore.socialCast, { name, relationship, traits: [], notes: '' }])
    if (chatStore.socialCast.length === before) return appAlert('人物信息不完整或包含不能保存的敏感内容')
    appToast('固定人物已添加', { tone: 'success' })
  }

  const editSocialCharacter = async character => {
    const relationship = await appPrompt('修改她和这个人物的关系。', character.relationship, {
      title: `编辑 ${character.name}`,
      placeholder: '人物关系'
    })
    if (relationship === null) return
    const notes = await appPrompt('可以写性格或需要保持一致的备注。', character.notes, {
      title: `补充 ${character.name} 的设定`,
      placeholder: '人物性格与备注'
    })
    if (notes === null) return
    chatStore.setSocialCast(chatStore.socialCast.map(item => (
      item.id === character.id ? { ...item, relationship, notes, updatedAt: Date.now() } : item
    )))
    appToast('人物设定已更新', { tone: 'success' })
  }

  const deleteSocialCharacter = async character => {
    if (!await appConfirm(`删除固定人物“${character.name}”后，之后的聊天不会再引用她。`, {
      title: '删除固定人物？',
      destructive: true
    })) return
    chatStore.setSocialCast(chatStore.socialCast.filter(item => item.id !== character.id))
    chatStore.setVirtualEvents(chatStore.virtualEvents.map(event => ({
      ...event,
      characterIds: event.characterIds.filter(id => id !== character.id)
    })))
    appToast('固定人物已删除')
  }

  const deleteVirtualEvent = async event => {
    if (!await appConfirm(`删除虚拟事件“${event.title}”？`, { title: '删除近期事件？', destructive: true })) return
    chatStore.setVirtualEvents(chatStore.virtualEvents.filter(item => item.id !== event.id))
    appToast('近期事件已删除')
  }

  const revertEvolution = async entry => {
    if (!await appConfirm(`撤销她后来形成的“${entry.nextValue}”？`, { title: '撤销这次变化？' })) return
    if (chatStore.revertEvolution(entry.id)) appToast('这次变化已撤销', { tone: 'success' })
  }

  const resetCompanionWorld = async () => {
    if (!await appConfirm('只重置她的自我档案、固定人物、虚拟事件和变化记录；聊天与长期记忆会保留。', {
      title: '重置她的世界？',
      confirmText: '重置世界',
      destructive: true
    })) return
    chatStore.setSelfProfile({ summary: '', interests: [], dislikes: [], opinions: [], habits: [], updatedAt: Date.now() })
    chatStore.setSocialCast([])
    chatStore.setVirtualEvents([])
    chatStore.setEvolutionState({ candidates: [], log: [] })
    worldDraft.value = null
    appToast('她的世界已重置')
  }

  const buildCompanionWorldFromHistory = async () => {
    if (!await appConfirm('为建立草案，最近 200 个合并角色消息和现有长期记忆将发送给当前配置的 AI 服务商。不会读取密码库、主密码、API Key 或账号凭据；只有你最终确认后才会保存。', {
      title: '根据已有聊天建立她的自我？',
      confirmText: '同意并生成'
    })) return
    isGeneratingWorldDraft.value = true
    worldDraft.value = null
    try {
      worldDraft.value = await generateCompanionWorldDraft({
        companionName: chatStore.profile.companionName,
        messages: chatStore.messages,
        memories: chatStore.memories
      })
      isWorldExpanded.value = true
      if (worldDraft.value.generationMeta?.usedLocalFallback) {
        appToast('部分分析格式异常，已整理为可编辑草案，请确认后再保存', { tone: 'warning', duration: 4200 })
      } else if (worldDraft.value.generationMeta?.failedChunks) {
        appToast(`草案已生成；${worldDraft.value.generationMeta.failedChunks} 个分块已自动跳过`, { tone: 'warning', duration: 4200 })
      } else {
        appToast('草案生成好了，请确认后再保存', { tone: 'success' })
      }
    } catch (error) {
      console.error('根据历史建立她的世界失败', error)
      const message = error?.code === 'MISSING_KEY' || error?.message === 'MISSING_KEY'
        ? '尚未配置可用的 API Key。请先到通用配置完成 AI 设置和连接测试，再回来生成草案。'
        : '当前 AI 服务没有完成任何可用的历史分析。请检查网络与 AI 连接后重试；现有档案没有被修改。'
      appAlert(message, { title: '草案生成失败', tone: 'danger' })
    } finally {
      isGeneratingWorldDraft.value = false
    }
  }

  const editWorldDraftSummary = async () => {
    const value = await appPrompt('这是草案，不会在最终确认前写入。', worldDraft.value?.selfProfile?.summary || '', {
      title: '修改草案简介',
      placeholder: '她稳定的自我介绍'
    })
    if (value === null || !worldDraft.value) return
    worldDraft.value = {
      ...worldDraft.value,
      selfProfile: { ...worldDraft.value.selfProfile, summary: String(value).trim() }
    }
  }

  const editWorldDraftList = async section => {
    if (!worldDraft.value) return
    const current = worldDraft.value.selfProfile?.[section.field] || []
    const value = await appPrompt('用逗号分隔多项；留空可清空这一栏。', current.join('，'), {
      title: `修改草案·${section.label}`,
      placeholder: '每项尽量具体、简短'
    })
    if (value === null) return
    worldDraft.value = {
      ...worldDraft.value,
      selfProfile: {
        ...worldDraft.value.selfProfile,
        [section.field]: String(value).split(/[，,\n]/).map(item => item.trim()).filter(Boolean)
      }
    }
  }

  const removeWorldDraftCharacter = id => {
    if (!worldDraft.value) return
    worldDraft.value = {
      ...worldDraft.value,
      socialCast: worldDraft.value.socialCast.filter(item => item.id !== id),
      virtualEvents: worldDraft.value.virtualEvents.map(event => ({
        ...event,
        characterIds: event.characterIds.filter(characterId => characterId !== id)
      }))
    }
  }

  const editWorldDraftCharacter = async character => {
    if (!worldDraft.value) return
    const relationship = await appPrompt('这是草案，确认前不会写入。', character.relationship, {
      title: `修改 ${character.name} 的关系`,
      placeholder: '人物关系'
    })
    if (relationship === null) return
    worldDraft.value = {
      ...worldDraft.value,
      socialCast: worldDraft.value.socialCast.map(item => (
        item.id === character.id ? { ...item, relationship: String(relationship).trim() } : item
      ))
    }
  }

  const removeWorldDraftEvent = id => {
    if (!worldDraft.value) return
    worldDraft.value = {
      ...worldDraft.value,
      virtualEvents: worldDraft.value.virtualEvents.filter(item => item.id !== id)
    }
  }

  const editWorldDraftEvent = async event => {
    if (!worldDraft.value) return
    const detail = await appPrompt('修改这个虚拟生活事件的具体内容。', event.detail, {
      title: `修改 ${event.title}`,
      placeholder: '明确发生在温馨小家中的虚拟事件'
    })
    if (detail === null) return
    worldDraft.value = {
      ...worldDraft.value,
      virtualEvents: worldDraft.value.virtualEvents.map(item => (
        item.id === event.id ? { ...item, detail: String(detail).trim() } : item
      ))
    }
  }

  const confirmWorldDraft = async () => {
    if (!worldDraft.value) return
    if (!await appConfirm('确认后将写入她的自我档案、固定人物和初始虚拟事件，并用于之后的聊天。', {
      title: '启用这份世界草案？',
      confirmText: '确认启用'
    })) return
    chatStore.setSelfProfile(worldDraft.value.selfProfile)
    chatStore.setSocialCast(worldDraft.value.socialCast)
    chatStore.setVirtualEvents(worldDraft.value.virtualEvents)
    worldDraft.value = null
    appToast('她的世界已经启用', { tone: 'success' })
  }

  const setDailyMinimum = value => {
    proactiveForm.value.dailyMin = Math.max(0, Math.min(5, Number(value)))
    if (proactiveForm.value.dailyMin > proactiveForm.value.dailyMax) {
      proactiveForm.value.dailyMax = proactiveForm.value.dailyMin
    }
  }

  const setDailyMaximum = value => {
    proactiveForm.value.dailyMax = Math.max(0, Math.min(5, Number(value)))
    if (proactiveForm.value.dailyMax < proactiveForm.value.dailyMin) {
      proactiveForm.value.dailyMin = proactiveForm.value.dailyMax
    }
  }

  const setFollowupEnabled = async value => {
    const settings = chatStore.setRealismSettings({ followupEnabled: value })
    if (!settings.followupEnabled) chatStore.setFollowupOutbox([])
    await syncChatFollowupNotifications(chatStore.followupOutbox, settings, {
      requestPermission: false,
      now: new Date()
    }).catch(error => console.warn('刷新延迟补话通知失败', error))
    appToast(settings.followupEnabled ? '延迟补话已开启' : '延迟补话已关闭')
  }

  const regenerateCompanionState = async () => {
    isRegeneratingCompanionState.value = true
    try {
      let world
      try {
        world = await generateDailyCompanionWorld({
          companionName: chatStore.profile.companionName,
          now: new Date(),
          previousState: chatStore.companionState,
          memories: chatStore.memories,
          openLoops: chatStore.openLoops,
          recentMessages: chatStore.messages.slice(-30),
          selfProfile: chatStore.selfProfile,
          socialCast: chatStore.socialCast,
          recentVirtualEvents: chatStore.virtualEvents.slice(0, 12)
        })
      } catch (error) {
        console.warn('重新生成女朋友状态失败，已使用本地状态', error)
        world = localDailyCompanionWorld()
      }
      chatStore.setCompanionState(world.state)
      if (world.virtualEvent && !chatStore.virtualEvents.some(item => item.date === world.virtualEvent.date)) {
        chatStore.addVirtualEvent(world.virtualEvent)
      }
      appToast('她今天的状态已经更新', { tone: 'success' })
    } finally {
      isRegeneratingCompanionState.value = false
    }
  }

  const saveChatProactiveSettings = async () => {
    isSavingChatProactive.value = true
    try {
      const settings = chatStore.setProactiveSettings(proactiveForm.value)
      const now = new Date()
      const slots = buildProactiveSlots({
        settings,
        messages: chatStore.messages,
        openLoops: chatStore.openLoops,
        existingOutbox: [],
        now,
        days: 7
      })
      const outbox = await generateProactiveOutbox({
        slots,
        companionName: chatStore.profile.companionName,
        state: chatStore.companionState,
        memories: chatStore.memories,
        openLoops: chatStore.openLoops,
        recentMessages: chatStore.messages.slice(-30),
        selfProfile: chatStore.selfProfile,
        socialCast: chatStore.socialCast,
        virtualEvents: chatStore.virtualEvents.slice(0, 12),
        now
      })
      chatStore.setProactiveOutbox(outbox)
      const result = await syncChatProactiveNotifications(outbox, settings, {
        requestPermission: settings.enabled,
        now
      })
      await syncChatFollowupNotifications(
        chatStore.followupOutbox,
        chatStore.realismSettings,
        { requestPermission: false, now }
      )
      if (settings.enabled && result.permission !== 'granted') {
        appToast('主动联系已保存，但系统还没有通知权限', { tone: 'warning', duration: 3500 })
      } else {
        appToast(settings.enabled ? '主动联系时间已经安排好啦' : '主动联系已关闭', { tone: 'success' })
      }
    } catch (error) {
      if (error?.code === 'NOTIFICATION_PERMISSION_DENIED') {
        appToast('设置已保存；允许系统通知后，她才能在应用外来找你', {
          tone: 'warning',
          duration: 3800
        })
        return
      }
      console.error('保存温馨小家主动联系设置失败', error)
      appAlert('主动联系设置暂时没有保存成功，请稍后再试')
    } finally {
      isSavingChatProactive.value = false
    }
  }

  const cancelStoredChatProactive = async () => {
    chatStore.setProactiveOutbox([])
    chatStore.setFollowupOutbox([])
    await syncChatProactiveNotifications([], { ...chatStore.proactiveSettings, enabled: false }, {
      requestPermission: false,
      now: new Date()
    }).catch(error => console.warn('清理温馨小家主动通知失败', error))
    await syncChatFollowupNotifications([], { followupEnabled: false }, {
      requestPermission: false,
      now: new Date()
    }).catch(error => console.warn('清理温馨小家补话通知失败', error))
  }

  const clearChatMessages = async () => {
    if (!await appConfirm('将永久删除全部聊天消息，但保留女朋友名字、头像和长期记忆。', {
      title: '清空聊天记录？',
      confirmText: '清空聊天',
      destructive: true
    })) return
    chatStore.clearMessages()
    chatStore.replaceOpenLoops([])
    await cancelStoredChatProactive()
    appToast('聊天记录已清空')
  }

  const clearChatMemories = async () => {
    if (!await appConfirm('将永久删除全部长期记忆，但保留聊天记录。', {
      title: '清空长期记忆？',
      confirmText: '清空记忆',
      destructive: true
    })) return
    chatStore.clearMemories()
    await cancelStoredChatProactive()
    memoryPage.value = 1
    appToast('长期记忆已清空')
  }

  const resetChatHome = async () => {
    if (!await appConfirm('将永久删除温馨小家的名字、头像、全部聊天和长期记忆，无法撤销。', {
      title: '重置温馨小家？',
      confirmText: '全部重置',
      destructive: true
    })) return
    chatStore.resetAll()
    await cancelStoredChatProactive()
    companionNameInput.value = chatStore.profile.companionName
    memoryPage.value = 1
    appToast('温馨小家已重置')
  }


  return {
    CHAT_MEMORY_SCOPES,
    prepareCompanionAvatar,
    generateDailyCompanionWorld,
    localDailyCompanionWorld,
    buildProactiveSlots,
    generateProactiveOutbox,
    syncChatProactiveNotifications,
    syncChatFollowupNotifications,
    generateCompanionWorldDraft,
    appAlert,
    appConfirm,
    appPrompt,
    appToast,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    companionAvatarInputRef,
    companionNameInput,
    newMemoryContent,
    newMemoryCategory,
    newMemoryScope,
    memoryScopeFilter,
    memoryPage,
    isProcessingCompanionAvatar,
    isRegeneratingCompanionState,
    isSavingChatProactive,
    isWorldExpanded,
    isGeneratingWorldDraft,
    worldDraft,
    proactiveForm,
    MEMORY_PAGE_SIZE,
    memoryScopeMeta,
    memoryScopeOptions,
    scopedChatMemories,
    memoryPageCount,
    pagedChatMemories,
    memoryRangeLabel,
    triggerCompanionAvatarUpload,
    handleCompanionAvatarUpload,
    clearCompanionAvatar,
    saveCompanionName,
    addChatMemory,
    editChatMemory,
    deleteChatMemory,
    selfProfileSections,
    editSelfSummary,
    editSelfProfileList,
    addSocialCharacter,
    editSocialCharacter,
    deleteSocialCharacter,
    deleteVirtualEvent,
    revertEvolution,
    resetCompanionWorld,
    buildCompanionWorldFromHistory,
    editWorldDraftSummary,
    editWorldDraftList,
    removeWorldDraftCharacter,
    editWorldDraftCharacter,
    removeWorldDraftEvent,
    editWorldDraftEvent,
    confirmWorldDraft,
    setDailyMinimum,
    setDailyMaximum,
    setFollowupEnabled,
    regenerateCompanionState,
    saveChatProactiveSettings,
    cancelStoredChatProactive,
    clearChatMessages,
    clearChatMemories,
    resetChatHome
  }
}
