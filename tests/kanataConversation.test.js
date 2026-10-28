import test from 'node:test'
import assert from 'node:assert/strict'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { buildKanataConversationContext,decideKanataSpeakers,splitKanataBubbles,recordKanataAttempt } from '../src/features/chat/domain/kanataConversation.js'
import { estimateKanataCost } from '../src/features/chat/domain/kanataUsage.js'
import { validateKanataData } from '../src/features/chat/domain/kanataValidation.js'
import { readKanataAuthorizedLifeData } from '../src/features/chat/domain/kanataReadPermission.js'
let sequence=0
const seed=()=>instantiateWorldPreset(createEmptyKanataData('user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++sequence)})
function message(d,c,sender,content,id='source'){
  const user=d.identities.some(i=>i.id===sender)
  return{id,worldId:c.worldId,conversationId:c.id,senderId:sender,senderType:user?'user':'character',senderNameSnapshot:user?'老师':'合成角色',role:user?'user':'assistant',content,createdAt:1000,revision:1,status:'complete',turnId:'turn',batchId:'batch'}
}
const attempt=d=>({id:'usage',worldId:d.worlds[0].id,conversationId:d.conversations[0].id,instanceId:d.instances[0].id,turnId:'turn',model:'deepseek-flash',officialProvider:true,startedAt:1000,finishedAt:null,status:'pending',transport:'stream',errorCode:'',finishReason:'',usage:null,estimatedInputTokens:100,estimatedOutputTokens:0})
test('P4 life read permission checks before invoking a reader; read alone never grants group sharing',()=>{
  const d=seed(),scope={worldId:d.worlds[0].id,instanceId:d.instances[0].id,moduleId:'todo',group:false};let calls=0
  const read=()=>{calls++;return 'synthetic'}
  assert.equal(readKanataAuthorizedLifeData(d,scope,read).allowed,false);assert.equal(calls,0)
  d.lifeGrants.push({id:'grant',worldId:scope.worldId,instanceId:scope.instanceId,moduleId:'todo',read:true,remember:false,share:false,revision:1})
  assert.equal(readKanataAuthorizedLifeData(d,{...scope,group:true},read).allowed,false);assert.equal(calls,0)
  assert.deepEqual(readKanataAuthorizedLifeData(d,scope,read),{allowed:true,value:'synthetic'});assert.equal(calls,1)
  assert.equal(readKanataAuthorizedLifeData(d,{...scope,instanceId:d.instances[1].id},read).allowed,false)
})
test('P4 @ chooses exact speaker, normal group is bounded and unknown mentions fail',()=>{
  const d=seed(),group=d.conversations.find(c=>c.type==='group')
  assert.deepEqual(decideKanataSpeakers(d,group.id,'@砂狼白子 今天想运动吗？'),[d.instances[1].id])
  assert.ok(decideKanataSpeakers(d,group.id,'今天有什么安排？').length<=2)
  assert.throws(()=>decideKanataSpeakers(d,group.id,'@未知角色 请发言'),/MENTION_UNKNOWN_OR_AMBIGUOUS/)
  assert.deepEqual(decideKanataSpeakers(d,d.conversations[0].id,'你好'),[d.instances[0].id])
})
test('P4 five persona contexts differ and exclude other personas, private chats and knowledge',()=>{
  const d=seed(),group=d.conversations.find(c=>c.type==='group')
  d.messages.push(message(d,group,d.identities[0].id,'今天的安排？'))
  d.messages.push(message(d,d.conversations[0],d.identities[0].id,'PRIVATE-OTHER-CHAT','private'))
  d.lorebookEntries.push({id:'secret',worldId:d.worlds[0].id,scope:'character',ownerId:d.instances[1].id,knownBy:[d.instances[1].id],keys:[],content:'PRIVATE-SHIROKO',priority:500,activationRule:'always',visibility:'private',revision:1,sourceTag:'synthetic'})
  const contexts=d.instances.map(i=>buildKanataConversationContext(d,group.id,i.id).messages)
  assert.equal(new Set(contexts.map(c=>c[0].content)).size,5)
  assert.ok(contexts[0][0].content.includes(d.cardVersions[0].definition.speechStyle))
  assert.equal(JSON.stringify(contexts[0]).includes('PRIVATE-SHIROKO'),false)
  assert.equal(JSON.stringify(contexts).includes('PRIVATE-OTHER-CHAT'),false)
  assert.equal(JSON.stringify(contexts[1]).includes('PRIVATE-SHIROKO'),true)
  assert.equal(contexts[0][0].content.includes(d.cardVersions[1].definition.summary),false)
})
test('P4 other group characters are labelled user-context, never merged into speaker assistant history',()=>{
  const d=seed(),c=d.conversations.find(c=>c.type==='group')
  d.messages.push(message(d,c,d.identities[0].id,'问候'),message(d,c,d.instances[1].id,'别人的回复','other'),message(d,c,d.instances[0].id,'自己的回复','own'))
  const context=buildKanataConversationContext(d,c.id,d.instances[0].id)
  assert.deepEqual(context.messages.slice(1).map(m=>m.role),['user','user','assistant'])
  assert.ok(context.messages[2].content.includes(d.instances[1].id))
})
test('P4 modes preserve persona, identities and state; paragraphs cap without breaking RP',()=>{
  const d=seed(),c=d.conversations[0];d.messages.push(message(d,c,d.identities[0].id,'你好'))
  const before=structuredClone(d);c.mode='roleplay'
  const context=buildKanataConversationContext(d,c.id,d.instances[0].id)
  assert.equal(context.mode,'roleplay');assert.deepEqual(d.instances,before.instances)
  assert.equal(splitKanataBubbles('a\n\nb\n\nc\n\nd\n\ne','daily').length,4)
  assert.deepEqual(splitKanataBubbles('*抬头*\n\n你好','roleplay'),['*抬头*\n\n你好'])
})
test('P4 archived or cross-world speaker cannot build a request',()=>{
  const d=seed();d.messages.push(message(d,d.conversations[0],d.identities[0].id,'你好'))
  assert.throws(()=>buildKanataConversationContext(d,d.conversations[0].id,d.instances[1].id),/SPEAKER_ACCESS_DENIED/)
  d.worlds[0].archived=true;assert.throws(()=>buildKanataConversationContext(d,d.conversations[0].id,d.instances[0].id),/CONVERSATION_UNAVAILABLE/)
})
test('P4 actual second world history, identity and persona overrides never enter first world context',()=>{
  const first=seed(),d=instantiateWorldPreset(first,preset,{initializationKey:'second',now:2000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++sequence)})
  const secondConversation=d.conversations.find(c=>c.worldId===d.worlds[1].id)
  d.identities[1].displayName='SECOND-WORLD-IDENTITY'
  d.instances.find(i=>i.worldId===d.worlds[1].id).overrides.summary='SECOND-WORLD-PERSONA'
  d.messages.push(message(d,d.conversations[0],d.identities[0].id,'第一世界问题'),message(d,secondConversation,d.identities[1].id,'SECOND-WORLD-SECRET','second-source'))
  const context=JSON.stringify(buildKanataConversationContext(d,d.conversations[0].id,d.instances[0].id))
  assert.equal(context.includes('SECOND-WORLD'),false)
  assert.throws(()=>buildKanataConversationContext(d,d.conversations[0].id,d.instances.find(i=>i.worldId===d.worlds[1].id).id),/SPEAKER_ACCESS_DENIED/)
})
test('P4 attempts finalize once, strict scope validation and compatibility with old no-usage graph',()=>{
  const d=seed(),pending=attempt(d),next=recordKanataAttempt(d,pending)
  assert.equal(d.usageEvents,undefined);assert.equal(validateKanataData(d).usageEvents,undefined)
  const final={...pending,status:'succeeded',finishedAt:2000,finishReason:'stop',usage:{promptTokens:100,completionTokens:50,cacheHitTokens:10}}
  const saved=recordKanataAttempt(next,final)
  assert.deepEqual(recordKanataAttempt(saved,final),saved)
  assert.throws(()=>recordKanataAttempt(saved,{...final,estimatedInputTokens:999}),/USAGE_ALREADY_FINAL/)
  assert.throws(()=>recordKanataAttempt(d,{...pending,instanceId:'outside'}),/USAGE_SCOPE_DENIED/)
  assert.throws(()=>recordKanataAttempt(d,{...pending,errorCode:'PRIVATE MESSAGE'}),/INVALID_USAGE_CODE/)
})
test('P4 cost uses documented CNY range, cache accounting and unknown model/provider stays unpriced',()=>{
  const d=seed(),e={...attempt(d),status:'succeeded',finishedAt:2000,usage:{promptTokens:1000000,completionTokens:1000000,cacheHitTokens:0}}
  assert.equal(estimateKanataCost(e).minimumCny,5);assert.equal(estimateKanataCost(e).maximumCny,10)
  assert.equal(estimateKanataCost({...e,model:'deepseek-chat'}).maximumCny,null)
  assert.equal(estimateKanataCost({...e,officialProvider:false}).minimumCny,null)
  assert.equal(estimateKanataCost({...e,usage:null}).basis,'estimated-upper-bound')
})
