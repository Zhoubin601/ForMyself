// @ts-check
import {kanataScheduledActivity} from './kanataAutonomy.js'
/** Bounded availability delay only; no invented message, relationship penalty or private activity text.
 * The selected speakers are already scoped by the caller's conversation decision.
 * @param {import('../domain/kanataTypes').KanataData} data
 * @param {import('../domain/kanataTypes').Conversation} conversation
 * @param {string[]} speakerIds @param {number} now */
export function planKanataReplyDelay(data,conversation,speakerIds,now){
  const policy=conversation.replyTiming,world=data.worlds.find(w=>w.id===conversation.worldId&&!w.archived)
  if(!policy?.enabled||!world?.autonomyEnabled)return 0
  const busy=data.instances.some(instance=>{
    if(instance.worldId!==world.id||!instance.autonomyEnabled||!conversation.participantIds.includes(instance.id)||!speakerIds.includes(instance.id))return false
    const schedule=kanataScheduledActivity(data,instance.id,now,world.timeZone)
    return instance.state.energy<=0.25||Boolean(schedule&&schedule.worldId===world.id)
  })
  return busy?policy.waitMs:0
}
