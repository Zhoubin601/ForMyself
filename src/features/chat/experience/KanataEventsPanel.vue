<script setup>
import {computed,onBeforeUnmount,ref} from 'vue'
import {appChoose,appConfirm,appPrompt,cancelOwnedFeedbackDialog} from '../../../services/uiFeedback.js'
import {registerBackHandler} from '../../../services/backNavigation.js'
import {previewKanataEventRevoke} from './kanataEvents.js'
import {resolveKanataCharacter} from '../domain/kanataManagementCore.js'
const props=defineProps({data:{type:Object,required:true},worldId:{type:String,required:true},instanceId:{type:String,required:true},runtime:{type:Object,required:true},blocked:Boolean})
const draft=ref(null),busy=ref(false),notice=ref(''),error=ref(''),owner=Symbol('kanata-events');let mounted=true
const events=computed(()=>props.data.events.filter(e=>e.worldId===props.worldId))
const identity=computed(()=>props.data.identities.find(i=>i.worldId===props.worldId))
const name=id=>props.data.instances.some(i=>i.id===id)?resolveKanataCharacter(props.data,id).name:identity.value?.displayName||'用户'
const errors={EVENT_BASELINE_REQUIRED:'这个旧事件缺少可信的效果基线，不能安全自动撤销；请先人工核对，原数据未改。',EVENT_DEPENDENCY_UNCERTAIN:'依赖范围不明确，请在预览中选择如何处理不确定事件。',EVENT_REVOKE_PREVIEW_STALE:'预览后历史已变化，请重新预览。',EVENT_SOURCE_STALE:'来源记录已修订，请先核对来源，不能直接确认旧事实。'}
const perform=async(action,message)=>{if(props.blocked||busy.value)return;busy.value=true;error.value='';try{await action();if(mounted)notice.value=message;return true}catch(e){if(mounted)error.value=errors[e.code]||'事件操作未完成，请核对当前来源、参与者或保存状态。';return false}finally{if(mounted)busy.value=false}}
const create=()=>{draft.value={worldId:props.worldId,participantIds:[props.instanceId,identity.value.id],sourceRefs:[],causedByEventIds:[],visibility:'private',summary:'',effectiveAt:Date.now(),causality:'explicit',kind:'note',action:{instanceId:props.instanceId}}}
const chooseKind=async()=>{const value=await appChoose({sensitive:true,owner,title:'事件规则',message:'正文仅是候选说明；确认后只能应用下面已实现的规则，不接受模型直接指定数值。',options:[{value:'note',label:'记录：不修改状态'},{value:'promise',label:'约定：记录但不假定已履行'},{value:'support',label:'支持：小幅增加信任与理解'},{value:'conflict',label:'分歧：小幅降低信任与理解'},{value:'rest',label:'休息：恢复一点精力'},{value:'move',label:'移动：更新选中角色地点'}]});if(mounted&&draft.value&&value)draft.value.kind=value}
const chooseRelationship=async()=>{
  const choices=props.data.relationships.filter(r=>r.worldId===props.worldId&&r.fromId===props.instanceId)
  const value=await appChoose({sensitive:true,owner,title:'选择有向关系对象',options:choices.map(r=>({value:r.id,label:`${name(r.fromId)} → ${name(r.toId)}`}))})
  if(mounted&&draft.value&&value){const r=choices.find(r=>r.id===value);draft.value.action.relationshipId=value;draft.value.participantIds=[r.fromId,r.toId]}
}
const chooseCause=async()=>{const value=await appChoose({sensitive:true,owner,title:'明确的前因事件',options:[{value:'none',label:'没有已知前因'},...events.value.filter(e=>e.status==='committed').map(e=>({value:e.id,label:e.summary}))]});if(mounted&&draft.value&&value)draft.value.causedByEventIds=value==='none'?[]:[value]}
const save=async()=>{if(!draft.value?.summary.trim())return;const ok=await perform(()=>props.runtime.proposeEvent(draft.value),'已保存候选事件，尚未改变世界真值。');if(ok&&mounted)draft.value=null}
const commit=async event=>{const accepted=await appConfirm('将候选事件确认为发生过的事实，并按所选版本化规则计算状态变化。模型描述本身不会直接修改关系。',{sensitive:true,owner,title:'确认世界事件',confirmText:'确认并应用规则'});if(mounted&&accepted===true)await perform(()=>props.runtime.commitEvent(event.id,event.revision),'事件已确认，状态按规则更新。')}
const revoke=async(event,correct=false)=>{
  let summary
  if(correct){summary=await appPrompt('修正后的事件说明；旧事件会按因果预览撤销，新说明保存为待确认候选。',event.summary,{sensitive:true,owner,title:'修正历史事件'});if(!mounted||!summary?.trim())return}
  const plan=previewKanataEventRevoke(props.data,event.id)
  let decision
  if(plan.uncertainIds.length){decision=await appChoose({sensitive:true,owner,title:'存在不明确的后续依赖',message:plan.uncertainIds.map(id=>events.value.find(e=>e.id===id)?.summary||id).join('\n'),options:[{value:'mark-needs-review',label:'将这些后续事件标为待复核并暂停效果'},{value:'keep-independent',label:'我确认这些事件独立，保留其效果'}]});if(!mounted||!decision)return}
  const accepted=await appConfirm(`将撤销 ${plan.revokeIds.length} 条事件及明确的因果后续，从基线重算其余有效效果。独立事件不会被旧快照覆盖；相关记忆标为过期。`,{sensitive:true,owner,title:'预览事件撤销影响',confirmText:'按预览撤销并保留历史'})
  if(mounted&&accepted===true)await perform(()=>correct?props.runtime.correctEvent(plan,decision,summary):props.runtime.revokeEvent(plan,decision),correct?'旧事件已撤销，修正说明保存为新候选；再次核对后才生效。':'事件已撤销，独立效果已保留，历史审计仍可核对。')
}
const unregister=registerBackHandler(()=>{draft.value=null;return true},{priority:620,isActive:()=>!!draft.value})
onBeforeUnmount(()=>{mounted=false;draft.value=null;unregister();cancelOwnedFeedbackDialog(owner)})
</script>
<template>
  <section aria-label="世界事件账本"><h4>世界事件账本 · {{ events.length }} 条</h4><p class="kanata-help">静态设定不会自动变成已发生事件。候选、确认、待复核和撤销分别保存；规则版本及前后差异可追溯。</p><p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p><p v-if="error" class="kanata-error" role="alert">{{ error }}</p><button type="button" :disabled="blocked||busy" @click="create">提议世界事件</button>
    <form v-if="draft" class="kanata-form" @submit.prevent="save"><label>事件说明<textarea v-model="draft.summary" rows="4" maxlength="2000" required></textarea></label><button type="button" @click="chooseKind">事件类型：{{ draft.kind }}</button><button v-if="['support','conflict'].includes(draft.kind)" type="button" @click="chooseRelationship">关系对象：{{ draft.action.relationshipId?'已选择有向关系':'请选择' }}</button><label v-if="draft.kind==='move'">到达地点<input v-model="draft.action.location" maxlength="200" required /></label><button type="button" @click="chooseCause">前因：{{ draft.causedByEventIds.length?'已明确关联':'无已知前因' }}</button><p class="kanata-help">当前只涉及所选角色与明确参与者；默认私有，不自动公开给全世界。生效时间采用本次记录时间，不伪造旧经历。</p><div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存候选事件</button><button type="button" @click="draft=null">取消事件编辑</button></div></form>
    <article v-for="event in events" :key="event.id" class="kanata-experience-card"><h4>{{ event.summary }}</h4><p class="kanata-help">{{ event.status }} · v{{ event.revision }} · {{ event.kind||'历史规则' }} · {{ new Date(event.effectiveAt).toLocaleString() }}</p><p class="kanata-help">参与者：{{ event.participantIds.map(name).join('、') }}</p><details><summary>因果、效果及修订记录</summary><p>前因：{{ event.causedByEventIds.join('、')||'无明确前因' }}</p><ul><li v-for="effect in data.effects.filter(e=>e.eventId===event.id)" :key="effect.id">{{ effect.targetType }} · {{ effect.path }} · {{ effect.operation }} {{ effect.value }} · 规则v{{ effect.ruleVersion }}</li></ul><ul><li v-for="audit in (data.eventAudits||[]).filter(a=>a.eventId===event.id)" :key="audit.id">{{ new Date(audit.at).toLocaleString() }}：{{ audit.previous.status }} v{{ audit.previous.revision }} → {{ audit.next.status }} v{{ audit.next.revision }}</li></ul></details><div class="kanata-actions"><button v-if="event.status==='candidate'" type="button" :disabled="blocked||busy" @click="commit(event)">核对并确认事件</button><button v-if="event.status!=='revoked'" type="button" :disabled="blocked||busy" @click="revoke(event)">预览撤销影响</button><button v-if="event.status!=='revoked'" type="button" :disabled="blocked||busy" @click="revoke(event,true)">修正事件说明</button></div></article>
  </section>
</template>
