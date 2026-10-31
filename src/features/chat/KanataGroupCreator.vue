<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {registerBackHandler} from '../../services/backNavigation.js'
import {resolveKanataCharacter} from './domain/kanataManagementCore.js'
const props=defineProps({data:{type:Object,required:true},worldId:{type:String,required:true},management:{type:Object,required:true},blocked:{type:Boolean,default:false}})
const emit=defineEmits(['created','message'])
const editing=ref(false),title=ref(''),selected=ref([]),busy=ref(false),error=ref('')
const attempted=ref(false),titleInput=ref(null),membersBox=ref(null)
let mounted=true
const members=computed(()=>props.data.instances.filter(i=>i.worldId===props.worldId))
const valid=computed(()=>title.value.trim().length>0&&title.value.length<=200&&selected.value.length>=2)
const titleError=computed(()=>attempted.value&&(!title.value.trim()||title.value.length>200)?'请填写不超过 200 字的群聊名称。':'')
const memberError=computed(()=>attempted.value&&selected.value.length<2?'请选择至少两名本世界角色。':'')
watch(()=>members.value.map(i=>i.id).join('|'),()=>{selected.value=selected.value.filter(id=>members.value.some(i=>i.id===id))})
const close=()=>{editing.value=false;title.value='';selected.value=[];error.value='';attempted.value=false}
const start=()=>{if(props.blocked||busy.value||members.value.length<2)return;title.value='新的群聊';selected.value=[];error.value='';editing.value=true}
const create=async()=>{
  if(props.blocked||busy.value)return
  attempted.value=true
  if(!valid.value){await nextTick();(titleError.value?titleInput.value:membersBox.value)?.focus();return}
  const worldId=props.worldId,fields={title:title.value.trim(),instanceIds:[...selected.value]},before=new Set(props.data.conversations.map(c=>c.id))
  busy.value=true;error.value=''
  try{
    const data=await props.management.createGroup(worldId,fields)
    const created=data.conversations.find(c=>!before.has(c.id)&&c.worldId===worldId&&c.type==='group')
    if(!created)throw Error('GROUP_RESULT_MISSING')
    if(mounted){close();emit('created',created.id)}
  }catch{
    await nextTick()
    if(mounted){
      // Store commits its newest draft before persistence. If that draft already contains this
      // group, let the existing global save retry complete it rather than creating a duplicate.
      const pending=props.data.conversations.find(c=>!before.has(c.id)&&c.worldId===worldId&&c.type==='group'&&c.title===fields.title&&c.participantIds.length===fields.instanceIds.length+1&&fields.instanceIds.every(id=>c.participantIds.includes(id)))
      if(pending){close();emit('message','群聊已保留在待保存资料中，请先使用“重试保存”，不会重复创建。')}
      else error.value='群聊未能创建。请核对当前世界和角色，或完成保存重试后再试。'
    }
  }finally{if(mounted)busy.value=false}
}
const unregister=registerBackHandler(()=>{close();return true},{priority:620,isActive:()=>editing.value})
onBeforeUnmount(()=>{mounted=false;close();unregister()})
</script>
<template>
  <div>
    <button v-if="!editing" type="button" :disabled="blocked||busy||members.length<2" @click="start">创建群聊</button>
    <p v-if="members.length<2" class="kanata-help">加入至少两名角色后，可以为这个世界创建群聊。</p>
    <form v-if="editing" class="kanata-form" aria-label="创建世界群聊" novalidate @submit.prevent="create">
      <label>群聊名称<input ref="titleInput" v-model="title" maxlength="200" required :disabled="busy||blocked" :aria-invalid="Boolean(titleError)" aria-describedby="kanata-group-title-error" /></label>
      <p v-if="titleError" id="kanata-group-title-error" role="alert" class="kanata-error">{{ titleError }}</p>
      <fieldset ref="membersBox" class="kanata-permission-fields" tabindex="-1" :aria-invalid="Boolean(memberError)" aria-describedby="kanata-group-members-error"><legend>选择本世界的角色（至少两名）</legend><label v-for="member in members" :key="member.id" class="kanata-check"><input v-model="selected" type="checkbox" :value="member.id" :disabled="busy||blocked" />{{ resolveKanataCharacter(data,member.id).name }}</label></fieldset>
      <p v-if="memberError" id="kanata-group-members-error" role="alert" class="kanata-error">{{ memberError }}</p>
      <p class="kanata-help">只建立新的会话，不复制已有聊天或记忆，不增加生活授权。创建操作不调用 AI；若已开启世界自主交流，角色之后可以在群内活动。</p>
      <p v-if="error" role="alert" class="kanata-error">{{ error }}</p>
      <div class="kanata-actions"><button type="submit" :disabled="blocked||busy">建立群聊</button><button type="button" :disabled="busy" @click="close">取消创建群聊</button></div>
    </form>
  </div>
</template>
