<script setup>
import {computed,onBeforeUnmount,ref} from 'vue'
import {appChoose,appConfirm,cancelOwnedFeedbackDialog} from '../../../services/uiFeedback.js'
import {registerBackHandler} from '../../../services/backNavigation.js'
import {resolveKanataCharacter} from '../domain/kanataManagementCore.js'
import {kanataMemoryPolicy,canUseKanataMemory} from './kanataKnowledge.js'
const props=defineProps({data:{type:Object,required:true},worldId:{type:String,required:true},instanceId:{type:String,required:true},runtime:{type:Object,required:true},blocked:Boolean})
const draft=ref(null),expected=ref(null),busy=ref(false),notice=ref(''),error=ref(''),policyDraft=ref(null)
const owner=Symbol('kanata-memory');let mounted=true
const memories=computed(()=>props.data.memories.filter(m=>m.worldId===props.worldId&&(m.ownerType==='world'||m.ownerId===props.instanceId)))
const conversations=computed(()=>props.data.conversations.filter(c=>c.worldId===props.worldId&&c.participantIds.includes(props.instanceId)))
const policy=computed(()=>kanataMemoryPolicy(props.data,props.worldId))
const sourceText=ref=>{const current=props.data.messages.find(m=>m.id===ref.messageId);if(current?.revision===ref.revision||current?.deleted)return current.content;const audit=props.data.messageAudits?.find(a=>a.messageId===ref.messageId&&(a.previous.revision===ref.revision||a.next.revision===ref.revision));return audit?(audit.previous.revision===ref.revision?audit.previous.content:audit.next.content):'此来源版本不可用，请核对当前记录；不会把新原文冒充旧版本。'}
const errors={MEMORY_LIFE_PERMISSION_DENIED:'原授权快照已失效，旧正文仅供核对；可删除，或在新授权下从新资料重新整理。',MEMORY_SOURCE_STALE:'来源已经修订，请重新核对，不能把旧摘要当作新事实。',MEMORY_CONFLICT_UNRESOLVED:'请明确选择与之冲突的旧记忆。',MEMORY_SHARE_PERMISSION_DENIED:'分享需要来源角色的分享授权，以及接收角色独立的读取和记忆授权。',MEMORY_SHARE_UNAVAILABLE:'源记忆或其上游内容已停用，不能继续传播。',MISSING_KEY:'请先配置全局 DeepSeek。'}
const perform=async(action,message)=>{if(busy.value||props.blocked)return;busy.value=true;error.value='';try{const result=await action();if(mounted)notice.value=result?.status==='not-needed'?'未达到当前整理条件，无需重复调用。':message;return true}catch(e){if(mounted)error.value=errors[e.code]||'操作未完成。请核对来源、版本或保存状态后重试。';return false}finally{if(mounted)busy.value=false}}
const edit=memory=>{draft.value=memory?JSON.parse(JSON.stringify(memory)):{id:'memory-'+crypto.randomUUID(),worldId:props.worldId,ownerType:'character',ownerId:props.instanceId,layer:'L3',key:'',content:'',sourceRefs:[],status:'candidate',revision:1,visibility:'private',knownBy:[props.instanceId],confidence:'statement'};expected.value=memory?.revision??null}
const save=async()=>{if(!draft.value)return;const ok=await perform(()=>props.runtime.saveMemory(draft.value,expected.value),'记忆已保存；候选内容需要明确确认后才用于后续对话。');if(ok&&mounted)draft.value=null}
const activate=async memory=>{
  if(memory.conflictWith?.some(id=>props.data.memories.find(m=>m.id===id)?.status==='active')){
    const accepted=await appConfirm('采用这条内容，并将列出的冲突记忆标为过期；旧内容与来源仍可核对。',{sensitive:true,owner,title:'解决记忆冲突',confirmText:'采用并保留溯源'})
    if(mounted&&accepted===true)await perform(()=>props.runtime.resolveConflict(memory.id,memory.conflictWith),'已明确处理冲突，旧内容保留为过期。')
  }else await perform(()=>props.runtime.saveMemory({...memory,status:'active',confidence:'confirmed'},memory.revision),'已确认这条记忆。')
}
const remove=async memory=>{const accepted=await appConfirm('删除这条记忆的正文并停止后续检索与转发。来源聊天、关联事件和历史备份不会一起删除。',{sensitive:true,owner,title:'删除记忆并保留来源标识',confirmText:'删除记忆正文',destructive:true});if(mounted&&accepted===true)await perform(()=>props.runtime.saveMemory({...memory,status:'deleted',content:'（已删除的记忆内容）'},memory.revision),'记忆正文已删除，来源标识仍可追溯。')}
const share=async memory=>{const value=await appChoose({sensitive:true,owner,title:'只分享这条已确认记忆',message:'原文私聊不随记忆分享；接收方不自动获得继续转发的权限。',options:props.data.instances.filter(i=>i.worldId===props.worldId&&i.id!==props.instanceId).map(i=>({value:i.id,label:resolveKanataCharacter(props.data,i.id).name}))});if(mounted&&value)await perform(()=>props.runtime.shareMemory(memory.id,value),'已按独立授权分享这条记忆。')}
const organize=async kind=>{const value=await appChoose({sensitive:true,owner,title:kind==='summary'?'选择压缩来源会话':'选择提取来源会话',options:conversations.value.map(c=>({value:c.id,label:c.title}))});if(mounted&&value)await perform(()=>props.runtime.organize(value,props.instanceId,kind,{force:true}),'整理完成；原文和先前有效摘要均保留。')}
const choosePolicy=async()=>{
  const value=await appChoose({sensitive:true,owner,title:'记忆整理策略',options:[{value:'economical',label:'节省：减少整理频率'},{value:'standard',label:'标准：平衡近期原文和记忆'},{value:'deep',label:'深度：更频繁整理'},{value:'custom',label:'自定义阈值'}]})
  if(!mounted||!value)return
  const sizes={economical:[16,40,16],standard:[12,24,8],deep:[8,16,4]}
  const fields={...policy.value,strategy:value};if(sizes[value])[fields.recentMessages,fields.summarizeAfter,fields.extractAfter]=sizes[value]
  if(value==='custom')policyDraft.value=fields;else await perform(()=>props.runtime.setPolicy(fields),'整理策略已保存。')
}
const savePolicy=async()=>{const fields={...policyDraft.value};for(const k of ['recentMessages','summarizeAfter','extractAfter','contextBudget'])fields[k]=Number(fields[k]);if(await perform(()=>props.runtime.setPolicy(fields),'自定义策略已保存。'))policyDraft.value=null}
const unregister=registerBackHandler(()=>{draft.value=null;policyDraft.value=null;return true},{priority:620,isActive:()=>!!draft.value||!!policyDraft.value})
onBeforeUnmount(()=>{mounted=false;draft.value=null;policyDraft.value=null;props.runtime.cancel();unregister();cancelOwnedFeedbackDialog(owner)})
</script>
<template>
  <section aria-label="动态记忆管理">
    <h4>动态记忆 · {{ memories.length }} 条</h4><p class="kanata-help">L0 为原始记录，L1 保留近期原文；L2 为情节摘要，L3 为候选或已确认长期记忆；L4 是经规则确认的世界状态。静态世界书不因整理而改变。</p>
    <p v-if="notice" class="kanata-notice" role="status">{{ notice }}</p><p v-if="error" class="kanata-error" role="alert">{{ error }}</p>
    <div class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="edit(null)">新建记忆</button><button type="button" :disabled="blocked||busy" @click="organize('memory')">提取候选记忆</button><button type="button" :disabled="blocked||busy" @click="organize('summary')">压缩较早原文</button><button type="button" :disabled="blocked||busy" @click="choosePolicy">整理策略：{{ policy.strategy }}</button></div>
    <label class="kanata-check"><input type="checkbox" :checked="policy.enabled" :disabled="blocked||busy" @change="perform(()=>runtime.setPolicy({...policy,enabled:$event.target.checked}),'自动整理开关已保存。')" />满足条件后自动整理（使用全局 AI）</label>
    <form v-if="policyDraft" class="kanata-form" @submit.prevent="savePolicy"><label>近期原文条数<input v-model="policyDraft.recentMessages" type="number" min="2" max="40" /></label><label>摘要触发条数<input v-model="policyDraft.summarizeAfter" type="number" min="4" max="200" /></label><label>记忆提取间隔<input v-model="policyDraft.extractAfter" type="number" min="2" max="100" /></label><label>上下文保守字节预算<input v-model="policyDraft.contextBudget" type="number" min="2000" max="64000" /></label><div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存整理策略</button><button type="button" @click="policyDraft=null">取消策略编辑</button></div></form>
    <form v-if="draft" class="kanata-form" @submit.prevent="save"><h4>核对记忆及来源</h4><label>记忆主题<input v-model="draft.key" maxlength="200" required /></label><label>记忆正文<textarea v-model="draft.content" maxlength="4000" rows="4" required></textarea></label><p class="kanata-help">此处保存为 {{ draft.status }}；从生活资料提取的授权标记不能在编辑时移除。</p><div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存记忆</button><button type="button" @click="draft=null">取消记忆编辑</button></div></form>
    <article v-for="memory in memories" :key="memory.id" class="kanata-experience-card"><h4>{{ memory.key }} <span class="kanata-badge">{{ memory.layer }} · {{ memory.status }}</span></h4><p class="kanata-text">{{ memory.content }}</p><p class="kanata-help">{{ canUseKanataMemory(data,memory,instanceId,false)?'可用于本角色后续对话':'当前不会注入 AI；请核对状态、来源或授权。' }}</p><p v-if="memory.conflictWith?.length" class="kanata-notice">存在 {{ memory.conflictWith.length }} 条冲突；不会自动覆盖旧事实。</p><details><summary>来源追溯 · {{ memory.sourceRefs.length }} 条</summary><ul><li v-for="source in memory.sourceRefs" :key="source.messageId"><code>{{ source.messageId }} · v{{ source.revision }}</code><p class="kanata-text">{{ sourceText(source) }}</p><span v-if="data.messages.find(m=>m.id===source.messageId)?.revision!==source.revision" class="kanata-badge">来源已修订</span></li></ul><p v-if="memory.lifeSources?.length" class="kanata-help">生活来源：{{ memory.lifeSources.map(s=>`${s.moduleId} · 授权v${s.revision}`).join('，') }}。撤权不自动删除原文，但会阻止继续使用。</p></details><div v-if="memory.status!=='deleted'" class="kanata-actions"><button type="button" :disabled="blocked||busy" @click="edit(memory)">编辑记忆</button><button v-if="memory.status==='candidate'" type="button" :disabled="blocked||busy" @click="activate(memory)">核对并采用</button><button v-if="memory.status==='active'" type="button" :disabled="blocked||busy" @click="share(memory)">分享这条记忆</button><button type="button" :disabled="blocked||busy" @click="remove(memory)">删除记忆正文</button></div></article>
    <details><summary>整理任务与错误</summary><ul><li v-for="task in data.tasks.filter(t=>t.worldId===worldId&&t.instanceId===instanceId&&['memory','summary'].includes(t.kind))" :key="task.id">{{ task.kind }} · {{ task.state }} · 尝试 {{ task.attempt }} <span v-if="task.errorCode">{{ task.errorCode }}</span></li></ul></details>
  </section>
</template>
