// @ts-check
import {watch} from 'vue'
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {useSettingsStore} from '../stores/settings.js'
import {restoreState} from '../platform/storage/restoreState.js'
import {completeChat} from './aiClient.js'
import {recordKanataAttempt} from '../features/chat/domain/kanataConversation.js'
import {saveKanataMemory,resolveKanataMemoryConflict,shareKanataMemory,planKanataMemoryTask,beginKanataMemoryTask,completeKanataMemoryTask,failKanataMemoryTask,buildKanataMemoryPrompt} from '../features/chat/experience/kanataMemory.js'
import {setKanataLifeGrant,setKanataRoleBinding,setKanataMemoryPolicy} from '../features/chat/experience/kanataKnowledge.js'
import {proposeKanataEvent,commitKanataEvent,revokeKanataEvent,correctKanataEvent,reviseKanataMessage} from '../features/chat/experience/kanataEvents.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {{snapshot:unknown,update:(change:(data:Data)=>void)=>Promise<Data>}} Store */
/** @param {string} code */
const failure=code=>Object.assign(new Error(code),{code})
/** @param {{store?:Store,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,settings?:ReturnType<typeof useSettingsStore>,completion?:typeof completeChat,clock?:()=>number,idFactory?:()=>string}} [adapters] */
export function createKanataExperienceRuntime(adapters={}) {
  const store=adapters.store||/** @type {Store} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore()
  const completion=adapters.completion||completeChat,tools={id:adapters.idFactory||(()=>crypto.randomUUID()),clock:adapters.clock||Date.now},session=auth.sessionRevision
  let disposed=false,controller=/** @type {AbortController|null} */(null)
  const cancel=()=>controller?.abort(),unwatch=watch(()=>auth.sessionRevision,cancel,{flush:'sync'})
  const assert=()=>{if(disposed||session!==auth.sessionRevision)throw failure('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw failure('RESTORE_RECOVERY_REQUIRED');if(!store.snapshot)throw failure('KANATA_NOT_LOADED')}
  /** @param {(data:Data)=>Data} transform */
  const apply=async transform=>{assert();const result=await access.runOperation(['chat'],()=>{assert();return store.update(draft=>{Object.assign(draft,transform(draft))})});if(result===false)throw failure('KANATA_OPERATION_CANCELLED');return result}
  /** @param {string} conversationId @param {string} instanceId @param {'memory'|'summary'} kind @param {{signal?:AbortSignal,automatic?:boolean,force?:boolean}} [options] */
  const organize=async(conversationId,instanceId,kind,options={})=>{
    assert();if(controller)throw failure('MEMORY_GENERATION_BUSY')
    const plan=planKanataMemoryTask(/** @type {Data} */(store.snapshot),conversationId,instanceId,kind,options)
    if(!plan)return{status:/** @type {const} */('not-needed')}
    if(!settings.aiApiKey?.trim())throw failure('MISSING_KEY')
    const owned=new AbortController(),abort=()=>owned.abort();controller=owned
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)owned.abort()
    try{
      const result=await access.runOperation(['chat'],async()=>{
        assert();if(owned.signal.aborted)throw failure('ABORTED')
        const current=planKanataMemoryTask(/** @type {Data} */(store.snapshot),conversationId,instanceId,kind,options)
        if(!current)return{status:/** @type {const} */('not-needed')}
        await store.update(draft=>{Object.assign(draft,beginKanataMemoryTask(draft,current,tools))})
        const task=/** @type {Data} */(store.snapshot).tasks.find(t=>t.kind===kind&&t.idempotencyKey===current.idempotencyKey)
        if(!task)throw failure('MEMORY_TASK_UNAVAILABLE')
        try{
          const response=await completion({messages:buildKanataMemoryPrompt(current),stream:false,maxTokens:2048,signal:owned.signal,onAttempt:async attempt=>{
            assert();await store.update(draft=>{Object.assign(draft,recordKanataAttempt(draft,{...attempt,worldId:task.worldId,conversationId,instanceId,turnId:task.id,purpose:kind}))})
          }})
          assert();if(owned.signal.aborted)throw failure('ABORTED')
          await store.update(draft=>{Object.assign(draft,completeKanataMemoryTask(draft,task.id,task.attempt,response.content,tools))})
          return{status:/** @type {const} */('succeeded'),taskId:task.id}
        }catch(error){
          if(!disposed&&session===auth.sessionRevision&&!restoreState.blocked){const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'MEMORY_GENERATION_FAILED';await store.update(draft=>{Object.assign(draft,failKanataMemoryTask(draft,task.id,task.attempt,code))})}
          throw error
        }
      })
      if(result===false)throw failure('KANATA_OPERATION_CANCELLED')
      return result
    }finally{options.signal?.removeEventListener('abort',abort);if(controller===owned)controller=null}
  }
  return{
    organize,cancel,dispose:()=>{disposed=true;cancel();unwatch()},
    /** @param {import('../features/chat/domain/kanataTypes').Memory} memory @param {number|null} revision */
    saveMemory:(memory,revision)=>apply(data=>saveKanataMemory(data,memory,revision)),
    /** @param {string} preferredId @param {string[]} discardedIds */
    resolveConflict:(preferredId,discardedIds)=>apply(data=>resolveKanataMemoryConflict(data,preferredId,discardedIds)),
    /** @param {string} memoryId @param {string} recipientId */
    shareMemory:(memoryId,recipientId)=>apply(data=>shareKanataMemory(data,memoryId,recipientId,tools)),
    /** @param {string} worldId @param {string} instanceId @param {import('../features/chat/domain/kanataTypes').LifeModule} moduleId @param {{read:boolean,remember:boolean,share:boolean}} flags */
    setGrant:(worldId,instanceId,moduleId,flags)=>apply(data=>setKanataLifeGrant(data,worldId,instanceId,moduleId,flags,tools.id)),
    /** @param {'global'|import('../features/chat/domain/kanataTypes').LifeModule} moduleId @param {import('../features/chat/domain/kanataTypes').RoleBinding|null|'inherit'} binding */
    setBinding:(moduleId,binding)=>apply(data=>setKanataRoleBinding(data,moduleId,binding)),
    /** @param {import('../features/chat/domain/kanataTypes').MemoryPolicy} policy */
    setPolicy:policy=>apply(data=>setKanataMemoryPolicy(data,policy)),
    /** @param {Parameters<typeof proposeKanataEvent>[1]} fields */
    proposeEvent:fields=>apply(data=>proposeKanataEvent(data,fields,tools)),
    /** @param {string} eventId @param {number} revision */
    commitEvent:(eventId,revision)=>apply(data=>commitKanataEvent(data,eventId,revision,tools)),
    /** @param {Parameters<typeof revokeKanataEvent>[1]} plan @param {Parameters<typeof revokeKanataEvent>[2]} decision */
    revokeEvent:(plan,decision)=>apply(data=>revokeKanataEvent(data,plan,decision,tools)),
    /** @param {Parameters<typeof correctKanataEvent>[1]} plan @param {Parameters<typeof correctKanataEvent>[2]} decision @param {string} summary */
    correctEvent:(plan,decision,summary)=>apply(data=>correctKanataEvent(data,plan,decision,summary,tools)),
    /** @param {string} messageId @param {number} revision @param {{content:string,deleted:boolean}} fields */
    reviseMessage:(messageId,revision,fields)=>apply(data=>reviseKanataMessage(data,messageId,revision,fields,tools))
  }
}
