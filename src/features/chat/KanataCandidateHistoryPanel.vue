<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props=defineProps({search:{type:Function,required:true}})
const emit=defineEmits(['close','locate'])
const text=ref(''),page=shallowRef(null),busy=ref(false),error=ref(false)
let generation=0
function clear(){
  generation++
  page.value=null
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
    <p v-if="error" role="alert" class="kanata-error">历史未能安全读取，请重试。</p>
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
