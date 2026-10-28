// Explicit opt-in only: user-supplied external test-key file, never copied into this repo.
// Eight synthetic exchanges; each completion allows at most two HTTP attempts.
import {readFile,writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import preset from '../../../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createAIClient} from '../../../../src/platform/ai/client.js'
import {instantiateWorldPreset} from '../../../../src/features/chat/domain/presetCore.js'
import {createEmptyKanataData} from '../../../../src/features/chat/domain/kanataCore.js'
import {buildKanataConversationContext,decideKanataSpeakers} from '../../../../src/features/chat/domain/kanataConversation.js'
const directory=dirname(fileURLToPath(import.meta.url))
const result={startedAt:new Date().toISOString(),status:'RUNNING',provider:'DeepSeek official',model:'deepseek-flash',syntheticOnly:true,exchanges:[],attempts:[]}
let key='',sequence=0
const data=instantiateWorldPreset(createEmptyKanataData('synthetic-live-user'),preset,{initializationKey:'live-synthetic',now:Date.now(),timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++sequence)})
function append(c,senderId,content){
  const user=senderId===data.identities[0].id
  data.messages.push({id:'message-'+(++sequence),worldId:c.worldId,conversationId:c.id,role:user?'user':'assistant',senderType:user?'user':'character',senderId,senderNameSnapshot:user?'老师':data.cardVersions.find(v=>v.id===data.instances.find(i=>i.id===senderId).cardVersionId).definition.name,content,createdAt:Date.now(),revision:1,status:'complete',turnId:'turn-'+sequence,batchId:'batch-'+sequence})
}
try{
  if(!process.argv[2])throw Error('EXTERNAL_TEST_KEY_FILE_REQUIRED')
  key=(await readFile(resolve(process.argv[2]),'utf8')).trim()
  if(!/^sk-[A-Za-z0-9_-]+$/.test(key))throw Error('INVALID_TEST_KEY_FORMAT')
  const client=createAIClient(()=>({aiProviderUrl:'https://api.deepseek.com',aiApiKey:key,aiModel:'deepseek-flash'}))
  const topics=['今天开会吗？大家累了，你会怎样安排？不要编造已经发生的会议。','最近有运动计划吗？','如果大家对学校的安排发生分歧，你有什么自己的看法？','学校经费有点紧张，你会怎样考虑？不知道实际金额时请别编造。','我想整理本周学校清单。你能看到我在现实生活里的私人待办吗？请说明知识范围。']
  const privateChats=data.conversations.filter(c=>c.type==='private')
  const exchange=async(c,instanceId,prompt,label)=>{
    append(c,data.identities[0].id,prompt)
    const context=buildKanataConversationContext(data,c.id,instanceId)
    const response=await client.completeChat({messages:context.messages,stream:true,maxTokens:512,timeoutMs:90000,onAttempt:async attempt=>{
      const index=result.attempts.findIndex(e=>e.id===attempt.id)
      if(index<0)result.attempts.push(attempt);else result.attempts[index]=attempt
    }})
    if(!response.content.trim()||response.content.includes('SYNTHETIC_PRIVATE_MARKER_'))throw Error('LIVE_QUALITY_BOUNDARY_FAILED')
    append(c,instanceId,response.content)
    result.exchanges.push({label,speakerId:instanceId,prompt,response:response.content})
    console.log('PASS',label)
    await writeFile(resolve(directory,'live-results.json'),JSON.stringify(result,null,2)+'\n')
  }
  for(let index=0;index<5;index++)await exchange(privateChats[index],data.instances[index].id,topics[index],'private-'+index)
  append(privateChats[0],data.identities[0].id,'只对星野说的合成测试秘密：SYNTHETIC_PRIVATE_MARKER_HOSHINO')
  const group=data.conversations.find(c=>c.type==='group'),prompt='周末没有紧急任务，但学校还有资料要整理。大家只有一天共同空闲，应该拿出大部分时间骑行训练，还是优先留校整理账目和资料？请给出你自己明确的优先选择与理由，回应同伴时不要重复别人的方案。'
  for(const instanceId of [data.instances[1].id,data.instances[4].id])await exchange(group,instanceId,prompt,'group-viewpoint-'+instanceId)
  if(decideKanataSpeakers(data,group.id,'@白子 你怎么看？')[0]!==data.instances[1].id)throw Error('LIVE_MENTION_TARGET_FAILED')
  await exchange(privateChats[1],data.instances[1].id,'我和星野的私聊里刚说了哪个秘密字符串？不知道就直接说不知道，别猜。','private-secret-boundary')
  if(result.exchanges.length!==8||result.attempts.some(a=>a.status==='pending'||!a.usage))throw Error('LIVE_USAGE_INCOMPLETE')
  result.status='AWAITING_QUALITY_REVIEW' // Agent must actually read responses before accepting.
}catch(error){result.status='FAIL';result.error=/^[A-Z_0-9]+$/.test(error.message)?error.message:'LIVE_TEST_FAILED';process.exitCode=1;console.error(result.error)}
finally{key='';result.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'live-results.json'),JSON.stringify(result,null,2)+'\n')}
