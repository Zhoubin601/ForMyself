<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { appChoose, appConfirm, cancelOwnedFeedbackDialog } from '../../../services/uiFeedback.js'
import { registerBackHandler } from '../../../services/backNavigation.js'
import { parseCharacterCardFile, parseCharacterAvatar } from './characterCardImport.js'
import { previewKanataCardSync } from '../domain/kanataManagementCore.js'
import { useKanataFilePicker } from './useKanataFilePicker.js'

const props = defineProps({ data: { type: Object, required: true }, management: { type: Object, required: true }, blocked: Boolean })
const emit = defineEmits(['message'])
const selectedId = ref(''), preview = ref(null), editing = ref(false), draft = ref(null), busy = ref(false), error = ref(''), summary = ref('')
const nameInput = ref(null), versionWhenEditing = ref(''), anchorsText = ref(''), rawVisible = ref(false)
const picker = useKanataFilePicker(), avatarPicker = useKanataFilePicker()
const cardInput = picker.input, avatarInput = avatarPicker.input
const dialogOwner = Symbol('kanata-management-dialog')
let mounted = true, revision = 0, confirming = false
const cards = computed(() => props.data.cards)
const selected = computed(() => cards.value.find(c => c.id === selectedId.value))
const current = computed(() => props.data.cardVersions.find(v => v.id === selected.value?.currentVersionId))
watch(() => cards.value.map(c => c.id).join('|'), () => { if (!selected.value) selectedId.value = cards.value[0]?.id || '' }, { immediate: true })
const raw = computed(() => current.value ? JSON.stringify(current.value.rawData, null, 2) : '')
const creatorNotes = computed(() => current.value?.rawData?.data?.creator_notes || '')
const cancelEdit = () => { editing.value = false; draft.value = null; preview.value = null; revision++ }
const unregister = registerBackHandler(() => { cancelEdit(); return true }, { priority: 620, isActive: () => editing.value || Boolean(preview.value) })
onBeforeUnmount(() => { mounted = false; revision++; cancelEdit(); unregister(); if (confirming) cancelOwnedFeedbackDialog(dialogOwner) })
const perform = async (action, message) => {
  if (busy.value || props.blocked) return false
  busy.value = true; error.value = ''
  try { await action(); if (mounted) emit('message', message); return true }
  catch { if (mounted) error.value = '这次更改未完成，请检查输入或先重试保存。当前资料会保留。'; return false }
  finally { if (mounted) busy.value = false }
}
const selectCard = async () => {
  confirming = true
  try {
    const value = await appChoose({ sensitive: true, owner: dialogOwner, title: '全局角色库', options: cards.value.map(c => {
      const v = props.data.cardVersions.find(v => v.id === c.currentVersionId)
      return { value: c.id, label: (v?.definition.name || '角色') + (c.archived ? ' · 已归档' : '') }
    }) })
    if (mounted && value) { cancelEdit(); selectedId.value = value }
  } finally { confirming = false }
}
const importFile = async () => {
  const run = ++revision
  error.value = ''
  const file = await picker.choose()
  if (!file || !mounted || run !== revision) return
  busy.value = true
  try { const parsed = await parseCharacterCardFile(file); if (mounted && run === revision) preview.value = parsed }
  catch (failure) { if (mounted && run === revision) error.value = `无法导入此卡（${failure.code || 'READ_FAILED'}）。支持 JSON 和含 chara/ccv3 的 PNG，最大 8MB。` }
  finally { if (mounted && run === revision) busy.value = false }
}
const confirmImport = async () => {
  const parsed = preview.value
  if (!parsed) return
  const ok = await perform(() => props.management.importCard(parsed), '角色卡已加入全局库，尚未加入任何世界。')
  if (ok && mounted) {
    const version = props.data.cardVersions.find(v => v.imported?.sourceBase64 === parsed.asset.sourceBase64)
    selectedId.value = version?.cardId || selectedId.value; preview.value = null
  }
}
const startEdit = async () => {
  draft.value = JSON.parse(JSON.stringify(current.value.definition)); versionWhenEditing.value = current.value.id
  anchorsText.value = draft.value.anchors.join('\n')
  editing.value = true; error.value = ''; await nextTick(); nameInput.value?.focus()
}
const saveEdit = async () => {
  if (!draft.value) return
  draft.value.anchors = [...new Set(anchorsText.value.split('\n').map(v=>v.trim()).filter(Boolean))]
  if (!draft.value.name.trim() || !draft.value.summary.trim() || !draft.value.speechStyle.trim() || !draft.value.anchors.length) { error.value = '姓名、人物概要、人格锚点和说话习惯都需要填写。'; nameInput.value?.focus(); return }
  const ok = await perform(() => props.management.updateCard(selectedId.value, draft.value, versionWhenEditing.value), '全局卡已保存为新版本；世界中的实例继续使用原版本。')
  if (ok && mounted) cancelEdit()
}
const pickAvatar = async () => {
  const run = revision, file = await avatarPicker.choose()
  if (!file || !mounted || run !== revision || !draft.value) return
  if (file.size > 2 * 1024 * 1024) { error.value = '自定义头像请使用不超过 2MB 的 PNG。'; return }
  try { const uri = parseCharacterAvatar(new Uint8Array(await file.arrayBuffer())); if (mounted && run === revision && draft.value) draft.value.avatarDataUrl = uri }
  catch { if (mounted && run === revision) error.value = '头像 PNG 无法安全读取，原头像保持不变。' }
}
const toggleArchive = () => perform(() => props.management.archiveCard(selected.value.id, !selected.value.archived), selected.value.archived ? '角色卡已取消归档。' : '角色卡已归档，已有实例和经历继续保留。')
const synchronize = async () => {
  const cardId = selectedId.value
  const candidates = previewKanataCardSync(props.data, cardId).filter(p => !props.data.worlds.find(w => w.id === p.worldId)?.archived)
  if (!candidates.length) { summary.value = '没有需要同步的活动世界实例。'; return }
  confirming = true
  try {
    const instanceId = await appChoose({ sensitive: true, owner: dialogOwner, title: '选择要同步的实例', message: '每次选择一个实例；单独覆盖的设定和已有经历会保留。', options: candidates.map(c => ({ value: c.instanceId,
      label: (props.data.worlds.find(w => w.id === c.worldId)?.name || '世界') + ' · ' + (c.retainedOverrides.length ? '有独立覆盖' : '沿用基础卡') })) })
    const candidate = candidates.find(c => c.instanceId === instanceId)
    if (!mounted || !candidate) return
    const accepted = await appConfirm(`变动字段：${candidate.fields.join('、') || '无'}。\n保留的实例覆盖：${candidate.retainedOverrides.join('、') || '无'}。\n只同步所选实例，不改其他世界和已发生经历。`, { sensitive:true,owner:dialogOwner,title: '预览卡版本同步', confirmText: '同步这个实例' })
    if (mounted && accepted === true) await perform(() => props.management.syncCard(cardId, [candidate]), '所选实例已同步，独立覆盖和经历已保留。')
  } finally { confirming = false }
}
</script>

<template>
  <section class="kanata-panel" aria-label="全局角色卡管理">
    <header class="kanata-section-heading"><h3>全局角色库</h3><button type="button" :disabled="busy || blocked" @click="importFile">导入角色卡</button></header>
    <input ref="cardInput" class="kanata-file-input" type="file" accept=".json,.png,application/json,image/png" aria-label="选择角色卡文件" @change="picker.onChange" @cancel="picker.onCancel" />
    <input ref="avatarInput" class="kanata-file-input" type="file" accept=".png,image/png" aria-label="选择自定义头像" @change="avatarPicker.onChange" @cancel="avatarPicker.onCancel" />
    <p class="kanata-help">卡片只存基础设定。同一张卡在各世界拥有独立实例；导入不会生成聊天或调用 AI。</p>
    <p v-if="error" class="kanata-error" role="alert">{{ error }}</p><p v-if="summary" role="status">{{ summary }}</p>
    <article v-if="preview" class="kanata-import-preview" aria-label="角色卡导入预览">
      <h4>{{ preview.definition.name }} · {{ preview.spec.toUpperCase() }}</h4><p>{{ preview.definition.summary }}</p>
      <p>附带世界书 {{ preview.lorebook.length }} 项。加入世界时可单独预览知情范围。</p>
      <p v-for="warning in preview.warnings" :key="warning" class="kanata-help">{{ warning }}</p>
      <div class="kanata-actions"><button type="button" :disabled="busy || blocked" @click="confirmImport">确认导入全局库</button><button type="button" :disabled="busy" @click="cancelEdit">取消导入</button></div>
    </article>
    <button v-if="cards.length" class="kanata-selection" type="button" :disabled="busy" @click="selectCard">{{ current?.definition.name || '选择角色卡' }} <span>{{ selected?.archived ? '已归档' : `${cards.length} 张卡` }}</span></button>
    <article v-if="current && !editing" class="kanata-character-detail">
      <header class="kanata-avatar-heading"><img v-if="current.definition.avatarDataUrl" :src="current.definition.avatarDataUrl" alt="" /><span v-else class="kanata-avatar" aria-hidden="true">{{ current.definition.avatarPlaceholder }}</span><div><h4>{{ current.definition.name }}</h4><p class="kanata-help">版本 {{ current.revision }} · {{ selected.archived ? '已归档' : '可加入世界' }}</p></div></header>
      <p class="kanata-text">{{ current.definition.summary }}</p><dl class="kanata-description"><dt>说话习惯</dt><dd>{{ current.definition.speechStyle }}</dd><dt>知识边界</dt><dd>{{ current.definition.knowledgeBoundary }}</dd></dl>
      <p v-if="creatorNotes" class="kanata-help kanata-text">创作者说明：{{ creatorNotes }}</p>
      <div class="kanata-actions"><button type="button" :disabled="busy || blocked || selected.archived" @click="startEdit">编辑基础卡</button><button type="button" :disabled="busy || blocked || selected.archived" @click="synchronize">预览同步实例</button><button type="button" :disabled="busy || blocked" @click="toggleArchive">{{ selected.archived ? '取消归档角色卡' : '归档角色卡' }}</button></div>
      <details @toggle="rawVisible=$event.target.open"><summary>原始资料与保留的扩展</summary><p class="kanata-help">扩展仅作为资料保存，不会执行；原始字节也随加密备份保留。</p><pre v-if="rawVisible" class="kanata-raw" tabindex="0">{{ raw }}</pre></details>
    </article>
    <form v-if="editing && draft" class="kanata-form" novalidate @submit.prevent="saveEdit">
      <h4>编辑基础卡 · 保存为新版本</h4>
      <label>角色姓名<input ref="nameInput" v-model="draft.name" maxlength="200" autocomplete="off" /></label>
      <label>人物概要<textarea v-model="draft.summary" rows="5" maxlength="20000"></textarea></label>
      <label>人格锚点（每行一条）<textarea v-model="anchorsText" rows="3" maxlength="10000"></textarea></label>
      <label>说话习惯<textarea v-model="draft.speechStyle" rows="3" maxlength="10000"></textarea></label>
      <button type="button" :disabled="busy" @click="pickAvatar">选择 PNG 头像</button>
      <img v-if="draft.avatarDataUrl" class="kanata-avatar-preview" :src="draft.avatarDataUrl" alt="自定义头像预览" />
      <p class="kanata-help">现有世界不会自动同步，新头像和设定会进入这个卡版本。</p>
      <div class="kanata-actions"><button type="submit" :disabled="busy || blocked">保存新版本</button><button type="button" :disabled="busy" @click="cancelEdit">取消编辑</button></div>
    </form>
  </section>
</template>
