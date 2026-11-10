<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'

const props=defineProps({search:{type:Function,required:true},previewArchive:Function,confirmArchive:Function})
const emit=defineEmits(['close','locate'])
const text=ref(''),page=shallowRef(null),busy=ref(false),error=ref(false)
const plan=shallowRef(null),receipt=shallowRef(null)
const dialog=Symbol('candidate-history-archive')
let generation=0,commandId
function clear(){
  generation++
  page.value=plan.value=receipt.value=null
  cancelOwnedFeedbackDialog(dialog)
  busy.value=error.value=false
}
watch(text,clear,{flush:'sync'})
onBeforeUnmount(clear)
async function load(cursor){
  if(busy.value)return
  const version=++generation
  busy.value=true
  error.value=false
  const assertSearch=()=>{
    if(generation!==version)throw new Error('KANATA_HISTORY_OWNER_EXPIRED')
  }
  try{
    const result=await props.search(text.value,cursor,assertSearch)
    if(generation===version)page.value=result
  }catch{
    if(generation===version)error.value=true
  }finally{
    if(generation===version)busy.value=false
  }
}
async function archive(confirm){
  if(busy.value)return
  const version=++generation
  const guard=()=>{if(generation!==version)throw new Error('KANATA_HISTORY_OWNER_EXPIRED')}
  busy.value=true
  error.value=false
  try{
    if(!confirm){
      plan.value=null
      receipt.value=null
      const next=await props.previewArchive(guard)
      guard()
      plan.value=next
      commandId=crypto.randomUUID()
      return
    }
    const selected=plan.value
    const accepted=await appConfirm('整理 '+selected.count+' 条较早的消息？这些消息仍可查找、定位和引用。',
      {title:'确认整理历史',confirmText:'整理这些消息',sensitive:true,owner:dialog})
    guard()
    if(!accepted)return
    const result=await props.confirmArchive(selected,commandId,guard)
    guard()
    receipt.value=result
    plan.value=null
    page.value=null
  }catch(failure){
    if(generation===version){
      error.value=true
      if(/PREVIEW_STALE/.test(failure.code??failure.message))plan.value=null
    }
  }finally{
    if(generation===version)busy.value=false
  }
}
</script>

<template>
  <section class="kanata-panel" aria-label="会话历史">
    <header class="kanata-section-heading">
      <h3>会话历史</h3>
      <button type="button" @click="emit('close')">返回对话</button>
    </header>
    <form class="kanata-form" @submit.prevent="load()">
      <label>查找历史消息<input v-model="text" maxlength="200" type="search" placeholder="输入关键词，或留空查看最近消息" /></label>
      <button type="submit" :disabled="busy">{{ busy ? '正在读取…' : '查询历史' }}</button>
    </form>
    <button v-if="previewArchive" type="button" :disabled="busy" @click="archive(false)">预览整理较早聊天</button>
    <section v-if="plan" aria-label="历史整理预览">
      <p>可整理 {{ plan.count }} 条，保留最近 {{ plan.keepRecent }} 条及需要保护的来源和回复链。</p>
      <button v-if="plan.count" type="button" :disabled="busy" @click="archive(true)">确认整理历史</button>
      <button type="button" :disabled="busy" @click="plan=null">关闭预览</button>
    </section>
    <p v-if="receipt" role="status">已整理 {{ receipt.archivedCount }} 条消息。</p>
    <p v-if="error" role="alert" class="kanata-error">历史操作未完成，请重新预览或重试读取。</p>
    <p v-else-if="page && !page.messages.length" role="status">
      {{ page.cursor ? '本批没有匹配，仍可查询更早消息。' : '没有找到匹配的历史消息。' }}
    </p>
    <div v-if="page?.messages.length" class="kanata-chat-timeline" aria-label="本页历史消息">
      <article v-for="message in [...page.messages].reverse()" :key="message.id" class="kanata-chat-message">
        <strong>{{ message.senderNameSnapshot }}</strong>
        <p class="kanata-text">{{ message.content }}</p>
        <time :datetime="new Date(message.createdAt).toISOString()">{{ new Date(message.createdAt).toLocaleString() }}</time>
        <button type="button" @click="emit('locate',message.id)">在对话中定位</button>
      </article>
    </div>
    <button v-if="page?.cursor" type="button" :disabled="busy" @click="load(page.cursor)">更早一页</button>
  </section>
</template>
