// @ts-check
import {watch} from 'vue'
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {useSettingsStore} from '../stores/settings.js'
import {restoreState} from '../platform/storage/restoreState.js'
import {completeChat} from './aiClient.js'
import {createKanataLifeReaders,collectKanataLifeContext} from './kanataLifeContext.js'
import {resolveKanataRoleBinding,canUseKanataLifeSources} from '../features/chat/experience/kanataKnowledge.js'
import {saveKanataMemory} from '../features/chat/experience/kanataMemory.js'
import {buildKanataConversationContext,recordKanataAttempt} from '../features/chat/domain/kanataConversation.js'
import {resolveKanataCharacter} from '../features/chat/domain/kanataManagementCore.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {import('../features/chat/domain/kanataTypes').LifeModule} Module */
/** @typedef {{snapshot:unknown,update:(change:(data:Data)=>void)=>Promise<Data>}} Store */
/** @param {string} code */
const fail=code=>Object.assign(new Error(code),{code})
/** Only imported when the ordinary page actually asks for a role reply. No protected
 * Store enters the home static graph, and passive page load never prompts for a password.
 * @param {{store?:Store,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,settings?:ReturnType<typeof useSettingsStore>,completion?:typeof completeChat,readers?:Parameters<typeof collectKanataLifeContext>[2],onRelease?:()=>void}} [adapters]
 */
export function createKanataLifeCompanion(adapters={}) {
  const store=adapters.store||/** @type {Store} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore()
  const readers=adapters.readers||createKanataLifeReaders(),completion=adapters.completion||completeChat
  let disposed=false,controller=/** @type {AbortController|null} */(null),ownerRevision=auth.sessionRevision
  const cancel=()=>controller?.abort(),stop=watch(()=>auth.sessionRevision,()=>{cancel();adapters.onRelease?.()},{flush:'sync'})
  const assert=()=>{if(disposed||ownerRevision!==auth.sessionRevision)throw fail('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw fail('RESTORE_RECOVERY_REQUIRED')}
  /** @param {Module} moduleId @param {string} task @param {{allowPrompt?:boolean}} [options] */
  const request=async(moduleId,task,options={})=>{
    if(disposed||controller)throw fail('LIFE_REQUEST_UNAVAILABLE')
    if(!options.allowPrompt&&(!access.authenticated||access.status.chat!=='ready'))return{status:/** @type {const} */('requires-unlock'),text:''}
    if(options.allowPrompt&&!await access.ensureModule('chat'))return{status:/** @type {const} */('cancelled'),text:''}
    if(disposed)throw fail('KANATA_SESSION_EXPIRED')
    ownerRevision=auth.sessionRevision;assert()
    const data=/** @type {Data} */(store.snapshot),binding=resolveKanataRoleBinding(data,moduleId)
    if(binding.status!=='ready')return{status:binding.status,text:''}
    const chosen=/** @type {import('../features/chat/domain/kanataTypes').RoleBinding} */(binding.binding)
    const grant=data.lifeGrants.find(g=>g.worldId===chosen.worldId&&g.instanceId===chosen.instanceId&&g.moduleId===moduleId)
    if(!grant?.read)return{status:/** @type {const} */('permission-required'),text:''}
    if(!settings.aiApiKey?.trim())throw fail('MISSING_KEY')
    if(typeof task!=='string'||!task.trim()||task.length>2000)throw fail('INVALID_LIFE_TASK')
    const owned=new AbortController();controller=owned
    try{
      const outcome=await access.runOperation(['chat'],async()=>{
        assert();const current=/** @type {Data} */(store.snapshot),resolved=resolveKanataRoleBinding(current,moduleId)
        if(JSON.stringify(resolved)!==JSON.stringify(binding)||current.lifeGrants.find(g=>g.id===grant.id)?.revision!==grant.revision)throw fail('LIFE_PERMISSION_REVISED')
        const c=current.conversations.find(c=>c.worldId===chosen.worldId&&c.type==='private'&&c.participantIds.includes(chosen.instanceId))
        if(!c)throw fail('LIFE_CONVERSATION_UNAVAILABLE')
        const scope={worldId:chosen.worldId,instanceId:chosen.instanceId,group:false,moduleId}
        const life=await collectKanataLifeContext(current,scope,readers);assert()
        const beforeRequest=/** @type {Data} */(store.snapshot)
        if(JSON.stringify(resolveKanataRoleBinding(beforeRequest,moduleId))!==JSON.stringify(binding)||beforeRequest.lifeGrants.find(g=>g.id===grant.id)?.revision!==grant.revision||!canUseKanataLifeSources(beforeRequest,life.lifeSources,scope))throw fail('LIFE_PERMISSION_REVISED')
        const turnId='life-'+crypto.randomUUID(),identity=current.identities.find(u=>u.worldId===chosen.worldId)
        if(!identity)throw fail('WORLD_IDENTITY_REQUIRED')
        const ownSource={grantId:grant.id,revision:grant.revision,moduleId,instanceId:chosen.instanceId,fingerprint:life.signature}
        const lifeSources=[...life.lifeSources,ownSource]
        // This is a task prompt, never persisted as a message the user supposedly typed.
        const virtual={id:'life-task-'+crypto.randomUUID(),worldId:chosen.worldId,conversationId:c.id,role:/** @type {const} */('user'),senderType:/** @type {const} */('user'),senderId:identity.id,senderNameSnapshot:identity.displayName,content:'生活模块任务：'+task,createdAt:Date.now(),revision:1,status:/** @type {const} */('complete'),turnId,batchId:turnId}
        const contextData={...beforeRequest,messages:[...beforeRequest.messages,virtual],memories:beforeRequest.memories.filter(m=>!m.lifeSources?.length||['home','reports'].includes(moduleId)||m.lifeSources.every(s=>s.moduleId===moduleId))}
        const context=buildKanataConversationContext(contextData,c.id,chosen.instanceId,{lifeEntries:life.entries,lifeSources,historyMessageIds:[virtual.id]})
        const response=await completion({messages:context.messages,stream:false,maxTokens:512,signal:owned.signal,onAttempt:async attempt=>{assert();await store.update(draft=>{Object.assign(draft,recordKanataAttempt(draft,{...attempt,worldId:chosen.worldId,conversationId:c.id,instanceId:chosen.instanceId,turnId,purpose:'life'}))})}})
        assert();if(owned.signal.aborted)throw fail('ABORTED')
        const after=await collectKanataLifeContext(/** @type {Data} */(store.snapshot),scope,readers)
        assert()
        const latest=/** @type {Data} */(store.snapshot)
        if(after.signature!==life.signature||JSON.stringify(resolveKanataRoleBinding(latest,moduleId))!==JSON.stringify(binding)||latest.lifeGrants.find(g=>g.id===grant.id)?.revision!==grant.revision)throw fail('LIFE_PERMISSION_REVISED')
        const actor=latest.instances.find(i=>i.id===chosen.instanceId)
        if(actor?.revision!==context.instanceRevision)throw fail('STALE_CONTEXT')
        const freshData={...latest,messages:[...latest.messages,virtual],memories:latest.memories.filter(m=>!m.lifeSources?.length||['home','reports'].includes(moduleId)||m.lifeSources.every(s=>s.moduleId===moduleId))}
        const freshContext=buildKanataConversationContext(freshData,c.id,chosen.instanceId,{lifeEntries:after.entries,lifeSources,historyMessageIds:[virtual.id]})
        if(freshContext.knowledgeSignature!==context.knowledgeSignature||JSON.stringify(freshContext.messages)!==JSON.stringify(context.messages))throw fail('STALE_CONTEXT')
        if(canUseKanataLifeSources(latest,lifeSources,{...scope,remember:true}))await store.update(draft=>{Object.assign(draft,saveKanataMemory(draft,{id:'memory-'+crypto.randomUUID(),worldId:chosen.worldId,ownerType:'character',ownerId:chosen.instanceId,layer:'L3',key:'life:'+moduleId+':'+life.signature.slice(0,16),content:response.content.slice(0,4000),sourceRefs:[],status:'candidate',revision:1,visibility:'private',knownBy:[chosen.instanceId],lifeSources,confidence:'inference',conversationId:c.id},null))})
        assert();if(owned.signal.aborted)throw fail('ABORTED')
        return{status:/** @type {const} */('succeeded'),text:response.content,speakerName:resolveKanataCharacter(latest,chosen.instanceId).name,binding:chosen,sessionRevision:ownerRevision}
      })
      if(outcome===false)throw fail('KANATA_OPERATION_CANCELLED')
      return outcome
    }finally{if(controller===owned)controller=null}
  }
  return{request,cancel,isCurrent:(revision=ownerRevision)=>!disposed&&revision===auth.sessionRevision&&ownerRevision===auth.sessionRevision,dispose:()=>{disposed=true;cancel();stop();adapters.onRelease?.()}}
}
