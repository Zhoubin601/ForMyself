import { Capacitor } from '@capacitor/core'
import { ref } from 'vue'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import CryptoJS from 'crypto-js'
import { syncReminderNotifications } from '../../services/notificationService'
import { getPersonalizedReminderBodies } from '../../services/reminderSchedule'
import { beginNativeActivityGuard } from '../../services/nativeActivityGuard'
import { buildFullBackupSnapshot, getFullBackupCounts, normalizeFullBackupSnapshot } from '../../services/fullBackup'
import { buildMoodBackupSnapshot, normalizeMoodBackupSnapshot } from '../../features/mood/moodRecords'
import { buildChatBackupSnapshot, normalizeChatBackupSnapshot } from '../../features/chat/chatRecords'
import { syncChatProactiveNotifications } from '../../features/chat/chatProactive'
import { syncChatFollowupNotifications } from '../../features/chat/chatFollowup'
import { useAuthStore } from '../../stores/auth'
import { useDebtStore } from '../../stores/debt'
import { useWeightStore } from '../../stores/weight'
import { useMoodStore } from '../../features/mood/moodStore'
import { useSettingsStore } from '../../stores/settings'
import { usePasswordVaultStore } from '../../stores/passwordVault'
import { useScheduleStore } from '../../features/schedule/scheduleStore'
import { useChatStore } from '../../features/chat/chatStore'
import { syncScheduleNotifications } from '../../features/schedule/scheduleNotificationService'
import { normalizeScheduleData } from '../../features/schedule/scheduleCore'
import { appAlert, appConfirm, appToast } from '../../services/uiFeedback'

export function useBackupSettings() {

  const authStore = useAuthStore()
  const debtStore = useDebtStore()
  const weightStore = useWeightStore()
  const moodStore = useMoodStore()
  const settingsStore = useSettingsStore()
  const vaultStore = usePasswordVaultStore()
  const scheduleStore = useScheduleStore()
  const chatStore = useChatStore()

  const fileInputRef = ref(null)

  const exportDataType = ref('full')
  const backupPickerOpen = ref(false)

  const backupTypeOptions = [
    { value: 'full', label: '完整数据（全部数据与设置）' },
    { value: 'savings', label: '省钱数据' },
    { value: 'weight', label: '体重数据' },
    { value: 'mood', label: '心情数据' },
    { value: 'passwords', label: '密码库数据' },
    { value: 'schedules', label: '日程数据' },
    { value: 'chat', label: '温馨小家数据' }
  ]

  // --- 数据导出/导入 ---
  const getDataTypeLabel = () => {
    return backupTypeOptions.find(item => item.value === exportDataType.value)?.label.replace('数据（全部数据与设置）', '数据') || '数据'
  }

  const getDataArray = () => {
    if (exportDataType.value === 'savings') return debtStore.savedDebts
    if (exportDataType.value === 'weight') return weightStore.weightRecords
    if (exportDataType.value === 'passwords') return vaultStore.records
    if (exportDataType.value === 'schedules') return scheduleStore.snapshot
    if (exportDataType.value === 'chat') return buildChatBackupSnapshot(chatStore.snapshot)
    return buildMoodBackupSnapshot({
      records: moodStore.moodRecords,
      trackingStartDate: moodStore.trackingStartDate,
      customTags: moodStore.customTags,
      definitions: moodStore.moodDefinitions
    })
  }

  const setDataArray = async (data, overwrite) => {
    if (exportDataType.value === 'savings') {
      debtStore.updateDebts(overwrite ? data : [...debtStore.savedDebts, ...data])
    } else if (exportDataType.value === 'weight') {
      weightStore.updateWeightRecords(overwrite ? data : [...weightStore.weightRecords, ...data])
    } else if (exportDataType.value === 'passwords') {
      if (overwrite) vaultStore.replaceRecords(data)
      else vaultStore.appendRecords(data)
    } else if (exportDataType.value === 'schedules') {
      const imported = normalizeScheduleData(data)
      const merged = overwrite ? imported : normalizeScheduleData({
        series: [...scheduleStore.series, ...imported.series],
        occurrences: [...scheduleStore.occurrences, ...imported.occurrences],
        categories: [...scheduleStore.categories, ...imported.categories]
      })
      await scheduleStore.restoreScheduleData(merged)
    } else if (exportDataType.value === 'chat') {
      if (overwrite) await chatStore.replaceChatData(data)
      else await chatStore.mergeChatSnapshot(data)
      chatStore.materializeDueProactive(Date.now())
      chatStore.materializeDueFollowups(Date.now())
      await syncChatProactiveNotifications(
        chatStore.proactiveOutbox,
        chatStore.proactiveSettings,
        { requestPermission: false, now: new Date() }
      ).catch(error => console.warn('导入温馨小家后刷新主动联系失败', error))
      await syncChatFollowupNotifications(
        chatStore.followupOutbox,
        chatStore.realismSettings,
        { requestPermission: false, now: new Date() }
      ).catch(error => console.warn('导入温馨小家后刷新补话失败', error))
    } else {
      moodStore.updateMoodRecords(overwrite ? data : [...moodStore.moodRecords, ...data])
    }
  }

  const getFilePrefix = () => {
    return { full: 'Full', savings: 'Savings', weight: 'Weight', mood: 'Mood', passwords: 'Passwords', schedules: 'Schedules', chat: 'WarmHome' }[exportDataType.value]
  }

  const createFullBackupSnapshot = () => buildFullBackupSnapshot({
    savings: debtStore.savedDebts,
    weight: weightStore.weightRecords,
    mood: moodStore.moodRecords,
    passwords: vaultStore.records,
    schedules: scheduleStore.snapshot,
    chat: chatStore.snapshot,
    moodMetadata: {
      trackingStartDate: moodStore.trackingStartDate,
      customTags: moodStore.customTags,
      definitions: moodStore.moodDefinitions
    },
    vaultMetadata: {
      categories: vaultStore.categories
    },
    settings: settingsStore.getBackupSnapshot()
  })

  const applyFullBackupSnapshot = async (snapshot) => {
    const results = await Promise.allSettled([
      debtStore.restoreDebts(snapshot.data.savings),
      weightStore.restoreWeightRecords(snapshot.data.weight),
      moodStore.restoreMoodBackup(snapshot.data.mood, snapshot.metadata.mood),
      vaultStore.restoreRecords(snapshot.data.passwords, snapshot.metadata.vault),
      scheduleStore.restoreScheduleData(snapshot.data.schedules),
      chatStore.restoreChatData(snapshot.data.chat),
      settingsStore.restoreBackupSnapshot(snapshot.settings)
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  const restoreFullBackup = async (snapshot) => {
    const previousSnapshot = createFullBackupSnapshot()
    try {
      await applyFullBackupSnapshot(snapshot)
    } catch (error) {
      try {
        await applyFullBackupSnapshot(previousSnapshot)
      } catch (rollbackError) {
        console.error('完整备份恢复失败且回滚未完全成功', rollbackError)
      }
      throw error
    }

    try {
      await syncReminderNotifications(settingsStore.notificationSettings, {
        personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
      })
      await syncScheduleNotifications(scheduleStore.snapshot)
      chatStore.materializeDueProactive(Date.now())
      chatStore.materializeDueFollowups(Date.now())
      await syncChatProactiveNotifications(
        chatStore.proactiveOutbox,
        chatStore.proactiveSettings,
        { requestPermission: false, now: new Date() }
      )
      await syncChatFollowupNotifications(
        chatStore.followupOutbox,
        chatStore.realismSettings,
        { requestPermission: false, now: new Date() }
      )
    } catch (error) {
      console.warn('恢复完整备份后刷新通知失败', error)
    }
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

  const exportJSON = async () => {
    const label = getDataTypeLabel()
    const isFullBackup = exportDataType.value === 'full'
    const data = isFullBackup ? createFullBackupSnapshot() : getDataArray()

    const isEmpty = exportDataType.value === 'schedules'
      ? !data.series.length
      : exportDataType.value === 'chat'
        ? !data.data.messages.length && !data.data.memories.length
      : exportDataType.value === 'mood'
        ? !data.data.records.length
        : Array.isArray(data) && data.length === 0
    if (!isFullBackup && isEmpty) return appAlert(`没有检测到可导出的${label}`)

    try {
      const rawData = JSON.stringify(data)
      const encryptedData = CryptoJS.AES.encrypt(rawData, authStore.savedMasterPwd).toString()
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

  const triggerImport = () => {
    if (!fileInputRef.value) return
    beginNativeActivityGuard()
    fileInputRef.value.click()
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const encryptedContent = e.target.result
        const bytes = CryptoJS.AES.decrypt(encryptedContent, authStore.savedMasterPwd)
        const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
        if (!decryptedData) throw new Error('密码错误')
        const importedData = JSON.parse(decryptedData)
        const label = getDataTypeLabel()

        if (exportDataType.value === 'full') {
          const snapshot = normalizeFullBackupSnapshot(importedData)
          const counts = getFullBackupCounts(snapshot)
          const confirmed = await appConfirm(
        `完整备份包含：\n省钱 ${counts.savings} 项、体重 ${counts.weight} 条、心情 ${counts.mood} 条、密码 ${counts.passwords} 项、日程 ${counts.schedules} 项、聊天 ${counts.chatMessages} 条、长期记忆 ${counts.chatMemories} 条，以及女朋友头像。\n\n继续将覆盖以上全部数据和应用设置。主密码与设备生物识别凭据不会改变。`,
            { title: '恢复完整备份？', confirmText: '覆盖并恢复', destructive: true }
          )
          if (!confirmed) return
          await restoreFullBackup(snapshot)
          appToast('完整数据恢复成功', { tone: 'success', duration: 3200 })
          return
        }

        if (exportDataType.value === 'schedules') {
          const normalized = normalizeScheduleData(importedData)
          const overwrite = await appConfirm(
            `成功解密出 ${normalized.series.length} 条日程。\n选择“覆盖”会替换当前日程和标签；取消则执行合并。`,
            { title: '选择恢复方式', confirmText: '覆盖当前数据', cancelText: '合并数据' }
          )
          await setDataArray(normalized, overwrite)
          await syncScheduleNotifications(scheduleStore.snapshot)
          appToast('日程数据恢复成功', { tone: 'success' })
          return
        }

        if (exportDataType.value === 'chat') {
          const snapshot = normalizeChatBackupSnapshot(importedData)
          const overwrite = await appConfirm(
        `成功解密出 ${snapshot.data.messages.length} 条聊天和 ${snapshot.data.memories.length} 条长期记忆。\n选择“覆盖”会替换名字、头像、聊天和记忆；取消则合并数据并保留当前名字与头像。`,
            { title: '恢复温馨小家', confirmText: '覆盖当前数据', cancelText: '合并数据' }
          )
          await setDataArray(snapshot.data, overwrite)
          appToast('温馨小家数据恢复成功', { tone: 'success' })
          return
        }

        if (exportDataType.value === 'mood') {
          const snapshot = normalizeMoodBackupSnapshot(importedData, moodStore.moodDefinitions)
          const overwrite = await appConfirm(
            `成功解密出 ${snapshot.data.records.length} 条心情记录，并包含标签与心情等级配置。\n选择“覆盖”会替换当前心情数据；取消则合并记录和等级。`,
            { title: '恢复心情日记', confirmText: '覆盖当前数据', cancelText: '合并数据' }
          )
          if (overwrite) await moodStore.restoreMoodBackup(snapshot.data.records, snapshot.metadata)
          else await moodStore.mergeMoodBackup(snapshot.data.records, snapshot.metadata)
          appToast('心情日记数据恢复成功', { tone: 'success' })
          return
        }

        if (!Array.isArray(importedData)) throw new Error('格式错误')

        if (await appConfirm(`成功解密出 ${importedData.length} 条${label}项目。\n选择“覆盖”会替换当前数据；取消则执行追加。`, {
          title: '选择恢复方式',
          confirmText: '覆盖当前数据',
          cancelText: '追加数据'
        })) {
          await setDataArray(importedData, true)
        } else {
          await setDataArray(importedData, false)
        }
        appToast(`${label}数据恢复成功`, { tone: 'success' })
      } catch (err) {
        if (exportDataType.value === 'full') {
          appAlert('完整备份恢复失败：文件损坏、版本不兼容或主密码不匹配')
        } else {
          appAlert('解密失败：主密码与当前备份包不匹配')
        }
      } finally {
        event.target.value = ''
      }
    }
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
    chatStore,
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
