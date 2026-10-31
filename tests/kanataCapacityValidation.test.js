import test from 'node:test'
import assert from 'node:assert/strict'
import preset from '../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createEmptyKanataData} from '../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../src/features/chat/domain/presetCore.js'
import {validateKanataExperience} from '../src/features/chat/experience/experienceValidation.js'
import {validateKanataData} from '../src/features/chat/domain/kanataValidation.js'
function fixture(count){
  let id=0
  const data=instantiateWorldPreset(createEmptyKanataData('synthetic-capacity'),preset,{initializationKey:'first',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>`${kind}-${++id}`}),c=data.conversations[0]
  data.messages=Array.from({length:count},(_,n)=>({id:`capacity-message-${n}`,worldId:c.worldId,conversationId:c.id,role:n%2?'assistant':'user',senderType:n%2?'character':'user',senderId:n%2?data.instances[0].id:data.identities[0].id,senderNameSnapshot:'合成',content:'合成正文',createdAt:1000+n,revision:1,status:'complete',turnId:`capacity-turn-${Math.floor(n/2)}`,batchId:`capacity-batch-${Math.floor(n/2)}`,...(n%2?{replyToMessageId:`capacity-message-${n-1}`,replyToRevision:1}:{})}))
  return data
}
test('P7 thousands of reply proofs do not repeatedly scan unrelated message bodies',()=>{
  const data=validateKanataData(fixture(5000));let indexedReads=0
  data.messages=new Proxy(data.messages,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))indexedReads++;return Reflect.get(target,key,receiver)}})
  validateKanataExperience(data)
  // A bounded linear read budget detects quadratic source lookups without a wall-clock
  // assertion or requiring a particular index implementation.
  assert.ok(indexedReads<=data.messages.length*8,`too many source-array reads: ${indexedReads}`)
})
test('P7 indexed proof validation still rejects nonexistent and future source revisions',()=>{
  const data=fixture(1000)
  data.messages[999].replyToRevision=2
  assert.throws(()=>validateKanataData(data),/INVALID_REPLY_SOURCE_REVISION/)
  data.messages[999].replyToRevision=1;data.messages[999].replyToMessageId='missing-source'
  assert.throws(()=>validateKanataExperience(data),/INVALID_REPLY_SOURCE_REVISION/)
})
