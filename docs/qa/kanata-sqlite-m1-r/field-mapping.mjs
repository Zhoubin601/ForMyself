// Documentation specification only. No DTO importer, production query or Store access.
import ts from 'typescript'
import fs from 'node:fs'

const domains='src/features/chat/domain/kanataTypes.d.ts'
const contexts={
 World:['worlds',{presetSourceId:'extensions_json.$.presetSourceId',presetVersion:'extensions_json.$.presetVersion'}],
 CharacterCard:['character_cards',{}],
 CharacterCardVersion:['card_versions',{definition:'definition_json',rawData:'raw_data_json',imported:'imported_json'}],
 CharacterInstance:['character_instances',{overrides:'overrides_json',state:'mood,energy,location','state.mood':'mood','state.energy':'energy','state.location':'location'}],
 WorldUserIdentity:['world_identities',{}],
 Conversation:['conversations',{participantIds:'@conversation_participants.participant_id;conversation_participants.ordinal',replyLimits:'max_speakers,max_messages',replyTiming:'reply_timing_enabled,reply_wait_ms'}],
 GroupReplyLimits:['conversations',{}],ReplyTimingPolicy:['conversations',{enabled:'reply_timing_enabled',waitMs:'reply_wait_ms'}],
 Message:['messages',{lifeSources:'@message_life_sources.grant_id;messages.extensions_json.$.lifeSources'}],
 LorebookEntry:['lorebook_entries',{keys:'keys_json',secondaryKeys:'secondary_keys_json',knownBy:'@lorebook_known_by.participant_id;lorebook_entries.extensions_json.$.knownBy'}],
 Memory:['memories',{key:'memory_key',sourceRefs:'@memory_sources.message_id;memories.extensions_json.$.sourceRefs',knownBy:'@memory_known_by.instance_id;memories.extensions_json.$.knownBy',
  sourceEventIds:'@memory_events.event_id;memories.extensions_json.$.sourceEventIds',lifeSources:'@memory_life_sources.grant_id;memories.extensions_json.$.lifeSources',
  conflictWith:'@memory_links.target_memory_id;memories.extensions_json.$.conflictWith',sharedFromId:'@memory_links.target_memory_id',supersededById:'@memory_links.target_memory_id'}],
 Relationship:['relationships',{dimensions:'trust,intimacy,understanding','dimensions.trust':'trust','dimensions.intimacy':'intimacy','dimensions.understanding':'understanding',sourceEventIds:'@relationship_events.event_id;relationships.extensions_json.$.sourceEventIds'}],
 WorldEvent:['world_events',{participantIds:'@event_participants.participant_id;world_events.extensions_json.$.participantIds',sourceRefs:'@event_sources.message_id;world_events.extensions_json.$.sourceRefs',
  causedByEventIds:'@event_causes.cause_event_id;world_events.extensions_json.$.causedByEventIds',lifeSources:'@event_life_sources.grant_id;world_events.extensions_json.$.lifeSources',
  action:'action_instance_id,action_relationship_id,action_location,extensions_json.$.action','action.instanceId':'action_instance_id','action.relationshipId':'action_relationship_id','action.location':'action_location'}],
 WorldEffect:['world_effects',{value:'value_json'}],EffectBaseline:['effect_baselines',{value:'value_json'}],
 BackgroundTask:['background_tasks',{sourceRefs:'@task_sources.message_id;background_tasks.extensions_json.$.sourceRefs',resultEventIds:'@task_result_events.event_id;background_tasks.extensions_json.$.resultEventIds',resultMemoryIds:'@task_result_memories.memory_id;background_tasks.extensions_json.$.resultMemoryIds',
  simulationWindow:'metadata_json.$.simulationWindow','simulationWindow.start':'metadata_json.$.simulationWindow.start','simulationWindow.end':'metadata_json.$.simulationWindow.end','simulationWindow.skippedMs':'metadata_json.$.simulationWindow.skippedMs','simulationWindow.timeZone':'metadata_json.$.simulationWindow.timeZone',
  social:'window_task_id,metadata_json.$.social','social.windowTaskId':'window_task_id','social.date':'metadata_json.$.social.date','social.participantIds':'@task_social_participants.instance_id;background_tasks.metadata_json.$.social.participantIds','social.location':'metadata_json.$.social.location','social.effectiveAt':'metadata_json.$.social.effectiveAt',
  contact:'notification_id,metadata_json.$.contact','contact.date':'metadata_json.$.contact.date','contact.expiresAt':'metadata_json.$.contact.expiresAt','contact.notificationId':'notification_id','contact.notificationState':'metadata_json.$.contact.notificationState',
  deferredReply:'deferred_message_id,deferred_revision,deferred_expires_at,metadata_json.$.deferredReply','deferredReply.sourceMessageId':'deferred_message_id','deferredReply.sourceRevision':'deferred_revision','deferredReply.expiresAt':'deferred_expires_at','deferredReply.activityDelay':'metadata_json.$.deferredReply.activityDelay'}],
 LifeGrant:['life_grants',{read:'can_read',remember:'can_remember',share:'can_share'}],
 SourceRef:['memory_sources',{messageId:'@memory_sources.message_id;event_sources.message_id;task_sources.message_id',revision:'@memory_sources.message_revision;event_sources.message_revision;task_sources.message_revision'}],
 LifeSource:['message_life_sources',{grantId:'@message_life_sources.grant_id;memory_life_sources.grant_id;event_life_sources.grant_id',revision:'@message_life_sources.grant_revision;memory_life_sources.grant_revision;event_life_sources.grant_revision',moduleId:'@message_life_sources.module_id;memory_life_sources.module_id;event_life_sources.module_id',instanceId:'@message_life_sources.instance_id;memory_life_sources.instance_id;event_life_sources.instance_id',fingerprint:'@message_life_sources.fingerprint;memory_life_sources.fingerprint;event_life_sources.fingerprint'}],
 MessageAudit:['message_audits',{previous:'previous_json,previous_revision',next:'next_json,next_revision'}],EventAudit:['event_audits',{previous:'previous_json,previous_revision',next:'next_json,next_revision'}],
 RoleBinding:['role_bindings',{}],KanataRoleBindings:['role_binding_state',{global:'@role_bindings.scope;role_bindings.world_id;role_bindings.instance_id',modules:'@role_bindings.scope;role_bindings.world_id;role_bindings.instance_id'}],
 MemoryPolicy:['memory_policies',{}],AutonomyPolicy:['autonomy_policies',{}],VirtualSchedule:['virtual_schedules',{days:'@virtual_schedule_days.day;virtual_schedules.extensions_json.$.days'}],
 PresetApplication:['preset_applications',{}],KanataUsageEvent:['usage_events',{}],CompletionAttempt:['usage_events',{usage:'prompt_tokens,completion_tokens,cache_hit_tokens'}],CompletionUsage:['usage_events',{}],
 CharacterDefinition:['card_versions',{}],ImportedCardAsset:['card_versions',{}],
 KanataData:['dataset_metadata',{}],MessageArchiveDescriptor:['messages',{}],MessageHistoryRequest:['messages',{}]
}
const collections={worlds:'worlds',cards:'character_cards',cardVersions:'card_versions',identities:'world_identities',instances:'character_instances',conversations:'conversations',messages:'messages',lorebookEntries:'lorebook_entries',memories:'memories',relationships:'relationships',events:'world_events',effects:'world_effects',tasks:'background_tasks',lifeGrants:'life_grants',presetApplications:'preset_applications',usageEvents:'usage_events',effectBaselines:'effect_baselines',eventAudits:'event_audits',messageAudits:'message_audits',memoryPolicies:'memory_policies',autonomyPolicies:'autonomy_policies',virtualSchedules:'virtual_schedules'}
const snake=s=>s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())
const sources=[domains,'src/platform/ai/completionTypes.d.ts','src/features/chat/cards/characterCardTypes.d.ts']
export function buildFieldMapping(){
 const rows=[]
 for(const file of sources){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
  for(const node of source.statements){
   if(!ts.isInterfaceDeclaration(node)||!contexts[node.name.text])continue
   const name=node.name.text,[table,overrides]=contexts[name]
   function members(list,prefix='',parentOptional=false){for(const m of list){
    if(!ts.isPropertySignature(m))continue
    const field=prefix+m.name.getText(source),optional=!!m.questionToken||parentOptional,type=m.type?.getText(source)??'unknown'
    let path=overrides[field]??snake(field),kind='列',limits='本轮只审计映射；M5尚未实现生产投影/导入。',nulls=optional?'缺失→SQL NULL（或无关联行）；显式null仅在旧类型允许时合法':'必填；不得把读取失败/缺失当默认值'
    if(name==='CharacterDefinition'){path='definition_json.$.'+field;kind='JSON';limits='实例overrides_json同字段可选覆盖；按原文保存，不执行脚本/远程资源。'}
    if(name==='ImportedCardAsset'){path='imported_json.$.'+field;kind='JSON';limits='原PNG/JSON字节保存在sourceBase64；不把头像地址当脚本。'}
    if(name==='KanataData'){
     if(collections[field]){path='@'+collections[field]+'.'+(field.endsWith('Policies')?'world_id':'id');kind='集合/关系';nulls=optional?'dataset_metadata.extensions_json同名键可记录出现标记；0行不自动等于字段不存在':'必需集合；空数组为合法空集合，缺失/null拒绝';limits='表无自然顺序；M5须冻结集合顺序/出现信息，不能宣称原JSON字节已无损还原。'}
     else if(field==='version')path='data_version'
     else if(field==='type'){path='@dataset_metadata.data_version';kind='固定领域类型';limits='固定kanata-data，由领域校验/导出重建；不是SQL Schema版本。'}
     else if(field==='roleBindings'){path='@role_binding_state.singleton;role_bindings.scope';kind='关系';nulls='无state行=字段缺失；global/modules的null与缺省分别表达'}
     else if(field==='messageArchives'){path='@messages.id';kind='不直接迁移';limits='仅M5逐页hash/解密/身份校验后展开正文；旧文件保留，本轮未导入。'}
    }
    if(name==='MessageArchiveDescriptor'){path='@messages.id';kind='不直接迁移';limits='本字段仅是旧页校验输入，不是SQL列投影；key/bytes/index/页内元信息不冒充正文，M5负责逐页展开。'}
    if(name==='MessageHistoryRequest'){path='@messages.id';kind='请求参数不持久化';limits='本字段不是持久化投影；M2重建绑定world/conversation的keyset cursor，generation/text不是消息列。'}
    if(path.startsWith('@'))kind=kind==='列'?'关系表':kind
    else if(path.includes('_json'))kind='JSON/列组合'
    if(path.includes('_sources.')||field.endsWith('Ids')||['knownBy','sourceRefs','days'].includes(field))limits+=' 无ordinal的关系须由原字段同名JSON提示保留顺序/可选空数组；必须与关系行交叉校验，不能用JSON绕过权限/FK。'
    if(name==='RoleBinding'||name==='KanataRoleBindings')limits+=' 允许失效ID保留选择；不能按名字绑定到另一个角色，M3负责有效性。'
    if(name==='EffectBaseline'&&field==='targetType')limits+=' 类型复用含world，但当前领域校验与SQL只允许instance/relationship；不扩大现有契约。'
    if(name==='World'&&field==='timeZone')limits+=' IANA有效性由领域校验，SQL仅非空文本。'
    if(name==='CharacterInstance'&&field==='state.location')nulls="''/空白/普通字符串保留；NULL/缺失拒绝，不发明地点"
    if(name==='VirtualSchedule'&&field==='location')nulls='非空trim文本，NULL/缺失/空串拒绝；不是实例暂无地点语义'
    if(name==='WorldEvent'&&field==='action.location')nulls='可选：缺失SQL NULL，显式NULL旧领域不允许，空串可表达但move命令另要求非空'
    if(type==='JsonValue')nulls='合法JSON null保存为文本null，区别于SQL NULL/字段缺失'
    if(name==='CompletionAttempt'&&field==='usage')nulls='usage=null用三个token列全NULL；usage对象cacheHitTokens=null独立表达；不得用估计填造真实usage'
    const targets=['MessageArchiveDescriptor','MessageHistoryRequest'].includes(name)?[]:path.startsWith('@')?path.slice(1).split(';'):path.split(',').map(p=>table+'.'+p)
    rows.push({field:name+'.'+field,type,optional,targets,kind,nulls,validation:'当前领域/经历/自治校验→结构FK/CHECK；M2/M3命令及M5投影仍须复验。',limits,evidence:file+':'+(source.getLineAndCharacterOfPosition(m.getStart(source)).line+1)})
    if(m.type&&ts.isTypeLiteralNode(m.type))members(m.type.members,field+'.',optional)
    if(m.type&&ts.isArrayTypeNode(m.type)&&ts.isTypeLiteralNode(m.type.elementType))members(m.type.elementType.members,field+'[].',optional)
   }}
   members(node.members)
  }
 }
 return rows
}
