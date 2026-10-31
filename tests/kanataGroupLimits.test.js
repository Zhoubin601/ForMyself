import assert from 'node:assert/strict'
import test from 'node:test'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
import {validateGroupReplyLimits,kanataReplyLimits} from '../src/features/chat/domain/groupReplyLimits.js'
import {decideKanataSpeakers,splitKanataBubbles} from '../src/features/chat/domain/kanataConversation.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
import {copyKanataWorld,createKanataGroup} from '../src/features/chat/domain/kanataManagementCore.js'
test('P7 old conversations retain conservative defaults without mutating their schema',()=>{
  const data=archiveData(0),group=data.conversations.find(c=>c.type==='group'),before=JSON.stringify(group)
  assert.deepEqual(kanataReplyLimits(group),{maxSpeakers:2,maxMessages:8})
  assert.deepEqual(kanataReplyLimits(data.conversations[0]),{maxSpeakers:1,maxMessages:4})
  assert.equal(JSON.stringify(group),before)
})
test('P7 invalid limits and non-group scopes are rejected without running getters',()=>{
  for(const value of [null,[],{}, {maxSpeakers:0,maxMessages:1},{maxSpeakers:9,maxMessages:32},{maxSpeakers:1.5,maxMessages:3},{maxSpeakers:'2',maxMessages:8},{maxSpeakers:3,maxMessages:2},{maxSpeakers:2,maxMessages:33},{maxSpeakers:2,maxMessages:NaN},{maxSpeakers:2,maxMessages:8,unknown:true}])assert.throws(()=>validateGroupReplyLimits(value))
  let called=false
  assert.throws(()=>validateGroupReplyLimits({get maxSpeakers(){called=true;return 2},maxMessages:8}),/INVALID_JSON_PROPERTY/)
  assert.equal(called,false)
  const data=archiveData(0);data.conversations[0].replyLimits={maxSpeakers:1,maxMessages:1}
  assert.throws(()=>validateKanataData(data),/GROUP_REPLY_LIMITS_SCOPE/)
})
test('P7 configured speaker cap respects ordered mentions, permits silence and filters by topic',()=>{
  const data=archiveData(0),group=data.conversations.find(c=>c.type==='group')
  group.replyLimits={maxSpeakers:3,maxMessages:4}
  const names=data.cardVersions.map(v=>v.definition.name),text=names.map(n=>'@'+n).join(' ')
  assert.deepEqual(decideKanataSpeakers(data,group.id,text),data.instances.slice(0,3).map(i=>i.id))
  assert.equal(decideKanataSpeakers(data,group.id,'无相关话题').length,1)
  data.cardVersions.slice(0,4).forEach(v=>{v.definition.interests=['共同合成话题']})
  assert.equal(decideKanataSpeakers(data,group.id,'共同合成话题').length,3)
  assert.throws(()=>decideKanataSpeakers(data,group.id,text+' @未知'),/MENTION_UNKNOWN_OR_AMBIGUOUS/)
})
test('P7 lower bubble allowance merges complete paragraphs and preserves RP prose',()=>{
  const text='第一段。\n\n第二段。\n\n第三段。\n\n第四段。\n\n第五段。'
  for(const limit of [1,2,3,4]){
    const rows=splitKanataBubbles(text,'daily',limit)
    assert.equal(rows.length,limit);assert.equal(rows.join('\n\n'),text)
    assert.deepEqual(splitKanataBubbles(text,'roleplay',limit),[text])
  }
  for(const limit of [0,5,1.5,NaN])assert.throws(()=>splitKanataBubbles(text,'daily',limit),/INVALID_BUBBLE_LIMIT/)
})
test('P7 imported multiword names and aliases use longest literal mentions; ambiguity remains an error',()=>{
  const data=archiveData(0),group=data.conversations.find(c=>c.type==='group')
  data.instances[0].overrides.name='合成 英文角色';data.instances[0].overrides.aliases=['多 字别名','合成[角色]']
  data.instances[1].overrides.aliases=['合成']
  assert.deepEqual(decideKanataSpeakers(data,group.id,'@合成 英文角色 你好'),[data.instances[0].id])
  assert.deepEqual(decideKanataSpeakers(data,group.id,'@多 字别名 你好'),[data.instances[0].id])
  assert.deepEqual(decideKanataSpeakers(data,group.id,'@合成[角色] 你好'),[data.instances[0].id])
  data.instances[1].overrides.aliases.push('多 字别名')
  assert.throws(()=>decideKanataSpeakers(data,group.id,'@多 字别名 你好'),/MENTION_UNKNOWN_OR_AMBIGUOUS/)
})
test('P7 limits survive portable backup and world copy with independent settings',()=>{
  const data=archiveData(0),group=data.conversations.find(c=>c.type==='group')
  group.replyLimits={maxSpeakers:3,maxMessages:4}
  const restored=readKanataChatBackupSnapshot(buildKanataChatBackupSnapshot(data)).data
  assert.deepEqual(restored.conversations.find(c=>c.id===group.id).replyLimits,group.replyLimits)
  let sequence=0
  const copied=copyKanataWorld(restored,group.worldId,'合成另一世界',{key:'group-copy',now:2000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-copy-'+(++sequence)})
  const other=copied.conversations.find(c=>c.worldId!==group.worldId&&c.type==='group')
  assert.deepEqual(other.replyLimits,group.replyLimits);other.replyLimits.maxMessages=5
  assert.equal(copied.conversations.find(c=>c.id===group.id).replyLimits.maxMessages,4)
  assert.equal(copied.messages.length,0)
})
test('P7 custom group creation starts empty, belongs to one world and adds no memories, grants or events',()=>{
  const data=archiveData(0),worldId=data.worlds[0].id,instanceIds=data.instances.slice(0,2).map(i=>i.id),before=JSON.stringify(data)
  const next=createKanataGroup(data,worldId,{title:' 合成新群 ',instanceIds},{key:'fresh-group',now:2000,timeZone:'Asia/Shanghai',idFactory:()=> 'custom-group'})
  const group=next.conversations.at(-1)
  assert.equal(group.title,'合成新群');assert.equal(group.type,'group');assert.equal(group.worldId,worldId)
  assert.deepEqual(group.participantIds,[data.identities[0].id,...instanceIds])
  assert.equal(next.messages.length,0);assert.equal(next.memories.length,0);assert.equal(next.lifeGrants.length,0);assert.equal(next.events.length,0)
  assert.equal(JSON.stringify(data),before)
  const restored=readKanataChatBackupSnapshot(buildKanataChatBackupSnapshot(next)).data
  assert.deepEqual(restored.conversations.at(-1),group)
})
test('P7 custom group cannot accept an identity/foreign/missing/repeated member, archived world or conflicting ID',()=>{
  const data=archiveData(0),worldId=data.worlds[0].id,ids=data.instances.slice(0,2).map(i=>i.id),options={key:'group',now:2000,timeZone:'Asia/Shanghai',idFactory:()=> 'custom-group'}
  const before=JSON.stringify(data)
  for(const instanceIds of [[],[ids[0]],[ids[0],ids[0]],[ids[0],data.identities[0].id],[ids[0],'missing']])assert.throws(()=>createKanataGroup(data,worldId,{title:'合成',instanceIds},options))
  for(const title of ['',' '.repeat(3),'x'.repeat(201)])assert.throws(()=>createKanataGroup(data,worldId,{title,instanceIds:ids},options),/INVALID_GROUP_TITLE/)
  assert.throws(()=>createKanataGroup(data,worldId,{title:'合成',instanceIds:ids},{...options,idFactory:()=>data.conversations[0].id}),/DUPLICATE/)
  const copied=copyKanataWorld(data,worldId,'合成其他世界',{...options,idFactory:(kind,key)=>kind+'-foreign-'+key.length+'-'+(++copySequence)})
  const foreign=copied.instances.find(i=>i.worldId!==worldId)
  assert.throws(()=>createKanataGroup(copied,worldId,{title:'合成',instanceIds:[ids[0],foreign.id]},options),/GROUP_PARTICIPANT_SCOPE/)
  const archived=validateKanataData(data);archived.worlds[0].archived=true
  assert.throws(()=>createKanataGroup(archived,worldId,{title:'合成',instanceIds:ids},options),/WORLD_ARCHIVED/)
  assert.equal(JSON.stringify(data),before)
})
let copySequence=0
