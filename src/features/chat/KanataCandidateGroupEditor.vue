<script setup>
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
const props=defineProps({model:{type:Object,required:true},editId:{type:String,default:''}})
const emit=defineEmits(['close','saved'])
const title=ref(''),page=shallowRef(null),selected=shallowRef([]),error=ref(''),busy=ref(false)
const snapshot=shallowRef(null),names=shallowRef(new Map()),offset=ref(0)
const visible=computed(()=>selected.value.slice(offset.value,offset.value+50))
const dialog=Symbol('kanata-group-editor')
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
    if(active){
      const code=failure.code??failure.message
      error.value=/CONFLICT/.test(code)?'群聊资料已变化，请关闭后重试。':code==='INVALID_GROUP_PARTICIPANTS'
        ?'只能选择当前世界的角色。':'群聊操作未完成，请重试。'
    }
  }finally{if(active)busy.value=false}
}
function load(cursor){void perform(()=>props.model.list('actors',cursor,assertRequest),value=>{page.value=value})}
function toggle(row){
  selected.value=selected.value.includes(row.id)?selected.value.filter(id=>id!==row.id):[...selected.value,row.id]
  if(offset.value>=selected.value.length&&offset.value)offset.value-=50
}
function memberName(id){return page.value?.entries.find(row=>row.id===id)?.title??names.value.get(id)??id}
function open(){
  void perform(async()=>{
    const actors=await props.model.list('actors',undefined,assertRequest)
    assertRequest()
    if(!props.editId)return {actors}
    const state=await props.model.groupEdit(props.editId,assertRequest)
    assertRequest()
    const ids=[],labels=new Map()
    let cursor
    do {
      const batch=await props.model.groupMemberPage(props.editId,state.revision,cursor,assertRequest)
      assertRequest()
      for(const row of batch.entries){
        ids.push(row.id)
        if(labels.size<50)labels.set(row.id,row.title)
      }
      cursor=batch.cursor
    } while(cursor!==null)
    return {actors,state,ids,labels}
  },({actors,state,ids,labels})=>{
    page.value=actors
    if(state){
      snapshot.value=state
      title.value=state.title
      selected.value=ids
      names.value=labels
    }
  })
}
function move(index,delta){
  const items=[...selected.value]
  const [item]=items.splice(index,1)
  items.splice(index+delta,0,item)
  selected.value=items
}
function save(){
  void perform(async()=>{
    if(!props.editId)return props.model.createGroup({title:title.value,instanceIds:selected.value},options,assertRequest)
    const current=snapshot.value
    if(!current)throw new Error('KANATA_GROUP_UNAVAILABLE')
    const commit=expectedHistory=>props.model.editGroupMembers(props.editId,{
      expectedRevision:current.revision,expectedHistory,instanceIds:selected.value,
      commandId:options.commandId,newGroupId:options.id,
    },assertRequest)
    if(!current.hasHistory){
      try{return await commit(false)}
      catch(failure){
        assertRequest()
        if((failure.code??failure.message)!=='KANATA_GROUP_HISTORY_CHANGED')throw failure
        snapshot.value={...current,hasHistory:true}
      }
    }
    const confirmed=await appConfirm('原群已有聊天记录。将按新名单另建空群，原群的成员、聊天和引用保持不变。',{
      title:'另建群聊',confirmText:'另建空群',sensitive:true,owner:dialog,
    })
    assertRequest()
    if(confirmed)return commit(true)
  },result=>{if(result)emit('saved',result.id,Boolean(props.editId),result.created)})
}
const unregister=registerBackHandler(()=>{emit('close');return true},{priority:610})
onBeforeUnmount(()=>{
  active=false
  unregister()
  cancelOwnedFeedbackDialog(dialog)
  title.value=''; page.value=snapshot.value=null; selected.value=[]; names.value=new Map(); error.value=''
})
open()
</script>

<template>
  <section :aria-label="editId?'候选编辑群聊成员':'候选创建群聊'">
    <button type="button" @click="emit('close')">{{ editId?'关闭成员编辑':'关闭建群' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <form class="kanata-form" @submit.prevent="save">
      <p v-if="editId">{{ title }}</p>
      <label v-else>群聊名称<input v-model="title" maxlength="200" required :disabled="busy" /></label>
      <fieldset :disabled="busy">
        <legend>选择至少两位当前世界的角色</legend>
        <label v-for="row in page?.entries" :key="row.id">
          <input :checked="selected.includes(row.id)" :data-actor-id="row.id" type="checkbox" @change="toggle(row)" />{{ row.title }}
        </label>
        <button v-if="page?.cursor" type="button" @click="load(page.cursor)">更多角色</button>
        <button v-if="!page" type="button" @click="open()">重新载入</button>
      </fieldset>
      <ol aria-label="群聊成员顺序">
        <li v-for="(id,index) in visible" :key="id">
          {{ memberName(id) }}
          <button type="button" :disabled="busy||offset+index===0" @click="move(offset+index,-1)">上移</button>
          <button type="button" :disabled="busy||offset+index===selected.length-1" @click="move(offset+index,1)">下移</button>
          <button type="button" :disabled="busy" @click="toggle({id})">移除</button>
        </li>
      </ol>
      <button v-if="offset" type="button" :disabled="busy" @click="offset-=50">上一页成员</button>
      <button v-if="offset+50<selected.length" type="button" :disabled="busy" @click="offset+=50">下一页成员</button>
      <button type="submit" :disabled="busy||selected.length<2||(editId&&!snapshot)">{{ editId?'保存成员':'创建独立群聊' }}</button>
    </form>
  </section>
</template>
