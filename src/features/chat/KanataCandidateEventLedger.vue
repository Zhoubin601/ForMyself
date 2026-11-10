<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { appConfirm, appToast, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'

const props=defineProps({model:{type:Object,required:true},eventId:{type:String,default:''},archived:Boolean})
const emit=defineEmits(['close','saved'])
const event=shallowRef(null),preview=shallowRef(null),audits=shallowRef(null)
const summary=ref(''),decision=ref(null),error=ref(''),busy=ref(false)
const dialogOwner=Symbol('kanata-event-ledger')
const proposalKey=crypto.randomUUID(),effectiveAt=Date.now()
let revokeKey,active=true
function guard(){if(!active)throw new Error('KANATA_EVENT_EDITOR_EXPIRED')}
async function perform(action,publish){
  if(busy.value)return
  busy.value=true
  error.value=''
  try{
    const result=await action()
    guard()
    if(result!==undefined)publish(result)
  }catch(failure){
    if(active){
      const code=failure.code??failure.message
      if(/STALE|CONFLICT/.test(code)){
        error.value='事件或影响已经变化，请重新载入后确认。'
        preview.value=null
        decision.value=null
      }else error.value='事件操作未完成，请重试。'
    }
  }finally{if(active)busy.value=false}
}
function load(){
  void perform(()=>props.model.eventDetail(props.eventId,guard),value=>{
    if(!value)throw new Error('EVENT_UNAVAILABLE')
    event.value=value
  })
}
function propose(){
  if(props.archived||!summary.value.trim())return
  void perform(()=>props.model.proposeEvent({worldId:props.model.worldId,summary:summary.value.trim(),effectiveAt,
    visibility:'private',participantIds:[],sourceRefs:[],causedByEventIds:[],kind:'note',causality:'explicit'},proposalKey,guard),
  value=>emit('saved',value.id))
}
function commit(){
  if(props.archived||event.value?.status!=='candidate')return
  void perform(async()=>{
    const accepted=await appConfirm('确认将此候选事件记入世界账本？',{title:'确认事件',confirmText:'记入账本',sensitive:true,owner:dialogOwner})
    guard()
    if(accepted){
      await props.model.commitEvent(event.value.id,event.value.revision,guard)
      return props.model.eventDetail(event.value.id,guard)
    }
  },value=>{event.value=value;appToast('事件已记入账本。',{tone:'success'})})
}
function openPreview(cursor){
  if(props.archived)return
  if(!cursor){
    revokeKey=crypto.randomUUID()
    decision.value=null
    preview.value=null
  }
  void perform(()=>props.model.openRevocation(event.value.id,cursor,guard),value=>{preview.value=value})
}
function revoke(){
  if(props.archived||!preview.value||preview.value.plan.uncertainCount&&!decision.value)return
  const {plan}=preview.value
  const selected=decision.value??undefined
  void perform(async()=>{
    const count=selected==='mark-needs-review'?plan.uncertainCount:0
    const accepted=await appConfirm('将撤销 '+plan.revokeCount+' 条事件，并将 '+count+' 条推断后续标为待复核。请确认此范围。',
      {title:'确认撤销',confirmText:'撤销所列事件',sensitive:true,owner:dialogOwner})
    guard()
    if(accepted){
      await props.model.confirmRevocation(plan,selected,revokeKey,guard)
      return props.model.eventDetail(event.value.id,guard)
    }
  },value=>{
    event.value=value
    preview.value=null
    audits.value=null
    decision.value=null
    appToast('已撤销并重算有效影响。',{tone:'success'})
  })
}
function loadAudit(cursor){
  void perform(()=>props.model.revocationAudits(event.value.id,cursor,guard),value=>{audits.value=value})
}
const unregister=registerBackHandler(()=>{emit('close');return true},{priority:610})
onBeforeUnmount(()=>{
  active=false
  unregister()
  cancelOwnedFeedbackDialog(dialogOwner)
  summary.value=error.value=''
  event.value=preview.value=audits.value=null
  decision.value=null
})
if(props.eventId)load()
</script>

<template>
  <section aria-label="候选事件账本">
    <button type="button" @click="emit('close')">关闭事件账本</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <form v-if="!eventId" class="kanata-form" @submit.prevent="propose">
      <label>事件摘要<textarea v-model="summary" maxlength="2000" required :disabled="busy||archived" /></label>
      <button type="submit" :disabled="busy||archived||!summary.trim()">保存候选事件</button>
    </form>
    <article v-else-if="event">
      <p>{{ event.summary }}</p>
      <p>状态：{{ ({candidate:'候选',committed:'已记入',revoked:'已撤销',needsReview:'待复核'})[event.status] }} · v{{ event.revision }}</p>
      <button v-if="event.status==='candidate'" type="button" :disabled="busy||archived" @click="commit">确认记入账本</button>
      <button v-if="event.status!=='revoked'" type="button" :disabled="busy||archived" @click="openPreview()">预览撤销</button>
      <button type="button" :disabled="busy" @click="loadAudit()">查看撤销审计</button>
      <section v-if="preview" aria-label="撤销范围">
        <p>撤销 {{ preview.plan.revokeCount }} 条。另有 {{ preview.plan.uncertainCount }} 条推断后续。</p>
        <ul><li v-for="row in preview.entries" :key="row.id">{{ row.id }} · v{{ row.revision }} · {{ row.disposition==='revoke'?'撤销':'推断后续' }} · 影响 {{ row.effectCount }} 项</li></ul>
        <button v-if="preview.cursor" type="button" :disabled="busy" @click="openPreview(preview.cursor)">下一页撤销范围</button>
        <fieldset v-if="preview.plan.uncertainCount" :disabled="busy">
          <legend>如何处理推断后续</legend>
          <label><input v-model="decision" type="radio" value="keep-independent" />保留现状</label>
          <label><input v-model="decision" type="radio" value="mark-needs-review" />标为待复核</label>
        </fieldset>
        <button type="button" :disabled="busy" @click="preview=null;decision=null">关闭撤销预览</button>
        <button type="button" :disabled="busy||archived||(preview.plan.uncertainCount>0&&!decision)" @click="revoke">确认撤销范围</button>
      </section>
      <section v-if="audits" aria-label="撤销审计">
        <p v-if="!audits.entries.length">暂无撤销审计。</p>
        <ul><li v-for="row in audits.entries" :key="row.id">v{{ row.previousRevision }} → v{{ row.nextRevision }} · {{ row.status==='revoked'?'已撤销':'待复核' }} · 影响 {{ row.effectCount }} 项</li></ul>
        <button v-if="audits.cursor" type="button" :disabled="busy" @click="loadAudit(audits.cursor)">下一页审计</button>
      </section>
    </article>
    <button v-else type="button" :disabled="busy" @click="load">重新载入事件</button>
  </section>
</template>
