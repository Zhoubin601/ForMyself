// @ts-check
import {watch} from 'vue'
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useSettingsStore} from '../stores/settings.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {restoreState} from '../platform/storage/restoreState.js'
import {completeChat} from './aiClient.js'
import {planKanataSocial,beginKanataSocial,buildKanataSocialContext,completeKanataSocial,kanataSocialStateSignature} from '../features/chat/autonomy/kanataSocial.js'
import {recordKanataAttempt} from '../features/chat/domain/kanataConversation.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {{snapshot:unknown,saveError?:string,hasPendingSave?:boolean,update:(change:(draft:Data)=>void)=>Promise<Data>}} Store */
/** @param {{store?:Store,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,settings?:ReturnType<typeof useSettingsStore>,completion?:typeof completeChat,clock?:()=>number,idFactory?:()=>string}} [adapters] */
export function createKanataSocialRuntime(adapters={}) {
  const store=adapters.store||/** @type {Store} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore()
  const completion=adapters.completion||completeChat,tools={clock:adapters.clock||Date.now,id:adapters.idFactory||(()=>crypto.randomUUID())},session=auth.sessionRevision
  let disposed=false,controller=/** @type {AbortController|null} */(null)
  const cancel=()=>controller?.abort(),unwatch=watch(()=>auth.sessionRevision,cancel,{flush:'sync'})
  const assert=()=>{if(disposed||session!==auth.sessionRevision||controller?.signal.aborted)throw Error('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw Error('RESTORE_RECOVERY_REQUIRED');if(!store.snapshot)throw Error('KANATA_NOT_LOADED');if(store.saveError||store.hasPendingSave)throw Error('KANATA_PENDING_SAVE')}
  /** @param {string} worldId */
  const run=async worldId=>{
    assert();if(controller)throw Error('SOCIAL_BUSY')
    const plan=planKanataSocial(/** @type {Data} */(store.snapshot),worldId,tools.clock())
    if(!plan)return{status:'not-needed'}
    if(!settings.aiApiKey?.trim())return{status:'missing-key'}
    controller=new AbortController()
    try{
      const result=await access.runOperation(['chat'],async()=>{
        assert();await store.update(draft=>{Object.assign(draft,beginKanataSocial(draft,plan,tools))})
        const task=/** @type {Data} */(store.snapshot).tasks.find(t=>t.idempotencyKey===plan.idempotencyKey&&t.worldId===worldId)
        if(!task?.social||!task.conversationId)throw Error('SOCIAL_TASK_MISSING')
        /** @type {{speakerId:string,content:string,lifeSources:import('../features/chat/domain/kanataTypes').LifeSource[]}[]} */
        const replies=[]
        const proofs=[]
        const assertScene=()=>{assert();if(kanataSocialStateSignature(/** @type {Data} */(store.snapshot),worldId)!==plan.signature||task.leaseUntil<=tools.clock())throw Error('SOCIAL_SCENE_CHANGED')}
        try{
          for(const instanceId of task.social.participantIds){
            assertScene();const context=buildKanataSocialContext(/** @type {Data} */(store.snapshot),task.id,instanceId,replies)
            proofs.push({instanceId,pending:[...replies],signature:context.signature})
            const response=await completion({messages:context.messages,stream:false,maxTokens:512,signal:controller?.signal,onAttempt:async attempt=>{
              assert();await store.update(draft=>{Object.assign(draft,recordKanataAttempt(draft,{...attempt,worldId,instanceId,conversationId:/** @type {string} */(task.conversationId),turnId:task.id,purpose:'world'}))})
            }})
            assertScene();for(const proof of proofs)if(buildKanataSocialContext(/** @type {Data} */(store.snapshot),task.id,proof.instanceId,proof.pending).signature!==proof.signature)throw Error('SOCIAL_CONTEXT_CHANGED')
            replies.push({speakerId:instanceId,content:response.content,lifeSources:context.lifeSources})
          }
          await store.update(draft=>{assert();Object.assign(draft,completeKanataSocial(draft,task.id,replies,tools))})
          return{status:'succeeded',taskId:task.id}
        }catch(error){
          if(!disposed&&session===auth.sessionRevision&&!restoreState.blocked&&!store.saveError&&!store.hasPendingSave)await store.update(draft=>{const failed=draft.tasks.find(t=>t.id===task.id);if(failed){failed.state='failed';failed.errorCode='SOCIAL_GENERATION_FAILED';failed.leaseUntil=0}})
          throw error
        }
      })
      if(result===false)throw Error('KANATA_OPERATION_CANCELLED')
      return result
    }finally{controller=null}
  }
  return{run,cancel,dispose(){disposed=true;cancel();unwatch()}}
}
