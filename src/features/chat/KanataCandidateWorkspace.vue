<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { appConfirm, appToast, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
import KanataCandidateCardLibrary from './cards/KanataCandidateCardLibrary.vue'
import KanataCandidateBindings from './KanataCandidateBindings.vue'
import KanataCandidateGroupEditor from './KanataCandidateGroupEditor.vue'
import KanataCandidateEventLedger from './KanataCandidateEventLedger.vue'
import KanataCandidateMemoryDetail from './KanataCandidateMemoryDetail.vue'
import KanataCandidateLoreEditor from './KanataCandidateLoreEditor.vue'
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
const cardEditor=shallowRef(null),bindingEditor=shallowRef(null),groupEditor=shallowRef(null),identityDraft=ref(null),loreEntry=shallowRef(null),eventGraph=shallowRef(null),memoryEntry=shallowRef(null)
const eventLedger=shallowRef(null), worldDraft=ref(null), settingsDraft=ref(null)
let creationOptions
const busy=ref(false),error=ref(''),name=ref('')
const dialogOwner=Symbol('kanata-workspace')
let generation=0, owner=null
function clear(){
  generation++
  props.worlds.clearSelection()
  owner=null
  world.value=directory.value=page.value=chat.value=actor.value=grants.value=null
  settingsDraft.value=identityDraft.value=loreEntry.value=eventGraph.value=eventLedger.value=memoryEntry.value=groupEditor.value=bindingEditor.value=cardEditor.value=null
  section.value='conversations'
  worldDraft.value=creationOptions=null
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
function beginWorld(){
  worldDraft.value={name:'',rules:'',displayName:'',background:''}
  creationOptions=null
}
function closeWorld(){
  worldDraft.value=creationOptions=null
  if(busy.value){
    generation++
    busy.value=false
  }
}
function createWorld(){
  if(busy.value||!worldDraft.value)return
  const {name,rules,displayName,background}=worldDraft.value
  if(!name.trim()||!displayName.trim())return
  creationOptions??={key:crypto.randomUUID(),now:Date.now(),
    timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',idFactory:kind=>kind+'-'+crypto.randomUUID()}
  void read(guard=>props.worlds.createWorld({name,rules,displayName,background},creationOptions,guard),selectWorld)
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
  settingsDraft.value=identityDraft.value=loreEntry.value=eventGraph.value=eventLedger.value=memoryEntry.value=groupEditor.value=bindingEditor.value=cardEditor.value=null
  void read(assertRequest=>selected.list(next,cursor,assertRequest),value=>{page.value=value})
}
function openGroupEditor(id=''){
  groupEditor.value={model:owner,id}
}
function groupSaved(id, edited, created){
  loadSection('conversations')
  if(edited)appToast(created?'已另建群聊，原群和历史均保留。':'已保存群聊成员。',{tone:'success'})
  if(edited&&created)openEntry({id})
}
function openEntry(entry){
  if(section.value==='conversations'){
    groupEditor.value=null
    chat.value={runtime:props.createChat(),scope:{worldId:world.value.id},conversationId:entry.id}
  }else if(section.value==='lorebook'){
    loreEntry.value={id:entry.id,model:owner}
  }else if(section.value==='memories'){
    memoryEntry.value={id:entry.id,model:owner}
  }else if(section.value==='events'){
    loadEventGraph(entry.id,'cause')
  }else if(section.value==='actors'){
    const selected=owner
    actor.value=entry
    grants.value=null
    void read(assertRequest=>selected.grants(entry.id,assertRequest),value=>{grants.value=value})
  }
}
function editIdentity(){
  const selected=owner
  void read(assertRequest=>selected.read(assertRequest),record=>{
    identityDraft.value={revision:record.identity.revision,displayName:record.identity.displayName,background:record.identity.background}
  })
}
function saveIdentity(){
  const selected=owner,{revision,displayName,background}=identityDraft.value
  void read(assertRequest=>selected.updateIdentity(revision,{displayName,background},assertRequest),()=>{identityDraft.value=null})
}
function openEventLedger(id=''){
  eventGraph.value=null
  eventLedger.value={id,model:owner}
}
function eventSaved(id){
  loadSection('events')
  openEventLedger(id)
}
function loadEventGraph(id,direction,cursor){
  eventLedger.value=null
  const selected=owner
  eventGraph.value=null
  void read(assertRequest=>selected.eventGraph(id,direction,cursor,assertRequest),value=>{eventGraph.value={id,direction,...value}})
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
function openSettings(){
  if(!owner||busy.value)return
  const selected=owner
  void read(guard=>selected.read(guard),value=>{
    const {name,rules,timeZone,defaultChatMode,revision}=value.world
    settingsDraft.value={name,rules,timeZone,defaultChatMode,revision}
  })
}
function saveSettings(){
  if(!owner||busy.value||!settingsDraft.value||world.value.archived)return
  const selected=owner
  const {revision,...fields}=settingsDraft.value
  void read(guard=>selected.updateWorldSettings(revision,fields,guard),value=>{
    world.value={id:value.id,title:value.name,archived:Boolean(value.archived),revision:value.revision}
    name.value=value.name
    settingsDraft.value=null
    appToast('已保存世界设置。',{tone:'success'})
  })
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
const unregister=registerBackHandler(()=>{if(worldDraft.value)closeWorld();else backToWorlds();return true},{priority:605,isActive:()=>Boolean(worldDraft.value||world.value&&!chat.value)})
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
    <KanataCandidateCardLibrary v-if="cardEditor" :model="cardEditor" @close="cardEditor=null" />
    <KanataCandidateBindings v-else-if="bindingEditor" :model="bindingEditor" @close="bindingEditor=null" />
    <template v-else-if="!world">
      <button v-if="!worldDraft" type="button" :disabled="busy||!lifecycle.isAvailable()" @click="beginWorld">新建空白世界</button>
      <form v-if="worldDraft" class="kanata-form" aria-label="新建空白世界" @input="creationOptions=null" @submit.prevent="createWorld">
        <label>新世界名称<input v-model="worldDraft.name" maxlength="200" required :disabled="busy" /></label>
        <label>世界规则<textarea v-model="worldDraft.rules" maxlength="4000" :disabled="busy" /></label>
        <label>世界内身份<input v-model="worldDraft.displayName" maxlength="200" required :disabled="busy" /></label>
        <label>身份背景<textarea v-model="worldDraft.background" maxlength="4000" :disabled="busy" /></label>
        <button type="submit" :disabled="busy">创建世界</button>
        <button type="button" @click="closeWorld">取消创建</button>
      </form>
      <button type="button" :disabled="busy||Boolean(worldDraft)||!lifecycle.isAvailable()" @click="cardEditor=worlds.openCards()">全局角色卡库</button>
      <button type="button" :disabled="busy||Boolean(worldDraft)||!lifecycle.isAvailable()" @click="bindingEditor=worlds.openBindings()">生活角色绑定</button>
      <ul v-if="directory&&!worldDraft">
        <li v-for="row in directory.entries" :key="row.id">
          <button type="button" :disabled="busy" @click="selectWorld(row.id)">{{ row.title }}{{ row.archived ? ' · 已归档' : '' }}</button>
        </li>
      </ul>
      <button v-if="directory?.cursor&&!worldDraft" type="button" :disabled="busy" @click="loadWorlds(directory.cursor)">更多世界</button>
      <button v-if="!worldDraft" type="button" :disabled="busy || !lifecycle.isAvailable()" @click="loadWorlds()">载入世界</button>
    </template>
    <template v-else>
      <form v-if="!world.archived" class="kanata-form" @submit.prevent="rename">
        <label>世界名称<input v-model="name" required :disabled="busy" /></label>
        <button type="submit" :disabled="busy">保存名称</button>
      </form>
      <button type="button" :disabled="busy" @click="archive">{{ world.archived ? '取消归档' : '归档世界' }}</button>
      <button v-if="!world.archived&&!settingsDraft" type="button" :disabled="busy" @click="openSettings">编辑世界设置</button>
      <form v-if="settingsDraft" class="kanata-form" aria-label="世界设置" @submit.prevent="saveSettings">
        <label>世界设置名称<input v-model="settingsDraft.name" maxlength="200" required :disabled="busy||world.archived" /></label>
        <label>世界设定规则<textarea v-model="settingsDraft.rules" maxlength="4000" :disabled="busy||world.archived" /></label>
        <label>世界时区<input v-model="settingsDraft.timeZone" maxlength="100" placeholder="Asia/Shanghai" required :disabled="busy||world.archived" /></label>
        <fieldset :disabled="busy||world.archived">
          <legend>默认聊天模式</legend>
          <label><input v-model="settingsDraft.defaultChatMode" type="radio" value="daily" />日常</label>
          <label><input v-model="settingsDraft.defaultChatMode" type="radio" value="roleplay" />角色扮演</label>
        </fieldset>
        <button type="submit" :disabled="busy||world.archived">保存世界设置</button>
        <button type="button" :disabled="busy" @click="settingsDraft=null">关闭世界设置</button>
      </form>
      <button type="button" :disabled="busy" @click="editIdentity">查看世界身份</button>
      <form v-if="identityDraft" class="kanata-form" @submit.prevent="saveIdentity">
        <label>身份名称<input v-model="identityDraft.displayName" maxlength="200" required :disabled="busy||world.archived" /></label>
        <label>身份背景<textarea v-model="identityDraft.background" maxlength="4000" :disabled="busy||world.archived" /></label>
        <button type="submit" :disabled="busy||world.archived">保存世界身份</button>
        <button type="button" :disabled="busy" @click="identityDraft=null">关闭身份</button>
      </form>
      <nav class="kanata-actions" aria-label="世界资料">
        <button v-for="[id,label] in sections" :key="id" type="button" :aria-pressed="section===id" @click="loadSection(id)">
          {{ label }}
        </button>
      </nav>
      <ul v-if="page" :aria-label="sections.find(([id])=>id===section)?.[1]">
        <li v-for="row in page.entries" :key="row.id" :data-entry-id="row.id">
          <button v-if="['conversations','actors','lorebook','memories','events'].includes(section)" type="button" :disabled="busy" @click="openEntry(row)">{{ row.title }}</button>
          <span v-else>{{ row.title }} · {{ row.status }}</span>
          <button v-if="section==='conversations'&&row.status==='group'&&!world.archived" type="button"
            :aria-label="'编辑群聊成员：'+row.title" :disabled="busy" @click="openGroupEditor(row.id)">编辑成员</button>
          <button v-if="section==='events'" type="button" :aria-label="'查看事件账本：'+row.title"
            :disabled="busy" @click="openEventLedger(row.id)">查看事件账本</button>
        </li>
      </ul>
      <p v-if="page && !page.entries.length">本页暂无记录。</p>
      <button v-if="page?.cursor" type="button" :disabled="busy" @click="loadSection(section,page.cursor)">载入下一页</button>
      <button v-if="section==='conversations'" type="button" :disabled="busy||world.archived" @click="openGroupEditor()">新建独立群聊</button>
      <KanataCandidateGroupEditor v-if="groupEditor&&!world.archived" :key="groupEditor.id" :model="groupEditor.model"
        :edit-id="groupEditor.id" @close="groupEditor=null" @saved="groupSaved" />
      <button v-if="section==='lorebook'" type="button" :disabled="busy||world.archived" @click="loreEntry={id:'',model:owner}">新建世界书设定</button>
      <KanataCandidateLoreEditor v-if="loreEntry" :key="loreEntry.id" :world="world" :model="loreEntry.model" :entry-id="loreEntry.id"
        @close="loreEntry=null" @saved="loadSection('lorebook')" />
      <KanataCandidateMemoryDetail v-if="memoryEntry" :key="memoryEntry.id" :memory-id="memoryEntry.id" :model="memoryEntry.model"
        :archived="world.archived" @close="memoryEntry=null" @removed="loadSection('memories')"
        @open-related="id=>openEntry({id})" />
      <button v-if="section==='events'" type="button" :disabled="busy||world.archived" @click="openEventLedger()">提议事件</button>
      <KanataCandidateEventLedger v-if="eventLedger" :key="eventLedger.id" :model="eventLedger.model" :event-id="eventLedger.id"
        :archived="world.archived" @close="eventLedger=null" @saved="eventSaved" />
      <section v-if="eventGraph" aria-label="候选事件因果">
        <button type="button" @click="eventGraph=null">关闭因果详情</button>
        <button type="button" @click="loadEventGraph(eventGraph.id,'cause')">查看前因</button>
        <button type="button" @click="loadEventGraph(eventGraph.id,'consequence')">查看后续</button>
        <ul><li v-for="node in eventGraph.entries" :key="node.id">{{ node.id }} · v{{ node.revision }} · {{ node.status }}</li></ul>
        <button v-if="eventGraph.cursor" type="button" @click="loadEventGraph(eventGraph.id,eventGraph.direction,eventGraph.cursor)">更多关联</button>
      </section>
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
