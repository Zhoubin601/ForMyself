import test from 'node:test'
import assert from 'node:assert/strict'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../src/features/chat/domain/presetCore.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
import {buildKanataConversationContext} from '../src/features/chat/domain/kanataConversation.js'
import {canUseKanataLifeSources,canUseKanataMessage,canUseKanataMemory,selectKanataMemories,setKanataLifeGrant,resolveKanataRoleBinding,setKanataRoleBinding,setKanataMemoryPolicy} from '../src/features/chat/experience/kanataKnowledge.js'
import {saveKanataMemory,resolveKanataMemoryConflict,shareKanataMemory,planKanataMemoryTask,beginKanataMemoryTask,completeKanataMemoryTask,failKanataMemoryTask} from '../src/features/chat/experience/kanataMemory.js'
import {proposeKanataEvent,commitKanataEvent,previewKanataEventRevoke,revokeKanataEvent,correctKanataEvent,reviseKanataMessage} from '../src/features/chat/experience/kanataEvents.js'
let sequence=0
const id=(kind='op')=>kind+'-'+(++sequence),tools={id:()=>id(),clock:()=>2000}
const seed=()=>instantiateWorldPreset(createEmptyKanataData('synthetic-user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>id(kind)})
function message(d,content='合成用户偏好',sender=d.identities[0].id,c=d.conversations[0]){
  const user=sender===d.identities[0].id
  const result={id:id('message'),worldId:c.worldId,conversationId:c.id,role:user?'user':'assistant',senderType:user?'user':'character',senderId:sender,senderNameSnapshot:user?'老师':'合成角色',content,createdAt:1000+sequence,revision:1,status:'complete',turnId:id('turn'),batchId:id('batch')};d.messages.push(result);return result
}
const memory=(d,m,fields={})=>({id:id('memory'),worldId:m.worldId,ownerType:'character',ownerId:d.instances[0].id,layer:'L3',key:'合成偏好',content:'喜欢合成测试',sourceRefs:[{messageId:m.id,revision:m.revision}],status:'candidate',revision:1,visibility:'private',knownBy:[d.instances[0].id],confidence:'statement',...fields})
function grant(d,instanceId,flags={read:true,remember:true,share:false}){return setKanataLifeGrant(d,d.worlds[0].id,instanceId,'todo',flags,tools.id)}
const provenance=g=>({grantId:g.id,revision:g.revision,moduleId:g.moduleId,instanceId:g.instanceId,fingerprint:'a'.repeat(64)})
function candidate(d,kind='support',causes=[],fields={}){
  const relationship=d.relationships.find(r=>r.kind==='teammate')
  return proposeKanataEvent(d,{worldId:d.worlds[0].id,participantIds:[relationship.fromId,relationship.toId],sourceRefs:[],causedByEventIds:causes,visibility:'private',summary:'合成世界事件',effectiveAt:1000+sequence,kind,action:{relationshipId:relationship.id},...fields},tools)
}
test('P5 legacy graph keeps optional experience fields absent and validates unchanged',()=>{const d=seed();assert.deepEqual(validateKanataData(d),d);assert.equal(d.effectBaselines,undefined);assert.equal(d.roleBindings,undefined)})
test('P5 read, remember and share flags are independent and default-deny',()=>{
  let d=seed();d=grant(d,d.instances[0].id,{read:false,remember:true,share:false})
  const g=d.lifeGrants[0];assert.deepEqual([g.read,g.remember,g.share],[false,true,false])
  assert.equal(canUseKanataLifeSources(d,[provenance(g)],{worldId:g.worldId,instanceId:g.instanceId,group:false,remember:true}),false)
})
test('P5 grant revision stops use of prior raw messages and memory without deleting history',()=>{
  let d=seed();d=grant(d,d.instances[0].id);const m=message(d);m.lifeSources=[provenance(d.lifeGrants[0])]
  d=saveKanataMemory(d,memory(d,m,{status:'active'}),null)
  assert.equal(canUseKanataMemory(d,d.memories[0],d.instances[0].id,false),true)
  d=grant(d,d.instances[0].id,{read:false,remember:false,share:false})
  assert.equal(d.messages[0].content,'合成用户偏好');assert.equal(d.memories[0].status,'stale')
  assert.equal(canUseKanataMessage(d,d.messages[0],d.instances[0].id,false),false)
})
test('P5 bound instances never fall back to a same-name role or the global override',()=>{
  let d=seed();const binding={worldId:d.worlds[0].id,instanceId:d.instances[0].id}
  d=setKanataRoleBinding(d,'global',binding);d=setKanataRoleBinding(d,'todo',null)
  assert.equal(resolveKanataRoleBinding(d,'todo').status,'unselected');assert.deepEqual(resolveKanataRoleBinding(d,'mood').binding,binding)
  d.roleBindings.modules.todo={worldId:d.worlds[0].id,instanceId:'missing-same-name'}
  assert.equal(resolveKanataRoleBinding(validateKanataData(d),'todo').status,'unavailable')
  d.worlds[0].archived=true;assert.equal(resolveKanataRoleBinding(d,'mood').status,'unavailable')
})
test('P5 read-only life information cannot enter L2/L3 by removing supplied provenance',()=>{
  let d=seed();d=grant(d,d.instances[0].id,{read:true,remember:false,share:false})
  const m=message(d);m.lifeSources=[provenance(d.lifeGrants[0])]
  assert.throws(()=>saveKanataMemory(d,memory(d,m,{lifeSources:[]}),null),/MEMORY_LIFE_PERMISSION_DENIED/)
})
test('P5 canonical duplicate extraction merges sources without promoting or sharing candidates',()=>{
  let d=seed();const first=message(d),second=message(d,'另一个合成来源')
  d=saveKanataMemory(d,memory(d,first),null)
  d=saveKanataMemory(d,memory(d,second,{content:' 喜欢合成测试  ',status:'active',visibility:'public'}),null)
  assert.equal(d.memories.length,1);assert.equal(d.memories[0].status,'candidate');assert.equal(d.memories[0].visibility,'private');assert.equal(d.memories[0].sourceRefs.length,2)
})
test('P5 conflicting facts preserve the active original and require explicit selection',()=>{
  let d=seed();const m=message(d)
  d=saveKanataMemory(d,memory(d,m,{status:'active'}),null);const original=d.memories[0].id
  d=saveKanataMemory(d,memory(d,m,{status:'active',content:'不喜欢合成测试'}),null);const next=d.memories[1].id
  assert.equal(d.memories[0].status,'active');assert.equal(d.memories[1].status,'candidate')
  assert.throws(()=>resolveKanataMemoryConflict(d,next,[]),/MEMORY_CONFLICT_UNRESOLVED/)
  d=resolveKanataMemoryConflict(d,next,[original]);assert.equal(d.memories[0].supersededById,next);assert.equal(d.memories[1].status,'active')
})
test('P5 revising and soft-deleting L0 invalidates memory but retains inspectable source IDs',()=>{
  let d=seed();const m=message(d);d=saveKanataMemory(d,memory(d,m,{status:'active'}),null)
  d=reviseKanataMessage(d,m.id,1,{content:'修订后的合成原文',deleted:false},tools)
  assert.equal(d.memories[0].status,'stale');assert.equal(d.messages[0].revision,2);assert.equal(d.memories[0].sourceRefs[0].revision,1)
  d=reviseKanataMessage(d,m.id,2,{content:'',deleted:true},tools);assert.equal(d.messages[0].deleted,true);assert.equal(d.messages[0].id,m.id)
})
test('P5-review source revision also invalidates assistant replies and memories derived from those replies',()=>{
  let d=seed();const m=message(d),answer=message(d,'依赖旧问题的合成回复',d.instances[0].id);answer.replyToMessageId=m.id
  d=saveKanataMemory(d,memory(d,answer,{status:'active'}),null)
  d=reviseKanataMessage(d,m.id,1,{content:'问题已改变',deleted:false},tools)
  assert.equal(d.messages[1].status,'stopped');assert.equal(d.memories[0].status,'stale')
  assert.equal(d.messageAudits.find(a=>a.messageId===answer.id).previous.content,'依赖旧问题的合成回复')
})
test('P5 shared life memories require recipient consent and cannot be forwarded without recipient share',()=>{
  let d=seed();d=grant(d,d.instances[0].id,{read:true,remember:true,share:true});d=grant(d,d.instances[1].id)
  const m=message(d);m.lifeSources=[provenance(d.lifeGrants[0])];d=saveKanataMemory(d,memory(d,m,{status:'active'}),null)
  d=shareKanataMemory(d,d.memories[0].id,d.instances[1].id,tools)
  const shared=d.memories.find(m=>m.ownerId===d.instances[1].id)
  assert.equal(canUseKanataMemory(d,shared,d.instances[1].id,false),true)
  d=grant(d,d.instances[2].id)
  assert.throws(()=>shareKanataMemory(d,shared.id,d.instances[2].id,tools),/MEMORY_SHARE_PERMISSION_DENIED/)
})
test('P5-review a retained copy cannot propagate after its origin memory is deleted',()=>{
  let d=seed();const m=message(d);d=saveKanataMemory(d,memory(d,m,{status:'active'}),null)
  d=shareKanataMemory(d,d.memories[0].id,d.instances[1].id,tools)
  d.memories[0].status='deleted'
  assert.throws(()=>shareKanataMemory(d,d.memories[1].id,d.instances[2].id,tools),/MEMORY_SHARE_UNAVAILABLE/)
})
test('P5 retrieval excludes candidates, stale refs, private nonowners and over-budget records',()=>{
  let d=seed();const m=message(d);d=saveKanataMemory(d,memory(d,m,{status:'active'}),null)
  assert.equal(selectKanataMemories(d,{worldId:m.worldId,instanceId:d.instances[0].id,text:'偏好',group:false,budget:1000}).entries.length,1)
  assert.equal(selectKanataMemories(d,{worldId:m.worldId,instanceId:d.instances[1].id,text:'偏好',group:false,budget:1000}).entries.length,0)
  assert.equal(selectKanataMemories(d,{worldId:m.worldId,instanceId:d.instances[0].id,text:'偏好',group:false,budget:0}).entries.length,0)
})
test('P5 task success is idempotent and concurrent running lease cannot be duplicated',()=>{
  let d=seed();message(d,'记住合成约定');const plan=planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory')
  assert.ok(plan);d=beginKanataMemoryTask(d,plan,tools);const task=d.tasks[0]
  assert.throws(()=>beginKanataMemoryTask(d,plan,tools),/MEMORY_TASK_ALREADY_RUNNING/)
  d=completeKanataMemoryTask(d,task.id,task.attempt,JSON.stringify({memories:[{key:'合成约定',content:'下次一起讨论',confidence:'statement'}]}),tools)
  assert.equal(d.tasks[0].state,'succeeded');assert.equal(d.memories[0].status,'candidate')
  assert.equal(planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory'),null)
})
test('P5 invalid summary output retains L0 and previous active L2; failed task can retry',()=>{
  let d=seed();for(let i=0;i<26;i++)message(d,'合成原文'+i)
  d=saveKanataMemory(d,memory(d,d.messages[0],{layer:'L2',status:'active',key:'prior-summary'}),null)
  const before=structuredClone(d),plan=planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'summary');assert.ok(plan)
  d=beginKanataMemoryTask(d,plan,tools);const task=d.tasks[0]
  assert.throws(()=>completeKanataMemoryTask(d,task.id,task.attempt,'{bad',tools),/INVALID_MEMORY_RESPONSE/)
  d=failKanataMemoryTask(d,task.id,task.attempt,'INVALID_MEMORY_RESPONSE');assert.deepEqual(d.messages,before.messages);assert.deepEqual(d.memories,before.memories)
  d=beginKanataMemoryTask(d,plan,tools);assert.equal(d.tasks[0].attempt,2)
})
test('P5 memory task cannot accept output after a source revision or remember revocation',()=>{
  let d=seed();message(d,'记住这条合成偏好');const plan=planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory')
  d=beginKanataMemoryTask(d,plan,tools);d.messages[0].revision++
  assert.throws(()=>completeKanataMemoryTask(d,d.tasks[0].id,1,'{"memories":[]}',tools),/MEMORY_SOURCE_STALE/)
})
test('P5 event proposals never change truth; commit applies only known versioned rule',()=>{
  const original=seed();let d=candidate(original),event=d.events[0]
  assert.deepEqual(d.relationships,original.relationships);assert.equal(d.effects.length,0)
  d=commitKanataEvent(d,event.id,event.revision,tools)
  assert.equal(d.relationships[0].dimensions.trust,0.03);assert.deepEqual(new Set(d.effectBaselines.map(b=>b.path)),new Set(['dimensions.trust','dimensions.understanding','state.mood']));assert.equal(d.eventAudits.length,1);assert.equal(d.instances[0].state.mood,'安心')
  assert.throws(()=>commitKanataEvent(d,event.id,1,tools),/EVENT_COMMIT_CONFLICT/)
})
test('P5 revoke E1 recomputes from baseline and preserves independent E2 on the same path',()=>{
  let d=candidate(seed());const e1=d.events[0].id;d=commitKanataEvent(d,e1,1,tools)
  d=candidate(d);const e2=d.events[1].id;d=commitKanataEvent(d,e2,1,tools)
  assert.equal(d.relationships[0].dimensions.trust,0.06)
  d=revokeKanataEvent(d,previewKanataEventRevoke(d,e1),undefined,tools)
  assert.equal(d.relationships[0].dimensions.trust,0.03);assert.equal(d.events.find(e=>e.id===e2).status,'committed')
})
test('P5 causal descendants revoke together but stale previews and uncertain dependencies block',()=>{
  let d=candidate(seed());const e1=d.events[0].id;d=commitKanataEvent(d,e1,1,tools)
  d=candidate(d,'support',[e1]);d=commitKanataEvent(d,d.events[1].id,1,tools)
  const plan=previewKanataEventRevoke(d,e1);assert.equal(plan.revokeIds.length,2)
  const changed=structuredClone(d);changed.events[0].revision++
  assert.throws(()=>revokeKanataEvent(changed,plan,undefined,tools),/EVENT_REVOKE_PREVIEW_STALE/)
  d=revokeKanataEvent(d,plan,undefined,tools);assert.equal(d.relationships[0].dimensions.trust,0)
  let uncertain=candidate(seed());const first=uncertain.events[0].id;uncertain=commitKanataEvent(uncertain,first,1,tools)
  uncertain=candidate(uncertain,'support',[],{causality:'unknown'});uncertain=commitKanataEvent(uncertain,uncertain.events[1].id,1,tools)
  assert.throws(()=>revokeKanataEvent(uncertain,previewKanataEventRevoke(uncertain,first),undefined,tools),/EVENT_DEPENDENCY_UNCERTAIN/)
  uncertain=revokeKanataEvent(uncertain,previewKanataEventRevoke(uncertain,first),'mark-needs-review',tools)
  assert.equal(uncertain.events[1].status,'needsReview');assert.equal(uncertain.relationships[0].dimensions.trust,0)
})
test('P5 source corrections invalidate committed events and re-fold state without deleting original events',()=>{
  let d=seed();const m=message(d);d=candidate(d,'support',[],{sourceRefs:[{messageId:m.id,revision:1}]});d=commitKanataEvent(d,d.events[0].id,1,tools)
  d=reviseKanataMessage(d,m.id,1,{content:'修订',deleted:false},tools)
  assert.equal(d.events[0].status,'needsReview');assert.equal(d.relationships[0].dimensions.trust,0);assert.equal(d.events.length,1)
})
test('P5 unknown legacy effects lack a trusted baseline and cannot be silently inverted',()=>{
  let d=candidate(seed());d=commitKanataEvent(d,d.events[0].id,1,tools);d.effectBaselines=[]
  assert.throws(()=>revokeKanataEvent(d,previewKanataEventRevoke(d,d.events[0].id),undefined,tools),/EVENT_BASELINE_REQUIRED/)
})
test('P5 malformed optional metadata, cross-world bindings and unsafe policies are rejected',()=>{
  const d=seed();assert.throws(()=>validateKanataData({...d,roleBindings:{revision:1,global:{worldId:'bad id',instanceId:'i'},modules:{}}}),/INVALID_EXPERIENCE_ID/)
  assert.throws(()=>setKanataMemoryPolicy(d,{worldId:d.worlds[0].id,strategy:'custom',enabled:true,recentMessages:20,summarizeAfter:10,extractAfter:8,contextBudget:24000,revision:1}),/MEMORY_POLICY_BOUNDS/)
  assert.throws(()=>candidate(d,'rest',[],{action:{instanceId:'unknown-instance'}}),/EVENT_ACTION_SCOPE_DENIED/)
})
test('P5 message audits preserve original versions, explicit deletion removes all version bodies',()=>{
  let d=seed();const m=message(d,'合成旧版本正文')
  d=reviseKanataMessage(d,m.id,1,{content:'合成新版本正文',deleted:false},tools)
  assert.equal(d.messageAudits[0].previous.content,'合成旧版本正文')
  d=reviseKanataMessage(d,m.id,2,{content:'',deleted:true},tools)
  assert.equal(JSON.stringify(d.messageAudits).includes('合成旧版本正文'),false);assert.equal(JSON.stringify(d.messageAudits).includes('合成新版本正文'),false)
})
test('P5 corrections atomically revoke old effects and create a separate candidate replacement',()=>{
  let d=candidate(seed());const original=d.events[0].id;d=commitKanataEvent(d,original,1,tools)
  d=correctKanataEvent(d,previewKanataEventRevoke(d,original),undefined,'修正后的合成说明',tools)
  assert.equal(d.events[0].status,'revoked');assert.equal(d.events[1].status,'candidate');assert.equal(d.events[1].replacesEventId,original);assert.equal(d.relationships[0].dimensions.trust,0)
})
test('P5 deleted facts cannot be automatically recreated from the same old sources',()=>{
  let d=seed();const m=message(d);d=saveKanataMemory(d,memory(d,m),null)
  d=saveKanataMemory(d,{...d.memories[0],status:'deleted',content:'（已删除的记忆内容）'},d.memories[0].revision)
  d=saveKanataMemory(d,memory(d,m),null);assert.equal(d.memories.length,1);assert.equal(d.memories[0].status,'deleted')
})
test('P5 extraction watermark does not count old messages outside the rolling window as new',()=>{
  let d=seed();for(let n=0;n<35;n++)message(d,'普通合成消息'+n)
  const plan=planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory');d=beginKanataMemoryTask(d,plan,tools)
  d=completeKanataMemoryTask(d,d.tasks[0].id,1,'{"memories":[]}',tools)
  message(d,'新的一句普通合成消息')
  assert.equal(planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory'),null)
})
test('P5 revoked event provenance is filtered even when a legacy memory lacks redundant source tags',()=>{
  let d=seed();d=grant(d,d.instances[0].id,{read:true,remember:true,share:false});const m=message(d)
  d=candidate(d,'rest',[],{participantIds:[d.instances[0].id],action:{instanceId:d.instances[0].id},lifeSources:[provenance(d.lifeGrants[0])]});d=commitKanataEvent(d,d.events[0].id,1,tools)
  d.memories.push(memory(d,m,{status:'active',sourceEventIds:[d.events[0].id],content:'源于已授权事件的合成事实'}))
  assert.equal(canUseKanataMemory(d,d.memories[0],d.instances[0].id,false),true)
  d=grant(d,d.instances[0].id,{read:false,remember:false,share:false})
  assert.equal(canUseKanataMemory(d,d.memories[0],d.instances[0].id,false),false)
  const prompt=buildKanataConversationContext(d,d.conversations[0].id,d.instances[0].id).messages.map(m=>m.content).join('\n')
  assert.equal(prompt.includes('源于已授权事件的合成事实'),false);assert.equal(prompt.includes('"mood":"放松"'),false);assert.equal(prompt.includes('dynamicStateUnavailable'),true)
})
test('P5 source revision proofs prevent imported old assistant text from re-entering context',()=>{
  const d=seed(),m=message(d),answer=message(d,'旧合成回答',d.instances[0].id)
  answer.replyToMessageId=m.id;m.revision=2
  assert.equal(canUseKanataMessage(d,answer,d.instances[0].id,false),false)
  answer.replyToRevision=2;assert.equal(canUseKanataMessage(d,answer,d.instances[0].id,false),true)
})
test('P5 disabling automatic organization still permits explicit, idempotent manual extraction',()=>{
  let d=seed();message(d,'合成普通内容')
  d=setKanataMemoryPolicy(d,{worldId:d.worlds[0].id,strategy:'standard',enabled:false,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1})
  assert.equal(planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory',{automatic:true}),null)
  assert.ok(planKanataMemoryTask(d,d.conversations[0].id,d.instances[0].id,'memory',{force:true}))
})
test('P5 a group can recall its own scoped summary without importing another private conversation',()=>{
  let d=seed();const group=d.conversations.find(c=>c.type==='group'),m=message(d,'群内公开讨论的合成内容',d.identities[0].id,group)
  d=saveKanataMemory(d,memory(d,m,{layer:'L2',status:'active',conversationId:group.id,content:'合成群聊专属摘要'}),null)
  assert.equal(canUseKanataMemory(d,d.memories[0],d.instances[0].id,true,group.id),true)
  d.conversations.push({...group,id:'another-group'})
  assert.equal(canUseKanataMemory(d,d.memories[0],d.instances[0].id,true,'another-group'),false)
  const prompt=JSON.stringify(buildKanataConversationContext(d,group.id,d.instances[0].id).messages)
  assert.equal(prompt.includes('合成群聊专属摘要'),true)
})

test('P5 event provenance follows raw sources and causal ancestors when imports omit redundant tags',()=>{
  let d=seed();const who=d.instances[0].id
  d=grant(d,who);const m=message(d);m.lifeSources=[provenance(d.lifeGrants[0])]
  d=candidate(d,'rest',[],{participantIds:[who],action:{instanceId:who},sourceRefs:[{messageId:m.id,revision:1}]})
  d=commitKanataEvent(d,d.events[0].id,1,tools)
  assert.equal(d.events[0].lifeSources.length,1)
  d=candidate(d,'note',[d.events[0].id],{participantIds:[who],action:{},summary:'合成间接生活信息'})
  d=commitKanataEvent(d,d.events[1].id,1,tools)
  delete d.events[0].lifeSources;delete d.events[1].lifeSources
  d.memories.push(memory(d,m,{sourceRefs:[],sourceEventIds:[d.events[1].id],status:'active'}))
  assert.equal(canUseKanataMemory(d,d.memories[0],who,false),true)
  d=grant(d,who,{read:false,remember:false,share:false})
  assert.equal(canUseKanataMemory(d,d.memories[0],who,false),false)
  message(d,'新的普通合成问题')
  assert.equal(JSON.stringify(buildKanataConversationContext(d,d.conversations[0].id,who).messages).includes('合成间接生活信息'),false)
})

test('P5 private event effects cannot leak mood and relationship changes into group context',()=>{
  let d=candidate(seed());d=commitKanataEvent(d,d.events[0].id,1,tools)
  const who=d.events[0].participantIds[0],group=d.conversations.find(c=>c.type==='group')
  message(d,'一起讨论合成安排',d.identities[0].id,group)
  const prompt=buildKanataConversationContext(d,group.id,who).messages.map(m=>m.content).join('\n')
  assert.equal(prompt.includes('合成世界事件'),false);assert.equal(prompt.includes('"mood":"安心"'),false)
  assert.equal(prompt.includes('dynamicStateUnavailable'),true)
})

test('P5 a life-derived event cannot involve an ungranted recipient even when marked private',()=>{
  let d=seed();d=grant(d,d.instances[0].id)
  d=candidate(d,'support',[],{lifeSources:[provenance(d.lifeGrants[0])]})
  assert.throws(()=>commitKanataEvent(d,d.events[0].id,1,tools),/EVENT_LIFE_PERMISSION_DENIED/)
})

test('P5 explicitly sharing an event memory conveys the reviewed fact without exposing private event history',()=>{
  let d=candidate(seed());d=commitKanataEvent(d,d.events[0].id,1,tools)
  const m=message(d),recipient=d.instances.find(i=>!d.events[0].participantIds.includes(i.id)).id
  d=saveKanataMemory(d,memory(d,m,{status:'active',sourceEventIds:[d.events[0].id]}),null)
  d=shareKanataMemory(d,d.memories[0].id,recipient,tools)
  assert.equal(canUseKanataMemory(d,d.memories[1],recipient,false),true)
  const c=d.conversations.find(c=>c.type==='private'&&c.participantIds.includes(recipient))
  message(d,'新的合成问题',d.identities[0].id,c)
  const prompt=buildKanataConversationContext(d,c.id,recipient).messages.map(m=>m.content).join('\n')
  assert.equal(prompt.includes('喜欢合成测试'),true);assert.equal(prompt.includes('合成世界事件'),false)
})
