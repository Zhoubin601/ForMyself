// @ts-check
/** Optional schema1 additions. Historic graphs without these fields retain their meaning.
 * @param {import('../domain/kanataTypes').KanataData} data
 */
export function validateKanataExperience(data) {
  /** @param {unknown} condition @param {string} code */
  const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code})}
  /** @param {unknown} value */
  const id=value=>need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value),'INVALID_EXPERIENCE_ID')
  /** @param {unknown} value @param {number} [min] */
  const integer=(value,min=0)=>need(Number.isSafeInteger(value)&&Number(value)>=min,'INVALID_EXPERIENCE_NUMBER')
  const modules=['home','mood','weight','savings','schedule','todo','reports']
  const worlds=new Map(data.worlds.map(w=>[w.id,w])),instances=new Map(data.instances.map(i=>[i.id,i]))
  const conversations=new Map(data.conversations.map(c=>[c.id,c])),memories=new Map(data.memories.map(m=>[m.id,m])),events=new Map(data.events.map(e=>[e.id,e]))
  const grants=new Map(data.lifeGrants.map(g=>[g.id,g]))
  /** @param {unknown} value @param {string} worldId */
  const lifeSources=(value,worldId)=>{
    if(value===undefined)return
    need(Array.isArray(value),'INVALID_LIFE_SOURCES')
    const seen=new Set()
    for(const source of /** @type {import('../domain/kanataTypes').LifeSource[]} */(value)){
      need(source&&typeof source==='object','INVALID_LIFE_SOURCE')
      const grant=grants.get(source.grantId)
      need(grant&&grant.worldId===worldId&&grant.instanceId===source.instanceId&&grant.moduleId===source.moduleId,'LIFE_SOURCE_SCOPE_DENIED')
      integer(source.revision,1);need(source.revision<=Number(grant?.revision),'FUTURE_LIFE_SOURCE')
      need(typeof source.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(source.fingerprint),'INVALID_LIFE_FINGERPRINT')
      const key=JSON.stringify(source);need(!seen.has(key),'DUPLICATE_LIFE_SOURCE');seen.add(key)
    }
  }
  for(const message of data.messages){if(message.deleted!==undefined)need(typeof message.deleted==='boolean','INVALID_MESSAGE_DELETED');if(message.replyToRevision!==undefined){integer(message.replyToRevision,1);need(!!message.replyToMessageId&&message.replyToRevision<=Number(data.messages.find(m=>m.id===message.replyToMessageId)?.revision),'INVALID_REPLY_SOURCE_REVISION')}lifeSources(message.lifeSources,message.worldId)}
  for(const memory of data.memories){
    if(memory.conversationId!==undefined)need(conversations.get(memory.conversationId)?.worldId===memory.worldId,'MEMORY_CONVERSATION_SCOPE_DENIED')
    if(memory.knownBy!==undefined){need(Array.isArray(memory.knownBy)&&new Set(memory.knownBy).size===memory.knownBy.length,'INVALID_MEMORY_KNOWN_BY');memory.knownBy.forEach(i=>need(instances.get(i)?.worldId===memory.worldId,'MEMORY_KNOWLEDGE_SCOPE_DENIED'))}
    if(memory.confidence!==undefined)need(['statement','inference','confirmed','joke'].includes(memory.confidence),'INVALID_MEMORY_CONFIDENCE')
    for(const linked of memory.conflictWith||[])need(linked!==memory.id&&memories.get(linked)?.worldId===memory.worldId,'MEMORY_CONFLICT_SCOPE_DENIED')
    for(const linked of memory.sourceEventIds||[])need(events.get(linked)?.worldId===memory.worldId,'MEMORY_EVENT_SCOPE_DENIED')
    for(const linked of [memory.sharedFromId,memory.supersededById])if(linked!==undefined)need(linked!==memory.id&&memories.get(linked)?.worldId===memory.worldId,'MEMORY_LINK_SCOPE_DENIED')
    if(memory.generationKey!==undefined)need(typeof memory.generationKey==='string'&&memory.generationKey.length<=64000,'INVALID_MEMORY_GENERATION_KEY')
    lifeSources(memory.lifeSources,memory.worldId)
    const seen=new Set([memory.id]);let parent=memory.sharedFromId
    while(parent){need(!seen.has(parent),'MEMORY_SHARE_CYCLE');seen.add(parent);parent=memories.get(parent)?.sharedFromId}
  }
  for(const event of data.events){
    if(event.causality!==undefined)need(['explicit','unknown'].includes(event.causality),'INVALID_EVENT_CAUSALITY')
    if(event.kind!==undefined)need(['note','support','conflict','rest','move','promise'].includes(event.kind),'INVALID_EVENT_KIND')
    if(event.action!==undefined){
      need(event.action&&typeof event.action==='object'&&!Array.isArray(event.action),'INVALID_EVENT_ACTION')
      if(event.action.instanceId!==undefined)need(instances.get(event.action.instanceId)?.worldId===event.worldId&&event.participantIds.includes(event.action.instanceId),'EVENT_ACTION_SCOPE_DENIED')
      if(event.action.relationshipId!==undefined){const relation=data.relationships.find(r=>r.id===event.action?.relationshipId);need(relation?.worldId===event.worldId&&event.participantIds.includes(relation.fromId)&&event.participantIds.includes(relation.toId),'EVENT_ACTION_SCOPE_DENIED')}
      if(event.action.location!==undefined)need(typeof event.action.location==='string'&&event.action.location.length<=200,'INVALID_EVENT_LOCATION')
    }
    lifeSources(event.lifeSources,event.worldId)
  }
  for(const task of data.tasks){
    if(task.errorCode!==undefined)need(typeof task.errorCode==='string'&&/^[A-Z0-9_]*$/.test(task.errorCode),'INVALID_TASK_ERROR')
    if(task.resultMemoryIds!==undefined){need(Array.isArray(task.resultMemoryIds),'INVALID_TASK_MEMORIES');task.resultMemoryIds.forEach(m=>need(memories.get(m)?.worldId===task.worldId,'TASK_MEMORY_SCOPE_DENIED'))}
  }
  for(const event of data.usageEvents||[])if(event.purpose!==undefined)need(['chat','memory','summary','world','proactive','life'].includes(event.purpose),'INVALID_USAGE_PURPOSE')
  const ids=new Set([...data.worlds,...data.cards,...data.cardVersions,...data.identities,...data.instances,...data.conversations,...data.messages,...data.lorebookEntries,...data.memories,...data.relationships,...data.events,...data.effects,...data.tasks,...data.lifeGrants,...data.presetApplications,...data.usageEvents||[]].map(e=>e.id))
  for(const name of /** @type {const} */(['effectBaselines','eventAudits','messageAudits'])){
    if(data[name]===undefined)continue
    need(Array.isArray(data[name]),'INVALID_EXPERIENCE_COLLECTION')
    for(const entry of data[name]||[]){id(entry.id);need(!ids.has(entry.id),'DUPLICATE_EXPERIENCE_ID');ids.add(entry.id);need(worlds.has(entry.worldId),'EXPERIENCE_WORLD_REQUIRED')}
  }
  const baselines=new Set()
  for(const entry of data.effectBaselines||[]){
    const target=entry.targetType==='instance'?instances.get(entry.targetId):entry.targetType==='relationship'?data.relationships.find(r=>r.id===entry.targetId):null
    need(target?.worldId===entry.worldId,'BASELINE_SCOPE_DENIED')
    need(entry.targetType==='instance'?['state.mood','state.energy','state.location'].includes(entry.path):['dimensions.trust','dimensions.intimacy','dimensions.understanding'].includes(entry.path),'UNSUPPORTED_BASELINE_PATH')
    const numeric=entry.path==='state.energy'||entry.path.startsWith('dimensions.')
    need(numeric?typeof entry.value==='number'&&entry.value<=(1)&&entry.value>=(entry.path==='state.energy'?0:-1):typeof entry.value==='string'&&entry.value.length<=2000,'INVALID_BASELINE_VALUE')
    const key=JSON.stringify([entry.targetType,entry.targetId,entry.path]);need(!baselines.has(key),'DUPLICATE_EFFECT_BASELINE');baselines.add(key)
  }
  for(const audit of data.eventAudits||[]){
    need(events.get(audit.eventId)?.worldId===audit.worldId,'EVENT_AUDIT_SCOPE_DENIED');integer(audit.at)
    need(audit.previous?.id===audit.eventId&&audit.next?.id===audit.eventId&&audit.previous.worldId===audit.worldId&&audit.next.worldId===audit.worldId,'INVALID_EVENT_AUDIT')
    integer(audit.previous.revision,1);integer(audit.next.revision,1);need(audit.next.revision>audit.previous.revision,'INVALID_EVENT_AUDIT_REVISION')
    need(audit.next.revision<=Number(events.get(audit.eventId)?.revision),'FUTURE_EVENT_AUDIT_REVISION')
    lifeSources(audit.previous.lifeSources,audit.worldId);lifeSources(audit.next.lifeSources,audit.worldId)
  }
  for(const event of data.events)if(event.replacesEventId!==undefined)need(event.replacesEventId!==event.id&&events.get(event.replacesEventId)?.worldId===event.worldId,'EVENT_REPLACEMENT_SCOPE_DENIED')
  for(const audit of data.messageAudits||[]){
    need(data.messages.some(m=>m.id===audit.messageId&&m.worldId===audit.worldId),'MESSAGE_AUDIT_SCOPE_DENIED');integer(audit.at)
    need(audit.previous?.id===audit.messageId&&audit.next?.id===audit.messageId&&audit.previous.worldId===audit.worldId&&audit.next.worldId===audit.worldId,'INVALID_MESSAGE_AUDIT')
    integer(audit.previous.revision,1);integer(audit.next.revision,1);need(audit.next.revision>audit.previous.revision,'INVALID_MESSAGE_AUDIT_REVISION')
    need(typeof audit.previous.content==='string'&&typeof audit.next.content==='string','INVALID_MESSAGE_AUDIT_CONTENT')
    for(const snapshot of [audit.previous,audit.next]){const conversation=conversations.get(snapshot.conversationId);need(conversation?.worldId===audit.worldId&&conversation.participantIds.includes(snapshot.senderId),'MESSAGE_AUDIT_PARTICIPANT_SCOPE_DENIED');lifeSources(snapshot.lifeSources,audit.worldId)}
  }
  if(data.roleBindings!==undefined){
    const binding=data.roleBindings;need(binding&&typeof binding==='object'&&binding.modules&&typeof binding.modules==='object'&&!Array.isArray(binding.modules),'INVALID_ROLE_BINDINGS');integer(binding.revision,1)
    need(Object.keys(binding.modules).every(key=>modules.includes(key)),'INVALID_ROLE_BINDING_MODULE')
    for(const selected of [binding.global,...Object.values(binding.modules)])if(selected!==null){need(selected&&typeof selected==='object','INVALID_ROLE_BINDING');id(selected.worldId);id(selected.instanceId)}
  }
  const policyWorlds=new Set()
  if(data.memoryPolicies!==undefined)need(Array.isArray(data.memoryPolicies),'INVALID_MEMORY_POLICIES')
  for(const policy of data.memoryPolicies||[]){
    need(worlds.has(policy.worldId)&&!policyWorlds.has(policy.worldId),'INVALID_MEMORY_POLICY_WORLD');policyWorlds.add(policy.worldId)
    need(['economical','standard','deep','custom'].includes(policy.strategy)&&typeof policy.enabled==='boolean','INVALID_MEMORY_POLICY')
    integer(policy.revision,1);integer(policy.recentMessages,2);integer(policy.summarizeAfter,4);integer(policy.extractAfter,2);integer(policy.contextBudget,2000)
    need(policy.recentMessages<=40&&policy.summarizeAfter<=200&&policy.extractAfter<=100&&policy.contextBudget<=64000&&policy.summarizeAfter>policy.recentMessages,'MEMORY_POLICY_BOUNDS')
  }
}
