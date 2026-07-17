<script setup>
import { computed, ref } from 'vue'
import { usePasswordVaultStore } from '../stores/passwordVault'

const vaultStore = usePasswordVaultStore()
const searchQuery = ref('')
const visibleIds = ref(new Set())
const showEditor = ref(false)
const editingId = ref(null)
const form = ref({ appName: '', account: '', password: '', extraFields: [] })

const filteredRecords = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) return vaultStore.records
  return vaultStore.records.filter((record) =>
    record.appName.toLowerCase().includes(keyword) ||
    record.account.toLowerCase().includes(keyword)
  )
})

const openAdd = () => {
  editingId.value = null
  form.value = { appName: '', account: '', password: '', extraFields: [] }
  showEditor.value = true
}

const openEdit = (record) => {
  editingId.value = record.id
  form.value = JSON.parse(JSON.stringify(record))
  showEditor.value = true
}

const saveRecord = () => {
  if (!form.value.appName.trim()) return alert('请填写软件或网站名称')
  if (editingId.value) vaultStore.updateRecord(editingId.value, form.value)
  else vaultStore.addRecord(form.value)
  showEditor.value = false
}

const deleteRecord = (record) => {
  if (confirm(`确认删除“${record.appName}”的密码记录？`)) vaultStore.deleteRecord(record.id)
}

const toggleVisibility = (id) => {
  const next = new Set(visibleIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  visibleIds.value = next
}

const copyText = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text || '')
    alert(`${label}已复制`)
  } catch (error) {
    alert('复制失败，请长按内容手动复制')
  }
}

const addExtraField = () => form.value.extraFields.push({ fieldName: '', fieldValue: '' })
const removeExtraField = (index) => form.value.extraFields.splice(index, 1)
</script>

<template>
  <div class="vault-view fade-in">
    <div class="vault-toolbar">
      <input v-model="searchQuery" class="apple-input" placeholder="搜索软件名称或账号" />
      <button class="button-primary add-password-btn" @click="openAdd">添加</button>
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
          <div>
            <h3>{{ record.appName }}</h3>
            <p class="caption body-muted">{{ record.account || '未填写账号' }}</p>
          </div>
          <div class="password-card-actions">
            <button class="text-link compact-action" @click="openEdit(record)">编辑</button>
            <button class="text-link compact-action danger-text" @click="deleteRecord(record)">删除</button>
          </div>
        </div>

        <div class="secret-row">
          <span class="secret-value">{{ visibleIds.has(record.id) ? record.password || '未填写密码' : '••••••••••••' }}</span>
          <button class="secret-action" @click="toggleVisibility(record.id)">{{ visibleIds.has(record.id) ? '隐藏' : '显示' }}</button>
          <button class="secret-action" @click="copyText(record.password, '密码')">复制</button>
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
      <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
        <div class="vault-editor glass-card">
          <h3 class="tagline">{{ editingId ? '编辑密码记录' : '添加密码记录' }}</h3>
          <div class="vault-form">
            <label>软件或网站名称</label>
            <input v-model="form.appName" class="apple-input" placeholder="例如：微信、GitHub" />
            <label>登录账号</label>
            <input v-model="form.account" class="apple-input" placeholder="手机号、邮箱或用户名" />
            <label>登录密码</label>
            <input v-model="form.password" class="apple-input" type="password" placeholder="输入密码" />

            <div v-for="(field, index) in form.extraFields" :key="index" class="extra-field-editor">
              <input v-model="field.fieldName" class="apple-input" placeholder="字段名称" />
              <input v-model="field.fieldValue" class="apple-input" placeholder="字段内容" />
              <button class="remove-field-btn" @click="removeExtraField(index)">移除</button>
            </div>
          </div>
          <button class="text-link add-field-link" @click="addExtraField">＋ 添加附加字段</button>
          <div class="editor-actions">
            <button class="button-secondary-pill" @click="showEditor = false">取消</button>
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
.vault-warning { padding: 14px 16px; margin-bottom: 16px; border-radius: 12px; color: #b42318; background: #fef3f2; }
.glass-card { background: rgba(255,255,255,.88); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.75); box-shadow: 0 8px 28px rgba(0,0,0,.06); }
.empty-vault { padding: 44px 24px; border-radius: 20px; text-align: center; }
.empty-vault-icon { font-size: 42px; margin-bottom: 12px; }
.empty-vault h3 { margin: 0 0 8px; }
.empty-vault p { margin: 0 0 22px; }
.vault-list { display: grid; gap: 16px; }
.password-card { padding: 20px; border-radius: 18px; }
.password-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.password-card h3 { margin: 0 0 5px; font-size: 19px; }
.password-card p { margin: 0; }
.password-card-actions { display: flex; gap: 12px; }
.compact-action { font-size: 14px; }
.danger-text { color: #d92d20; }
.secret-row { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding: 12px 14px; background: var(--surface-pearl); border-radius: 12px; }
.secret-value { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; user-select: text; -webkit-user-select: text; }
.secret-action { padding: 5px 8px; border: 0; background: transparent; color: var(--primary); font-size: 14px; cursor: pointer; }
.copy-account-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 2px 0; }
.extra-info-list { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--divider-soft); }
.extra-info-row { display: grid; grid-template-columns: 100px 1fr; gap: 12px; padding: 6px 0; }
.extra-info-value { word-break: break-all; user-select: text; -webkit-user-select: text; }
.modal-overlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.28); backdrop-filter: blur(5px); }
.vault-editor { width: min(520px, 100%); max-height: 85dvh; overflow-y: auto; padding: 24px; border-radius: 22px; }
.vault-form { display: grid; gap: 9px; margin-top: 22px; }
.vault-form label { margin-top: 7px; font-size: 14px; font-weight: 600; }
.extra-field-editor { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-top: 8px; }
.remove-field-btn { border: 0; background: transparent; color: #d92d20; cursor: pointer; }
.add-field-link { margin-top: 16px; }
.editor-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
@media (max-width: 520px) {
  .password-card-header { flex-direction: column; }
  .extra-field-editor { grid-template-columns: 1fr; }
  .secret-row { flex-wrap: wrap; }
  .secret-value { flex-basis: 100%; }
}
</style>
