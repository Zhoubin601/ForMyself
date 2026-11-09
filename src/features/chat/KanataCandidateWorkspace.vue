<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
import KanataConversationView from './KanataConversationView.vue'

const props=defineProps({
  worlds:{type:Object,required:true},
  lifecycle:{type:Object,required:true},
  createChat:{type:Function,required:true},
})
const sections=[
  ['conversations','会话'],['actors','角色与授权'],['lorebook','世界书'],['memories','记忆'],['events','事件'],['tasks','自治任务'],
]
const modules=[['home','首页'],['mood','心情'],['weight','体重'],['savings','省钱'],['schedule','日程'],['todo','待办'],['reports','报告']]
const world=shallowRef(null),directory=shallowRef(null),page=shallowRef(null),section=ref('conversations')
const chat=shallowRef(null),actor=shallowRef(null),grants=shallowRef(null)
const busy=ref(false),error=ref(''),name=ref('')
const dialogOwner=Symbol('kanata-workspace')
let generation=0, owner=null
function clear(){
  generation++
  props.worlds.clearSelection()
  owner=null
  world.value=directory.value=page.value=chat.value=actor.value=grants.value=null
  section.value='conversations'
  name.value=error.value=''
  busy.value=false
  cancelOwnedFeedbackDialog(dialogOwner)
}
async function read(work,publish){
  const version=++generation
  const assertRequest=()=>{
    if(version!==generation)throw new Error('KANATA_WORKSPACE_OWNER_EXPIRED')
  }
  busy.value=true
  error.value=''
  try{
    const result=await work(assertRequest)
    assertRequest()
    publish(result)
  }catch{
    if(version===generation)error.value='资料未能安全载入或保存，请重试。'
  }finally{
    if(version===generation)busy.value=false
  }
}
function loadWorlds(cursor){
  if(!props.lifecycle.isAvailable())return
  void read(assertRequest=>props.worlds.listWorlds(cursor,assertRequest),value=>{directory.value=value})
}
function backToWorlds(){
  clear()
  loadWorlds()
}
function selectWorld(id){
  clear()
  if(!props.lifecycle.isAvailable())return
  const selected=props.worlds.select(id)
  owner=selected
  void read(async()=>{
    const record=await selected.overview()
    if(!record)throw new Error('WORLD_NOT_FOUND')
    const items=await selected.list('conversations')
    return {record,items}
  },({record,items})=>{
    world.value=record
    name.value=record.title
    page.value=items
  })
}
function loadSection(next,cursor){
  if(!owner)return
  const selected=owner
  section.value=next
  page.value=null
  actor.value=grants.value=null
  void read(assertRequest=>selected.list(next,cursor,assertRequest),value=>{page.value=value})
}
function openEntry(entry){
  if(section.value==='conversations'){
    chat.value={runtime:props.createChat(),scope:{worldId:world.value.id},conversationId:entry.id}
  }else if(section.value==='actors'){
    const selected=owner
    actor.value=entry
    grants.value=null
    void read(assertRequest=>selected.grants(entry.id,assertRequest),value=>{grants.value=value})
  }
}
function grantOf(moduleId){
  return grants.value?.find(item=>item.moduleId===moduleId)
}
function saveGrant(moduleId,key,event){
  if(!owner||!actor.value||!grants.value||busy.value)return
  const selected=owner,id=actor.value.id,previous=grantOf(moduleId)
  const flags={read:previous?.read??false,remember:previous?.remember??false,share:previous?.share??false,[key]:event.target.checked}
  void read(()=>selected.setGrant(id,moduleId,previous?.revision??null,flags),()=>{})
}
function rename(){
  if(!owner||!name.value.trim()||busy.value)return
  const selected=owner
  void read(()=>selected.rename(name.value,world.value.revision),value=>{
    world.value={id:value.id,title:value.name,archived:Boolean(value.archived),revision:value.revision}
    name.value=value.name
  })
}
async function archive(){
  if(!owner||busy.value)return
  const selected=owner,version=generation,archived=!world.value.archived
  const confirmed=await appConfirm(archived?'归档后可以阅读现有内容，也可以取消归档。':'恢复对此世界的编辑？',
    {title:archived?'归档世界':'取消归档',sensitive:true,owner:dialogOwner})
  if(!confirmed||version!==generation)return
  void read(()=>selected.archive(archived,world.value.revision),value=>{world.value={id:value.id,title:value.name,archived:Boolean(value.archived),revision:value.revision}})
}
const stopGeneration=watch(()=>props.lifecycle.generation.value,()=>{
  clear()
  if(props.lifecycle.isAvailable())loadWorlds()
},{flush:'sync'})
const stopAvailability=watch(()=>props.lifecycle.isAvailable(),available=>{if(available&&!busy.value&&!world.value)loadWorlds()},{immediate:true})
const unregister=registerBackHandler(()=>{backToWorlds();return true},{priority:605,isActive:()=>Boolean(world.value&&!chat.value)})
onBeforeUnmount(()=>{
  unregister()
  stopGeneration()
  stopAvailability()
  clear()
  props.worlds.dispose()
  void props.lifecycle.release().catch(()=>{})
})
</script>

<template>
  <KanataConversationView v-if="chat" :conversation-id="chat.conversationId" :candidate="chat" @close="chat=null" />
  <section v-else class="kanata-panel" aria-label="彼方候选工作区">
    <header class="kanata-section-heading">
      <h3>{{ world?.title || '彼方世界' }}</h3>
      <button v-if="world" type="button" @click="backToWorlds">返回世界列表</button>
    </header>
    <p v-if="busy" role="status">正在读取或保存…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="!world">
      <ul v-if="directory">
        <li v-for="row in directory.entries" :key="row.id">
          <button type="button" :disabled="busy" @click="selectWorld(row.id)">{{ row.title }}{{ row.archived ? ' · 已归档' : '' }}</button>
        </li>
      </ul>
      <button v-if="directory?.cursor" type="button" :disabled="busy" @click="loadWorlds(directory.cursor)">更多世界</button>
      <button type="button" :disabled="busy || !lifecycle.isAvailable()" @click="loadWorlds()">载入世界</button>
    </template>
    <template v-else>
      <form v-if="!world.archived" class="kanata-form" @submit.prevent="rename">
        <label>世界名称<input v-model="name" required :disabled="busy" /></label>
        <button type="submit" :disabled="busy">保存名称</button>
      </form>
      <button type="button" :disabled="busy" @click="archive">{{ world.archived ? '取消归档' : '归档世界' }}</button>
      <nav class="kanata-actions" aria-label="世界资料">
        <button v-for="[id,label] in sections" :key="id" type="button" :aria-pressed="section===id" @click="loadSection(id)">
          {{ label }}
        </button>
      </nav>
      <ul v-if="page" :aria-label="sections.find(([id])=>id===section)?.[1]">
        <li v-for="row in page.entries" :key="row.id" :data-entry-id="row.id">
          <button v-if="section==='conversations'||section==='actors'" type="button" :disabled="busy" @click="openEntry(row)">{{ row.title }}</button>
          <span v-else>{{ row.title }} · {{ row.status }}</span>
        </li>
      </ul>
      <p v-if="page && !page.entries.length">本页暂无记录。</p>
      <button v-if="page?.cursor" type="button" :disabled="busy" @click="loadSection(section,page.cursor)">载入下一页</button>
      <fieldset v-if="actor && grants" :disabled="busy || world.archived">
        <legend>{{ actor.title }} · 生活资料授权</legend>
        <div v-for="[moduleId,label] in modules" :key="moduleId" :data-module="moduleId">
          {{ label }}
          <label v-for="[key,permission] in [['read','读取'],['remember','记忆'],['share','分享']]" :key="key">
            <input type="checkbox" :checked="grantOf(moduleId)?.[key]??false" @change="saveGrant(moduleId,key,$event)" />{{ permission }}
          </label>
        </div>
      </fieldset>
    </template>
  </section>
</template>
