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
import KanataHistoryPanel from './KanataHistoryPanel.vue'
import KanataCandidateHistoryPanel from './KanataCandidateHistoryPanel.vue'
import {useKanataBubbleReveal} from './useKanataBubbleReveal.js'
import {kanataReplyLimits} from './domain/groupReplyLimits.js'
const props=defineProps({conversationId:{type:String,required:true},candidate:{type:Object,default:null}})
const emit=defineEmits(['close'])
const store=props.candidate?null:useKanataStore(),settings=useSettingsStore()
const runtime=props.candidate?.runtime??createKanataChatRuntime()
const snapshot=computed(()=>store?.snapshot)
const candidateView=props.candidate?.runtime.createViewModel()??null
const messageWindow=candidateView?.window??null
const overview=computed(()=>candidateView?.overview.value)
const hasMoreMembers=computed(()=>overview.value?.members.cursor!=null)
const draft=ref(''),busy=ref(false),error=ref(''),preview=ref(null),replyDelay=ref('activity'),stream=ref(true),timeline=ref(null)
const queued=ref([])
const notice=ref('')
const historyOpen=ref(false)
const pendingReplies=computed(()=>props.candidate ? (runtime.pendingReply.value?[runtime.pendingReply.value]:[]) :
  snapshot.value?.tasks.filter(t=>t.conversationId===props.conversationId&&t.deferredReply&&t.state==='pending')||[])
const revisionDraft=ref(null)
const groupLimitsDraft=ref(null),groupConfigError=ref(''),groupSpeakersInput=ref(null),groupMessagesInput=ref(null)
const timingDraft=ref(null),timingError=ref(''),timingInput=ref(null)
const timingFieldError=computed(()=>timingDraft.value&&(!Number.isSafeInteger(timingDraft.value.waitMs)||timingDraft.value.waitMs<1000||timingDraft.value.waitMs>30000)?'请输入 1000–30000 之间的整数毫秒。':'')
let mounted=true,timer=null,scrollOwner=0
const anchorBusy=ref(false)
const windowBusy=computed(()=>Boolean(messageWindow?.loading.value))
const windowReady=computed(()=>Boolean(messageWindow?.ready.value))
const windowError=computed(()=>messageWindow?.error.value)
const hasEarlier=computed(()=>Boolean(messageWindow?.hasMore.value))
const browsingEarlier=computed(()=>Boolean(messageWindow?.browsing.value))
const newerMessages=computed(()=>Boolean(messageWindow?.newMessages.value))
const quote=computed(()=>messageWindow?.quote.value)
const dialogOwner=Symbol('kanata-chat-dialog')
const conversation=computed(()=>candidateView ? overview.value?.conversation : snapshot.value?.conversations.find(c=>c.id===props.conversationId))
const world=computed(()=>candidateView ? overview.value?.world : snapshot.value?.worlds.find(w=>w.id===conversation.value?.worldId))
const groupLimits=computed(()=>conversation.value?kanataReplyLimits(conversation.value):{maxSpeakers:2,maxMessages:8})
const groupSpeakersError=computed(()=>groupLimitsDraft.value&&(!Number.isSafeInteger(groupLimitsDraft.value.maxSpeakers)||groupLimitsDraft.value.maxSpeakers<1||groupLimitsDraft.value.maxSpeakers>8)?'请输入 1–8 之间的整数。':'')
const groupMessagesError=computed(()=>groupLimitsDraft.value&&(!Number.isSafeInteger(groupLimitsDraft.value.maxMessages)||groupLimitsDraft.value.maxMessages<1||groupLimitsDraft.value.maxMessages>32||groupLimitsDraft.value.maxMessages<groupLimitsDraft.value.maxSpeakers)?'请输入 1–32 之间的整数，且不少于参与角色上限。':'')
const messages=computed(()=>messageWindow ? messageWindow.messages.value : snapshot.value?.messages.filter(m=>m.conversationId===props.conversationId).slice(-100)||[])
const {visibleMessages,waitingCount,nextSenderId,showAll}=useKanataBubbleReveal(messages)
const members=computed(()=>candidateView ? overview.value?.members.entries??[] : snapshot.value?.instances.filter(i=>conversation.value?.participantIds.includes(i.id))||[])
const usage=computed(()=>candidateView?.usage.value)
const attempts=computed(()=>candidateView?usage.value?.attempts??[]:snapshot.value?.usageEvents?.filter(e=>e.conversationId===props.conversationId)||[])
const toggleUsage=event=>{
  if(event.target.open)void candidateView?.loadUsage()
  else candidateView?.clearUsage()
}
const lastUser=computed(()=>messages.value.filter(m=>m.role==='user').at(-1))
const mode=computed(()=>conversation.value?.mode==='inherit'?world.value?.defaultChatMode:conversation.value?.mode)
const blocked=computed(()=>restoreState.blocked||world.value?.archived||(messageWindow ?
  !overview.value||!windowReady.value||!runtime.isAvailable()||restoreState.busy :
  !store.isDataLoaded||Boolean(store.saveError)||Boolean(store.archiveError)||store.hasPendingSave))
const canSend=computed(()=>!blocked.value&&(!messageWindow||conversation.value?.type!=='character'))
const configured=computed(()=>Boolean(props.candidate||settings.aiApiKey?.trim()))
const name=id=>candidateView
  ? members.value.find(member=>member.id===id)?.name??messages.value.find(row=>row.senderId===id)?.senderNameSnapshot??'角色'
  : snapshot.value?.instances.some(i=>i.id===id)?resolveKanataCharacter(snapshot.value,id).name:'角色'
const scroll=async()=>{const owner=scrollOwner;await nextTick();if(mounted&&owner===scrollOwner&&timeline.value&&!anchorBusy.value&&!browsingEarlier.value)timeline.value.scrollTop=timeline.value.scrollHeight}
watch(()=>visibleMessages.value.length,scroll)
watch(()=>preview.value?.content,scroll)
const errors={MISSING_KEY:'请先在全局设置中配置 DeepSeek。',ABORTED:'本次回复已停止；已经保存的内容会保留。',TIMEOUT:'请求超时，可以重试。',MENTION_UNKNOWN_OR_AMBIGUOUS:'未找到唯一的 @角色，请使用下方角色按钮。',OUTPUT_TRUNCATED:'回复达到长度上限，完整内容未保存，可以重试。',STALE_CONTEXT:'设定已变化，旧回复已停止。',STALE_TURN:'已经有新的发言，旧回复已停止。'}
const send=async options=>{
  if(busy.value||!canSend.value)return
  const owner=scrollOwner
  busy.value=true;error.value='';notice.value='';preview.value=null
  const active=()=>mounted&&owner===scrollOwner
  try{const result=await runtime.send(props.conversationId,{stream:stream.value,delayMs:replyDelay.value==='activity'?0:Number(replyDelay.value),timing:replyDelay.value==='0'?'immediate':'configured',replyToMessageId:options.retryMessageId?undefined:quote.value?.id,replyToRevision:quote.value?.revision,...options,persistDelay:true,onDelta:value=>{if(active())preview.value=value}});if(result.deferred&&active())notice.value=result.activityDelayed?'已按活动等待设置保存回复任务；可以立即回复，关闭后在恢复时重新检查。':'已保存延迟回复任务；应用保持前台时会执行，关闭后在恢复时重新检查。';if(active())messageWindow?.clearQuote()}
  catch(failure){if(active()){error.value=errors[failure.code]||'回复未完成，请检查全局配置或重试保存；不会伪造成功回复。';if(messageWindow&&options.text&&!failure.sourceSaved)draft.value=options.text}}
  finally{if(active()){busy.value=false;preview.value=null;void messageWindow?.refresh()}}
}
// A brief local window combines consecutive short submissions into one paid turn.
const submit=()=>{
  if(busy.value||!canSend.value||!configured.value||!draft.value.trim())return
  if(queued.value.join('\n').length+draft.value.length>8000){error.value='这一轮内容请控制在 8000 字以内。';return}
  queued.value.push(draft.value.trim());draft.value='';clearTimeout(timer)
  timer=setTimeout(()=>{const text=queued.value.join('\n');queued.value=[];void send({text})},600)
}
const stop=()=>{clearTimeout(timer);timer=null;queued.value=[];runtime.cancel();showAll()}
const updateConversation=async action=>{
  const owner=scrollOwner
  const saved=await action
  if(candidateView&&mounted&&owner===scrollOwner)candidateView.publishConversation(saved)
}
const reloadCandidate=()=>{
  if(runtime.isAvailable()&&props.candidate.scope)void candidateView.open(props.conversationId)
}
if(candidateView){
  const clearScope=()=>{
    scrollOwner++;stop();preview.value=null;revisionDraft.value=null;groupLimitsDraft.value=null;timingDraft.value=null
    draft.value='';busy.value=false;anchorBusy.value=false;error.value='';notice.value=''
    groupConfigError.value='';timingError.value=''
    cancelOwnedFeedbackDialog(dialogOwner)
    historyOpen.value=false
  }
  watch(()=>runtime.revision.value,clearScope,{flush:'sync'})
  watch(()=>[props.conversationId,props.candidate.scope?.worldId,runtime.isAvailable()],([conversationId,worldId,available])=>{
    runtime.activate(worldId ? {worldId,conversationId} : null)
    if(available&&worldId)reloadCandidate()
  },{immediate:true})
  watch(()=>runtime.messageRevision.value,()=>{if(!busy.value)void messageWindow.refresh()})
}
const readEarlier=async()=>{
  if(!messageWindow||!timeline.value||windowBusy.value)return
  const element=timeline.value,owner=scrollOwner
  const top=element.getBoundingClientRect().top
  const anchor=[...element.querySelectorAll('[data-message-id]')].find(node=>node.getBoundingClientRect().bottom>top)
  const anchorTop=anchor?.getBoundingClientRect().top
  const previousHeight=element.scrollHeight,previousScroll=element.scrollTop
  anchorBusy.value=true
  try{
    if(!await messageWindow.older())return
    showAll()
    await nextTick()
    if(!mounted||owner!==scrollOwner)return
    element.scrollTop=anchor?.isConnected?previousScroll+anchor.getBoundingClientRect().top-anchorTop:
      previousScroll+element.scrollHeight-previousHeight
  }finally{if(owner===scrollOwner)anchorBusy.value=false}
}
const jumpToMessage=async id=>{
  if(!messageWindow)return
  const owner=scrollOwner
  if(!await messageWindow.locate(id))return
  showAll()
  await nextTick()
  if(mounted&&owner===scrollOwner){
    const target=[...timeline.value?.querySelectorAll('[data-message-id]')??[]].find(node=>node.dataset.messageId===id)
    target?.focus({preventScroll:true})
    target?.scrollIntoView({block:'nearest',behavior:'instant'})
  }
}
const searchHistory=(text,cursor,assertSearch)=>runtime.searchHistory(props.conversationId,text,cursor,assertSearch)
const previewHistoryArchive=guard=>runtime.previewArchive(props.conversationId,guard)
const confirmHistoryArchive=(plan,key,guard)=>runtime.confirmArchive(props.conversationId,plan,key,guard)
const locateHistory=async id=>{
  historyOpen.value=false
  await jumpToMessage(id)
}
const refreshAfterRevision=async()=>{
  if(!messageWindow)return
  messageWindow.clearQuote()
  if(browsingEarlier.value&&messages.value.length){await messageWindow.locate(messages.value.at(-1).id);showAll()}
  else await messageWindow.recent()
}
const changeMode=async()=>{
  const owner=scrollOwner
  const value=await appChoose({sensitive:true,owner:dialogOwner,title:'选择对话模式',options:[{value:'daily',label:'日常聊天'},{value:'roleplay',label:'角色扮演'}]})
  if(!mounted||owner!==scrollOwner||!value)return
  stop();error.value=''
  try{await updateConversation(runtime.setMode(props.conversationId,value))}catch{if(mounted&&owner===scrollOwner)error.value='模式未能保存，请先重试保存。'}
}
const changeDelay=async()=>{
  const owner=scrollOwner
  const value=await appChoose({sensitive:true,owner:dialogOwner,title:'回复等待',options:[{value:'activity',label:'按会话活动设置'},{value:'0',label:'立即回复'},{value:'2000',label:'2 秒'},{value:'5000',label:'5 秒'},{value:'15000',label:'15 秒'}]})
  if(mounted&&owner===scrollOwner&&value!==null)replyDelay.value=value
}
const openTiming=()=>{if(blocked.value||busy.value||queued.value.length)return;timingError.value='';timingDraft.value={revision:conversation.value.revision,...(conversation.value.replyTiming||{enabled:false,waitMs:5000})}}
const saveTiming=async()=>{
  if(!timingDraft.value||blocked.value||busy.value)return
  if(timingFieldError.value){await nextTick();timingInput.value?.focus();return}
  const owner=scrollOwner,{revision,enabled,waitMs}=timingDraft.value;busy.value=true;timingError.value=''
  try{await updateConversation(runtime.setReplyTiming(props.conversationId,revision,{enabled,waitMs}));if(mounted&&owner===scrollOwner)timingDraft.value=null}
  catch(failure){if(mounted&&owner===scrollOwner)timingError.value=failure.code==='STALE_REPLY_TIMING'?'会话已变化，请关闭表单后重新打开。':'活动等待未能保存，请返回世界重试保存后再试。'}
  finally{if(mounted&&owner===scrollOwner)busy.value=false}
}
const replyNow=()=>{stop();if(lastUser.value)void send({retryMessageId:lastUser.value.id,delayMs:0,timing:'immediate'})}
const openGroupLimits=()=>{
  if(blocked.value||busy.value||queued.value.length||conversation.value?.type!=='group')return
  groupConfigError.value=''
  groupLimitsDraft.value={revision:conversation.value.revision,...groupLimits.value}
}
const saveGroupLimits=async()=>{
  if(!groupLimitsDraft.value||blocked.value||busy.value)return
  if(groupSpeakersError.value||groupMessagesError.value){await nextTick();(groupSpeakersError.value?groupSpeakersInput.value:groupMessagesInput.value)?.focus();return}
  const owner=scrollOwner,{revision,maxSpeakers,maxMessages}=groupLimitsDraft.value
  busy.value=true;groupConfigError.value=''
  try{await updateConversation(runtime.setGroupLimits(props.conversationId,revision,{maxSpeakers,maxMessages}));if(mounted&&owner===scrollOwner)groupLimitsDraft.value=null}
  catch(failure){if(mounted&&owner===scrollOwner)groupConfigError.value=failure.code==='STALE_GROUP_LIMITS'?'本会话配置已变化，请关闭表单后重新打开。':'群聊限制未能保存，请先返回世界重试保存，再重新打开配置。'}
  finally{if(mounted&&owner===scrollOwner)busy.value=false}
}
const retry=()=>{stop();if(lastUser.value)void send({retryMessageId:lastUser.value.id})}
const saveRevision=async()=>{if(!revisionDraft.value||busy.value||blocked.value)return;const value=revisionDraft.value,owner=scrollOwner;try{await runtime.reviseMessage(value.id,value.revision,{content:value.content,deleted:false});if(mounted&&owner===scrollOwner){revisionDraft.value=null;await refreshAfterRevision()}}catch{if(mounted&&owner===scrollOwner)error.value='原文修订未完成。请核对版本、待复核事件或保存状态；不明确的因果关系需要先处理。'}}
const removeMessage=async message=>{const owner=scrollOwner;const accepted=await appConfirm('删除这条原文及其版本正文，保留来源标识。相关回复会停用，记忆与事件会标为过期或待复核；它们的正文及旧备份不会一起删除。',{sensitive:true,owner:dialogOwner,title:'删除原文并核对派生影响',confirmText:'删除这条原文',destructive:true});if(mounted&&owner===scrollOwner&&accepted===true)try{await runtime.reviseMessage(message.id,message.revision,{content:'',deleted:true});if(mounted&&owner===scrollOwner)await refreshAfterRevision()}catch{if(mounted&&owner===scrollOwner)error.value='无法安全删除：请先处理不明确的历史依赖或重试保存，原资料未被当作成功清理。'}}
const unregister=registerBackHandler(()=>{if(timingDraft.value){timingDraft.value=null;return true}if(groupLimitsDraft.value){groupLimitsDraft.value=null;return true}if(revisionDraft.value){revisionDraft.value=null;return true}if(historyOpen.value){historyOpen.value=false;return true}emit('close');return true},{priority:610,isActive:()=>true})
onBeforeUnmount(()=>{mounted=false;stop();candidateView?.dispose();preview.value=null;revisionDraft.value=null;groupLimitsDraft.value=null;timingDraft.value=null;draft.value='';void Promise.resolve(runtime.dispose()).catch(()=>{});unregister();cancelOwnedFeedbackDialog(dialogOwner)})
</script>

<template>
  <section class="kanata-panel kanata-chat" aria-label="彼方文字对话">
    <header class="kanata-section-heading"><div><h3>{{ conversation?.title }}</h3><p class="kanata-help">{{ world?.name }} · {{ conversation?.type==='group'?`每轮最多 ${groupLimits.maxSpeakers} 位角色、${groupLimits.maxMessages} 条 AI 回复，可保持安静`:'独立私聊' }}</p></div><button type="button" @click="emit('close')">返回世界</button></header>
    <p v-if="!configured" class="kanata-notice">请先在全局设置配置 DeepSeek；此处不会自动调用模型。</p>
    <p v-if="world?.archived" class="kanata-notice">世界已归档，可以阅读已保存的聊天。</p>
    <p v-if="error" role="alert" class="kanata-error">{{ error }}</p>
    <p v-if="notice" role="status" class="kanata-notice">{{ notice }}</p><template v-if="pendingReplies.length"><p class="kanata-help">有已保存的回复正在等待；仅在应用前台处理，不保证关闭后持续运行。</p><button type="button" :disabled="blocked||busy||!configured" @click="replyNow">立即回复最近一轮</button><button type="button" :disabled="blocked||busy" @click="runtime.cancelDeferred(conversationId).catch(()=>{error='未能取消，请检查保存状态。'})">取消等待中的回复</button></template>
    <template v-if="messageWindow">
      <p v-if="candidateView.loading.value" class="kanata-help" role="status">正在载入会话…</p>
      <p v-if="candidateView.error.value" class="kanata-error" role="alert">会话资料载入失败，请重试。</p>
      <button v-if="candidateView.error.value || (!overview && runtime.isAvailable() && !candidateView.loading.value)" type="button" @click="reloadCandidate">重试载入会话</button>
      <button type="button" :disabled="!windowReady||windowBusy||busy" @click="historyOpen=!historyOpen">查找会话历史</button>
      <KanataCandidateHistoryPanel v-if="historyOpen" :search="searchHistory" :preview-archive="previewHistoryArchive"
        :confirm-archive="confirmHistoryArchive" @close="historyOpen=false" @locate="locateHistory" />
      <div class="kanata-actions">
        <button v-if="hasEarlier" type="button" :disabled="windowBusy" @click="readEarlier">加载更早消息</button>
        <button v-if="browsingEarlier" type="button" :disabled="windowBusy" @click="messageWindow.recent()">{{ newerMessages?'有新消息，回到最近':'回到最近' }}</button>
        <button v-if="windowError==='MESSAGE_LOAD_FAILED'" type="button" :disabled="windowBusy" @click="messageWindow.recent()">重试载入</button>
      </div>
      <p v-if="windowBusy" class="kanata-help" role="status">正在载入消息…</p>
      <p v-if="windowError" class="kanata-error" role="alert">{{ windowError==='MESSAGE_UNAVAILABLE'?'原消息已删除或不可用。':'消息载入失败，请重试。' }}</p>
    </template>
    <template v-else>
      <button type="button" :disabled="busy" @click="historyOpen=!historyOpen">{{ historyOpen?'收起会话历史':'查找或整理历史' }}</button>
      <KanataHistoryPanel v-if="historyOpen" :conversation-id="conversationId" @close="historyOpen=false" @revise="value=>{revisionDraft=value;historyOpen=false}" />
    </template>
    <div class="kanata-chat-options"><button type="button" :disabled="!canSend||busy" @click="changeMode">对话模式：{{ mode==='roleplay'?'角色扮演':'日常聊天' }}</button><button type="button" :disabled="busy" @click="changeDelay">回复等待：{{ replyDelay==='activity'?'按活动设置':Number(replyDelay)===0?'立即':`${Number(replyDelay)/1000} 秒` }}</button><label class="kanata-check"><input v-model="stream" type="checkbox" :disabled="busy" />流式预览</label></div>
    <button type="button" :disabled="!canSend||busy||queued.length>0" @click="openTiming">活动等待设置</button>
    <form v-if="timingDraft" class="kanata-form" aria-label="活动等待设置" novalidate @submit.prevent="saveTiming">
      <label class="kanata-check"><input v-model="timingDraft.enabled" type="checkbox" :disabled="busy" />根据角色活动等待</label>
      <label>活动等待毫秒<input ref="timingInput" v-model.number="timingDraft.waitMs" type="number" min="1000" max="30000" step="1" inputmode="numeric" :disabled="busy" :aria-invalid="Boolean(timingFieldError)" aria-describedby="kanata-timing-error" /></label>
      <p v-if="timingFieldError" id="kanata-timing-error" role="alert" class="kanata-error">{{ timingFieldError }}</p>
      <p class="kanata-help">默认关闭。世界与角色开启自主活动后，当前虚拟日程或需要休息时，先按此设置等待一次，再由前台任务检查执行（检查间隔最长 30 秒）。不会因关系或情绪故意冷落，也不会生成虚假的忙碌聊天。可随时选择立即回复；手机关闭期间不持续执行 AI。手动等待优先于活动设置。</p>
      <p v-if="timingError" role="alert" class="kanata-error">{{ timingError }}</p><div class="kanata-actions"><button type="submit" :disabled="busy||blocked">保存活动等待</button><button type="button" :disabled="busy" @click="timingDraft=null">取消活动等待设置</button></div>
    </form>
    <button v-if="conversation?.type==='group'" type="button" :disabled="blocked||busy||queued.length>0" @click="openGroupLimits">群聊回复限制</button>
    <form v-if="groupLimitsDraft" class="kanata-form" aria-label="群聊回复限制" novalidate @submit.prevent="saveGroupLimits">
      <p class="kanata-help">这是回复上限，角色可以保持沉默。总数只计算本轮 AI 回复；段落较多时会合并气泡，保留完整正文。已保存的历史不会因调整限制而删除。此限制也适用于群内自主交流；设为一名角色时，暂停本群的两人自主对话。</p>
      <label>每轮参与角色上限<input ref="groupSpeakersInput" v-model.number="groupLimitsDraft.maxSpeakers" type="number" inputmode="numeric" min="1" max="8" step="1" required :disabled="busy" :aria-invalid="Boolean(groupSpeakersError)" aria-describedby="kanata-group-speakers-error" /></label>
      <p v-if="groupSpeakersError" id="kanata-group-speakers-error" role="alert" class="kanata-error">{{ groupSpeakersError }}</p>
      <label>每轮 AI 回复条数上限<input ref="groupMessagesInput" v-model.number="groupLimitsDraft.maxMessages" type="number" inputmode="numeric" :min="groupLimitsDraft.maxSpeakers||1" max="32" step="1" required :disabled="busy" :aria-invalid="Boolean(groupMessagesError)" aria-describedby="kanata-group-messages-error" /></label>
      <p v-if="groupMessagesError" id="kanata-group-messages-error" role="alert" class="kanata-error">{{ groupMessagesError }}</p>
      <p v-if="groupConfigError" role="alert" class="kanata-error">{{ groupConfigError }}</p>
      <div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存群聊限制</button><button type="button" :disabled="busy" @click="groupLimitsDraft=null">取消群聊配置</button></div>
    </form>
    <div v-show="!candidateView||!historyOpen" ref="timeline" class="kanata-chat-timeline" aria-label="已保存的聊天" :aria-busy="messageWindow?windowBusy:undefined">
      <p v-if="!messages.length&&(!messageWindow||windowReady)" class="kanata-help">这里还没有聊天。从你想说的话开始。</p>
      <article v-for="message in visibleMessages" :key="message.id" class="kanata-chat-message" :class="{'is-user':message.role==='user'}" :data-message-id="message.id" :data-sender-id="message.senderId" :data-batch-id="message.batchId" :tabindex="messageWindow?-1:undefined">
        <strong>{{ message.senderNameSnapshot }}</strong><span v-if="message.deleted" class="kanata-badge">原文已删除</span><span v-else-if="message.status==='stopped'" class="kanata-badge">来源修订后已停用</span>
        <button v-if="messageWindow&&message.replyToMessageId" type="button" @click="jumpToMessage(message.replyToMessageId)">跳到引用的原消息</button>
        <p class="kanata-text">{{ message.content }}</p><time :datetime="new Date(message.createdAt).toISOString()">{{ new Date(message.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) }}</time>
        <div v-if="!message.deleted" class="kanata-actions">
          <button v-if="messageWindow&&message.status==='complete'&&conversation?.type!=='character'" type="button" :disabled="busy||blocked" @click="messageWindow.showQuote(message.id)">引用回复</button>
          <button type="button" :disabled="busy||blocked" @click="revisionDraft={id:message.id,revision:message.revision,content:message.content}">修订这条原文</button><button type="button" :disabled="busy||blocked" @click="removeMessage(message)">删除这条原文</button>
        </div>
      </article>
      <p v-if="waitingCount" class="kanata-help" role="status">{{ name(nextSenderId) }} · 正在输入 <button type="button" @click="showAll">立即显示全部回复</button></p>
      <article v-if="preview" class="kanata-chat-message kanata-preview-message"><strong>{{ preview.name || name(preview.instanceId) }} · 正在输入</strong><p class="kanata-text">{{ preview.content }}</p><span class="kanata-help">尚未保存的预览</span></article>
    </div>
    <form v-if="revisionDraft" class="kanata-form" @submit.prevent="saveRevision"><label>修订原文<textarea v-model="revisionDraft.content" rows="4" maxlength="64000" required></textarea></label><p class="kanata-help">旧版本可追溯，相关派生内容会停用，不会被当成新事实。</p><div class="kanata-actions"><button type="submit" :disabled="blocked||busy">保存原文修订</button><button type="button" @click="revisionDraft=null">取消原文修订</button></div></form>
    <div v-if="conversation?.type==='group'" class="kanata-actions"><button v-for="member in members" :key="member.id" type="button" :disabled="busy||blocked" @click="draft+=`@${name(member.id)} `">@{{ name(member.id) }}</button><button v-if="hasMoreMembers" type="button" :disabled="candidateView.membersLoading.value" @click="candidateView.loadMembers(overview.members.cursor)">更多成员</button><button v-if="candidateView && overview.members.after >= 0" type="button" :disabled="candidateView.membersLoading.value" @click="candidateView.loadMembers(-1)">首组成员</button></div>
    <form v-if="!messageWindow||conversation?.type!=='character'" class="kanata-form" @submit.prevent="submit">
      <div v-if="quote" class="kanata-notice" role="status"><strong>回复 {{ quote.senderNameSnapshot }}</strong><p>{{ quote.content.slice(0,180) }}</p><button type="button" @click="messageWindow.clearQuote()">取消引用</button></div>
      <label>发送文字<textarea v-model="draft" rows="3" maxlength="8000" :disabled="!canSend||busy" placeholder="说说此刻想分享的事" @keydown.ctrl.enter.prevent="submit"></textarea></label><p v-if="queued.length" class="kanata-help" role="status">{{ queued.length }} 条短句将合并为这一轮发送。</p><div class="kanata-actions"><button type="submit" :disabled="!canSend||busy||!configured||!draft.trim()">发送消息</button><button v-if="busy||queued.length" type="button" @click="stop">停止回复</button><button v-if="lastUser&&!browsingEarlier" type="button" :disabled="!canSend||busy||!configured" @click="retry">重试最近一轮</button></div>
    </form>
    <details :key="candidateView ? overview?.conversation.id : undefined" class="kanata-usage" @toggle="toggleUsage"><summary>本会话 AI 用量<span v-if="!candidateView||usage"> · {{ usage?.count??attempts.length }} 次请求</span></summary><p v-if="candidateView?.usageLoading.value" role="status">正在载入用量…</p><button v-if="candidateView?.usageError.value" type="button" @click="candidateView.loadUsage()">重试载入用量</button><p class="kanata-help">每次重试分别记录；真实 Token 来自服务端，缺失时显示保守估算。费用是人民币区间估算，未知模型或自定义服务不套用官方价格，最终以账单为准。</p><p class="kanata-help"><a :href="KANATA_PRICE_SOURCE" target="_blank" rel="noopener noreferrer">官方价格来源</a> · {{ KANATA_PRICE_VERSION }}</p><ul><li v-for="attempt in attempts" :key="attempt.id"><strong>{{ attempt.model }} · {{ attempt.status==='pending'?'结果未知／可能已计费':attempt.status==='failed'?'未完成':'已完成' }}</strong><p v-if="attempt.usage">真实 Token：输入 {{ attempt.usage.promptTokens }} / 输出 {{ attempt.usage.completionTokens }}</p><p v-else>Token 缺失 · 输入保守估算 {{ attempt.estimatedInputTokens }} / 输出保守估算 {{ attempt.estimatedOutputTokens }}</p><p>{{ estimateKanataCost(attempt).minimumCny===null?'暂无适用价格':`费用估算 ¥${estimateKanataCost(attempt).minimumCny.toFixed(6)}～${estimateKanataCost(attempt).maximumCny.toFixed(6)}` }}</p><p v-if="attempt.errorCode" class="kanata-help">{{ attempt.errorCode }}</p></li></ul><button v-if="usage?.cursor" type="button" :disabled="candidateView.usageLoading.value" @click="candidateView.loadUsage(usage.cursor)">更多用量</button></details>
  </section>
</template>
