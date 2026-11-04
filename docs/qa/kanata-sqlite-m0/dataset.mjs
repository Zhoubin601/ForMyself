// M0 synthetic fixture v1. No clock, private data or credentials.
import preset from '../../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../../src/features/chat/domain/presetCore.js'
import {createHash} from 'node:crypto'
export const fixtureVersion = 'm0-synthetic-v1-seed-20261103'
export function header() {
  let n=0, data=createEmptyKanataData('m0-synthetic-user')
  for(let w=0;w<2;w++) data=instantiateWorldPreset(data,preset,{initializationKey:`m0-world-${w}`,now:1700000000000,timeZone:'Asia/Shanghai',idFactory:kind=>`${kind}-m0-${++n}`})
  return data
}
export function scopes(data) {
  return data.worlds.flatMap(w=>data.conversations.filter(c=>c.worldId===w.id&&c.type==='private').slice(0,4)).map(c=>({worldId:c.worldId,conversationId:c.id}))
}
export function message(i,data) {
  const scope=scopes(data)[Math.floor(i/2)%8], assistant=i%2===1
  const c=data.conversations.find(c=>c.id===scope.conversationId)
  const sender=assistant?data.instances.find(v=>c.participantIds.includes(v.id)).id:data.identities.find(v=>v.worldId===scope.worldId).id
  const lengths=[64,128,256,1024], length=lengths[Math.floor(i/16)%4]
  return {id:`m0-message-${String(i).padStart(9,'0')}`,...scope,role:assistant?'assistant':'user',senderType:assistant?'character':'user',senderId:sender,senderNameSnapshot:assistant?'合成角色':'合成用户',content:(`合成消息 ${i} / SQLite AES 🚀 Café / `+'abcdef彼方'.repeat(150)).slice(0,length),createdAt:1700000000000+Math.floor(i/32),revision:1,status:'complete',turnId:`m0-turn-${Math.floor(i/2)}`,batchId:`m0-batch-${Math.floor(i/2)}`,...(assistant?{replyToMessageId:`m0-message-${String(i-1).padStart(9,'0')}`,replyToRevision:1}:{})}
}
export function dataset(count) {
  const data=header()
  for(let i=0;i<count;i++)data.messages.push(message(i,data))
  return data
}
export function fingerprint(data) {
  const hash=createHash('sha256').update(JSON.stringify({...data,messages:[]})).update('\n')
  for(const m of data.messages) hash.update(JSON.stringify(m)).update('\n')
  return hash.digest('hex')
}
