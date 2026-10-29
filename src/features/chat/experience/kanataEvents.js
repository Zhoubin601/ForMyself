// @ts-check
import { validateKanataData, cloneKanataJson, requireKanata as need } from '../domain/kanataValidation.js'
import { canUseKanataLifeSources,kanataEventLifeSources } from './kanataKnowledge.js'
/** @typedef {import('../domain/kanataTypes').KanataData} Data */
/** @typedef {import('../domain/kanataTypes').WorldEvent} Event */
/** @typedef {import('../domain/kanataTypes').WorldEffect} Effect */
/** @typedef {{clock:()=>number,id:()=>string}} Tools */
/** @param {Data} data @param {Effect['targetType']} type @param {string} id */
const target=(data,type,id)=>type==='instance'?data.instances.find(i=>i.id===id):type==='relationship'?data.relationships.find(r=>r.id===id):data.worlds.find(w=>w.id===id)
/** @param {unknown} value @param {string} path */
const readPath=(value,path)=>path.split('.').reduce((item,key)=>item?.[key],/** @type {any} */(value))
/** @param {unknown} value @param {string} path @param {unknown} next */
const writePath=(value,path,next)=>{const parts=path.split('.'),key=parts.pop();const parent=parts.reduce((item,k)=>item[k],/** @type {any} */(value));parent[/** @type {string} */(key)]=next}
/** @param {{targetType:Effect['targetType'],targetId:string,path:string}} effect */
const pathKey=effect=>JSON.stringify([effect.targetType,effect.targetId,effect.path])
/** Version1 generated effects are a closed set; imports with unknown rules never execute.
 * @param {Effect} effect
 */
function safeEffect(effect) {
  const path=effect.path
  need(effect.ruleVersion===1,'EVENT_RULE_VERSION_UNSUPPORTED','effect')
  need(effect.targetType==='instance'?['state.mood','state.energy','state.location'].includes(path):effect.targetType==='relationship'&&['dimensions.trust','dimensions.understanding','dimensions.intimacy'].includes(path),'EVENT_EFFECT_PATH_UNSUPPORTED','effect')
  need(effect.operation==='increment'?typeof effect.value==='number'&&Math.abs(effect.value)<=0.1:typeof effect.value==='string'&&['state.mood','state.location'].includes(path),'EVENT_EFFECT_VALUE_UNSUPPORTED','effect')
}
/** Re-fold affected paths from durable baselines. Independent E2 effects are retained even
 * when E1 is revoked; neither inversion nor stale whole-object snapshots are used.
 * @param {Data} data @param {Set<string>} paths
 */
export function rebuildKanataEffects(data,paths) {
  for(const key of paths){
    const baseline=data.effectBaselines?.find(b=>pathKey(b)===key)
    need(baseline,'EVENT_BASELINE_REQUIRED','effect')
    const base=/** @type {import('../domain/kanataTypes').EffectBaseline} */(baseline)
    const entity=target(data,base.targetType,base.targetId);need(entity,'EVENT_TARGET_UNAVAILABLE','effect')
    let value=cloneKanataJson(base.value)
    const effects=data.effects.filter(e=>pathKey(e)===key&&data.events.some(event=>event.id===e.eventId&&event.status==='committed')).sort((a,b)=>{
      const first=/** @type {Event} */(data.events.find(e=>e.id===a.eventId)),second=/** @type {Event} */(data.events.find(e=>e.id===b.eventId))
      return first.effectiveAt-second.effectiveAt||first.recordedAt-second.recordedAt||first.id.localeCompare(second.id,'en')||a.id.localeCompare(b.id,'en')
    })
    for(const effect of effects){safeEffect(effect);value=effect.operation==='set'?cloneKanataJson(effect.value):Math.max(base.path==='state.energy'?0:-1,Math.min(1,Number(value)+Number(effect.value)))}
    writePath(entity,base.path,value)
  }
}
/** @param {Data} input @param {Omit<Event,'id'|'status'|'revision'|'recordedAt'>} fields @param {Tools} tools */
export function proposeKanataEvent(input,fields,tools) {
  const data=validateKanataData(input)
  need(data.worlds.some(w=>w.id===fields.worldId&&!w.archived),'EVENT_WORLD_UNAVAILABLE','world')
  const event={...cloneKanataJson(fields),id:tools.id(),status:/** @type {const} */('candidate'),revision:1,recordedAt:tools.clock(),causality:fields.causality||/** @type {const} */('explicit')}
  data.events.push(event);return validateKanataData(data)
}
/** @param {Data} data @param {Event} event @param {()=>string} id @returns {Effect[]} */
function eventEffects(data,event,id) {
  const kind=event.kind||'note',action=event.action||{}
  /** @type {Effect[]} */
  const effects=[]
  /** @param {Effect['targetType']} type @param {string} targetId @param {string} path @param {Effect['operation']} operation @param {string|number} value */
  const add=(type,targetId,path,operation,value)=>effects.push({id:id(),worldId:event.worldId,eventId:event.id,targetType:type,targetId,path,operation,value,ruleVersion:1})
  if(kind==='support'||kind==='conflict'){
    const relationship=data.relationships.find(r=>r.id===action.relationshipId&&r.worldId===event.worldId)
    need(relationship&&event.participantIds.includes(relationship.fromId)&&event.participantIds.includes(relationship.toId),'EVENT_RELATIONSHIP_REQUIRED','action')
    add('relationship',/** @type {string} */(action.relationshipId),'dimensions.trust','increment',kind==='support'?0.03:-0.03)
    add('relationship',/** @type {string} */(action.relationshipId),'dimensions.understanding','increment',kind==='support'?0.02:-0.01)
    if(relationship&&data.instances.some(i=>i.id===relationship.fromId))add('instance',relationship.fromId,'state.mood','set',kind==='support'?'安心':'紧张')
  }
  if(kind==='rest'||kind==='move'){
    need(data.instances.some(i=>i.id===action.instanceId&&i.worldId===event.worldId)&&event.participantIds.includes(/** @type {string} */(action.instanceId)),'EVENT_INSTANCE_REQUIRED','action')
    if(kind==='rest'){add('instance',/** @type {string} */(action.instanceId),'state.energy','increment',0.1);add('instance',/** @type {string} */(action.instanceId),'state.mood','set','放松')}
    else {need(typeof action.location==='string'&&action.location.trim().length>0&&action.location.length<=200,'INVALID_EVENT_LOCATION','action');add('instance',/** @type {string} */(action.instanceId),'state.location','set',/** @type {string} */(action.location))}
  }
  return effects
}
/** Explicit confirmation is an application/UI action; AI can only call propose.
 * @param {Data} input @param {string} eventId @param {number} expectedRevision @param {Tools} tools
 */
export function commitKanataEvent(input,eventId,expectedRevision,tools) {
  const data=validateKanataData(input),event=data.events.find(e=>e.id===eventId)
  need(event?.status==='candidate'&&event.revision===expectedRevision,'EVENT_COMMIT_CONFLICT','event')
  const selected=/** @type {Event} */(event)
  need(data.worlds.some(w=>w.id===selected.worldId&&!w.archived),'EVENT_WORLD_UNAVAILABLE','world')
  need(selected.sourceRefs.every(ref=>data.messages.some(m=>m.id===ref.messageId&&m.revision===ref.revision&&!m.deleted)),'EVENT_SOURCE_STALE','source')
  need(selected.causedByEventIds.every(id=>data.events.some(e=>e.id===id&&e.status==='committed')),'EVENT_CAUSE_UNAVAILABLE','cause')
  const sources=kanataEventLifeSources(data,selected)
  for(const participant of selected.participantIds.filter(id=>data.instances.some(i=>i.id===id)))need(canUseKanataLifeSources(data,sources,{worldId:selected.worldId,instanceId:participant,group:selected.visibility!=='private',remember:true}),'EVENT_LIFE_PERMISSION_DENIED','source')
  const effects=eventEffects(data,selected,tools.id),baselines=data.effectBaselines||=[]
  for(const effect of effects){
    safeEffect(effect)
    if(!baselines.some(b=>pathKey(b)===pathKey(effect))){
      need(!data.effects.some(e=>pathKey(e)===pathKey(effect)),'EVENT_BASELINE_REQUIRED','effect')
      baselines.push({id:tools.id(),worldId:selected.worldId,targetType:effect.targetType,targetId:effect.targetId,path:effect.path,value:readPath(target(data,effect.targetType,effect.targetId),effect.path)})
    }
  }
  const previous=cloneKanataJson(selected);if(sources.length)selected.lifeSources=sources;selected.status='committed';selected.revision++;data.effects.push(...effects)
  ;(data.eventAudits||=[]).push({id:tools.id(),worldId:selected.worldId,eventId,at:tools.clock(),previous,next:cloneKanataJson(selected)})
  rebuildKanataEffects(data,new Set(effects.map(pathKey)))
  for(const relationship of data.relationships)if(effects.some(e=>e.targetId===relationship.id)){relationship.sourceEventIds=[...new Set([...relationship.sourceEventIds,eventId])];relationship.revision++}
  for(const instance of data.instances)if(effects.some(e=>e.targetId===instance.id))instance.revision++
  return validateKanataData(data)
}
/** @param {Data} data @param {string[]} roots */
const descendants=(data,roots)=>{const ids=new Set(roots);let changed=true;while(changed){changed=false;for(const event of data.events)if(event.causedByEventIds.some(id=>ids.has(id))&&!ids.has(event.id)){ids.add(event.id);changed=true}}return ids}
/** @param {Data} data @param {string} eventId */
export function previewKanataEventRevoke(data,eventId) {
  const event=data.events.find(e=>e.id===eventId);need(event&&event.status!=='revoked','EVENT_UNAVAILABLE','event')
  const root=/** @type {Event} */(event),affected=descendants(data,[eventId])
  const uncertainIds=data.events.filter(e=>e.worldId===root.worldId&&!affected.has(e.id)&&e.status==='committed'&&e.effectiveAt>=root.effectiveAt&&e.causality!=='explicit').map(e=>e.id)
  return{eventId,revokeIds:[...affected],uncertainIds,signature:JSON.stringify([data.events.filter(e=>e.worldId===root.worldId),data.effects.filter(e=>e.worldId===root.worldId),data.effectBaselines?.filter(e=>e.worldId===root.worldId)||[]])}
}
/** @param {Data} data @param {Set<string>} ids @param {'revoked'|'needsReview'} status @param {Tools} tools */
function changeEventStatus(data,ids,status,tools) {
  const affected=data.effects.filter(e=>ids.has(e.eventId));for(const effect of affected){safeEffect(effect);need(data.effectBaselines?.some(b=>pathKey(b)===pathKey(effect)),'EVENT_BASELINE_REQUIRED','effect')}
  for(const event of data.events)if(ids.has(event.id)&&event.status!=='revoked'){
    const previous=cloneKanataJson(event);event.status=status;event.revision++
    ;(data.eventAudits||=[]).push({id:tools.id(),worldId:event.worldId,eventId:event.id,at:tools.clock(),previous,next:cloneKanataJson(event)})
  }
  for(const memory of data.memories)if(memory.status!=='deleted'&&memory.sourceEventIds?.some(id=>ids.has(id))){memory.status='stale';memory.revision++}
  rebuildKanataEffects(data,new Set(affected.map(pathKey)))
  for(const instance of data.instances)if(affected.some(e=>e.targetId===instance.id))instance.revision++
  for(const relation of data.relationships)if(affected.some(e=>e.targetId===relation.id))relation.revision++
}
/** @param {Data} input @param {ReturnType<typeof previewKanataEventRevoke>} plan @param {'mark-needs-review'|'keep-independent'|undefined} uncertainDecision @param {Tools} tools */
export function revokeKanataEvent(input,plan,uncertainDecision,tools) {
  const data=validateKanataData(input),current=previewKanataEventRevoke(data,plan.eventId)
  need(JSON.stringify(current)===JSON.stringify(plan),'EVENT_REVOKE_PREVIEW_STALE','plan')
  if(current.uncertainIds.length)need(['mark-needs-review','keep-independent'].includes(uncertainDecision||''),'EVENT_DEPENDENCY_UNCERTAIN','plan')
  changeEventStatus(data,new Set(current.revokeIds),'revoked',tools)
  if(uncertainDecision==='mark-needs-review')changeEventStatus(data,new Set(current.uncertainIds),'needsReview',tools)
  return validateKanataData(data)
}
/** Revision creates a new candidate after an atomic, previewed rollback of the old truth.
 * @param {Data} input @param {ReturnType<typeof previewKanataEventRevoke>} plan @param {Parameters<typeof revokeKanataEvent>[2]} decision @param {string} summary @param {Tools} tools
 */
export function correctKanataEvent(input,plan,decision,summary,tools) {
  need(typeof summary==='string'&&summary.trim().length>0&&summary.length<=2000,'INVALID_EVENT_SUMMARY','summary')
  const old=input.events.find(e=>e.id===plan.eventId);need(old,'EVENT_UNAVAILABLE','event')
  const original=/** @type {Event} */(old),data=revokeKanataEvent(input,plan,decision,tools)
  const {id:_id,status:_status,revision:_revision,recordedAt:_at,...fields}=cloneKanataJson(original)
  return proposeKanataEvent(data,{...fields,summary:summary.trim(),replacesEventId:original.id},tools)
}
/** Corrections keep a tombstone ID so provenance remains inspectable, never rewrite sources silently.
 * @param {Data} input @param {string} messageId @param {number} expectedRevision @param {{content:string,deleted:boolean}} changes @param {Tools} tools
 */
export function reviseKanataMessage(input,messageId,expectedRevision,changes,tools) {
  const data=validateKanataData(input),message=data.messages.find(m=>m.id===messageId)
  need(message&&message.revision===expectedRevision,'MESSAGE_REVISION_CONFLICT','message')
  const selected=/** @type {Data['messages'][number]} */(message)
  const previous=cloneKanataJson(selected)
  need(data.worlds.some(w=>w.id===selected.worldId&&!w.archived),'MESSAGE_WORLD_UNAVAILABLE','world')
  need(typeof changes.deleted==='boolean'&&typeof changes.content==='string'&&(changes.deleted||changes.content.trim().length>0)&&changes.content.length<=64000,'INVALID_MESSAGE_REVISION','content')
  const messageIds=new Set([messageId]);let changed=true
  while(changed){changed=false;for(const reply of data.messages)if(reply.replyToMessageId&&messageIds.has(reply.replyToMessageId)&&!messageIds.has(reply.id)){messageIds.add(reply.id);changed=true}}
  const affected=descendants(data,data.events.filter(e=>e.sourceRefs.some(s=>messageIds.has(s.messageId))&&e.status!=='revoked').map(e=>e.id))
  const earliest=Math.min(...data.events.filter(e=>affected.has(e.id)).map(e=>e.effectiveAt))
  need(!data.events.some(e=>e.worldId===selected.worldId&&e.status==='committed'&&!affected.has(e.id)&&e.causality!=='explicit'&&e.effectiveAt>=earliest),'EVENT_DEPENDENCY_UNCERTAIN','source')
  changeEventStatus(data,affected,'needsReview',tools)
  selected.content=changes.deleted?'（已删除的原始记录）':changes.content;selected.deleted=changes.deleted;selected.revision++
  const auditedPrevious=changes.deleted?{...previous,content:'（已删除的原始记录）',deleted:true}:previous
  ;(data.messageAudits||=[]).push({id:tools.id(),worldId:selected.worldId,messageId,at:tools.clock(),previous:auditedPrevious,next:cloneKanataJson(selected)})
  if(changes.deleted)for(const audit of data.messageAudits||[])if(audit.messageId===messageId){audit.previous.content='（已删除的原始记录）';audit.previous.deleted=true;audit.next.content='（已删除的原始记录）';audit.next.deleted=true}
  for(const reply of data.messages)if(reply.id!==messageId&&messageIds.has(reply.id)){
    const previousReply=cloneKanataJson(reply);reply.status='stopped';reply.revision++
    ;(data.messageAudits||=[]).push({id:tools.id(),worldId:reply.worldId,messageId:reply.id,at:tools.clock(),previous:previousReply,next:cloneKanataJson(reply)})
  }
  for(const memory of data.memories)if(memory.status!=='deleted'&&memory.sourceRefs.some(s=>messageIds.has(s.messageId))){memory.status='stale';memory.revision++}
  for(const task of data.tasks)if(task.sourceRefs.some(s=>messageIds.has(s.messageId))&&['pending','running'].includes(task.state)){task.state='cancelled';task.leaseUntil=0;task.errorCode='SOURCE_REVISED'}
  return validateKanataData(data)
}
