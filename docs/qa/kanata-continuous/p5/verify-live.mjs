// Explicit external test credential, synthetic sources only, at most three exchanges.
import {readFile,writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import preset from '../../../../src/features/chat/presets/abydos.v1.json' with {type:'json'}
import {createAIClient} from '../../../../src/platform/ai/client.js'
import {createEmptyKanataData} from '../../../../src/features/chat/domain/kanataCore.js'
import {instantiateWorldPreset} from '../../../../src/features/chat/domain/presetCore.js'
import {planKanataMemoryTask,beginKanataMemoryTask,completeKanataMemoryTask,buildKanataMemoryPrompt} from '../../../../src/features/chat/experience/kanataMemory.js'
import {buildKanataConversationContext} from '../../../../src/features/chat/domain/kanataConversation.js'
import {setKanataLifeGrant} from '../../../../src/features/chat/experience/kanataKnowledge.js'
import {collectKanataLifeContext} from '../../../../src/application/kanataLifeContext.js'
const directory=dirname(fileURLToPath(import.meta.url)),result={status:'RUNNING',startedAt:new Date().toISOString(),syntheticOnly:true,attempts:[],responses:[]}
let key='',counter=0
const tools={id:()=> 'synthetic-'+(++counter),clock:()=>2000}
let data=instantiateWorldPreset(createEmptyKanataData('synthetic-live-user'),preset,{initializationKey:'synthetic',now:1000,timeZone:'Asia/Shanghai',idFactory:kind=>kind+'-'+(++counter)})
function add(content,role='user'){
  const c=data.conversations[0],user=role==='user',id=tools.id()
  data.messages.push({id,worldId:c.worldId,conversationId:c.id,role,senderType:user?'user':'character',senderId:user?data.identities[0].id:data.instances[0].id,senderNameSnapshot:user?'合成老师':'合成星野',content,createdAt:1000+counter,revision:1,status:'complete',turnId:id,batchId:id})
}
try{
  if(!process.argv[2])throw Error('EXTERNAL_TEST_KEY_REQUIRED')
  key=(await readFile(resolve(process.argv[2]),'utf8')).trim();if(!/^sk-[A-Za-z0-9_-]+$/.test(key))throw Error('INVALID_TEST_KEY_FORMAT')
  const client=createAIClient(()=>({aiProviderUrl:'https://api.deepseek.com',aiApiKey:key,aiModel:'deepseek-flash'}))
  add('这是合成测试。请记住我喜欢合成薄荷茶。');add('我开玩笑说自己有一百万颗星星，这不是真实资产。');add('也许你喜欢晨跑，但这是我的猜测。','assistant');add('我没有确认喜欢晨跑，请不要当成事实。')
  for(let n=0;n<22;n++)add('普通合成闲聊第'+n+'条，不包含新的重要事实。')
  const original=JSON.stringify(data.messages)
  for(const kind of ['memory','summary']){
    const plan=planKanataMemoryTask(data,data.conversations[0].id,data.instances[0].id,kind)
    if(!plan)throw Error('MEMORY_PLAN_MISSING')
    data=beginKanataMemoryTask(data,plan,tools);const task=data.tasks.at(-1)
    const response=await client.completeChat({messages:buildKanataMemoryPrompt(plan),stream:false,maxTokens:2048,timeoutMs:90000,onAttempt:async e=>{const index=result.attempts.findIndex(a=>a.id===e.id);if(index<0)result.attempts.push(e);else result.attempts[index]=e}})
    data=completeKanataMemoryTask(data,task.id,task.attempt,response.content,tools)
    result.responses.push({kind,content:response.content});console.log('PASS live-'+kind)
  }
  if(JSON.stringify(data.messages)!==original||data.events.length||data.memories.some(m=>m.layer==='L3'&&m.status!=='candidate'))throw Error('LIVE_TRUTH_BOUNDARY_FAILED')
  data=setKanataLifeGrant(data,data.worlds[0].id,data.instances[0].id,'todo',{read:true,remember:false,share:false},tools.id)
  const life=await collectKanataLifeContext(data,{worldId:data.worlds[0].id,instanceId:data.instances[0].id,group:false,moduleId:'todo'},{todo:async()=>[{id:'synthetic-exam-task',title:'复习合成测试章节'}]})
  add('你能根据明确授权的合成待办，给一句符合自己性格的建议吗？不要声称已经替我完成。')
  const context=buildKanataConversationContext(data,data.conversations[0].id,data.instances[0].id,{lifeEntries:life.entries,lifeSources:life.lifeSources})
  const response=await client.completeChat({messages:context.messages,stream:false,maxTokens:512,timeoutMs:90000,onAttempt:async e=>{const index=result.attempts.findIndex(a=>a.id===e.id);if(index<0)result.attempts.push(e);else result.attempts[index]=e}})
  result.responses.push({kind:'authorized-life-read',content:response.content});console.log('PASS live-authorized-life-read')
  if(result.attempts.some(a=>a.status==='pending'||!a.usage))throw Error('LIVE_USAGE_MISSING')
  result.counts={messages:data.messages.length,memories:data.memories.length,events:data.events.length,tasks:data.tasks.length}
  result.status='AWAITING_QUALITY_REVIEW'
}catch(error){result.status='FAIL';result.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'LIVE_TEST_FAILED';console.error(result.error);process.exitCode=1}
finally{key='';result.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'live-results.json'),JSON.stringify(result,null,2)+'\n')}
