// @ts-check
import {validateKanataData,requireKanata as need,cloneKanataJson} from '../domain/kanataValidation.js'
import {proposeKanataEvent,commitKanataEvent} from '../experience/kanataEvents.js'
/** @typedef {import('../domain/kanataTypes').KanataData} Data */
/** @typedef {import('../domain/kanataTypes').AutonomyPolicy} Policy */
const WINDOW=30*60*1000
/** @param {number} time @param {string} timeZone */
export function kanataLocalTime(time,timeZone) {
  need(Number.isSafeInteger(time)&&time>=0,'INVALID_SIMULATION_TIME','time')
  try{
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time)
    const read=(/** @type {string} */ name)=>parts.find(p=>p.type===name)?.value||''
    return{date:`${read('year')}-${read('month')}-${read('day')}`,day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(read('weekday'))+1,minute:Number(read('hour'))*60+Number(read('minute'))}
  }catch{throw Object.assign(new Error('INVALID_SIMULATION_TIMEZONE'),{code:'INVALID_SIMULATION_TIMEZONE'})}
}
/** @param {Data} data @param {string} worldId @returns {Policy} */
export const kanataAutonomyPolicy=(data,worldId)=>data.autonomyPolicies?.find(p=>p.worldId===worldId)||{worldId,revision:1,dailyDialogueLimit:0,maxCatchUpHours:3,freedom:'strict',quietStartMinute:22*60,quietEndMinute:8*60}
/** Configuration changes begin a new current-time horizon, never simulate a newly edited
 * timetable backwards. Other worlds and instance identities remain unchanged.
 * @param {Data} input @param {string} worldId @param {number} revision
 * @param {{policy:Policy,instanceFlags:{id:string,autonomyEnabled:boolean,proactiveEnabled:boolean}[],schedules:import('../domain/kanataTypes').VirtualSchedule[]}} fields
 * @param {number} now */
export function configureKanataAutonomy(input,worldId,revision,fields,now) {
  const data=validateKanataData(input),world=data.worlds.find(w=>w.id===worldId&&!w.archived)
  need(world?.revision===revision,'WORLD_ACTIVITY_CONFLICT','world')
  const selected=/** @type {Data['worlds'][number]} */(world);kanataLocalTime(now,selected.timeZone)
  need(fields.policy.worldId===worldId&&fields.schedules.every(s=>s.worldId===worldId),'AUTONOMY_CONFIGURATION_SCOPE','fields')
  need(new Set(fields.instanceFlags.map(f=>f.id)).size===fields.instanceFlags.length,'DUPLICATE_INSTANCE_FLAGS','fields')
  for(const flag of fields.instanceFlags){const instance=data.instances.find(i=>i.id===flag.id&&i.worldId===worldId);need(instance&&typeof flag.autonomyEnabled==='boolean'&&typeof flag.proactiveEnabled==='boolean','AUTONOMY_INSTANCE_SCOPE','instance');if(instance){instance.autonomyEnabled=flag.autonomyEnabled;instance.proactiveEnabled=flag.proactiveEnabled;instance.revision++}}
  const policy={...cloneKanataJson(fields.policy),revision:kanataAutonomyPolicy(data,worldId).revision+1}
  data.autonomyPolicies=[...(data.autonomyPolicies||[]).filter(p=>p.worldId!==worldId),policy]
  data.virtualSchedules=[...(data.virtualSchedules||[]).filter(s=>s.worldId!==worldId),...cloneKanataJson(fields.schedules)]
  selected.revision++;selected.lastSimulatedAt=Math.max(selected.lastSimulatedAt,now)
  return validateKanataData(data)
}
/** Three independent switches. A changed autonomy switch resets the clock, so disabled time
 * never turns into catch-up events. Backward clocks cannot lower a durable watermark.
 * @param {Data} input @param {string} worldId @param {number} revision
 * @param {{autonomyEnabled:boolean,proactiveEnabled:boolean,notificationsEnabled:boolean}} flags @param {number} now */
export function setKanataWorldActivity(input,worldId,revision,flags,now) {
  const data=validateKanataData(input),world=data.worlds.find(w=>w.id===worldId&&!w.archived)
  need(world?.revision===revision,'WORLD_ACTIVITY_CONFLICT','world')
  const selected=/** @type {Data['worlds'][number]} */(world)
  kanataLocalTime(now,selected.timeZone)
  need(['autonomyEnabled','proactiveEnabled','notificationsEnabled'].every(k=>typeof flags[/** @type {keyof typeof flags} */(k)]==='boolean'),'INVALID_ACTIVITY_FLAGS','flags')
  if(selected.autonomyEnabled!==flags.autonomyEnabled)selected.lastSimulatedAt=Math.max(selected.lastSimulatedAt,now)
  Object.assign(selected,flags);selected.revision++
  if(!flags.proactiveEnabled)for(const task of data.tasks)if(task.worldId===worldId&&task.contact&&['pending','running'].includes(task.state)){task.state='cancelled';task.leaseUntil=0}
  return validateKanataData(data)
}
/** An immutable plan has no side effects. UTC windows prevent DST/time-zone/day-key replay.
 * At most six windows per resume; old skipped time is explicit, never fabricated history.
 * @param {Data} data @param {string} worldId @param {number} now */
export function planKanataWorldWindow(data,worldId,now) {
  const world=data.worlds.find(w=>w.id===worldId&&!w.archived)
  need(world,'SIMULATION_WORLD_UNAVAILABLE','world')
  const selected=/** @type {Data['worlds'][number]} */(world),policy=kanataAutonomyPolicy(data,worldId)
  kanataLocalTime(now,selected.timeZone)
  if(!selected.autonomyEnabled||now<=selected.lastSimulatedAt)return null
  const latest=Math.floor(now/WINDOW)*WINDOW
  if(latest<=selected.lastSimulatedAt)return null
  const start=Math.max(selected.lastSimulatedAt,latest-Math.min(policy.maxCatchUpHours*3600000,6*WINDOW))
  const end=Math.min((Math.floor(start/WINDOW)+1)*WINDOW,latest)
  if(end<=start)return null
  const signature=JSON.stringify([data.instances.filter(i=>i.worldId===worldId),data.virtualSchedules?.filter(s=>s.worldId===worldId)||[]])
  return{worldId,worldRevision:selected.revision,policyRevision:policy.revision,signature,from:selected.lastSimulatedAt,start,end,skippedMs:start-selected.lastSimulatedAt,timeZone:selected.timeZone,idempotencyKey:`world-window-v1:${Math.floor(start/WINDOW)}:${end}`}
}
/** @param {Data} data @param {string} instanceId @param {number} at @param {string} timeZone */
export function kanataScheduledActivity(data,instanceId,at,timeZone) {
  const local=kanataLocalTime(at,timeZone)
  return data.virtualSchedules?.find(s=>s.instanceId===instanceId&&s.days.includes(local.day)&&s.startMinute<=local.minute&&local.minute<s.endMinute)||null
}
/** Atomic graph transition only; the application must persist before requesting another plan.
 * No AI transcript is invented. Scheduled rest/move have known rules and actual source window.
 * @param {Data} input @param {NonNullable<ReturnType<typeof planKanataWorldWindow>>} plan @param {{clock:()=>number,id:()=>string}} tools */
export function completeKanataWorldWindow(input,plan,tools) {
  let data=validateKanataData(input)
  const world=data.worlds.find(w=>w.id===plan.worldId),policy=kanataAutonomyPolicy(data,plan.worldId)
  need(world?.autonomyEnabled&&!world.archived&&world.revision===plan.worldRevision&&world.lastSimulatedAt===plan.from&&world.timeZone===plan.timeZone&&policy.revision===plan.policyRevision,'SIMULATION_PLAN_STALE','plan')
  need(plan.end<=tools.clock()&&plan.end>plan.start&&plan.end-plan.start<=WINDOW&&plan.start>=plan.from,'INVALID_SIMULATION_WINDOW','plan')
  const expected=planKanataWorldWindow(data,plan.worldId,tools.clock())
  need(expected&&JSON.stringify(expected)===JSON.stringify(plan),'SIMULATION_PLAN_STALE','plan')
  const existing=data.tasks.find(t=>t.kind==='world'&&t.worldId===plan.worldId&&t.idempotencyKey===plan.idempotencyKey)
  const resultEventIds=[]
  if(!existing){
    const allActors=data.instances.filter(i=>i.worldId===plan.worldId&&i.autonomyEnabled).sort((a,b)=>a.id.localeCompare(b.id,'en'))
    const offset=allActors.length?Math.floor(plan.start/WINDOW)%allActors.length:0
    const actors=[...allActors.slice(offset),...allActors.slice(0,offset)].slice(0,8)
    for(const instance of actors){
      const schedule=kanataScheduledActivity(data,instance.id,plan.end-1,plan.timeZone)
      if(!schedule)continue
      const kinds=/** @type {('move'|'rest')[]} */([])
      if(instance.state.location!==schedule.location)kinds.push('move')
      if(schedule.resting)kinds.push('rest')
      for(const kind of kinds){
        data=proposeKanataEvent(data,{worldId:plan.worldId,participantIds:[instance.id],sourceRefs:[],causedByEventIds:[],visibility:'private',summary:`有限补算：按虚拟日程「${schedule.activity}」${kind==='move'?'前往'+schedule.location:'休息'}。这是重新打开后的规则补算，并非离线实时执行。`,effectiveAt:plan.end,kind,action:{instanceId:instance.id,location:schedule.location}},tools)
        const event=data.events.at(-1);if(!event)throw Error('SIMULATION_EVENT_MISSING')
        data=commitKanataEvent(data,event.id,1,tools);resultEventIds.push(event.id)
      }
    }
    data.tasks.push({id:tools.id(),worldId:plan.worldId,kind:'world',state:'succeeded',idempotencyKey:plan.idempotencyKey,sourceRefs:[],sourceRevision:plan.worldRevision,attempt:1,notBefore:plan.start,leaseUntil:0,resultEventIds,simulationWindow:{start:plan.start,end:plan.end,skippedMs:plan.skippedMs,timeZone:plan.timeZone}})
  }
  const updated=/** @type {Data['worlds'][number]} */(data.worlds.find(w=>w.id===plan.worldId))
  updated.lastSimulatedAt=plan.end
  return validateKanataData(data)
}
