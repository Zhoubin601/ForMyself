import { BACKUP_TYPE_OPTIONS, moduleRegistry } from '../../application/moduleRegistry.js'
import { restoreState } from '../../platform/storage/restoreState.js'
import { createFullBackupRuntime } from '../../application/fullBackupRuntime.js'
import { Capacitor } from '@capacitor/core'
import { ref } from 'vue'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import CryptoJS from 'crypto-js'
import { syncReminderNotifications } from '../../services/notificationService'
import { getPersonalizedReminderBodies } from '../../services/reminderSchedule'
import { beginNativeActivityGuard } from '../../services/nativeActivityGuard'
import { buildFullBackupSnapshot } from '../../services/fullBackup'
import { prepareKanataFullRestore, buildKanataChatBackupSnapshot as buildChatBackupSnapshot, readKanataChatBackupSnapshot as normalizeChatBackupSnapshot } from '../../features/chat/backup/kanataBackup.js'
import { buildMoodBackupSnapshot, normalizeMoodBackupSnapshot } from '../../features/mood/moodRecords'
import { syncChatProactiveNotifications } from '../../features/chat/chatProactive'
import { syncChatFollowupNotifications } from '../../features/chat/chatFollowup'
import { useAuthStore } from '../../stores/auth'
import { useProtectedAccessStore } from '../../stores/protectedAccess.js'
import { useDebtStore } from '../../stores/debt'
import { normalizeDebtGroups } from '../../services/debtOrdering.js'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { readTodoBackup } from '../../features/todo/todoCore.js'
import { useTodoStore } from '../../features/todo/todoStore.js'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useKanataStore as useChatStore } from '../../features/chat/kanataStore.js'
import { syncScheduleNotifications } from '../../features/schedule/scheduleNotificationService'
import { normalizeScheduleData } from '../../features/schedule/scheduleCore'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'

export function useBackupSettings() {

  const authStore = useAuthStore()
  const protectedAccess = useProtectedAccessStore()
  const backupModules = () => exportDataType.value === 'full' ? protectedAccess.moduleIds
    : moduleRegistry.list.filter(m => m.access && m.backup?.id === exportDataType.value).map(m => m.id)
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const todoStore = useTodoStore()
  const chatStore = useChatStore()

  const fileInputRef = ref(null)

  const exportDataType = ref('full')
  const backupPickerOpen = ref(false)

  const backupTypeOptions = BACKUP_TYPE_OPTIONS

  // --- 数据导出/导入 ---
  const getDataTypeLabel = () => {
    return backupTypeOptions.find(item => item.value === exportDataType.value)?.label.replace('数据（全部数据与设置）', '数据') || '数据'
  }

  const getDataArray = () => fullBackup.registry.singleExport(exportDataType.value)
  const setDataArray = (data, overwrite) => fullBackup.registry.singleImport(exportDataType.value, data, { overwrite })
  const getFilePrefix = () => exportDataType.value === 'full' ? 'Full' : moduleRegistry.list.find(m => m.backup?.id === exportDataType.value)?.backup.prefix

  const fullBackup = createFullBackupRuntime()
  const { createFullBackupSnapshot, applyFullBackupSnapshot } = fullBackup
  const restoreFullBackup = (snapshot, options = {}) => fullBackup.restore(snapshot, authStore.savedMasterPwd, options)
  const normalizeFullBackupSnapshot = input => { prepareKanataFullRestore(input, { legacyChat: 'discard' }); return input }
  const getFullBackupCounts = input => {
    const value = prepareKanataFullRestore(input, { legacyChat: 'discard' })
    const data = value.backup.data
    return { savings: data.savings.length, weight: data.weight.length, mood: data.mood.length,
      passwords: data.passwords.length, schedules: data.schedules.series.length, todos: data.todos?.tasks.length || 0,
      chatMessages: value.kanata?.messages.length || 0, chatMemories: value.kanata?.memories.length || 0,
      worlds: value.kanata?.worlds.length || 0 }
  }

  const downloadAsFile = (content, filename) => {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const ensureOrdinaryDataReady = async (flush = true) => {
    const required = { savings: debtStore, weight: weightStore, mood: moodStore, schedules: scheduleStore }
    const targets = exportDataType.value === 'full' ? Object.values(required) : [required[exportDataType.value]].filter(Boolean)
    if (targets.some(store => !store.isDataLoaded)) throw new Error('部分数据尚未安全读取，请重试读取后再备份或导入')
    if (flush) for (const store of targets) await store.flush()
  }

  const exportJSONAuthenticated = async (password, session) => {
    if (['full','todos'].includes(exportDataType.value)) {
      await todoStore.flush()
      await todoStore.load()
      if (!todoStore.isDataLoaded) return appAlert('待办未能安全加载，请重试后导出')
    }
    await ensureOrdinaryDataReady()
    if (exportDataType.value === 'chat') await chatStore.flush()
    const label = getDataTypeLabel()
    const isFullBackup = exportDataType.value === 'full'
    const data = isFullBackup ? await fullBackup.exportFull() : getDataArray()

    const isEmpty = exportDataType.value === 'schedules'
      ? !data.series.length
      : exportDataType.value === 'chat'
        ? !data.data.worlds.length && !data.data.cards.length && !data.data.messages.length && !data.data.memories.length
      : exportDataType.value === 'mood'
        ? !data.data.records.length
        : Array.isArray(data) && data.length === 0
    if (!isFullBackup && isEmpty) return appAlert(`没有检测到可导出的${label}`)

    try {
      if (session !== authStore.sessionRevision || !password) return
      const rawData = JSON.stringify(data)
      const encryptedData = CryptoJS.AES.encrypt(rawData, password).toString()
      const date = new Date().toISOString().slice(0, 10)
      const prefix = getFilePrefix()
      const filename = `ForMyself_${prefix}_Backup_${date}.json`

      if (Capacitor.isNativePlatform()) {
        try {
          const writeResult = await Filesystem.writeFile({
            path: filename,
            data: encryptedData,
            directory: Directory.Cache,
            encoding: Encoding.UTF8
          })
          beginNativeActivityGuard()
          await Share.share({ title: `导出${label}加密备份`, url: writeResult.uri })
        } catch (e) {
          appAlert('导出失败：' + e.message)
        }
      } else {
        downloadAsFile(encryptedData, filename)
      }
    } catch (error) {
      appAlert('导出错误：' + error.message)
    }
  }

  const exportJSON = () => protectedAccess.runOperation(backupModules(), exportJSONAuthenticated)

  const triggerImport = async () => {
    if (!await protectedAccess.ensureModules(backupModules())) return
    if (!fileInputRef.value) return
    beginNativeActivityGuard()
    fileInputRef.value.click()
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => protectedAccess.runOperation(backupModules(), async (password, session) => {
      let decoded = false
      try {
        const encryptedContent = e.target.result
        const bytes = CryptoJS.AES.decrypt(encryptedContent, password)
        const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
        if (!decryptedData) throw new Error('密码错误')
        const importedData = JSON.parse(decryptedData)
        decoded = true
        // Preview/cancellation must not cause writes. Confirmed full restore flushes through its coordinator.
        await ensureOrdinaryDataReady(false)
        const label = getDataTypeLabel()

        if (exportDataType.value === 'todos') {
          const data = readTodoBackup(importedData)
          if (!await appConfirm(`待办备份包含 ${data.tasks.length} 个任务版本和 ${data.completions.length} 条完成记录。继续将覆盖当前待办，其他模块保持不变。`, {title:'恢复每日待办？', confirmText:'覆盖并恢复',destructive:true})) return
          if (session !== authStore.sessionRevision) return
          await setDataArray(data, true)
          appToast('待办恢复成功')
          return
        }
        if (exportDataType.value === 'full') {
          const snapshot = normalizeFullBackupSnapshot(importedData)
          const counts = getFullBackupCounts(snapshot)
          const legacy = Number(snapshot.version) <= 12
          const confirmed = await appConfirm(
        `完整备份包含：\n省钱 ${counts.savings} 项、体重 ${counts.weight} 条、心情 ${counts.mood} 条、密码 ${counts.passwords} 项、日程 ${counts.schedules} 项、待办 ${counts.todos} 个版本。\n${legacy ? '这是旧版备份：旧温馨小家的聊天、记忆、关系和事件不会导入彼方；现有彼方世界保留。' : '彼方世界 ' + counts.worlds + ' 个、聊天 ' + counts.chatMessages + ' 条、长期记忆 ' + counts.chatMemories + ' 条，将覆盖当前彼方资料。'}\n\n继续将恢复上述模块与应用设置。主密码与设备生物识别凭据不会改变。`,
            { title: '恢复完整备份？', confirmText: '覆盖并恢复', destructive: true }
          )
          if (!confirmed) return
          if (session !== authStore.sessionRevision) return
          await restoreFullBackup(snapshot, legacy ? { legacyChat: 'discard' } : {})
          appToast('完整数据恢复成功', { tone: 'success', duration: 3200 })
          return
        }

        if (exportDataType.value === 'schedules') {
          const normalized = normalizeScheduleData(importedData)
          const overwrite = await appConfirm(
            `成功解密出 ${normalized.series.length} 条日程。\n选择“覆盖”会替换当前日程和标签；取消则执行合并。`,
            { title: '选择恢复方式', confirmText: '覆盖当前数据', cancelText: '合并数据' }
          )
          if (session !== authStore.sessionRevision) return
          await setDataArray(normalized, overwrite)
          appToast('日程数据恢复成功', { tone: 'success' })
          return
        }

        if (exportDataType.value === 'chat') {
          const snapshot = normalizeChatBackupSnapshot(importedData)
          const overwrite = await appConfirm(
        `备份包含 ${snapshot.data.worlds.length} 个世界、${snapshot.data.cards.length} 张角色卡、${snapshot.data.messages.length} 条聊天。继续将覆盖当前全部彼方资料，不影响其他模块。待发送任务不会自动重发。`,
            { title: '恢复彼方', confirmText: '覆盖彼方资料', cancelText: '取消', destructive: true }
          )
          if (!overwrite) return
          if (session !== authStore.sessionRevision) return
          await setDataArray(snapshot.data, overwrite)
          appToast('彼方资料恢复成功', { tone: 'success' })
          return
        }

        if (exportDataType.value === 'mood') {
          const snapshot = normalizeMoodBackupSnapshot(importedData, moodStore.moodDefinitions)
          const overwrite = await appConfirm(
            `成功解密出 ${snapshot.data.records.length} 条心情记录，并包含标签与心情等级配置。\n选择“覆盖”会替换当前心情数据；取消则合并记录和等级。`,
            { title: '恢复心情日记', confirmText: '覆盖当前数据', cancelText: '合并数据' }
          )
          if (session !== authStore.sessionRevision) return
          await setDataArray(snapshot, overwrite)
          appToast('心情日记数据恢复成功', { tone: 'success' })
          return
        }

        if (exportDataType.value === 'savings') {
          const records = Array.isArray(importedData) ? importedData : importedData?.records
          if (!Array.isArray(records)) throw new Error('格式错误')
          const groups = normalizeDebtGroups(importedData?.groups, records)
          const overwrite = await appConfirm(`成功解密出 ${records.length} 条省钱计划和 ${groups.length} 个分组。\n选择“覆盖”会替换当前计划与分组；取消则合并。`, {
            title: '选择恢复方式', confirmText: '覆盖当前数据', cancelText: '合并数据'
          })
          if (session !== authStore.sessionRevision) return
          await setDataArray({ records, groups }, overwrite)
          appToast('省钱数据恢复成功', { tone: 'success' })
          return
        }

        if (!Array.isArray(importedData)) throw new Error('格式错误')

        if (await appConfirm(`成功解密出 ${importedData.length} 条${label}项目。\n选择“覆盖”会替换当前数据；取消则执行追加。`, {
          title: '选择恢复方式',
          confirmText: '覆盖当前数据',
          cancelText: '追加数据'
        })) {
          if (session !== authStore.sessionRevision) return
          await setDataArray(importedData, true)
        } else {
          if (session !== authStore.sessionRevision) return
          await setDataArray(importedData, false)
        }
        appToast(`${label}数据恢复成功`, { tone: 'success' })
      } catch (error) {
        if (restoreState.blocked) return appAlert(restoreState.message)
        if (decoded && exportDataType.value !== 'full') return appAlert('备份已解密，但恢复或同步失败，请检查保存状态并重试：' + error.message)
        if (error?.rollbackFailed) return appAlert('完整恢复回滚失败，请保留应用数据并重试恢复')
        if (exportDataType.value === 'todos') {
          appAlert('待办恢复失败：文件格式、版本或主密码不匹配；原待办保留')
        } else if (exportDataType.value === 'full') {
          appAlert('完整备份恢复失败：文件损坏、版本不兼容或主密码不匹配')
        } else {
          appAlert('解密失败：主密码与当前备份包不匹配')
        }
      } finally {
        event.target.value = ''
      }
    })
    reader.readAsText(file)
  }


  return {
    Capacitor,
    Filesystem,
    Directory,
    Encoding,
    Share,
    CryptoJS,
    syncReminderNotifications,
    getPersonalizedReminderBodies,
    beginNativeActivityGuard,
    buildFullBackupSnapshot,
    getFullBackupCounts,
    normalizeFullBackupSnapshot,
    buildMoodBackupSnapshot,
    normalizeMoodBackupSnapshot,
    buildChatBackupSnapshot,
    normalizeChatBackupSnapshot,
    syncChatProactiveNotifications,
    syncChatFollowupNotifications,
    syncScheduleNotifications,
    normalizeScheduleData,
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
    kanataStore: chatStore,
    fileInputRef,
    exportDataType,
    backupPickerOpen,
    backupTypeOptions,
    getDataTypeLabel,
    getDataArray,
    setDataArray,
    getFilePrefix,
    createFullBackupSnapshot,
    applyFullBackupSnapshot,
    restoreFullBackup,
    downloadAsFile,
    exportJSON,
    triggerImport,
    handleFileUpload
  }
}
