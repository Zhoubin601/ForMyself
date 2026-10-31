<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useKanataStore } from './kanataStore.js'
import { useProtectedAccessStore } from '../../stores/protectedAccess.js'
import { restoreState } from '../../platform/storage/restoreState.js'
import { appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
const props=defineProps({conversationId:{type:String,required:true}})
const emit=defineEmits(['close','revise'])
const store=useKanataStore(),access=useProtectedAccessStore()
const query=ref(''),rows=ref([]),cursor=ref(null),busy=ref(false),error=ref(''),notice=ref('')
const conversation=computed(()=>store.snapshot?.conversations.find(c=>c.id===props.conversationId))
const world=computed(()=>store.snapshot?.worlds.find(w=>w.id===conversation.value?.worldId))
const archivedCount=computed(()=>store.snapshot?.messageArchives?.filter(p=>p.conversationId===props.conversationId).reduce((n,p)=>n+p.messages.length,0)||0)
const blocked=computed(()=>!store.isDataLoaded||restoreState.blocked||store.hasPendingSave||Boolean(store.saveError)||Boolean(store.archiveError))
const ordered=computed(()=>[...rows.value].reverse())
const owner=Symbol('kanata-history'),messages={KANATA_ARCHIVE_CURSOR_EXPIRED:'对话已有变化，请重新查询。',KANATA_ARCHIVE_QUERY_BUDGET_EXCEEDED:'匹配范围较广，请输入更具体的关键词后重试。',KANATA_ARCHIVE_BUSY:'正在整理历史，请稍后重试。'}
let mounted=true,generation=0
const clear=()=>{++generation;rows.value=[];cursor.value=null;error.value='';notice.value='';query.value=''}
watch(()=>[props.conversationId,store.isDataLoaded],clear,{flush:'sync'})
watch(query,()=>{++generation;rows.value=[];cursor.value=null},{flush:'sync'})
const load=async(next=false)=>{
  if(busy.value||blocked.value||!conversation.value)return
  busy.value=true;error.value='';notice.value=''
  const target={worldId:conversation.value.worldId,conversationId:props.conversationId,text:query.value,cursor:next?cursor.value:undefined},version=++generation
  if(!next){rows.value=[];cursor.value=null}
  try{
    const result=await access.runOperation(['chat'],()=>store.readHistory(target))
    if(mounted&&version===generation){rows.value=result.messages;cursor.value=result.cursor;if(!result.messages.length)notice.value='没有找到匹配的历史消息。'}
  }catch(failure){if(mounted&&version===generation)error.value=messages[failure.code]||'历史未能安全读取，请重试或重新解锁。'}
  finally{if(mounted)busy.value=false}
}
const archive=async()=>{
  if(busy.value||blocked.value||world.value?.archived||!conversation.value)return
  const target={worldId:conversation.value.worldId,conversationId:props.conversationId,keepRecent:200},version=generation
  const accepted=await appConfirm('将较早的聊天移入加密历史，保留最近 200 条及所有仍被引用的原文。消息仍可查询、备份和修订。',{title:'整理本会话历史',confirmText:'整理历史',sensitive:true,owner})
  if(!mounted||version!==generation||!accepted)return
  busy.value=true;error.value='';rows.value=[];cursor.value=null
  try{const result=await access.runOperation(['chat'],()=>store.archiveHistory(target));if(mounted&&version===generation)notice.value=`已整理 ${result.archivedCount} 条消息；仍被引用的原文继续保留。`}
  catch{if(mounted&&version===generation)error.value='整理暂未完成，请先重试保存；聊天内容仍会保留。'}
  finally{if(mounted)busy.value=false}
}
const revise=async message=>{
  if(busy.value||blocked.value||world.value?.archived)return
  const version=++generation,target={worldId:message.worldId,conversationId:props.conversationId,messageId:message.id}
  busy.value=true;error.value=''
  try{await access.runOperation(['chat'],()=>store.activateHistoryMessage(target));if(mounted&&version===generation)emit('revise',{id:message.id,revision:message.revision,content:message.content})}
  catch{if(mounted&&version===generation)error.value='原文未能安全载入，请检查保存状态后重试。'}
  finally{if(mounted)busy.value=false}
}
onBeforeUnmount(()=>{mounted=false;clear();cancelOwnedFeedbackDialog(owner)})
</script>
<template>
  <section class="kanata-panel" aria-label="会话历史">
    <header class="kanata-section-heading"><h3>会话历史</h3><button type="button" @click="emit('close')">返回对话</button></header>
    <p class="kanata-help">已存入加密历史 {{ archivedCount }} 条。每页最多 50 条；检索只查询这个世界的当前会话。</p>
    <form class="kanata-form" @submit.prevent="load(false)"><label>查找历史消息<input v-model="query" maxlength="200" type="search" placeholder="输入关键词，或留空查看最近消息" :disabled="busy||blocked" /></label><div class="kanata-actions"><button type="submit" :disabled="busy||blocked">{{ busy?'正在读取…':'查询历史' }}</button><button type="button" :disabled="busy||blocked||world?.archived" @click="archive">整理较早聊天</button></div></form>
    <p v-if="error" role="alert" class="kanata-error">{{ error }}</p><p v-if="notice" role="status" class="kanata-notice">{{ notice }}</p>
    <div class="kanata-chat-timeline" aria-label="本页历史消息"><article v-for="message in ordered" :key="message.id" class="kanata-chat-message" :class="{'is-user':message.role==='user'}"><strong>{{ message.senderNameSnapshot }}</strong><p class="kanata-text">{{ message.content }}</p><time :datetime="new Date(message.createdAt).toISOString()">{{ new Date(message.createdAt).toLocaleString() }}</time><button type="button" :disabled="busy||blocked||world?.archived" @click="revise(message)">修订历史原文</button></article></div>
    <div class="kanata-actions"><button type="button" :disabled="busy||blocked||!cursor" @click="load(true)">更早一页</button><button type="button" :disabled="busy||blocked" @click="load(false)">回到最近一页</button></div>
  </section>
</template>
