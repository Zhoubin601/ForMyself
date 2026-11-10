<script setup>
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { appConfirm, appPrompt, appToast, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { registerBackHandler } from '../../services/backNavigation.js'
const props=defineProps({model:{type:Object,required:true},memoryId:{type:String,required:true},archived:Boolean})
const emit=defineEmits(['close','open-related','removed'])
const actors=shallowRef(null),detail=shallowRef(null),sources=shallowRef(null),source=shallowRef(null)
const actorId=ref(''),busy=ref(false),error=ref('')
const conflicts=shallowRef(null),sharing=ref(false),recipient=shallowRef(null)
const outgoingShares=shallowRef(null)
const withdrawCommands=new Map()
const dialog=Symbol('kanata-managed-memory')
let shareKey,resolveKey,removeKey,generation=0
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
    if(result!==undefined)publish(result)
  } catch (failure) {
    if(owned===generation) {
      const code=failure.code??failure.message
      if(/STALE|CONFLICT/.test(code))conflicts.value=null
      error.value=/DENIED/.test(code)?'此角色无权操作该记忆，或授权已变化。':/STALE|CONFLICT/.test(code)?'记忆或来源已变化，请重新核对。':'记忆操作未完成，请重试。'
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
  cancelOwnedFeedbackDialog(dialog)
  sharing.value=false
  recipient.value=conflicts.value=outgoingShares.value=null
  withdrawCommands.clear()
  removeKey=crypto.randomUUID()
  detail.value=sources.value=source.value=null
  void read(async guard=>{
    const record=await props.model.memoryDetail(props.memoryId,id,guard)
    guard()
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
function loadConflicts(cursor){
  if(!cursor)resolveKey=crypto.randomUUID()
  source.value=null
  void read(guard=>props.model.memoryConflicts(props.memoryId,actorId.value,cursor,guard),value=>{conflicts.value=value})
}
function resolveConflicts(){
  if(props.archived||!conflicts.value||busy.value)return
  const {plan}=conflicts.value,id=actorId.value
  void read(async guard=>{
    const ok=await appConfirm(plan.count?'采用当前内容，并保留其他 '+plan.count+' 条冲突记录为过期？':'核对来源并采用当前内容？',
      {title:'核对记忆',confirmText:'采用当前内容',sensitive:true,owner:dialog})
    guard()
    if(ok){
      await props.model.confirmMemoryConflicts(id,plan,resolveKey,guard)
      return props.model.memoryDetail(props.memoryId,id,guard)
    }
  },value=>{
    detail.value=value
    conflicts.value=source.value=sources.value=null
    appToast('已采用当前记忆。',{tone:'success'})
  })
}
function mergeConflicts(){
  if(props.archived||!conflicts.value?.plan.count||busy.value)return
  const {plan}=conflicts.value,id=actorId.value
  void read(async guard=>{
    const content=await appPrompt('填写要保留的正文。会合并预览范围内未处理记录的来源，旧记录保留为过期。',
      detail.value.content,{title:'合并冲突记忆',confirmText:'确认合并',sensitive:true,owner:dialog})
    guard()
    if(!content?.trim())return
    await props.model.mergeMemoryConflicts(id,plan,resolveKey,content,guard)
    return props.model.memoryDetail(props.memoryId,id,guard)
  },value=>{
    detail.value=value
    conflicts.value=source.value=sources.value=null
    appToast('已合并正文和来源。',{tone:'success'})
  })
}
function beginShare(){
  sharing.value=true
  recipient.value=null
  shareKey=crypto.randomUUID()
}
function saveShare(){
  if(props.archived||!recipient.value||busy.value)return
  const id=actorId.value,to=recipient.value.id,rev=detail.value.revision
  void read(async guard=>{
    const ok=await appConfirm('分享一份私有记忆给选定角色？此操作将核对双方权限。',
      {title:'分享记忆',confirmText:'确认分享',sensitive:true,owner:dialog})
    guard()
    if(ok)return props.model.shareManagedMemory(id,props.memoryId,rev,to,shareKey,guard)
  },()=>{
    sharing.value=false
    recipient.value=null
    appToast('记忆已分享。',{tone:'success'})
  })
}
function loadOutgoingShares(cursor){
  withdrawCommands.clear()
  void read(guard=>props.model.listOutgoingMemoryShares(actorId.value,props.memoryId,cursor,guard),
    value=>{outgoingShares.value=value})
}
function withdrawShare(copy){
  if(props.archived||busy.value)return
  const id=actorId.value
  if(!withdrawCommands.has(copy.id))withdrawCommands.set(copy.id,crypto.randomUUID())
  const key=withdrawCommands.get(copy.id)
  void read(async guard=>{
    const confirmed=await appConfirm('撤回给 '+copy.recipientName+' 的记忆？该副本及由它转出的记忆将无法再读取。',
      {title:'撤回分享',confirmText:'撤回此分享',destructive:true,sensitive:true,owner:dialog})
    guard()
    if(!confirmed)return
    await props.model.withdrawMemoryShare(id,props.memoryId,copy.id,copy.revision,key,guard)
    guard()
    return true
  },()=>loadOutgoingShares())
}
function remove(){
  if(props.archived||busy.value)return
  const id=actorId.value,rev=detail.value.revision
  void read(async guard=>{
    const ok=await appConfirm('删除这条记忆的正文？相关来源记录会保留。',
      {title:'删除记忆',confirmText:'删除正文',destructive:true,sensitive:true,owner:dialog})
    guard()
    if(ok){
      await props.model.removeOwnedMemory(id,props.memoryId,rev,removeKey,guard)
      return true
    }
  },()=>emit('removed'))
}
const unregister=registerBackHandler(()=>{emit('close');return true},{priority:610})
onBeforeUnmount(()=>{
  generation++
  unregister()
  cancelOwnedFeedbackDialog(dialog)
  recipient.value=conflicts.value=outgoingShares.value=null
  withdrawCommands.clear()
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
      <button v-for="item in actors.entries" :key="item.id" type="button" :data-memory-actor="item.id" :aria-pressed="actorId===item.id" @click="selectActor(item.id)">{{ item.title }}</button>
      <button v-if="actors.cursor" type="button" @click="loadActors(actors.cursor)">更多角色</button>
    </fieldset>
    <button v-if="!actors && !busy" type="button" @click="loadActors()">重试载入角色</button>
    <article v-if="detail">
      <h4>{{ detail.key }} · {{ detail.layer }} · {{ ({active:'有效',candidate:'候选',stale:'过期'})[detail.status] }}</h4>
      <p class="kanata-text">{{ detail.content }}</p>
      <ul v-if="sources">
        <li v-for="link in sources.entries" :key="link.messageId">
          <button type="button" :disabled="busy" @click="resolveSource(link)">{{ link.messageId }} · v{{ link.revision }}</button>
        </li>
      </ul>
      <button v-if="sources?.cursor" type="button" :disabled="busy" @click="loadSources(sources.cursor)">更多来源</button>
      <p v-if="source" class="kanata-text">{{ source.archived?'已归档 · ':'' }}{{ source.content }}</p>
      <button v-if="!sources" type="button" :disabled="busy" @click="loadSources()">查看来源</button>
      <div v-if="detail.canManage&&!archived" class="kanata-actions">
        <button type="button" :disabled="busy" @click="loadConflicts()">核对候选和冲突</button>
        <button v-if="detail.status==='active'" type="button" :disabled="busy" @click="beginShare">分享这条记忆</button>
        <button type="button" :disabled="busy" @click="loadOutgoingShares()">查看已分享对象</button>
        <button type="button" :disabled="busy" @click="remove">删除记忆正文</button>
      </div>
      <section v-if="conflicts" aria-label="记忆冲突">
        <p>待核对冲突：{{ conflicts.plan.count }} 条。</p>
        <ul><li v-for="row in conflicts.entries" :key="row.id">
          <button type="button" :disabled="busy||row.status==='deleted'" @click="emit('open-related',row.id)">{{ row.id }} · v{{ row.revision }}</button>
          <span>{{ row.resolved?'已处理':'待核对' }}</span>
        </li></ul>
        <button v-if="conflicts.cursor" type="button" :disabled="busy" @click="loadConflicts(conflicts.cursor)">更多冲突</button>
        <button type="button" :disabled="busy" @click="conflicts=null">关闭冲突</button>
        <button type="button" :disabled="busy||archived" @click="resolveConflicts">确认采用并处理冲突</button>
        <button v-if="conflicts.plan.count" type="button" :disabled="busy||archived" @click="mergeConflicts">自定义正文并合并来源</button>
      </section>
      <section v-if="outgoingShares" aria-label="已分享对象">
        <p v-if="!outgoingShares.entries.length">没有有效的分享副本。</p>
        <ul>
          <li v-for="copy in outgoingShares.entries" :key="copy.id">
            {{ copy.recipientName }}
            <button type="button" :data-share-copy="copy.id" :disabled="busy||archived" @click="withdrawShare(copy)">撤回分享</button>
          </li>
        </ul>
        <button v-if="outgoingShares.cursor" type="button" :disabled="busy" @click="loadOutgoingShares(outgoingShares.cursor)">更多已分享对象</button>
        <button type="button" :disabled="busy" @click="outgoingShares=null;withdrawCommands.clear()">关闭已分享对象</button>
      </section>
      <section v-if="sharing" aria-label="选择分享对象">
        <p>选择本世界的其他角色。</p>
        <button v-for="item in actors?.entries.filter(row=>row.id!==actorId)" :key="item.id" type="button"
          :data-share-recipient="item.id" :aria-pressed="recipient?.id===item.id" :disabled="busy" @click="recipient=item;shareKey=crypto.randomUUID()">{{ item.title }}</button>
        <button v-if="actors?.cursor" type="button" :disabled="busy" @click="loadActors(actors.cursor)">更多分享角色</button>
        <button type="button" :disabled="busy" @click="sharing=false;recipient=null">取消分享</button>
        <button type="button" :disabled="busy||archived||!recipient" @click="saveShare">分享给选定角色</button>
      </section>
    </article>
  </section>
</template>
