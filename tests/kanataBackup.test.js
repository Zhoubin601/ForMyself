import test from 'node:test'
import assert from 'node:assert/strict'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { buildFullBackupSnapshot } from '../src/services/fullBackup.js'
import { buildKanataFullBackupSnapshot, prepareKanataFullRestore, captureKanataRestoreSnapshot,
  buildKanataChatBackupSnapshot, readKanataChatBackupSnapshot, kanataRestoreParts, validateKanataRestoreSnapshot,
  describeLegacyChatDiscard } from '../src/features/chat/backup/kanataBackup.js'
const clone=value=>structuredClone(value)
const data=()=>instantiateWorldPreset(createEmptyKanataData('user-local'),preset,{initializationKey:'one',now:1000,timeZone:'Asia/Shanghai',idFactory:(kind,key)=>kind+'-'+[...key].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,1).toString(16)})
const parts=()=>({savings:{data:[{id:'saving-synthetic'}],metadata:{groups:[]}},weight:{data:[{id:'weight-synthetic',weight:60,date:'2026-01-01'}]},mood:{data:[],metadata:{}},passwords:{data:[],metadata:{categories:[]}},schedules:{data:{}},chat:{data:data()},settings:{data:{}}})
test('P2-backup new v13 and single preserve all new entities, never call v4 normalizer on chat',()=>{
  const p=parts(),full=buildKanataFullBackupSnapshot(p),single=buildKanataChatBackupSnapshot(p.chat.data)
  assert.equal(full.version,13);assert.deepEqual(full.data.chat,p.chat.data)
  assert.deepEqual(readKanataChatBackupSnapshot(single).data,p.chat.data)
  const restored=prepareKanataFullRestore(full)
  assert.equal(restored.mode,'replace');assert.deepEqual(kanataRestoreParts(restored).chat,p.chat)
  assert.equal(restored.backup.data.chat && Object.keys(restored.backup.data.chat).length,0)
})
for(let version=1;version<=12;version++)test('P2-backup legacy full v'+version+' preserves nonchat, requires consent and never revives legacy chat',()=>{
  const old=buildFullBackupSnapshot({weight:[{id:'legacy-weight',weight:70,date:'2026-01-01'}],chat:{messages:[{id:'old-msg',role:'user',content:'synthetic legacy private text',createdAt:1}]}},'2026-01-01T00:00:00Z')
  old.version=version;if(version<2)delete old.data.schedules;if(version<3)delete old.data.chat
  assert.throws(()=>prepareKanataFullRestore(old),/LEGACY_CHAT_DISCARD_CONFIRMATION_REQUIRED/)
  const plan=prepareKanataFullRestore(old,{legacyChat:'discard'}),p=kanataRestoreParts(plan)
  assert.equal(plan.mode,'preserve');assert.equal(plan.kanata,null);assert.equal(Object.hasOwn(p,'chat'),false)
  assert.equal(p.weight.data[0].id,'legacy-weight');assert.equal(Object.hasOwn(p,'todos'),false)
  assert.equal(JSON.stringify(plan).includes('synthetic legacy private text'),false)
  assert.equal(describeLegacyChatDiscard(old).present,version>=3)
})
test('P2-backup rejects legacy single and future schemas without returning partial new data',()=>{
  assert.throws(()=>readKanataChatBackupSnapshot({type:'formyself-chat-backup',version:4}),/LEGACY_CHAT_BACKUP_UNSUPPORTED/)
  assert.throws(()=>prepareKanataFullRestore({...buildKanataFullBackupSnapshot(parts()),version:99}),/UNSUPPORTED_FULL_BACKUP_VERSION/)
  const bad=buildKanataFullBackupSnapshot(parts());bad.data.chat.instances[0].worldId='missing'
  assert.throws(()=>prepareKanataFullRestore(bad),/ORPHAN_WORLD/)
})
test('P2-backup export pauses sending but rollback capture preserves tasks exactly',()=>{
  const p=parts(),d=p.chat.data
  d.tasks.push({id:'task-synthetic',worldId:d.worlds[0].id,kind:'proactive',state:'running',idempotencyKey:'send-once',sourceRefs:[],sourceRevision:1,attempt:1,notBefore:1000,leaseUntil:2000,instanceId:d.instances[0].id,conversationId:d.conversations[0].id,resultEventIds:[]})
  const old=clone(p)
  assert.equal(buildKanataFullBackupSnapshot(p).data.chat.tasks[0].state,'cancelled')
  assert.equal(buildKanataChatBackupSnapshot(d).data.tasks[0].leaseUntil,0)
  const capture=captureKanataRestoreSnapshot(p)
  assert.equal(validateKanataRestoreSnapshot(capture).kanata.tasks[0].state,'running')
  assert.equal(capture.kanata.tasks[0].leaseUntil,2000);assert.deepEqual(p,old)
})
test('P2-backup canonical recovery rejects legacy content injected into empty sentinel',()=>{
  const snapshot=captureKanataRestoreSnapshot(parts());snapshot.backup.data.chat={messages:[]}
  assert.throws(()=>validateKanataRestoreSnapshot(snapshot),/RESTORE_SNAPSHOT_CONTAINS_LEGACY_CHAT/)
})

test('P2-backup review1 rejects present-but-invalid optional Todo parts instead of silently omitting them', () => {
  for (const malformed of [null, 42, {}, {metadata:{}}]) {
    const p=parts();p.todos=malformed
    assert.throws(()=>buildKanataFullBackupSnapshot(p),/INVALID_BACKUP_PART:todos|MISSING_BACKUP_DATA:todos/)
  }
})
test('P2-backup review1 valid optional Todo and all three independent permissions survive wire roundtrip', () => {
  const p=parts(),d=p.chat.data
  p.todos={data:{version:1,revision:0,tasks:[],overrides:[],completions:[]}}
  d.lifeGrants.push({id:'grant-backup',worldId:d.worlds[0].id,instanceId:d.instances[0].id,moduleId:'todo',read:false,remember:true,share:false,revision:1})
  const snapshot=prepareKanataFullRestore(buildKanataFullBackupSnapshot(p,'2026-01-01T00:00:00Z'))
  const restored=kanataRestoreParts(snapshot)
  assert.ok(Object.hasOwn(restored,'todos'))
  assert.deepEqual(restored.todos.data,p.todos.data)
  assert.deepEqual(restored.chat.data.lifeGrants,d.lifeGrants)
})

test('P2-backup review2 all nonempty new entities and safe unknown card extensions roundtrip',()=>{
  const p=parts(),d=p.chat.data,w=d.worlds[0].id,c=d.conversations[0],who=d.instances[0].id
  d.cardVersions[0].rawData={extensions:{unknown:{safe:['keep',1,null]}}}
  d.messages.push({id:'source-message',worldId:w,conversationId:c.id,role:'user',senderType:'user',senderId:d.identities[0].id,senderNameSnapshot:'合成用户',content:'测试约定',createdAt:1000,revision:1,status:'complete',turnId:'turn-source',batchId:'batch-source'})
  const sourceRefs=[{messageId:'source-message',revision:1}]
  d.memories.push({id:'memory-source',worldId:w,ownerType:'character',ownerId:who,layer:'L3',key:'test-promise',content:'合成约定',sourceRefs:clone(sourceRefs),status:'active',revision:1,visibility:'private'})
  d.events.push({id:'event-source',worldId:w,participantIds:[who],sourceRefs:clone(sourceRefs),causedByEventIds:[],status:'committed',visibility:'private',summary:'合成约定',effectiveAt:1000,recordedAt:1000,revision:1})
  d.effects.push({id:'effect-source',worldId:w,eventId:'event-source',targetType:'instance',targetId:who,operation:'set',path:'state.mood',value:'平静',ruleVersion:1})
  d.tasks.push({id:'completed-task',worldId:w,kind:'memory',state:'succeeded',idempotencyKey:'extract-source',sourceRefs:clone(sourceRefs),sourceRevision:1,attempt:1,notBefore:1000,leaseUntil:0,instanceId:who,conversationId:c.id,resultEventIds:['event-source']})
  d.lifeGrants.push({id:'grant-source',worldId:w,instanceId:who,moduleId:'mood',read:true,remember:false,share:false,revision:1})
  assert.deepEqual(prepareKanataFullRestore(JSON.parse(JSON.stringify(buildKanataFullBackupSnapshot(p)))).kanata,d)
  assert.deepEqual(readKanataChatBackupSnapshot(JSON.parse(JSON.stringify(buildKanataChatBackupSnapshot(d)))).data,d)
})
test('P2-backup review2 hostile task-policy omissions cannot silently resume pending sends',()=>{
  const d=data()
  for(const [index,kind] of ['reply','proactive','followup'].entries()) d.tasks.push({id:'pending-'+index,worldId:d.worlds[0].id,kind,state:'pending',idempotencyKey:'send-'+index,sourceRefs:[],sourceRevision:1,attempt:0,notBefore:1000,leaseUntil:1001,instanceId:d.instances[0].id,conversationId:d.conversations[0].id,resultEventIds:[]})
  const imported=readKanataChatBackupSnapshot({type:'kanata-chat-backup',version:1,createdAt:'2026-01-01T00:00:00Z',data:d})
  assert.ok(imported.data.tasks.every(t=>t.state==='cancelled' && t.leaseUntil===0))
  assert.ok(d.tasks.every(t=>t.state==='pending' && t.leaseUntil===1001))
  assert.throws(()=>readKanataChatBackupSnapshot({...imported,taskPolicy:'run-all-immediately'}),/UNSUPPORTED_KANATA_TASK_POLICY/)
  const full=buildKanataFullBackupSnapshot(parts());full.data.chat=d;delete full.taskPolicy
  assert.ok(prepareKanataFullRestore(full).kanata.tasks.every(t=>t.state==='cancelled'))
})
test('P2-backup review2 canonical journals reject mode confusion and unknown versions',()=>{
  const snapshot=captureKanataRestoreSnapshot(parts())
  assert.throws(()=>validateKanataRestoreSnapshot({...snapshot,version:2}),/UNSUPPORTED_KANATA_RESTORE_SNAPSHOT/)
  assert.throws(()=>validateKanataRestoreSnapshot({...snapshot,mode:'preserve'}),/INVALID_PRESERVE_KANATA_DATA/)
  assert.throws(()=>validateKanataRestoreSnapshot({...snapshot,mode:'replace',kanata:null}),/INVALID_OBJECT/)
  assert.throws(()=>validateKanataRestoreSnapshot({...snapshot,backup:{...snapshot.backup,version:13}}),/INVALID_CANONICAL_BACKUP_VERSION/)
  assert.throws(()=>prepareKanataFullRestore({...buildKanataFullBackupSnapshot(parts()),data:{...snapshot.backup.data}}),/INVALID_KANATA_TYPE/)
})
