<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { usePasswordVaultStore } from '../stores/passwordVault'
import {
  DEFAULT_VAULT_CATEGORY,
  compareVaultRecords
} from '../services/passwordVaultRecords.js'
import { VAULT_ACCESS_RESULT, verifyVaultSecretAccess } from '../services/vaultAccessGuard.js'
import { appAlert, appConfirm, appToast } from '../services/uiFeedback'

const vaultStore = usePasswordVaultStore()
const searchQuery = ref('')
const categoryFilter = ref('all')
const favoritesOnly = ref(false)
const visibleIds = ref(new Set())
const verifyingId = ref(null)
const showEditor = ref(false)
const editingId = ref(null)
const filterMenuOpen = ref(false)
const editorCategoryMenuOpen = ref(false)
const form = ref({ appName: '', account: '', password: '', category: DEFAULT_VAULT_CATEGORY, favorite: false, extraFields: [] })
const visibilityTimers = new Map()

const availableCategories = computed(() => vaultStore.categories)
const categoryFilterLabel = computed(() => categoryFilter.value === 'all' ? '全部分类' : categoryFilter.value)
const editorCategoryOptions = computed(() => [
  form.value.category,
  ...availableCategories.value.filter(category => category !== form.value.category)
])

watch(availableCategories, categories => {
  if (categoryFilter.value !== 'all' && !categories.includes(categoryFilter.value)) categoryFilter.value = 'all'
})

const filteredRecords = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  return vaultStore.records
    .filter(record => categoryFilter.value === 'all' || record.category === categoryFilter.value)
    .filter(record => !favoritesOnly.value || record.favorite)
    .filter(record => !keyword ||
      record.appName.toLowerCase().includes(keyword) ||
      record.account.toLowerCase().includes(keyword) ||
      record.category.toLowerCase().includes(keyword)
    )
    .sort(compareVaultRecords)
})

const openAdd = () => {
  editingId.value = null
  form.value = { appName: '', account: '', password: '', category: DEFAULT_VAULT_CATEGORY, favorite: false, extraFields: [] }
  editorCategoryMenuOpen.value = false
  showEditor.value = true
}

const openEdit = (record) => {
  editingId.value = record.id
  form.value = JSON.parse(JSON.stringify(record))
  editorCategoryMenuOpen.value = false
  showEditor.value = true
}

const closeEditor = () => {
  editorCategoryMenuOpen.value = false
  showEditor.value = false
}

const selectFilterCategory = (category) => {
  categoryFilter.value = category
  filterMenuOpen.value = false
}

const selectEditorCategory = (category) => {
  form.value.category = category
  editorCategoryMenuOpen.value = false
}

const saveRecord = () => {
  if (!form.value.appName.trim()) return appAlert('请填写软件或网站名称')
  if (editingId.value) vaultStore.updateRecord(editingId.value, form.value)
  else vaultStore.addRecord(form.value)
  closeEditor()
}

const deleteRecord = async (record) => {
  if (await appConfirm(`“${record.appName}”的账号、密码和附加字段都会被移除。`, {
    title: '删除密码记录？',
    destructive: true
  })) {
    hideSecret(record.id)
    vaultStore.deleteRecord(record.id)
  }
}

const hideSecret = (id) => {
  const next = new Set(visibleIds.value)
  next.delete(id)
  visibleIds.value = next
  clearTimeout(visibilityTimers.get(id))
  visibilityTimers.delete(id)
}

const hideAllSecrets = () => {
  visibleIds.value = new Set()
  visibilityTimers.forEach(timer => clearTimeout(timer))
  visibilityTimers.clear()
}

const requestBiometricAccess = async (record, action) => {
  if (verifyingId.value) return false
  verifyingId.value = record.id
  const result = await verifyVaultSecretAccess({
    checkAvailability: async () => {
      if (!Capacitor.isNativePlatform()) return { isAvailable: false }
      return NativeBiometric.isAvailable({ useFallback: false })
    },
    verifyIdentity: () => NativeBiometric.verifyIdentity({
      title: '密码库安全验证',
      subtitle: record.appName || '密码记录',
      reason: action === 'copy' ? '验证身份后复制密码' : '验证身份后查看密码',
      description: '这是一次独立验证，不会使用主密码自动跳过。',
      negativeButtonText: '取消',
      useFallback: false,
      maxAttempts: 3
    })
  })
  verifyingId.value = null

  if (result.granted) return true
  if (result.code === VAULT_ACCESS_RESULT.BIOMETRIC_UNAVAILABLE) {
    appAlert('设备尚未启用可用的生物识别，请先在系统设置中录入指纹或面容。')
  } else {
    appAlert('生物识别未通过，密码仍保持隐藏。')
  }
  return false
}

const toggleVisibility = async (record) => {
  if (visibleIds.value.has(record.id)) {
    hideSecret(record.id)
    return
  }
  if (!await requestBiometricAccess(record, 'view')) return
  visibleIds.value = new Set([...visibleIds.value, record.id])
  visibilityTimers.set(record.id, setTimeout(() => hideSecret(record.id), 30000))
}

const copyText = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text || '')
    appToast(`${label}已复制`, { tone: 'success' })
  } catch (error) {
    appAlert('复制失败，请长按内容手动复制')
  }
}

const copyPassword = async (record) => {
  if (!await requestBiometricAccess(record, 'copy')) return
  await copyText(record.password, '密码')
}

const toggleFavorite = record => vaultStore.toggleFavorite(record.id)

const addExtraField = () => form.value.extraFields.push({ fieldName: '', fieldValue: '' })
const removeExtraField = (index) => form.value.extraFields.splice(index, 1)

const handleVisibilityChange = () => {
  if (document.hidden) hideAllSecrets()
}

const handleOutsidePointer = (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.vault-select')) {
    filterMenuOpen.value = false
    editorCategoryMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('pointerdown', handleOutsidePointer)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('pointerdown', handleOutsidePointer)
  hideAllSecrets()
})
</script>

<template>
  <div class="vault-view fade-in">
    <div class="vault-toolbar">
      <input v-model="searchQuery" class="apple-input" placeholder="搜索名称、账号或分类" />
      <button class="button-primary add-password-btn" @click="openAdd">添加</button>
    </div>

    <div class="vault-filters">
      <div class="vault-select category-filter" :class="{ open: filterMenuOpen }">
        <button
          type="button"
          class="custom-select-trigger"
          aria-haspopup="listbox"
          :aria-expanded="filterMenuOpen"
          @click="filterMenuOpen = !filterMenuOpen"
        >
          <span class="select-leading select-leading-filter">▦</span>
          <span class="select-copy">
            <small>分类筛选</small>
            <strong>{{ categoryFilterLabel }}</strong>
          </span>
          <svg class="select-chevron" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
        <div v-if="filterMenuOpen" class="custom-select-menu" role="listbox">
          <button
            type="button"
            class="custom-select-option"
            :class="{ selected: categoryFilter === 'all' }"
            role="option"
            :aria-selected="categoryFilter === 'all'"
            @click="selectFilterCategory('all')"
          >
            <span class="option-icon">▦</span>
            <span>全部分类</span>
            <span class="option-check">✓</span>
          </button>
          <button
            v-for="category in availableCategories"
            :key="category"
            type="button"
            class="custom-select-option"
            :class="{ selected: categoryFilter === category }"
            role="option"
            :aria-selected="categoryFilter === category"
            @click="selectFilterCategory(category)"
          >
            <span class="option-icon option-initial">{{ category.slice(0, 1) }}</span>
            <span>{{ category }}</span>
            <span class="option-check">✓</span>
          </button>
        </div>
      </div>
      <button class="favorite-filter" :class="{ active: favoritesOnly }" @click="favoritesOnly = !favoritesOnly">
        {{ favoritesOnly ? '★ 仅看收藏' : '☆ 仅看收藏' }}
      </button>
    </div>

    <div v-if="vaultStore.loadError" class="vault-warning">{{ vaultStore.loadError }}</div>

    <div v-if="vaultStore.records.length === 0" class="empty-vault glass-card">
      <div class="empty-vault-icon">🔐</div>
      <h3 class="body-strong">密码库还是空的</h3>
      <p class="caption body-muted">添加账号密码后，数据会使用主密码加密保存在设备中。</p>
      <button class="button-primary" @click="openAdd">添加第一条记录</button>
    </div>

    <div v-else-if="filteredRecords.length === 0" class="empty-vault glass-card">
      <p class="body-muted">没有找到匹配的密码记录。</p>
    </div>

    <div v-else class="vault-list">
      <article v-for="record in filteredRecords" :key="record.id" class="password-card glass-card">
        <div class="password-card-header">
          <div class="password-title-wrap">
            <button class="favorite-button" :class="{ active: record.favorite }" :aria-label="record.favorite ? '取消收藏' : '收藏'" @click="toggleFavorite(record)">
              {{ record.favorite ? '★' : '☆' }}
            </button>
            <div>
              <h3>{{ record.appName }}</h3>
              <span class="category-badge">{{ record.category }}</span>
            </div>
            <p class="caption body-muted">{{ record.account || '未填写账号' }}</p>
          </div>
          <div class="password-card-actions">
            <button class="text-link compact-action" @click="openEdit(record)">编辑</button>
            <button class="text-link compact-action danger-text" @click="deleteRecord(record)">删除</button>
          </div>
        </div>

        <div class="secret-row">
          <span class="secret-value">{{ visibleIds.has(record.id) ? record.password || '未填写密码' : '••••••••••••' }}</span>
          <button class="secret-action" :disabled="verifyingId === record.id" @click="toggleVisibility(record)">
            {{ verifyingId === record.id ? '验证中…' : visibleIds.has(record.id) ? '隐藏' : '显示' }}
          </button>
          <button class="secret-action" :disabled="verifyingId === record.id" @click="copyPassword(record)">复制</button>
        </div>

        <div v-if="record.account" class="copy-account-row">
          <span class="caption">账号：{{ record.account }}</span>
          <button class="text-link caption" @click="copyText(record.account, '账号')">复制</button>
        </div>

        <div v-if="record.extraFields.length" class="extra-info-list">
          <div v-for="(field, index) in record.extraFields" :key="index" class="extra-info-row">
            <span class="caption body-muted">{{ field.fieldName || '附加字段' }}</span>
            <span class="extra-info-value">{{ field.fieldValue }}</span>
          </div>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <div v-if="showEditor" class="modal-overlay" @click.self="closeEditor">
        <div class="vault-editor glass-card">
          <h3 class="tagline">{{ editingId ? '编辑密码记录' : '添加密码记录' }}</h3>
          <div class="vault-form">
            <label>软件或网站名称</label>
            <input v-model="form.appName" class="apple-input" placeholder="例如：微信、GitHub" />
            <label>登录账号</label>
            <input v-model="form.account" class="apple-input" placeholder="手机号、邮箱或用户名" />
            <label>登录密码</label>
            <input v-model="form.password" class="apple-input" type="password" placeholder="输入密码" />
            <label>分类</label>
            <div class="vault-select editor-category-select" :class="{ open: editorCategoryMenuOpen }">
              <button
                type="button"
                class="custom-select-trigger editor-select-trigger"
                aria-haspopup="listbox"
                :aria-expanded="editorCategoryMenuOpen"
                @click="editorCategoryMenuOpen = !editorCategoryMenuOpen"
              >
                <span class="select-leading option-initial">{{ form.category.slice(0, 1) }}</span>
                <span class="select-copy">
                  <small>保存到分类</small>
                  <strong>{{ form.category }}</strong>
                </span>
                <svg class="select-chevron" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5 7.5 5 5 5-5" />
                </svg>
              </button>
              <div v-if="editorCategoryMenuOpen" class="custom-select-menu editor-select-menu" role="listbox">
                <button
                  v-for="category in editorCategoryOptions"
                  :key="category"
                  type="button"
                  class="custom-select-option"
                  :class="{ selected: form.category === category }"
                  role="option"
                  :aria-selected="form.category === category"
                  @click="selectEditorCategory(category)"
                >
                  <span class="option-icon option-initial">{{ category.slice(0, 1) }}</span>
                  <span>{{ category }}</span>
                  <span class="option-check">✓</span>
                </button>
              </div>
            </div>
            <label class="favorite-editor-option">
              <input v-model="form.favorite" type="checkbox" />
              收藏这条记录
            </label>

            <div v-for="(field, index) in form.extraFields" :key="index" class="extra-field-editor">
              <input v-model="field.fieldName" class="apple-input" placeholder="字段名称" />
              <input v-model="field.fieldValue" class="apple-input" placeholder="字段内容" />
              <button class="remove-field-btn" @click="removeExtraField(index)">移除</button>
            </div>
          </div>
          <button class="text-link add-field-link" @click="addExtraField">＋ 添加附加字段</button>
          <div class="editor-actions">
            <button class="button-secondary-pill" @click="closeEditor">取消</button>
            <button class="button-primary" @click="saveRecord">保存记录</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.vault-toolbar { display: flex; gap: 12px; margin-bottom: 20px; }
.vault-toolbar .apple-input { flex: 1; }
.add-password-btn { flex-shrink: 0; }
.vault-filters { display: flex; gap: 10px; margin: -8px 0 20px; }
.category-filter { flex: 1; min-width: 0; }
.vault-select { position: relative; }
.custom-select-trigger { display: grid; grid-template-columns: 38px minmax(0, 1fr) 20px; gap: 11px; align-items: center; width: 100%; min-height: 58px; padding: 9px 13px 9px 10px; text-align: left; color: var(--ink); border: 1px solid #dfe3ea; border-radius: 16px; background: rgba(255,255,255,.9); box-shadow: 0 6px 18px rgba(36,50,70,.055); cursor: pointer; transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
.custom-select-trigger:active { transform: scale(.985); }
.vault-select.open .custom-select-trigger { border-color: rgba(0,102,204,.62); box-shadow: 0 0 0 4px rgba(0,102,204,.1), 0 9px 24px rgba(36,50,70,.08); }
.select-leading { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 13px; background: linear-gradient(145deg, #eaf4ff, #dcecff); color: var(--primary); font-size: 17px; font-weight: 700; }
.select-leading-filter { font-size: 19px; }
.select-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.select-copy small { color: var(--body-muted); font-size: 10px; line-height: 1.2; }
.select-copy strong { overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.select-chevron { width: 20px; height: 20px; fill: none; stroke: #7c8492; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: transform .2s ease; }
.vault-select.open .select-chevron { transform: rotate(180deg); }
.custom-select-menu { position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 80; max-height: 270px; overflow-y: auto; padding: 7px; border: 1px solid rgba(215,220,229,.92); border-radius: 18px; background: rgba(255,255,255,.995); box-shadow: 0 20px 50px rgba(25,36,54,.18); backdrop-filter: blur(24px) saturate(170%); -webkit-backdrop-filter: blur(24px) saturate(170%); animation: selectMenuIn .18s ease-out; }
.custom-select-option { display: grid; grid-template-columns: 32px minmax(0, 1fr) 20px; gap: 10px; align-items: center; width: 100%; min-height: 44px; padding: 6px 9px; text-align: left; color: var(--ink); border: 0; border-radius: 12px; background: transparent; font-size: 14px; cursor: pointer; }
.custom-select-option + .custom-select-option { margin-top: 2px; }
.custom-select-option:active { background: #f2f4f7; }
.custom-select-option.selected { background: #edf6ff; color: var(--primary); font-weight: 650; }
.option-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: #f1f4f8; color: #667085; font-size: 15px; font-weight: 700; }
.custom-select-option.selected .option-icon { background: #dceeff; color: var(--primary); }
.option-initial { font-size: 13px; }
.option-check { color: transparent; font-size: 15px; font-weight: 750; }
.custom-select-option.selected .option-check { color: var(--primary); }
.favorite-filter { flex-shrink: 0; min-height: 58px; padding: 10px 15px; border: 1px solid #dfe3ea; border-radius: 16px; background: rgba(255,255,255,.9); color: var(--body-muted); box-shadow: 0 6px 18px rgba(36,50,70,.04); cursor: pointer; }
.favorite-filter.active { border-color: #f5b800; background: #fff8dc; color: #8a6200; font-weight: 600; }
.vault-warning { padding: 14px 16px; margin-bottom: 16px; border-radius: 12px; color: #b42318; background: #fef3f2; }
.glass-card { background: rgba(255,255,255,.88); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.75); box-shadow: 0 8px 28px rgba(0,0,0,.06); }
.empty-vault { padding: 44px 24px; border-radius: 20px; text-align: center; }
.empty-vault-icon { font-size: 42px; margin-bottom: 12px; }
.empty-vault h3 { margin: 0 0 8px; }
.empty-vault p { margin: 0 0 22px; }
.vault-list { display: grid; gap: 16px; }
.password-card { padding: 20px; border-radius: 18px; }
.password-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.password-title-wrap { display: grid; grid-template-columns: auto 1fr; column-gap: 9px; align-items: start; }
.password-title-wrap > p { grid-column: 2; margin-top: 5px; }
.favorite-button { grid-row: 1 / span 2; padding: 0; border: 0; background: transparent; color: var(--body-muted); font-size: 24px; line-height: 1; cursor: pointer; }
.favorite-button.active { color: #f5b800; }
.category-badge { display: inline-flex; margin-top: 4px; padding: 3px 8px; border-radius: 999px; background: rgba(0,102,204,.09); color: var(--primary); font-size: 11px; font-weight: 600; }
.password-card h3 { margin: 0 0 5px; font-size: 19px; }
.password-card p { margin: 0; }
.password-card-actions { display: flex; gap: 12px; }
.compact-action { font-size: 14px; }
.danger-text { color: #d92d20; }
.secret-row { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding: 12px 14px; background: var(--surface-pearl); border-radius: 12px; }
.secret-value { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; user-select: text; -webkit-user-select: text; }
.secret-action { padding: 5px 8px; border: 0; background: transparent; color: var(--primary); font-size: 14px; cursor: pointer; }
.secret-action:disabled { opacity: .5; cursor: wait; }
.copy-account-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 2px 0; }
.extra-info-list { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--divider-soft); }
.extra-info-row { display: grid; grid-template-columns: 100px 1fr; gap: 12px; padding: 6px 0; }
.extra-info-value { word-break: break-all; user-select: text; -webkit-user-select: text; }
.modal-overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.28); backdrop-filter: blur(5px); }
.vault-editor { width: min(520px, 100%); max-height: 85dvh; overflow-y: auto; padding: 24px; border-radius: 22px; }
.vault-form { display: grid; gap: 9px; margin-top: 22px; }
.vault-form label { margin-top: 7px; font-size: 14px; font-weight: 600; }
.editor-select-trigger { min-height: 64px; border-radius: 15px; }
.editor-select-menu { position: static; max-height: 228px; margin-top: 8px; box-shadow: 0 12px 30px rgba(25,36,54,.13); }
.vault-form .favorite-editor-option { display: flex; align-items: center; gap: 9px; font-weight: 500; }
.extra-field-editor { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-top: 8px; }
.remove-field-btn { border: 0; background: transparent; color: #d92d20; cursor: pointer; }
.add-field-link { margin-top: 16px; }
.editor-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
@keyframes selectMenuIn { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 520px) {
  .vault-filters { align-items: stretch; }
  .password-card-header { flex-direction: column; }
  .extra-field-editor { grid-template-columns: 1fr; }
  .secret-row { flex-wrap: wrap; }
  .secret-value { flex-basis: 100%; }
}
</style>
