<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
const props=defineProps({model:{type:Object,required:true}})
const emit=defineEmits(['close','saved'])
const title=ref(''),page=shallowRef(null),selected=shallowRef([]),error=ref(''),busy=ref(false)
const options={id:'group-'+crypto.randomUUID(),commandId:crypto.randomUUID()}
let active=true
function assertRequest(){if(!active)throw new Error('KANATA_GROUP_EDITOR_EXPIRED')}
async function perform(action,publish){
  if(busy.value)return
  busy.value=true
  error.value=''
  try{
    const result=await action()
    assertRequest()
    publish(result)
  }catch(failure){
    if(active)error.value=/CONFLICT/.test(failure.code??failure.message)?'群聊资料已变化，请关闭后重试。':'群聊操作未完成，请重试。'
  }finally{if(active)busy.value=false}
}
function load(cursor){void perform(()=>props.model.list('actors',cursor,assertRequest),value=>{page.value=value})}
function toggle(row){
  selected.value=selected.value.some(item=>item.id===row.id)?selected.value.filter(item=>item.id!==row.id):[...selected.value,row]
}
function move(index,delta){
  const items=[...selected.value]
  const [item]=items.splice(index,1)
  items.splice(index+delta,0,item)
  selected.value=items
}
function save(){
  void perform(()=>props.model.createGroup({title:title.value,instanceIds:selected.value.map(row=>row.id)},options,assertRequest),
    result=>emit('saved',result.id))
}
onBeforeUnmount(()=>{active=false; title.value=''; page.value=null; selected.value=[]; error.value=''})
load()
</script>

<template>
  <section aria-label="候选创建群聊">
    <button type="button" @click="emit('close')">关闭建群</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <form class="kanata-form" @submit.prevent="save">
      <label>群聊名称<input v-model="title" maxlength="200" required :disabled="busy" /></label>
      <fieldset :disabled="busy">
        <legend>选择至少两位当前世界的角色</legend>
        <label v-for="row in page?.entries" :key="row.id">
          <input :checked="selected.some(item=>item.id===row.id)" type="checkbox" @change="toggle(row)" />{{ row.title }}
        </label>
        <button v-if="page?.cursor" type="button" @click="load(page.cursor)">更多角色</button>
        <button v-if="!page" type="button" @click="load()">载入角色</button>
      </fieldset>
      <ol aria-label="群聊成员顺序">
        <li v-for="(row,index) in selected" :key="row.id">
          {{ row.title }}
          <button type="button" :disabled="busy||index===0" @click="move(index,-1)">上移</button>
          <button type="button" :disabled="busy||index===selected.length-1" @click="move(index,1)">下移</button>
          <button type="button" :disabled="busy" @click="toggle(row)">移除</button>
        </li>
      </ol>
      <button type="submit" :disabled="busy||selected.length<2">创建独立群聊</button>
    </form>
  </section>
</template>
