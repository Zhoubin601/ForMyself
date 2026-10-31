// @ts-check
/** Optional additions retain schema1 compatibility. No effects execute during import.
 * @param {import('../domain/kanataTypes').KanataData} data */
export function validateKanataAutonomy(data) {
  /** @param {unknown} value @param {string} code */
  const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code})}
  /** @param {number} value @param {number} min @param {number} max */
  const bounded=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max
  const seen=new Set()
  if(data.autonomyPolicies!==undefined)need(Array.isArray(data.autonomyPolicies),'INVALID_AUTONOMY_POLICIES')
  for(const policy of data.autonomyPolicies||[]){
    need(policy&&data.worlds.some(w=>w.id===policy.worldId)&&!seen.has(policy.worldId),'AUTONOMY_POLICY_SCOPE');seen.add(policy.worldId)
    need(bounded(policy.revision,1,Number.MAX_SAFE_INTEGER)&&bounded(policy.dailyDialogueLimit,0,4)&&bounded(policy.maxCatchUpHours,1,24),'AUTONOMY_POLICY_BOUNDS')
    need(['strict','standard','free','unrestricted'].includes(policy.freedom)&&bounded(policy.quietStartMinute,0,1439)&&bounded(policy.quietEndMinute,0,1439),'INVALID_AUTONOMY_POLICY')
    if(policy.socialChannel!==undefined)need(['private','group'].includes(policy.socialChannel),'INVALID_SOCIAL_CHANNEL')
  }
  const ids=new Set([...data.worlds,...data.instances,...data.messages,...data.tasks,...data.events,...data.cards,...data.cardVersions,...data.conversations,...data.memories,...data.identities,...data.lorebookEntries,...data.relationships,...data.effects,...data.lifeGrants,...data.presetApplications,...data.usageEvents||[],...data.eventAudits||[],...data.messageAudits||[],...data.effectBaselines||[]].map(x=>x.id))
  if(data.virtualSchedules!==undefined)need(Array.isArray(data.virtualSchedules),'INVALID_VIRTUAL_SCHEDULES')
  const schedules=data.virtualSchedules||[]
  need(schedules.length<=1000,'VIRTUAL_SCHEDULE_LIMIT')
  for(const schedule of schedules){
    need(schedule&&typeof schedule.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(schedule.id)&&!ids.has(schedule.id),'INVALID_VIRTUAL_SCHEDULE_ID');ids.add(schedule.id)
    need(data.instances.some(i=>i.id===schedule.instanceId&&i.worldId===schedule.worldId),'VIRTUAL_SCHEDULE_SCOPE')
    need(Array.isArray(schedule.days)&&schedule.days.length>0&&new Set(schedule.days).size===schedule.days.length&&schedule.days.every(d=>bounded(d,1,7)),'INVALID_SCHEDULE_DAYS')
    need(bounded(schedule.startMinute,0,1439)&&bounded(schedule.endMinute,1,1440)&&schedule.startMinute<schedule.endMinute,'INVALID_SCHEDULE_INTERVAL')
    need(typeof schedule.location==='string'&&schedule.location.trim().length>0&&schedule.location.length<=200&&typeof schedule.activity==='string'&&schedule.activity.trim().length>0&&schedule.activity.length<=200&&typeof schedule.resting==='boolean'&&bounded(schedule.revision,1,Number.MAX_SAFE_INTEGER),'INVALID_SCHEDULE_CONTENT')
  }
  // Validate every row before comparing pairs; a malformed later row must receive a stable
  // validation error instead of crashing while the first valid row checks its neighbours.
  for(const schedule of schedules)need(!schedules.some(other=>other!==schedule&&other.instanceId===schedule.instanceId&&other.worldId===schedule.worldId&&other.days.some(d=>schedule.days.includes(d))&&other.startMinute<schedule.endMinute&&schedule.startMinute<other.endMinute),'VIRTUAL_SCHEDULE_CONFLICT')
  for(const task of data.tasks)if(task.simulationWindow){
    const window=task.simulationWindow
    need(task.kind==='world'&&bounded(window.start,0,Number.MAX_SAFE_INTEGER)&&bounded(window.end,window.start+1,window.start+1800000)&&bounded(window.skippedMs,0,Number.MAX_SAFE_INTEGER)&&typeof window.timeZone==='string','INVALID_SIMULATION_WINDOW')
    try{new Intl.DateTimeFormat('en',{timeZone:window.timeZone}).format(0)}catch{need(false,'INVALID_SIMULATION_TIMEZONE')}
  }
  for(const task of data.tasks)if(task.social){
    const social=task.social,parent=data.tasks.find(t=>t.id===social.windowTaskId)
    need(task.kind==='world'&&parent?.worldId===task.worldId&&parent.state==='succeeded'&&parent.simulationWindow&&social.effectiveAt===parent.simulationWindow.end,'SOCIAL_WINDOW_REQUIRED')
    need(typeof social.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(social.date)&&typeof social.location==='string'&&social.location.trim().length>0&&social.location.length<=200,'INVALID_SOCIAL_SCOPE')
    need(Array.isArray(social.participantIds)&&social.participantIds.length===2&&new Set(social.participantIds).size===2&&social.participantIds.every(id=>data.instances.some(i=>i.id===id&&i.worldId===task.worldId)),'SOCIAL_PARTICIPANTS_DENIED')
    const conversation=data.conversations.find(c=>c.id===task.conversationId)
    need((conversation?.type==='character'&&conversation.participantIds.length===2||conversation?.type==='group')&&social.participantIds.every(id=>conversation?.participantIds.includes(id)),'SOCIAL_CONVERSATION_DENIED')
  }
  const notificationIds=new Set()
  for(const task of data.tasks)if(task.contact){
    const contact=task.contact
    need(task.kind==='proactive'&&!!task.instanceId&&data.conversations.some(c=>c.id===task.conversationId&&c.type==='private'&&c.worldId===task.worldId&&c.participantIds.includes(task.instanceId||'')),'CONTACT_SCOPE_DENIED')
    need(typeof contact.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(contact.date)&&bounded(contact.expiresAt,task.notBefore,Number.MAX_SAFE_INTEGER)&&bounded(contact.notificationId,910000000,910999999)&&!notificationIds.has(contact.notificationId),'INVALID_CONTACT_METADATA');notificationIds.add(contact.notificationId)
    need(['none','dispatching','sent','denied','failed'].includes(contact.notificationState),'INVALID_CONTACT_NOTIFICATION_STATE')
  }
  for(const task of data.tasks)if(task.deferredReply){
    const reply=task.deferredReply,source=data.messages.find(m=>m.id===reply.sourceMessageId)
    if(reply.activityDelay!==undefined)need(typeof reply.activityDelay==='boolean','INVALID_DEFERRED_ACTIVITY_DELAY')
    need(task.kind==='reply'&&source?.worldId===task.worldId&&source.conversationId===task.conversationId&&source.senderType==='user'&&bounded(reply.sourceRevision,1,source.revision)&&bounded(reply.expiresAt,task.notBefore,Number.MAX_SAFE_INTEGER),'INVALID_DEFERRED_REPLY')
  }
}
