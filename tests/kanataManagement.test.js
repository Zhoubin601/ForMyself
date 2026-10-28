import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import { instantiateWorldPreset } from '../src/features/chat/domain/presetCore.js'
import { createEmptyKanataData } from '../src/features/chat/domain/kanataCore.js'
import { createKanataWorld, renameKanataWorld, archiveKanataWorld, updateKanataIdentity, addKanataCharacter, copyKanataWorld,
  importKanataCard, updateKanataCard, updateKanataCharacter, archiveKanataCard, previewKanataCardSync, syncKanataCard, resolveKanataCharacter } from '../src/features/chat/domain/kanataManagementCore.js'
import { saveKanataLoreEntry, selectKanataLorebook, renderKanataCharacter, attachKanataCardLore, previewKanataCardLore } from '../src/features/chat/lorebook/kanataLorebook.js'
import { parseCharacterCardBytes } from '../src/features/chat/cards/characterCardImport.js'
import { buildKanataChatBackupSnapshot, readKanataChatBackupSnapshot } from '../src/features/chat/backup/kanataBackup.js'

const idFactory=(kind,key)=>kind+'-'+createHash('sha256').update(key).digest('hex').slice(0,24)
const options=key=>({key,now:2000,timeZone:'Asia/Shanghai',idFactory})
const seed=()=>instantiateWorldPreset(createEmptyKanataData('synthetic-user'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory})
const freshFields={name:'第二世界',rules:'合成规则',displayName:'旅人',background:'合成背景'}
const card=()=>parseCharacterCardBytes(new TextEncoder().encode(JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'合成卡',description:'{{user}}在这里。',personality:'独立思考',mes_example:'简短表达。',
  extensions:{unknown:{safe:[null,1]}},character_book:{entries:[{keys:['秘密'],content:'只有本人知道的设定',enabled:true}]}}})),{fileName:'synthetic.json'})
const privateEntry=(d,id,owner,content,keys=['secret'])=>({id,worldId:d.worlds[0].id,scope:'character',ownerId:owner,keys,content,priority:500,activationRule:'always',visibility:'private',knownBy:[owner],sourceTag:'synthetic',revision:1})

test('P3-world new world is empty, has editable independent identity, and preserves the input',()=>{
  const d=seed(),before=structuredClone(d),created=createKanataWorld(d,freshFields,options('create'))
  assert.deepEqual(d,before);assert.equal(created.worlds.length,2)
  const w=created.worlds[1]
  assert.equal(w.createdAt,2000);assert.equal(w.lastSimulatedAt,2000);assert.equal(w.autonomyEnabled,false)
  assert.equal(created.instances.filter(i=>i.worldId===w.id).length,0)
  const updated=updateKanataIdentity(renameKanataWorld(created,w.id,'新名字'),w.id,{displayName:'朋友',background:'自定义'})
  assert.equal(updated.identities.find(i=>i.worldId===w.id).displayName,'朋友')
  assert.equal(updated.identities[0].displayName,'老师');assert.equal(updated.worlds[0].name,d.worlds[0].name)
  assert.throws(()=>createKanataWorld(d,{...freshFields,name:''},options('bad')),/INVALID_TEXT/)
})
test('P3-world same card creates independently in another world, with own state and private conversation',()=>{
  const d=createKanataWorld(seed(),freshFields,options('create')),w=d.worlds[1],cardId=d.cards[0].id
  const next=addKanataCharacter(d,w.id,cardId,options('add'))
  const instance=next.instances.find(i=>i.worldId===w.id)
  assert.equal(instance.cardId,cardId);assert.notEqual(instance.id,next.instances[0].id)
  assert.deepEqual(instance.state,{mood:'平静',energy:1,location:''})
  assert.equal(next.conversations.find(c=>c.worldId===w.id).participantIds.includes(instance.id),true)
  const edited=updateKanataCharacter(next,instance.id,{speechStyle:'世界专属表达'})
  assert.equal(resolveKanataCharacter(edited,instance.id).speechStyle,'世界专属表达')
  assert.notEqual(resolveKanataCharacter(edited,edited.instances[0].id).speechStyle,'世界专属表达')
  assert.throws(()=>updateKanataCharacter(next,instance.id,{state:{mood:'unsafe'}}),/UNSUPPORTED_CHARACTER_OVERRIDE/)
})
test('P3-world copy only static settings/knowledge/roles; original experiences and grants never cross',()=>{
  const d=seed(),w=d.worlds[0],c=d.conversations[0],who=d.instances[0].id
  d.messages.push({id:'synthetic-msg',worldId:w.id,conversationId:c.id,role:'user',senderType:'user',senderId:d.identities[0].id,senderNameSnapshot:'老师',content:'原世界合成经历',createdAt:1000,revision:1,status:'complete',turnId:'synthetic-turn',batchId:'synthetic-batch'})
  d.memories.push({id:'synthetic-memory',worldId:w.id,ownerType:'character',ownerId:who,layer:'L3',key:'experience',content:'原世界合成记忆',sourceRefs:[{messageId:'synthetic-msg',revision:1}],status:'active',revision:1,visibility:'private'})
  d.lifeGrants.push({id:'synthetic-grant',worldId:w.id,instanceId:who,moduleId:'mood',read:true,remember:true,share:true,revision:1})
  d.instances[0].state={mood:'紧张',energy:0.3,location:'原地点'}
  const copied=copyKanataWorld(d,w.id,'复制设定',options('copy')),newWorld=copied.worlds[1]
  assert.equal(copied.instances.filter(i=>i.worldId===newWorld.id).length,5)
  assert.equal(copied.conversations.filter(c=>c.worldId===newWorld.id).length,6)
  for(const key of ['messages','memories','events','effects','tasks','lifeGrants']) assert.equal(copied[key].filter(i=>i.worldId===newWorld.id).length,0)
  assert.equal(copied.memories[0].worldId,w.id);assert.equal(copied.instances.find(i=>i.worldId===newWorld.id).state.mood,'平静')
  const roles=new Set(copied.instances.filter(i=>i.worldId===newWorld.id).map(i=>i.id))
  assert.ok(copied.relationships.filter(r=>r.worldId===newWorld.id).every(r=>roles.has(r.fromId)&&roles.has(r.toId)))
  assert.ok(copied.lorebookEntries.filter(l=>l.worldId===newWorld.id).every(l=>l.ownerId===newWorld.id||roles.has(l.ownerId)))
})
test('P3-world archive is reversible, disables automation and rejects ordinary world edits',()=>{
  const d=seed();d.worlds[0].autonomyEnabled=true;d.worlds[0].proactiveEnabled=true;d.worlds[0].notificationsEnabled=true
  const archived=archiveKanataWorld(d,d.worlds[0].id,true)
  assert.equal(archived.worlds[0].archived,true);assert.equal(archived.worlds[0].autonomyEnabled,false)
  assert.throws(()=>addKanataCharacter(archived,d.worlds[0].id,d.cards[0].id,options('blocked')),/WORLD_ARCHIVED/)
  const restored=archiveKanataWorld(archived,d.worlds[0].id,false)
  assert.equal(restored.worlds[0].archived,false);assert.equal(restored.worlds[0].autonomyEnabled,false)
})
test('P3-card global import is byte-idempotent and raw data is retained through backup',()=>{
  const d=seed(),parsed=card(),once=importKanataCard(d,parsed,options('import')),again=importKanataCard(once,parsed,options('retry'))
  assert.equal(once.cards.length,6);assert.deepEqual(again,once)
  assert.deepEqual(readKanataChatBackupSnapshot(buildKanataChatBackupSnapshot(again)).data,again)
  const changed=structuredClone(parsed);changed.definition.summary='preview changed'
  assert.throws(()=>importKanataCard(d,changed,options('bad')),/CARD_PREVIEW_CHANGED/)
  const archived=archiveKanataCard(once,once.cards[5].id,true)
  assert.throws(()=>addKanataCharacter(archived,d.worlds[0].id,once.cards[5].id,options('blocked')),/CARD_UNAVAILABLE/)
})
test('P3-card immutable version updates need explicit selection, preserving overrides and experience',()=>{
  let d=seed();d=copyKanataWorld(d,d.worlds[0].id,'第二世界',options('copy'))
  const cardId=d.cards[0].id,oldVersion=d.cards[0].currentVersionId,instances=d.instances.filter(i=>i.cardId===cardId)
  d=updateKanataCharacter(d,instances[0].id,{speechStyle:'实例保留覆盖'})
  const definition=structuredClone(d.cardVersions[0].definition);definition.name='新版本名字';definition.speechStyle='新的默认表达'
  const updated=updateKanataCard(d,cardId,definition,oldVersion,options('version'))
  assert.equal(updated.cardVersions.length,d.cardVersions.length+1);assert.equal(updated.instances[0].cardVersionId,oldVersion)
  const preview=previewKanataCardSync(updated,cardId)
  assert.equal(preview.length,2);assert.ok(preview[0].fields.includes('name'));assert.ok(preview[0].retainedOverrides.includes('speechStyle'))
  const synced=syncKanataCard(updated,cardId,[preview[0]])
  assert.equal(resolveKanataCharacter(synced,instances[0].id).name,'新版本名字')
  assert.equal(resolveKanataCharacter(synced,instances[0].id).speechStyle,'实例保留覆盖')
  assert.equal(synced.instances.find(i=>i.id===instances[1].id).cardVersionId,oldVersion)
  assert.throws(()=>syncKanataCard(synced,cardId,[preview[0]]),/CARD_SYNC_CONFLICT/)
  assert.throws(()=>updateKanataCard(updated,cardId,definition,oldVersion,options('stale')),/CARD_VERSION_CONFLICT/)
})
test('P3-lore authorization precedes activation/budget, never searching another world or private owner',()=>{
  let d=seed();const owner=d.instances[0].id,other=d.instances[1].id
  d=saveKanataLoreEntry(d,privateEntry(d,'private-lore',owner,'合成私密知识'),null)
  d=copyKanataWorld(d,d.worlds[0].id,'第二世界',options('copy'))
  const worldId=d.worlds[0].id
  assert.ok(selectKanataLorebook(d,{worldId,instanceId:owner,text:'',tokenBudget:1000}).entries.some(e=>e.id==='private-lore'))
  assert.equal(selectKanataLorebook(d,{worldId,instanceId:other,text:'secret',tokenBudget:32000}).entries.some(e=>e.id==='private-lore'),false)
  assert.throws(()=>selectKanataLorebook(d,{worldId:d.worlds[1].id,instanceId:owner,text:'',tokenBudget:1000}),/LORE_WORLD_ACCESS_DENIED/)
  assert.deepEqual(selectKanataLorebook(d,{worldId,instanceId:owner,text:'',tokenBudget:0}).entries,[])
})
test('P3-lore deterministic budgets and selective/case-sensitive keys are bounded without regex',()=>{
  let d=seed();const owner=d.instances[0].id,worldId=d.worlds[0].id
  let entry=privateEntry(d,'selective',owner,'abc',['Room']);entry.activationRule='keyword';entry.caseSensitive=true;entry.secondaryKeys=['Night']
  d=saveKanataLoreEntry(d,entry)
  assert.equal(selectKanataLorebook(d,{worldId,instanceId:owner,text:'room Night',tokenBudget:32000}).entries.some(e=>e.id==='selective'),false)
  assert.equal(selectKanataLorebook(d,{worldId,instanceId:owner,text:'Room',tokenBudget:32000}).entries.some(e=>e.id==='selective'),false)
  const found=selectKanataLorebook(d,{worldId,instanceId:owner,text:'Room Night',tokenBudget:11})
  assert.deepEqual(found.entries.map(e=>e.id),['selective']);assert.equal(found.usedTokens,11)
  assert.deepEqual(found,selectKanataLorebook(d,{worldId,instanceId:owner,text:'Room Night',tokenBudget:11}))
  assert.throws(()=>selectKanataLorebook(d,{worldId,instanceId:owner,text:'',tokenBudget:-1}),/INVALID_LORE_BUDGET/)
})
test('P3-lore card knowledge import defaults private, detects conflicts and never overwrites',()=>{
  let d=importKanataCard(seed(),card(),options('import'))
  d=addKanataCharacter(d,d.worlds[0].id,d.cards[5].id,options('add'))
  const instance=d.instances.at(-1),before=structuredClone(d.cardVersions.at(-1).rawData)
  assert.equal(previewKanataCardLore(d,instance.id).length,1)
  d=attachKanataCardLore(d,instance.id,{skipConflicts:false,idFactory})
  const entry=d.lorebookEntries.at(-1)
  assert.equal(entry.visibility,'private');assert.deepEqual(entry.knownBy,[instance.id])
  assert.throws(()=>attachKanataCardLore(d,instance.id,{skipConflicts:false,idFactory}),/LORE_CONFLICT_REQUIRES_DECISION/)
  assert.deepEqual(attachKanataCardLore(d,instance.id,{skipConflicts:true,idFactory}),d)
  assert.deepEqual(d.cardVersions.at(-1).rawData,before)
  assert.equal(selectKanataLorebook(d,{worldId:d.worlds[0].id,instanceId:d.instances[0].id,text:'秘密',tokenBudget:32000}).entries.some(e=>e.id===entry.id),false)
})
test('P3-lore edit is revision checked and a duplicate content cannot silently replace another entry',()=>{
  let d=seed();const owner=d.instances[0].id,entry=privateEntry(d,'first',owner,'合成条目')
  d=saveKanataLoreEntry(d,entry)
  assert.throws(()=>saveKanataLoreEntry(d,{...entry,content:'修改'},0),/LORE_EDIT_CONFLICT/)
  assert.throws(()=>saveKanataLoreEntry(d,{...entry,id:'second'}),/LORE_DUPLICATE_CONTENT/)
  assert.equal(saveKanataLoreEntry(d,{...entry,content:'修改'},1).lorebookEntries.at(-1).revision,2)
})
test('P3-identity world user placeholders change without mutating the base card or other world',()=>{
  let d=seed(),who=d.instances[0].id
  d=updateKanataCharacter(d,who,{summary:'{{user}}与{{char}}在这里。'})
  d=copyKanataWorld(d,d.worlds[0].id,'第二世界',options('copy'))
  d=updateKanataIdentity(d,d.worlds[0].id,{displayName:'旅人',background:''})
  assert.match(renderKanataCharacter(d,who).summary,/旅人与小鸟游星野/)
  assert.match(resolveKanataCharacter(d,who).summary,/\{\{user\}\}/)
  const other=d.instances.find(i=>i.worldId===d.worlds[1].id&&i.cardId===d.instances[0].cardId)
  assert.match(renderKanataCharacter(d,other.id).summary,/老师与小鸟游星野/)
})

test('P3-review1 editing an imported card preserves unrelated primitive extensions, examples and scenario',()=>{
  const raw={spec:'chara_card_v2',spec_version:'2.0',data:{name:'合成',description:'原简介',personality:'原性格',scenario:'原场景',mes_example:'原示例',first_mes:'原开场',alternate_greetings:['另一开场'],extensions:{kanata:'unrelated-extension',unknown:{keep:true}}}}
  const parsed=parseCharacterCardBytes(new TextEncoder().encode(JSON.stringify(raw)),{fileName:'edit.json'})
  let d=importKanataCard(seed(),parsed,options('import'))
  const current=d.cardVersions.at(-1),definition=structuredClone(current.definition)
  definition.summary='新的简介';definition.speechStyle='新的表达节奏'
  d=updateKanataCard(d,current.cardId,definition,current.id,options('update'))
  const saved=d.cardVersions.at(-1).rawData
  assert.equal(saved.data.extensions.kanata,'unrelated-extension')
  assert.deepEqual(saved.data.extensions.unknown,{keep:true})
  assert.equal(saved.data.scenario,'原场景');assert.equal(saved.data.mes_example,'原示例')
  assert.deepEqual(saved.data.alternate_greetings,['另一开场'])
  const reimported=parseCharacterCardBytes(new TextEncoder().encode(JSON.stringify(saved)),{fileName:'again.json'})
  assert.equal(reimported.definition.summary,'新的简介');assert.equal(reimported.definition.speechStyle,'新的表达节奏')
})
