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
import KanataCandidateActivityPanel from './autonomy/KanataCandidateActivityPanel.vue'
import KanataConversationView from './KanataConversationView.vue'

const props=defineProps({
  worlds:{type:Object,required:true},
  lifecycle:{type:Object,required:true},
  createChat:{type:Function,required:true},
  autonomy:{type:Object,default:null},
})
const sections=[
  ['conversations','会话'],['actors','角色与授权'],['lorebook','世界书'],['memories','记忆'],['events','事件'],['tasks','自治任务'],
]
const modules=[['home','首页'],['mood','心情'],['weight','体重'],['savings','省钱'],['schedule','日程'],['todo','待办'],['reports','报告']]
const world=shallowRef(null),directory=shallowRef(null),page=shallowRef(null),section=ref('conversations')
const chat=shallowRef(null),actor=shallowRef(null),grants=shallowRef(null)
const cardEditor=shallowRef(null),bindingEditor=shallowRef(null),groupEditor=shallowRef(null),identityDraft=ref(null),loreEntry=shallowRef(null),eventGraph=shallowRef(null),memoryEntry=shallowRef(null)
const eventLedger=shallowRef(null), worldDraft=ref(null), settingsDraft=ref(null), copyDraft=ref(null)
const cardPicker=shallowRef(null), instanceDraft=ref(null), cardLorePreview=shallowRef(null), memoryDraft=ref(null), memoryPolicyDraft=ref(null)
let creationOptions
const busy=ref(false),error=ref(''),name=ref('')
const dialogOwner=Symbol('kanata-workspace')
let generation=0, owner=null, autonomyOwner=shallowRef(null)
function clear(){
  generation++
  props.worlds.clearSelection()
  props.autonomy?.cancel?.()
  owner=null
  autonomyOwner.value=null
  world.value=directory.value=page.value=chat.value=actor.value=grants.value=null
  settingsDraft.value=identityDraft.value=loreEntry.value=eventGraph.value=eventLedger.value=memoryEntry.value=groupEditor.value=bindingEditor.value=cardEditor.value=null
  copyDraft.value=cardPicker.value=instanceDraft.value=cardLorePreview.value=memoryDraft.value=memoryPolicyDraft.value=null
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
  autonomyOwner.value=props.autonomy?props.autonomy.select(id):null
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
  copyDraft.value=cardPicker.value=instanceDraft.value=cardLorePreview.value=memoryDraft.value=memoryPolicyDraft.value=null
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
    instanceDraft.value=cardLorePreview.value=null
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
  void read(async guard=>{
    await selected.setGrant(id,moduleId,previous?.revision??null,flags,guard)
    guard()
    return selected.grants(id,guard)
  },list=>{grants.value=list})
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
function beginCopy(){
  if(!world.value||busy.value)return
  copyDraft.value={name:world.value.title+' · 新篇',commandId:crypto.randomUUID(),now:Date.now()}
}
function copyWorld(){
  if(!world.value||busy.value||!copyDraft.value)return
  const sourceId=world.value.id,{name:nextName,commandId,now}=copyDraft.value
  if(!nextName.trim()||nextName.length>200)return
  const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
  void read(guard=>props.worlds.copyWorld(sourceId,nextName,{key:commandId,now,timeZone},guard),selectWorld)
}
function openCardPicker(cursor){
  if(!owner||busy.value)return
  const selected=owner
  void read(guard=>selected.availableCards(cursor,guard),value=>{
    cardPicker.value={entries:value.entries.filter(c=>!c.archived),cursor:value.cursor}
  })
}
function addActorFromCard(cardId){
  if(!owner||busy.value||world.value?.archived)return
  const selected=owner,key=crypto.randomUUID()
  void read(guard=>selected.addCharacter(cardId,key,guard),()=>{
    cardPicker.value=null
    appToast('角色实例与独立私聊已建立。',{tone:'success'})
    loadSection('actors')
  })
}
function openInstanceEditor(){
  if(!owner||!actor.value||busy.value)return
  const selected=owner,id=actor.value.id
  void read(guard=>selected.instanceDetail(id,guard),detail=>{
    instanceDraft.value={
      id,revision:detail.instance.revision,existing:{...detail.instance.overrides},
      name:detail.resolved.name,summary:detail.resolved.summary,speechStyle:detail.resolved.speechStyle,
      original:{name:detail.resolved.name,summary:detail.resolved.summary,speechStyle:detail.resolved.speechStyle},
    }
  })
}
function saveInstanceOverrides(){
  if(!owner||!instanceDraft.value||busy.value||world.value?.archived)return
  const selected=owner,draft=instanceDraft.value
  if(!draft.name.trim()||!draft.summary.trim()||!draft.speechStyle.trim())return
  const overrides={...draft.existing}
  for(const key of ['name','summary','speechStyle'])if(draft[key]!==draft.original[key])overrides[key]=draft[key]
  void read(guard=>selected.updateInstance(draft.id,draft.revision,overrides,guard),()=>{
    instanceDraft.value=null
    appToast('仅这个世界实例的设定已更新。',{tone:'success'})
    loadSection('actors')
  })
}
function openCardLorePreview(){
  if(!owner||!actor.value||busy.value)return
  const selected=owner,id=actor.value.id
  void read(guard=>selected.previewCardLore(id,guard),entries=>{
    cardLorePreview.value={entries,conflicts:entries.filter(item=>item.conflictId).length,commandId:crypto.randomUUID()}
  })
}
function attachCardLore(){
  if(!owner||!actor.value||!cardLorePreview.value||busy.value||world.value?.archived)return
  const selected=owner,id=actor.value.id,{conflicts,commandId}=cardLorePreview.value
  void read(guard=>selected.attachCardLore(id,conflicts>0,commandId,guard),result=>{
    cardLorePreview.value=null
    appToast(`已导入 ${result.created.length} 条角色私有世界书设定。`,{tone:'success'})
  })
}
function openMemoryDraft(){
  if(!owner||busy.value)return
  const selected=owner
  void read(guard=>selected.list('actors','',guard),actors=>{
    if(!actors.entries.length)return
    memoryDraft.value={ownerId:actors.entries[0].id,actors:actors.entries,layer:'L3',key:'',content:''}
  })
}
function saveNewMemory(){
  if(!owner||!memoryDraft.value||busy.value||world.value?.archived)return
  const selected=owner,{ownerId,layer,key:topic,content}=memoryDraft.value
  if(!topic.trim()||!content.trim())return
  const entry={id:'memory-'+crypto.randomUUID(),worldId:world.value.id,ownerType:'character',ownerId,layer,key:topic.trim(),
    content:content.trim(),sourceRefs:[],status:'candidate',revision:1,visibility:'private',knownBy:[ownerId],confidence:'statement'}
  void read(guard=>selected.saveMemory(entry,null,guard),()=>{
    memoryDraft.value=null
    appToast('候选记忆已保存，需要核对采用后才用于对话。',{tone:'success'})
    loadSection('memories')
  })
}
function openMemoryPolicy(){
  if(!owner||busy.value)return
  const selected=owner
  void read(guard=>selected.memoryPolicy(guard),saved=>{
    memoryPolicyDraft.value=saved
      ? {expectedRevision:saved.revision,strategy:saved.strategy,enabled:saved.enabled,recentMessages:saved.recentMessages,summarizeAfter:saved.summarizeAfter,extractAfter:saved.extractAfter,contextBudget:saved.contextBudget,commandId:crypto.randomUUID()}
      : {expectedRevision:null,strategy:'standard',enabled:false,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,commandId:crypto.randomUUID()}
  })
}
function saveMemoryPolicy(){
  if(!owner||!memoryPolicyDraft.value||busy.value||world.value?.archived)return
  const selected=owner,{expectedRevision,commandId,...fields}=memoryPolicyDraft.value
  const payload={strategy:fields.strategy,enabled:Boolean(fields.enabled),recentMessages:Number(fields.recentMessages),
    summarizeAfter:Number(fields.summarizeAfter),extractAfter:Number(fields.extractAfter),contextBudget:Number(fields.contextBudget)}
  void read(guard=>selected.saveMemoryPolicy(expectedRevision,payload,commandId,guard),()=>{
    memoryPolicyDraft.value=null
    appToast('记忆整理策略已保存。',{tone:'success'})
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
function handleBack(){
  if(worldDraft.value)closeWorld()
  else if(cardEditor.value)cardEditor.value=null
  else if(bindingEditor.value)bindingEditor.value=null
  else if(groupEditor.value)groupEditor.value=null
  else if(loreEntry.value)loreEntry.value=null
  else if(memoryEntry.value)memoryEntry.value=null
  else if(eventLedger.value)eventLedger.value=null
  else if(eventGraph.value)eventGraph.value=null
  else if(cardPicker.value)cardPicker.value=null
  else if(instanceDraft.value)instanceDraft.value=null
  else if(cardLorePreview.value)cardLorePreview.value=null
  else if(memoryDraft.value)memoryDraft.value=null
  else if(memoryPolicyDraft.value)memoryPolicyDraft.value=null
  else if(copyDraft.value)copyDraft.value=null
  else if(settingsDraft.value)settingsDraft.value=null
  else if(identityDraft.value)identityDraft.value=null
  else if(actor.value){actor.value=null;grants.value=null}
  else backToWorlds()
  return true
}
const unregister=registerBackHandler(handleBack,{priority:605,isActive:()=>Boolean(worldDraft.value||cardEditor.value||bindingEditor.value||world.value&&!chat.value)})
onBeforeUnmount(()=>{
  unregister()
  stopGeneration()
  stopAvailability()
  clear()
  props.worlds.dispose()
  props.autonomy?.dispose?.()
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
      <button v-if="!copyDraft" type="button" :disabled="busy" @click="beginCopy">复制设定</button>
      <form v-if="copyDraft" class="kanata-form" aria-label="复制世界设定" @submit.prevent="copyWorld">
        <label>新世界名称<input v-model="copyDraft.name" maxlength="200" required :disabled="busy" /></label>
        <p class="kanata-help">只复制成员、静态设定、非角色私聊及无事件队友关系；不复制聊天、记忆、事件、情绪或现实授权。</p>
        <button type="submit" :disabled="busy">确认复制为新世界</button>
        <button type="button" :disabled="busy" @click="copyDraft=null">取消复制</button>
      </form>
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
      <button v-if="section==='actors'" type="button" :disabled="busy||world.archived" @click="openCardPicker()">从全局库加入角色</button>
      <section v-if="section==='actors'&&cardPicker&&!world.archived" aria-label="加入全局角色">
        <p v-if="!cardPicker.entries.length">没有可用的未归档角色卡。</p>
        <ul v-else>
          <li v-for="card in cardPicker.entries" :key="card.id">
            <button type="button" :disabled="busy" @click="addActorFromCard(card.id)">加入 {{ card.name }}</button>
          </li>
        </ul>
        <button v-if="cardPicker.cursor" type="button" :disabled="busy" @click="openCardPicker(cardPicker.cursor)">更多全局角色</button>
        <button type="button" @click="cardPicker=null">关闭角色选择</button>
      </section>
      <button v-if="section==='lorebook'" type="button" :disabled="busy||world.archived" @click="loreEntry={id:'',model:owner}">新建世界书设定</button>
      <KanataCandidateLoreEditor v-if="loreEntry" :key="loreEntry.id" :world="world" :model="loreEntry.model" :entry-id="loreEntry.id"
        @close="loreEntry=null" @saved="loadSection('lorebook')" />
      <KanataCandidateMemoryDetail v-if="memoryEntry" :key="memoryEntry.id" :memory-id="memoryEntry.id" :model="memoryEntry.model"
        :archived="world.archived" @close="memoryEntry=null" @removed="loadSection('memories')"
        @open-related="id=>openEntry({id})" />
      <div v-if="section==='memories'" class="kanata-actions">
        <button type="button" :disabled="busy||world.archived" @click="openMemoryDraft">新建候选记忆</button>
        <button type="button" :disabled="busy||world.archived" @click="openMemoryPolicy">整理策略设置</button>
      </div>
      <form v-if="section==='memories'&&memoryDraft" class="kanata-form" aria-label="新建候选记忆" @submit.prevent="saveNewMemory">
        <fieldset class="kanata-fieldset">
          <legend>所属角色</legend>
          <div role="radiogroup" aria-label="所属角色">
            <button v-for="item in memoryDraft.actors" :key="item.id" type="button"
              :aria-pressed="memoryDraft.ownerId===item.id" :disabled="busy||world.archived"
              @click="memoryDraft.ownerId=item.id">
              {{ item.title }}
            </button>
          </div>
        </fieldset>
        <label>记忆主题<input v-model="memoryDraft.key" maxlength="200" required :disabled="busy||world.archived" /></label>
        <label>记忆正文<textarea v-model="memoryDraft.content" maxlength="4000" required :disabled="busy||world.archived" /></label>
        <button type="submit" :disabled="busy||world.archived">保存候选记忆</button>
        <button type="button" @click="memoryDraft=null">取消新建记忆</button>
      </form>
      <form v-if="section==='memories'&&memoryPolicyDraft" class="kanata-form" aria-label="记忆整理策略" @submit.prevent="saveMemoryPolicy">
        <fieldset class="kanata-fieldset">
          <legend>策略模式</legend>
          <div role="radiogroup" aria-label="策略模式">
            <button v-for="opt in [{id:'economical',label:'节省'},{id:'standard',label:'标准'},{id:'deep',label:'深度'},{id:'custom',label:'自定义'}]"
              :key="opt.id" type="button" :aria-pressed="memoryPolicyDraft.strategy===opt.id" :disabled="busy||world.archived"
              @click="memoryPolicyDraft.strategy=opt.id">
              {{ opt.label }}
            </button>
          </div>
        </fieldset>
        <label><input v-model="memoryPolicyDraft.enabled" type="checkbox" :disabled="busy||world.archived" />启用自动整理</label>
        <label>近期原文<input v-model="memoryPolicyDraft.recentMessages" type="number" min="2" max="40" :disabled="busy||world.archived" /></label>
        <label>摘要阈值<input v-model="memoryPolicyDraft.summarizeAfter" type="number" min="4" max="200" :disabled="busy||world.archived" /></label>
        <label>提取间隔<input v-model="memoryPolicyDraft.extractAfter" type="number" min="2" max="100" :disabled="busy||world.archived" /></label>
        <label>字节预算<input v-model="memoryPolicyDraft.contextBudget" type="number" min="2000" max="64000" :disabled="busy||world.archived" /></label>
        <button type="submit" :disabled="busy||world.archived">保存整理策略</button>
        <button type="button" @click="memoryPolicyDraft=null">取消策略设置</button>
      </form>
      <button v-if="section==='events'" type="button" :disabled="busy||world.archived" @click="openEventLedger()">提议事件</button>
      <KanataCandidateEventLedger v-if="eventLedger" :key="eventLedger.id" :model="eventLedger.model" :event-id="eventLedger.id"
        :archived="world.archived" @close="eventLedger=null" @saved="eventSaved" />
      <KanataCandidateActivityPanel v-if="section==='tasks'&&autonomyOwner" :key="world.id" :model="autonomyOwner"
        :world-id="world.id" :archived="world.archived" @updated="loadSection('tasks')" />
      <section v-if="eventGraph" aria-label="候选事件因果">
        <button type="button" @click="eventGraph=null">关闭因果详情</button>
        <button type="button" @click="loadEventGraph(eventGraph.id,'cause')">查看前因</button>
        <button type="button" @click="loadEventGraph(eventGraph.id,'consequence')">查看后续</button>
        <ul><li v-for="node in eventGraph.entries" :key="node.id">{{ node.id }} · v{{ node.revision }} · {{ node.status }}</li></ul>
        <button v-if="eventGraph.cursor" type="button" @click="loadEventGraph(eventGraph.id,eventGraph.direction,eventGraph.cursor)">更多关联</button>
      </section>
      <section v-if="actor && grants">
        <div class="kanata-actions">
          <button type="button" :disabled="busy||world.archived" @click="openInstanceEditor">实例设定</button>
          <button type="button" :disabled="busy||world.archived" @click="openCardLorePreview">附带世界书</button>
        </div>
        <form v-if="instanceDraft" class="kanata-form" aria-label="角色实例覆盖" @submit.prevent="saveInstanceOverrides">
          <label>本世界称呼<input v-model="instanceDraft.name" maxlength="200" required :disabled="busy||world.archived" /></label>
          <label>人物概要<textarea v-model="instanceDraft.summary" maxlength="20000" required :disabled="busy||world.archived" /></label>
          <label>说话习惯<textarea v-model="instanceDraft.speechStyle" maxlength="10000" required :disabled="busy||world.archived" /></label>
          <button type="submit" :disabled="busy||world.archived">保存实例设定</button>
          <button type="button" :disabled="busy" @click="instanceDraft=null">取消实例编辑</button>
        </form>
        <div v-if="cardLorePreview" class="kanata-notice" role="status">
          <p v-if="!cardLorePreview.entries.length">该角色卡没有附带世界书。</p>
          <template v-else>
            <p>共 {{ cardLorePreview.entries.length }} 条附带设定，其中 {{ cardLorePreview.conflicts }} 条冲突将跳过。</p>
            <button type="button" :disabled="busy||world.archived" @click="attachCardLore">
              {{ cardLorePreview.conflicts?'跳过冲突并导入':'导入私有设定' }}
            </button>
          </template>
          <button type="button" @click="cardLorePreview=null">关闭附带预览</button>
        </div>
        <fieldset :disabled="busy || world.archived">
          <legend>{{ actor.title }} · 生活资料授权</legend>
          <div v-for="[moduleId,label] in modules" :key="moduleId" :data-module="moduleId">
            {{ label }}
            <label v-for="[key,permission] in [['read','读取'],['remember','记忆'],['share','分享']]" :key="key">
              <input type="checkbox" :checked="grantOf(moduleId)?.[key]??false" @change="saveGrant(moduleId,key,$event)" />{{ permission }}
            </label>
          </div>
        </fieldset>
      </section>
    </template>
  </section>
</template>
