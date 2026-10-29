<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createKanataChatRuntime } from '../../application/kanataChatRuntime.js'
import { useKanataStore } from './kanataStore.js'
import { useSettingsStore } from '../../stores/settings.js'
import { registerBackHandler } from '../../services/backNavigation.js'
import { appChoose, appConfirm, cancelOwnedFeedbackDialog } from '../../services/uiFeedback.js'
import { restoreState } from '../../platform/storage/restoreState.js'
import { resolveKanataCharacter } from './domain/kanataManagementCore.js'
import { estimateKanataCost, KANATA_PRICE_SOURCE, KANATA_PRICE_VERSION } from './domain/kanataUsage.js'
const props=defineProps({conversationId:{type:String,required:true}})
const emit=defineEmits(['close'])
const store=useKanataStore(),settings=useSettingsStore(),runtime=createKanataChatRuntime()
const draft=ref(''),busy=ref(false),error=ref(''),preview=ref(null),replyDelay=ref(0),stream=ref(true),timeline=ref(null)
const queued=ref([])
const notice=ref('')
const pendingReplies=computed(()=>store.snapshot?.tasks.filter(t=>t.conversationId===props.conversationId&&t.deferredReply&&t.state==='pending')||[])
const revisionDraft=ref(null)
let mounted=true,timer=null
const dialogOwner=Symbol('kanata-chat-dialog')
const conversation=computed(()=>store.snapshot?.conversations.find(c=>c.id===props.conversationId))
const world=computed(()=>store.snapshot?.worlds.find(w=>w.id===conversation.value?.worldId))
const messages=computed(()=>store.snapshot?.messages.filter(m=>m.conversationId===props.conversationId)||[])
const members=computed(()=>store.snapshot?.instances.filter(i=>conversation.value?.participantIds.includes(i.id))||[])
const attempts=computed(()=>store.snapshot?.usageEvents?.filter(e=>e.conversationId===props.conversationId)||[])
const lastUser=computed(()=>messages.value.filter(m=>m.role==='user').at(-1))
const mode=computed(()=>conversation.value?.mode==='inherit'?world.value?.defaultChatMode:conversation.value?.mode)
const blocked=computed(()=>!store.isDataLoaded||restoreState.blocked||world.value?.archived||Boolean(store.saveError)||store.hasPendingSave)
const configured=computed(()=>Boolean(settings.aiApiKey?.trim()))
const name=id=>store.snapshot?.instances.some(i=>i.id===id)?resolveKanataCharacter(store.snapshot,id).name:'角色'
const scroll=async()=>{await nextTick();if(mounted&&timeline.value)timeline.value.scrollTop=timeline.value.scrollHeight}
watch(()=>messages.value.length,scroll)
watch(()=>preview.value?.content,scroll)
const errors={MISSING_KEY:'请先在全局设置中配置 DeepSeek。',ABORTED:'本次回复已停止；已经保存的内容会保留。',TIMEOUT:'请求超时，可以重试。',MENTION_UNKNOWN_OR_AMBIGUOUS:'未找到唯一的 @角色，请使用下方角色按钮。',OUTPUT_TRUNCATED:'回复达到长度上限，完整内容未保存，可以重试。',STALE_CONTEXT:'设定已变化，旧回复已停止。',STALE_TURN:'已经有新的发言，旧回复已停止。'}
const send=async options=>{
  if(busy.value||blocked.value)return
  busy.value=true;error.value='';notice.value='';preview.value=null
  try{const result=await runtime.send(props.conversationId,{...options,stream:stream.value,delayMs:Number(replyDelay.value),persistDelay:true,onDelta:value=>{if(mounted)preview.value=value}});if(result.deferred&&mounted)notice.value='已保存延迟回复任务；应用保持前台时会执行，关闭后在恢复时重新检查。'}
  catch(failure){if(mounted)error.value=errors[failure.code]||'回复未完成，请检查全局配置或重试保存；不会伪造成功回复。'}
  finally{if(mounted){busy.value=false;preview.value=null}}
}
// A brief local window combines consecutive short submissions into one paid turn.
const submit=()=>{
  if(busy.value||blocked.value||!configured.value||!draft.value.trim())return
  if(queued.value.join('\n').length+draft.value.length>8000){error.value='这一轮内容请控制在 8000 字以内。';return}
  queued.value.push(draft.value.trim());draft.value='';clearTimeout(timer)
  timer=setTimeout(()=>{const text=queued.value.join('\n');queued.value=[];void send({text})},600)
}
const stop=()=>{clearTimeout(timer);timer=null;queued.value=[];runtime.cancel()}
const changeMode=async()=>{
  const value=await appChoose({sensitive:true,owner:dialogOwner,title:'选择对话模式',options:[{value:'daily',label:'日常聊天'},{value:'roleplay',label:'角色扮演'}]})
  if(!mounted||!value)return
  stop();error.value=''
  try{await runtime.setMode(props.conversationId,value)}catch{if(mounted)error.value='模式未能保存，请先重试保存。'}
}
const changeDelay=async()=>{
  const value=await appChoose({sensitive:true,owner:dialogOwner,title:'回复等待',options:[{value:'0',label:'立即回复'},{value:'2000',label:'2 秒'},{value:'5000',label:'5 秒'},{value:'15000',label:'15 秒'}]})
  if(mounted&&value!==null)replyDelay.value=Number(value)
}
const retry=()=>{stop();if(lastUser.value)void send({retryMessageId:lastUser.value.id})}
const saveRevision=async()=>{if(!revisionDraft.value||busy.value||blocked.value)return;const value=revisionDraft.value;try{await runtime.reviseMessage(value.id,value.revision,{content:value.content,deleted:false});if(mounted)revisionDraft.value=null}catch{if(mounted)error.value='原文修订未完成。请核对版本、待复核事件或保存状态；不明确的因果关系需要先处理。'}}
const removeMessage=async message=>{const accepted=await appConfirm('删除这条原文及其版本正文，保留来源标识。相关回复会停用，记忆与事件会标为过期或待复核；它们的正文及旧备份不会一起删除。',{sensitive:true,owner:dialogOwner,title:'删除原文并核对派生影响',confirmText:'删除这条原文',destructive:true});if(mounted&&accepted===true)try{await runtime.reviseMessage(message.id,message.revision,{content:'',deleted:true})}catch{if(mounted)error.value='无法安全删除：请先处理不明确的历史依赖或重试保存，原资料未被当作成功清理。'}}
const unregister=registerBackHandler(()=>{if(revisionDraft.value){revisionDraft.value=null;return true}emit('close');return true},{priority:610,isActive:()=>true})
onBeforeUnmount(()=>{mounted=false;stop();preview.value=null;revisionDraft.value=null;draft.value='';runtime.dispose();unregister();cancelOwnedFeedbackDialog(dialogOwner)})
</script>

<template>
  <section class="kanata-panel kanata-chat" aria-label="彼方文字对话">
    <header class="kanata-section-heading"><div><h3>{{ conversation?.title }}</h3><p class="kanata-help">{{ world?.name }} · {{ conversation?.type==='group'?'最多两位角色回应，可有角色保持安静':'独立私聊' }}</p></div><button type="button" @click="emit('close')">返回世界</button></header>
    <p v-if="!configured" class="kanata-notice">请先在全局设置配置 DeepSeek；此处不会自动调用模型。</p>
    <p v-if="world?.archived" class="kanata-notice">世界已归档，可以阅读已保存的聊天。</p>
    <p v-if="error" role="alert" class="kanata-error">{{ error }}</p>
    <p v-if="notice" role="status" class="kanata-notice">{{ notice }}</p><button v-if="pendingReplies.length" type="button" :disabled="blocked||busy" @click="runtime.cancelDeferred(conversationId).catch(()=>{error='未能取消，请检查保存状态。'})">取消等待中的回复</button>
    <div class="kanata-chat-options"><button type="button" :disabled="blocked||busy" @click="changeMode">对话模式：{{ mode==='roleplay'?'角色扮演':'日常聊天' }}</button><button type="button" :disabled="busy" @click="changeDelay">回复等待：{{ Number(replyDelay)===0?'立即':`${Number(replyDelay)/1000} 秒` }}</button><label class="kanata-check"><input v-model="stream" type="checkbox" :disabled="busy" />流式预览</label></div>
    <div ref="timeline" class="kanata-chat-timeline" aria-label="已保存的聊天">
      <p v-if="!messages.length" class="kanata-help">这里还没有聊天。从你想说的话开始。</p>
      <article v-for="message in messages" :key="message.id" class="kanata-chat-message" :class="{'is-user':message.role==='user'}" :data-sender-id="message.senderId" :data-batch-id="message.batchId"><strong>{{ message.senderNameSnapshot }}</strong><span v-if="message.deleted" class="kanata-badge">原文已删除</span><span v-else-if="message.status==='stopped'" class="kanata-badge">来源修订后已停用</span><p class="kanata-text">{{ message.content }}</p><time :datetime="new Date(message.createdAt).toISOString()">{{ new Date(message.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) }}</time><div v-if="!message.deleted" class="kanata-actions"><button type="button" :disabled="busy||blocked" @click="revisionDraft={id:message.id,revision:message.revision,content:message.content}">修订这条原文</button><button type="button" :disabled="busy||blocked" @click="removeMessage(message)">删除这条原文</button></div></article>
      <article v-if="preview" class="kanata-chat-message kanata-preview-message"><strong>{{ name(preview.instanceId) }} · 正在输入</strong><p class="kanata-text">{{ preview.content }}</p><span class="kanata-help">尚未保存的预览</span></article>
    </div>
    <form v-if="revisionDraft" class="kanata-form" @submit.prevent="saveRevision"><label>修订原文<textarea v-model="revisionDraft.content" rows="4" maxlength="64000" required></textarea></label><p class="kanata-help">旧版本可追溯，相关派生内容会停用，不会被当成新事实。</p><div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存原文修订</button><button type="button" @click="revisionDraft=null">取消原文修订</button></div></form>
    <div v-if="conversation?.type==='group'" class="kanata-actions"><button v-for="member in members" :key="member.id" type="button" :disabled="busy||blocked" @click="draft+=`@${name(member.id)} `">@{{ name(member.id) }}</button></div>
    <form class="kanata-form" @submit.prevent="submit"><label>发送文字<textarea v-model="draft" rows="3" maxlength="8000" :disabled="blocked||busy" placeholder="说说此刻想分享的事" @keydown.ctrl.enter.prevent="submit"></textarea></label><p v-if="queued.length" class="kanata-help" role="status">{{ queued.length }} 条短句将合并为这一轮发送。</p><div class="kanata-actions"><button type="submit" :disabled="blocked||busy||!configured||!draft.trim()">发送消息</button><button v-if="busy||queued.length" type="button" @click="stop">停止回复</button><button v-if="lastUser" type="button" :disabled="blocked||busy||!configured" @click="retry">重试最近一轮</button></div></form>
    <details class="kanata-usage"><summary>本会话 AI 用量 · {{ attempts.length }} 次请求</summary><p class="kanata-help">每次重试分别记录；真实 Token 来自服务端，缺失时显示保守估算。费用是人民币区间估算，未知模型或自定义服务不套用官方价格，最终以账单为准。</p><p class="kanata-help"><a :href="KANATA_PRICE_SOURCE" target="_blank" rel="noopener noreferrer">官方价格来源</a> · {{ KANATA_PRICE_VERSION }}</p><ul><li v-for="attempt in attempts" :key="attempt.id"><strong>{{ attempt.model }} · {{ attempt.status==='pending'?'结果未知／可能已计费':attempt.status==='failed'?'未完成':'已完成' }}</strong><p v-if="attempt.usage">真实 Token：输入 {{ attempt.usage.promptTokens }} / 输出 {{ attempt.usage.completionTokens }}</p><p v-else>Token 缺失 · 输入保守估算 {{ attempt.estimatedInputTokens }} / 输出保守估算 {{ attempt.estimatedOutputTokens }}</p><p>{{ estimateKanataCost(attempt).minimumCny===null?'暂无适用价格':`费用估算 ¥${estimateKanataCost(attempt).minimumCny.toFixed(6)}～${estimateKanataCost(attempt).maximumCny.toFixed(6)}` }}</p><p v-if="attempt.errorCode" class="kanata-help">{{ attempt.errorCode }}</p></li></ul></details>
  </section>
</template>
