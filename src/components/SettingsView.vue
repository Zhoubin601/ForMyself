<script setup>
import { Capacitor } from '@capacitor/core'
import { computed, onMounted, ref, watch } from 'vue'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import CryptoJS from 'crypto-js'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { askAI } from '../services/aiEngine'
import {
  getReminderNotificationStatus,
  requestExactReminderPermission,
  sendReminderSetupConfirmation,
  sendReminderTestNotification,
  syncReminderNotifications
} from '../services/notificationService'
import { refreshPersonalizedReminderContent } from '../services/notificationPersonalizer'
import { getPersonalizedReminderBodies } from '../services/reminderSchedule'
import {
  buildFullBackupSnapshot,
  getFullBackupCounts,
  normalizeFullBackupSnapshot
} from '../services/fullBackup'

import { useAuthStore } from '../stores/auth'
import { useDebtStore } from '../stores/debt'
import { useWeightStore } from '../stores/weight'
import { useMoodStore } from '../stores/mood'
import { useSettingsStore } from '../stores/settings'
import { usePasswordVaultStore } from '../stores/passwordVault'

const authStore = useAuthStore()
const debtStore = useDebtStore()
const weightStore = useWeightStore()
const moodStore = useMoodStore()
const settingsStore = useSettingsStore()
const vaultStore = usePasswordVaultStore()

const isChangingPwd = ref(false)
const isChangingPwdBio = ref(false)

const oldPwdInput = ref('')
const newPwdInput = ref('')
const confirmNewPwdInput = ref('')
const fileInputRef = ref(null)
const bgInputRef = ref(null)

const exportDataType = ref('full')
const newVaultCategory = ref('')

// --- 看板设置 ---
const localBanner = ref({ ...settingsStore.bannerSettings })

watch(() => settingsStore.bannerSettings, (newVal) => {
  if (newVal) localBanner.value = { ...newVal }
}, { deep: true, immediate: true })

const saveBannerSettings = () => {
  settingsStore.updateBanner({ ...localBanner.value })
  alert('看板配置已保存生效！')
}

const deleteMoodTag = (tag) => {
  if (!confirm(`确认删除心情标签“${tag}”？该标签也会从历史心情记录中移除。`)) return
  if (moodStore.removeCustomTag(tag)) alert(`已删除心情标签“${tag}”`)
}

const addVaultCategory = () => {
  const result = vaultStore.addCategory(newVaultCategory.value)
  if (!result.ok) {
    if (result.reason === 'EMPTY') return alert('请输入分类名称')
    if (result.reason === 'EXISTS') return alert('该分类已经存在')
    return
  }
  newVaultCategory.value = ''
  alert(`已添加密码分类“${result.category}”`)
}

const vaultCategoryUsageCount = category => vaultStore.records.filter(record => record.category === category).length

const deleteVaultCategory = (category) => {
  const usageCount = vaultCategoryUsageCount(category)
  if (usageCount > 0) return alert(`分类“${category}”仍有 ${usageCount} 条密码记录，不能删除`)
  if (!confirm(`确认删除密码分类“${category}”？`)) return
  const result = vaultStore.deleteCategory(category)
  if (!result.ok) {
    if (result.reason === 'PROTECTED') alert('“未分类”是系统兜底分类，不能删除')
    else if (result.reason === 'IN_USE') alert(`分类“${category}”仍有密码记录，不能删除`)
  }
}

// --- 安全 ---
const changeMasterPassword = async () => {
  const err = await authStore.updatePassword(oldPwdInput.value, newPwdInput.value, confirmNewPwdInput.value)
  if (err) return alert(err)
  await vaultStore.reencrypt(newPwdInput.value)
  oldPwdInput.value = ''; newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwd.value = false
  alert('主密码已重设')
}

const triggerBioChangePwd = async () => {
  try {
    await NativeBiometric.verifyIdentity({ reason: '验证指纹以重设主密码', title: '安全认证' })
    isChangingPwd.value = false; isChangingPwdBio.value = true; newPwdInput.value = ''; confirmNewPwdInput.value = ''
  } catch (err) { alert('身份验证已取消') }
}

const changeMasterPasswordBio = async () => {
  const err = await authStore.updatePassword(null, newPwdInput.value, confirmNewPwdInput.value)
  if (err) return alert(err)
  await vaultStore.reencrypt(newPwdInput.value)
  newPwdInput.value = ''; confirmNewPwdInput.value = ''; isChangingPwdBio.value = false
  alert('主密码已重设')
}

// --- 数据导出/导入 ---
const getDataTypeLabel = () => {
  return { full: '完整数据', savings: '省钱', weight: '体重', mood: '心情', passwords: '密码库' }[exportDataType.value]
}

const getDataArray = () => {
  if (exportDataType.value === 'savings') return debtStore.savedDebts
  if (exportDataType.value === 'weight') return weightStore.weightRecords
  if (exportDataType.value === 'passwords') return vaultStore.records
  return moodStore.moodRecords
}

const setDataArray = (data, overwrite) => {
  if (exportDataType.value === 'savings') {
    debtStore.updateDebts(overwrite ? data : [...debtStore.savedDebts, ...data])
  } else if (exportDataType.value === 'weight') {
    weightStore.updateWeightRecords(overwrite ? data : [...weightStore.weightRecords, ...data])
  } else if (exportDataType.value === 'passwords') {
    if (overwrite) vaultStore.replaceRecords(data)
    else vaultStore.appendRecords(data)
  } else {
    moodStore.updateMoodRecords(overwrite ? data : [...moodStore.moodRecords, ...data])
  }
}

const getFilePrefix = () => {
  return { full: 'Full', savings: 'Savings', weight: 'Weight', mood: 'Mood', passwords: 'Passwords' }[exportDataType.value]
}

const createFullBackupSnapshot = () => buildFullBackupSnapshot({
  savings: debtStore.savedDebts,
  weight: weightStore.weightRecords,
  mood: moodStore.moodRecords,
  passwords: vaultStore.records,
  moodMetadata: {
    trackingStartDate: moodStore.trackingStartDate,
    customTags: moodStore.customTags
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

  if (!isFullBackup && data.length === 0) return alert(`没有检测到可导出的${label}数据`)

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
        await Share.share({ title: `导出${label}加密备份`, url: writeResult.uri })
      } catch (e) {
        alert('导出失败：' + e.message)
      }
    } else {
      downloadAsFile(encryptedData, filename)
    }
  } catch (error) {
    alert('导出错误：' + error.message)
  }
}

const triggerImport = () => fileInputRef.value.click()

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
        const confirmed = confirm(
          `完整备份包含：\n省钱 ${counts.savings} 项、体重 ${counts.weight} 条、心情 ${counts.mood} 条、密码 ${counts.passwords} 项。\n\n继续将覆盖以上全部数据和应用设置。主密码与设备生物识别凭据不会改变。`
        )
        if (!confirmed) return
        await restoreFullBackup(snapshot)
        alert('完整数据恢复成功，主密码与设备生物识别凭据未改变')
        return
      }

      if (!Array.isArray(importedData)) throw new Error('格式错误')

      if (confirm(`成功解密出 ${importedData.length} 条${label}项目。\n确认要覆盖当前${label}数据吗？取消则执行追加。`)) {
        setDataArray(importedData, true)
      } else {
        setDataArray(importedData, false)
      }
      alert(`${label}数据恢复成功`)
    } catch (err) {
      if (exportDataType.value === 'full') {
        alert('完整备份恢复失败：文件损坏、版本不兼容或主密码不匹配')
      } else {
        alert('解密失败：主密码与当前备份包不匹配')
      }
    } finally {
      event.target.value = ''
    }
  }
  reader.readAsText(file)
}

const triggerBgUpload = () => bgInputRef.value.click()
const handleBgUpload = (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) return alert('请使用 5MB 以内的图像文件')
  const reader = new FileReader()
  reader.onload = (e) => { settingsStore.updateBg(e.target.result); alert('背景墙纸已部署') }
  reader.readAsDataURL(file)
}
const clearBg = () => { if (confirm('确认恢复系统默认背景色？')) settingsStore.updateBg('') }

const lockApp = () => { authStore.lockApp() }

// --- AI BYOK 配置测试 ---
const isTestingAI = ref(false)
const isSavingReminders = ref(false)
const isTestingNotification = ref(false)
const isRequestingExactAlarm = ref(false)
const reminderStatus = ref({ permission: 'unknown', pending: [], exactAlarm: 'unknown' })
const reminderFeedback = ref('')

const reminderStatusText = computed(() => {
  if (reminderStatus.value.permission === 'denied') return '通知权限已被拒绝，请到系统设置中开启。'
  if (reminderStatus.value.permission !== 'granted') return '尚未取得通知权限。'
  const count = reminderStatus.value.pending.length
  if (!count) return '通知权限正常，当前没有已排入系统的每日提醒。'
  const delayHint = reminderStatus.value.exactAlarm === 'denied'
    ? '；“准时提醒”权限未开启，Android 可能延迟数分钟到一小时'
    : ''
  return `通知权限正常，系统已保留 ${count} 项每日提醒${delayHint}。`
})

const refreshReminderStatus = async () => {
  try {
    reminderStatus.value = await getReminderNotificationStatus()
  } catch (error) {
    reminderStatus.value = { permission: 'unknown', pending: [], exactAlarm: 'unknown' }
    reminderFeedback.value = `无法读取系统通知状态：${error.message}`
  }
}

onMounted(refreshReminderStatus)

const enableExactReminders = async () => {
  isRequestingExactAlarm.value = true
  reminderFeedback.value = ''
  try {
    const permission = await requestExactReminderPermission()
    if (permission.exactAlarm !== 'granted') {
      reminderFeedback.value = '准时提醒权限尚未开启；提醒仍会保留，但 Android 可能延迟投递。'
      return false
    }
    await syncReminderNotifications(settingsStore.notificationSettings, {
      personalizedBodies: getPersonalizedReminderBodies(settingsStore.notificationAiContent)
    })
    reminderFeedback.value = '准时提醒权限已开启，所有每日提醒已按当前时间重新安排。'
    return true
  } catch (error) {
    reminderFeedback.value = `准时提醒权限设置失败：${error.message}`
    return false
  } finally {
    await refreshReminderStatus()
    isRequestingExactAlarm.value = false
  }
}

const saveReminderSettings = async () => {
  isSavingReminders.value = true
  reminderFeedback.value = ''
  try {
    const personalization = await refreshPersonalizedReminderContent({
      settings: settingsStore.notificationSettings,
      cache: settingsStore.notificationAiContent,
      data: {
        moodRecords: moodStore.moodRecords,
        weightRecords: weightStore.weightRecords,
        savedDebts: debtStore.savedDebts
      },
      hasApiKey: !!settingsStore.aiApiKey?.trim()
    })
    settingsStore.notificationAiContent = personalization.cache

    const result = await syncReminderNotifications(settingsStore.notificationSettings, {
      requestPermission: true,
      personalizedBodies: personalization.bodies
    })
    if (result.scheduled > 0) {
      await sendReminderSetupConfirmation(settingsStore.notificationSettings)
    }
    await refreshReminderStatus()
    if (result.scheduled > 0 && reminderStatus.value.exactAlarm === 'denied') {
      const shouldEnableExactAlarm = confirm('每日提醒已保存，但 Android 尚未允许 ForMyself 使用准时闹钟，到点通知可能延迟数分钟到一小时。\n\n是否现在前往系统设置开启“闹钟和提醒”权限？')
      if (shouldEnableExactAlarm) await enableExactReminders()
    }

    if (result.scheduled === 0) alert('所有通知提醒已关闭')
    else if (personalization.errors.length) {
      alert(`已安排 ${result.scheduled} 项每日提醒。部分 AI 文案生成失败，已使用默认关怀文案；请检查 API Key 和网络。`)
    } else if (personalization.generated > 0) {
      alert(`已安排 ${result.scheduled} 项每日提醒，并生成 ${personalization.generated} 条 AI 个性化关怀文案`)
    } else {
      alert(`已保存并安排 ${result.scheduled} 项每日提醒，系统待处理列表已校验通过`)
    }
  } catch (error) {
    if (error.code === 'NOTIFICATION_PERMISSION_DENIED') {
      alert('通知权限未开启，请在系统设置中允许 ForMyself 发送通知')
    } else {
      alert('通知提醒设置失败：' + error.message)
    }
    await refreshReminderStatus()
  } finally {
    isSavingReminders.value = false
  }
}

const testNotification = async () => {
  isTestingNotification.value = true
  reminderFeedback.value = ''
  try {
    await sendReminderTestNotification({ requestPermission: true })
    reminderFeedback.value = '测试通知已发送，请下拉通知栏确认“ForMyself 通知测试”。'
    await refreshReminderStatus()
  } catch (error) {
    reminderFeedback.value = error.code === 'NOTIFICATION_PERMISSION_DENIED'
      ? '测试失败：通知权限未开启，请到系统设置中允许通知。'
      : `测试通知发送失败：${error.message}`
  } finally {
    isTestingNotification.value = false
  }
}
const testAIConnection = async () => {
  if (!settingsStore.aiApiKey) return alert('请先填写 API Key')
  isTestingAI.value = true
  try {
    const res = await askAI('请回复"连接成功！"这四个字，不要其他内容。')
    alert('✅ AI 握手成功！\n\n' + res)
  } catch (e) {
    alert('❌ 连接失败：' + e.message)
  } finally {
    isTestingAI.value = false
  }
}
</script>

<template>
  <div class="fade-in settings-container">

    <div class="setting-section">
      <h3 class="caption body-muted section-title">主页看板文案设置</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <div class="input-group">
          <label class="caption">主标题前缀</label>
          <input v-model="localBanner.prefix" class="apple-input" placeholder="例如：你已经省下了" />
        </div>
        <div class="input-group">
          <label class="caption">主标题后缀</label>
          <input v-model="localBanner.suffix" class="apple-input" placeholder="例如：元" />
        </div>
        <div class="input-group">
          <label class="caption">主标题字体大小 (px)</label>
          <input type="number" v-model="localBanner.titleSize" class="apple-input" />
        </div>
        <button class="button-primary full-width" style="margin-top: 16px;" @click="saveBannerSettings">保存看板配置</button>
      </div>
    </div>

    <div class="setting-section">
      <h3 class="caption body-muted section-title">界面视觉</h3>
      <div class="ios-list">
        <button class="list-item text-link" style="text-align: left;" @click="triggerBgUpload">更换环境背景图片</button>
        <input type="file" accept="image/*" ref="bgInputRef" style="display: none" @change="handleBgUpload" />
        <button v-if="settingsStore.customBg" class="list-item text-link destructive" style="text-align: left;" @click="clearBg">重置回出厂设定背景</button>
      </div>
    </div>

    <div class="setting-section">
      <h3 class="caption body-muted section-title">安全管理</h3>
      <div class="ios-list" v-if="!isChangingPwd && !isChangingPwdBio">
        <button v-if="authStore.hasBiometric" class="list-item text-link" style="text-align: left;" @click="triggerBioChangePwd">指纹生物识别修改密码</button>
        <button class="list-item text-link" style="text-align: left;" @click="isChangingPwd = true">传统密码验证修改</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="lockApp">安全锁定当前空间</button>
      </div>

      <div class="store-utility-card" style="margin-top: 12px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">进入后台后自动锁定</label>
        <select v-model.number="settingsStore.autoLockDelaySeconds" class="apple-input backup-type-select">
          <option :value="0">立即锁定</option>
          <option :value="60">1 分钟后</option>
          <option :value="300">5 分钟后</option>
          <option :value="600">10 分钟后</option>
          <option :value="-1">关闭自动锁定</option>
        </select>
        <p class="caption body-muted" style="margin: 10px 0 0;">超过设定时间返回应用时，需要重新输入主密码或验证指纹。</p>
      </div>

      <div v-if="isChangingPwd || isChangingPwdBio" class="store-utility-card">
        <h4 class="body-strong" style="margin-top:0;">重设空间密码</h4>
        <div v-if="isChangingPwd" class="input-group"><input v-model="oldPwdInput" type="password" placeholder="原主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="newPwdInput" type="password" placeholder="新主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="confirmNewPwdInput" type="password" placeholder="确认新主密码" class="apple-input" /></div>
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button class="button-primary" style="flex:1" @click="isChangingPwdBio ? changeMasterPasswordBio() : changeMasterPassword()">保存</button>
          <button class="button-secondary-pill" style="flex:1" @click="isChangingPwd = false; isChangingPwdBio = false">放弃</button>
        </div>
      </div>
    </div>

    <div class="setting-section">
      <h3 class="caption body-muted section-title">内容标签与分类</h3>

      <div class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">心情日记自定义标签</h4>
        <p class="caption body-muted taxonomy-description">删除标签时会同时从历史心情记录中移除；内置标签“工作、学习、家庭、睡眠”固定保留。</p>
        <div v-if="moodStore.customTags.length" class="taxonomy-list">
          <div v-for="tag in moodStore.customTags" :key="tag" class="taxonomy-row">
            <span>{{ tag }}</span>
            <button class="text-link danger-text taxonomy-action" @click="deleteMoodTag(tag)">删除</button>
          </div>
        </div>
        <p v-else class="caption body-muted taxonomy-empty">暂无自定义心情标签</p>
      </div>

      <div class="store-utility-card taxonomy-card">
        <h4 class="body-strong taxonomy-title">密码库分类</h4>
        <p class="caption body-muted taxonomy-description">可在这里统一添加和删除分类。仍被密码记录使用的分类不能删除，“未分类”固定保留。</p>
        <div class="taxonomy-add-row">
          <input
            v-model="newVaultCategory"
            class="apple-input"
            maxlength="20"
            placeholder="输入新分类名称"
            @keyup.enter="addVaultCategory"
          />
          <button class="button-primary taxonomy-add-button" @click="addVaultCategory">添加</button>
        </div>
        <div class="taxonomy-list">
          <div v-for="category in vaultStore.categories" :key="category" class="taxonomy-row">
            <span>{{ category }}</span>
            <span class="taxonomy-row-meta">
              <span v-if="vaultCategoryUsageCount(category)" class="caption body-muted">已使用 {{ vaultCategoryUsageCount(category) }} 条</span>
              <span v-else-if="category === '未分类'" class="caption body-muted">系统保留</span>
              <button
                v-else
                class="text-link danger-text taxonomy-action"
                @click="deleteVaultCategory(category)"
              >删除</button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="setting-section">
      <h3 class="caption body-muted section-title">通知提醒</h3>
      <div class="store-utility-card reminder-card">
        <div class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">心情日记</span>
            <span class="caption body-muted">提醒记录当天的感受</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.mood.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.mood.enabled" />
              AI 根据最近心情与日记生成关怀文案
            </label>
          </div>
          <input v-model="settingsStore.notificationSettings.mood.time" type="time" class="reminder-time" :disabled="!settingsStore.notificationSettings.mood.enabled" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.mood.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">体重记录</span>
            <span class="caption body-muted">提醒在固定时间记录体重</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.weight.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.weight.enabled" />
              AI 根据最近体重记录生成关怀文案
            </label>
          </div>
          <input v-model="settingsStore.notificationSettings.weight.time" type="time" class="reminder-time" :disabled="!settingsStore.notificationSettings.weight.enabled" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.weight.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <div class="reminder-row">
          <div class="reminder-copy">
            <span class="body-strong">省钱计划</span>
            <span class="caption body-muted">提醒查看目标和记录存款</span>
            <label class="ai-reminder-option">
              <input v-model="settingsStore.notificationSettings.savings.useAI" type="checkbox" :disabled="!settingsStore.notificationSettings.savings.enabled" />
              AI 根据最近省钱计划生成鼓励文案
            </label>
          </div>
          <input v-model="settingsStore.notificationSettings.savings.time" type="time" class="reminder-time" :disabled="!settingsStore.notificationSettings.savings.enabled" />
          <label class="switch-control">
            <input v-model="settingsStore.notificationSettings.savings.enabled" type="checkbox" />
            <span></span>
          </label>
        </div>

        <button class="button-primary full-width reminder-save" :disabled="isSavingReminders" @click="saveReminderSettings">
          {{ isSavingReminders ? '正在安排提醒…' : '保存通知提醒' }}
        </button>
        <button class="button-secondary-pill full-width reminder-test" :disabled="isTestingNotification" @click="testNotification">
          {{ isTestingNotification ? '正在发送测试通知…' : '发送一条测试通知' }}
        </button>
        <button
          v-if="reminderStatus.permission === 'granted' && reminderStatus.exactAlarm === 'denied' && reminderStatus.pending.length"
          class="button-secondary-pill full-width reminder-exact"
          :disabled="isRequestingExactAlarm"
          @click="enableExactReminders"
        >
          {{ isRequestingExactAlarm ? '正在打开系统设置…' : '开启准时提醒权限' }}
        </button>
        <div class="reminder-status" :class="{ warning: reminderStatus.permission === 'denied' || reminderStatus.exactAlarm === 'denied' }">
          <strong>系统状态</strong>
          <span>{{ reminderStatusText }}</span>
          <span v-if="reminderFeedback">{{ reminderFeedback }}</span>
        </div>
        <p class="caption body-muted reminder-note">普通提醒完全在设备本地调度。划掉最近任务或重启手机后仍可提醒；但在系统设置中“强制停止”应用会让 Android 删除全部闹钟，需重新打开 ForMyself 恢复。部分品牌手机还需允许自启动和后台运行。开启 AI 后，仅对应模块的最近记录会发送给你配置的 AI 服务。</p>
      </div>
    </div>

    <div class="setting-section">
      <h3 class="caption body-muted section-title">数据备份</h3>

      <div class="store-utility-card" style="margin-top: 8px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">选择要操作的数据类型</label>
        <select v-model="exportDataType" class="apple-input backup-type-select">
          <option value="full">完整数据（全部数据与设置）</option>
          <option value="savings">省钱数据</option>
          <option value="weight">体重数据</option>
          <option value="mood">心情数据</option>
          <option value="passwords">密码库数据</option>
        </select>
      </div>

      <div class="ios-list" style="margin-top: 8px;">
        <button class="list-item text-link" style="text-align: left;" @click="exportJSON">
          导出{{ getDataTypeLabel() }}加密备份 (.json)
        </button>
        <button class="list-item text-link" style="text-align: left;" @click="triggerImport">
          导入{{ getDataTypeLabel() }}数据还原
        </button>
        <input type="file" accept=".json" ref="fileInputRef" style="display: none" @change="handleFileUpload" />
      </div>
      <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">完整备份包含四类数据、应用设置和 API Key，并由当前主密码进行 AES 加密；不会包含主密码或设备生物识别凭据。仍可选择单项备份并保持原有格式。</p>
    </div>

    <!-- AI 情绪陪伴引擎 -->
    <div class="setting-section">
      <h3 class="caption body-muted section-title">🤖 AI 情绪陪伴 (BYOK)</h3>
      <div class="store-utility-card" style="margin-top: 8px;">
        <p class="caption body-muted" style="margin: 0 0 16px 0;">自备 Key 接入，数据仅限本机流转，绝对隐私。兼容 DeepSeek / OpenAI / 通义千问等标准 API。</p>
        <div class="input-group">
          <label class="caption">API 接口地址</label>
          <input v-model="settingsStore.aiProviderUrl" type="text" class="apple-input" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">API Key</label>
          <input v-model="settingsStore.aiApiKey" type="password" class="apple-input" placeholder="sk-..." autocomplete="off" spellcheck="false" />
        </div>
        <div class="input-group">
          <label class="caption">模型名称</label>
          <input v-model="settingsStore.aiModel" type="text" class="apple-input" placeholder="deepseek-chat / gpt-4o-mini" autocomplete="off" spellcheck="false" />
        </div>
        <button class="button-primary full-width" style="margin-top: 8px;" :disabled="isTestingAI" @click="testAIConnection">
          {{ isTestingAI ? '⏳ 连接测试中...' : '⚡ 测试 AI 握手' }}
        </button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.settings-container { display: flex; flex-direction: column; gap: 32px; }
.setting-section { display: flex; flex-direction: column; }
.section-title { padding: 0 16px; margin-bottom: 8px; text-transform: uppercase; }

.ios-list { background: var(--canvas); border-radius: 12px; border: 1px solid var(--hairline); overflow: hidden; display: flex; flex-direction: column;}
.list-item { padding: 16px; background: transparent; border: none; border-bottom: 1px solid var(--divider-soft); font-size: 17px; cursor: pointer; color: var(--ink); width: 100%;}
.list-item:last-child { border-bottom: none; }
.list-item:active { background: var(--surface-pearl); }

.text-link.destructive { color: #ff3b30; }
.danger-text { color: #d92d20; }
.input-group { margin-bottom: 12px; }
.store-utility-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-top: 8px; }
.taxonomy-card + .taxonomy-card { margin-top: 12px; }
.taxonomy-title { margin: 0; }
.taxonomy-description { margin: 8px 0 16px; line-height: 1.55; }
.taxonomy-empty { margin: 0; padding: 12px 0 2px; }
.taxonomy-add-row { display: flex; gap: 10px; margin-bottom: 14px; }
.taxonomy-add-row .apple-input { flex: 1; min-width: 0; }
.taxonomy-add-button { flex-shrink: 0; padding-inline: 18px; }
.taxonomy-list { overflow: hidden; border: 1px solid var(--hairline); border-radius: 12px; }
.taxonomy-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 10px 14px; border-bottom: 1px solid var(--divider-soft); }
.taxonomy-row:last-child { border-bottom: 0; }
.taxonomy-row-meta { display: flex; align-items: center; gap: 10px; text-align: right; }
.taxonomy-action { flex-shrink: 0; }

.backup-type-select { appearance: auto; cursor: pointer; }
.reminder-card { padding: 0; overflow: hidden; }
.reminder-row { display: flex; align-items: center; gap: 12px; min-height: 92px; padding: 14px 16px; border-bottom: 1px solid var(--divider-soft); }
.reminder-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.reminder-time { width: 92px; padding: 8px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-pearl); color: var(--ink); font: inherit; }
.reminder-time:disabled { opacity: .45; }
.ai-reminder-option { display: flex; align-items: flex-start; gap: 6px; margin-top: 3px; color: var(--primary); font-size: 12px; line-height: 1.35; }
.ai-reminder-option input { width: 14px; height: 14px; margin: 1px 0 0; accent-color: var(--primary); flex-shrink: 0; }
.ai-reminder-option:has(input:disabled) { opacity: .45; }
.switch-control { position: relative; width: 48px; height: 28px; flex-shrink: 0; }
.switch-control input { position: absolute; opacity: 0; pointer-events: none; }
.switch-control span { position: absolute; inset: 0; border-radius: 999px; background: #d1d1d6; transition: background .2s; cursor: pointer; }
.switch-control span::after { content: ''; position: absolute; width: 24px; height: 24px; top: 2px; left: 2px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .2s; }
.switch-control input:checked + span { background: var(--primary); }
.switch-control input:checked + span::after { transform: translateX(20px); }
.reminder-save { margin: 16px; width: calc(100% - 32px); }
.reminder-test { margin: 0 16px 12px; width: calc(100% - 32px); }
.reminder-exact { margin: 0 16px 12px; width: calc(100% - 32px); }
.reminder-status { display: flex; flex-direction: column; gap: 4px; margin: 0 16px 12px; padding: 12px; border-radius: 12px; background: var(--surface-pearl); color: var(--ink); font-size: 13px; line-height: 1.45; }
.reminder-status.warning { color: #b42318; background: #fff1f0; }
.reminder-note { margin: 0; padding: 0 16px 16px; text-align: center; }
@media (max-width: 480px) {
  .reminder-row { gap: 8px; }
  .reminder-time { width: 82px; font-size: 14px; }
}
</style>
