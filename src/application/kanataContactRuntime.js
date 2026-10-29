// @ts-check
import {watch} from 'vue'
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useSettingsStore} from '../stores/settings.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {restoreState} from '../platform/storage/restoreState.js'
import {completeChat} from './aiClient.js'
import {queueKanataContact,expireKanataContacts,beginKanataContact,buildKanataContactContext,completeKanataContact,kanataQuietTime} from '../features/chat/autonomy/kanataContact.js'
import {recordKanataAttempt} from '../features/chat/domain/kanataConversation.js'
import {deliverKanataNotification} from '../platform/kanataNotifications.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {{snapshot:unknown,saveError?:string,hasPendingSave?:boolean,update:(change:(draft:Data)=>void)=>Promise<Data>}} Store */
/** @param {{store?:Store,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,settings?:ReturnType<typeof useSettingsStore>,completion?:typeof completeChat,notify?:typeof deliverKanataNotification,clock?:()=>number,idFactory?:()=>string}} [adapters] */
export function createKanataContactRuntime(adapters={}) {
  const store=adapters.store||/** @type {Store} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore()
  const completion=adapters.completion||completeChat,notify=adapters.notify||deliverKanataNotification,tools={clock:adapters.clock||Date.now,id:adapters.idFactory||(()=>crypto.randomUUID())},session=auth.sessionRevision
  let disposed=false,controller=/** @type {AbortController|null} */(null)
  const cancel=()=>controller?.abort(),unwatch=watch(()=>auth.sessionRevision,cancel,{flush:'sync'})
  const assert=()=>{if(disposed||session!==auth.sessionRevision||controller?.signal.aborted)throw Error('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw Error('RESTORE_RECOVERY_REQUIRED');if(!store.snapshot)throw Error('KANATA_NOT_LOADED');if(store.saveError||store.hasPendingSave)throw Error('KANATA_PENDING_SAVE')}
  /** @param {string} worldId */
  const run=async worldId=>{
    assert();if(controller)throw Error('CONTACT_BUSY');controller=new AbortController()
    try{
      const result=await access.runOperation(['chat'],async()=>{
        assert();const before=/** @type {Data} */(store.snapshot),prepared=queueKanataContact(expireKanataContacts(before,tools.clock()),worldId,tools)
        if(JSON.stringify(prepared)!==JSON.stringify(before))await store.update(draft=>{Object.assign(draft,prepared)})
        const task=/** @type {Data} */(store.snapshot).tasks.find(t=>t.worldId===worldId&&t.contact&&t.state==='pending'&&t.notBefore<=tools.clock())
        if(!task||kanataQuietTime(/** @type {Data} */(store.snapshot),worldId,tools.clock()))return{status:'waiting'}
        if(!settings.aiApiKey?.trim())return{status:'missing-key'}
        assert();await store.update(draft=>{Object.assign(draft,beginKanataContact(draft,task.id,tools.clock()))})
        try{
          const context=buildKanataContactContext(/** @type {Data} */(store.snapshot),task.id)
          const response=await completion({messages:context.messages,stream:false,maxTokens:512,signal:controller?.signal,onAttempt:async attempt=>{
            assert();await store.update(draft=>{Object.assign(draft,recordKanataAttempt(draft,{...attempt,worldId,conversationId:/** @type {string} */(task.conversationId),instanceId:/** @type {string} */(task.instanceId),turnId:task.id,purpose:'proactive'}))})
          }})
          assert();const fresh=buildKanataContactContext(/** @type {Data} */(store.snapshot),task.id)
          if(JSON.stringify(fresh.messages)!==JSON.stringify(context.messages))throw Error('CONTACT_CONTEXT_CHANGED')
          await store.update(draft=>{assert();Object.assign(draft,completeKanataContact(draft,task.id,response.content,context.lifeSources,tools))})
          const latest=/** @type {Data} */(store.snapshot),world=latest.worlds.find(w=>w.id===worldId)
          if(world?.notificationsEnabled&&!kanataQuietTime(latest,worldId,tools.clock())){
            // At-most-once dispatch. If interrupted after this persisted claim, do not replay
            // stale lockscreen alerts; the generated message remains available in its chat.
            await store.update(draft=>{const target=draft.tasks.find(t=>t.id===task.id);if(target?.contact)target.contact.notificationState='dispatching'})
            try{
              const notification=await notify({notificationId:task.contact?.notificationId||0,taskId:task.id},{now:tools.clock})
              assert();await store.update(draft=>{const target=draft.tasks.find(t=>t.id===task.id);if(target?.contact)target.contact.notificationState=notification.status==='scheduled'?'sent':'denied'})
            }catch{if(session===auth.sessionRevision&&!disposed&&!store.saveError&&!store.hasPendingSave)await store.update(draft=>{const target=draft.tasks.find(t=>t.id===task.id);if(target?.contact)target.contact.notificationState='failed'})}
          }
          return{status:'succeeded',taskId:task.id}
        }catch(error){
          if(!disposed&&session===auth.sessionRevision&&!restoreState.blocked&&!store.saveError&&!store.hasPendingSave)await store.update(draft=>{const failed=draft.tasks.find(t=>t.id===task.id);if(failed?.state==='running'){failed.state='failed';failed.leaseUntil=0;failed.errorCode='CONTACT_GENERATION_FAILED'}})
          throw error
        }
      })
      if(result===false)throw Error('KANATA_OPERATION_CANCELLED')
      return result
    }finally{controller=null}
  }
  return{run,cancel,dispose(){disposed=true;cancel();unwatch()}}
}
