<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
const props=defineProps({model:{type:Object,required:true}})
const emit=defineEmits(['close'])
const roles=[['global','全局默认'],['home','首页'],['mood','心情'],['weight','体重'],['savings','省钱'],['schedule','日程'],['todo','待办'],['reports','报告']]
const scope=ref('global'),bindings=shallowRef(null),worlds=shallowRef(null),actors=shallowRef(null)
const worldId=ref(''),busy=ref(false),error=ref('')
let active=true, generation=0
async function read(action,publish){
  const version=++generation
  const guard=()=>{if(!active||version!==generation)throw new Error('KANATA_BINDING_REQUEST_EXPIRED')}
  busy.value=true
  error.value=''
  try{
    const result=await action(guard)
    guard()
    publish(result)
  }catch(failure){
    if(active&&version===generation)error.value=/CONFLICT/.test(failure?.code??failure?.message)?'绑定已变化，请重新载入。':'绑定操作未完成，请核对所选世界或角色。'
  }finally{if(active&&version===generation)busy.value=false}
}
function reload(){
  void read(async guard=>({bindings:await props.model.read(guard),worlds:await props.model.worlds(undefined,guard)}),
    result=>{bindings.value=result.bindings;worlds.value=result.worlds})
}
function loadWorlds(cursor){void read(guard=>props.model.worlds(cursor,guard),value=>{worlds.value=value})}
function loadActors(id,cursor){
  worldId.value=id
  actors.value=null
  void read(guard=>props.model.actors(id,cursor,guard),value=>{actors.value=value})
}
function save(selection){
  if(!bindings.value||busy.value)return
  void read(guard=>props.model.set(scope.value,selection,bindings.value.revision,guard),()=>emit('close'))
}
onBeforeUnmount(()=>{
  active=false
  generation++
  props.model.dispose()
  bindings.value=worlds.value=actors.value=null
  worldId.value=''
})
reload()
</script>

<template>
  <section aria-label="候选生活角色绑定">
    <button type="button" @click="emit('close')">关闭生活角色绑定</button>
    <p v-if="busy" role="status">正在读取或保存绑定…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" :disabled="busy" @click="reload">重新载入绑定</button>
    <fieldset :disabled="busy">
      <legend>绑定范围</legend>
      <label v-for="[id,label] in roles" :key="id"><input v-model="scope" type="radio" :value="id" />{{ label }}</label>
    </fieldset>
    <p v-if="bindings">
      当前设置 {{ scope==='global' ? bindings.global?.instanceId||'未选择' : Object.hasOwn(bindings.modules,scope) ? bindings.modules[scope]?.instanceId||'明确不选' : '继承全局' }}
    </p>
    <button type="button" :disabled="busy||!bindings" @click="save(null)">解除绑定</button>
    <button v-if="scope!=='global'" type="button" :disabled="busy||!bindings" @click="save('inherit')">继承全局</button>
    <ul v-if="worlds">
      <li v-for="world in worlds.entries" :key="world.id">
        <button type="button" :disabled="busy||world.archived" @click="loadActors(world.id)">{{ world.title }}</button>
      </li>
    </ul>
    <button v-if="worlds?.cursor" type="button" :disabled="busy" @click="loadWorlds(worlds.cursor)">更多绑定世界</button>
    <ul v-if="actors">
      <li v-for="actor in actors.entries" :key="actor.id">
        <button type="button" :disabled="busy" @click="save({worldId,instanceId:actor.id})">绑定 {{ actor.title }}</button>
      </li>
    </ul>
    <button v-if="actors?.cursor" type="button" :disabled="busy" @click="loadActors(worldId,actors.cursor)">更多可绑定角色</button>
  </section>
</template>
