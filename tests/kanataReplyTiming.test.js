import assert from 'node:assert/strict'
import test from 'node:test'
import {archiveData} from './helpers/kanataArchiveFixture.js'
import {validateReplyTimingPolicy} from '../src/features/chat/domain/replyTimingPolicy.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
import {planKanataReplyDelay} from '../src/features/chat/autonomy/kanataReplyTiming.js'
import {buildKanataChatBackupSnapshot,readKanataChatBackupSnapshot} from '../src/features/chat/backup/kanataBackup.js'
const now=Date.UTC(2026,9,30,4)
const fixture=()=>{
  const data=archiveData(0),conversation=data.conversations[0],actor=data.instances.find(i=>conversation.participantIds.includes(i.id))
  conversation.replyTiming={enabled:true,waitMs:5000};data.worlds[0].autonomyEnabled=true;actor.autonomyEnabled=true
  return{data,conversation,actor}
}
test('P7 reply timing is optional and off unless the exact world and selected actor are active',()=>{
  const {data,conversation,actor}=fixture(),before=JSON.stringify(data)
  assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),0)
  assert.equal(JSON.stringify(data),before)
  actor.state.energy=0.25;assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),5000)
  assert.equal(planKanataReplyDelay(data,conversation,[],now),0)
  actor.autonomyEnabled=false;assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),0)
  actor.autonomyEnabled=true;data.worlds[0].autonomyEnabled=false;assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),0)
  data.worlds[0].autonomyEnabled=true;delete conversation.replyTiming;assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),0)
})
test('P7 availability uses the actual virtual weekday and timezone without reading mood or relationship penalties',()=>{
  const {data,conversation,actor}=fixture()
  data.virtualSchedules=[{id:'timing-schedule',worldId:conversation.worldId,instanceId:actor.id,days:[5],startMinute:720,endMinute:780,activity:'合成工作',location:'合成地点',resting:false,revision:1}]
  assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),5000)
  assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now+3600000),0)
  actor.state.mood='难过';data.relationships.forEach(r=>r.dimensions.trust=-1)
  assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now+3600000),0)
  data.virtualSchedules[0].worldId='other-world';assert.equal(planKanataReplyDelay(data,conversation,[actor.id],now),0)
})
test('P7 reply timing rejects hostile values without invoking accessors or silently accepting extensions',()=>{
  for(const value of [null,[],{},{enabled:1,waitMs:1000},{enabled:true,waitMs:999},{enabled:true,waitMs:30001},{enabled:true,waitMs:1500.5},{enabled:true,waitMs:'5000'},{enabled:true,waitMs:5000,code:'run'}])assert.throws(()=>validateReplyTimingPolicy(value))
  let called=false;assert.throws(()=>validateReplyTimingPolicy({get enabled(){called=true;return true},waitMs:5000}));assert.equal(called,false)
  const {data}=fixture();data.conversations[0].replyTiming.waitMs=Infinity;assert.throws(()=>validateKanataData(data))
})
test('P7 portable schema retains a scoped timing configuration and never seeds history',()=>{
  const {data,conversation}=fixture(),backup=buildKanataChatBackupSnapshot(data),read=readKanataChatBackupSnapshot(backup).data
  assert.deepEqual(read.conversations.find(c=>c.id===conversation.id).replyTiming,{enabled:true,waitMs:5000})
  assert.equal(read.messages.length,0);assert.equal(read.memories.length,0);assert.equal(read.events.length,0)
})
