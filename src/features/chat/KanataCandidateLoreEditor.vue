<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'

const props = defineProps({ world: {type:Object,required:true}, model: {type:Object,required:true}, entryId: {type:String,default:''} })
const emit = defineEmits(['close','saved'])
const draft = ref(null), keywords = ref(''), busy = ref(false), error = ref('')
const actors = ref(null), previewActor = ref(null), previewText = ref(''), preview = ref(null), previewOffset = ref(0)
const secondaryKeys = ref('')
const dialog = Symbol('candidate-lore')
let active = true
function assertRequest() {
  if (!active) throw new Error('KANATA_LORE_EDITOR_EXPIRED')
}
async function perform(action, publish) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await action()
    assertRequest()
    publish(result)
  } catch (failure) {
    if (active) error.value = /CONFLICT|DUPLICATE/.test(failure?.code || failure?.message) ? '条目已变化或内容重复，请重新打开核对。' : '世界书操作未完成，请重试。'
  } finally {
    if (active) busy.value = false
  }
}
function load() {
  void perform(async () => {
    if (!props.entryId) return { id:'lore-' + crypto.randomUUID(), worldId:props.world.id, scope:'world', ownerId:props.world.id,
      content:'', keys:[], priority:50, activationRule:'keyword', visibility:'public', knownBy:[], sourceTag:'user-authored', enabled:true }
    const entry = await props.model.lore(props.entryId, assertRequest)
    if (!entry) throw new Error('LORE_UNAVAILABLE')
    return entry
  }, value => { draft.value = value; keywords.value = value.keys.join('、'); secondaryKeys.value = (value.secondaryKeys??[]).join('、') })
}
function loadActors(cursor) {
  void perform(() => props.model.list('actors', cursor, assertRequest), value => { actors.value = value })
}
function selectPreviewActor(actor) {
  previewActor.value = {id:actor.id,title:actor.title}
  preview.value = null
  previewOffset.value = 0
}
function runPreview(offset=0) {
  if (!previewActor.value || busy.value) return
  preview.value = null
  previewOffset.value = offset
  const query = previewText.value
  void perform(() => props.model.previewLore(previewActor.value.id,query,offset,assertRequest), value => { if (previewText.value===query) preview.value=value })
}
function selectOwner(id) {
  const current = draft.value
  Object.assign(current, { scope:'character', ownerId:id, visibility:'private', knownBy:[...new Set([id,...current.knownBy])] })
}
function setReader(id, checked) {
  const current = draft.value
  current.knownBy = checked ? [...new Set([...current.knownBy,id])] : current.knownBy.filter(reader=>reader!==id)
}
function save() {
  const current = draft.value
  const keys = [...new Set(keywords.value.split(/[,，、\n]/).map(item=>item.trim()).filter(Boolean))]
  if (current.activationRule !== 'always' && !keys.length) {
    error.value = '关键词激活需要至少一个关键词。'
    return
  }
  const secondary = [...new Set(secondaryKeys.value.split(/[,，、\n]/).map(item=>item.trim()).filter(Boolean))]
  const dto = { ...current, keys, secondaryKeys:secondary, revision:current.revision??1, priority:Number(current.priority) }
  void perform(() => props.model.saveLore(dto, current.revision??null, assertRequest), () => emit('saved'))
}
async function remove() {
  const current = draft.value
  const confirmed = await appConfirm('删除这条世界书设定？',{title:'删除世界书设定',confirmText:'删除条目',sensitive:true,destructive:true,owner:dialog})
  if (!active || confirmed !== true) return
  void perform(() => props.model.deleteLore(current.id,current.revision,assertRequest), () => emit('saved'))
}
onBeforeUnmount(() => { active=false; draft.value=actors.value=preview.value=previewActor.value=null; keywords.value=secondaryKeys.value=previewText.value=''; cancelOwnedFeedbackDialog(dialog) })
load()
</script>

<template>
  <section aria-label="候选世界书编辑">
    <button type="button" @click="emit('close')">返回世界书</button>
    <p v-if="busy" role="status">正在读取或保存…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error&&!draft" type="button" @click="load">重试载入</button>
    <form v-if="draft" class="kanata-form" @submit.prevent="save">
      <label>设定正文<textarea v-model="draft.content" maxlength="20000" required /></label>
      <label>激活关键词<input v-model="keywords" maxlength="2000" /></label>
      <label>第二组关键词<input v-model="secondaryKeys" maxlength="2000" /></label>
      <label><input v-model="draft.caseSensitive" type="checkbox" />区分关键词大小写</label>
      <label>优先级<input v-model.number="draft.priority" type="number" min="0" max="100000" required /></label>
      <label><input v-model="draft.activationRule" type="checkbox" true-value="always" false-value="keyword" />常驻候选</label>
      <label><input v-model="draft.enabled" type="checkbox" />启用条目</label>
      <p>知情范围 {{ draft.scope==='character'?'角色私有':'世界设定' }} · {{ draft.knownBy.length }} 个指定角色</p>
      <button type="button" :disabled="busy||world.archived" @click="loadActors()">选择所属角色或知情角色</button>
      <button v-if="draft.scope==='character'" type="button" :disabled="busy||world.archived" @click="Object.assign(draft,{scope:'world',ownerId:world.id,visibility:'public',knownBy:[]})">设为公开世界设定</button>
      <fieldset v-if="actors" :disabled="busy||world.archived">
        <legend>本页角色</legend>
        <div v-for="actor in actors.entries" :key="actor.id">
          <button type="button" @click="selectPreviewActor(actor)">{{ actor.title }} 预览</button>
          <button type="button" @click="selectOwner(actor.id)">{{ actor.title }} 设为所属角色</button>
          <label><input :checked="draft.knownBy.includes(actor.id)" :disabled="draft.ownerId===actor.id" type="checkbox" @change="setReader(actor.id,$event.target.checked)" />{{ actor.title }} 知情</label>
        </div>
        <button v-if="actors.cursor" type="button" @click="loadActors(actors.cursor)">更多角色</button>
      </fieldset>
      <button type="submit" :disabled="busy||world.archived">保存世界书条目</button>
      <button v-if="draft.revision" type="button" :disabled="busy||world.archived" @click="remove">删除世界书条目</button>
    </form>
    <section v-if="previewActor" aria-label="角色世界书预览">
      <p>{{ previewActor.title }} · 按聊天规则预览已保存的设定</p>
      <label>预览文本<input v-model="previewText" maxlength="4000" @input="preview=null" /></label>
      <button type="button" :disabled="busy" @click="runPreview()">运行角色预览</button>
      <button type="button" :disabled="busy" @click="preview=previewActor=null;previewText=''">关闭预览</button>
      <p v-if="preview?.entries.length===0">没有符合当前角色和文本的设定。</p>
      <ol v-if="preview" :start="previewOffset+1">
        <li v-for="entry in preview.entries" :key="entry.id">{{ entry.content }}</li>
      </ol>
      <button v-if="preview&&previewOffset>0" type="button" @click="runPreview(previewOffset-50)">上页预览</button>
      <button v-if="preview?.hasMore" type="button" @click="runPreview(previewOffset+50)">下页预览</button>
    </section>
  </section>
</template>
