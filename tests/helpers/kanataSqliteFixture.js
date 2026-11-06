// Synthetic M1 records only; this is not the M5 legacy importer.
import {createHash} from 'node:crypto'
import preset from '../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../src/features/chat/domain/presetCore.js'
import {validateKanataData} from '../../src/features/chat/domain/kanataValidation.js'

export function kanataSqliteFixture() {
  let data = createEmptyKanataData('synthetic-user')
  for (const key of ['first', 'second']) data = instantiateWorldPreset(data, preset, {
    initializationKey:key, now:1000, timeZone:'Asia/Shanghai',
    idFactory:(kind, source) => kind + '-' + createHash('sha256').update(source).digest('hex').slice(0,24)
  })
  const worldId = data.worlds[0].id, conversation = data.conversations[0], instanceId = data.instances[0].id
  const message = {id:'message-one',worldId,conversationId:conversation.id,role:'user',senderType:'user',senderId:data.identities[0].id,
    senderNameSnapshot:'合成用户',content:'仅用于结构验收',createdAt:1000,revision:2,status:'complete',turnId:'turn-one',batchId:'batch-one'}
  data.messages.push(message, {...message,id:'message-two',role:'assistant',senderType:'character',senderId:instanceId,revision:1,
    senderNameSnapshot:'合成角色',replyToMessageId:message.id,replyToRevision:1})
  const sourceRefs=[{messageId:message.id,revision:1}]
  const lifeSources=[{grantId:'grant-one',revision:1,moduleId:'todo',instanceId,fingerprint:'a'.repeat(64)}]
  data.lifeGrants.push({id:'grant-one',worldId,instanceId,moduleId:'todo',read:true,remember:true,share:false,revision:2})
  message.lifeSources=lifeSources
  data.memories.push({id:'memory-one',worldId,ownerType:'character',ownerId:instanceId,layer:'L3',key:'synthetic',content:'合成事实',sourceRefs,
    status:'stale',revision:1,visibility:'private',knownBy:[instanceId],conversationId:conversation.id,sourceEventIds:['event-one'],lifeSources})
  data.events.push({id:'event-one',worldId,participantIds:[instanceId],sourceRefs,causedByEventIds:[],status:'committed',visibility:'private',summary:'合成事件',
    effectiveAt:1000,recordedAt:1000,revision:2,kind:'note',causality:'explicit',lifeSources})
  data.effects.push({id:'effect-one',worldId,eventId:'event-one',targetType:'instance',targetId:instanceId,operation:'set',path:'state.mood',value:'平静',ruleVersion:1})
  data.effectBaselines=[{id:'baseline-one',worldId,targetType:'instance',targetId:instanceId,path:'state.mood',value:'平静'}]
  data.tasks.push({id:'task-one',worldId,kind:'memory',state:'succeeded',idempotencyKey:'synthetic-task',sourceRefs,sourceRevision:1,attempt:1,
    notBefore:1000,leaseUntil:0,conversationId:conversation.id,instanceId,resultEventIds:['event-one'],resultMemoryIds:['memory-one']})
  data.messageAudits=[{id:'message-audit-one',worldId,messageId:message.id,at:1000,previous:{...message,revision:1},next:{...message}}]
  data.eventAudits=[{id:'event-audit-one',worldId,eventId:'event-one',at:1000,previous:{...data.events[0],revision:1},next:{...data.events[0]}}]
  data.usageEvents=[{id:'usage-one',worldId,conversationId:conversation.id,instanceId,turnId:'turn-one',model:'synthetic-model',officialProvider:false,
    startedAt:1000,finishedAt:1100,transport:'json',status:'succeeded',errorCode:'',finishReason:'stop',usage:{promptTokens:10,completionTokens:5,cacheHitTokens:0},
    estimatedInputTokens:10,estimatedOutputTokens:5,purpose:'memory'}]
  data.memoryPolicies=[{worldId,strategy:'standard',enabled:true,recentMessages:12,summarizeAfter:24,extractAfter:8,contextBudget:24000,revision:1}]
  data.autonomyPolicies=[{worldId,revision:1,dailyDialogueLimit:0,maxCatchUpHours:3,freedom:'standard',quietStartMinute:1320,quietEndMinute:480}]
  data.virtualSchedules=[{id:'schedule-one',worldId,instanceId,days:[1,3],startMinute:600,endMinute:660,location:'合成地点',activity:'合成活动',resting:false,revision:1}]
  data.roleBindings={revision:1,global:{worldId,instanceId},modules:{todo:null,mood:{worldId:'retired-world',instanceId:'retired-instance'}}}
  return validateKanataData(data)
}

export const insertSql = (table, row) => {
  const columns=Object.keys(row)
  if(!/^[a-z_]+$/.test(table)||!columns.every(c=>/^[a-z_]+$/.test(c)))throw Error('TEST_IDENTIFIER_REQUIRED')
  return {sql:`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,parameters:Object.values(row)}
}

/** Exact synthetic SQL commands can also run against SQLCipher, without a second DDL. */
export function kanataFixtureCommands(data=kanataSqliteFixture()) {
  const commands=[], add=(table,row)=>commands.push(insertSql(table,row))
  const scoped=row=>({id:row.id,world_id:row.worldId})
  const j=JSON.stringify
  add('dataset_metadata',{singleton:1,user_id:data.userId,data_version:data.version})
  for(const r of data.worlds)add('worlds',{id:r.id,name:r.name,rules:r.rules,revision:r.revision,time_zone:r.timeZone,created_at:r.createdAt,last_simulated_at:r.lastSimulatedAt,
    autonomy_enabled:+r.autonomyEnabled,proactive_enabled:+r.proactiveEnabled,notifications_enabled:+r.notificationsEnabled,default_chat_mode:r.defaultChatMode,identity_id:data.identities.find(i=>i.worldId===r.id).id})
  for(const r of data.cards)add('character_cards',{id:r.id,current_version_id:r.currentVersionId,archived:+r.archived,preset_key:r.presetKey??null})
  for(const r of data.cardVersions)add('card_versions',{id:r.id,card_id:r.cardId,revision:r.revision,definition_json:j(r.definition),raw_data_json:j(r.rawData),source:r.source})
  for(const r of data.identities)add('world_identities',{...scoped(r),user_id:r.userId,display_name:r.displayName,background:r.background,revision:r.revision})
  for(const r of data.instances)add('character_instances',{...scoped(r),card_id:r.cardId,card_version_id:r.cardVersionId,revision:r.revision,overrides_json:j(r.overrides),mood:r.state.mood,energy:r.state.energy,location:r.state.location,autonomy_enabled:+r.autonomyEnabled,proactive_enabled:+r.proactiveEnabled})
  for(const r of data.conversations){
    add('conversations',{...scoped(r),type:r.type,title:r.title,mode:r.mode,revision:r.revision,last_read_at:r.lastReadAt})
    r.participantIds.forEach((p,i)=>add('conversation_participants',{world_id:r.worldId,conversation_id:r.id,participant_id:p,kind:data.identities.some(u=>u.id===p)?'user':'character',ordinal:i}))
  }
  for(const r of data.messages)add('messages',{...scoped(r),conversation_id:r.conversationId,role:r.role,sender_type:r.senderType,sender_id:r.senderId,sender_name_snapshot:r.senderNameSnapshot,content:r.content,
    created_at:r.createdAt,revision:r.revision,status:r.status,turn_id:r.turnId,batch_id:r.batchId,reply_to_message_id:r.replyToMessageId??null,reply_to_revision:r.replyToRevision??null})
  for(const r of data.lorebookEntries){
    add('lorebook_entries',{...scoped(r),scope:r.scope,owner_id:r.ownerId,owner_instance_id:r.scope==='character'?r.ownerId:null,keys_json:j(r.keys),content:r.content,priority:r.priority,activation_rule:r.activationRule,visibility:r.visibility,source_tag:r.sourceTag,revision:r.revision})
    for(const p of r.knownBy)add('lorebook_known_by',{world_id:r.worldId,entry_id:r.id,participant_id:p})
  }
  for(const r of data.memories){
    add('memories',{...scoped(r),owner_type:r.ownerType,owner_id:r.ownerId,owner_instance_id:r.ownerType==='character'?r.ownerId:null,layer:r.layer,memory_key:r.key,content:r.content,status:r.status,revision:r.revision,visibility:r.visibility,conversation_id:r.conversationId??null})
    for(const p of r.knownBy||[])add('memory_known_by',{world_id:r.worldId,memory_id:r.id,instance_id:p})
  }
  for(const r of data.relationships)add('relationships',{...scoped(r),from_id:r.fromId,to_id:r.toId,kind:r.kind,trust_baseline:r.trustBaseline,public_summary:r.publicSummary,...r.dimensions,dimension_rule_version:r.dimensionRuleVersion,revision:r.revision})
  for(const r of data.events){
    add('world_events',{...scoped(r),status:r.status,visibility:r.visibility,summary:r.summary,effective_at:r.effectiveAt,recorded_at:r.recordedAt,revision:r.revision})
    for(const p of r.participantIds)add('event_participants',{world_id:r.worldId,event_id:r.id,participant_id:p})
    for(const p of r.causedByEventIds)add('event_causes',{world_id:r.worldId,event_id:r.id,cause_event_id:p})
  }
  const target=r=>({target_type:r.targetType,target_id:r.targetId,target_instance_id:r.targetType==='instance'?r.targetId:null,target_relationship_id:r.targetType==='relationship'?r.targetId:null,path:r.path,value_json:j(r.value)})
  for(const r of data.effects)add('world_effects',{...scoped(r),...target(r),event_id:r.eventId,operation:r.operation,rule_version:r.ruleVersion})
  for(const r of data.effectBaselines)add('effect_baselines',{...scoped(r),...target(r)})
  for(const r of data.tasks){
    add('background_tasks',{...scoped(r),kind:r.kind,state:r.state,idempotency_key:r.idempotencyKey,source_revision:r.sourceRevision,attempt:r.attempt,not_before:r.notBefore,lease_until:r.leaseUntil,conversation_id:r.conversationId??null,instance_id:r.instanceId??null})
    for(const p of r.resultEventIds)add('task_result_events',{world_id:r.worldId,task_id:r.id,event_id:p})
    for(const p of r.resultMemoryIds||[])add('task_result_memories',{world_id:r.worldId,task_id:r.id,memory_id:p})
  }
  for(const r of data.lifeGrants)add('life_grants',{...scoped(r),instance_id:r.instanceId,module_id:r.moduleId,can_read:+r.read,can_remember:+r.remember,can_share:+r.share,revision:r.revision})
  for(const r of data.presetApplications)add('preset_applications',{...scoped(r),initialization_key:r.initializationKey,preset_source_id:r.presetSourceId,preset_version:r.presetVersion})
  for(const r of data.usageEvents)add('usage_events',{...scoped(r),conversation_id:r.conversationId,instance_id:r.instanceId,turn_id:r.turnId,model:r.model,official_provider:+r.officialProvider,started_at:r.startedAt,finished_at:r.finishedAt,transport:r.transport,status:r.status,error_code:r.errorCode,finish_reason:r.finishReason,estimated_input_tokens:r.estimatedInputTokens,estimated_output_tokens:r.estimatedOutputTokens,prompt_tokens:r.usage?.promptTokens??null,completion_tokens:r.usage?.completionTokens??null,cache_hit_tokens:r.usage?.cacheHitTokens??null,purpose:r.purpose??null})
  for(const r of data.virtualSchedules){
    add('virtual_schedules',{...scoped(r),instance_id:r.instanceId,start_minute:r.startMinute,end_minute:r.endMinute,location:r.location,activity:r.activity,resting:+r.resting,revision:r.revision})
    for(const day of r.days)add('virtual_schedule_days',{world_id:r.worldId,schedule_id:r.id,day})
  }
  for(const r of data.memoryPolicies)add('memory_policies',{world_id:r.worldId,strategy:r.strategy,enabled:+r.enabled,recent_messages:r.recentMessages,summarize_after:r.summarizeAfter,extract_after:r.extractAfter,context_budget:r.contextBudget,revision:r.revision})
  for(const r of data.autonomyPolicies)add('autonomy_policies',{world_id:r.worldId,revision:r.revision,daily_dialogue_limit:r.dailyDialogueLimit,max_catch_up_hours:r.maxCatchUpHours,freedom:r.freedom,quiet_start_minute:r.quietStartMinute,quiet_end_minute:r.quietEndMinute})
  add('role_binding_state',{singleton:1,revision:data.roleBindings.revision})
  for(const [scope,b] of Object.entries({global:data.roleBindings.global,...data.roleBindings.modules}))add('role_bindings',{scope,world_id:b?.worldId??null,instance_id:b?.instanceId??null})
  for(const [list,prefix,owner] of [[data.messages,'message','message_id'],[data.memories,'memory','memory_id'],[data.events,'event','event_id'],[data.tasks,'task','task_id']])for(const r of list){
    if(prefix!=='message')for(const s of r.sourceRefs)add(prefix+'_sources',{world_id:r.worldId,[owner]:r.id,message_id:s.messageId,message_revision:s.revision})
    if(prefix!=='task')for(const s of r.lifeSources||[])add(prefix+'_life_sources',{world_id:r.worldId,[owner]:r.id,grant_id:s.grantId,instance_id:s.instanceId,module_id:s.moduleId,grant_revision:s.revision,fingerprint:s.fingerprint})
  }
  for(const [list,prefix,owner] of [[data.messageAudits,'message','message_id'],[data.eventAudits,'event','event_id']])for(const r of list)add(prefix+'_audits',{...scoped(r),[owner]:r[prefix+'Id'],at:r.at,previous_revision:r.previous.revision,next_revision:r.next.revision,previous_json:j(r.previous),next_json:j(r.next)})
  for(const r of data.memories)for(const p of r.sourceEventIds||[])add('memory_events',{world_id:r.worldId,memory_id:r.id,event_id:p})
  for(const r of data.relationships)for(const p of r.sourceEventIds)add('relationship_events',{world_id:r.worldId,relationship_id:r.id,event_id:p})
  return commands
}
