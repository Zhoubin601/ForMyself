<script setup>
import { Capacitor } from '@capacitor/core'
import { ref, watch } from 'vue'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import CryptoJS from 'crypto-js'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { askAI } from '../services/aiEngine'

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

const exportDataType = ref('savings')

// --- 看板设置 ---
const localBanner = ref({ ...settingsStore.bannerSettings })

watch(() => settingsStore.bannerSettings, (newVal) => {
  if (newVal) localBanner.value = { ...newVal }
}, { deep: true, immediate: true })

const saveBannerSettings = () => {
  settingsStore.updateBanner({ ...localBanner.value })
  alert('看板配置已保存生效！')
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
  return { savings: '省钱', weight: '体重', mood: '心情', passwords: '密码库' }[exportDataType.value]
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
  return { savings: 'Savings', weight: 'Weight', mood: 'Mood', passwords: 'Passwords' }[exportDataType.value]
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
  const dataArray = getDataArray()

  if (dataArray.length === 0) return alert(`没有检测到可导出的${label}数据`)

  try {
    const rawData = JSON.stringify(dataArray)
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
  reader.onload = (e) => {
    try {
      const encryptedContent = e.target.result
      const bytes = CryptoJS.AES.decrypt(encryptedContent, authStore.savedMasterPwd)
      const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
      if (!decryptedData) throw new Error('密码错误')
      const importedData = JSON.parse(decryptedData)
      if (!Array.isArray(importedData)) throw new Error('格式错误')
      const label = getDataTypeLabel()

      if (confirm(`成功解密出 ${importedData.length} 条${label}项目。\n确认要覆盖当前${label}数据吗？取消则执行追加。`)) {
        setDataArray(importedData, true)
      } else {
        setDataArray(importedData, false)
      }
      alert(`${label}数据恢复成功`)
    } catch (err) {
      alert('解密失败：主密码与当前备份包不匹配')
    }
    event.target.value = ''
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
      <h3 class="caption body-muted section-title">数据备份</h3>

      <div class="store-utility-card" style="margin-top: 8px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">选择要操作的数据类型</label>
        <select v-model="exportDataType" class="apple-input backup-type-select">
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
      <p class="caption body-muted" style="padding: 12px 16px; margin: 0;">四类数据分别生成独立备份文件，并由当前主密码进行 AES 加密。</p>
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
.input-group { margin-bottom: 12px; }
.store-utility-card { background: var(--canvas); border: 1px solid var(--hairline); border-radius: 18px; padding: 24px; margin-top: 8px; }

.backup-type-select { appearance: auto; cursor: pointer; }
</style>
