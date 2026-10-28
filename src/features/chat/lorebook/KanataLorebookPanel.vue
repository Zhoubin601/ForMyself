<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { appChoose, cancelOwnedFeedbackDialog } from '../../../services/uiFeedback.js'
import { registerBackHandler } from '../../../services/backNavigation.js'
import { selectKanataLorebook } from './kanataLorebook.js'
import { resolveKanataCharacter } from '../domain/kanataManagementCore.js'

const props = defineProps({ data: { type: Object, required: true }, worldId: { type: String, required: true }, management: { type: Object, required: true }, blocked: Boolean })
const emit = defineEmits(['message'])
const entries = computed(() => props.data.lorebookEntries.filter(l => l.worldId === props.worldId))
const instances = computed(() => props.data.instances.filter(i => i.worldId === props.worldId))
const draft = ref(null), expectedRevision = ref(null), keywords = ref(''), contentInput = ref(null), error = ref(''), busy = ref(false)
const previewId = ref(''), query = ref(''), budget = ref(1024)
const dialogOwner = Symbol('kanata-management-dialog')
let mounted = true, confirming = false
const name = id => props.data.instances.some(i => i.id === id) ? resolveKanataCharacter(props.data, id).name : '用户'
const close = () => { draft.value = null; error.value = '' }
const unregister = registerBackHandler(() => { close(); return true }, { priority: 620, isActive: () => Boolean(draft.value) })
onBeforeUnmount(() => { mounted = false; close(); unregister(); if (confirming) cancelOwnedFeedbackDialog(dialogOwner) })
const startEdit = async entry => {
  draft.value = entry ? JSON.parse(JSON.stringify(entry)) : { id: 'lore-' + crypto.randomUUID(), worldId: props.worldId, scope: 'world', ownerId: props.worldId,
    keys: [], content: '', priority: 50, activationRule: 'keyword', visibility: 'public', knownBy: [], sourceTag: 'user-authored', revision: 1, enabled: true }
  draft.value.enabled = entry?.enabled !== false
  if (draft.value.scope === 'character') draft.value.knownBy = [...new Set([...draft.value.knownBy, draft.value.ownerId])]
  expectedRevision.value = entry?.revision ?? null
  keywords.value = draft.value.keys.join('、'); error.value = ''; await nextTick(); contentInput.value?.focus()
}
const setScope = async () => {
  confirming = true
  try {
    const scope = await appChoose({ sensitive: true, owner: dialogOwner, title: '设定的知情范围', options: [{value:'world',label:'世界公开设定'}, {value:'character',label:'角色私有设定'}] })
    if (!mounted || !draft.value || !scope) return
    if (scope === 'character') {
      if (!instances.value.length) { error.value = '请先给这个世界加入角色，再建立角色私有设定。'; return }
      const owner = await appChoose({ sensitive: true, owner: dialogOwner, title: '这条设定属于哪个实例', options: instances.value.map(i => ({ value: i.id, label: name(i.id) })) })
      if (!mounted || !draft.value || !owner) return
      Object.assign(draft.value, { scope, ownerId: owner, visibility: 'private', knownBy: [owner] })
    } else Object.assign(draft.value, { scope: 'world', ownerId: props.worldId, visibility: 'public', knownBy: [] })
  } finally { confirming = false }
}
const save = async () => {
  if (busy.value || props.blocked || !draft.value) return
  if (!draft.value.content.trim() || !Number.isSafeInteger(Number(draft.value.priority)) || Number(draft.value.priority) < 0) { error.value = '请填写设定内容，优先级使用非负整数。'; contentInput.value?.focus(); return }
  draft.value.keys = [...new Set(keywords.value.split(/[,，、\n]/).map(v => v.trim()).filter(Boolean))]
  if (draft.value.activationRule !== 'always' && !draft.value.keys.length) { error.value = '关键词激活需要至少一个关键词。'; return }
  draft.value.priority = Number(draft.value.priority)
  busy.value = true; error.value = ''
  try { await props.management.saveLore(draft.value, expectedRevision.value); if (mounted) { close(); emit('message', '世界书已保存，不会写成已发生事件。') } }
  catch (failure) { if (mounted) error.value = /CONFLICT|DUPLICATE/.test(failure.code || failure.message) ? '条目已变化或存在重复内容，请重新打开核对；原内容不会被覆盖。' : '设定未能保存，请检查内容或重试保存。' }
  finally { if (mounted) busy.value = false }
}
const choosePreviewRole = async () => {
  confirming = true
  try {
    const id = await appChoose({ sensitive: true, owner: dialogOwner, title: '以哪个角色的知识范围预览', options: instances.value.map(i => ({ value: i.id, label: name(i.id) })) })
    if (mounted && id) previewId.value = id
  } finally { confirming = false }
}
const retrieval = computed(() => {
  if (!previewId.value) return null
  try { return selectKanataLorebook(props.data, {worldId:props.worldId,instanceId:previewId.value,text:query.value,tokenBudget:Number(budget.value)}) }
  catch { return null }
})
</script>

<template>
  <section class="kanata-panel" aria-label="世界书管理">
    <header class="kanata-section-heading"><h3>世界书 · {{ entries.length }} 条</h3><button type="button" :disabled="blocked || busy" @click="startEdit(null)">新建设定</button></header>
    <p class="kanata-help">这里管理静态设定。角色可用内容先按知情权限筛选，再按关键词和预算选取；世界经历另行记录。</p>
    <p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <form v-if="draft" class="kanata-form" novalidate @submit.prevent="save">
      <h4>{{ expectedRevision === null ? '新建世界书条目' : '编辑世界书条目' }}</h4>
      <button type="button" :disabled="busy" @click="setScope">知情范围：{{ draft.scope === 'character' ? `${name(draft.ownerId)}的私有设定` : '世界公开设定' }}</button>
      <label>设定内容<textarea ref="contentInput" v-model="draft.content" rows="5" maxlength="20000"></textarea></label>
      <label>激活关键词<input v-model="keywords" maxlength="2000" placeholder="多个关键词用逗号或顿号分隔" /></label>
      <label>优先级<input v-model="draft.priority" type="number" min="0" max="100000" inputmode="numeric" /></label>
      <label class="kanata-check"><input v-model="draft.activationRule" type="checkbox" true-value="always" false-value="keyword" />常驻候选（仍受权限和预算约束）</label>
      <label class="kanata-check"><input v-model="draft.enabled" type="checkbox" />启用此条目</label>
      <fieldset v-if="draft.visibility === 'private'"><legend>允许知晓的本世界角色</legend><label v-for="instance in instances" :key="instance.id" class="kanata-check"><input v-model="draft.knownBy" type="checkbox" :value="instance.id" :disabled="instance.id === draft.ownerId" />{{ name(instance.id) }}{{ instance.id === draft.ownerId ? '（所属角色）' : '' }}</label></fieldset>
      <div class="kanata-actions"><button type="submit" :disabled="blocked || busy">保存世界书</button><button type="button" :disabled="busy" @click="close">取消设定编辑</button></div>
    </form>
    <ul class="kanata-lore-list"><li v-for="entry in entries" :key="entry.id"><div><strong>{{ entry.scope === 'character' ? `${name(entry.ownerId)} · 私有设定` : entry.scope === 'system' ? '世界说明' : '世界公开设定' }}</strong><span class="kanata-badge">{{ entry.enabled === false ? '已停用' : `优先级 ${entry.priority}` }}</span></div><p class="kanata-text">{{ entry.content }}</p><p class="kanata-help">{{ entry.activationRule === 'always' ? '常驻候选' : entry.keys.join(' · ') }}{{ entry.knownBy.length ? ` · 仅：${entry.knownBy.map(name).join('、')}` : '' }}</p><button type="button" :disabled="blocked || busy" @click="startEdit(entry)">编辑设定</button></li></ul>
    <details class="kanata-preview"><summary>按角色预览知识检索</summary><p class="kanata-help">只展示这个角色有权使用的设定，不调用 AI。预算采用保守 UTF-8 字节上界，并非实际 Token 用量。</p><button type="button" :disabled="!instances.length" @click="choosePreviewRole">{{ previewId ? name(previewId) : '选择预览角色' }}</button><label>测试关键词<input v-model="query" maxlength="4000" /></label><label>上下文预算<input v-model="budget" type="number" min="0" max="32000" inputmode="numeric" /></label><p v-if="retrieval" role="status">命中 {{ retrieval.entries.length }} 条 · 预算占用 {{ retrieval.usedTokens }}</p><ul v-if="retrieval"><li v-for="entry in retrieval.entries" :key="entry.id">{{ entry.content }}</li></ul><p v-else class="kanata-help">请选择本世界角色，并填写 0～32000 的整数预算。</p></details>
  </section>
</template>
