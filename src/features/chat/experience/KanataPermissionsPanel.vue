<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {appChoose,cancelOwnedFeedbackDialog} from '../../../services/uiFeedback.js'
import {resolveKanataCharacter} from '../domain/kanataManagementCore.js'
import {resolveKanataRoleBinding} from './kanataKnowledge.js'
const props=defineProps({data:{type:Object,required:true},worldId:{type:String,required:true},instanceId:{type:String,required:true},runtime:{type:Object,required:true},blocked:Boolean})
const modules=[{id:'home',name:'首页陪伴'},{id:'mood',name:'心情日记'},{id:'weight',name:'体重记录'},{id:'savings',name:'省钱计划'},{id:'schedule',name:'日程'},{id:'todo',name:'待办'},{id:'reports',name:'生活报告'}]
const drafts=ref({}),busy=ref(false),notice=ref(''),error=ref(''),owner=Symbol('kanata-permissions');let mounted=true
watch(()=>props.instanceId,()=>{drafts.value=Object.fromEntries(modules.map(m=>{const g=props.data.lifeGrants.find(g=>g.worldId===props.worldId&&g.instanceId===props.instanceId&&g.moduleId===m.id);return[m.id,{read:g?.read||false,remember:g?.remember||false,share:g?.share||false}]}))},{immediate:true})
const selectedName=computed(()=>resolveKanataCharacter(props.data,props.instanceId).name)
const perform=async(action,message)=>{if(props.blocked||busy.value)return;busy.value=true;error.value='';try{await action();if(mounted)notice.value=message}catch{if(mounted)error.value='授权或绑定未能保存，请核对实例和保存状态。'}finally{if(mounted)busy.value=false}}
const bindingLabel=moduleId=>{const result=resolveKanataRoleBinding(props.data,moduleId);if(result.status==='unavailable')return'已绑定实例不可用，请重新选择';if(result.status==='unselected')return'未选择角色';return props.data.worlds.find(w=>w.id===result.binding.worldId)?.name+' · '+resolveKanataCharacter(props.data,result.binding.instanceId).name}
const chooseBinding=async moduleId=>{
  const choices=props.data.instances.filter(i=>props.data.worlds.some(w=>w.id===i.worldId&&!w.archived)).map(i=>({value:JSON.stringify({worldId:i.worldId,instanceId:i.id}),label:`${props.data.worlds.find(w=>w.id===i.worldId)?.name} · ${resolveKanataCharacter(props.data,i.id).name}`}))
  const value=await appChoose({sensitive:true,owner,title:moduleId==='global'?'全局默认陪伴角色':'模块独立角色',message:'绑定精确到世界和实例，失效时不会按同名角色自动替换。',options:[{value:'none',label:'不使用角色'},...(moduleId==='global'?[]:[{value:'inherit',label:'沿用全局默认角色'}]),...choices]})
  if(mounted&&value)await perform(()=>props.runtime.setBinding(moduleId,value==='none'?null:value==='inherit'?'inherit':JSON.parse(value)),'角色绑定已保存；绑定本身不会授予生活数据权限。')
}
onBeforeUnmount(()=>{mounted=false;drafts.value={};cancelOwnedFeedbackDialog(owner)})
</script>
<template>
  <section aria-label="角色生活模块权限"><h4>{{ selectedName }} · 三项独立权限</h4><p class="kanata-help">读取不等于长期记忆，记忆不等于分享。真实生活信息默认不转发；接收角色也需独立授权，不能无限转发。撤权会停止后续使用并将相关派生记忆标为过期，原文及旧备份由你另行管理。</p><p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p><p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <button type="button" :disabled="blocked||busy" @click="chooseBinding('global')">选择全局默认角色</button><p class="kanata-help">首页和报告是汇总入口；其中的心情、体重、财务等内容仍分别检查对应模块授权。</p>
    <article v-for="module in modules" :key="module.id" class="kanata-experience-card"><h4>{{ module.name }}</h4><fieldset v-if="drafts[module.id]" class="kanata-permission-fields"><legend>{{ selectedName }} 在本世界的授权</legend><label class="kanata-check"><input v-model="drafts[module.id].read" type="checkbox" :disabled="blocked||busy" />允许读取</label><label class="kanata-check"><input v-model="drafts[module.id].remember" type="checkbox" :disabled="blocked||busy" />允许长期记忆</label><label class="kanata-check"><input v-model="drafts[module.id].share" type="checkbox" :disabled="blocked||busy" />允许向其他角色分享</label></fieldset><div class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="perform(()=>runtime.setGrant(worldId,instanceId,module.id,drafts[module.id]),'独立授权已保存；旧派生内容不会绕过新权限。')">保存{{ module.name }}授权</button><button type="button" :disabled="blocked||busy" @click="chooseBinding(module.id)">选择{{ module.name }}角色</button></div><p class="kanata-help">当前模块绑定：{{ bindingLabel(module.id) }}</p></article>
  </section>
</template>
