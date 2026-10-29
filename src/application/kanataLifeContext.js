// @ts-check
import {readKanataAuthorizedLifeData} from '../features/chat/domain/kanataReadPermission.js'
/** @typedef {import('../features/chat/domain/kanataTypes').KanataData} Data */
/** @typedef {import('../features/chat/domain/kanataTypes').LifeModule} LifeModule */
/** A small explicit projection. No vault, credentials, settings, or whole-store serialization.
 * @param {Record<string,any>[]} rows @param {string[]} keys
 */
const project=(rows,keys)=>rows.slice(-14).map(row=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,typeof row[key]==='string'?row[key].slice(0,600):typeof row[key]==='number'||typeof row[key]==='boolean'?row[key]:String(row[key]).slice(0,100)])))
export function createKanataLifeReaders() {
  return {
    mood:async()=>{const {useMoodStore}=await import('../features/mood/moodStore.js');const s=useMoodStore();if(!s.isDataLoaded)await s.loadMoodRecords();if(!s.isDataLoaded||s.loadError)throw Error('LIFE_SOURCE_NOT_READY');return project(s.moodRecords,['id','date','mood','note'])},
    weight:async()=>{const {useWeightStore}=await import('../features/weight/weightStore.js');const s=useWeightStore();if(!s.isDataLoaded)await s.loadWeightRecords();if(!s.isDataLoaded||s.loadError)throw Error('LIFE_SOURCE_NOT_READY');return project(s.weightRecords,['id','date','weight','note'])},
    savings:async()=>{const {useDebtStore}=await import('../features/savings/savingsStore.js');const s=useDebtStore();if(!s.isDataLoaded)await s.loadDebts();if(!s.isDataLoaded||s.loadError)throw Error('LIFE_SOURCE_NOT_READY');return project(s.savedDebts,['id','name','totalAmount','remainingAmount','startDate','isCleared'])},
    schedule:async()=>{const {useScheduleStore}=await import('../features/schedule/scheduleStore.js');const s=useScheduleStore();if(!s.isDataLoaded)await s.loadSchedules();if(!s.isDataLoaded||s.loadError)throw Error('LIFE_SOURCE_NOT_READY');return project(s.series,['id','title','startDate','endDate','date','note','startTime','endTime'])},
    todo:async()=>{const {useTodoStore}=await import('../features/todo/todoStore.js');const s=useTodoStore();if(!s.isDataLoaded)await s.load();if(!s.isDataLoaded||s.loadError)throw Error('LIFE_SOURCE_NOT_READY');return{referenceDate:s.today,todayItems:project(s.todayItems,['id','taskId','key','title','note','date','time','completed']),planDefinitions:project(s.snapshot.tasks.filter(/** @param {{archived?:boolean}} task */ task=>!task.archived),['id','title','startDate','time']),notice:'今日完成状态来自现有待办仓库规则；计划定义不表示尚未完成的事实。最多展示各14项，不据此推断全部历史。'}}
  }
}
/** @param {unknown} value */
const fingerprint=async value=>{
  const bytes=new TextEncoder().encode(JSON.stringify(value)),digest=await crypto.subtle.digest('SHA-256',bytes)
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
/** Check before invoking even a lazy reader. Caller rechecks session and grant snapshot after
 * awaits and before using these results. No denied source is loaded "to check" its content.
 * @param {Data} data @param {{worldId:string,instanceId:string,group:boolean,moduleId?:LifeModule}} scope
 * @param {Partial<Record<LifeModule,()=>Promise<unknown>>>} readers
 */
export async function collectKanataLifeContext(data,scope,readers) {
  /** @type {{moduleId:LifeModule,value:unknown}[]} */
  const entries=[]
  /** @type {import('../features/chat/domain/kanataTypes').LifeSource[]} */
  const lifeSources=[]
  for(const moduleId of /** @type {LifeModule[]} */(Object.keys(readers))){
    if(scope.moduleId&&!['home','reports'].includes(scope.moduleId)&&moduleId!==scope.moduleId)continue
    const reader=readers[moduleId];if(!reader)continue
    const allowed=readKanataAuthorizedLifeData(data,{...scope,moduleId},reader)
    if(!allowed.allowed)continue
    const value=await allowed.value,serialized=JSON.stringify(value)
    if(serialized.length>12000)throw Error('LIFE_PROJECTION_TOO_LARGE')
    const grant=data.lifeGrants.find(g=>g.worldId===scope.worldId&&g.instanceId===scope.instanceId&&g.moduleId===moduleId)
    if(!grant)throw Error('LIFE_PERMISSION_REVISED')
    entries.push({moduleId,value});lifeSources.push({grantId:grant.id,revision:grant.revision,moduleId,instanceId:scope.instanceId,fingerprint:await fingerprint(value)})
  }
  return{entries,lifeSources,signature:await fingerprint([entries,lifeSources])}
}
