import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'

export function useCatalogSettings({ newScheduleCategoryColor }) {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  const newVaultCategory = ref('')
  const newScheduleCategory = ref('')
  const newMoodLabel = ref('')
  const newMoodEmoji = ref('😊')
  const newMoodColor = ref('#FF9F43')
  const editingMoodId = ref('')
  const editMoodLabel = ref('')
  const editMoodEmoji = ref('')
  const editMoodColor = ref('#8E8E93')
  const draggedMoodId = ref('')

  const deleteMoodTag = async (tag) => {
    if (!await appConfirm(`“${tag}”也会从历史心情记录中移除。`, {
      title: '删除心情标签？',
      destructive: true
    })) return
    if (moodStore.removeCustomTag(tag)) appToast(`已删除心情标签“${tag}”`, { tone: 'success' })
  }

  const moodDefinitionError = reason => ({
    INVALID_LABEL: '请输入 1–12 个字符的心情名称',
    INVALID_EMOJI: '请输入一个完整的系统 Emoji',
    INVALID_COLOR: '请输入有效的 HEX 颜色，例如 #FF9F43',
    DUPLICATE_LABEL: '心情名称不能重复',
    DEFAULT: '默认心情不能归档或删除，请先指定其他默认项',
    LAST_ACTIVE: '至少要保留一个可用心情等级',
    IN_USE: '这个等级仍被历史记录使用，只能归档保留'
  })[reason] || '操作失败，请稍后重试'

  const addMoodDefinition = () => {
    const result = moodStore.addMoodDefinition({
      label: newMoodLabel.value,
      emoji: newMoodEmoji.value,
      color: newMoodColor.value
    })
    if (!result.ok) return appAlert(moodDefinitionError(result.reason))
    newMoodLabel.value = ''
    newMoodEmoji.value = '😊'
    newMoodColor.value = '#FF9F43'
    appToast('已添加心情等级', { tone: 'success' })
  }

  const beginEditMoodDefinition = definition => {
    editingMoodId.value = definition.id
    editMoodLabel.value = definition.label
    editMoodEmoji.value = definition.emoji
    editMoodColor.value = definition.color
  }

  const saveMoodDefinition = () => {
    const result = moodStore.updateMoodDefinition(editingMoodId.value, {
      label: editMoodLabel.value,
      emoji: editMoodEmoji.value,
      color: editMoodColor.value
    })
    if (!result.ok) return appAlert(moodDefinitionError(result.reason))
    editingMoodId.value = ''
    appToast('心情等级已更新', { tone: 'success' })
  }

  const moveMoodDefinition = (id, offset) => {
    const ids = moodStore.activeMoodDefinitions.map(item => item.id)
    const index = ids.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    moodStore.reorderMoodDefinitions(ids)
  }

  const dropMoodDefinition = targetId => {
    const sourceId = draggedMoodId.value
    draggedMoodId.value = ''
    if (!sourceId || sourceId === targetId) return
    const ids = moodStore.activeMoodDefinitions.map(item => item.id)
    const sourceIndex = ids.indexOf(sourceId)
    const targetIndex = ids.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    ids.splice(targetIndex, 0, ids.splice(sourceIndex, 1)[0])
    moodStore.reorderMoodDefinitions(ids)
  }

  const setDefaultMoodDefinition = definition => {
    if (moodStore.setDefaultMoodDefinition(definition.id)) {
      appToast(`已将“${definition.label}”设为默认心情`, { tone: 'success' })
    }
  }

  const archiveMoodDefinition = async definition => {
    if (!await appConfirm(`归档后，“${definition.label}”不会出现在新记录中，历史记录仍会原样保留。`, {
      title: '归档心情等级？', confirmText: '归档'
    })) return
    const result = moodStore.archiveMoodDefinition(definition.id)
    if (!result.ok) return appAlert(moodDefinitionError(result.reason))
    if (editingMoodId.value === definition.id) editingMoodId.value = ''
    appToast(`已归档“${definition.label}”`, { tone: 'success' })
  }

  const restoreMoodDefinition = definition => {
    if (moodStore.restoreMoodDefinition(definition.id)) {
      appToast(`已恢复“${definition.label}”`, { tone: 'success' })
    }
  }

  const deleteMoodDefinition = async definition => {
    if (!await appConfirm(`永久删除未使用的心情等级“${definition.label}”。`, {
      title: '删除心情等级？', confirmText: '永久删除', destructive: true
    })) return
    const result = moodStore.deleteMoodDefinition(definition.id)
    if (!result.ok) return appAlert(moodDefinitionError(result.reason))
    if (editingMoodId.value === definition.id) editingMoodId.value = ''
    appToast(`已删除“${definition.label}”`, { tone: 'success' })
  }

  const moodDefinitionUsageCount = id => moodStore.moodRecords.filter(record => record.mood === id).length

  const addVaultCategory = () => {
    const result = vaultStore.addCategory(newVaultCategory.value)
    if (!result.ok) {
      if (result.reason === 'EMPTY') return appAlert('请输入分类名称')
      if (result.reason === 'EXISTS') return appAlert('该分类已经存在')
      return
    }
    newVaultCategory.value = ''
    appToast(`已添加密码分类“${result.category}”`, { tone: 'success' })
  }

  const vaultCategoryUsageCount = category => vaultStore.records.filter(record => record.category === category).length

  const deleteVaultCategory = async (category) => {
    const usageCount = vaultCategoryUsageCount(category)
    if (usageCount > 0) return appAlert(`分类“${category}”仍有 ${usageCount} 条密码记录，不能删除`)
    if (!await appConfirm(`将移除密码分类“${category}”。`, {
      title: '删除密码分类？',
      destructive: true
    })) return
    const result = vaultStore.deleteCategory(category)
    if (!result.ok) {
      if (result.reason === 'PROTECTED') appAlert('“未分类”是系统兜底分类，不能删除')
      else if (result.reason === 'IN_USE') appAlert(`分类“${category}”仍有密码记录，不能删除`)
    }
  }

  const addScheduleCategory = () => {
    const category = scheduleStore.addCategory({
      name: newScheduleCategory.value,
      color: newScheduleCategoryColor.value
    })
    if (!category) return appAlert(newScheduleCategory.value.trim() ? '该日程标签已经存在' : '请输入日程标签名称')
    newScheduleCategory.value = ''
  }

  const deleteScheduleCategory = async category => {
    if (category.builtIn) return
    const usageCount = scheduleStore.categoryUsageCount(category.id)
    if (usageCount > 0) {
      return appAlert(`标签“${category.name}”仍有 ${usageCount} 条日程内容，不能删除`)
    }
    if (!await appConfirm(`将移除日程标签“${category.name}”。`, {
      title: '删除日程标签？',
      destructive: true
    })) return
    const result = scheduleStore.deleteCategory(category.id)
    if (!result.ok) {
      if (result.reason === 'PROTECTED') appAlert('“学习”是系统保留标签，不能删除')
      else if (result.reason === 'IN_USE') appAlert(`标签“${category.name}”仍有日程内容，不能删除`)
    }
  }

  return {
    appAlert,
    appConfirm,
    appToast,
    authStore,
    debtStore,
    weightStore,
    moodStore,
    settingsStore,
    vaultStore,
    scheduleStore,
    chatStore,
    newVaultCategory,
    newScheduleCategory,
    newMoodLabel,
    newMoodEmoji,
    newMoodColor,
    editingMoodId,
    editMoodLabel,
    editMoodEmoji,
    editMoodColor,
    draggedMoodId,
    deleteMoodTag,
    moodDefinitionError,
    addMoodDefinition,
    beginEditMoodDefinition,
    saveMoodDefinition,
    moveMoodDefinition,
    dropMoodDefinition,
    setDefaultMoodDefinition,
    archiveMoodDefinition,
    restoreMoodDefinition,
    deleteMoodDefinition,
    moodDefinitionUsageCount,
    addVaultCategory,
    vaultCategoryUsageCount,
    deleteVaultCategory,
    addScheduleCategory,
    deleteScheduleCategory
  }
}
