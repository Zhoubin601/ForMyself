// @ts-check
import { watch } from 'vue'
import { useKanataStore } from '../features/chat/kanataStore.js'
import { useAuthStore } from '../stores/auth.js'
import { useProtectedAccessStore } from '../stores/protectedAccess.js'
import { useSettingsStore } from '../stores/settings.js'
import { completeChat } from './aiClient.js'
import { restoreState } from '../platform/storage/restoreState.js'
import { kanataConversation, decideKanataSpeakers, buildKanataConversationContext, splitKanataBubbles, recordKanataAttempt } from '../features/chat/domain/kanataConversation.js'
import { resolveKanataCharacter } from '../features/chat/domain/kanataManagementCore.js'
import {createKanataLifeReaders,collectKanataLifeContext} from './kanataLifeContext.js'
import {createKanataExperienceRuntime} from './kanataExperienceRuntime.js'
import {kanataReplyLimits,validateGroupReplyLimits} from '../features/chat/domain/groupReplyLimits.js'
import {validateReplyTimingPolicy} from '../features/chat/domain/replyTimingPolicy.js'
import {planKanataReplyDelay} from '../features/chat/autonomy/kanataReplyTiming.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {{snapshot:unknown,update:(change:(data:Data)=>void)=>Promise<Data>}} ChatStorePort */
/** @param {string} code */
const failure = code => Object.assign(new Error(code),{code})
/** @param {number} ms @param {AbortSignal} signal */
const delay = (ms,signal) => new Promise((resolve,reject) => {
  if(signal.aborted){reject(failure('ABORTED'));return}
  const abort=()=>{clearTimeout(timer);reject(failure('ABORTED'))}
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve(undefined)},ms)
  signal.addEventListener('abort',abort,{once:true})
})
/** Page-owned cancellation, operation lease and immutable request target.
 * @param {{store?:ChatStorePort,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,
 * settings?:ReturnType<typeof useSettingsStore>,completion?:typeof completeChat,clock?:()=>number,idFactory?:()=>string,
 * lifeReaders?:Parameters<typeof collectKanataLifeContext>[2],experience?:ReturnType<typeof createKanataExperienceRuntime>}} [adapters]
 */
export function createKanataChatRuntime(adapters={}) {
  const store=adapters.store||/** @type {ChatStorePort} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore()
  const completion=adapters.completion||completeChat,clock=adapters.clock||Date.now,id=adapters.idFactory||(()=>crypto.randomUUID())
  const revision=auth.sessionRevision
  const lifeReaders=adapters.lifeReaders||createKanataLifeReaders()
  const experience=adapters.experience||createKanataExperienceRuntime({store,auth,access,settings,completion,clock,idFactory:id})
  let disposed=false,controller=/** @type {AbortController|null} */(null)
  const cancel=()=>controller?.abort()
  const stop=watch(()=>auth.sessionRevision,cancel,{flush:'sync'})
  const assertSession=()=>{if(disposed||revision!==auth.sessionRevision)throw failure('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw failure('RESTORE_RECOVERY_REQUIRED')}
  /** @param {string} conversationId @param {{text?:string,retryMessageId?:string,stream?:boolean,delayMs?:number,persistDelay?:boolean,timing?:'configured'|'immediate',onDelta?:(value:{instanceId:string,content:string})=>void}} options */
  const send=async(conversationId,options={})=>{
    assertSession();if(controller)throw failure('KANATA_REPLY_BUSY')
    if(!settings.aiApiKey?.trim())throw failure('MISSING_KEY')
    const manualWait=options.delayMs??0
    if(!Number.isSafeInteger(manualWait)||manualWait<0||manualWait>30000)throw failure('INVALID_REPLY_DELAY')
    if(options.timing!==undefined&&!['configured','immediate'].includes(options.timing))throw failure('INVALID_REPLY_TIMING')
    const owned=new AbortController();controller=owned
    try{
      const result=await access.runOperation(['chat'],async()=>{
        assertSession()
        const snapshot=/** @type {Data} */(store.snapshot),c=kanataConversation(snapshot,conversationId)
        const worldId=c.worldId,identity=snapshot.identities.find(i=>i.worldId===worldId)
        if(!identity)throw failure('WORLD_IDENTITY_REQUIRED')
        const previous=options.retryMessageId?snapshot.messages.find(m=>m.id===options.retryMessageId&&m.conversationId===c.id&&m.senderId===identity.id):null
        if(options.retryMessageId&&!previous)throw failure('RETRY_SOURCE_UNAVAILABLE')
        const text=previous?.content||String(options.text||'').trim()
        if(!text||text.length>8000)throw failure('INVALID_MESSAGE')
        const speakers=decideKanataSpeakers(snapshot,c.id,text)
        const limits=kanataReplyLimits(c)
        const done=previous?snapshot.messages.filter(m=>m.conversationId===c.id&&m.replyToMessageId===previous.id&&m.role==='assistant'&&m.status==='complete'&&!m.deleted):[]
        const needsReply=done.length<limits.maxMessages&&speakers.some(speaker=>!done.some(m=>m.senderId===speaker))
        const activityWait=options.timing==='immediate'?0:planKanataReplyDelay(snapshot,c,speakers,clock())
        const wait=options.timing==='immediate'||!needsReply?0:manualWait||activityWait
        const turnId=previous?.turnId||'turn-'+id(),messageId=previous?.id||'message-'+id()
        const cancelPending=/** @type {Data} */(store.snapshot).tasks.some(task=>task.deferredReply&&task.conversationId===conversationId&&task.state==='pending'&&(task.deferredReply.sourceMessageId!==messageId||!wait))
        if(!previous||cancelPending)await store.update(data=>{
          if(!previous)data.messages.push({id:messageId,worldId,conversationId:c.id,role:'user',senderType:'user',senderId:identity.id,senderNameSnapshot:identity.displayName,content:text,createdAt:clock(),revision:1,status:'complete',turnId,batchId:turnId})
          for(const task of data.tasks)if(task.deferredReply&&task.conversationId===conversationId&&task.state==='pending'&&(task.deferredReply.sourceMessageId!==messageId||!wait)){task.state='cancelled';task.leaseUntil=0}
        })
        if(wait&&(options.persistDelay||activityWait)){
          await store.update(draft=>{
            const source=draft.messages.find(m=>m.id===messageId);if(!source)throw failure('RETRY_SOURCE_UNAVAILABLE')
            const key=`deferred-reply-v1:${messageId}:${source.revision}`
            for(const task of draft.tasks)if(task.deferredReply&&task.conversationId===conversationId&&task.state==='pending'&&task.deferredReply.sourceMessageId!==messageId){task.state='cancelled';task.leaseUntil=0}
            const existing=draft.tasks.find(t=>t.idempotencyKey===key&&t.worldId===worldId)
            if(!existing)draft.tasks.push({id:'deferred-'+id(),worldId,kind:'reply',state:'pending',idempotencyKey:key,sourceRefs:[{messageId,revision:source.revision}],sourceRevision:source.revision,attempt:0,notBefore:clock()+wait,leaseUntil:0,conversationId,resultEventIds:[],deferredReply:{sourceMessageId:messageId,sourceRevision:source.revision,expiresAt:clock()+2*3600000,activityDelay:Boolean(activityWait&&!manualWait)}})
            else if(options.retryMessageId&&['failed','cancelled'].includes(existing.state)){existing.state='pending';existing.notBefore=clock()+wait;existing.leaseUntil=0;existing.errorCode='';if(existing.deferredReply){existing.deferredReply.expiresAt=clock()+2*3600000;existing.deferredReply.activityDelay=Boolean(activityWait&&!manualWait)}}
          })
          return{messageId,turnId,deferred:true,activityDelayed:Boolean(activityWait&&!manualWait)}
        }
        const assertCurrent=()=>{
          assertSession();if(owned.signal.aborted)throw failure('ABORTED')
          const data=/** @type {Data} */(store.snapshot)
          const currentConversation=kanataConversation(data,conversationId)
          if(currentConversation.revision!==c.revision||JSON.stringify(kanataReplyLimits(currentConversation))!==JSON.stringify(limits)||JSON.stringify(currentConversation.replyTiming)!==JSON.stringify(c.replyTiming))throw failure('STALE_CONTEXT')
          const latest=data.messages.filter(m=>m.conversationId===conversationId&&m.role==='user').at(-1)
          if(latest?.id!==messageId)throw failure('STALE_TURN')
        }
        assertCurrent();if(wait)await delay(wait,owned.signal)
        /** @param {Data} data */
        const completedReplies=data=>data.messages.filter(m=>m.worldId===worldId&&m.conversationId===conversationId&&m.replyToMessageId===messageId&&m.role==='assistant'&&m.status==='complete'&&!m.deleted)
        const completed=completedReplies(/** @type {Data} */(store.snapshot))
        const pending=speakers.filter(instanceId=>!completed.some(m=>m.senderId===instanceId)).slice(0,Math.max(0,limits.maxMessages-completed.length))
        for(const [index,instanceId] of pending.entries()){
          assertCurrent()
          let data=/** @type {Data} */(store.snapshot)
          if(completedReplies(data).some(m=>m.senderId===instanceId))continue
          const remaining=limits.maxMessages-completedReplies(data).length
          if(remaining<1)break
          const reserved=Math.min(pending.length-index-1,remaining-1)
          const bubbleLimit=Math.min(4,remaining-reserved)
          const life=await collectKanataLifeContext(data,{worldId,instanceId,group:c.type==='group'},lifeReaders)
          assertCurrent();data=/** @type {Data} */(store.snapshot)
          const lifeNow=await collectKanataLifeContext(data,{worldId,instanceId,group:c.type==='group'},lifeReaders)
          if(life.signature!==lifeNow.signature)throw failure('LIFE_PERMISSION_REVISED')
          assertCurrent();data=/** @type {Data} */(store.snapshot)
          const context=buildKanataConversationContext(data,c.id,instanceId,{lifeEntries:life.entries,lifeSources:life.lifeSources})
          const response=await completion({messages:context.messages,signal:owned.signal,stream:options.stream!==false,
            onDelta:content=>{if(!disposed&&revision===auth.sessionRevision&&!owned.signal.aborted)options.onDelta?.({instanceId,content})},
            onAttempt:async attempt=>{
              assertSession()
              await store.update(draft=>{Object.assign(draft,recordKanataAttempt(draft,{...attempt,worldId,conversationId,instanceId,turnId}))})
            }})
          assertCurrent();data=/** @type {Data} */(store.snapshot)
          if(data.instances.find(i=>i.id===instanceId)?.revision!==context.instanceRevision||data.conversations.find(v=>v.id===conversationId)?.revision!==context.conversationRevision)throw failure('STALE_CONTEXT')
          const afterLife=await collectKanataLifeContext(data,{worldId,instanceId,group:c.type==='group'},lifeReaders)
          assertCurrent()
          const freshContext=buildKanataConversationContext(/** @type {Data} */(store.snapshot),c.id,instanceId,{lifeEntries:afterLife.entries,lifeSources:afterLife.lifeSources})
          if(afterLife.signature!==life.signature||freshContext.knowledgeSignature!==context.knowledgeSignature||JSON.stringify(freshContext.messages)!==JSON.stringify(context.messages))throw failure('STALE_CONTEXT')
          const bubbles=splitKanataBubbles(response.content,context.mode,bubbleLimit),batchId='batch-'+id(),name=resolveKanataCharacter(data,instanceId).name
          // All bubbles of one speaker commit together: cancellation/save failure cannot leave
          // a complete first bubble that makes retry incorrectly skip the remaining reply.
          assertCurrent()
          await store.update(draft=>{for(const content of bubbles)draft.messages.push({id:'message-'+id(),worldId,conversationId,role:'assistant',senderType:'character',senderId:instanceId,senderNameSnapshot:name,content,createdAt:clock(),revision:1,status:'complete',turnId,batchId,replyToMessageId:messageId,replyToRevision:draft.messages.find(m=>m.id===messageId)?.revision||1,lifeSources:context.lifeSources})})
        }
        return{messageId,turnId}
      })
      if(result===false)throw failure('KANATA_OPERATION_CANCELLED')
      // Acquire fresh protected leases only after the chat lease has settled; never nest
      // operations on the serial queue. A failed summary does not turn a saved reply into failure.
      if(!owned.signal.aborted&&!disposed&&revision===auth.sessionRevision){
        const current=/** @type {Data} */(store.snapshot),responded=new Set(current.messages.filter(m=>m.turnId===result.turnId&&m.role==='assistant').map(m=>m.senderId)),speakers=current.instances.filter(i=>responded.has(i.id))
        for(const speaker of speakers.slice(0,2))for(const kind of /** @type {const} */(['memory','summary'])){
          if(owned.signal.aborted||disposed||revision!==auth.sessionRevision)break
          try{await experience.organize(conversationId,speaker.id,kind,{signal:owned.signal,automatic:true})}catch{/* Task state/error remains inspectable; L0 and successful reply are retained. */}
        }
      }
      return result
    }finally{if(controller===owned)controller=null}
  }
  /** @param {string} conversationId @param {'daily'|'roleplay'} mode */
  const setMode=async(conversationId,mode)=>{
    assertSession();cancel()
    const result=await access.runOperation(['chat'],()=>{assertSession();return store.update(data=>{const c=kanataConversation(data,conversationId);c.mode=mode;c.revision++})})
    if(result===false)throw failure('KANATA_OPERATION_CANCELLED')
    return result
  }
  /** Explicitly configured limits are per group, with optimistic revision protection.
   * @param {string} conversationId @param {number} expectedRevision
   * @param {import('../features/chat/domain/kanataTypes').GroupReplyLimits} input */
  const setGroupLimits=async(conversationId,expectedRevision,input)=>{
    assertSession()
    const limits=validateGroupReplyLimits(input)
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw failure('INVALID_GROUP_REVISION')
    cancel()
    const result=await access.runOperation(['chat'],()=>{
      assertSession()
      return store.update(data=>{
        const conversation=kanataConversation(data,conversationId)
        if(conversation.type!=='group')throw failure('GROUP_CONVERSATION_REQUIRED')
        if(conversation.revision!==expectedRevision)throw failure('STALE_GROUP_LIMITS')
        conversation.replyLimits=limits;conversation.revision++
      })
    })
    if(result===false)throw failure('KANATA_OPERATION_CANCELLED')
    return result
  }
  /** @param {string} conversationId */
  const cancelDeferred=async conversationId=>{assertSession();const result=await access.runOperation(['chat'],()=>store.update(draft=>{assertSession();for(const task of draft.tasks)if(task.deferredReply&&task.conversationId===conversationId&&task.state==='pending'){task.state='cancelled';task.leaseUntil=0}}));if(result===false)throw failure('KANATA_OPERATION_CANCELLED');return result}
  /** @param {string} conversationId @param {number} expectedRevision
   * @param {import('../features/chat/domain/kanataTypes').ReplyTimingPolicy} input */
  const setReplyTiming=async(conversationId,expectedRevision,input)=>{
    assertSession();const policy=validateReplyTimingPolicy(input)
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw failure('INVALID_REPLY_TIMING_REVISION')
    cancel()
    const result=await access.runOperation(['chat'],()=>{
      assertSession()
      return store.update(data=>{
        const conversation=kanataConversation(data,conversationId)
        if(conversation.revision!==expectedRevision)throw failure('STALE_REPLY_TIMING')
        conversation.replyTiming=policy;conversation.revision++
        if(!policy.enabled)for(const task of data.tasks)if(task.conversationId===conversationId&&task.state==='pending'&&task.deferredReply?.activityDelay)task.notBefore=Math.min(task.notBefore,clock())
      })
    })
    if(result===false)throw failure('KANATA_OPERATION_CANCELLED')
    return result
  }
  return{send,setMode,setGroupLimits,setReplyTiming,cancel,cancelDeferred,reviseMessage:experience.reviseMessage,dispose:()=>{disposed=true;cancel();experience.dispose();stop()}}
}
