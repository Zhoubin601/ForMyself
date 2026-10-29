// @ts-check
import {watch} from 'vue'
import {useKanataStore} from '../features/chat/kanataStore.js'
import {useAuthStore} from '../stores/auth.js'
import {useProtectedAccessStore} from '../stores/protectedAccess.js'
import {restoreState} from '../platform/storage/restoreState.js'
import {planKanataWorldWindow,completeKanataWorldWindow,setKanataWorldActivity,configureKanataAutonomy} from '../features/chat/autonomy/kanataAutonomy.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {{snapshot:unknown,saveError?:string,hasPendingSave?:boolean,update:(change:(draft:Data)=>void)=>Promise<Data>}} Store */
/** Explicit protected foreground capability. No timers, native background service or AI.
 * Composition-root resume wiring and social/notification work are separate P6 slices.
 * @param {{store?:Store,auth?:ReturnType<typeof useAuthStore>,access?:ReturnType<typeof useProtectedAccessStore>,clock?:()=>number,idFactory?:()=>string}} [adapters] */
export function createKanataWorldRuntime(adapters={}) {
  const store=adapters.store||/** @type {Store} */(/** @type {unknown} */(useKanataStore())),auth=adapters.auth||useAuthStore(),access=adapters.access||useProtectedAccessStore()
  const clock=adapters.clock||Date.now,id=adapters.idFactory||(()=>crypto.randomUUID()),session=auth.sessionRevision
  let disposed=false,busy=false,cancelled=false
  const stop=watch(()=>auth.sessionRevision,()=>{cancelled=true},{flush:'sync'})
  const assert=()=>{if(disposed||cancelled||session!==auth.sessionRevision)throw Error('KANATA_SESSION_EXPIRED');if(restoreState.blocked)throw Error('RESTORE_RECOVERY_REQUIRED');if(!store.snapshot)throw Error('KANATA_NOT_LOADED');if(store.saveError||store.hasPendingSave)throw Error('KANATA_PENDING_SAVE')}
  /** @param {string} worldId */
  const advance=async worldId=>{
    assert();if(busy)throw Error('WORLD_ADVANCE_BUSY');busy=true
    const now=clock()
    try{
      const result=await access.runOperation(['chat'],async()=>{
        let windows=0,skippedMs=0
        while(windows<6){
          assert();const plan=planKanataWorldWindow(/** @type {Data} */(store.snapshot),worldId,now)
          if(!plan)break
          // A failed write rejects here. Never process the next window from an unsaved draft.
          await store.update(draft=>{assert();Object.assign(draft,completeKanataWorldWindow(draft,plan,{clock:()=>now,id}))})
          windows++;skippedMs+=plan.skippedMs
        }
        return{windows,skippedMs}
      })
      if(result===false)throw Error('KANATA_OPERATION_CANCELLED')
      return result
    }finally{busy=false}
  }
  return{advance,
    /** @param {string} worldId @param {number} revision @param {Parameters<typeof configureKanataAutonomy>[3]} fields */
    async configure(worldId,revision,fields){assert();const result=await access.runOperation(['chat'],()=>store.update(draft=>{assert();Object.assign(draft,configureKanataAutonomy(draft,worldId,revision,fields,clock()))}));if(result===false)throw Error('KANATA_OPERATION_CANCELLED');return result},
    /** @param {string} worldId @param {number} revision @param {Parameters<typeof setKanataWorldActivity>[3]} flags */
    async setActivity(worldId,revision,flags){assert();const result=await access.runOperation(['chat'],()=>store.update(draft=>{assert();Object.assign(draft,setKanataWorldActivity(draft,worldId,revision,flags,clock()))}));if(result===false)throw Error('KANATA_OPERATION_CANCELLED');return result},
    dispose(){disposed=true;stop()}
  }
}
