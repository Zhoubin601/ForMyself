import test from 'node:test'
import assert from 'node:assert/strict'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../src/features/chat/domain/presetCore.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
import {setKanataWorldActivity,planKanataWorldWindow,completeKanataWorldWindow,kanataLocalTime,kanataScheduledActivity} from '../src/features/chat/autonomy/kanataAutonomy.js'
const hour=3600000,origin=Date.UTC(2026,9,28,0)
let serial=0
const id=()=>`autonomy-${++serial}`
const fixture=()=>instantiateWorldPreset(createEmptyKanataData('synthetic-user'),preset,{initializationKey:'first',now:origin,timeZone:'Asia/Shanghai',idFactory:id})
const enable=d=>setKanataWorldActivity(d,d.worlds[0].id,d.worlds[0].revision,{autonomyEnabled:true,proactiveEnabled:false,notificationsEnabled:false},origin)
const schedule=d=>({id:id(),worldId:d.worlds[0].id,instanceId:d.instances[0].id,days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,location:'合成休息室',activity:'合成休息',resting:true,revision:1})
const complete=(d,now)=>completeKanataWorldWindow(d,planKanataWorldWindow(d,d.worlds[0].id,now),{clock:()=>now,id})

test('P6 disabled world does not catch up, enabling starts at current time; switches independent',()=>{
  let d=fixture();assert.equal(planKanataWorldWindow(d,d.worlds[0].id,origin+hour),null)
  d=setKanataWorldActivity(d,d.worlds[0].id,1,{autonomyEnabled:true,proactiveEnabled:false,notificationsEnabled:true},origin+hour)
  assert.equal(d.worlds[0].lastSimulatedAt,origin+hour);assert.equal(planKanataWorldWindow(d,d.worlds[0].id,origin+hour),null)
  assert.equal(d.worlds[0].proactiveEnabled,false);assert.equal(d.worlds[0].notificationsEnabled,true)
})
test('P6 disabling and reopening never replays disabled time',()=>{
  let d=enable(fixture());d=setKanataWorldActivity(d,d.worlds[0].id,2,{autonomyEnabled:false,proactiveEnabled:true,notificationsEnabled:false},origin+hour)
  d=setKanataWorldActivity(d,d.worlds[0].id,3,{autonomyEnabled:true,proactiveEnabled:true,notificationsEnabled:false},origin+24*hour)
  assert.equal(planKanataWorldWindow(d,d.worlds[0].id,origin+24*hour),null);assert.equal(d.events.length,0)
})
test('P6 repeated window cannot duplicate events and pure plans never mutate input',()=>{
  const d=enable(fixture()),before=structuredClone(d),now=origin+hour
  const plan=planKanataWorldWindow(d,d.worlds[0].id,now)
  assert.deepEqual(d,before)
  const after=completeKanataWorldWindow(d,plan,{clock:()=>now,id})
  assert.throws(()=>completeKanataWorldWindow(after,plan,{clock:()=>now,id}),/SIMULATION_PLAN_STALE/)
  assert.deepEqual(d,before);assert.equal(after.tasks.length,1)
})
test('P6 long offline interval processes at most six windows and records skipped duration',()=>{
  let d=enable(fixture());const now=origin+30*24*hour
  for(let n=0;n<6;n++)d=complete(d,now)
  assert.equal(d.worlds[0].lastSimulatedAt,now);assert.equal(d.tasks.length,6)
  assert.equal(d.tasks[0].simulationWindow.skippedMs,30*24*hour-3*hour)
  assert.equal(planKanataWorldWindow(d,d.worlds[0].id,now),null)
})
test('P6 backward clock and timezone changes cannot replay UTC windows',()=>{
  let d=enable(fixture());d=complete(d,origin+hour)
  assert.equal(planKanataWorldWindow(d,d.worlds[0].id,origin),null)
  const stale=planKanataWorldWindow(d,d.worlds[0].id,origin+hour)
  d.worlds[0].timeZone='America/New_York'
  assert.throws(()=>completeKanataWorldWindow(d,stale,{clock:()=>origin+hour,id}),/SIMULATION_PLAN_STALE/)
  d=complete(d,origin+hour);assert.equal(d.worlds[0].lastSimulatedAt,origin+hour)
  assert.equal(new Set(d.tasks.map(t=>t.idempotencyKey)).size,2)
})
test('P6 DST repeated hour has distinct UTC windows and local day calculation is explicit',()=>{
  const first=Date.UTC(2026,10,1,5,30),second=first+hour
  assert.equal(kanataLocalTime(first,'America/New_York').minute,kanataLocalTime(second,'America/New_York').minute)
  let d=enable(fixture());d.worlds[0].lastSimulatedAt=first-hour;d.worlds[0].timeZone='America/New_York'
  const p1=planKanataWorldWindow(d,d.worlds[0].id,first),p2=planKanataWorldWindow(d,d.worlds[0].id,second)
  // A later horizon can retain the same first pending window; after completion its key advances.
  d=completeKanataWorldWindow(d,p1,{clock:()=>first,id})
  assert.notEqual(planKanataWorldWindow(d,d.worlds[0].id,second).idempotencyKey,p2.idempotencyKey)
  assert.equal(kanataLocalTime(Date.UTC(2026,9,28,16),'Asia/Shanghai').date,'2026-10-29')
})
test('P6 zero daily dialogue limit still allows rule events, never fabricated chat',()=>{
  let d=enable(fixture());d.instances[0].autonomyEnabled=true;d.virtualSchedules=[schedule(d)]
  d=complete(d,origin+hour)
  assert.equal(d.messages.length,0);assert.equal(d.conversations.filter(c=>c.type==='character').length,0)
  assert.equal(d.events.length,2);assert.equal(d.instances[0].state.location,'合成休息室')
  assert.ok(d.events.every(e=>e.summary.includes('并非离线实时执行')))
})
test('P6 overlapping virtual schedules or cross-world instance references are rejected',()=>{
  const d=fixture(),s=schedule(d);d.virtualSchedules=[s,{...s,id:id(),location:'另一个合成地点'}]
  assert.throws(()=>validateKanataData(d),/VIRTUAL_SCHEDULE_CONFLICT/)
  d.virtualSchedules=[{...s,instanceId:'missing'}];assert.throws(()=>validateKanataData(d),/VIRTUAL_SCHEDULE_SCOPE/)
})
test('P6 changed actor state invalidates a plan; no retroactive movement from stale snapshots',()=>{
  const d=enable(fixture()),now=origin+hour,plan=planKanataWorldWindow(d,d.worlds[0].id,now)
  d.instances[0].state.location='用户刚改的合成地点';d.instances[0].revision++
  assert.throws(()=>completeKanataWorldWindow(d,plan,{clock:()=>now,id}),/SIMULATION_PLAN_STALE/)
})
test('P6 schedule boundary and invalid timezone have explicit outcomes',()=>{
  const d=fixture(),s=schedule(d);s.startMinute=9*60;s.endMinute=10*60;d.virtualSchedules=[s]
  assert.equal(kanataScheduledActivity(d,s.instanceId,origin+hour,'Asia/Shanghai')?.id,s.id)
  assert.equal(kanataScheduledActivity(d,s.instanceId,origin+2*hour,'Asia/Shanghai'),null)
  assert.throws(()=>kanataLocalTime(origin,'Not/AZone'),/INVALID_SIMULATION_TIMEZONE/)
})
test('P6 malformed imported schedule later in the list produces a stable validation error',()=>{
  const d=fixture();d.virtualSchedules=[schedule(d),null]
  assert.throws(()=>validateKanataData(d),error=>error.code==='INVALID_VIRTUAL_SCHEDULE_ID')
})
test('P6 caller cannot fabricate a future or widened catch-up window',()=>{
  const d=enable(fixture()),now=origin+hour,plan=planKanataWorldWindow(d,d.worlds[0].id,now)
  assert.throws(()=>completeKanataWorldWindow(d,{...plan,end:now+hour},{clock:()=>now,id}),/INVALID_SIMULATION_WINDOW/)
  assert.throws(()=>completeKanataWorldWindow(d,{...plan,idempotencyKey:'forged'},{clock:()=>now,id}),/SIMULATION_PLAN_STALE/)
  assert.equal(d.tasks.length,0);assert.equal(d.worlds[0].lastSimulatedAt,origin)
})
test('P6 many enabled actors cannot create an unbounded event burst in one window',()=>{
  let d=enable(fixture());const base=d.instances[0]
  for(let n=0;n<20;n++)d.instances.push({...structuredClone(base),id:id()})
  d.instances.forEach(i=>{i.autonomyEnabled=true})
  d.virtualSchedules=d.instances.map(i=>({...schedule(d),id:id(),instanceId:i.id}))
  d=complete(d,origin+hour)
  assert.ok(d.events.length>0&&d.events.length<=16)
  assert.ok(new Set(d.events.flatMap(e=>e.participantIds)).size<=8)
})
