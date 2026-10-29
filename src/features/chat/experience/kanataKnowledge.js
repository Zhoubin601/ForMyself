// @ts-check
import { validateKanataData, requireKanata as need, cloneKanataJson } from '../domain/kanataValidation.js'
/** @typedef {import('../domain/kanataTypes').KanataData} Data */
/** @typedef {import('../domain/kanataTypes').LifeSource} LifeSource */
/** @param {Data} data @param {LifeSource[]} sources @param {{worldId:string,instanceId:string,group:boolean,remember?:boolean}} scope */
export function canUseKanataLifeSources(data,sources,scope) {
  if(!sources.length)return true
  return sources.every(source=>{
    const grant=data.lifeGrants.find(g=>g.id===source.grantId)
    if(!grant||grant.worldId!==scope.worldId||grant.instanceId!==source.instanceId||grant.moduleId!==source.moduleId||grant.revision!==source.revision||!grant.read)return false
    if(scope.remember&&!grant.remember)return false
    if((scope.group||scope.instanceId!==source.instanceId)&&!grant.share)return false
    const receiver=data.lifeGrants.find(g=>g.worldId===scope.worldId&&g.instanceId===scope.instanceId&&g.moduleId===source.moduleId)
    return !!receiver?.read&&(!scope.remember||receiver.remember)&&(!scope.group||receiver.share)
  })
}
/** @param {Data} data @param {import('../domain/kanataTypes').Message} message @param {string} instanceId @param {boolean} group */
export function canUseKanataMessage(data,message,instanceId,group) {
  const conversation=data.conversations.find(c=>c.id===message.conversationId&&c.worldId===message.worldId)
  if(message.replyToMessageId){const original=data.messages.find(m=>m.id===message.replyToMessageId);if(!original||original.deleted||original.status!=='complete'||original.revision!==(message.replyToRevision||1))return false}
  return !message.deleted&&message.status==='complete'&&!!conversation?.participantIds.includes(instanceId)&&canUseKanataLifeSources(data,message.lifeSources||[],{worldId:message.worldId,instanceId,group})
}
/** Resolve provenance through source messages and causal ancestors, including older imports
 * that omitted redundant event tags. Never infer permission from a visible descendant.
 * @param {Data} data @param {import('../domain/kanataTypes').WorldEvent} event
 */
export function kanataEventLifeSources(data,event) {
  /** @type {LifeSource[]} */
  const sources=[]
  const queue=[event],seen=new Set()
  while(queue.length){
    const current=queue.pop();if(!current||seen.has(current.id))continue
    seen.add(current.id);sources.push(...current.lifeSources||[])
    for(const ref of current.sourceRefs)sources.push(...data.messages.find(m=>m.id===ref.messageId)?.lifeSources||[])
    for(const id of current.causedByEventIds){const parent=data.events.find(e=>e.id===id);if(parent)queue.push(parent)}
  }
  return [...new Map(sources.map(s=>[JSON.stringify(s),cloneKanataJson(s)])).values()]
}
/** @param {Data} data @param {import('../domain/kanataTypes').WorldEvent} event @param {string} instanceId @param {boolean} group @param {boolean} [sharedMemory] */
export function canUseKanataEvent(data,event,instanceId,group,sharedMemory=false) {
  if(event.status!=='committed'||(!sharedMemory&&!event.participantIds.includes(instanceId))||(group&&event.visibility!=='public')||!data.instances.some(i=>i.id===instanceId&&i.worldId===event.worldId))return false
  const queue=[event],seen=new Set()
  while(queue.length){const current=queue.pop();if(!current||seen.has(current.id))continue;seen.add(current.id)
    if(current.status!=='committed'||current.sourceRefs.some(ref=>!data.messages.some(m=>m.id===ref.messageId&&!m.deleted&&m.status==='complete'&&m.revision===ref.revision)))return false
    for(const id of current.causedByEventIds){const parent=data.events.find(e=>e.id===id);if(!parent)return false;queue.push(parent)}
  }
  return canUseKanataLifeSources(data,kanataEventLifeSources(data,event),{worldId:event.worldId,instanceId,group,remember:true})
}
/** Legacy imported records may have provenance only on their sources. Derive it without
 * broadening grants, so missing redundant metadata cannot become a privacy bypass.
 * @param {Data} data @param {import('../domain/kanataTypes').Memory} memory
 */
export function kanataMemoryLifeSources(data,memory) {
  /** @type {LifeSource[]} */
  const sources=[]
  const seen=new Set();let current=/** @type {typeof memory|undefined} */(memory)
  while(current&&!seen.has(current.id)){
    seen.add(current.id);sources.push(...current.lifeSources||[])
    for(const ref of current.sourceRefs)sources.push(...data.messages.find(m=>m.id===ref.messageId)?.lifeSources||[])
    for(const id of current.sourceEventIds||[]){const event=data.events.find(e=>e.id===id);if(event)sources.push(...kanataEventLifeSources(data,event))}
    current=current.sharedFromId?data.memories.find(m=>m.id===current?.sharedFromId):undefined
  }
  return [...new Map(sources.map(s=>[JSON.stringify(s),cloneKanataJson(s)])).values()]
}
/** Records remain visible to the user's manager after revocation; generation cannot use them.
 * @param {Data} data @param {import('../domain/kanataTypes').Memory} memory @param {string} instanceId @param {boolean} group @param {string} [conversationId]
 */
export function canUseKanataMemory(data,memory,instanceId,group,conversationId) {
  if(memory.status!=='active'||data.instances.find(i=>i.id===instanceId)?.worldId!==memory.worldId)return false
  const knows=memory.ownerType==='character'&&memory.ownerId===instanceId||memory.knownBy?.includes(instanceId)||memory.ownerType==='world'&&memory.visibility==='public'&&!memory.knownBy?.length
  const sharedGroup=!!conversationId&&memory.conversationId===conversationId&&data.conversations.some(c=>c.id===conversationId&&c.type==='group')&&memory.sourceRefs.length>0&&memory.sourceRefs.every(ref=>data.messages.some(m=>m.id===ref.messageId&&m.conversationId===conversationId))
  if(!knows||(group&&memory.visibility!=='public'&&!sharedGroup))return false
  if(!canUseKanataLifeSources(data,kanataMemoryLifeSources(data,memory),{worldId:memory.worldId,instanceId,group,remember:true}))return false
  if((memory.sourceEventIds||[]).some(id=>{const event=data.events.find(e=>e.id===id);return !event||!canUseKanataEvent(data,event,instanceId,group,!!memory.sharedFromId)}))return false
  let parent=memory.sharedFromId
  while(parent){const origin=data.memories.find(m=>m.id===parent);if(!origin||origin.status!=='active')return false;parent=origin.sharedFromId}
  return memory.sourceRefs.every(ref=>{
    const message=data.messages.find(m=>m.id===ref.messageId)
    if(!message||message.deleted||message.revision!==ref.revision)return false
    // Explicitly shared copies convey only the reviewed memory, never the source transcript.
    return !!memory.sharedFromId||canUseKanataMessage(data,message,instanceId,group)
  })
}
/** @param {Data} data @param {{worldId:string,instanceId:string,text:string,group:boolean,budget:number,conversationId?:string}} scope */
export function selectKanataMemories(data,scope) {
  need(Number.isSafeInteger(scope.budget)&&scope.budget>=0&&scope.budget<=16000,'INVALID_MEMORY_BUDGET','budget')
  const terms=scope.text.toLowerCase().split(/[\s，。！？,!?、]+/).filter(Boolean)
  const ranked=data.memories.filter(m=>m.worldId===scope.worldId&&canUseKanataMemory(data,m,scope.instanceId,scope.group,scope.conversationId)).map((memory,index)=>({memory,index,score:(memory.layer==='L3'?3:1)+terms.filter(term=>(memory.key+' '+memory.content).toLowerCase().includes(term)).length*2})).sort((a,b)=>b.score-a.score||b.index-a.index)
  let usedBytes=0;const entries=[]
  for(const {memory} of ranked){const cost=new TextEncoder().encode(memory.content).length+16;if(usedBytes+cost>scope.budget)continue;usedBytes+=cost;entries.push({...cloneKanataJson(memory),lifeSources:kanataMemoryLifeSources(data,memory)})}
  return{entries,usedBytes}
}
/** @param {Data} input @param {string} worldId @param {string} instanceId @param {import('../domain/kanataTypes').LifeModule} moduleId @param {{read:boolean,remember:boolean,share:boolean}} flags @param {()=>string} id */
export function setKanataLifeGrant(input,worldId,instanceId,moduleId,flags,id) {
  const data=validateKanataData(input)
  need(data.worlds.some(w=>w.id===worldId&&!w.archived)&&data.instances.some(i=>i.id===instanceId&&i.worldId===worldId),'GRANT_SCOPE_DENIED','instance')
  need((/** @type {const} */(['read','remember','share'])).every(key=>typeof flags[key]==='boolean'),'INVALID_GRANT_FLAGS','flags')
  const previous=data.lifeGrants.find(g=>g.worldId===worldId&&g.instanceId===instanceId&&g.moduleId===moduleId)
  if(previous&&previous.read===flags.read&&previous.remember===flags.remember&&previous.share===flags.share)return data
  const grant=previous||{id:id(),worldId,instanceId,moduleId,read:false,remember:false,share:false,revision:0}
  Object.assign(grant,flags,{revision:grant.revision+1});if(!previous)data.lifeGrants.push(grant)
  for(const memory of data.memories)if(memory.status!=='deleted'&&memory.lifeSources?.some(s=>s.grantId===grant.id)){memory.status='stale';memory.revision++}
  return validateKanataData(data)
}
/** @param {Data} data @param {import('../domain/kanataTypes').LifeModule} moduleId */
export function resolveKanataRoleBinding(data,moduleId) {
  const bindings=data.roleBindings,override=!!bindings&&Object.hasOwn(bindings.modules,moduleId)
  const selected=override?bindings?.modules[moduleId]:bindings?.global
  if(!selected)return{status:/** @type {const} */('unselected'),binding:null}
  const world=data.worlds.find(w=>w.id===selected.worldId),instance=data.instances.find(i=>i.id===selected.instanceId&&i.worldId===selected.worldId)
  if(!world||!instance||world.archived)return{status:/** @type {const} */('unavailable'),binding:cloneKanataJson(selected)}
  return{status:/** @type {const} */('ready'),binding:cloneKanataJson(selected)}
}
/** @param {Data} input @param {'global'|import('../domain/kanataTypes').LifeModule} moduleId @param {import('../domain/kanataTypes').RoleBinding|null|'inherit'} selected */
export function setKanataRoleBinding(input,moduleId,selected) {
  const data=validateKanataData(input),bindings=data.roleBindings||{revision:0,global:null,modules:{}}
  if(selected&&selected!=='inherit')need(data.worlds.some(w=>w.id===selected.worldId&&!w.archived)&&data.instances.some(i=>i.id===selected.instanceId&&i.worldId===selected.worldId),'BINDING_UNAVAILABLE','instance')
  if(moduleId==='global'){need(selected!=='inherit','INVALID_GLOBAL_BINDING','binding');bindings.global=/** @type {import('../domain/kanataTypes').RoleBinding|null} */(selected)}
  else if(selected==='inherit')delete bindings.modules[moduleId]
  else bindings.modules[moduleId]=selected
  bindings.revision++;data.roleBindings=bindings;return validateKanataData(data)
}
/** @param {Data} data @param {string} worldId */
export function kanataMemoryPolicy(data,worldId) {
  return data.memoryPolicies?.find(p=>p.worldId===worldId)||{worldId,strategy:/** @type {const} */('standard'),enabled:true,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1}
}
/** @param {Data} input @param {import('../domain/kanataTypes').MemoryPolicy} policy */
export function setKanataMemoryPolicy(input,policy) {
  const data=validateKanataData(input),policies=data.memoryPolicies||[],previous=policies.find(p=>p.worldId===policy.worldId)
  const next={...cloneKanataJson(policy),revision:(previous?.revision||0)+1}
  if(previous)Object.assign(previous,next);else policies.push(next)
  data.memoryPolicies=policies;return validateKanataData(data)
}
