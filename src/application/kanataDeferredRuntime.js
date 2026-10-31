// @ts-check
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {useSettingsStore} from '../stores/settings.js'
import {createKanataChatRuntime} from './kanataChatRuntime.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @param {{store?:{snapshot:unknown,saveError?:string,hasPendingSave?:boolean,update:(change:(d:Data)=>void)=>Promise<Data>},auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,settings?:ReturnType<typeof useSettingsStore>,chat?:ReturnType<typeof createKanataChatRuntime>,clock?:()=>number}} [adapters] */
export function createKanataDeferredRuntime(adapters={}) {
  const store=adapters.store||/** @type {NonNullable<typeof adapters.store>} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore(),settings=adapters.settings||useSettingsStore(),chat=adapters.chat||createKanataChatRuntime(),clock=adapters.clock||Date.now,session=auth.sessionRevision
  let disposed=false,busy=false
  const valid=()=>!disposed&&session===auth.sessionRevision&&!!store.snapshot&&!store.saveError&&!store.hasPendingSave
  const run=async()=>{
    if(!valid()||busy)return
    busy=true
    try{
      if(/** @type {Data} */(store.snapshot).tasks.some(t=>t.deferredReply&&t.state==='running'&&t.leaseUntil<=clock()))await access.runOperation(['chat'],()=>store.update(draft=>{for(const task of draft.tasks)if(task.deferredReply&&task.state==='running'&&task.leaseUntil<=clock()){task.state='failed';task.leaseUntil=0;task.errorCode='DEFERRED_REPLY_INTERRUPTED'}}))
      const ids=/** @type {Data} */(store.snapshot).tasks.filter(t=>t.deferredReply&&t.state==='pending'&&t.notBefore<=clock()).slice(0,2).map(t=>t.id)
      for(const id of ids){
        if(!valid())break
        const result=await access.runOperation(['chat'],async()=>{
          if(!valid())return null
          let selected=/** @type {Data['tasks'][number]|null} */(null)
          await store.update(draft=>{
            const task=draft.tasks.find(t=>t.id===id&&t.state==='pending');if(!task?.deferredReply)return
            const source=draft.messages.find(m=>m.id===task.deferredReply?.sourceMessageId),latest=draft.messages.filter(m=>m.conversationId===task.conversationId&&m.role==='user'&&!m.deleted).at(-1)
            if(!source||source.deleted||source.revision!==task.deferredReply.sourceRevision||latest?.id!==source.id||task.deferredReply.expiresAt<clock()){task.state='cancelled';task.leaseUntil=0;return}
            if(!settings.aiApiKey?.trim())return
            task.state='running';task.attempt++;task.leaseUntil=clock()+120000;selected=task
          });return selected
        })
        // The preparation lease is finished before invoking the serial chat operation.
        if(!result||!valid())continue
        try{
          // A due task has exhausted its user-selected bounded wait. Rebuild the latest
          // conversation/knowledge context, but never recursively postpone the same task.
          await chat.send(/** @type {string} */(result.conversationId),{retryMessageId:result.deferredReply?.sourceMessageId,stream:false,delayMs:0,timing:'immediate'})
          if(valid())await access.runOperation(['chat'],()=>store.update(draft=>{const task=draft.tasks.find(t=>t.id===id);if(task?.state==='running'){task.state='succeeded';task.leaseUntil=0}}))
        }catch{
          if(valid())await access.runOperation(['chat'],()=>store.update(draft=>{const task=draft.tasks.find(t=>t.id===id);if(task?.state==='running'){task.state='failed';task.leaseUntil=0;task.errorCode='DEFERRED_REPLY_FAILED'}}))
        }
      }
    }finally{busy=false}
  }
  return{run,dispose(){disposed=true;chat.dispose()}}
}
