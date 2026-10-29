<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {useKanataStore} from '../kanataStore.js'
import {createKanataExperienceRuntime} from '../../../application/kanataExperienceRuntime.js'
import {resolveKanataCharacter} from '../domain/kanataManagementCore.js'
import {appChoose,cancelOwnedFeedbackDialog} from '../../../services/uiFeedback.js'
import KanataMemoryPanel from './KanataMemoryPanel.vue'
import KanataEventsPanel from './KanataEventsPanel.vue'
import KanataPermissionsPanel from './KanataPermissionsPanel.vue'
const props=defineProps({worldId:{type:String,required:true},blocked:Boolean})
const store=useKanataStore(),runtime=createKanataExperienceRuntime(),tab=ref('memory'),instanceId=ref('')
const data=computed(()=>store.snapshot),members=computed(()=>data.value?.instances.filter(i=>i.worldId===props.worldId)||[])
const owner=Symbol('kanata-experience');let mounted=true
watch(()=>members.value.map(i=>i.id).join('|'),()=>{if(!members.value.some(i=>i.id===instanceId.value))instanceId.value=members.value[0]?.id||''},{immediate:true})
const choose=async()=>{const value=await appChoose({sensitive:true,owner,title:'选择要管理的角色实例',options:members.value.map(i=>({value:i.id,label:resolveKanataCharacter(data.value,i.id).name}))});if(mounted&&value)instanceId.value=value}
onBeforeUnmount(()=>{mounted=false;runtime.dispose();cancelOwnedFeedbackDialog(owner)})
</script>
<template>
  <section v-if="data" class="kanata-panel" aria-label="记忆事件与生活权限">
    <h3>经历与生活联动</h3><p class="kanata-help">原文、摘要、记忆和世界事件分别记录。这里的管理视图不会让角色自动知道其他私聊。</p>
    <button type="button" :disabled="!members.length" @click="choose">管理角色：{{ instanceId?resolveKanataCharacter(data,instanceId).name:'请先加入角色' }}</button>
    <nav class="kanata-actions" aria-label="经历管理分区"><button type="button" :aria-pressed="tab==='memory'" @click="tab='memory'">记忆</button><button type="button" :aria-pressed="tab==='events'" @click="tab='events'">世界事件</button><button type="button" :aria-pressed="tab==='permissions'" @click="tab='permissions'">生活联动</button></nav>
    <KanataMemoryPanel v-if="tab==='memory'&&instanceId" :key="instanceId" :data="data" :world-id="worldId" :instance-id="instanceId" :runtime="runtime" :blocked="blocked" />
    <KanataEventsPanel v-if="tab==='events'&&instanceId" :key="instanceId" :data="data" :world-id="worldId" :instance-id="instanceId" :runtime="runtime" :blocked="blocked" />
    <KanataPermissionsPanel v-if="tab==='permissions'&&instanceId" :key="instanceId" :data="data" :world-id="worldId" :instance-id="instanceId" :runtime="runtime" :blocked="blocked" />
  </section>
</template>
