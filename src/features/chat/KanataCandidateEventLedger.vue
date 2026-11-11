<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { appConfirm, appPrompt, appToast, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'

const props=defineProps({model:{type:Object,required:true},eventId:{type:String,default:''},archived:Boolean})
const emit=defineEmits(['close','saved'])
const event=shallowRef(null),preview=shallowRef(null),audits=shallowRef(null),effectAudit=shallowRef(null)
const summary=ref(''),decision=ref(null),error=ref(''),busy=ref(false)
const kind=ref('note'),visibility=ref('private'),location=ref('')
const actor=shallowRef(null),relation=shallowRef(null),cause=shallowRef(null),choices=shallowRef(null)
const correction=ref('')
const ruleLabels={note:'记录',promise:'约定',support:'支持',conflict:'分歧',rest:'休息',move:'移动'}
const dialogOwner=Symbol('kanata-event-ledger')
let proposalKey=crypto.randomUUID()
const effectiveAt=Date.now()
let revokeKey,active=true
let requestSequence=0,requestScope=''
function guard(){if(!active)throw new Error('KANATA_EVENT_EDITOR_EXPIRED')}
function cancelRequest(scope){
  if(requestScope!==scope)return
  requestSequence++
  requestScope=''
  busy.value=false
}
function closeChoices(){cancelRequest('choices');choices.value=null}
function closePreview(){
  cancelRequest('preview')
  cancelOwnedFeedbackDialog(dialogOwner)
  preview.value=null
  decision.value=null
  correction.value=''
  revokeKey=undefined
}
function closeEffectAudit(){cancelRequest('effectAudit');effectAudit.value=null}
function closeAudits(){cancelRequest('audit');closeEffectAudit();audits.value=null}
async function perform(action,publish,scope='ledger'){
  if(busy.value)return
  const sequence=++requestSequence
  requestScope=scope
  const requestGuard=()=>{guard();if(sequence!==requestSequence)throw new Error('KANATA_EVENT_REQUEST_EXPIRED')}
  busy.value=true
  error.value=''
  try{
    const result=await action(requestGuard)
    requestGuard()
    if(result!==undefined)publish(result)
  }catch(failure){
    if(active&&sequence===requestSequence){
      const code=failure.code??failure.message
      if(/STALE|CONFLICT/.test(code)){
        error.value='事件或影响已经变化，请重新载入后确认。'
        preview.value=null
        decision.value=null
      }else error.value='事件操作未完成，请重试。'
    }
  }finally{if(active&&sequence===requestSequence){busy.value=false;requestScope=''}}
}
function load(){
  void perform(requestGuard=>props.model.eventDetail(props.eventId,requestGuard),value=>{
    if(!value)throw new Error('EVENT_UNAVAILABLE')
    event.value=value
  })
}
function choose(kind,cursor){
  const read=kind==='actor'?guard=>props.model.list('actors',cursor,guard)
    :kind==='relation'?guard=>props.model.eventProposalRelations(cursor,guard)
      :guard=>props.model.eventProposalCauses(cursor,guard)
  void perform(requestGuard=>read(requestGuard),value=>{choices.value={...value,kind}},'choices')
}
function selectChoice(row){
  if(choices.value.kind==='actor')actor.value=row
  else if(choices.value.kind==='relation')relation.value=row
  else cause.value=row
  choices.value=null
  proposalKey=crypto.randomUUID()
}
function propose(){
  if(props.archived||!summary.value.trim())return
  const rule=kind.value,usesRelation=rule==='support'||rule==='conflict',usesActor=rule==='rest'||rule==='move'
  if(usesRelation&&!relation.value||usesActor&&!actor.value||rule==='move'&&!location.value.trim()){
    error.value='请选择事件角色或关系，并填写所需的地点。'
    return
  }
  const participantIds=usesRelation?[relation.value.fromId,relation.value.toId]:actor.value?[actor.value.id]:[]
  const action=usesRelation?{relationshipId:relation.value.id}
    :usesActor?{instanceId:actor.value.id,...(rule==='move'&&{location:location.value.trim()})}:undefined
  const fields={worldId:props.model.worldId,summary:summary.value.trim(),effectiveAt,visibility:visibility.value,participantIds,
    sourceRefs:[],causedByEventIds:cause.value?[cause.value.id]:[],kind:rule,causality:'explicit',...(action&&{action})}
  void perform(requestGuard=>props.model.proposeEventAcknowledged(fields,proposalKey,requestGuard),value=>emit('saved',value.id))
}
function commit(){
  if(props.archived||event.value?.status!=='candidate')return
  void perform(async requestGuard=>{
    const accepted=await appConfirm('确认将此候选事件记入世界账本？',{title:'确认事件',confirmText:'记入账本',sensitive:true,owner:dialogOwner})
    requestGuard()
    if(accepted){
      await props.model.commitEventAcknowledged(event.value.id,event.value.revision,requestGuard)
      requestGuard()
      return props.model.eventDetail(event.value.id,requestGuard)
    }
  },value=>{event.value=value;appToast('事件已记入账本。',{tone:'success'})})
}
function openPreview(cursor,correct=false){
  if(props.archived)return
  void perform(async requestGuard=>{
    if(!cursor){
      revokeKey=crypto.randomUUID()
      decision.value=null
      preview.value=null
      correction.value=''
      if(correct){
        const summary=await appPrompt('填写修正说明。按预览撤销旧记录后，修正说明会保存为待确认候选。',
          event.value.summary,{title:'修正事件说明',confirmText:'预览修正影响',sensitive:true,owner:dialogOwner})
        requestGuard()
        if(!summary?.trim())return
        correction.value=summary.trim()
      }
    }
    return props.model.openRevocation(event.value.id,cursor,requestGuard)
  },value=>{preview.value=value},'preview')
}
function revoke(){
  if(props.archived||!preview.value||preview.value.plan.uncertainCount&&!decision.value)return
  const {plan}=preview.value
  const selected=decision.value??undefined
  void perform(async requestGuard=>{
    const count=selected==='mark-needs-review'?plan.uncertainCount:0
    const accepted=await appConfirm('将撤销 '+plan.revokeCount+' 条事件，并将 '+count+' 条推断后续标为待复核。请确认此范围。',
      {title:'确认撤销',confirmText:'撤销所列事件',sensitive:true,owner:dialogOwner})
    requestGuard()
    if(accepted){
      if(correction.value){
        const replacement=await props.model.correctConfirmedEvent(plan,selected,revokeKey,correction.value,requestGuard)
        requestGuard()
        emit('saved',replacement.id)
        return
      }
      await props.model.confirmRevocation(plan,selected,revokeKey,requestGuard)
      requestGuard()
      return props.model.eventDetail(event.value.id,requestGuard)
    }
  },value=>{
    event.value=value
    preview.value=null
    closeAudits()
    decision.value=null
    appToast('已撤销并重算有效影响。',{tone:'success'})
  },'preview')
}
function loadAudit(cursor){
  closeEffectAudit()
  void perform(requestGuard=>props.model.revocationAudits(event.value.id,cursor,requestGuard),value=>{audits.value=value},'audit')
}
function loadEffectAudit(auditId,cursor){
  void perform(requestGuard=>props.model.revocationEffectAudit(event.value.id,auditId,cursor,requestGuard),
    value=>{effectAudit.value={...value,auditId}},'effectAudit')
}
const unregister=registerBackHandler(()=>{emit('close');return true},{priority:610})
onBeforeUnmount(()=>{
  active=false
  unregister()
  cancelOwnedFeedbackDialog(dialogOwner)
  summary.value=location.value=correction.value=error.value=''
  actor.value=relation.value=cause.value=choices.value=null
  event.value=preview.value=audits.value=effectAudit.value=null
  decision.value=null
})
if(props.eventId)load()
</script>

<template>
  <section aria-label="候选事件账本">
    <button type="button" @click="emit('close')">关闭事件账本</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <form v-if="!eventId" class="kanata-form" @input="proposalKey=crypto.randomUUID()" @submit.prevent="propose">
      <label>事件摘要<textarea v-model="summary" maxlength="2000" required :disabled="busy||archived" /></label>
      <fieldset :disabled="busy||archived">
        <legend>事件类型</legend>
        <label v-for="(label,value) in ruleLabels" :key="value"><input v-model="kind" type="radio" :value="value" />{{ label }}</label>
      </fieldset>
      <fieldset :disabled="busy||archived">
        <legend>知情范围</legend>
        <label><input v-model="visibility" type="radio" value="private" />仅参与者</label>
        <label><input v-model="visibility" type="radio" value="public" />可用于群聊</label>
      </fieldset>
      <label v-if="kind==='move'">地点<input v-model="location" maxlength="200" required :disabled="busy||archived" /></label>
      <button v-if="kind==='support'||kind==='conflict'" type="button" :disabled="busy||archived" @click="choose('relation')">
        {{ relation?.title||'选择有向关系' }}
      </button>
      <button v-else type="button" :disabled="busy||archived" @click="choose('actor')">{{ actor?.title||'选择事件角色' }}</button>
      <button type="button" :disabled="busy||archived" @click="choose('cause')">{{ cause?.title||'选择明确前因' }}</button>
      <button v-if="cause" type="button" :disabled="busy||archived" @click="cause=null;proposalKey=crypto.randomUUID()">清除前因</button>
      <section v-if="choices" aria-label="选择事件资料">
        <p v-if="!choices.entries.length">没有可选的资料。</p>
        <button v-for="row in choices.entries" :key="row.id" :data-event-choice="row.id" type="button"
          :disabled="busy||archived" @click="selectChoice(row)">{{ row.title }}</button>
        <button v-if="choices.cursor" type="button" :disabled="busy||archived" @click="choose(choices.kind,choices.cursor)">载入下一页资料</button>
        <button type="button" @click="closeChoices">关闭选择</button>
      </section>
      <button type="submit" :disabled="busy||archived||!summary.trim()">保存候选事件</button>
    </form>
    <article v-else-if="event">
      <p>{{ event.summary }}</p>
      <p>状态：{{ ({candidate:'候选',committed:'已记入',revoked:'已撤销',needsReview:'待复核'})[event.status] }} · v{{ event.revision }}</p>
      <button v-if="event.status==='candidate'" type="button" :disabled="busy||archived" @click="commit">确认记入账本</button>
      <button v-if="event.status!=='revoked'" type="button" :disabled="busy||archived" @click="openPreview()">预览撤销</button>
      <button v-if="event.status!=='revoked'" type="button" :disabled="busy||archived" @click="openPreview(undefined,true)">修正事件说明</button>
      <button type="button" :disabled="busy" @click="loadAudit()">查看撤销审计</button>
      <section v-if="preview" aria-label="撤销范围">
        <p v-if="correction">修正说明将保存为待确认候选。</p>
        <p>撤销 {{ preview.plan.revokeCount }} 条。另有 {{ preview.plan.uncertainCount }} 条推断后续。</p>
        <ul><li v-for="row in preview.entries" :key="row.id">{{ row.id }} · v{{ row.revision }} · {{ row.disposition==='revoke'?'撤销':'推断后续' }} · 影响 {{ row.effectCount }} 项</li></ul>
        <button v-if="preview.cursor" type="button" :disabled="busy" @click="openPreview(preview.cursor)">下一页撤销范围</button>
        <fieldset v-if="preview.plan.uncertainCount" :disabled="busy">
          <legend>如何处理推断后续</legend>
          <label><input v-model="decision" type="radio" value="keep-independent" />保留现状</label>
          <label><input v-model="decision" type="radio" value="mark-needs-review" />标为待复核</label>
        </fieldset>
        <button type="button" @click="closePreview">关闭撤销预览</button>
        <button type="button" :disabled="busy||archived||(preview.plan.uncertainCount>0&&!decision)" @click="revoke">确认撤销范围</button>
      </section>
      <section v-if="audits" aria-label="撤销审计">
        <button type="button" @click="closeAudits">关闭撤销审计</button>
        <p v-if="!audits.entries.length">暂无撤销审计。</p>
        <ul><li v-for="row in audits.entries" :key="row.id">v{{ row.previousRevision }} → v{{ row.nextRevision }} · {{ row.status==='revoked'?'已撤销':'待复核' }} · 影响 {{ row.effectCount }} 项
          <button type="button" :disabled="busy" @click="loadEffectAudit(row.id)">查看逐项影响</button>
        </li></ul>
        <button v-if="audits.cursor" type="button" :disabled="busy" @click="loadAudit(audits.cursor)">下一页审计</button>
        <section v-if="effectAudit" aria-label="逐项影响审计">
          <p v-if="!effectAudit.complete">这条旧审计只保存了影响数量。</p>
          <p v-else-if="!effectAudit.total">此事件没有自有影响。</p>
          <ul>
            <li v-for="effect in effectAudit.entries" :key="effect.id">
              {{ effect.targetId }} · {{ effect.path }} · {{ effect.operation }} · {{ JSON.stringify(effect.value) }}
            </li>
          </ul>
          <button v-if="effectAudit.cursor" type="button" :disabled="busy"
            @click="loadEffectAudit(effectAudit.auditId,effectAudit.cursor)">下一页逐项影响</button>
          <button type="button" @click="closeEffectAudit">关闭逐项影响</button>
        </section>
      </section>
    </article>
    <button v-else type="button" :disabled="busy" @click="load">重新载入事件</button>
  </section>
</template>
