// @ts-check
import {validateKanataData,requireKanata as need} from '../domain/kanataValidation.js'
import {kanataLocalTime,kanataAutonomyPolicy} from './kanataAutonomy.js'
import {buildKanataConversationContext} from '../domain/kanataConversation.js'
import {renderKanataCharacter} from '../lorebook/kanataLorebook.js'
/** @typedef {import('../domain/kanataTypes').KanataData} Data */
/** @param {Data} data @param {string} worldId @param {number} now */
export function kanataQuietTime(data,worldId,now) {
  const world=data.worlds.find(w=>w.id===worldId);if(!world)return true
  const {quietStartMinute:start,quietEndMinute:end}=kanataAutonomyPolicy(data,worldId),{minute}=kanataLocalTime(now,world.timeZone)
  return start===end?false:start<end?minute>=start&&minute<end:minute>=start||minute<end
}
/** @param {Data} input @param {string} worldId @param {{clock:()=>number,id:()=>string}} tools */
export function queueKanataContact(input,worldId,tools) {
  const data=validateKanataData(input),now=tools.clock(),world=data.worlds.find(w=>w.id===worldId&&!w.archived)
  if(!world?.proactiveEnabled||kanataQuietTime(data,worldId,now))return data
  const date=kanataLocalTime(now,world.timeZone).date
  if(data.tasks.some(t=>t.worldId===worldId&&t.kind==='proactive'&&t.contact?.date===date))return data
  const candidate=data.instances.filter(i=>i.worldId===worldId&&i.proactiveEnabled).map(i=>({instance:i,conversation:data.conversations.find(c=>c.worldId===worldId&&c.type==='private'&&c.participantIds.includes(i.id))})).find(({conversation})=>conversation&&Math.max(world.createdAt,...data.messages.filter(m=>m.conversationId===conversation.id).map(m=>m.createdAt))<=now-6*3600000)
  if(!candidate?.conversation)return data
  // New namespace, disjoint from the old warm-home 820M range. Allocate uniquely in graph.
  const used=new Set(data.tasks.map(t=>t.contact?.notificationId));let notificationId=910000000
  while(used.has(notificationId)&&notificationId<911000000)notificationId++
  need(notificationId<911000000,'KANATA_NOTIFICATION_IDS_EXHAUSTED','task')
  data.tasks.push({id:tools.id(),worldId,kind:'proactive',state:'pending',idempotencyKey:`contact-v1:${date}`,sourceRefs:[],sourceRevision:world.revision,attempt:0,notBefore:now+120000,leaseUntil:0,conversationId:candidate.conversation.id,instanceId:candidate.instance.id,resultEventIds:[],contact:{date,expiresAt:now+2*3600000,notificationId,notificationState:'none'}})
  return validateKanataData(data)
}
/** Off, expired, or restored sending tasks must not turn into a burst of stale greetings.
 * @param {Data} input @param {number} now */
export function expireKanataContacts(input,now) {
  const data=validateKanataData(input)
  for(const task of data.tasks.filter(t=>t.contact&&['pending','running'].includes(t.state))){const world=data.worlds.find(w=>w.id===task.worldId),instance=data.instances.find(i=>i.id===task.instanceId)
    const recent=data.messages.some(m=>m.conversationId===task.conversationId&&!m.deleted&&m.createdAt>=task.notBefore-120000)
    if(!world?.proactiveEnabled||world.archived||!instance?.proactiveEnabled||recent||Number(task.contact?.expiresAt)<now||task.state==='running'&&task.leaseUntil<=now){task.state='cancelled';task.leaseUntil=0}
  }
  return validateKanataData(data)
}
/** @param {Data} input @param {string} taskId @param {number} now */
export function beginKanataContact(input,taskId,now) {
  const data=expireKanataContacts(input,now),task=data.tasks.find(t=>t.id===taskId)
  need(task?.contact&&task.state==='pending'&&task.notBefore<=now&&!kanataQuietTime(data,task.worldId,now),'CONTACT_NOT_DUE','task')
  if(task){task.state='running';task.attempt++;task.leaseUntil=now+90000}
  return validateKanataData(data)
}
/** @param {Data} data @param {string} taskId */
export function buildKanataContactContext(data,taskId) {
  const task=data.tasks.find(t=>t.id===taskId&&t.state==='running')
  need(task?.contact&&task.instanceId&&task.conversationId,'CONTACT_TASK_UNAVAILABLE','task')
  const selected=/** @type {Data['tasks'][number]} */(task),identity=data.identities.find(u=>u.worldId===selected.worldId)
  if(!identity)throw Error('WORLD_IDENTITY_REQUIRED')
  const virtual={id:`contact-prompt-${taskId}`,worldId:selected.worldId,conversationId:/** @type {string} */(selected.conversationId),role:/** @type {const} */('user'),senderType:/** @type {const} */('user'),senderId:identity.id,senderNameSnapshot:identity.displayName,content:'系统主动联系任务（不是用户发言）：用自己的人格向用户发一段轻松、可自由忽略的问候。不得猜测未经提供的生活状态，不表达被冷落、等待痛苦或制造内疚；不能声称用户刚刚提出请求。',createdAt:selected.notBefore,revision:1,status:/** @type {const} */('complete'),turnId:taskId,batchId:taskId}
  return buildKanataConversationContext({...data,messages:[...data.messages,virtual]},virtual.conversationId,/** @type {string} */(selected.instanceId))
}
/** @param {Data} input @param {string} taskId @param {string} content @param {import('../domain/kanataTypes').LifeSource[]} lifeSources @param {{clock:()=>number,id:()=>string}} tools */
export function completeKanataContact(input,taskId,content,lifeSources,tools) {
  const data=validateKanataData(input),task=data.tasks.find(t=>t.id===taskId),now=tools.clock()
  need(task?.contact&&task.state==='running'&&task.leaseUntil>now&&task.contact.expiresAt>=now&&data.worlds.some(w=>w.id===task.worldId&&w.proactiveEnabled&&!w.archived)&&data.instances.some(i=>i.id===task.instanceId&&i.proactiveEnabled)&&!kanataQuietTime(data,task.worldId,now),'CONTACT_EXPIRED','task')
  need(typeof content==='string'&&content.trim().length>0&&content.length<=4000,'INVALID_CONTACT_REPLY','content')
  const selected=/** @type {Data['tasks'][number]} */(task)
  data.messages.push({id:tools.id(),worldId:selected.worldId,conversationId:/** @type {string} */(selected.conversationId),role:'assistant',senderType:'character',senderId:/** @type {string} */(selected.instanceId),senderNameSnapshot:renderKanataCharacter(data,/** @type {string} */(selected.instanceId)).name,content:content.trim(),createdAt:now,revision:1,status:'complete',turnId:taskId,batchId:taskId,lifeSources})
  selected.state='succeeded';selected.leaseUntil=0
  return validateKanataData(data)
}
