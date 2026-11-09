<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { parseCharacterCardFile } from './characterCardImport.js'
import { useKanataFilePicker } from './useKanataFilePicker.js'

const props=defineProps({model:{type:Object,required:true}})
const emit=defineEmits(['close'])
const picker=useKanataFilePicker()
const input=picker.input
const page=shallowRef(null),history=shallowRef(null),draft=ref(null),imported=shallowRef(null)
const anchors=ref(''),busy=ref(false),error=ref('')
let active=true, generation=0, key=''
async function perform(action,publish){
  if(busy.value)return
  const version=++generation
  const guard=()=>{if(!active||version!==generation)throw new Error('KANATA_CARD_VIEW_EXPIRED')}
  busy.value=true
  error.value=''
  try{
    const result=await action(guard)
    guard()
    publish(result)
  }catch(failure){
    if(active&&version===generation)error.value=/CONFLICT/.test(failure?.code??failure?.message)?'卡片版本已变化，请重新载入。':'角色卡操作未完成，请核对格式或重试。'
  }finally{if(active&&version===generation)busy.value=false}
}
function closeDraft(){
  generation++
  busy.value=false
  draft.value=imported.value=history.value=null
  anchors.value=''
}
function load(cursor){void perform(guard=>props.model.list(cursor,guard),value=>{page.value=value})}
function open(id,versionId){
  draft.value=imported.value=null
  void perform(guard=>props.model.read(id,versionId,guard),value=>{
    draft.value=value
    anchors.value=value.definition.anchors.join('\n')
    key=crypto.randomUUID()
  })
}
function loadHistory(cursor){
  const id=draft.value.cardId
  void perform(guard=>props.model.versions(id,cursor,guard),value=>{history.value=value})
}
function choose(){
  closeDraft()
  void perform(async guard=>{
    const file=await picker.choose()
    guard()
    return file?parseCharacterCardFile(file):null
  },value=>{imported.value=value;key=crypto.randomUUID()})
}
function importCard(){
  void perform(guard=>props.model.importCard(imported.value,key,guard),()=>{
    imported.value=null
    busy.value=false
    load()
  })
}
function publish(){
  const card=draft.value, definition={...card.definition,anchors:[...new Set(anchors.value.split('\n').map(item=>item.trim()).filter(Boolean))]}
  void perform(guard=>props.model.publish(card.cardId,definition,card.currentVersionId,key,guard),()=>{
    closeDraft()
    load()
  })
}
function archive(){
  const card=draft.value
  void perform(guard=>props.model.archive(card.cardId,card.currentVersionId,card.archived,guard),()=>{
    closeDraft()
    load()
  })
}
onBeforeUnmount(()=>{active=false;closeDraft();page.value=null;props.model.dispose()})
load()
</script>

<template>
  <section aria-label="候选角色卡库">
    <input ref="input" type="file" accept=".json,.png,application/json,image/png" hidden @change="picker.onChange" @cancel="picker.onCancel" />
    <button type="button" @click="emit('close')">关闭角色卡库</button>
    <button type="button" :disabled="busy" @click="choose">导入 JSON 或 PNG 角色卡</button>
    <p v-if="busy" role="status">正在读取或保存角色卡…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="!page&&!busy" type="button" @click="load()">载入角色卡</button>
    <ul v-if="page">
      <li v-for="item in page.entries" :key="item.id">
        <button type="button" :disabled="busy" @click="open(item.id)">{{ item.name }}{{ item.archived?' · 已归档':'' }}</button>
      </li>
    </ul>
    <button v-if="page?.cursor" type="button" :disabled="busy" @click="load(page.cursor)">更多角色卡</button>
    <article v-if="imported">
      <h4>{{ imported.definition.name }}</h4>
      <p>{{ imported.definition.summary }}</p>
      <button type="button" :disabled="busy" @click="importCard">确认导入角色卡</button>
      <button type="button" @click="closeDraft">取消导入</button>
    </article>
    <article v-if="draft">
      <h4>{{ draft.definition.name }} · 版本 {{ draft.revision }}</h4>
      <form v-if="draft.id===draft.currentVersionId&&!draft.archived" class="kanata-form" @submit.prevent="publish">
        <label>角色名称<input v-model="draft.definition.name" required /></label>
        <label>人物概要<textarea v-model="draft.definition.summary" required /></label>
        <label>说话习惯<textarea v-model="draft.definition.speechStyle" required /></label>
        <label>人格锚点<textarea v-model="anchors" required /></label>
        <button type="submit" :disabled="busy">发布新卡版本</button>
      </form>
      <p v-else>{{ draft.definition.summary }}</p>
      <button type="button" :disabled="busy" @click="loadHistory()">查看卡版本历史</button>
      <button v-if="draft.id===draft.currentVersionId" type="button" :disabled="busy" @click="archive">{{ draft.archived?'取消卡归档':'归档角色卡' }}</button>
      <button type="button" @click="closeDraft">关闭卡详情</button>
      <ul v-if="history">
        <li v-for="version in history.entries" :key="version.id">
          <button type="button" :disabled="busy" @click="open(draft.cardId,version.id)">版本 {{ version.revision }}</button>
        </li>
      </ul>
      <button v-if="history?.cursor" type="button" :disabled="busy" @click="loadHistory(history.cursor)">更多卡版本</button>
    </article>
  </section>
</template>
