// @ts-check
import {watch} from 'vue'
import {restoreState} from '../platform/storage/restoreState.js'
/** Lazy protected composition participant. It never unlocks chat, reads private data while
 * locked, or keeps an AI worker alive after backgrounding. Each tick processes at most two
 * worlds and creates at most one bounded scene/contact per world.
 * @param {{auth:{sessionRevision:number,isLocked:boolean},access:{status:Record<string,string>},settings:{warmHomeEnabled?:boolean},load?:()=>Promise<{snapshot:unknown,deferred?:{run:()=>Promise<unknown>,dispose:()=>void},world: {advance:(worldId:string)=>Promise<unknown>,dispose:()=>void},social:{run:(worldId:string)=>Promise<unknown>,dispose:()=>void},contact:{run:(worldId:string)=>Promise<unknown>,dispose:()=>void}}>,onError?:(code:string)=>void,visible?:()=>boolean}} adapters */
export function createKanataActivityLifecycle(adapters) {
  const visible=adapters.visible||(()=>typeof document==='undefined'||document.visibilityState!=='hidden')
  let active=true,disposed=false,busy=false,cursor=0,generation=0
  let timer=/** @type {ReturnType<typeof setInterval>|null} */(null),runtime=/** @type {Awaited<ReturnType<NonNullable<typeof adapters.load>>>|null} */(null)
  const ready=()=>!disposed&&active&&visible()&&!adapters.auth.isLocked&&adapters.access.status.chat==='ready'&&adapters.settings.warmHomeEnabled!==false&&!restoreState.blocked
  const release=()=>{generation++;runtime?.world.dispose();runtime?.social.dispose();runtime?.contact.dispose();runtime?.deferred?.dispose();runtime=null}
  const load=adapters.load||(async()=>{
    const [{useKanataStore},{createKanataWorldRuntime},{createKanataSocialRuntime},{createKanataContactRuntime},{createKanataDeferredRuntime}]=await Promise.all([import('../features/chat/kanataStore.js'),import('./kanataWorldRuntime.js'),import('./kanataSocialRuntime.js'),import('./kanataContactRuntime.js'),import('./kanataDeferredRuntime.js')])
    const store=useKanataStore()
    return{get snapshot(){return store.snapshot},world:createKanataWorldRuntime(),social:createKanataSocialRuntime(),contact:createKanataContactRuntime(),deferred:createKanataDeferredRuntime()}
  })
  const tick=async()=>{
    if(!ready()||busy)return
    busy=true;const owner=generation
    try{
      const resolved=runtime||await load()
      if(!ready()||owner!==generation){resolved.world.dispose();resolved.social.dispose();resolved.contact.dispose();resolved.deferred?.dispose();return}
      runtime=resolved
      await resolved.deferred?.run()
      if(!ready()||owner!==generation)return
      const data=/** @type {import('../features/chat/domain/kanataTypes').KanataData|null} */(resolved.snapshot)
      const worlds=data?.worlds.filter(w=>!w.archived&&(w.autonomyEnabled||w.proactiveEnabled))||[]
      const start=cursor;if(worlds.length)cursor=(cursor+2)%worlds.length
      for(let n=0;n<Math.min(2,worlds.length);n++){
        if(!ready()||owner!==generation)break
        const world=worlds[(start+n)%worlds.length]
        try{
          if(world.autonomyEnabled){await resolved.world.advance(world.id);if(!ready()||owner!==generation)break;await resolved.social.run(world.id)}
          if(ready()&&owner===generation)await resolved.contact.run(world.id)
        }catch{if(ready())adapters.onError?.('KANATA_ACTIVITY_FAILED')}
      }
    }catch{if(ready())adapters.onError?.('KANATA_ACTIVITY_FAILED')}
    finally{busy=false}
  }
  /** @type {(()=>void)|null} */
  let stopWatch=null
  return{id:'kanata-activity',
    initialize:tick,
    subscribe(){
      stopWatch=watch(()=>[adapters.auth.sessionRevision,adapters.auth.isLocked,adapters.access.status.chat,adapters.settings.warmHomeEnabled],()=>{release();void tick()},{flush:'sync'})
      timer=setInterval(()=>{void tick()},30000)
      return()=>{stopWatch?.();stopWatch=null;if(timer)clearInterval(timer);timer=null;release()}
    },
    resume(){active=true;return tick()},
    flush(){active=false;release()},
    dispose(){disposed=true;stopWatch?.();stopWatch=null;if(timer)clearInterval(timer);timer=null;release()}
  }
}
