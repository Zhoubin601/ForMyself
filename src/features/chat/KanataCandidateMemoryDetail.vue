<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
const props=defineProps({model:{type:Object,required:true},memoryId:{type:String,required:true}})
const emit=defineEmits(['close'])
const actors=shallowRef(null),detail=shallowRef(null),sources=shallowRef(null),source=shallowRef(null)
const actorId=ref(''),busy=ref(false),error=ref('')
let generation=0
async function read(action,publish) {
  const owned=++generation
  const assertRequest=()=>{
    if(owned!==generation)throw new Error('KANATA_MEMORY_VIEW_EXPIRED')
  }
  busy.value=true
  error.value=''
  try {
    const result=await action(assertRequest)
    assertRequest()
    publish(result)
  } catch (failure) {
    if(owned===generation) {
      const code=failure.code??failure.message
      error.value=/DENIED/.test(code)?'此角色无权查看该记忆或来源。':/STALE/.test(code)?'来源版本已变化，请重新核对。':'记忆或来源未能读取，请重试。'
    }
  } finally {
    if(owned===generation)busy.value=false
  }
}
function loadActors(cursor) {
  void read(guard=>props.model.list('actors',cursor,guard),value=>{actors.value=value})
}
function selectActor(id) {
  actorId.value=id
  detail.value=sources.value=source.value=null
  void read(async guard=>{
    const record=await props.model.memoryDetail(props.memoryId,id,guard)
    const refs=await props.model.memorySources(props.memoryId,id,undefined,guard)
    return {record,refs}
  },({record,refs})=>{detail.value=record; sources.value=refs})
}
function loadSources(cursor) {
  const id=actorId.value
  sources.value=source.value=null
  void read(guard=>props.model.memorySources(props.memoryId,id,cursor,guard),value=>{sources.value=value})
}
function resolveSource(ref) {
  source.value=null
  const id=actorId.value
  void read(guard=>props.model.memorySource(props.memoryId,id,ref,guard),value=>{source.value=value})
}
onBeforeUnmount(()=>{
  generation++
  actorId.value=''
  actors.value=detail.value=sources.value=source.value=null
  error.value=''
})
loadActors()
</script>

<template>
  <section aria-label="候选记忆来源">
    <button type="button" @click="emit('close')">关闭记忆详情</button>
    <p v-if="busy" role="status">正在核对权限和来源…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <fieldset v-if="actors">
      <legend>以角色身份查看</legend>
      <button v-for="item in actors.entries" :key="item.id" type="button" :aria-pressed="actorId===item.id" @click="selectActor(item.id)">{{ item.title }}</button>
      <button v-if="actors.cursor" type="button" @click="loadActors(actors.cursor)">更多角色</button>
    </fieldset>
    <button v-if="!actors && !busy" type="button" @click="loadActors()">重试载入角色</button>
    <article v-if="detail">
      <h4>{{ detail.key }} · {{ detail.layer }}</h4>
      <p class="kanata-text">{{ detail.content }}</p>
      <ul v-if="sources">
        <li v-for="link in sources.entries" :key="link.messageId">
          <button type="button" :disabled="busy" @click="resolveSource(link)">{{ link.messageId }} · v{{ link.revision }}</button>
        </li>
      </ul>
      <button v-if="sources?.cursor" type="button" :disabled="busy" @click="loadSources(sources.cursor)">更多来源</button>
      <p v-if="source" class="kanata-text">{{ source.archived?'已归档 · ':'' }}{{ source.content }}</p>
    </article>
  </section>
</template>
